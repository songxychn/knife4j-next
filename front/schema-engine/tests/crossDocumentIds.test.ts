import { afterEach, expect, test, describe } from 'vitest';
import { createSchemaEngine, JSON_SCHEMA_2020_12 as dialect, type SchemaEngine } from '../src';
let engines: SchemaEngine[] = [];
const engine = () => {
  const e = createSchemaEngine();
  engines.push(e);
  return e;
};
afterEach(() => {
  engines.forEach((e) => e.dispose());
  engines = [];
});
const targetUri = 'https://retrieval.test/target';
const rootUri = 'https://retrieval.test/root';
const schema = (fields: object) => ({ $schema: dialect, ...fields });
const evaluatePair = async (e: SchemaEngine, uri: string) => {
  expect((await e.evaluate(uri, 1)).valid).toBe(true);
  expect((await e.evaluate(uri, 'bad')).valid).toBe(false);
};
const cases = [
  ['example:/a/..//b', 'example:/.//b'],
  ['example:/.//b', 'example:/.//b'],
  ['example:/b', 'example:/b'],
  ['urn:test:b', 'urn:test:b'],
  ['https://logical.test/b', 'https://logical.test/b'],
  ['https://logical.test/a/../b', 'https://logical.test/b'],
  ['https://logical.test/caf%C3%A9', 'https://logical.test/café'],
  ['https://logical.test/a%2Fb', 'https://logical.test/a%2Fb'],
];
describe.each([false, true])('registration root first: %s', (reverse) => {
  test.each(cases)('cross reference %s', async (id, ref) => {
    const e = engine();
    const target = schema({ $id: id, type: 'integer' });
    const root = schema({ $ref: ref });
    expect((await e.evaluate(dialect, target)).valid).toBe(true);
    expect((await e.evaluate(dialect, root)).valid).toBe(true);
    if (reverse) {
      await e.registerDocument(root, rootUri);
      await e.registerDocument(target, targetUri);
    } else {
      await e.registerDocument(target, targetUri);
      await e.registerDocument(root, rootUri);
    }
    await evaluatePair(e, rootUri);
  });
});
test('separates percent-encoded slash from literal slash', async () => {
  const e = engine();
  await e.registerDocument(schema({ $id: 'https://logical.test/a%2Fb', type: 'integer' }), targetUri);
  await e.registerDocument(
    schema({ $id: 'https://logical.test/a/b', type: 'string' }),
    'https://retrieval.test/string',
  );
  await e.registerDocument(
    schema({
      type: 'array',
      prefixItems: [{ $ref: 'https://logical.test/a%2Fb' }, { $ref: 'https://logical.test/a/b' }],
    }),
    rootUri,
  );
  expect((await e.evaluate(rootUri, [1, 'x'])).valid).toBe(true);
  expect((await e.evaluate(rootUri, ['x', 1])).valid).toBe(false);
});
test('nested resource preserves relative refs and anchors', async () => {
  const e = engine();
  await e.registerDocument(
    schema({
      $id: 'https://logical.test/base',
      $defs: {
        number: { $id: 'numbers/n', $anchor: 'value', type: 'integer' },
        alias: { $id: 'aliases/a', $ref: '../numbers/n#value' },
      },
    }),
    targetUri,
  );
  await e.registerDocument(schema({ $ref: 'https://logical.test/aliases/a' }), rootUri);
  await evaluatePair(e, rootUri);
});
test('cross reference into OAS 3.1 component declared ID', async () => {
  const e = engine();
  const target = {
    openapi: '3.1.2',
    info: { title: 'IDs', version: '1' },
    components: { schemas: { Value: { $id: 'https://logical.test/component', type: 'integer' } } },
  };
  expect((await e.evaluate('https://spec.openapis.org/oas/3.1/schema', target)).valid).toBe(true);
  await e.registerDocument(target, targetUri);
  await e.registerDocument(schema({ $ref: 'https://logical.test/component' }), rootUri);
  await evaluatePair(e, rootUri);
});
test('dynamic scope crosses retrieval/ID mismatch', async () => {
  const e = engine();
  const tree = 'https://logical.test/tree';
  const strict = 'https://logical.test/strict';
  await e.registerDocument(
    schema({
      $id: tree,
      $dynamicAnchor: 'node',
      type: 'object',
      properties: { data: true, children: { type: 'array', items: { $dynamicRef: '#node' } } },
    }),
    targetUri,
  );
  await e.registerDocument(
    schema({ $id: strict, $dynamicAnchor: 'node', $ref: tree, unevaluatedProperties: false }),
    rootUri,
  );
  expect((await e.evaluate(rootUri, { data: 1, children: [{ data: 2 }] })).valid).toBe(true);
  expect((await e.evaluate(rootUri, { data: 1, children: [{ data: 2, extra: true }] })).valid).toBe(false);
});
test('unload and changed reload invalidate cross-reference compilation', async () => {
  const e = engine();
  const id = 'urn:test:value';
  await e.registerDocument(schema({ $id: id, type: 'integer' }), targetUri);
  await e.registerDocument(schema({ $ref: id }), rootUri);
  await evaluatePair(e, rootUri);
  e.unregisterDocument(targetUri);
  await expect(e.evaluate(rootUri, 1)).rejects.toMatchObject({ code: 'RESOURCE_NOT_REGISTERED' });
  await e.registerDocument(schema({ $id: id, type: 'string' }), targetUri);
  expect((await e.evaluate(rootUri, 1)).valid).toBe(false);
  expect((await e.evaluate(rootUri, 'x')).valid).toBe(true);
});
test('missing resource becomes available only after explicit registration', async () => {
  const e = engine();
  await e.registerDocument(schema({ $ref: 'urn:test:value' }), rootUri);
  await expect(e.evaluate(rootUri, 1)).rejects.toMatchObject({ code: 'RESOURCE_NOT_REGISTERED' });
  await e.registerDocument(schema({ $id: 'urn:test:value', type: 'integer' }), targetUri);
  await evaluatePair(e, rootUri);
});
test('conflict leaves original resource usable', async () => {
  const e = engine();
  const id = 'urn:test:value';
  await e.registerDocument(schema({ $id: id, type: 'integer' }), targetUri);
  await expect(
    e.registerDocument(schema({ $id: id, type: 'string' }), 'https://retrieval.test/conflict'),
  ).rejects.toMatchObject({ code: 'RESOURCE_URI_CONFLICT' });
  await e.registerDocument(schema({ $ref: id }), rootUri);
  await evaluatePair(e, rootUri);
});
test('missing HTTP still never fetches', async () => {
  const e = engine();
  await e.registerDocument(schema({ $ref: 'https://missing.test/schema' }), rootUri);
  await expect(e.evaluate(rootUri, 1)).rejects.toMatchObject({ code: 'EXTERNAL_RESOURCE_LOADING_DISABLED' });
});
test('invalid dependency cannot poison later validation through validated flag', async () => {
  const e = engine();
  const id = 'https://logical.test/invalid';
  await e.registerDocument(schema({ $id: id, minLength: -1 }), targetUri);
  await e.registerDocument(schema({ $ref: id }), rootUri);
  await expect(e.evaluate(rootUri, 'x')).rejects.toMatchObject({ code: 'SCHEMA_RESOLUTION_FAILED' });
  await expect(e.evaluate(id, 'x')).rejects.toMatchObject({ code: 'SCHEMA_RESOLUTION_FAILED' });
  await e.registerDocument(schema({ $ref: id }), 'https://retrieval.test/other');
  await expect(e.evaluate('https://retrieval.test/other', 'x')).rejects.toMatchObject({
    code: 'SCHEMA_RESOLUTION_FAILED',
  });
});
test('correcting only the invalid dependency recovers unchanged referencing document', async () => {
  const e = engine();
  const id = 'https://logical.test/invalid';
  await e.registerDocument(schema({ $id: id, minLength: -1 }), targetUri);
  await e.registerDocument(schema({ $ref: id }), rootUri);
  await expect(e.evaluate(rootUri, 'x')).rejects.toMatchObject({ code: 'SCHEMA_RESOLUTION_FAILED' });
  e.unregisterDocument(targetUri);
  await e.registerDocument(schema({ $id: id, minLength: 2 }), targetUri);
  expect((await e.evaluate(rootUri, 'long')).valid).toBe(true);
  expect((await e.evaluate(rootUri, 'x')).valid).toBe(false);
});
test('concurrent dependent roots and direct evaluation all reject invalid schema', async () => {
  const e = engine();
  const id = 'https://logical.test/invalid';
  await e.registerDocument(schema({ $id: id, minLength: -1 }), targetUri);
  await e.registerDocument(schema({ $ref: id }), rootUri);
  await e.registerDocument(schema({ $ref: id }), 'https://retrieval.test/other');
  const results = await Promise.allSettled([
    e.evaluate(rootUri, 'x'),
    e.evaluate('https://retrieval.test/other', 'x'),
    e.evaluate(id, 'x'),
  ]);
  expect(
    results.every((x) => x.status === 'rejected'),
    JSON.stringify(results),
  ).toBe(true);
  await e.registerDocument(schema({ type: 'integer' }), 'https://retrieval.test/healthy');
  expect((await e.evaluate('https://retrieval.test/healthy', 1)).valid).toBe(true);
});
test.each([0, 2, 5, 10, 20, 50, 100, 200])(
  'stale failure cannot poison corrected reload after %s microtasks',
  async (turns) => {
    const e = engine();
    const id = 'https://logical.test/invalid';
    await e.registerDocument(schema({ $id: id, minLength: -1 }), targetUri);
    await e.registerDocument(schema({ $ref: id }), rootUri);
    const pending = e.evaluate(rootUri, 'x').catch((error) => error);
    for (let i = 0; i < turns; i++) await Promise.resolve();
    e.unregisterDocument(targetUri);
    await e.registerDocument(schema({ $id: id, minLength: 2 }), targetUri);
    await pending;
    expect((await e.evaluate(rootUri, 'long')).valid).toBe(true);
  },
);
test('transitive references cross independently registered documents', async () => {
  const e = engine();
  await e.registerDocument(schema({ $id: 'urn:test:number', type: 'integer' }), targetUri);
  await e.registerDocument(schema({ $id: 'urn:test:alias', $ref: 'urn:test:number' }), 'https://retrieval.test/alias');
  await e.registerDocument(schema({ $ref: 'urn:test:alias' }), rootUri);
  await evaluatePair(e, rootUri);
});
test('unused missing reference does not block a healthy sibling', async () => {
  const e = engine();
  await e.registerDocument(
    schema({ $defs: { bad: { $ref: 'urn:test:missing' }, good: { type: 'integer' } } }),
    targetUri,
  );
  await e.registerDocument(schema({ $ref: targetUri + '#/$defs/good' }), rootUri);
  await evaluatePair(e, rootUri);
});

