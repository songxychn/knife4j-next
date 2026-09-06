import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import { normalizeUri, resolveUri, toAbsoluteUri } from 'knife4j-schema-engine/uri';
import { describe, expect, test, vi } from 'vitest';
import { sha256Hex } from '../utils/stableJson';
import { ExternalResourceLoader, type ResourceGrant } from './externalResourceGraph';

const retrieval = 'https://docs.example.test/cache/root.json';
const pageUri = 'https://docs.example.test/doc.html';
const document32 = (extra: Record<string, unknown> = {}) => ({
  openapi: '3.2.0',
  info: { title: 'OAS 3.2 resource graph', version: '1' },
  paths: {},
  ...extra,
});
const valid32 = (extra: Record<string, unknown> = {}) => {
  const document = document32(extra);
  expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
  return document;
};
const grant = (loader: ExternalResourceLoader, uri: string): ResourceGrant => ({
  scope: 'generation',
  documentScope: loader.documentScope,
  resourceKey: sha256Hex(uri),
});
const response = (document: unknown) =>
  new Response(JSON.stringify(document), { headers: { 'content-type': 'application/json' } });
const schemaReference = (uri: string) => ({ components: { schemas: { Selected: { $ref: uri } } } });

// Positive fixtures are checked against the pinned, prose-corrected structure helper.
// Negative reference/identity fixtures below intentionally test rejection only.
describe('OAS 3.2 document identity and exact retrieval authorization', () => {
  test.each(['3.2.0', '3.2.1', '3.2.99'])('accepts %s without turning it into 3.1', (version) => {
    const loader = new ExternalResourceLoader(valid32({ openapi: version }), retrieval, { pageUri });
    expect(loader.currentSnapshot().nodes.get(retrieval)).toMatchObject({
      openApiVersion: version,
      documentBaseUri: retrieval,
    });
    expect(loader.currentSnapshot()).toMatchObject({ complete: true, diagnostics: [] });
  });

  test('resolves relative self, schema ids and anchors at their respective bases', () => {
    const base = 'https://docs.example.test/api/openapi.json';
    const schemaBase = 'https://docs.example.test/api/schemas/root';
    const loader = new ExternalResourceLoader(
      valid32({
        $self: '../api/openapi.json',
        components: {
          schemas: {
            Root: {
              $id: 'schemas/root',
              $dynamicAnchor: 'node',
              type: 'object',
              $defs: { Child: { $id: 'child.json', $anchor: 'named', type: 'string' } },
              properties: {
                child: { $ref: 'child.json#named' },
                recursive: { $dynamicRef: '#node' },
                remote: { $ref: 'remote.json' },
              },
            },
          },
        },
      }),
      retrieval,
      { pageUri },
    );
    const snapshot = loader.currentSnapshot();
    expect(snapshot.nodes.get(retrieval)).toMatchObject({
      retrievalUri: retrieval,
      selfUri: base,
      documentBaseUri: base,
    });
    expect(snapshot.documentTargets.get(base)).toMatchObject({ ownerRetrievalUri: retrieval, pointer: '#' });
    expect(snapshot.resourceTargets.get(schemaBase)).toMatchObject({
      ownerRetrievalUri: retrieval,
      pointer: '#/components/schemas/Root',
      evaluationBaseUri: base,
    });
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resolvedUri: 'https://docs.example.test/api/schemas/child.json#named',
          state: 'local',
        }),
        expect.objectContaining({ resolvedUri: `${schemaBase}#node`, state: 'local' }),
      ]),
    );
    expect(loader.currentDiscovery().candidates.map((candidate) => candidate.retrievalUri)).toEqual([
      'https://docs.example.test/api/schemas/remote.json',
    ]);
  });

  test.each(['urn:example:api', 'urn:example:api#entry', 'https://identity.example.test/api#entry'])(
    'keeps non-network identity %s separate from retrieval',
    async (self) => {
      const fetchImpl = vi.fn();
      const loader = new ExternalResourceLoader(
        valid32({
          $self: self,
          components: { schemas: { A: { $ref: '#/components/schemas/B' }, B: { type: 'string' } } },
        }),
        retrieval,
        { pageUri, fetchImpl },
      );
      const snapshot = await loader.load([grant(loader, retrieval), grant(loader, self)]);
      expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
      expect(snapshot.documentTargets.get(self)?.ownerRetrievalUri).toBe(retrieval);
      expect(snapshot.nodes.get(retrieval)?.documentBaseUri).toBe(self.split('#')[0]);
      expect(snapshot.nodes.size).toBe(1);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(loader.currentDiscovery().candidates).toEqual([]);
      expect(Object.isFrozen(snapshot.documentTargets.get(self))).toBe(true);
      expect((snapshot.documentTargets as unknown as { set?: unknown }).set).toBeUndefined();
    },
  );

  test('self does not discover or grant its URI and exact grants follow the resolved reference', async () => {
    const self = 'https://identity.example.test/api/openapi.json';
    const target = 'https://identity.example.test/api/schema.json';
    const fetchImpl = vi.fn(async () => response({ type: 'string' }));
    const inert = new ExternalResourceLoader(valid32({ $self: self }), retrieval, { pageUri, fetchImpl });
    await inert.load([grant(inert, self)]);
    expect(inert.currentDiscovery().candidates).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    const loader = new ExternalResourceLoader(valid32({ $self: self, ...schemaReference('schema.json') }), retrieval, {
      pageUri,
      fetchImpl,
    });
    expect(loader.currentDiscovery().candidates.map((candidate) => candidate.retrievalUri)).toEqual([target]);
    expect(
      (await loader.load([grant(loader, self), grant(loader, 'https://docs.example.test/cache/schema.json')])).complete,
    ).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await loader.continueLoad([grant(loader, target)])).complete).toBe(true);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      target,
      expect.objectContaining({ credentials: 'omit', redirect: 'error' }),
    );
  });

  test('a fully parsed supplied resource satisfies a previously unknown non-HTTP canonical id', async () => {
    const external = 'https://resources.example.test/library.json';
    const canonical = 'urn:example:schemas:pet';
    const fetchImpl = vi.fn(async () =>
      response(valid32({ components: { schemas: { Pet: { $id: canonical, type: 'string' } } } })),
    );
    const loader = new ExternalResourceLoader(
      valid32({
        components: {
          schemas: {
            ViaRetrieval: { $ref: `${external}#/components/schemas/Pet` },
            ViaId: { $ref: canonical },
          },
        },
      }),
      retrieval,
      { pageUri, fetchImpl },
    );
    expect(loader.currentDiscovery().diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'RESOURCE_SCHEME_UNSUPPORTED' })]),
    );
    const snapshot = await loader.load([grant(loader, external)]);
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    expect(snapshot.edges.every((edge) => edge.state === 'loaded')).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('different self fragments do not claim each other or their common base', async () => {
    const a = 'https://resources.example.test/a.json';
    const b = 'https://resources.example.test/b.json';
    const shared = 'https://identity.example.test/shared';
    const make = (fragment: string) =>
      valid32({
        $self: `${shared}#${fragment}`,
        components: {
          responses: { Ok: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Value' } } } } },
          schemas: { Value: { const: fragment } },
        },
      });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => response(make(String(input) === a ? 'one' : 'two')));
    const loader = new ExternalResourceLoader(
      valid32({
        components: {
          responses: {
            A: { $ref: `${a}#/components/responses/Ok` },
            B: { $ref: `${b}#/components/responses/Ok` },
          },
        },
      }),
      retrieval,
      { pageUri, fetchImpl },
    );
    const snapshot = await loader.load([grant(loader, a), grant(loader, b)]);
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    expect(snapshot.documentTargets.get(`${shared}#one`)?.ownerRetrievalUri).toBe(a);
    expect(snapshot.documentTargets.get(`${shared}#two`)?.ownerRetrievalUri).toBe(b);
    expect(snapshot.resourceTargets.has(shared)).toBe(false);
    expect(snapshot.edges.filter((edge) => edge.kind === 'schema-ref').every((edge) => edge.state === 'local')).toBe(
      true,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test.each([
    'self',
    'fragment-self',
    'retrieval-alias',
    'schema-id',
    'schema-anchor',
    'normalized-self',
    'normalized-fragment-self',
    'normalized-retrieval-alias',
    'normalized-schema-id',
    'normalized-schema-anchor',
  ] as const)('rejects conflicting %s identities in either response order', async (conflict) => {
    const a = 'https://resources.example.test/a.json';
    const b = 'https://resources.example.test/b.json';
    const canonical = 'https://identity.example.test/collision';
    const normalized = conflict.startsWith('normalized-');
    const kind = conflict.replace('normalized-', '');
    const alias = (uri: string) =>
      normalized
        ? uri
            .replace('.test/', '.test:443/')
            .replace('/collision', '/%63ollision')
            .replace('/b.json', '/%62.json')
            .replace('#named', '#%6eamed')
        : uri;
    const self =
      kind === 'retrieval-alias'
        ? alias(b)
        : kind === 'fragment-self' || kind === 'schema-anchor'
          ? `${canonical}#named`
          : canonical;
    const first = valid32({ $self: self, components: { schemas: { Value: { type: 'string' } } } });
    const second = valid32({
      ...(kind === 'self' || kind === 'fragment-self' ? { $self: alias(self) } : {}),
      components: {
        schemas: {
          Value: {
            type: 'number',
            ...(kind === 'schema-id'
              ? { $id: alias(canonical) }
              : kind === 'schema-anchor'
                ? { $id: alias(canonical), $anchor: 'named' }
                : {}),
          },
        },
      },
    });
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const releases = new Map<string, () => void>();
      const fetchImpl = vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((resolve) => {
            const uri = String(input);
            releases.set(uri, () => resolve(response(uri === a ? first : second)));
          }),
      );
      const loader = new ExternalResourceLoader(
        valid32({
          components: {
            schemas: {
              A: { $ref: `${a}#/components/schemas/Value` },
              B: { $ref: `${b}#/components/schemas/Value` },
            },
          },
        }),
        retrieval,
        { pageUri, fetchImpl },
      );
      const loading = loader.load([grant(loader, a), grant(loader, b)]);
      await vi.waitFor(() => expect(releases.size).toBe(2));
      releases.get(order[0])!();
      await vi.waitFor(() => expect(loader.currentSnapshot().nodes.has(order[0])).toBe(true));
      releases.get(order[1])!();
      const snapshot = await loading;
      expect(snapshot.nodes.size).toBe(1);
      expect(snapshot.complete).toBe(false);
      expect(snapshot.diagnostics).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'RESOURCE_URI_CONFLICT', phase: 'index' })]),
      );
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });
});

