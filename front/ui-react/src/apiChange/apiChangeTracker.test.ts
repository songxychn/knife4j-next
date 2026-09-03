import { collectOas31DocumentDiagnostics } from 'knife4j-core';
import { describe, expect, it, vi } from 'vitest';
import {
  ExternalResourceLoader,
  type ResourceGraphSnapshot,
  type ResourceLoadLimits,
} from '../schema/externalResourceGraph';
import type { SwaggerDoc } from '../types/swagger';
import {
  API_CHANGE_BASELINE_MAX_BYTES,
  API_CHANGE_BASELINE_VERSION,
  OAS30_API_CHANGE_SNAPSHOT_VERSION,
  OAS31_API_CHANGE_SNAPSHOT_VERSION,
  acknowledgeAllApiOperations,
  acknowledgeApiOperation,
  apiOperationIdentity,
  buildApiChangeBaselineStorageKey,
  buildApiChangeFingerprintSnapshot,
  buildApiOperationFingerprints,
  compareApiChangeBaseline,
  parseApiChangeBaseline,
  reconcileApiChangeBaseline,
  serializeApiChangeBaseline,
  sha256Hex,
  stableSerializeJson,
  summarizeApiChanges,
  type ApiDocumentIdentity,
  type ApiOperationFingerprintMap,
} from './apiChangeTracker';

const IDENTITY: ApiDocumentIdentity = {
  origin: 'https://docs.example.com',
  applicationPath: '/service/doc.html',
  group: 'pets',
  apiDocsUrl: '/service/v3/api-docs/pets',
};

function apiDocument(): SwaggerDoc {
  return {
    openapi: '3.0.3',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          summary: 'List pets',
          tags: ['Pets'],
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
                },
              },
            },
          },
          security: [{ bearerAuth: [] }],
          'x-owner': 'platform',
        },
      },
    },
    components: {
      schemas: {
        Pet: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            age: { type: 'integer' },
          },
        },
      },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
  } as SwaggerDoc;
}

function fingerprints(document = apiDocument()) {
  const result = buildApiOperationFingerprints(document);
  expect(result).not.toBeNull();
  return result!;
}

const OAS31_ENTRY_URI = 'https://changes.knife4j.example/openapi.json';
const OAS31_TREE_URI = 'https://changes.knife4j.example/schemas/tree.json';
const OAS31_OTHER_URI = 'https://changes.knife4j.example/schemas/other.json';
const OAS31_PATH_ITEM_URI = 'https://changes.knife4j.example/path-items/shared.json';

function oas31Document(): SwaggerDoc {
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
    info: { title: 'OAS 3.1 changes', version: '1.0.0' },
    paths: {
      '/tree': {
        get: {
          tags: ['Trees', 'Read'],
          responses: {
            200: {
              $ref: '#/components/responses/Tree',
              description: 'Tree response annotation',
            },
          },
        },
      },
      '/local': {
        get: {
          responses: {
            200: {
              description: 'Local cycle',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/LocalA' } } },
            },
          },
        },
      },
      '/other': {
        get: {
          responses: {
            200: {
              description: 'Other resource',
              content: { 'application/json': { schema: { $ref: './schemas/other.json' } } },
            },
          },
        },
      },
    },
    webhooks: {
      changed: {
        post: { summary: 'Webhook is outside change tracking', responses: { 204: { description: 'Accepted' } } },
      },
    },
    components: {
      responses: {
        Tree: {
          description: 'Tree',
          content: { 'application/json': { schema: { $ref: './schemas/tree.json#tree' } } },
        },
      },
      schemas: {
        LocalA: {
          $anchor: 'localA',
          type: 'object',
          properties: { next: { $ref: '#/components/schemas/LocalB' } },
        },
        LocalB: {
          type: 'object',
          properties: { next: { $ref: '#/components/schemas/LocalA' } },
        },
      },
    },
    'x-root-contract': { owner: 'platform' },
  } as unknown as SwaggerDoc;
}