test('a replaced root cannot populate the new generation with its old compiled validator', async () => {
  const e = engine();
  await e.registerDocument(schema({ type: 'integer' }), rootUri);
  const pending = e.evaluate(rootUri, 1).catch((error: unknown) => error);
  e.unregisterDocument(rootUri);
  await e.registerDocument(schema({ type: 'string' }), rootUri);
  await pending;
  expect((await e.evaluate(rootUri, 'new')).valid).toBe(true);
  expect((await e.evaluate(rootUri, 1)).valid).toBe(false);
});

test.each(['32-to-2020', '2020-to-32'])('preserves the existing mixed-graph boundary: %s', async (direction) => {
  const e = engine();
  const document32 = {
    openapi: '3.2.0',
    info: { title: 'Mixed graph boundary', version: '1' },
    components: { schemas: { Value: { $id: 'https://logical.test/value32', type: 'integer' } } },
  };
  if (direction === '32-to-2020') {
    await e.registerDocument(schema({ $id: 'https://logical.test/value2020', type: 'integer' }), targetUri);
    await e.registerDocument(
      { ...document32, components: { schemas: { Root: { $ref: 'https://logical.test/value2020' } } } },
      rootUri,
    );
    await expect(e.evaluate(rootUri + '#/components/schemas/Root', 1)).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
    });
  } else {
    await e.registerDocument(document32, targetUri);
    await e.registerDocument(schema({ $ref: 'https://logical.test/value32' }), rootUri);
    await expect(e.evaluate(rootUri, 1)).rejects.toMatchObject({ code: 'EXTERNAL_RESOURCE_LOADING_DISABLED' });
  }
});