describe('OAS 3.2 typed targets and document versions', () => {
  test.each([
    ['3.2.0', '3.2.99', true],
    ['3.2.99', '3.2.0', true],
    ['3.2.0', '3.1.2', false],
    ['3.2.0', '3.0.4', false],
    ['3.1.2', '3.2.0', false],
    ['3.1.2', '3.1.99', true],
  ] as const)('%s -> %s has explicit support=%s', async (source, target, supported) => {
    const external = 'https://resources.example.test/document.json';
    const loader = new ExternalResourceLoader(
      document32({ openapi: source, ...schemaReference(`${external}#/components/schemas/Value`) }),
      retrieval,
      {
        pageUri,
        fetchImpl: async () => response(document32({ openapi: target, components: { schemas: { Value: {} } } })),
      },
    );
    const snapshot = await loader.load([grant(loader, external)]);
    expect(snapshot.complete).toBe(supported);
    expect(snapshot.diagnostics.map((item) => item.code)).toEqual(
      supported ? [] : [source.startsWith('3.1.') ? 'DOCUMENT_KIND_MISMATCH' : 'OPENAPI_VERSION_UNSUPPORTED'],
    );
  });

  test.each(['3.0.4', '3.3.0', '4.0.0'])('does not open entry support for %s', (openapi) => {
    expect(() => new ExternalResourceLoader(document32({ openapi }), retrieval)).toThrow(
      /supported OpenAPI 3.1.x or 3.2.x/,
    );
  });

  test.each(['local', 'external'] as const)(
    'rejects %s structurally ambiguous and opaque targets without expanding their content',
    async (location) => {
      const external = 'https://resources.example.test/document.json';
      const target = document32({
        components: { schemas: { Empty: {} } },
        'x-data': { content: { 'application/json': { schema: { $ref: 'https://never.example.test/opaque.json' } } } },
      });
      const prefix = location === 'external' ? external : '';
      const entry = document32({
        ...(location === 'local' ? target : {}),
        paths: { '/wrong': { $ref: `${prefix}#/components/schemas/Empty` } },
        components: { schemas: { Empty: {} }, responses: { Wrong: { $ref: `${prefix}#/x-data` } } },
      });
      const fetchImpl = vi.fn(async () => response(target));
      const loader = new ExternalResourceLoader(entry, retrieval, { pageUri, fetchImpl });
      const snapshot = await loader.load([grant(loader, external)]);
      expect(snapshot.complete).toBe(false);
      expect(snapshot.edges.every((edge) => edge.state === 'failed')).toBe(true);
      expect(snapshot.diagnostics.map((item) => item.code)).toEqual([
        'DOCUMENT_KIND_MISMATCH',
        'DOCUMENT_KIND_MISMATCH',
      ]);
      expect(loader.currentDiscovery().candidates).toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(location === 'external' ? 1 : 0);
    },
  );

  test('preserves the old 3.1 ambiguous-object behavior', () => {
    const loader = new ExternalResourceLoader(
      document32({
        openapi: '3.1.2',
        components: { schemas: { Empty: {} } },
        paths: { '/legacy': { $ref: '#/components/schemas/Empty' } },
      }),
      retrieval,
    );
    expect(loader.currentSnapshot()).toMatchObject({ complete: true, diagnostics: [] });
  });

  test('distinguishes unresolved object cycles from recursive schemas', () => {
    const cyclic = new ExternalResourceLoader(
      document32({
        components: {
          mediaTypes: { A: { $ref: '#/components/mediaTypes/B' }, B: { $ref: '#/components/mediaTypes/A' } },
        },
      }),
      retrieval,
    );
    expect(cyclic.currentSnapshot().complete).toBe(false);
    expect(cyclic.currentSnapshot().diagnostics.map((item) => item.code)).toEqual([
      'REFERENCE_CYCLE',
      'REFERENCE_CYCLE',
    ]);
    const recursive = new ExternalResourceLoader(
      valid32({
        components: {
          schemas: { Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } } },
        },
      }),
      retrieval,
    );
    expect(recursive.currentSnapshot()).toMatchObject({ complete: true, diagnostics: [] });
  });

  test('retains a failed edge for an unresolvable URI rather than reporting a complete graph', () => {
    const loader = new ExternalResourceLoader(document32(schemaReference('http://[')), retrieval);
    expect(loader.currentSnapshot()).toMatchObject({
      complete: false,
      diagnostics: [expect.objectContaining({ code: 'RESOURCE_URI_INVALID' })],
    });
  });

  test.each(['https://json-schema.org/draft/2020-12/schema', 'https://spec.openapis.org/oas/3.1/dialect/base'])(
    'keeps standalone schemas in supported dialect %s',
    async ($schema) => {
      const external = 'https://resources.example.test/schema.json';
      const loader = new ExternalResourceLoader(valid32(schemaReference(external)), retrieval, {
        fetchImpl: async () => response({ $schema, type: 'string' }),
      });
      expect(await loader.load([grant(loader, external)])).toMatchObject({ complete: true, diagnostics: [] });
    },
  );

  test.each(['https://dialects.example.test/custom', 'https://spec.openapis.org/oas/3.2/dialect/2025-09-17'])(
    'leaves unsupported dialect %s explicit until the engine package',
    async ($schema) => {
      const external = 'https://resources.example.test/schema.json';
      const loader = new ExternalResourceLoader(valid32(schemaReference(external)), retrieval, {
        fetchImpl: async () => response({ $schema, type: 'string' }),
      });
      expect(await loader.load([grant(loader, external)])).toMatchObject({
        complete: false,
        diagnostics: [expect.objectContaining({ code: 'DIALECT_UNSUPPORTED' })],
      });
    },
  );
});