function oas31ExternalDocuments(): Record<string, unknown> {
  return {
    [OAS31_TREE_URI]: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: OAS31_TREE_URI,
      $anchor: 'tree',
      $dynamicAnchor: 'node',
      type: 'object',
      properties: {
        label: { type: 'string', minLength: 1 },
        metadata: { $id: 'metadata', type: 'string' },
        child: { $dynamicRef: '#node' },
        loop: { $ref: '#tree' },
      },
      'x-schema-owner': 'platform',
    },
    [OAS31_OTHER_URI]: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: OAS31_OTHER_URI,
      type: 'string',
      minLength: 2,
    },
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, nested]) => [key, reverseObjectKeys(nested)]),
  );
}

async function oas31Snapshot(
  document: SwaggerDoc,
  externalDocuments = oas31ExternalDocuments(),
  limits: Partial<ResourceLoadLimits> = {},
): Promise<{ snapshot: ResourceGraphSnapshot; fetchSpy: ReturnType<typeof vi.fn> }> {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const resource = externalDocuments[String(input)];
    if (resource === undefined) return new Response('missing', { status: 404 });
    return new Response(JSON.stringify(resource), { headers: { 'content-type': 'application/schema+json' } });
  });
  const loader = new ExternalResourceLoader(document, OAS31_ENTRY_URI, {
    pageUri: 'https://changes.knife4j.example/doc.html',
    fetchImpl: fetchSpy,
    limits,
  });
  const discovery = loader.discover();
  const snapshot = await loader.load(
    discovery.candidates.map((candidate) => ({
      scope: 'generation' as const,
      documentScope: discovery.documentScope,
      resourceKey: candidate.retrievalUriHash,
    })),
  );
  loader.dispose();
  return { snapshot, fetchSpy };
}

function readyOas31Fingerprints(
  result: ReturnType<typeof buildApiChangeFingerprintSnapshot>,
): ApiOperationFingerprintMap {
  expect(result.status).toBe('ready');
  return (result as Extract<typeof result, { status: 'ready' }>).fingerprints;
}

async function buildOas31Fingerprints(
  document: SwaggerDoc,
  externalDocuments = oas31ExternalDocuments(),
): Promise<ApiOperationFingerprintMap> {
  const { snapshot, fetchSpy } = await oas31Snapshot(document, externalDocuments);
  expect(snapshot.diagnostics).toEqual([]);
  expect(snapshot.complete).toBe(true);
  const requestsBeforeFingerprint = fetchSpy.mock.calls.length;
  const result = buildApiChangeFingerprintSnapshot(document, {
    status: 'ready',
    retrievalUri: OAS31_ENTRY_URI,
    snapshot,
    documentDiagnostics: [],
  });
  expect(fetchSpy).toHaveBeenCalledTimes(requestsBeforeFingerprint);
  return readyOas31Fingerprints(result);
}

