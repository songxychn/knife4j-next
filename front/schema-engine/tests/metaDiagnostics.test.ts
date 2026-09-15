import { afterEach, expect, test } from 'vitest';
import { createSchemaEngine, SchemaEngineError } from '../src';

const engine = createSchemaEngine();
afterEach(() => engine.unregisterDocument('https://example.test/openapi.json'));

test('locates an invalid upload Schema while evaluating a valid sibling example', async () => {
  const document = {
    openapi: '3.2.0',
    info: { title: 'Schema diagnostic fixture', version: '1' },
    paths: {
      '/items': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } } },
                examples: { json: { value: { ids: ['one'] } } },
              },
            },
          },
          responses: { '200': { description: 'OK' } },
        },
      },
      '/upload': {
        post: {
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: { type: 'object', properties: { file: { type: 'file', format: 'binary' } } },
              },
            },
          },
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  };
  await engine.registerDocument(document, 'https://example.test/openapi.json');
  await expect(
    engine.evaluate(
      'https://example.test/openapi.json#/paths/~1items/post/requestBody/content/application~1json/schema',
      {
        ids: ['one'],
      },
    ),
  ).rejects.toMatchObject({
    code: 'SCHEMA_RESOLUTION_FAILED',
    details: {
      schemaIssues: expect.arrayContaining([
        expect.objectContaining({
          documentUri: 'https://example.test/openapi.json',
          pointer: '#/paths/~1upload/post/requestBody/content/multipart~1form-data/schema/properties/file/type',
          keyword: 'type',
        }),
      ]),
    },
  });
});

test('reports component keyword locations with nested IDs, escaped tokens and a public retrieval URI', async () => {
  const uri = 'https://example.test/openapi.json';
  await engine.registerDocument(
    {
      openapi: '3.2.0',
      $self: 'https://logical.test/spec.json',
      info: { title: 'Component diagnostic', version: '1' },
      components: {
        schemas: {
          Good: { type: 'string' },
          'Bad/% 中文~': { $id: 'nested.json', xml: { nodeType: 'invalid' } },
        },
      },
    },
    uri,
  );
  const failure = await engine.evaluate(`${uri}#/components/schemas/Good`, 'ok').catch((error) => error);
  expect(failure).toBeInstanceOf(SchemaEngineError);
  expect(failure.details.schemaIssues).toContainEqual({
    documentUri: uri,
    pointer: '#/components/schemas/Bad~1% 中文~0/xml/nodeType',
    keyword: 'xml',
  });
  expect(JSON.stringify(failure)).not.toMatch(/knife4j-internal|invalid|logical.test/);
  expect(failure.cause).toBeUndefined();
  await expect(engine.evaluate(`${uri}#/components/schemas/Good`, 'again')).rejects.toBe(failure);
  engine.unregisterDocument(uri);
  await engine.registerDocument(
    {
      openapi: '3.2.0',
      info: { title: 'Corrected', version: '1' },
      components: { schemas: { Good: { type: 'string' }, Bad: { xml: { nodeType: 'element' } } } },
    },
    uri,
  );
  await expect(engine.evaluate(`${uri}#/components/schemas/Good`, 'ok')).resolves.toMatchObject({ valid: true });
});

test('bounds and deduplicates diagnostics without returning schema values', async () => {
  const uri = 'https://example.test/openapi.json';
  await engine.registerDocument(
    {
      openapi: '3.2.0',
      info: { title: 'Bounded', version: '1' },
      components: {
        schemas: {
          Bad: {
            properties: Object.fromEntries(
              Array.from({ length: 30 }, (_, index) => [`field${index}`, { type: 'PRIVATE_VALUE' }]),
            ),
          },
        },
      },
    },
    uri,
  );
  const failure = await engine.evaluate(`${uri}#/components/schemas/Bad`, {}).catch((error) => error);
  expect(failure.details.schemaIssues.length).toBeGreaterThan(0);
  expect(failure.details.schemaIssues.length).toBeLessThanOrEqual(10);
  expect(new Set(failure.details.schemaIssues.map((issue: { pointer: string }) => issue.pointer)).size).toBe(
    failure.details.schemaIssues.length,
  );
  expect(JSON.stringify(failure)).not.toContain('PRIVATE_VALUE');
});