describe('OAS 3.2 reference positions and reachable closure', () => {
  test('follows Media Type References in every content location and reusable media types', async () => {
    const external = 'https://resources.example.test/library.json';
    const self = 'https://identity.example.test/library/openapi.json';
    const item = 'https://identity.example.test/library/schemas/event.json';
    const media = { $ref: '#/components/mediaTypes/Stream' };
    const loader = new ExternalResourceLoader(
      valid32({
        paths: {
          '/events': {
            query: {
              parameters: [{ name: 'filter', in: 'querystring', content: { 'application/json-seq': media } }],
              requestBody: { content: { 'application/json-seq': media } },
              responses: {
                '200': {
                  content: { 'application/json-seq': media },
                  headers: { 'X-Events': { content: { 'application/json-seq': media } } },
                },
              },
            },
          },
        },
        components: { mediaTypes: { Stream: { $ref: `${external}#/components/mediaTypes/Stream` } } },
      }),
      retrieval,
      {
        pageUri,
        fetchImpl: async (input) =>
          response(
            String(input) === external
              ? valid32({
                  $self: self,
                  components: {
                    mediaTypes: {
                      Stream: { $ref: '#/components/mediaTypes/Records' },
                      Records: {
                        itemSchema: { $ref: 'schemas/event.json' },
                        examples: { Event: { $ref: '#/components/examples/Event' } },
                      },
                      Unused: { itemSchema: { $ref: 'https://never.example.test/unreachable.json' } },
                    },
                    examples: { Event: { dataValue: { id: 1 } } },
                  },
                })
              : { type: 'object', properties: { id: { type: 'integer' } } },
          ),
      },
    );
    const before = loader.currentSnapshot();
    expect(
      before.edges
        .filter((edge) => edge.resolvedUri === `${retrieval}#/components/mediaTypes/Stream`)
        .map((edge) => edge.sourcePointer),
    ).toEqual([
      '#/paths/~1events/query/parameters/0/content/application~1json-seq/$ref',
      '#/paths/~1events/query/requestBody/content/application~1json-seq/$ref',
      '#/paths/~1events/query/responses/200/headers/X-Events/content/application~1json-seq/$ref',
      '#/paths/~1events/query/responses/200/content/application~1json-seq/$ref',
    ]);
    const first = await loader.load([grant(loader, external)]);
    expect(first.complete).toBe(false);
    expect(loader.currentDiscovery().candidates.map((candidate) => candidate.retrievalUri)).toEqual([item]);
    const complete = await loader.continueLoad([grant(loader, item)]);
    expect(complete).toMatchObject({ complete: true, diagnostics: [] });
    expect(complete.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePointer: '#/components/mediaTypes/Records/itemSchema/$ref',
          resolvedUri: item,
        }),
        expect.objectContaining({
          sourcePointer: '#/components/mediaTypes/Records/examples/Event/$ref',
          kind: 'reference-object',
          state: 'local',
        }),
      ]),
    );
    expect(complete.nodes.has('https://never.example.test/unreachable.json')).toBe(false);
  });

  test('walks QUERY and case-sensitive custom operations in paths, webhooks, callbacks and component Path Items', () => {
    const target = 'https://resources.example.test/body.json';
    const operation = { requestBody: { content: { 'application/json': { schema: { $ref: target } } } } };
    const loader = new ExternalResourceLoader(
      valid32({
        paths: {
          '/query': { query: operation },
          '/custom': { additionalOperations: { COPY: operation, Copy: operation, 'x-PING': operation } },
          '/callback': { post: { callbacks: { Changed: { '{$request.body#/callback}': { query: operation } } } } },
        },
        webhooks: { 'x-updated': { query: operation } },
        components: { pathItems: { Shared: { additionalOperations: { SEARCH: operation } } } },
      }),
      retrieval,
      { pageUri },
    );
    const candidate = loader.currentDiscovery().candidates[0];
    expect(candidate.retrievalUri).toBe(target);
    expect(candidate.references).toHaveLength(7);
    expect(candidate.references.map((reference) => reference.sourcePointer)).toEqual(
      expect.arrayContaining([
        '#/paths/~1custom/additionalOperations/COPY/requestBody/content/application~1json/schema/$ref',
        '#/paths/~1custom/additionalOperations/Copy/requestBody/content/application~1json/schema/$ref',
        '#/paths/~1custom/additionalOperations/x-PING/requestBody/content/application~1json/schema/$ref',
        '#/webhooks/x-updated/query/requestBody/content/application~1json/schema/$ref',
        '#/components/pathItems/Shared/additionalOperations/SEARCH/requestBody/content/application~1json/schema/$ref',
      ]),
    );
  });

  test('walks nested encoding maps, prefix and item encodings through Header content references', () => {
    const first = 'https://resources.example.test/first-header.json';
    const nested = 'https://resources.example.test/nested-media.json';
    const item = 'https://resources.example.test/item-schema.json';
    const loader = new ExternalResourceLoader(
      valid32({
        components: {
          mediaTypes: {
            Form: {
              schema: { type: 'object', properties: { field: { type: 'string' } } },
              encoding: { field: { headers: { 'X-Field': { $ref: first } } } },
            },
            Ordered: {
              schema: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
              prefixEncoding: [{ contentType: 'text/plain', headers: { 'X-First': { $ref: first } } }],
              itemEncoding: {
                contentType: 'multipart/mixed',
                itemEncoding: {
                  contentType: 'text/plain',
                  headers: {
                    'X-Context': { content: { 'application/json': { $ref: nested } } },
                    'X-Item': { schema: { $ref: item } },
                  },
                },
              },
            },
          },
        },
      }),
      retrieval,
      { pageUri },
    );
    const candidates = loader.currentDiscovery().candidates;
    expect(candidates.map((candidate) => candidate.retrievalUri)).toEqual([first, item, nested]);
    expect(candidates.find((candidate) => candidate.retrievalUri === first)?.references).toHaveLength(2);
    expect(candidates.find((candidate) => candidate.retrievalUri === nested)?.references[0].sourcePointer).toBe(
      '#/components/mediaTypes/Ordered/itemEncoding/itemEncoding/headers/X-Context/content/application~1json/$ref',
    );
  });

  test('loads an unversioned Media Type root using one explicit target context', async () => {
    const media = 'https://resources.example.test/media.json';
    const schema = 'https://resources.example.test/schema.json';
    const loader = new ExternalResourceLoader(
      valid32({ components: { mediaTypes: { Stream: { $ref: media } } } }),
      retrieval,
      {
        fetchImpl: async (input) =>
          response(String(input) === media ? { itemSchema: { $ref: 'schema.json' } } : { type: 'integer' }),
      },
    );
    const snapshot = await loader.load([grant(loader, media), grant(loader, schema)]);
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    expect(snapshot.nodes.get(media)?.documentKind).toBe('referenceable-object');
    expect(
      snapshot.edges.some((edge) => edge.sourcePointer === '#/itemSchema/$ref' && edge.resolvedUri === schema),
    ).toBe(true);
  });

  test('rejects unversioned root inference conflicts and fragments without a known root context', async () => {
    const external = 'https://resources.example.test/ambiguous.json';
    for (const extra of [
      { components: { schemas: { Schema: { $ref: external } }, mediaTypes: { Media: { $ref: external } } } },
      { components: { mediaTypes: { Media: { $ref: `${external}#/wrapped` } } } },
    ]) {
      const loader = new ExternalResourceLoader(document32(extra), retrieval, {
        fetchImpl: async () => response({ wrapped: {} }),
      });
      const snapshot = await loader.load([grant(loader, external)]);
      expect(snapshot.complete).toBe(false);
      expect(snapshot.nodes.has(external)).toBe(false);
      expect(snapshot.diagnostics.every((diagnostic) => diagnostic.code === 'DOCUMENT_KIND_MISMATCH')).toBe(true);
    }
  });

  test('does not interpret the new locations in the old 3.1 graph', () => {
    const ref = { $ref: 'https://never.example.test/new.json' };
    const loader = new ExternalResourceLoader(
      document32({
        openapi: '3.1.2',
        $self: 'https://never.example.test/self',
        paths: {
          '/events': {
            query: { requestBody: { content: { 'application/json': ref } } },
            additionalOperations: { COPY: { requestBody: { content: { 'application/json': ref } } } },
          },
        },
        components: {
          mediaTypes: { Item: ref },
          schemas: { Old: { type: 'object', discriminator: { propertyName: 'kind', defaultMapping: ref.$ref } } },
        },
        security: [{ [ref.$ref]: [] }],
      }),
      retrieval,
    );
    expect(loader.currentSnapshot()).toMatchObject({ complete: true, diagnostics: [] });
    expect(loader.currentDiscovery().candidates).toEqual([]);
    expect(loader.currentSnapshot().documentTargets.size).toBe(0);
  });
});

