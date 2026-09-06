import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createSchemaEngine,
  JSON_SCHEMA_2020_12,
  OPENAPI_31_BASE_DIALECT,
  OPENAPI_32_DIALECT,
  type SchemaEngine,
  type SchemaEngineOptions,
} from '../src';

const engines: SchemaEngine[] = [];
const engine = (options?: SchemaEngineOptions): SchemaEngine => {
  const value = createSchemaEngine(options);
  engines.push(value);
  return value;
};
afterEach(() => {
  engines.splice(0).forEach((value) => value.dispose());
  vi.restoreAllMocks();
});

// OAS 3.2.0 §§4.24–4.26: these annotations do not change JSON Schema validity.
const document32 = (openapi = '3.2.0') => ({
  openapi,
  info: { title: 'Schema session contract', version: '1' },
  components: {
    schemas: {
      Value: {
        type: 'object',
        anyOf: [{ required: ['kind'] }, { not: { required: ['kind'] } }],
        discriminator: { propertyName: 'kind', defaultMapping: '#/components/schemas/Value/anyOf/1' },
        xml: { nodeType: 'element' },
      },
    },
  },
});

describe('OpenAPI 3.2 registration isolation', () => {
  test.each(['3.2.0', '3.2.99'])('coexists with 3.1 without changing its public dialect (%s)', async (version) => {
    const value = engine();
    const before = await value.resolve(OPENAPI_31_BASE_DIALECT);
    await value.registerDocument({ $schema: OPENAPI_31_BASE_DIALECT, type: 'integer', minimum: 1 }, 'urn:test:old');
    const document = document32(version);
    const original = structuredClone(document);
    await value.registerDocument(document, 'urn:test:new');
    const reference = 'urn:test:new#/components/schemas/Value';
    await expect(value.evaluate(reference, {})).resolves.toMatchObject({ valid: true });
    await expect(value.evaluate(reference, 'wrong')).resolves.toMatchObject({ valid: false });
    await expect(value.resolve(reference)).resolves.toMatchObject({
      dialectId: OPENAPI_31_BASE_DIALECT,
      schema: { discriminator: document.components.schemas.Value.discriminator, xml: { nodeType: 'element' } },
    });
    await expect(value.evaluate('urn:test:old', 1)).resolves.toMatchObject({ valid: true });
    await expect(value.evaluate('urn:test:old', 0)).resolves.toMatchObject({ valid: false });
    expect(await value.resolve(OPENAPI_31_BASE_DIALECT)).toEqual(before);
    expect(document).toEqual(original);
    await expect(engine().registerDocument(document32(), 'urn:test:other')).rejects.toMatchObject({
      code: 'ENGINE_SCOPE_CONFLICT',
    });
  });

  test('keeps 3.2 meta-validation failures stable across pointers until revoke and corrected registration', async () => {
    const value = engine();
    const document = document32();
    const invalid = structuredClone(document) as unknown as Record<string, unknown>;
    (invalid.components as typeof document.components).schemas.Value.xml.nodeType = 'invalid';
    await value.registerDocument({ $schema: OPENAPI_31_BASE_DIALECT, type: 'integer' }, 'urn:test:old');
    await value.registerDocument(invalid, 'urn:test:new');
    for (const pointer of [
      '/components/schemas/Value',
      '/components/schemas/Value/anyOf/0',
      '/components/schemas/Value',
    ]) {
      await expect(value.evaluate(`urn:test:new#${pointer}`, {})).rejects.toMatchObject({
        code: 'SCHEMA_RESOLUTION_FAILED',
      });
    }
    await expect(value.evaluate('urn:test:old', 1)).resolves.toMatchObject({ valid: true });
    value.unregisterDocument('urn:test:new');
    await expect(value.resolve('urn:test:new#/components/schemas/Value')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_REGISTERED',
    });
    await value.registerDocument(document, 'urn:test:new');
    await expect(value.evaluate('urn:test:new#/components/schemas/Value', {})).resolves.toMatchObject({ valid: true });
  });

  test('keeps reserved encodings and rootless identities distinct in actual registry lookups', async () => {
    const value = engine();
    await value.registerDocument(
      {
        ...document32(),
        $self: 'https://api.example/root/spec.json#identity',
        components: {
          schemas: {
            Encoded: { $id: 'a%3Ab?x=%26', const: 'encoded' },
            Literal: { $id: './a:b?x=&', const: 'literal' },
            Percent: { $id: 'a%253Ab', const: 'percent' },
            Rootless: { $id: 'urn:a/../b', const: 'rootless' },
            Ref: { $ref: 'a%3Ab?x=%26' },
          },
        },
      },
      'https://download.example/spec.json',
    );
    for (const [reference, good, bad] of [
      ['https://api.example/root/a%3Ab?x=%26', 'encoded', 'literal'],
      ['https://api.example/root/a:b?x=&', 'literal', 'encoded'],
      ['https://api.example/root/a%253Ab', 'percent', 'encoded'],
      ['urn:/b', 'rootless', 'encoded'],
      ['https://download.example/spec.json#/components/schemas/Ref', 'encoded', 'literal'],
    ]) {
      await expect(value.evaluate(reference, good)).resolves.toMatchObject({ valid: true });
      await expect(value.evaluate(reference, bad)).resolves.toMatchObject({ valid: false });
      expect(JSON.stringify(await value.resolve(reference))).not.toContain('knife4j-internal');
    }
  });
});

