import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SwaggerDoc } from '../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import { componentSchemaReference, createSchemaDisplayProjector } from './schemaDisplayProjection';

const retrievalUri = 'https://docs.knife4j.example/v3/api-docs';
const sessions: SchemaDocumentSession[] = [];

function openApiDocument(schemas: Record<string, unknown>): SwaggerDoc {
  return {
    openapi: '3.1.1',
    info: { title: 'Schema projection fixture', version: '1.0.0' },
    paths: {},
    components: { schemas },
  } as SwaggerDoc;
}

async function projectorFor(schemas: Record<string, unknown>, options: { maxDepth?: number } = {}) {
  const session = await createSchemaDocumentSession(openApiDocument(schemas), retrievalUri);
  sessions.push(session);
  return createSchemaDisplayProjector(session, options);
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
});

describe('componentSchemaReference', () => {
  test('escapes JSON Pointer tokens in component names', () => {
    expect(componentSchemaReference('Folder/Node~v1')).toBe('#/components/schemas/Folder~1Node~0v1');
  });
});

describe('SchemaDisplayProjector', () => {
  test('resolves local pointers, anchors, embedded resources, and $defs through the document session', async () => {
    const projector = await projectorFor({
      Catalog: {
        type: 'object',
        required: ['local'],
        $defs: {
          Code: { $anchor: 'code', type: 'string', pattern: '^[A-Z]+$' },
          Embedded: {
            $id: 'embedded/',
            type: 'object',
            properties: { id: { type: 'integer', minimum: 1 } },
          },
        },
        properties: {
          local: { $ref: '#/components/schemas/Catalog/$defs/Code' },
          anchored: { $ref: '#code' },
          embedded: { $ref: 'embedded/' },
        },
      },
    });

    const result = await projector.project(componentSchemaReference('Catalog'));

    expect(result.diagnostics).toEqual([]);
    expect(result.fields).toEqual([
      expect.objectContaining({
        name: 'local',
        type: 'string',
        refName: 'Code',
        pattern: '^[A-Z]+$',
        required: true,
      }),
      expect.objectContaining({ name: 'anchored', type: 'string', pattern: '^[A-Z]+$', required: false }),
      expect.objectContaining({
        name: 'embedded',
        type: 'object',
        children: [expect.objectContaining({ name: 'id', type: 'integer', minimum: 1 })],
      }),
    ]);
  });

  test('projects an inline schema with the document retrieval URI as its initial base', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not be called'));
    const inlineSchema = {
      type: 'object',
      $defs: {
        Code: { $anchor: 'inline-code', type: 'string', pattern: '^[A-Z]+$' },
        Embedded: {
          $id: 'inline-resource/',
          type: 'object',
          properties: { id: { type: 'integer', minimum: 1 } },
        },
      },
      properties: {
        code: { $ref: '#inline-code' },
        embedded: { $ref: 'inline-resource/' },
        denied: false,
      },
    };
    const projector = await projectorFor({ Container: inlineSchema });

    const result = await projector.projectValue(inlineSchema);

    expect(result.diagnostics).toEqual([]);
    expect(result.fields).toEqual([
      expect.objectContaining({ name: 'code', type: 'string', pattern: '^[A-Z]+$' }),
      expect.objectContaining({
        name: 'embedded',
        type: 'object',
        children: [expect.objectContaining({ name: 'id', type: 'integer', minimum: 1 })],
      }),
      expect.objectContaining({ name: 'denied', type: 'never', booleanSchema: false }),
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('honors cancellation before projecting an inline schema', async () => {
    const projector = await projectorFor({ Value: { type: 'string' } });
    const controller = new AbortController();
    controller.abort();

    await expect(projector.projectValue({ type: 'string' }, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  test('keeps compositions, tuple positions, and boolean schemas visible without selecting a branch', async () => {
    const projector = await projectorFor({
      Model: {
        allOf: [
          { type: 'object', properties: { id: { type: 'integer' } } },
          {
            oneOf: [
              { type: 'object', properties: { cat: { const: true } } },
              { type: 'object', properties: { dog: { const: true } } },
            ],
          },
        ],
        properties: {
          tuple: {
            type: 'array',
            prefixItems: [false, { type: ['string', 'null'], contentMediaType: 'text/plain' }],
            items: true,
          },
          denied: false,
        },
      },
    });

    const result = await projector.project(componentSchemaReference('Model'));
    const tuple = result.fields.find((field) => field.name === 'tuple');
    const denied = result.fields.find((field) => field.name === 'denied');

    expect(result.fields.map((field) => field.name)).toEqual(['tuple', 'denied', 'allOf[1]', 'allOf[2]']);
    expect(tuple).toMatchObject({
      type: 'array',
      children: [
        expect.objectContaining({ name: '[0]', type: 'never', booleanSchema: false }),
        expect.objectContaining({
          name: '[1]',
          type: 'string',
          types: ['string', 'null'],
          contentMediaType: 'text/plain',
        }),
        expect.objectContaining({ name: 'items', type: 'unknown', booleanSchema: true }),
      ],
    });
    expect(denied).toMatchObject({ type: 'never', booleanSchema: false });
    expect(result.fields[2]).toMatchObject({ name: 'allOf[1]', children: [expect.objectContaining({ name: 'id' })] });
    expect(result.fields[3]).toMatchObject({
      name: 'allOf[2]',
      children: [
        expect.objectContaining({ name: 'oneOf[1]', children: [expect.objectContaining({ name: 'cat' })] }),
        expect.objectContaining({ name: 'oneOf[2]', children: [expect.objectContaining({ name: 'dog' })] }),
      ],
    });
  });

  test('preserves supported annotations and constraints on resolved fields', async () => {
    const projector = await projectorFor({
      Value: {
        type: 'string',
        title: 'Shared value',
        description: 'Shared description',
        minLength: 2,
        maxLength: 8,
        pattern: '^[a-z]+$',
        enum: ['ok', 'ready'],
      },
      Container: {
        type: 'object',
        properties: {
          value: {
            $ref: '#/components/schemas/Value',
            description: 'Field description',
            default: 'ok',
            examples: ['ready'],
            readOnly: true,
            deprecated: true,
          },
          conditionalValue: {
            $ref: '#/components/schemas/Value',
            if: { const: 'ok' },
          },
        },
      },
    });

    const result = await projector.project(componentSchemaReference('Container'));

    expect(result.fields[0]).toMatchObject({
      name: 'value',
      type: 'string',
      refName: 'Value',
      description: 'Field description',
      refDescription: 'Shared description',
      refTitle: 'Shared value',
      default: 'ok',
      example: 'ready',
      minLength: 2,
      maxLength: 8,
      pattern: '^[a-z]+$',
      enum: ['ok', 'ready'],
      readOnly: true,
      deprecated: true,
    });
    expect(result.fields[1]).toMatchObject({
      name: 'conditionalValue',
      type: 'string',
      refName: 'Value',
      truncated: true,
    });
    expect(result.diagnostics.filter(({ keyword }) => keyword === 'if')).toHaveLength(1);
  });

  test('marks cycles and depth limits as truncated instead of recursing forever', async () => {
    const projector = await projectorFor({
      Tree: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          child: { $ref: '#/components/schemas/Tree' },
        },
      },
      Deep: {
        type: 'object',
        properties: { level1: { type: 'object', properties: { level2: { type: 'string' } } } },
      },
    });

    const result = await projector.project(componentSchemaReference('Tree'));
    const child = result.fields.find((field) => field.name === 'child');

    expect(child).toMatchObject({ type: 'object', refName: 'Tree', truncated: true });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'CIRCULAR_REFERENCE', severity: 'info', keyword: '$ref' }),
    );

    const activeSession = sessions[sessions.length - 1];
    const shallowProjector = createSchemaDisplayProjector(activeSession, { maxDepth: 1 });
    const shallow = await shallowProjector.project(componentSchemaReference('Deep'));
    expect(shallow.fields[0]).toMatchObject({ name: 'level1', truncated: true });
    expect(shallow.diagnostics).toContainEqual(expect.objectContaining({ code: 'MAX_DEPTH', severity: 'info' }));
  });

  test('diagnoses dynamic, conditional, and unavailable external semantics without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not be called'));
    const projector = await projectorFor({
      Model: {
        $dynamicAnchor: 'node',
        type: 'object',
        properties: {
          dynamic: { $dynamicRef: '#node' },
          conditional: {
            type: 'object',
            if: { properties: { kind: { const: 'cat' } } },
            then: { required: ['lives'] },
            else: { required: ['barks'] },
          },
          patterned: { type: 'object', patternProperties: { '^x-': { type: 'string' } } },
          closed: {
            type: 'object',
            properties: { id: { type: 'integer' } },
            additionalProperties: false,
          },
          external: { $ref: 'https://schemas.knife4j.example/external' },
        },
      },
    });

    const result = await projector.project(componentSchemaReference('Model'));
    const keywords = result.diagnostics.map((diagnostic) => diagnostic.keyword);

    expect(keywords).toEqual(
      expect.arrayContaining([
        '$dynamicRef',
        'if',
        'then',
        'else',
        'patternProperties',
        'additionalProperties',
        '$ref',
      ]),
    );
    expect(result.fields.find((field) => field.name === 'dynamic')).toMatchObject({ truncated: true });
    expect(result.fields.find((field) => field.name === 'external')).toMatchObject({ truncated: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
