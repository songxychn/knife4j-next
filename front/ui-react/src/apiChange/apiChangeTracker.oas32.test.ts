import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import { describe, expect, it, vi } from 'vitest';
import {
  ExternalResourceLoader,
  type ResourceGraphSnapshot,
  type ResourceLoadLimits,
} from '../schema/externalResourceGraph';
import type { SwaggerDoc } from '../types/swagger';
import {
  OAS31_API_CHANGE_SNAPSHOT_VERSION,
  OAS32_API_CHANGE_SNAPSHOT_VERSION,
  acknowledgeApiOperation,
  apiOperationIdentity,
  buildApiChangeBaselineStorageKey,
  buildApiChangeFingerprintSnapshot,
  compareApiChangeBaseline,
  parseApiChangeBaseline,
  reconcileApiChangeBaseline,
  serializeApiChangeBaseline,
  type ApiDocumentIdentity,
  type ApiOperationFingerprintMap,
} from './apiChangeTracker';

const IDENTITY: ApiDocumentIdentity = {
  origin: 'https://docs.example.com',
  applicationPath: '/service/doc.html',
  group: 'events',
  apiDocsUrl: '/service/v3/api-docs/events',
};

const OAS32_ENTRY_URI = 'https://changes32.knife4j.example/openapi.json';
const OAS32_TREE_URI = 'https://changes32.knife4j.example/schemas/tree.json';
const OAS32_SCHEME_URI = 'https://auth.example.test/schemes/bearer.json';
const OAS32_PATH_ITEM_URI = 'https://changes32.knife4j.example/path-items/shared.json';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function valid32(extra: Record<string, unknown> = {}): SwaggerDoc {
  const document = {
    openapi: '3.2.0',
    info: { title: 'OAS 3.2 changes', version: '1.0.0' },
    ...extra,
  };
  expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
  return document as SwaggerDoc;
}