// Fixtures follow OAS 3.2.0 Schema/Media Type/Encoding/Path Item Objects and
// JSON Schema 2020-12 Core §§8.2, 8.3, Appendix A. The invalid values below
// exercise rejection, never acceptance aliases for non-conforming input.
describe('OpenAPI 3.2 real Schema positions and public identity', () => {
  test.each([undefined, OPENAPI_31_BASE_DIALECT, OPENAPI_32_DIALECT, JSON_SCHEMA_2020_12])(
    'preserves the effective public dialect %s and per-position overrides',
    async (dialect) => {
      const value = engine();
      const document = {
        ...document32(),
        ...(dialect ? { jsonSchemaDialect: dialect } : {}),
        components: {
          schemas: {
            Default: { type: 'integer', xml: { nodeType: 'text' } },
            Override: { $schema: JSON_SCHEMA_2020_12, const: 'override', xml: { arbitrary: true } },
            Dated: { $schema: OPENAPI_32_DIALECT, type: 'string', xml: { nodeType: 'cdata' } },
            Boolean: false,
          },
        },
      };
      const before = structuredClone(document);
      await value.registerDocument(document, 'urn:test:dialects');
      for (const [name, expected] of [
        ['Default', dialect ?? OPENAPI_31_BASE_DIALECT],
        ['Override', JSON_SCHEMA_2020_12],
        ['Dated', OPENAPI_32_DIALECT],
        ['Boolean', dialect ?? OPENAPI_31_BASE_DIALECT],
      ]) {
        expect((await value.resolve(`urn:test:dialects#/components/schemas/${name}`)).dialectId).toBe(expected);
      }
      await expect(value.evaluate('urn:test:dialects#/components/schemas/Default', 1)).resolves.toMatchObject({
        valid: true,
      });
      await expect(value.evaluate('urn:test:dialects#/components/schemas/Override', 'override')).resolves.toMatchObject(
        { valid: true },
      );
      await expect(value.evaluate('urn:test:dialects#/components/schemas/Dated', 'x')).resolves.toMatchObject({
        valid: true,
      });
      await expect(value.evaluate('urn:test:dialects#/components/schemas/Boolean', null)).resolves.toMatchObject({
        valid: false,
      });
      expect(document).toEqual(before);
    },
  );

  test.each(['document', 'schema'])('refuses an unknown declared dialect at the %s', async (where) => {
    const value = engine();
    const unknown = 'https://example.test/unknown-dialect';
    const document =
      where === 'document'
        ? { ...document32(), jsonSchemaDialect: unknown }
        : { ...document32(), components: { schemas: { Value: { $schema: unknown, type: 'integer' } } } };
    await expect(value.registerDocument(document, 'urn:test:unknown')).rejects.toMatchObject({
      code: 'UNSUPPORTED_DIALECT',
    });
    await value.registerDocument(document32(), 'urn:test:unknown');
    await expect(value.evaluate('urn:test:unknown#/components/schemas/Value', {})).resolves.toMatchObject({
      valid: true,
    });
  });

  test('indexes itemSchema, media maps, query, custom operations and recursive Encoding/Header content only', async () => {
    const value = engine({ limits: { maxReferencesPerDocument: 2, maxResourcesPerDocument: 9 } });
    const opaque = {
      $id: 'urn:test:opaque',
      $schema: 'urn:unknown',
      $ref: 'https://not-granted.test/schema',
      $dynamicAnchor: 'opaque',
    };
    const media = {
      schema: {
        $id: 'urn:test:whole',
        type: 'array',
        minItems: 2,
        items: { type: 'integer' },
        examples: [[1, 2]],
        'x-data': opaque,
        unknownAnnotation: opaque,
      },
      itemSchema: { $id: 'urn:test:item', $anchor: 'item', type: 'integer' },
    };
    // Named multipart parts are object properties. The nested array uses only
    // positional encoding, per OAS 3.2.0 §§4.14.5.1–2 and 4.15.2.
    const multipart = {
      schema: {
        type: 'object',
        properties: { part: { type: 'object', properties: { nested: { type: 'array', items: { type: 'string' } } } } },
      },
      encoding: {
        part: {
          contentType: 'multipart/form-data',
          headers: { 'X-Root': { content: { 'application/json': { schema: { $id: 'urn:test:header', const: 1 } } } } },
          encoding: {
            nested: {
              contentType: 'multipart/mixed',
              headers: { 'X-Nested': { schema: { $id: 'urn:test:nested', const: 2 } } },
              prefixEncoding: [
                {
                  headers: {
                    'X-Prefix': { content: { 'application/json': { schema: { $id: 'urn:test:prefix', const: 3 } } } },
                  },
                },
              ],
              itemEncoding: { headers: { 'X-Item': { schema: { $id: 'urn:test:encoding-item', const: 4 } } } },
            },
          },
        },
      },
    };
    const document = {
      ...document32(),
      paths: {
        '/events': {
          query: {
            parameters: [{ name: 'q', in: 'query', schema: { $id: 'urn:test:query', type: 'string' } }],
            responses: {
              '200': {
                description: 'events',
                content: { 'application/json-seq': { $ref: '#/components/mediaTypes/Event' } },
              },
            },
          },
          additionalOperations: {
            COPY: {
              requestBody: {
                content: {
                  'application/json': { schema: { $id: 'urn:test:copy', const: 'copy' } },
                  'multipart/form-data': { $ref: '#/components/mediaTypes/Multipart' },
                },
              },
            },
          },
        },
        'x-opaque': { query: { requestBody: { content: { 'application/json': { schema: opaque } } } } },
      },
      components: {
        mediaTypes: {
          Event: media,
          Multipart: multipart,
          Reference: {
            $ref: '#/components/mediaTypes/Event',
            summary: 'ignored sibling payload',
            schema: opaque,
            itemSchema: opaque,
          },
          'x-real-map-key': { itemSchema: false },
        },
        examples: { Payload: { value: opaque } },
      },
      'x-payload': opaque,
    };
    const before = structuredClone(document);
    await value.registerDocument(document, 'urn:test:positions');
    for (const [uri, good, bad] of [
      ['urn:test:header', 1, 0],
      ['urn:test:nested', 2, 0],
      ['urn:test:prefix', 3, 0],
      ['urn:test:encoding-item', 4, 0],
      ['urn:test:query', 'q', 0],
      ['urn:test:copy', 'copy', 0],
    ] as const) {
      await expect(value.evaluate(uri, good)).resolves.toMatchObject({ valid: true });
      await expect(value.evaluate(uri, bad)).resolves.toMatchObject({ valid: false });
    }
    await expect(value.evaluate('urn:test:item#item', 1)).resolves.toMatchObject({ valid: true });
    await expect(value.evaluate('urn:test:whole', [1])).resolves.toMatchObject({ valid: false });
    await expect(value.evaluate('urn:test:whole', [1, 2])).resolves.toMatchObject({ valid: true });
    await expect(
      value.evaluate('urn:test:positions#/components/mediaTypes/x-real-map-key/itemSchema', 1),
    ).resolves.toMatchObject({ valid: false });
    await expect(value.resolve('urn:test:opaque')).rejects.toMatchObject({ code: 'RESOURCE_NOT_REGISTERED' });
    await expect(value.resolve('urn:test:positions#/components/mediaTypes/Reference/schema')).rejects.toMatchObject({
      code: 'SCHEMA_RESOLUTION_FAILED',
    });
    expect(document).toEqual(before);
  });

  test('round-trips public pointers with fragment delimiters, percent, Unicode and JSON Pointer escapes', async () => {
    const value = engine();
    const keys = ['a#b% c', '中文', 'a~b/c', 'a:b', 'a%3Ab'];
    await value.registerDocument(
      {
        ...document32(),
        $self: 'https://api.example/spec.json#identity',
        components: {
          schemas: { Value: { properties: Object.fromEntries(keys.map((key) => [key, { const: key }])) } },
        },
      },
      'urn:test:pointer',
    );
    for (const key of keys) {
      const token = encodeURIComponent(key.replace(/~/g, '~0').replace(/\//g, '~1'));
      const uri = `urn:test:pointer#/components/schemas/Value/properties/${token}`;
      const node = await value.resolve(uri);
      expect((await value.resolve(node.canonicalUri)).schema).toEqual({ const: key });
      await expect(value.evaluate(uri, key)).resolves.toMatchObject({ valid: true });
      await expect(value.evaluate(node.canonicalUri, 'wrong')).resolves.toMatchObject({ valid: false });
    }
  });
});

describe('OpenAPI 3.2 registry lifecycle', () => {
  test.each([true, false])(
    'protects the actual registry namespace in both registration orders (3.2 first: %s)',
    async (oas32First) => {
      const value = engine();
      const publicUri = 'urn:test:collision';
      const physicalUri = `urn:knife4j-internal:oas32:resource:${[...new TextEncoder().encode(publicUri)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
      const register32 = () => value.registerDocument(document32(), publicUri);
      const register31 = () =>
        value.registerDocument({ $schema: OPENAPI_31_BASE_DIALECT, const: 'legacy' }, physicalUri);
      const [first, second] = oas32First ? [register32, register31] : [register31, register32];
      await first();
      await expect(second()).rejects.toMatchObject({ code: 'RESOURCE_URI_CONFLICT' });
      const [uri, instance] = oas32First ? [`${publicUri}#/components/schemas/Value`, {}] : [physicalUri, 'legacy'];
      await expect(value.evaluate(uri as string, instance)).resolves.toMatchObject({ valid: true });
      value.unregisterDocument(oas32First ? publicUri : physicalUri);
      await second();
      await expect(
        value.evaluate(oas32First ? physicalUri : `${publicUri}#/components/schemas/Value`, oas32First ? 'legacy' : {}),
      ).resolves.toMatchObject({ valid: true });
    },
  );

  test('binds meta-validation failure to the bad registration and recovers its dependent after replacement', async () => {
    const value = engine();
    const bad = {
      ...document32(),
      components: { schemas: { Value: { $id: 'urn:test:bad-schema', type: 'object', xml: { nodeType: 'invalid' } } } },
    };
    await value.registerDocument(document32(), 'urn:test:healthy');
    await value.registerDocument(bad, 'urn:test:bad');
    await value.registerDocument(
      { ...document32(), components: { schemas: { Value: { $ref: 'urn:test:bad-schema' } } } },
      'urn:test:dependent',
    );
    for (const uri of [
      'urn:test:bad-schema',
      'urn:test:bad#/components/schemas/Value',
      'urn:test:dependent#/components/schemas/Value',
    ]) {
      await expect(value.evaluate(uri, {})).rejects.toMatchObject({
        code: 'SCHEMA_RESOLUTION_FAILED',
        details: { uri: 'urn:test:bad' },
      });
    }
    await expect(value.evaluate('urn:test:healthy#/components/schemas/Value', {})).resolves.toMatchObject({
      valid: true,
    });
    value.unregisterDocument('urn:test:bad');
    await expect(value.evaluate('urn:test:healthy#/components/schemas/Value', {})).resolves.toMatchObject({
      valid: true,
    });
    await expect(value.evaluate('urn:test:dependent#/components/schemas/Value', {})).rejects.toMatchObject({
      code: 'RESOURCE_NOT_REGISTERED',
    });
    await value.registerDocument(
      {
        ...bad,
        components: {
          schemas: { Value: { $id: 'urn:test:bad-schema', type: 'object', xml: { nodeType: 'element' } } },
        },
      },
      'urn:test:bad',
    );
    await expect(value.evaluate('urn:test:dependent#/components/schemas/Value', {})).resolves.toMatchObject({
      valid: true,
    });
  });

  test('leaves usable siblings available while refusing missing references without private diagnostics', async () => {
    const value = engine();
    await value.registerDocument(
      {
        ...document32(),
        components: {
          schemas: {
            Good: { const: 1 },
            Missing: { $ref: 'https://external.test/a%3Ab?x=%26' },
            Opaque: { $ref: '#/components/examples/Payload/value' },
          },
          examples: { Payload: { value: { type: 'integer' } } },
        },
      },
      'urn:test:partial',
    );
    await expect(value.evaluate('urn:test:partial#/components/schemas/Good', 1)).resolves.toMatchObject({
      valid: true,
    });
    const failure = await value
      .evaluate('urn:test:partial#/components/schemas/Missing', 1)
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
      details: { resourceUri: 'https://external.test/a%3Ab?x=%26' },
    });
    expect(JSON.stringify(failure)).not.toContain('knife4j-internal');
    await expect(value.evaluate('urn:test:partial#/components/schemas/Opaque', 1)).rejects.toMatchObject({
      code: 'SCHEMA_RESOLUTION_FAILED',
    });
  });

  test('preserves resource budgets, generation invalidation, concurrency and abort recovery', async () => {
    const value = engine({ limits: { maxResourcesPerDocument: 2 } });
    const oversized = {
      ...document32(),
      components: { schemas: { A: { $id: 'urn:test:a' }, B: { $id: 'urn:test:b' } } },
    };
    await expect(value.registerDocument(oversized, 'urn:test:budget')).rejects.toMatchObject({
      code: 'SCHEMA_BUDGET_EXCEEDED',
    });
    await value.registerDocument(document32(), 'urn:test:budget');
    const controller = new AbortController();
    controller.abort();
    await expect(
      value.evaluate('urn:test:budget#/components/schemas/Value', {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'OPERATION_ABORTED' });
    expect(
      await Promise.all([1, 2, 3].map(() => value.evaluate('urn:test:budget#/components/schemas/Value', {}))),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ valid: true })]));
    const pending = value.evaluate('urn:test:budget#/components/schemas/Value', {});
    value.unregisterDocument('urn:test:budget');
    await expect(pending).rejects.toMatchObject({ code: 'ENGINE_STATE_CHANGED' });
    await value.registerDocument(document32(), 'urn:test:budget');
    await expect(value.evaluate('urn:test:budget#/components/schemas/Value', {})).resolves.toMatchObject({
      valid: true,
    });
  });
});

