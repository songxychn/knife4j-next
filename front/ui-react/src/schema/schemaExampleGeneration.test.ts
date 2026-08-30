import { afterEach, describe, expect, test, vi } from 'vitest';
import type { JsonValue } from 'knife4j-schema-engine';
import type { SwaggerDoc } from '../types/swagger';
import {
  createSchemaDocumentSession,
  evaluateSchemaDocumentDirectionally,
  type SchemaDocumentSession,
} from './schemaDocumentSession';
import { generateSchemaExample, type SchemaExampleResult } from './schemaExampleGeneration';

const retrievalUri = 'https://examples.knife4j.example/openapi.json';
const sessions: SchemaDocumentSession[] = [];

function documentWithSchemas(schemas: Record<string, JsonValue>): SwaggerDoc {
  return {
    openapi: '3.1.1',
    info: { title: 'Example candidates', version: '1.0.0' },
    paths: {},
    components: { schemas: schemas as never },
  };
}

async function sessionFor(schemas: Record<string, JsonValue>): Promise<SchemaDocumentSession> {
  const session = await createSchemaDocumentSession(documentWithSchemas(schemas), retrievalUri);
  sessions.push(session);
  return session;
}

function reference(name: string): string {
  return `#/components/schemas/${name}`;
}

function expectValue(result: SchemaExampleResult): Extract<SchemaExampleResult, { status: 'value' }> {
  expect(result.status).toBe('value');
  if (result.status !== 'value') throw new Error(`expected a value, received ${result.reason}`);
  return result;
}

async function expectGeneratedValueIsValid(
  session: SchemaDocumentSession,
  schemaReference: string,
  result: SchemaExampleResult,
): Promise<JsonValue> {
  const selected = expectValue(result);
  expect(selected.source).toBe('generated');
  expect(selected.validation).toBe('valid');
  await expect(session.evaluate(schemaReference, selected.value)).resolves.toMatchObject({ valid: true });
  return selected.value;
}

function expectDirectionallyGeneratedValue(result: SchemaExampleResult): JsonValue {
  const selected = expectValue(result);
  expect(selected).toMatchObject({ source: 'generated', authored: false, validation: 'valid' });
  return selected.value;
}

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

describe('authored example priority', () => {
  test('keeps media values ahead of schema annotations and diagnoses an invalid authored value', async () => {
    const session = await sessionFor({
      Value: {
        type: 'integer',
        examples: [2],
        example: 3,
        const: 4,
        default: 5,
        enum: [6],
      },
    });

    const result = await generateSchemaExample(session, reference('Value'), {
      direction: 'request',
      explicit: [{ source: 'media-example', value: 'not-an-integer' }],
    });

    expect(result).toMatchObject({
      status: 'value',
      value: 'not-an-integer',
      source: 'media-example',
      authored: true,
      validation: 'invalid',
      diagnostics: [
        {
          code: 'EXPLICIT_VALUE_INVALID',
          issues: expect.arrayContaining([expect.objectContaining({ keyword: 'type' })]),
        },
      ],
    });
  });

  test('uses schema examples, compatibility example, const, default and enum in the frozen order', async () => {
    const schemaVariants: Array<[string, JsonValue, string, JsonValue]> = [
      [
        'Examples',
        { type: 'integer', examples: [2], example: 3, const: 2, default: 2, enum: [2] },
        'schema-examples',
        2,
      ],
      ['Example', { type: 'integer', example: 3, const: 3, default: 3, enum: [3] }, 'schema-example', 3],
      ['Const', { type: 'integer', const: 4, default: 4, enum: [4] }, 'const', 4],
      ['Default', { type: 'integer', default: 5, enum: [5] }, 'default', 5],
      ['Enum', { type: 'integer', enum: [6, 7] }, 'enum', 6],
    ];
    const session = await sessionFor(Object.fromEntries(schemaVariants.map(([name, schema]) => [name, schema])));

    for (const [name, , source, value] of schemaVariants) {
      await expect(generateSchemaExample(session, reference(name), { direction: 'response' })).resolves.toMatchObject({
        status: 'value',
        source,
        value,
        validation: 'valid',
      });
    }
  });

  test('bounds authored candidate collection before cloning unused annotations', async () => {
    const session = await sessionFor({
      Value: {
        type: 'integer',
        examples: Array.from({ length: 1000 }, (_, index) => index),
      },
    });
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone');

    await expect(
      generateSchemaExample(session, reference('Value'), {
        direction: 'request',
        limits: { maxCandidates: 1 },
      }),
    ).resolves.toMatchObject({ status: 'value', source: 'schema-examples', value: 0 });

    expect(cloneSpy.mock.calls.length).toBeLessThanOrEqual(3);
  });

  test('finds annotations through an id and anchor reference without local pointer guessing', async () => {
    const session = await sessionFor({
      Container: {
        $id: 'schemas/container',
        $defs: {
          Code: { $anchor: 'code', type: 'string', examples: ['ABC'], pattern: '^[A-Z]+$' },
        },
        $ref: '#code',
      },
    });

    await expect(
      generateSchemaExample(session, reference('Container'), { direction: 'request' }),
    ).resolves.toMatchObject({
      status: 'value',
      source: 'schema-examples',
      value: 'ABC',
      validation: 'valid',
    });
  });
});

