import { afterEach, expect, test, vi } from 'vitest';
import type { JsonValue } from 'knife4j-schema-engine';
import type { SwaggerDoc } from '../types/swagger';
import * as sessions from './schemaDocumentSession';
import { generateSchemaExample } from './schemaExampleGeneration';

const active: sessions.SchemaDocumentSession[] = [];
afterEach(() => {
  active.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

const legacyLimits = {
  maxCandidates: 48,
  maxDepth: 8,
  maxNodes: 320,
  maxReferences: 64,
  maxEvaluations: 48,
  maxStringLength: 256,
  maxArrayLength: 16,
};

function intersectedObject(): JsonValue {
  const names = Array.from({ length: 20 }, (_, index) => `field${index}`);
  return {
    type: 'object',
    allOf: [
      {
        type: 'object',
        properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
        required: names,
        additionalProperties: false,
      },
      { type: 'object', properties: { field0: { minLength: 1 } } },
    ],
  };
}

async function fixture(schema: JsonValue, openapi = '3.1.1', extra: Record<string, JsonValue> = {}) {
  const session = await sessions.createSchemaDocumentSession(
    {
      openapi,
      info: { title: 'allOf candidate search', version: '1' },
      paths: {},
      components: { schemas: { Value: schema, ...extra } },
    } as SwaggerDoc,
    'https://examples.knife4j.example/search.json',
  );
  active.push(session);
  return session;
}

test.each(['3.1.1', '3.2.0'])(
  'reaches a complete allOf candidate within the original visit budget (%s)',
  async (openapi) => {
    const session = await fixture(intersectedObject(), openapi);
    const reference = '#/components/schemas/Value';
    const witness = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`field${index}`, index ? '' : 'x']));
    await expect(session.evaluate(reference, witness)).resolves.toMatchObject({ valid: true });
    const evaluate = vi.spyOn(sessions, 'evaluateSchemaDocumentDirectionally');
    for (const direction of ['request', 'response'] as const) {
      evaluate.mockClear();
      const result = await generateSchemaExample(session, reference, { direction, limits: legacyLimits });
      expect(result).toMatchObject({ status: 'value', validation: 'valid', source: 'generated' });
      if (result.status !== 'value') throw new Error(result.reason);
      expect(Object.keys(result.value!)).toHaveLength(20);
      expect(evaluate.mock.calls.length).toBeLessThanOrEqual(5);
      await expect(session.evaluate(reference, result.value)).resolves.toMatchObject({ valid: true });
    }
  },
);

test.each(['3.1.1', '3.2.0'])('offers pattern hints through a referenced intersection member (%s)', async (openapi) => {
  const schema = intersectedObject() as { [key: string]: JsonValue };
  const branches = schema.allOf as JsonValue[];
  branches[1] = { $ref: '#/components/schemas/Constraint' };
  const session = await fixture(schema, openapi, {
    Constraint: {
      $id: 'https://examples.knife4j.example/constraint.json',
      type: 'object',
      properties: { field0: { pattern: '^xy$' } },
    },
  });
  for (const direction of ['request', 'response'] as const) {
    const result = await generateSchemaExample(session, '#/components/schemas/Value', { direction });
    expect(result).toMatchObject({ status: 'value', validation: 'valid', value: { field0: 'xy' } });
    if (result.status !== 'value') throw new Error(result.reason);
    expect(Object.keys(result.value!)).toHaveLength(20);
    await expect(session.evaluate('#/components/schemas/Value', result.value)).resolves.toMatchObject({ valid: true });
  }
});

test('keeps the initial generic candidate without allocating unused string hints', async () => {
  const session = await fixture({ minLength: 1, pattern: '^x$' });
  await expect(
    generateSchemaExample(session, '#/components/schemas/Value', {
      direction: 'request',
      limits: { maxCandidates: 1, maxNodes: 2, maxConstructedNodes: 4 },
    }),
  ).resolves.toMatchObject({ status: 'value', value: {}, validation: 'valid' });
});

test.each([{ minLength: 1000 }, { minLength: 2, maxLength: 1 }, { pattern: '^x$' }])(
  'retains non-string instances of an untyped constraint: %j',
  async (constraint) => {
    const session = await fixture({ ...constraint, allOf: [{ type: 'boolean' }] });
    const result = await generateSchemaExample(session, '#/components/schemas/Value', {
      direction: 'request',
      limits: { maxStringLength: 1 },
    });
    expect(result).toMatchObject({ status: 'value', validation: 'valid' });
    if (result.status !== 'value') throw new Error(result.reason);
    expect(typeof result.value).toBe('boolean');
    await expect(session.evaluate('#/components/schemas/Value', result.value)).resolves.toMatchObject({ valid: true });
  },
);

test.each(['maxCandidates', 'maxEvaluations'] as const)(
  'keeps %s effective while offering string hints',
  async (name) => {
    const session = await fixture(intersectedObject());
    await expect(
      generateSchemaExample(session, '#/components/schemas/Value', {
        direction: 'request',
        limits: { [name]: 1 },
      }),
    ).resolves.toMatchObject({ status: 'none', reason: 'search-budget-exceeded' });
  },
);