describe('OAS 3.2 reference scopes and retry budgets', () => {
  test('preserves cross-document embedded dynamic scope and pointer references after revoke/re-register', async () => {
    const value = engine();
    const base = {
      ...document32(),
      components: {
        schemas: {
          Tree: {
            $id: 'https://schemas.example/base%3Atree',
            $dynamicAnchor: 'node',
            type: 'object',
            properties: { child: { $dynamicRef: '#node' } },
          },
        },
      },
    };
    const strict = {
      ...document32(),
      components: {
        schemas: {
          Tree: {
            $id: 'https://schemas.example/strict',
            $dynamicAnchor: 'node',
            $ref: 'https://schemas.example/base%3Atree',
            required: ['name'],
            properties: { name: { type: 'string' } },
          },
        },
      },
    };
    await value.registerDocument(strict, 'urn:test:strict-document');
    await value.registerDocument(base, 'urn:test:base-document');
    await value.registerDocument(
      {
        ...document32(),
        components: {
          schemas: { Child: { $ref: 'urn:test:base-document#/components/schemas/Tree/properties/child' } },
        },
      },
      'urn:test:pointer-document',
    );
    await expect(
      value.evaluate('https://schemas.example/strict', { name: 'root', child: { name: 'leaf' } }),
    ).resolves.toMatchObject({ valid: true });
    await expect(value.evaluate('https://schemas.example/strict', { name: 'root', child: {} })).resolves.toMatchObject({
      valid: false,
    });
    await expect(value.evaluate('https://schemas.example/base%3Atree', { child: {} })).resolves.toMatchObject({
      valid: true,
    });
    await expect(
      value.evaluate('urn:test:pointer-document#/components/schemas/Child', { child: {} }),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      value.evaluate('urn:test:pointer-document#/components/schemas/Child', { child: 1 }),
    ).resolves.toMatchObject({ valid: false });
    const publicNode = await value.resolve('https://schemas.example/base%3Atree#node');
    expect((await value.resolve(publicNode.canonicalUri)).schema).toEqual(publicNode.schema);
    expect(JSON.stringify(publicNode)).not.toContain('knife4j-internal');
    value.unregisterDocument('urn:test:base-document');
    await expect(value.evaluate('https://schemas.example/strict', { name: 'root' })).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
    });
    await value.registerDocument(base, 'urn:test:base-document');
    await expect(value.evaluate('https://schemas.example/strict', { name: 'root', child: {} })).resolves.toMatchObject({
      valid: false,
    });
  });

  test('does not permanently cache a time budget or mid-flight abort as a meta-schema failure', async () => {
    const value = engine();
    await value.registerDocument(document32(), 'urn:test:recover');
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const budgeted = value.evaluate('urn:test:recover#/components/schemas/Value', {});
    now.mockReturnValue(2000);
    await expect(budgeted).rejects.toMatchObject({ code: 'EVALUATION_BUDGET_EXCEEDED' });
    now.mockRestore();
    const controller = new AbortController();
    const aborted = value.evaluate('urn:test:recover#/components/schemas/Value', {}, { signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: 'OPERATION_ABORTED' });
    await expect(value.evaluate('urn:test:recover#/components/schemas/Value', {})).resolves.toMatchObject({
      valid: true,
    });
  });
});