describe('OAS 3.2 entry-document names and opaque content', () => {
  test('resolves cross-document Security names from the entry and explicit URIs from the source self', async () => {
    const library = 'https://resources.example.test/library.json';
    const entryScheme = 'https://resources.example.test/entry-scheme.json';
    const explicitScheme = 'https://identity.example.test/library/Bearer';
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      response(
        String(input) === library
          ? valid32({
              $self: 'https://identity.example.test/library/openapi.json',
              paths: { '/secure': { query: { security: [{ Bearer: [] }, { './Bearer': [] }] } } },
              components: { securitySchemes: { Bearer: { type: 'http', scheme: 'basic' } } },
            })
          : { type: 'http', scheme: 'bearer' },
      ),
    );
    const loader = new ExternalResourceLoader(
      valid32({
        paths: { '/secure': { $ref: `${library}#/paths/~1secure` } },
        security: [{ Bearer: [] }],
        components: { securitySchemes: { Bearer: { $ref: entryScheme } } },
      }),
      retrieval,
      { pageUri, fetchImpl },
    );
    const first = await loader.load([grant(loader, library), grant(loader, entryScheme)]);
    expect(first.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRetrievalUri: library,
          sourcePointer: '#/paths/~1secure/query/security/0/Bearer',
          kind: 'security-requirement',
          resolvedUri: `${retrieval}#/components/securitySchemes/Bearer`,
          state: 'loaded',
        }),
      ]),
    );
    expect(loader.currentDiscovery().candidates.map((candidate) => candidate.retrievalUri)).toEqual([explicitScheme]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const complete = await loader.continueLoad([grant(loader, explicitScheme)]);
    expect(complete).toMatchObject({ complete: true, diagnostics: [] });
  });

  test('resolves discriminator names from entry while URI mappings use self rather than schema id', async () => {
    const library = 'https://resources.example.test/library.json';
    const uriTarget = 'https://identity.example.test/library/uri.json';
    const external = valid32({
      $self: 'https://identity.example.test/library/openapi.json',
      components: {
        schemas: {
          Payload: {
            $id: 'nested/payload',
            oneOf: [
              { $ref: `${retrieval}#/components/schemas/Known` },
              { $ref: `${retrieval}#/components/schemas/Other` },
              { $ref: '../uri.json' },
            ],
            discriminator: {
              propertyName: 'kind',
              mapping: { known: 'Known', explicit: './uri.json' },
              defaultMapping: 'Other',
            },
          },
          Known: { const: 'wrong referenced-document name' },
          Other: { const: 'wrong default' },
        },
      },
    });
    const loader = new ExternalResourceLoader(
      valid32({
        components: {
          schemas: {
            Payload: { $ref: `${library}#/components/schemas/Payload` },
            Known: { type: 'object', required: ['kind'], properties: { kind: { const: 'known' } } },
            Other: { type: 'object', properties: { kind: { not: { enum: ['known', 'explicit'] } } } },
          },
        },
      }),
      retrieval,
      {
        pageUri,
        fetchImpl: async (input) =>
          response(
            String(input) === library
              ? external
              : { type: 'object', required: ['kind'], properties: { kind: { const: 'explicit' } } },
          ),
      },
    );
    const snapshot = await loader.load([grant(loader, library)]);
    expect(
      snapshot.edges.filter((edge) => edge.kind === 'discriminator-mapping').map((edge) => edge.resolvedUri),
    ).toEqual([`${retrieval}#/components/schemas/Known`, uriTarget, `${retrieval}#/components/schemas/Other`]);
    expect(loader.currentDiscovery().candidates.map((candidate) => candidate.retrievalUri)).toEqual([uriTarget]);
    expect(await loader.continueLoad([grant(loader, uriTarget)])).toMatchObject({ complete: true, diagnostics: [] });
  });

  test('missing discriminator names do not become network guesses, unlike an explicit Security URI', () => {
    const loader = new ExternalResourceLoader(
      document32({
        components: {
          schemas: {
            Payload: { oneOf: [true], discriminator: { propertyName: 'kind', defaultMapping: 'Missing' } },
          },
        },
        security: [{ Missing: [] }],
      }),
      retrieval,
    );
    expect(loader.currentSnapshot().complete).toBe(false);
    expect(loader.currentSnapshot().diagnostics.map((item) => item.code)).toEqual(['FRAGMENT_NOT_FOUND']);
    expect(loader.currentDiscovery().candidates.map((candidate) => candidate.retrievalUri)).toEqual([
      'https://docs.example.test/cache/Missing',
    ]);
  });

  test('keeps examples, metadata URLs, extensions and unknown schema annotations outside reference/resource budgets', async () => {
    const opaque = {
      $self: 'https://never.example.test/self',
      $id: 'https://never.example.test/id',
      $ref: 'https://never.example.test/ref',
      $schema: 'https://never.example.test/dialect',
      $anchor: 'name',
      $dynamicRef: 'https://never.example.test/dynamic',
      itemSchema: { $ref: 'https://never.example.test/item' },
      oneOf: [{ $ref: 'https://never.example.test/variant' }],
      discriminator: {
        propertyName: 'kind',
        mapping: { value: 'https://never.example.test/mapping' },
        defaultMapping: 'https://never.example.test/default',
      },
    };
    const fetchImpl = vi.fn();
    const loader = new ExternalResourceLoader(
      valid32({
        'x-data': opaque,
        components: {
          schemas: { Payload: { type: 'object', examples: [opaque], 'x-data': opaque, unknownAnnotation: opaque } },
          examples: {
            Literal: { dataValue: opaque },
            External: { externalValue: 'https://never.example.test/example' },
          },
          securitySchemes: {
            Metadata: { type: 'oauth2', oauth2MetadataUrl: 'https://never.example.test/metadata', flows: {} },
          },
          mediaTypes: { Plain: { examples: { Value: { value: opaque } } } },
        },
      }),
      retrieval,
      { fetchImpl, limits: { maxReferences: 1, maxSchemaResources: 1 } },
    );
    expect(await loader.load([])).toMatchObject({ complete: true, diagnostics: [], edges: [] });
    expect(loader.currentDiscovery().candidates).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each(['root', 'nested', 'referenced'] as const)(
    'applies OAS discriminator connections to %s pure JSON Schema positions without implicit fetching',
    async (position) => {
      const known = `${retrieval}#/components/schemas/Known`;
      const other = 'https://resources.example.test/other.json';
      const library = 'https://resources.example.test/pure.json';
      const payload = {
        oneOf: [{ $ref: known }, { $ref: other }],
        discriminator: { propertyName: 'kind', mapping: { known: 'Known' }, defaultMapping: other },
      };
      const schema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: 'urn:example:pure-schema',
        ...(position === 'root' ? payload : { $ref: '#/$defs/Nested', $defs: { Nested: payload } }),
      };
      // Both variants are explicitly listed by oneOf. The required known discriminator
      // value and defaultMapping cover the property's presence/absence semantics.
      const external = valid32({ components: { schemas: { Root: schema } } });
      const fetchImpl = vi.fn(async () => response(external));
      const loader = new ExternalResourceLoader(
        valid32({
          components: {
            schemas: {
              Root: position === 'referenced' ? { $ref: `${library}#/components/schemas/Root/$defs/Nested` } : schema,
              Known: { type: 'object', required: ['kind'], properties: { kind: { const: 'known' } } },
            },
          },
        }),
        retrieval,
        { fetchImpl },
      );
      const snapshot = position === 'referenced' ? await loader.load([grant(loader, library)]) : await loader.load([]);
      expect(snapshot.complete).toBe(false);
      expect(snapshot.diagnostics).toEqual([]);
      expect(
        snapshot.edges.filter((edge) => edge.kind === 'discriminator-mapping').map((edge) => edge.resolvedUri),
      ).toEqual([known, other]);
      expect(loader.currentDiscovery().candidates.map((candidate) => candidate.retrievalUri)).toEqual([other]);
      expect(fetchImpl).toHaveBeenCalledTimes(position === 'referenced' ? 1 : 0);
    },
  );
});