describe('bounded structural candidates', () => {
  test('generates valid objects, arrays and prefixItems candidates', async () => {
    const session = await sessionFor({
      Payload: {
        type: 'object',
        required: ['id', 'tuple'],
        properties: {
          id: { type: 'integer', minimum: 1 },
          tuple: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            prefixItems: [
              { type: 'string', minLength: 2 },
              { type: 'integer', minimum: 5 },
            ],
            items: false,
          },
        },
        unevaluatedProperties: false,
      },
    });

    const value = await expectGeneratedValueIsValid(
      session,
      reference('Payload'),
      await generateSchemaExample(session, reference('Payload'), { direction: 'request' }),
    );
    expect(value).toMatchObject({ id: expect.any(Number), tuple: [expect.any(String), expect.any(Number)] });
  });

  test('searches deterministic combination and conditional branches until evaluation succeeds', async () => {
    const session = await sessionFor({
      Conditional: {
        type: 'object',
        properties: {
          kind: { enum: ['business', 'personal'] },
          taxId: { type: 'string', pattern: '^[0-9]{6}$' },
          nickname: { type: 'string' },
        },
        required: ['kind'],
        if: { properties: { kind: { const: 'business' } }, required: ['kind'] },
        then: { required: ['taxId'] },
        else: { required: ['nickname'] },
        oneOf: [{ properties: { kind: { const: 'business' } } }, { properties: { kind: { const: 'personal' } } }],
        unevaluatedProperties: false,
      },
    });

    await expectGeneratedValueIsValid(
      session,
      reference('Conditional'),
      await generateSchemaExample(session, reference('Conditional'), { direction: 'request' }),
    );
  });

  test('satisfies allOf intersections, contains and unevaluated item constraints', async () => {
    const session = await sessionFor({
      Intersection: {
        type: 'object',
        allOf: [
          {
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'integer', minimum: 1 } },
          },
          {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string', minLength: 1 } },
          },
        ],
        unevaluatedProperties: false,
      },
      Collection: {
        type: 'array',
        minItems: 1,
        contains: {
          type: 'object',
          required: ['kind'],
          properties: { kind: { const: 'marker' } },
          additionalProperties: false,
        },
        minContains: 1,
        unevaluatedItems: false,
      },
    });

    await expectGeneratedValueIsValid(
      session,
      reference('Intersection'),
      await generateSchemaExample(session, reference('Intersection'), { direction: 'response' }),
    );
    const collection = await expectGeneratedValueIsValid(
      session,
      reference('Collection'),
      await generateSchemaExample(session, reference('Collection'), { direction: 'response' }),
    );
    expect(collection).toEqual([{ kind: 'marker' }]);
  });

  test('handles recursive dynamic references without producing infinite structures', async () => {
    const session = await sessionFor({
      Tree: {
        $dynamicAnchor: 'node',
        type: 'object',
        required: ['value'],
        properties: {
          value: { type: 'integer' },
          children: { type: 'array', items: { $dynamicRef: '#node' } },
        },
        additionalProperties: false,
      },
    });

    const value = await expectGeneratedValueIsValid(
      session,
      reference('Tree'),
      await generateSchemaExample(session, reference('Tree'), { direction: 'response' }),
    );
    expect(value).toMatchObject({ value: expect.any(Number) });
  });

  test('treats boolean schemas and unsatisfiable schemas explicitly', async () => {
    const session = await sessionFor({
      Any: true,
      Never: false,
      Impossible: { type: 'string', minLength: 3, maxLength: 1 },
    });

    await expectGeneratedValueIsValid(
      session,
      reference('Any'),
      await generateSchemaExample(session, reference('Any'), { direction: 'request' }),
    );
    await expect(generateSchemaExample(session, reference('Never'), { direction: 'request' })).resolves.toMatchObject({
      status: 'none',
      reason: 'false-schema',
    });
    await expect(
      generateSchemaExample(session, reference('Impossible'), { direction: 'request' }),
    ).resolves.toMatchObject({ status: 'none', reason: 'no-valid-candidate' });
  });

  test('generates request and response values with readOnly/writeOnly fields filtered independently', async () => {
    const session = await sessionFor({
      Message: {
        type: 'object',
        required: ['shared', 'responseId', 'requestSecret'],
        properties: {
          shared: { type: 'string' },
          responseId: { type: 'integer', readOnly: true },
          requestSecret: { type: 'string', writeOnly: true },
        },
        additionalProperties: false,
      },
      StrictDirection: {
        type: 'object',
        required: ['responseId'],
        minProperties: 2,
        properties: {
          responseId: { type: 'integer', readOnly: true },
        },
        additionalProperties: false,
      },
    });

    const requestResult = await generateSchemaExample(session, reference('Message'), { direction: 'request' });
    const responseResult = await generateSchemaExample(session, reference('Message'), { direction: 'response' });
    const requestValue = expectDirectionallyGeneratedValue(requestResult);
    const responseValue = expectDirectionallyGeneratedValue(responseResult);

    // The unchanged JSON Schema still requires both fields; generated values
    // are valid only after applying the corresponding OpenAPI projection.
    await expect(session.evaluate(reference('Message'), requestValue)).resolves.toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ keyword: 'https://json-schema.org/keyword/required' })],
    });
    await expect(session.evaluate(reference('Message'), responseValue)).resolves.toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ keyword: 'https://json-schema.org/keyword/required' })],
    });

    expect(requestValue).toMatchObject({ shared: expect.any(String), requestSecret: expect.any(String) });
    expect(requestValue).not.toHaveProperty('responseId');
    expect(responseValue).toMatchObject({ shared: expect.any(String), responseId: expect.any(Number) });
    expect(responseValue).not.toHaveProperty('requestSecret');
    await expect(
      generateSchemaExample(session, reference('StrictDirection'), { direction: 'request' }),
    ).resolves.toMatchObject({ status: 'none', reason: 'no-valid-candidate' });
  });

  test('evaluates oneOf after projecting directional required properties', async () => {
    const session = await sessionFor({
      DirectionalChoice: {
        type: 'object',
        minProperties: 1,
        properties: {
          responseId: { type: 'string', readOnly: true },
          requestSecret: { type: 'string', writeOnly: true },
        },
        oneOf: [{ required: ['responseId'] }, { required: ['requestSecret'] }],
        additionalProperties: false,
      },
    });

    // Raw evaluation sees exactly one required branch. Direction projection
    // removes the ignored branch requirement, so both branches become valid
    // and oneOf must reject the generated request/response candidate.
    const requestCandidate = { requestSecret: '' };
    await expect(session.evaluate(reference('DirectionalChoice'), requestCandidate)).resolves.toMatchObject({
      valid: true,
    });
    await expect(
      evaluateSchemaDocumentDirectionally(session, reference('DirectionalChoice'), requestCandidate, 'request'),
    ).resolves.toMatchObject({ valid: false });
    await expect(
      generateSchemaExample(session, reference('DirectionalChoice'), { direction: 'request' }),
    ).resolves.toMatchObject({ status: 'none', reason: 'no-valid-candidate' });
    await expect(
      generateSchemaExample(session, reference('DirectionalChoice'), { direction: 'response' }),
    ).resolves.toMatchObject({ status: 'none', reason: 'no-valid-candidate' });
  });

  test('keeps projected component refs, resource ids and anchors resolvable', async () => {
    const session = await sessionFor({
      DirectionalContainer: {
        $id: 'schemas/directional-container',
        $defs: {
          Payload: {
            $anchor: 'not',
            type: 'object',
            required: ['shared', 'responseId', 'requestSecret'],
            properties: {
              shared: { type: 'string' },
              responseId: { type: 'integer', readOnly: true },
              requestSecret: { type: 'string', writeOnly: true },
            },
            additionalProperties: false,
          },
        },
        not: false,
        $ref: '#not',
      },
      DirectionalAlias: { $ref: '#/components/schemas/DirectionalContainer' },
    });

    const requestValue = expectDirectionallyGeneratedValue(
      await generateSchemaExample(session, reference('DirectionalAlias'), { direction: 'request' }),
    );
    const responseValue = expectDirectionallyGeneratedValue(
      await generateSchemaExample(session, reference('DirectionalAlias'), { direction: 'response' }),
    );

    expect(requestValue).toEqual({ shared: '', requestSecret: '' });
    expect(responseValue).toEqual({ shared: '', responseId: 0 });
  });

  test('does not rewrite reference-shaped data inside projected assertions', async () => {
    const session = await sessionFor({
      LiteralReference: {
        type: 'object',
        required: ['payload'],
        properties: {
          payload: { const: { $ref: '#/literal-value' } },
        },
        additionalProperties: false,
      },
    });

    await expect(
      generateSchemaExample(session, reference('LiteralReference'), { direction: 'request' }),
    ).resolves.toMatchObject({
      status: 'value',
      source: 'generated',
      validation: 'valid',
      value: { payload: { $ref: '#/literal-value' } },
    });
  });

  test('combines const, pattern, tuple and directional fields in one valid object', async () => {
    const session = await sessionFor({
      Envelope: {
        type: 'object',
        required: ['kind', 'name'],
        additionalProperties: false,
        properties: {
          kind: { const: 'business' },
          name: { type: 'string', pattern: '^[A-Z]{3}$' },
          secret: { type: 'string', const: 'client-secret', writeOnly: true },
          id: { type: 'string', format: 'uuid', readOnly: true },
          tags: {
            type: 'array',
            minItems: 2,
            prefixItems: [{ const: 'primary' }],
            items: { type: 'string', const: 'secondary' },
          },
        },
      },
    });

    const requestValue = await expectGeneratedValueIsValid(
      session,
      reference('Envelope'),
      await generateSchemaExample(session, reference('Envelope'), { direction: 'request' }),
    );
    expect(requestValue).toEqual({
      kind: 'business',
      name: 'AAA',
      secret: 'client-secret',
      tags: ['primary', 'secondary'],
    });

    const responseValue = await expectGeneratedValueIsValid(
      session,
      reference('Envelope'),
      await generateSchemaExample(session, reference('Envelope'), { direction: 'response' }),
    );
    expect(responseValue).toEqual({
      kind: 'business',
      name: 'AAA',
      id: '00000000-0000-4000-8000-000000000000',
      tags: ['primary', 'secondary'],
    });
  });

  test('cancels pending work and reports a bounded search stop', async () => {
    const session = await sessionFor({
      Value: {
        type: 'object',
        required: ['a'],
        properties: { a: { type: 'string' }, b: { type: 'string' } },
      },
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateSchemaExample(session, reference('Value'), { direction: 'request', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    await expect(
      generateSchemaExample(session, reference('Value'), {
        direction: 'request',
        limits: { maxNodes: 1 },
      }),
    ).resolves.toMatchObject({ status: 'none', reason: 'search-budget-exceeded' });
  });
});