describe('API change fingerprints', () => {
  it('uses a standard SHA-256 digest and stable object-key serialization', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(stableSerializeJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it('does not report changes when only JSON object property order differs', () => {
    const original = apiDocument();
    const reordered = {
      components: {
        securitySchemes: { bearerAuth: { scheme: 'bearer', type: 'http' } },
        schemas: {
          Pet: {
            properties: { age: { type: 'integer' }, name: { type: 'string' } },
            required: ['name'],
            type: 'object',
          },
        },
      },
      paths: {
        '/pets': {
          get: {
            'x-owner': 'platform',
            security: [{ bearerAuth: [] }],
            responses: original.paths['/pets'].get!.responses,
            parameters: original.paths['/pets'].get!.parameters,
            tags: ['Pets'],
            summary: 'List pets',
            operationId: 'listPets',
          },
        },
      },
      info: { version: '1.0.0', title: 'Pets' },
      openapi: '3.0.3',
    } as unknown as SwaggerDoc;

    expect(fingerprints(reordered)).toEqual(fingerprints(original));
  });

  it('tracks operation and reachable schema semantics but ignores global document metadata', () => {
    const initial = fingerprints();
    const operationChanged = apiDocument();
    operationChanged.paths['/pets'].get!.parameters![0].description = 'Maximum items';
    expect(fingerprints(operationChanged)).not.toEqual(initial);

    const schemaChanged = apiDocument();
    schemaChanged.components!.schemas!.Pet.properties!.name.description = 'Display name';
    expect(fingerprints(schemaChanged)).not.toEqual(initial);

    const extensionChanged = apiDocument();
    (extensionChanged.paths['/pets'].get as Record<string, unknown>)['x-owner'] = 'consumer';
    expect(fingerprints(extensionChanged)).not.toEqual(initial);

    const infoChanged = apiDocument();
    infoChanged.info.version = '2.0.0';
    infoChanged.info.title = 'Renamed service';
    expect(fingerprints(infoChanged)).toEqual(initial);

    const patchVersionChanged = apiDocument();
    patchVersionChanged.openapi = '3.0.1';
    expect(fingerprints(patchVersionChanged)).toEqual(initial);
  });

  it('requires a prepared resource graph before fingerprinting OAS 3.1', () => {
    const document = apiDocument();
    document.openapi = '3.1.0';
    expect(buildApiOperationFingerprints(document)).toBeNull();
    expect(buildApiChangeFingerprintSnapshot(document)).toEqual({
      status: 'unavailable',
      snapshotVersion: OAS31_API_CHANGE_SNAPSHOT_VERSION,
      reason: 'preparing',
    });
  });
});

describe('OAS 3.1 API change fingerprints', () => {
  it('ignores Paths specification extensions even when they contain HTTP method-like fields', async () => {
    const document = oas31Document();
    (document.paths as Record<string, unknown>)['x-vendor'] = {
      get: {
        responses: { 200: { description: 'Not an executable path operation' } },
      },
    };

    const current = await buildOas31Fingerprints(document);
    expect(current).not.toHaveProperty(apiOperationIdentity('GET', 'x-vendor'));
    expect(Object.keys(current)).toHaveLength(3);
  });

  it('fingerprints operations reached through local and external Path Item references', async () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'Referenced path items', version: '1.0.0' },
      paths: {
        '/local-ref': { $ref: '#/components/pathItems/Local' },
        '/external-ref': { $ref: './path-items/shared.json' },
      },
      components: {
        pathItems: {
          Local: {
            get: {
              responses: { 200: { description: 'Local response' } },
            },
          },
        },
      },
    } as unknown as SwaggerDoc;
    const externalDocuments = {
      [OAS31_PATH_ITEM_URI]: {
        post: {
          responses: { 201: { description: 'External response' } },
        },
      },
    };

    const original = await buildOas31Fingerprints(document, externalDocuments);
    expect(Object.keys(original).sort()).toEqual(
      [apiOperationIdentity('GET', '/local-ref'), apiOperationIdentity('POST', '/external-ref')].sort(),
    );

    const localChanged = cloneJson(document);
    const localPathItem = (
      localChanged.components as {
        pathItems: { Local: { get: { responses: Record<string, { description: string }> } } };
      }
    ).pathItems.Local;
    localPathItem.get.responses[200].description = 'Changed local response';
    const localFingerprints = await buildOas31Fingerprints(localChanged, externalDocuments);
    expect(localFingerprints[apiOperationIdentity('GET', '/local-ref')]).not.toBe(
      original[apiOperationIdentity('GET', '/local-ref')],
    );
    expect(localFingerprints[apiOperationIdentity('POST', '/external-ref')]).toBe(
      original[apiOperationIdentity('POST', '/external-ref')],
    );

    const externalChanged = cloneJson(externalDocuments);
    externalChanged[OAS31_PATH_ITEM_URI].post.responses[201].description = 'Changed external response';
    const externalFingerprints = await buildOas31Fingerprints(document, externalChanged);
    expect(externalFingerprints[apiOperationIdentity('GET', '/local-ref')]).toBe(
      original[apiOperationIdentity('GET', '/local-ref')],
    );
    expect(externalFingerprints[apiOperationIdentity('POST', '/external-ref')]).not.toBe(
      original[apiOperationIdentity('POST', '/external-ref')],
    );
  });

  it('classifies blocking document diagnostics before initializing or updating an OAS 3.1 baseline', async () => {
    const document = oas31Document();
    const { snapshot } = await oas31Snapshot(document);

    expect(
      buildApiChangeFingerprintSnapshot(document, {
        status: 'ready',
        retrievalUri: OAS31_ENTRY_URI,
        snapshot,
        documentDiagnostics: [
          {
            code: 'missing-required-field',
            path: '#/paths/~1tree/get/responses',
            reason: 'Operation Object requires responses',
          },
        ],
      }),
    ).toEqual({
      status: 'unavailable',
      snapshotVersion: OAS31_API_CHANGE_SNAPSHOT_VERSION,
      reason: 'document-invalid',
    });

    expect(
      buildApiChangeFingerprintSnapshot(document, {
        status: 'ready',
        retrievalUri: OAS31_ENTRY_URI,
        snapshot,
        documentDiagnostics: [
          {
            code: 'unsupported-dialect',
            path: '#/jsonSchemaDialect',
            reason: 'Unsupported Schema dialect',
          },
        ],
      }),
    ).toEqual({
      status: 'unavailable',
      snapshotVersion: OAS31_API_CHANGE_SNAPSHOT_VERSION,
      reason: 'dialect-unsupported',
    });
  });

  it('lets the loaded resource graph handle external-ref and schema-base compatibility notices', async () => {
    const document = oas31Document();
    const documentDiagnostics = collectOas31DocumentDiagnostics(document);
    expect(documentDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['external-ref', 'schema-base']),
    );
    const { snapshot } = await oas31Snapshot(document);

    expect(
      buildApiChangeFingerprintSnapshot(document, {
        status: 'ready',
        retrievalUri: OAS31_ENTRY_URI,
        snapshot,
        documentDiagnostics,
      }),
    ).toMatchObject({
      status: 'ready',
      snapshotVersion: OAS31_API_CHANGE_SNAPSHOT_VERSION,
    });
  });

  it('uses the portable semantic closure without fetching and ignores JSON key order, patch version, and metadata', async () => {
    const originalDocument = oas31Document();
    const originalExternal = oas31ExternalDocuments();
    const original = await buildOas31Fingerprints(originalDocument, originalExternal);

    const reorderedDocument = reverseObjectKeys(originalDocument) as SwaggerDoc;
    const reorderedExternal = reverseObjectKeys(originalExternal) as Record<string, unknown>;
    expect(await buildOas31Fingerprints(reorderedDocument, reorderedExternal)).toEqual(original);

    const metadataChanged = cloneJson(originalDocument);
    metadataChanged.openapi = '3.1.2';
    metadataChanged.info = { title: 'Renamed', version: '9.0.0', description: 'Global metadata only' };
    metadataChanged.webhooks!.changed.post!.summary = 'Changed webhook metadata';
    expect(await buildOas31Fingerprints(metadataChanged, originalExternal)).toEqual(original);

    const orderedArrayChanged = cloneJson(originalDocument);
    orderedArrayChanged.paths['/tree'].get!.tags = ['Read', 'Trees'];
    const reorderedArray = await buildOas31Fingerprints(orderedArrayChanged, originalExternal);
    expect(reorderedArray[apiOperationIdentity('GET', '/tree')]).not.toBe(
      original[apiOperationIdentity('GET', '/tree')],
    );
    expect(reorderedArray[apiOperationIdentity('GET', '/local')]).toBe(original[apiOperationIdentity('GET', '/local')]);
  });

  it('tracks local cycles, external $id/anchors/dynamic scope, Reference annotations, and extensions', async () => {
    const document = oas31Document();
    const external = oas31ExternalDocuments();
    const initial = await buildOas31Fingerprints(document, external);
    const treeKey = apiOperationIdentity('GET', '/tree');
    const localKey = apiOperationIdentity('GET', '/local');

    const dynamicChanged = cloneJson(external);
    const dynamicTree = dynamicChanged[OAS31_TREE_URI] as Record<string, unknown>;
    ((dynamicTree.properties as Record<string, unknown>).child as Record<string, unknown>).$dynamicRef = '#tree';
    expect((await buildOas31Fingerprints(document, dynamicChanged))[treeKey]).not.toBe(initial[treeKey]);

    const anchorDocument = cloneJson(document);
    anchorDocument.components!.responses!.Tree.content!['application/json'].schema!.$ref =
      './schemas/tree.json#rootTree';
    const anchorChanged = cloneJson(external);
    (anchorChanged[OAS31_TREE_URI] as Record<string, unknown>).$defs = {
      Root: { $anchor: 'rootTree', $ref: '#tree' },
    };
    expect((await buildOas31Fingerprints(anchorDocument, anchorChanged))[treeKey]).not.toBe(initial[treeKey]);

    const idChanged = cloneJson(external);
    const idTree = idChanged[OAS31_TREE_URI] as Record<string, unknown>;
    ((idTree.properties as Record<string, unknown>).metadata as Record<string, unknown>).$id = 'metadata-v2';
    expect((await buildOas31Fingerprints(document, idChanged))[treeKey]).not.toBe(initial[treeKey]);

    const annotationChanged = cloneJson(document);
    annotationChanged.paths['/tree'].get!.responses![200].description = 'Updated Reference annotation';
    expect((await buildOas31Fingerprints(annotationChanged, external))[treeKey]).not.toBe(initial[treeKey]);

    const localCycleChanged = cloneJson(document);
    localCycleChanged.components!.schemas!.LocalB.properties!.value = { type: 'integer' };
    const localChanged = await buildOas31Fingerprints(localCycleChanged, external);
    expect(localChanged[localKey]).not.toBe(initial[localKey]);
    expect(localChanged[treeKey]).toBe(initial[treeKey]);

    const extensionChanged = cloneJson(document);
    (extensionChanged.paths['/tree'].get as Record<string, unknown>)['x-owner'] = 'consumer';
    expect((await buildOas31Fingerprints(extensionChanged, external))[treeKey]).not.toBe(initial[treeKey]);

    const dialectChanged = cloneJson(document);
    dialectChanged.jsonSchemaDialect = 'https://json-schema.org/draft/2020-12/schema';
    expect((await buildOas31Fingerprints(dialectChanged, external))[treeKey]).not.toBe(initial[treeKey]);
  });

  it('marks only operations that can reach a changed external resource', async () => {
    const document = oas31Document();
    const external = oas31ExternalDocuments();
    const initial = await buildOas31Fingerprints(document, external);
    const treeKey = apiOperationIdentity('GET', '/tree');
    const otherKey = apiOperationIdentity('GET', '/other');
    const localKey = apiOperationIdentity('GET', '/local');

    const treeChanged = cloneJson(external);
    const treeSchema = treeChanged[OAS31_TREE_URI] as Record<string, unknown>;
    ((treeSchema.properties as Record<string, unknown>).label as Record<string, unknown>).minLength = 3;
    const afterTreeChange = await buildOas31Fingerprints(document, treeChanged);
    expect(afterTreeChange[treeKey]).not.toBe(initial[treeKey]);
    expect(afterTreeChange[otherKey]).toBe(initial[otherKey]);
    expect(afterTreeChange[localKey]).toBe(initial[localKey]);

    const otherChanged = cloneJson(external);
    (otherChanged[OAS31_OTHER_URI] as Record<string, unknown>).minLength = 5;
    const afterOtherChange = await buildOas31Fingerprints(document, otherChanged);
    expect(afterOtherChange[treeKey]).toBe(initial[treeKey]);
    expect(afterOtherChange[otherKey]).not.toBe(initial[otherKey]);
    expect(afterOtherChange[localKey]).toBe(initial[localKey]);
  });

  it('establishes a separate first baseline, then reports OAS 3.1 additions and recovered changes', async () => {
    const document = oas31Document();
    const external = oas31ExternalDocuments();
    const initial = await buildOas31Fingerprints(document, external);
    const first = reconcileApiChangeBaseline(IDENTITY, OAS31_API_CHANGE_SNAPSHOT_VERSION, initial, null);
    expect(first.initialized).toBe(true);
    expect(first.statuses).toEqual({});

    const pendingLoader = new ExternalResourceLoader(document, OAS31_ENTRY_URI, {
      pageUri: 'https://changes.knife4j.example/doc.html',
    });
    pendingLoader.discover();
    const unavailableResult = buildApiChangeFingerprintSnapshot(document, {
      status: 'ready',
      retrievalUri: OAS31_ENTRY_URI,
      snapshot: pendingLoader.currentSnapshot(),
      documentDiagnostics: [],
    });
    pendingLoader.dispose();
    expect(unavailableResult).toMatchObject({ status: 'unavailable', reason: 'resource-pending' });

    const nextDocument = cloneJson(document);
    nextDocument.paths['/added'] = {
      post: { responses: { 204: { description: 'Created' } } },
    };
    const changedExternal = cloneJson(external);
    const tree = changedExternal[OAS31_TREE_URI] as Record<string, unknown>;
    ((tree.properties as Record<string, unknown>).label as Record<string, unknown>).minLength = 4;
    const recovered = await buildOas31Fingerprints(nextDocument, changedExternal);
    const statuses = compareApiChangeBaseline(first.baseline, recovered);
    expect(statuses[apiOperationIdentity('GET', '/tree')]).toBe('changed');
    expect(statuses[apiOperationIdentity('POST', '/added')]).toBe('added');
  });

  it('pauses on pending, budget-rejected, failed, and unsupported-dialect graphs', async () => {
    const document = oas31Document();
    const pendingLoader = new ExternalResourceLoader(document, OAS31_ENTRY_URI, {
      pageUri: 'https://changes.knife4j.example/doc.html',
    });
    pendingLoader.discover();
    const pendingSnapshot = pendingLoader.currentSnapshot();
    expect(
      buildApiChangeFingerprintSnapshot(document, {
        status: 'ready',
        retrievalUri: OAS31_ENTRY_URI,
        snapshot: pendingSnapshot,
        documentDiagnostics: [],
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'resource-pending' });
    pendingLoader.dispose();

    const { snapshot: budgetSnapshot } = await oas31Snapshot(document, oas31ExternalDocuments(), {
      maxResourceBytes: 32,
    });
    expect(
      buildApiChangeFingerprintSnapshot(document, {
        status: 'ready',
        retrievalUri: OAS31_ENTRY_URI,
        snapshot: budgetSnapshot,
        documentDiagnostics: [],
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'resource-budget' });

    const unsupportedDialect = cloneJson(document);
    unsupportedDialect.jsonSchemaDialect = 'https://dialects.example/unsupported';
    expect(
      buildApiChangeFingerprintSnapshot(unsupportedDialect, {
        status: 'failed',
        retrievalUri: OAS31_ENTRY_URI,
        snapshot: null,
        documentDiagnostics: [],
        errorCode: 'DIALECT_UNSUPPORTED',
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'dialect-unsupported' });

    expect(
      buildApiChangeFingerprintSnapshot(document, {
        status: 'failed',
        retrievalUri: OAS31_ENTRY_URI,
        snapshot: null,
        documentDiagnostics: [],
        errorCode: 'UNSUPPORTED_DIALECT',
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'dialect-unsupported' });
    expect(
      buildApiChangeFingerprintSnapshot(document, {
        status: 'failed',
        retrievalUri: OAS31_ENTRY_URI,
        snapshot: null,
        documentDiagnostics: [],
        errorCode: 'RESOURCE_TOO_LARGE',
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'resource-budget' });
    expect(
      buildApiChangeFingerprintSnapshot(document, {
        status: 'failed',
        retrievalUri: OAS31_ENTRY_URI,
        snapshot: null,
        documentDiagnostics: [],
        errorCode: 'REGISTRATION_FAILED',
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'resource-failed' });
  });
});

describe('API change baselines', () => {
  it('establishes the first baseline without marking every operation as new', () => {
    const current = fingerprints();
    const result = reconcileApiChangeBaseline(IDENTITY, OAS30_API_CHANGE_SNAPSHOT_VERSION, current, null);

    expect(result.initialized).toBe(true);
    expect(result.statuses).toEqual({});
    expect(result.baseline.operations).toEqual(current);
  });

  it('distinguishes added APIs from changed Method + Path identities', () => {
    const initial = fingerprints();
    const baseline = reconcileApiChangeBaseline(IDENTITY, OAS30_API_CHANGE_SNAPSHOT_VERSION, initial, null).baseline;
    const nextDocument = apiDocument();
    nextDocument.paths['/owners'] = {
      post: {
        operationId: 'createOwner',
        summary: 'Create owner',
        tags: ['Owners'],
        responses: { '204': { description: 'Created' } },
      },
    };
    nextDocument.paths['/pets'].get!.summary = 'List all pets';
    const current = fingerprints(nextDocument);
    const statuses = compareApiChangeBaseline(baseline, current);

    expect(statuses[apiOperationIdentity('GET', '/pets')]).toBe('changed');
    expect(statuses[apiOperationIdentity('POST', '/owners')]).toBe('added');
    expect(summarizeApiChanges(statuses)).toEqual({ added: 1, changed: 1, total: 2 });
  });

  it('acknowledges one operation or the whole current group snapshot', () => {
    const baseline = reconcileApiChangeBaseline(
      IDENTITY,
      OAS30_API_CHANGE_SNAPSHOT_VERSION,
      fingerprints(),
      null,
    ).baseline;
    const nextDocument = apiDocument();
    nextDocument.paths['/pets'].get!.summary = 'List every pet';
    nextDocument.paths['/owners'] = {
      get: { summary: 'List owners', tags: ['Owners'], responses: { '200': { description: 'OK' } } },
    };
    const current = fingerprints(nextDocument);

    const acknowledgedOne = acknowledgeApiOperation(baseline, current, 'GET', '/pets');
    expect(compareApiChangeBaseline(acknowledgedOne, current)).toEqual({
      [apiOperationIdentity('GET', '/owners')]: 'added',
    });

    const acknowledgedAll = acknowledgeAllApiOperations(IDENTITY, OAS30_API_CHANGE_SNAPSHOT_VERSION, current);
    expect(compareApiChangeBaseline(acknowledgedAll, current)).toEqual({});
  });

  it('isolates baseline keys by origin, application path, group, and api-docs URL', () => {
    const originalKey = buildApiChangeBaselineStorageKey(IDENTITY, OAS30_API_CHANGE_SNAPSHOT_VERSION);
    (Object.keys(IDENTITY) as Array<keyof ApiDocumentIdentity>).forEach((field) => {
      const changed = { ...IDENTITY, [field]: `${IDENTITY[field]}-other` };
      expect(buildApiChangeBaselineStorageKey(changed, OAS30_API_CHANGE_SNAPSHOT_VERSION)).not.toBe(originalKey);
    });
    expect(buildApiChangeBaselineStorageKey(IDENTITY, OAS31_API_CHANGE_SNAPSHOT_VERSION)).not.toBe(originalKey);
  });

  it('safely rebuilds corrupt, old-version, wrong-document, and oversized caches', () => {
    const current = fingerprints();
    const baseline = reconcileApiChangeBaseline(IDENTITY, OAS30_API_CHANGE_SNAPSHOT_VERSION, current, null).baseline;
    const serialized = serializeApiChangeBaseline(baseline);
    expect(serialized).not.toBeNull();
    expect(parseApiChangeBaseline(serialized, IDENTITY, OAS30_API_CHANGE_SNAPSHOT_VERSION)).toEqual(baseline);

    expect(parseApiChangeBaseline('{broken', IDENTITY, OAS30_API_CHANGE_SNAPSHOT_VERSION)).toBeNull();
    expect(
      parseApiChangeBaseline(
        JSON.stringify({ ...baseline, version: API_CHANGE_BASELINE_VERSION - 1 }),
        IDENTITY,
        OAS30_API_CHANGE_SNAPSHOT_VERSION,
      ),
    ).toBeNull();
    expect(parseApiChangeBaseline(serialized, IDENTITY, OAS31_API_CHANGE_SNAPSHOT_VERSION)).toBeNull();
    expect(
      parseApiChangeBaseline(serialized, { ...IDENTITY, group: 'other' }, OAS30_API_CHANGE_SNAPSHOT_VERSION),
    ).toBeNull();
    expect(
      parseApiChangeBaseline(
        'x'.repeat(API_CHANGE_BASELINE_MAX_BYTES + 1),
        IDENTITY,
        OAS30_API_CHANGE_SNAPSHOT_VERSION,
      ),
    ).toBeNull();

    for (const raw of ['{broken', JSON.stringify({ ...baseline, version: API_CHANGE_BASELINE_VERSION - 1 })]) {
      const rebuilt = reconcileApiChangeBaseline(IDENTITY, OAS30_API_CHANGE_SNAPSHOT_VERSION, current, raw);
      expect(rebuilt.initialized).toBe(true);
      expect(rebuilt.statuses).toEqual({});
    }
  });
});