describe('OAS 3.2 resource budget and generation boundaries', () => {
  test('counts references in nested Encoding against the fixed reference limit before fetching', () => {
    const document = valid32({
      components: {
        mediaTypes: {
          Multipart: {
            schema: { type: 'array', items: { type: 'string' } },
            itemEncoding: {
              contentType: 'text/plain',
              headers: {
                'X-A': { schema: { $ref: 'https://resources.example.test/a.json' } },
                'X-B': { schema: { $ref: 'https://resources.example.test/b.json' } },
              },
            },
          },
        },
      },
    });
    expect(() => new ExternalResourceLoader(document, retrieval, { limits: { maxReferences: 1 } })).toThrow(
      /reference limit/,
    );
  });

  test('a cancelled generation cannot publish stale document identities or typed targets', async () => {
    const external = 'https://resources.example.test/document.json';
    const releases: (() => void)[] = [];
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          const index = releases.length;
          releases.push(() =>
            resolve(
              response(
                valid32({
                  $self: `urn:example:generation:${index}`,
                  components: { schemas: { Value: { const: index } } },
                }),
              ),
            ),
          );
        }),
    );
    const loader = new ExternalResourceLoader(
      valid32(schemaReference(`${external}#/components/schemas/Value`)),
      retrieval,
      { fetchImpl },
    );
    const old = loader.load([grant(loader, external)]);
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const current = loader.load([grant(loader, external)]);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    expect(await current).toMatchObject({ complete: true, diagnostics: [] });
    releases[0]();
    await old;
    const snapshot = loader.currentSnapshot();
    expect(snapshot.documentTargets.has('urn:example:generation:0')).toBe(false);
    expect(snapshot.documentTargets.get('urn:example:generation:1')?.ownerRetrievalUri).toBe(external);
    expect(snapshot.nodes.get(external)?.selfUri).toBe('urn:example:generation:1');
  });
});