function oas32Document(): SwaggerDoc {
  return valid32({
    paths: {
      '/read': {
        get: { operationId: 'getItems', responses: { 200: { description: 'GET' } } },
        query: { operationId: 'queryItems', responses: { 200: { description: 'QUERY' } } },
      },
      '/methods': {
        additionalOperations: {
          COPY: { operationId: 'upperCopy', responses: { 200: { description: 'upper' } } },
          Copy: { operationId: 'mixedCopy', responses: { 200: { description: 'mixed' } } },
        },
      },
      '/mapped': {
        get: {
          responses: {
            200: {
              description: 'mapped',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [{ $ref: '#/components/schemas/Known' }, { $ref: '#/components/schemas/Other' }],
                    discriminator: {
                      propertyName: 'kind',
                      mapping: { known: 'Known' },
                      defaultMapping: 'Other',
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/stream': {
        query: {
          requestBody: {
            content: {
              'application/json-seq': { $ref: '#/components/mediaTypes/Events' },
            },
          },
          responses: { 204: { description: 'accepted' } },
        },
      },
      '/secured': {
        get: {
          security: [{ [OAS32_SCHEME_URI]: [] }],
          responses: { 200: { description: 'ok' } },
        },
      },
      '/tree': {
        get: {
          responses: {
            200: {
              description: 'Tree',
              content: { 'application/json': { schema: { $ref: './schemas/tree.json' } } },
            },
          },
        },
      },
      '/local-ref': { $ref: '#/components/pathItems/Local' },
    },
    webhooks: {
      inbound: {
        post: { summary: 'Webhook is outside change tracking', responses: { 204: { description: 'Accepted' } } },
      },
    },
    components: {
      pathItems: {
        Local: {
          get: { responses: { 200: { description: 'Local path item' } } },
        },
      },
      schemas: {
        Known: { type: 'object', properties: { kind: { const: 'known' } } },
        Other: { type: 'object', properties: { kind: { const: 'other' } } },
      },
      mediaTypes: {
        Events: {
          schema: { type: 'array' },
          itemSchema: { type: 'integer' },
          itemEncoding: { contentType: 'application/json' },
        },
      },
    },
    'x-root-contract': { owner: 'platform' },
  });
}

function oas32ExternalDocuments(): Record<string, unknown> {
  return {
    [OAS32_TREE_URI]: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: OAS32_TREE_URI,
      type: 'object',
      properties: { label: { type: 'string', minLength: 1 } },
    },
    [OAS32_SCHEME_URI]: { type: 'http', scheme: 'bearer' },
  };
}

async function oas32Snapshot(
  document: SwaggerDoc,
  externalDocuments: Record<string, unknown> = {},
  limits: Partial<ResourceLoadLimits> = {},
): Promise<{ snapshot: ResourceGraphSnapshot; fetchSpy: ReturnType<typeof vi.fn> }> {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const resource = externalDocuments[String(input)];
    if (resource === undefined) return new Response('missing', { status: 404 });
    return new Response(JSON.stringify(resource), { headers: { 'content-type': 'application/json' } });
  });
  const loader = new ExternalResourceLoader(document, OAS32_ENTRY_URI, {
    pageUri: 'https://changes32.knife4j.example/doc.html',
    fetchImpl: fetchSpy,
    limits,
  });
  const discovery = loader.discover();
  const snapshot =
    discovery.candidates.length === 0
      ? loader.currentSnapshot()
      : await loader.load(
          discovery.candidates.map((candidate) => ({
            scope: 'generation' as const,
            documentScope: discovery.documentScope,
            resourceKey: candidate.retrievalUriHash,
          })),
        );
  loader.dispose();
  return { snapshot, fetchSpy };
}

function readyFingerprints(result: ReturnType<typeof buildApiChangeFingerprintSnapshot>): ApiOperationFingerprintMap {
  expect(result.status).toBe('ready');
  expect(result).toMatchObject({ snapshotVersion: OAS32_API_CHANGE_SNAPSHOT_VERSION });
  return (result as Extract<typeof result, { status: 'ready' }>).fingerprints;
}

async function buildOas32Fingerprints(
  document: SwaggerDoc,
  externalDocuments: Record<string, unknown> = oas32ExternalDocuments(),
): Promise<ApiOperationFingerprintMap> {
  const { snapshot, fetchSpy } = await oas32Snapshot(document, externalDocuments);
  expect(snapshot.complete).toBe(true);
  expect(snapshot.diagnostics).toEqual([]);
  const requestsBeforeFingerprint = fetchSpy.mock.calls.length;
  const result = buildApiChangeFingerprintSnapshot(document, {
    status: 'ready',
    retrievalUri: OAS32_ENTRY_URI,
    snapshot,
    documentDiagnostics: [
      { code: 'missing-required-field', path: '#/metadata', reason: 'GroupContext metadata must not block 3.2' },
    ],
  });
  expect(fetchSpy).toHaveBeenCalledTimes(requestsBeforeFingerprint);
  return readyFingerprints(result);
}

describe('OAS 3.2 API change fingerprints', () => {
  it('requires a prepared resource graph before fingerprinting OAS 3.2', () => {
    const document = oas32Document();
    expect(buildApiChangeFingerprintSnapshot(document)).toEqual({
      status: 'unavailable',
      snapshotVersion: OAS32_API_CHANGE_SNAPSHOT_VERSION,
      reason: 'preparing',
    });
  });

  it('keeps QUERY and GET as distinct operations and additional method case as distinct keys', async () => {
    const fingerprints = await buildOas32Fingerprints(oas32Document());
    const getKey = apiOperationIdentity('GET', '/read');
    const queryKey = apiOperationIdentity('QUERY', '/read');
    const copyKey = apiOperationIdentity('COPY', '/methods');
    const mixedKey = apiOperationIdentity('Copy', '/methods');

    expect(getKey).not.toBe(queryKey);
    expect(copyKey).not.toBe(mixedKey);
    expect(fingerprints[getKey]).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    expect(fingerprints[queryKey]).toEqual(expect.stringMatching(/^sha256:[0-9a-f]{64}$/));
    expect(fingerprints[copyKey]).not.toBe(fingerprints[mixedKey]);
    expect(fingerprints[apiOperationIdentity('POST', 'inbound')]).toBeUndefined();
    expect(fingerprints[apiOperationIdentity('GET', '/local-ref')]).toEqual(
      expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    );
  });

  it('ignores Paths specification extensions even when they look like operations', async () => {
    const document = oas32Document();
    (document.paths as Record<string, unknown>)['x-vendor'] = {
      get: { responses: { 200: { description: 'Not an executable path operation' } } },
    };
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const fingerprints = await buildOas32Fingerprints(document);
    expect(fingerprints[apiOperationIdentity('GET', 'x-vendor')]).toBeUndefined();
  });

  it('does not reuse the OAS 3.1 protocol or treat 3.1 documentDiagnostics as 3.2 blockers', async () => {
    const document = oas32Document();
    const current = await buildOas32Fingerprints(document);
    expect(buildApiChangeBaselineStorageKey(IDENTITY, OAS32_API_CHANGE_SNAPSHOT_VERSION)).not.toBe(
      buildApiChangeBaselineStorageKey(IDENTITY, OAS31_API_CHANGE_SNAPSHOT_VERSION),
    );
    const baseline = reconcileApiChangeBaseline(IDENTITY, OAS32_API_CHANGE_SNAPSHOT_VERSION, current, null).baseline;
    const serialized = serializeApiChangeBaseline(baseline);
    expect(parseApiChangeBaseline(serialized, IDENTITY, OAS31_API_CHANGE_SNAPSHOT_VERSION)).toBeNull();
    expect(parseApiChangeBaseline(serialized, IDENTITY, OAS32_API_CHANGE_SNAPSHOT_VERSION)).toEqual(baseline);
  });

  it('shares oas3.2-v1 across 3.2.x patches and ignores info/openapi/webhook-only edits', async () => {
    const original = await buildOas32Fingerprints(oas32Document());
    const patched = oas32Document();
    patched.openapi = '3.2.99';
    patched.info = { title: 'Renamed', version: '9.0.0', description: 'Global metadata only' };
    patched.webhooks!.inbound.post!.summary = 'Changed webhook metadata';
    expect(await buildOas32Fingerprints(patched)).toEqual(original);
  });

  it('changes fingerprints for defaultMapping, itemSchema, Media Type, Encoding, security URI, and reachable resources', async () => {
    const document = oas32Document();
    const external = oas32ExternalDocuments();
    const initial = await buildOas32Fingerprints(document, external);
    const mappedKey = apiOperationIdentity('GET', '/mapped');
    const streamKey = apiOperationIdentity('QUERY', '/stream');
    const securedKey = apiOperationIdentity('GET', '/secured');
    const treeKey = apiOperationIdentity('GET', '/tree');
    const readKey = apiOperationIdentity('GET', '/read');

    const mappingChanged = cloneJson(document);
    (
      mappingChanged.paths['/mapped'].get!.responses![200].content!['application/json'].schema as {
        discriminator: { defaultMapping: string };
      }
    ).discriminator.defaultMapping = 'Known';
    const afterMapping = await buildOas32Fingerprints(mappingChanged, external);
    expect(afterMapping[mappedKey]).not.toBe(initial[mappedKey]);
    expect(afterMapping[readKey]).toBe(initial[readKey]);

    const itemSchemaChanged = cloneJson(document);
    (itemSchemaChanged.components!.mediaTypes as { Events: { itemSchema: { type: string } } }).Events.itemSchema.type =
      'string';
    const afterItemSchema = await buildOas32Fingerprints(itemSchemaChanged, external);
    expect(afterItemSchema[streamKey]).not.toBe(initial[streamKey]);
    expect(afterItemSchema[mappedKey]).toBe(initial[mappedKey]);

    const mediaChanged = cloneJson(document);
    (mediaChanged.components!.mediaTypes as { Events: { schema: { type: string } } }).Events.schema.type = 'object';
    expect((await buildOas32Fingerprints(mediaChanged, external))[streamKey]).not.toBe(initial[streamKey]);

    const encodingChanged = cloneJson(document);
    (
      encodingChanged.components!.mediaTypes as { Events: { itemEncoding: { contentType: string } } }
    ).Events.itemEncoding.contentType = 'application/json-seq';
    expect((await buildOas32Fingerprints(encodingChanged, external))[streamKey]).not.toBe(initial[streamKey]);

    const schemeChanged = cloneJson(external);
    (schemeChanged[OAS32_SCHEME_URI] as { scheme: string }).scheme = 'basic';
    const afterScheme = await buildOas32Fingerprints(document, schemeChanged);
    expect(afterScheme[securedKey]).not.toBe(initial[securedKey]);
    expect(afterScheme[treeKey]).toBe(initial[treeKey]);

    const treeChanged = cloneJson(external);
    (treeChanged[OAS32_TREE_URI] as { properties: { label: { minLength: number } } }).properties.label.minLength = 4;
    const afterTree = await buildOas32Fingerprints(document, treeChanged);
    expect(afterTree[treeKey]).not.toBe(initial[treeKey]);
    expect(afterTree[securedKey]).toBe(initial[securedKey]);
  });

  it('reports added, changed, and deleted additional methods without colliding COPY/Copy', async () => {
    const document = oas32Document();
    const initial = await buildOas32Fingerprints(document);
    const first = reconcileApiChangeBaseline(IDENTITY, OAS32_API_CHANGE_SNAPSHOT_VERSION, initial, null);
    expect(first.initialized).toBe(true);
    expect(first.statuses).toEqual({});

    const next = cloneJson(document);
    next.paths['/methods'].additionalOperations!.COPY!.responses![200].description = 'changed upper';
    delete next.paths['/methods'].additionalOperations!.Copy;
    next.paths['/added'] = { post: { responses: { 204: { description: 'Created' } } } };
    const recovered = await buildOas32Fingerprints(next);
    const statuses = compareApiChangeBaseline(first.baseline, recovered);
    expect(statuses[apiOperationIdentity('COPY', '/methods')]).toBe('changed');
    expect(statuses[apiOperationIdentity('POST', '/added')]).toBe('added');
    expect(statuses[apiOperationIdentity('Copy', '/methods')]).toBeUndefined();
    expect(recovered[apiOperationIdentity('Copy', '/methods')]).toBeUndefined();

    const acknowledgedCopy = acknowledgeApiOperation(first.baseline, recovered, 'COPY', '/methods');
    expect(
      compareApiChangeBaseline(acknowledgedCopy, recovered)[apiOperationIdentity('COPY', '/methods')],
    ).toBeUndefined();
    expect(compareApiChangeBaseline(acknowledgedCopy, recovered)[apiOperationIdentity('POST', '/added')]).toBe('added');
  });

  it('keeps the previous baseline when the graph is pending and does not fake unchanged', async () => {
    const document = oas32Document();
    const initial = await buildOas32Fingerprints(document);
    const first = reconcileApiChangeBaseline(IDENTITY, OAS32_API_CHANGE_SNAPSHOT_VERSION, initial, null);
    const serialized = serializeApiChangeBaseline(first.baseline);
    const pendingLoader = new ExternalResourceLoader(document, OAS32_ENTRY_URI, {
      pageUri: 'https://changes32.knife4j.example/doc.html',
    });
    pendingLoader.discover();
    const unavailableResult = buildApiChangeFingerprintSnapshot(document, {
      status: 'ready',
      retrievalUri: OAS32_ENTRY_URI,
      snapshot: pendingLoader.currentSnapshot(),
      documentDiagnostics: [],
    });
    pendingLoader.dispose();
    expect(unavailableResult).toMatchObject({
      status: 'unavailable',
      snapshotVersion: OAS32_API_CHANGE_SNAPSHOT_VERSION,
      reason: 'resource-pending',
    });
    expect(parseApiChangeBaseline(serialized, IDENTITY, OAS32_API_CHANGE_SNAPSHOT_VERSION)).toEqual(first.baseline);

    const { snapshot: budgetSnapshot } = await oas32Snapshot(document, oas32ExternalDocuments(), {
      maxResourceBytes: 32,
    });
    expect(
      buildApiChangeFingerprintSnapshot(document, {
        status: 'ready',
        retrievalUri: OAS32_ENTRY_URI,
        snapshot: budgetSnapshot,
        documentDiagnostics: [],
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'resource-budget' });
  });

  it('classifies structural issues, unsupported dialects, and snapshot blockers without succeeding', async () => {
    const valid = oas32Document();
    const { snapshot } = await oas32Snapshot(valid, oas32ExternalDocuments());

    const invalid = {
      openapi: '3.2.0',
      info: { title: 'Invalid', version: '1' },
      paths: { 'missing-slash': { get: { responses: { 200: { description: 'ok' } } } } },
    } as unknown as SwaggerDoc;
    expect(collectOas32DocumentDiagnostics(invalid).length).toBeGreaterThan(0);
    expect(
      buildApiChangeFingerprintSnapshot(invalid, {
        status: 'ready',
        retrievalUri: OAS32_ENTRY_URI,
        snapshot,
        documentDiagnostics: [],
      }),
    ).toEqual({
      status: 'unavailable',
      snapshotVersion: OAS32_API_CHANGE_SNAPSHOT_VERSION,
      reason: 'document-invalid',
    });

    const unsupportedDialect = valid32({
      paths: {
        '/custom': {
          get: {
            responses: {
              200: {
                description: 'custom',
                content: { 'application/json': { schema: { $ref: './schemas/custom.json' } } },
              },
            },
          },
        },
      },
    });
    const { snapshot: dialectSnapshot } = await oas32Snapshot(unsupportedDialect, {
      'https://changes32.knife4j.example/schemas/custom.json': {
        $schema: 'https://dialects.example/unsupported',
        type: 'string',
      },
    });
    expect(
      buildApiChangeFingerprintSnapshot(unsupportedDialect, {
        status: 'ready',
        retrievalUri: OAS32_ENTRY_URI,
        snapshot: dialectSnapshot,
        documentDiagnostics: [],
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'dialect-unsupported' });

    expect(
      buildApiChangeFingerprintSnapshot(valid, {
        status: 'failed',
        retrievalUri: OAS32_ENTRY_URI,
        snapshot: null,
        documentDiagnostics: [],
        errorCode: 'DIALECT_UNSUPPORTED',
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'dialect-unsupported' });

    const documentDialect = cloneJson(valid);
    documentDialect.jsonSchemaDialect = 'https://dialects.example/unsupported';
    expect(collectOas32DocumentDiagnostics(documentDialect)).toEqual([]);
    expect(
      buildApiChangeFingerprintSnapshot(documentDialect, {
        status: 'failed',
        retrievalUri: OAS32_ENTRY_URI,
        snapshot: null,
        documentDiagnostics: [],
        errorCode: 'DIALECT_UNSUPPORTED',
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'dialect-unsupported' });

    const referenced = valid32({
      paths: { '/invalid': { $ref: './path-items/shared.json' } },
    });
    const { snapshot: invalidPathItem } = await oas32Snapshot(referenced, {
      [OAS32_PATH_ITEM_URI]: { get: 'invalid-operation' },
    });
    expect(invalidPathItem).toMatchObject({ complete: true, diagnostics: [] });
    expect(
      buildApiChangeFingerprintSnapshot(referenced, {
        status: 'ready',
        retrievalUri: OAS32_ENTRY_URI,
        snapshot: invalidPathItem,
        documentDiagnostics: [],
      }),
    ).toMatchObject({
      status: 'unavailable',
      snapshotVersion: OAS32_API_CHANGE_SNAPSHOT_VERSION,
      reason: 'snapshot-unavailable',
    });
  });

  it('fingerprints locally complete OAS 3.2 graphs without calling fetch', async () => {
    const document = valid32({
      paths: {
        '/pets': {
          query: { responses: { 200: { description: 'ok' } } },
          additionalOperations: {
            COPY: { responses: { 200: { description: 'upper' } } },
            Copy: { responses: { 200: { description: 'mixed' } } },
          },
        },
      },
    });
    const fetchSpy = vi.fn(async () => {
      throw new Error('complete local OAS 3.2 graphs must not fetch');
    });
    const loader = new ExternalResourceLoader(document, OAS32_ENTRY_URI, {
      pageUri: 'https://changes32.knife4j.example/doc.html',
      fetchImpl: fetchSpy,
    });
    const snapshot = loader.currentSnapshot();
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    const result = buildApiChangeFingerprintSnapshot(document, {
      status: 'ready',
      retrievalUri: OAS32_ENTRY_URI,
      snapshot,
      documentDiagnostics: [],
    });
    loader.dispose();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Object.keys(readyFingerprints(result)).sort()).toEqual(
      [
        apiOperationIdentity('QUERY', '/pets'),
        apiOperationIdentity('COPY', '/pets'),
        apiOperationIdentity('Copy', '/pets'),
      ].sort(),
    );
  });
});
