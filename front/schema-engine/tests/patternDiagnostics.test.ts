import { afterEach, expect, test, vi } from 'vitest';
import { getKeyword } from '@hyperjump/json-schema/experimental';
import { createSchemaEngine, SchemaEngineError } from '../src';

const engine = createSchemaEngine();
const uri = 'https://example.test/openapi.json';
afterEach(() => {
  engine.unregisterDocument(uri);
  vi.restoreAllMocks();
});

test('locates the actual failing pattern without poisoning a valid sibling', async () => {
  const pattern = '^[\\p{IsHan}A-Za-z0-9]+$';
  await engine.registerDocument(
    {
      openapi: '3.1.0',
      info: { title: 'Issue 991', version: '1' },
      paths: {},
      components: {
        schemas: {
          Role: { type: 'object', properties: { roleName: { type: 'string', pattern } } },
          User: { type: 'string', pattern: '^\\w+$' },
        },
      },
    },
    uri,
  );
  const error = await engine.evaluate(`${uri}#/components/schemas/Role`, { roleName: '角色' }).catch((e) => e);
  expect(error).toBeInstanceOf(SchemaEngineError);
  expect(error).toMatchObject({
    code: 'SCHEMA_RESOLUTION_FAILED',
    details: {
      regexIssues: [{ documentUri: uri, pointer: '#/components/schemas/Role/properties/roleName/pattern', pattern }],
    },
  });
  expect(error.cause).toBeUndefined();
  await expect(engine.evaluate(`${uri}#/components/schemas/User`, 'alice')).resolves.toMatchObject({ valid: true });
});

test('maps nested resource IDs and escaped pointer tokens to the retrieval document', async () => {
  const pattern = '[';
  await engine.registerDocument(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://logical.test/root',
      $ref: '#/$defs/Role',
      $defs: {
        Role: { $id: 'nested', type: 'object', properties: { '名/%~': { type: 'string', pattern } } },
      },
    },
    uri,
  );
  await expect(engine.evaluate(uri, { '名/%~': 'a' })).rejects.toMatchObject({
    code: 'SCHEMA_RESOLUTION_FAILED',
    details: {
      regexIssues: [{ documentUri: uri, pointer: '#/$defs/Role/properties/名~1%~0/pattern', pattern }],
    },
  });
});

test('does not treat non-pattern schema errors or opaque example values as regex failures', async () => {
  await engine.registerDocument(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'string',
      pattern: '^a+$',
      examples: [{ pattern: '[', properties: { pattern: { pattern: '[' } } }],
    },
    uri,
  );
  await expect(engine.evaluate(uri, 'aaa')).resolves.toMatchObject({ valid: true });
  await expect(engine.evaluate(uri, 'b')).resolves.toMatchObject({ valid: false });
  engine.unregisterDocument(uri);
  await engine.registerDocument({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'file' }, uri);
  const error = await engine.evaluate(uri, 'a').catch((e) => e);
  expect(error.code).toBe('SCHEMA_RESOLUTION_FAILED');
  expect(error.details.regexIssues).toBeUndefined();
});

test('does not classify a SyntaxError from another keyword as a pattern failure', async () => {
  await engine.registerDocument({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' }, uri);
  vi.spyOn(getKeyword('https://json-schema.org/keyword/type'), 'compile').mockRejectedValueOnce(
    new SyntaxError('unrelated'),
  );
  const error = await engine.evaluate(uri, 'a').catch((e) => e);
  expect(error.code).toBe('SCHEMA_RESOLUTION_FAILED');
  expect(error.details.regexIssues).toBeUndefined();
});