test('keeps the registered public Schema snapshot independent from caller mutation', async () => {
  const value = engine();
  const document = document32();
  await value.registerDocument(document, 'urn:test:snapshot');
  document.components.schemas.Value.type = 'string';
  await expect(value.resolve('urn:test:snapshot#/components/schemas/Value')).resolves.toMatchObject({
    schema: { type: 'object' },
  });
  await expect(value.evaluate('urn:test:snapshot#/components/schemas/Value', {})).resolves.toMatchObject({
    valid: true,
  });
});

// PR #788 F1–F4: public identities/results and operation-local cancellation.
describe('OAS 3.2 review regressions', () => {
  test.each([false, true])(
    'never retries a missing encoded URI through the legacy resolver (invalid: %s)',
    async (invalid) => {
      const value = engine();
      const literal = 'https://schemas.example/a:b?x=&';
      const encoded = 'https://schemas.example/a%3Ab?x=%26';
      await value.registerDocument(
        {
          ...document32(),
          components: {
            schemas: { Value: { $id: literal, type: 'object', ...(invalid ? { xml: { nodeType: 'invalid' } } : {}) } },
          },
        },
        'urn:test:strict-lookup',
      );
      if (invalid)
        await expect(value.evaluate(literal, {})).rejects.toMatchObject({ code: 'SCHEMA_RESOLUTION_FAILED' });
      for (const operation of [
        () => value.resolve(encoded),
        ...[0, 1, 2].map(() => () => value.evaluate(encoded, {})),
      ]) {
        const result = await operation().then(
          () => null,
          (error: unknown) => error,
        );
        expect(result).toMatchObject({
          code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
          details: { uri: encoded, resourceUri: encoded },
        });
        expect(JSON.stringify(result)).not.toContain('knife4j-internal');
      }
      if (invalid)
        await expect(value.evaluate(literal, {})).rejects.toMatchObject({ code: 'SCHEMA_RESOLUTION_FAILED' });
      else await expect(value.evaluate(literal, {})).resolves.toMatchObject({ valid: true });
      // Legacy lookup keeps its own prior URI behavior when its resource owns the URI.
      await value.registerDocument(
        { $schema: OPENAPI_31_BASE_DIALECT, type: 'integer' },
        'https://legacy.example/a:b?x=&',
      );
      await expect(value.evaluate('https://legacy.example/a%3Ab?x=%26', 1)).resolves.toMatchObject({ valid: true });
    },
  );

  test('does not route a missing 3.2 pointer into a different legacy resource', async () => {
    const value = engine();
    const encoded = 'https://schemas.example/a%3Ab?x=%26';
    const literal = 'https://schemas.example/a:b?x=&';
    await value.registerDocument(document32(), encoded);
    await value.registerDocument(
      {
        openapi: '3.1.1',
        info: { title: 'Legacy', version: '1' },
        paths: {},
        components: { schemas: { Extra: { type: 'integer' } } },
      },
      literal,
    );
    const missing = `${encoded}#/components/schemas/Extra`;
    await expect(value.resolve(missing)).rejects.toMatchObject({
      code: 'SCHEMA_RESOLUTION_FAILED',
      details: { uri: missing },
    });
    await expect(value.evaluate(missing, 1)).rejects.toMatchObject({
      code: 'SCHEMA_RESOLUTION_FAILED',
      details: { uri: missing },
    });
    await expect(value.evaluate(`${literal}#/components/schemas/Extra`, 1)).resolves.toMatchObject({ valid: true });
    await expect(value.evaluate(`${encoded}#/components/schemas/Value`, {})).resolves.toMatchObject({ valid: true });
  });

  test('does not revoke a 3.2 owner through an unregistered legacy-normalized retrieval alias', async () => {
    const value = engine();
    await value.registerDocument(document32(), 'https://schemas.example/a:b?x=&');
    value.unregisterDocument('https://schemas.example/a%3Ab?x=%26');
    await expect(
      value.evaluate('https://schemas.example/a:b?x=&#/components/schemas/Value', {}),
    ).resolves.toMatchObject({ valid: true });
  });

  test('restores annotations from their real keyword source and preserves opaque author values', async () => {
    const value = engine();
    const opaque = { $schema: 'urn:knife4j-internal:oas32:schema:1', $ref: 'urn:opaque', data: { $id: 'urn:opaque' } };
    const contentSchema = {
      $id: 'https://schemas.example/content',
      type: 'object',
      properties: { n: { $ref: 'https://schemas.example/integer' } },
      'x-original': opaque,
    };
    const document = {
      ...document32(),
      components: {
        schemas: {
          Text: {
            $schema: OPENAPI_32_DIALECT,
            type: 'string',
            contentMediaType: 'application/json',
            contentSchema,
            'x-original': opaque,
            unknownAnnotation: opaque,
          },
          Number: { $id: 'https://schemas.example/integer', type: 'integer' },
          Plain: { type: 'integer' },
        },
      },
    };
    await value.registerDocument(document, 'urn:test:annotations');
    const result = await value.evaluate('urn:test:annotations#/components/schemas/Text', '{"n":1}');
    expect(result.valid).toBe(true);
    const values = (keyword: string) =>
      result.annotations.find((annotation) => annotation.keywordId === keyword)?.values;
    expect(values('https://json-schema.org/keyword/contentSchema')).toEqual([contentSchema]);
    expect(values('https://json-schema.org/keyword/unknown#$schema')).toEqual([OPENAPI_32_DIALECT]);
    expect(values('https://json-schema.org/keyword/unknown#x-original')).toEqual([opaque]);
    expect(values('https://json-schema.org/keyword/unknown#unknownAnnotation')).toEqual([opaque]);
    const plain = await value.evaluate('urn:test:annotations#/components/schemas/Plain', 1);
    expect(plain.annotations).toEqual([]);
  });

  test('returns URI-encoded keyword locations and decoded string instance pointers for special property names', async () => {
    const value = engine();
    const keys = ['a#b% c', 'literal%20', 'literal space', 'a~b/c', '汉字', '%2F', '/'];
    const properties = Object.fromEntries(keys.map((key) => [key, { type: 'integer', title: key }]));
    await value.registerDocument(
      { ...document32(), components: { schemas: { Value: { type: 'object', properties } } } },
      'urn:test:public-locations',
    );
    const invalid = await value.evaluate(
      'urn:test:public-locations#/components/schemas/Value',
      Object.fromEntries(keys.map((key) => [key, 'bad'])),
    );
    expect(invalid.valid).toBe(false);
    for (const key of keys) {
      const token = key.replace(/~/g, '~0').replace(/\//g, '~1');
      const pointer = `/components/schemas/Value/properties/${token}`;
      expect(invalid.errors).toContainEqual(
        expect.objectContaining({
          absoluteKeywordLocation: `urn:test:public-locations#${encodeURIComponent(`${pointer}/type`).replace(/%2F/g, '/')}`,
          instanceLocation: `/${token}`,
        }),
      );
    }
    const valid = await value.evaluate(
      'urn:test:public-locations#/components/schemas/Value',
      Object.fromEntries(keys.map((key) => [key, 1])),
    );
    for (const key of keys)
      expect(valid.annotations).toContainEqual({
        instanceLocation: `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
        keywordId: 'https://json-schema.org/keyword/title',
        values: [key],
      });
  });

  test('keeps cancellation local when concurrent calls begin uncached meta-validation', async () => {
    const value = engine();
    await value.registerDocument(
      { ...document32(), components: { schemas: { Value: { type: 'integer' } } } },
      'urn:test:independent-cancel',
    );
    const controller = new AbortController();
    const cancelled = value.evaluate('urn:test:independent-cancel#/components/schemas/Value', 1, {
      signal: controller.signal,
    });
    const unaffected = value.evaluate('urn:test:independent-cancel#/components/schemas/Value', 1);
    controller.abort();
    const [first, second] = await Promise.allSettled([cancelled, unaffected]);
    expect(first).toMatchObject({ status: 'rejected', reason: { code: 'OPERATION_ABORTED' } });
    expect(second).toMatchObject({ status: 'fulfilled', value: { valid: true, annotations: [] } });
    await expect(value.evaluate('urn:test:independent-cancel#/components/schemas/Value', 1)).resolves.toMatchObject({
      valid: true,
    });
  });
});