describe('OAS 3.2 scoped identities and operation targets', () => {
  test('keeps a Schema resource at the fragmentless base distinct from a fragment-bearing document self', () => {
    const base = 'https://identity.example.test/shared';
    const loader = new ExternalResourceLoader(
      valid32({
        $self: `${base}#document`,
        components: {
          schemas: {
            Root: {
              $id: base,
              $defs: { Item: { type: 'string' } },
              type: 'object',
              properties: { item: { $ref: '#/$defs/Item' } },
            },
          },
        },
      }),
      retrieval,
    );
    const snapshot = loader.currentSnapshot();
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    expect(snapshot.documentTargets.get(`${base}#document`)?.pointer).toBe('#');
    expect(snapshot.resourceTargets.get(base)?.pointer).toBe('#/components/schemas/Root');
    expect(snapshot.edges[0]).toMatchObject({ resolvedUri: `${base}#/$defs/Item`, state: 'local' });
  });

  test.each(['query', 'additionalOperations/Copy'])(
    'operationRef to %s includes parent parameters but no sibling operation',
    async (methodPointer) => {
      const library = 'https://resources.example.test/operations.json';
      const parameter = 'https://resources.example.test/parameter-schema.json';
      const operation = { responses: { '204': {} } };
      const target = valid32({
        paths: {
          '/target': {
            parameters: [{ name: 'X-Trace', in: 'header', schema: { $ref: parameter } }],
            ...(methodPointer === 'query' ? { query: operation } : { additionalOperations: { Copy: operation } }),
            post: {
              requestBody: {
                content: { 'application/json': { schema: { $ref: 'https://never.example.test/sibling.json' } } },
              },
            },
          },
        },
      });
      const loader = new ExternalResourceLoader(
        valid32({ components: { links: { Next: { operationRef: `${library}#/paths/~1target/${methodPointer}` } } } }),
        retrieval,
        {
          fetchImpl: async (input) => response(String(input) === library ? target : { type: 'string' }),
        },
      );
      const first = await loader.load([grant(loader, library)]);
      expect(first.complete).toBe(false);
      expect(loader.currentDiscovery().candidates.map((candidate) => candidate.retrievalUri)).toEqual([parameter]);
      expect(await loader.continueLoad([grant(loader, parameter)])).toMatchObject({ complete: true, diagnostics: [] });
    },
  );
});

describe('OAS 3.2 RFC 3986 URI references', () => {
  test.each([
    'foo|bar',
    'foo^bar',
    '1x:x',
    'ht%74p:g',
    'foo{bar}',
    'foo<bar>',
    'foo`bar',
    'foo\\bar',
    'foo%2',
    'foo%GG',
    'foo bar',
    'foo\n',
    '文档',
    '#fragment[invalid]',
  ])('rejects illegal self %j without URL repair', ($self) => {
    expect(() => new ExternalResourceLoader(document32({ $self }), retrieval)).toThrow(/URI reference/);
  });

  test.each(['foo|bar', 'foo^bar', '1x:x', '#fragment[invalid]'])(
    'rejects an illegal resource reference %j',
    (reference) => {
      const loader = new ExternalResourceLoader(document32(schemaReference(reference)), retrieval);
      expect(loader.currentSnapshot()).toMatchObject({
        complete: false,
        diagnostics: [expect.objectContaining({ code: 'RESOURCE_URI_INVALID' })],
      });
      expect(loader.currentDiscovery().candidates).toEqual([]);
    },
  );

  test.each(['http:g', 'https:g'])('preserves absolute %s identity and its local fragments', ($self) => {
    const loader = new ExternalResourceLoader(
      document32({ $self, components: { schemas: { A: { $ref: '#/components/schemas/B' }, B: true } } }),
      retrieval,
    );
    expect(loader.currentSnapshot()).toMatchObject({ complete: true, diagnostics: [] });
    expect(loader.currentSnapshot().nodes.get(retrieval)).toMatchObject({ selfUri: $self, documentBaseUri: $self });
    expect(loader.currentSnapshot().edges[0].resolvedUri).toBe(`${$self}#/components/schemas/B`);
  });

  test.each([
    ['../api/%6Fpenapi.json#%65ntry', 'https://docs.example.test/api/openapi.json#entry'],
    ['urn:example:%61pi#%65ntry', 'urn:example:api#entry'],
    ['https://identity.example.test/a%2Fb?mode=%41#%65ntry', 'https://identity.example.test/a%2Fb?mode=A#entry'],
    ['./api?x=%2F#section/path?ok', 'https://docs.example.test/cache/api?x=%2F#section/path?ok'],
  ])('accepts and normalizes legal self %s without fetching its identity', async ($self, identity) => {
    const fetchImpl = vi.fn();
    const loader = new ExternalResourceLoader(
      valid32({ $self, components: { schemas: { A: { $ref: '#/components/schemas/B' }, B: true } } }),
      retrieval,
      { fetchImpl },
    );
    const snapshot = await loader.load([]);
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    expect(snapshot.nodes.get(retrieval)).toMatchObject({ selfUri: identity, documentBaseUri: identity.split('#')[0] });
    expect(snapshot.documentTargets.get(identity)).toMatchObject({ ownerRetrievalUri: retrieval, pointer: '#' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each(['http:g', 'https:g', 'https:/g'])(
    'never repairs unknown identity %s into a fetchable HTTP URL',
    async (reference) => {
      const fetchImpl = vi.fn();
      const loader = new ExternalResourceLoader(valid32(schemaReference(reference)), retrieval, { fetchImpl });
      const snapshot = await loader.load([grant(loader, reference), grant(loader, new URL(reference, retrieval).href)]);
      expect(snapshot).toMatchObject({
        complete: false,
        diagnostics: [expect.objectContaining({ code: 'RESOURCE_URI_INVALID', phase: 'authorize' })],
      });
      expect(snapshot.edges[0]).toMatchObject({
        resolvedUri: reference,
        targetRetrievalUri: reference,
        state: 'failed',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  test('keeps percent-encoded retrieval, grant and document-scope keys separate from normalized identities', async () => {
    const entryInput = 'https://docs.example.test:443/cache/%72oot.json?token=%41';
    const entryKey = 'https://docs.example.test/cache/%72oot.json?token=%41';
    const externalInput = 'https://resources.example.test:443/%70et.json?token=%41';
    const externalKey = 'https://resources.example.test/%70et.json?token=%41';
    const identity = 'https://resources.example.test:443/pet.json?token=A';
    const document = valid32({ $self: 'urn:example:entry', ...schemaReference(externalInput) });
    const fetchImpl = vi.fn(async () => response({ type: 'string' }));
    const loader = new ExternalResourceLoader(document, entryInput, { pageUri, fetchImpl });
    expect(loader.currentSnapshot().entryRetrievalUri).toBe(entryKey);
    expect(loader.documentScope).not.toBe(
      new ExternalResourceLoader(document, entryKey.replace('%72oot', 'root'), { pageUri }).documentScope,
    );
    expect(loader.currentDiscovery().candidates[0]).toMatchObject({
      retrievalUri: externalKey,
      retrievalUriHash: sha256Hex(externalKey),
    });
    expect((await loader.load([grant(loader, identity), grant(loader, 'urn:example:entry')])).complete).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    const snapshot = await loader.continueLoad([grant(loader, externalKey)]);
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    expect([...snapshot.nodes.keys()]).toEqual([entryKey, externalKey]);
    expect(snapshot.edges[0]).toMatchObject({
      resolvedUri: identity,
      targetRetrievalUri: externalKey,
      state: 'loaded',
    });
    expect(snapshot.resourceTargets.get('https://resources.example.test/pet.json?token=A')).toMatchObject({
      ownerRetrievalUri: externalKey,
    });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      externalKey,
      expect.objectContaining({ credentials: 'omit', redirect: 'error' }),
    );
  });

  test.each([
    ['a%3ab?x=%26#%2f', 'a%3Ab?x=%26#%2F'],
    ['a%2fb?x=%23#%3f', 'a%2Fb?x=%23#%3F'],
    ['a%25?x=%253A#%2525', 'a%25?x=%253A#%2525'],
    ['%e6%96%87%e6%a1%a3?x=%E2%82%AC#%F0%9F%90%88', '%E6%96%87%E6%A1%A3?x=%E2%82%AC#%F0%9F%90%88'],
    ['%61/%2E%2e/b?x=%7e#%65ntry', 'b?x=~#entry'],
  ])('preserves the URI meaning of %s and remains idempotent', (reference, expected) => {
    const base = 'https://identity.example.test/base/';
    const resolved = `${base}${expected}`;
    expect(resolveUri(reference, base)).toBe(resolved);
    expect(normalizeUri(resolved)).toBe(resolved);
    expect(normalizeUri(normalizeUri(resolved))).toBe(resolved);
    expect(resolveUri(resolved, base)).toBe(resolved);
    expect(toAbsoluteUri(resolved)).toBe(resolved.split('#')[0]);
  });

  test.each([
    ['urn:example:a%3Ab', 'urn:example:a:b'],
    ['https://identity.example.test/a%2Fb', 'https://identity.example.test/a/b'],
    ['https://identity.example.test/?x=%26', 'https://identity.example.test/?x=&'],
    ['https://identity.example.test/?x=%27', "https://identity.example.test/?x='"],
    ['https://identity.example.test/a%23b', 'https://identity.example.test/a'],
    ['urn:example:a%253A', 'urn:example:a%3A'],
    ['urn:example:a%2525', 'urn:example:a%25'],
  ])('keeps encoded identity %s distinct from %s', (encoded, literal) => {
    const loader = new ExternalResourceLoader(
      valid32({
        components: {
          schemas: {
            Encoded: { $id: encoded, const: 'encoded' },
            Literal: { $id: literal, const: 'literal' },
            FromEncoded: { $ref: encoded },
            FromLiteral: { $ref: literal },
          },
        },
      }),
      retrieval,
    );
    const snapshot = loader.currentSnapshot();
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    expect(snapshot.resourceTargets.get(encoded)).toMatchObject({ pointer: '#/components/schemas/Encoded' });
    expect(snapshot.resourceTargets.get(literal)).toMatchObject({ pointer: '#/components/schemas/Literal' });
  });

  test('keeps reserved encodings in self, base and reference fragments', () => {
    const self = 'https://identity.example.test/a%3Ab?x=%26#%2F';
    const loader = new ExternalResourceLoader(
      valid32({ $self: self, components: { schemas: { A: { $ref: '#/components/schemas/B' }, B: true } } }),
      retrieval,
    );
    const snapshot = loader.currentSnapshot();
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    expect(snapshot.nodes.get(retrieval)).toMatchObject({
      selfUri: self,
      documentBaseUri: 'https://identity.example.test/a%3Ab?x=%26',
    });
    expect(snapshot.documentTargets.has('https://identity.example.test/a:b?x=&#/')).toBe(false);
    expect(snapshot.edges[0].resolvedUri).toBe('https://identity.example.test/a%3Ab?x=%26#/components/schemas/B');
  });

  test('retains RFC identities through schema ids, anchors and repeated local target expansion', () => {
    const loader = new ExternalResourceLoader(
      valid32({
        $self: 'http:g',
        components: {
          schemas: {
            Root: {
              $id: 'https:g',
              $anchor: 'named',
              $defs: { Child: { $id: 'urn:example:%61pi', $anchor: 'leaf' } },
              properties: {
                recursive: { $ref: '#named' },
                child: { $ref: 'urn:example:api#leaf' },
              },
            },
          },
        },
      }),
      retrieval,
    );
    const snapshot = loader.currentSnapshot();
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    expect(snapshot.resourceTargets.get('https:g')).toMatchObject({ pointer: '#/components/schemas/Root' });
    expect(snapshot.anchorTargets.get('https:g#named')).toMatchObject({ pointer: '#/components/schemas/Root' });
    expect(snapshot.anchorTargets.get('urn:example:api#leaf')).toMatchObject({
      pointer: '#/components/schemas/Root/$defs/Child',
    });
    expect(snapshot.edges.map((edge) => edge.resolvedUri)).toEqual(['urn:example:api#leaf', 'https:g#named']);
    expect(loader.currentDiscovery().candidates).toEqual([]);
  });

  test('validates raw references before unreserved decoding can change their grammar', () => {
    expect(() => resolveUri('ht%74p:g', retrieval)).toThrow(/URI reference/);
    expect(() => normalizeUri('https://example.test/a\n')).toThrow(/URI reference/);
    expect(() => toAbsoluteUri('https://example.test/a%GG#entry')).toThrow(/URI reference/);
  });

  test.each(['', '#named'])(
    'resolves an authorized HTTP spelling through the real typed target %s',
    async (fragment) => {
      const logical = "https://resources.example.test/schema.json?x='";
      const physical = 'https://resources.example.test/schema.json?x=%27';
      const fetchImpl = vi.fn(async () => response({ $anchor: 'named', type: 'string' }));
      const loader = new ExternalResourceLoader(valid32(schemaReference(`${logical}${fragment}`)), retrieval, {
        fetchImpl,
      });
      expect((await loader.load([grant(loader, logical)])).complete).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
      const snapshot = await loader.continueLoad([grant(loader, physical)]);
      expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
      expect(snapshot.edges[0]).toMatchObject({
        resolvedUri: `${logical}${fragment}`,
        targetRetrievalUri: physical,
        state: 'loaded',
      });
      expect(snapshot.resourceTargets.has(logical)).toBe(false);
      expect(snapshot.resourceTargets.get(physical)).toMatchObject({ ownerRetrievalUri: physical, pointer: '#' });
      expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(physical, expect.any(Object));
    },
  );

  test('still rejects a wrong object type through an authorized HTTP spelling', async () => {
    const logical = "https://resources.example.test/document.json?x='";
    const physical = 'https://resources.example.test/document.json?x=%27';
    const loader = new ExternalResourceLoader(valid32(schemaReference(`${logical}#/info`)), retrieval, {
      fetchImpl: async () => response(valid32()),
    });
    const snapshot = await loader.load([grant(loader, physical)]);
    expect(snapshot).toMatchObject({
      complete: false,
      diagnostics: [expect.objectContaining({ code: 'DOCUMENT_KIND_MISMATCH' })],
    });
  });
});
