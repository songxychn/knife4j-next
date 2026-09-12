import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectOas32DocumentDiagnostics, parseLocalJsonPointer, resolveJsonPointerTokens } from 'knife4j-core';
import { createSchemaEngine, OPENAPI_32_DIALECT } from 'knife4j-schema-engine';
import { parse } from 'yaml';
import { parseMenuTags } from '../../api/knife4jClient';
import { buildApiChangeFingerprintSnapshot } from '../../apiChange/apiChangeTracker';
import { ExternalResourceLoader, type ResourceGraphSnapshot } from '../../schema/externalResourceGraph';
import type { SwaggerDoc } from '../../types/swagger';
import {
  buildOas31OperationOpenApiDocument,
  buildOas32OperationOpenApiDocument,
} from './oas31OperationOpenApiDocument';
import { buildOpenApiViewState } from './openApiViewState';
import { serializeOperationOpenApiYaml } from './operationOpenApiDocument';

type JsonRecord = Record<string, unknown>;

const entryUri = 'https://fixtures.knife4j.example/apis/openapi.json';

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function valid32(extra: JsonRecord = {}): SwaggerDoc {
  const document = {
    openapi: '3.2.0',
    info: { title: 'OAS 3.2 portable export', version: '1.0.0' },
    ...extra,
  };
  expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
  return document as SwaggerDoc;
}

function snapshotOf(
  document: SwaggerDoc,
  fetchImpl?: (input: RequestInfo | URL) => Promise<Response>,
): { snapshot: ResourceGraphSnapshot; fetchSpy: ReturnType<typeof vi.fn> } {
  const fetchSpy = vi.fn(fetchImpl ?? (async () => new Response('missing', { status: 404 })));
  const loader = new ExternalResourceLoader(document, entryUri, {
    pageUri: 'https://fixtures.knife4j.example/doc.html',
    fetchImpl: fetchSpy,
  });
  return { snapshot: loader.currentSnapshot(), fetchSpy };
}

async function loadedSnapshot(
  document: SwaggerDoc,
  resources: Record<string, unknown>,
): Promise<{ snapshot: ResourceGraphSnapshot; fetchSpy: ReturnType<typeof vi.fn> }> {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const value = resources[String(input)];
    if (value === undefined) return new Response('missing', { status: 404 });
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
  });
  const loader = new ExternalResourceLoader(document, entryUri, {
    pageUri: 'https://fixtures.knife4j.example/doc.html',
    fetchImpl: fetchSpy,
  });
  const discovery = loader.discover();
  const snapshot = await loader.load(
    discovery.candidates.map((candidate) => ({
      scope: 'generation' as const,
      documentScope: discovery.documentScope,
      resourceKey: candidate.retrievalUriHash,
    })),
  );
  return { snapshot, fetchSpy };
}

function asReady(result: ReturnType<typeof buildOas32OperationOpenApiDocument>) {
  expect(result?.status).toBe('ready');
  return result as Extract<NonNullable<typeof result>, { status: 'ready' }>;
}

function exportDocument(
  document: SwaggerDoc,
  path: string,
  method: string,
  snapshot: ResourceGraphSnapshot,
  sourceKind: 'path' | 'webhook' = 'path',
) {
  return buildOas32OperationOpenApiDocument(document, path, method, sourceKind, {
    retrievalUri: entryUri,
    snapshot,
  });
}

async function expectOfflineReload(document: JsonRecord): Promise<void> {
  const fetchSpy = vi.fn(async () => {
    throw new Error('Portable export must not fetch resources');
  });
  const loader = new ExternalResourceLoader(document, 'https://offline.example/export.json', { fetchImpl: fetchSpy });
  const engine = createSchemaEngine();
  try {
    expect(loader.currentSnapshot()).toMatchObject({ complete: true, diagnostics: [] });
    expect(loader.currentDiscovery().candidates).toEqual([]);
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    await engine.registerDocument(document, 'https://offline.example/export.json');
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    engine.dispose();
    loader.dispose();
  }
}

describe('buildOas32OperationOpenApiDocument', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not let the OAS 3.1 builder accept a 3.2 document', () => {
    const document = valid32({ paths: { '/pets': { get: { responses: { 200: { description: 'ok' } } } } } });
    const { snapshot } = snapshotOf(document);
    expect(
      buildOas31OperationOpenApiDocument(document, '/pets', 'get', 'path', { retrievalUri: entryUri, snapshot }),
    ).toBeNull();
  });

  it('preserves query and case-sensitive additional methods without lowering them to get', () => {
    const document = valid32({
      paths: {
        '/methods': {
          query: { operationId: 'queryItems', responses: { 200: { description: 'queried' } } },
          additionalOperations: {
            COPY: { operationId: 'upperCopy', responses: { 200: { description: 'upper' } } },
            Copy: { operationId: 'mixedCopy', responses: { 200: { description: 'mixed' } } },
          },
        },
        '/other': { get: { operationId: 'mustNotLeak', responses: { 200: { description: 'no' } } } },
      },
    });
    const { snapshot, fetchSpy } = snapshotOf(document);
    const calls = fetchSpy.mock.calls.length;

    const query = asReady(exportDocument(document, '/methods', 'QUERY', snapshot)).document;
    const upper = asReady(exportDocument(document, '/methods', 'COPY', snapshot)).document;
    const mixed = asReady(exportDocument(document, '/methods', 'Copy', snapshot)).document;

    expect(query.openapi).toBe('3.2.0');
    expect(asRecord(asRecord(query.paths)?.['/methods'])).toMatchObject({
      query: { operationId: 'queryItems' },
    });
    expect(asRecord(asRecord(query.paths)?.['/methods'])?.get).toBeUndefined();
    expect(asRecord(asRecord(query.paths)?.['/methods'])?.additionalOperations).toBeUndefined();
    expect(asRecord(upper.paths)?.['/other']).toBeUndefined();
    expect(asRecord(asRecord(asRecord(upper.paths)?.['/methods'])?.additionalOperations)).toEqual({
      COPY: expect.objectContaining({ operationId: 'upperCopy' }),
    });
    expect(asRecord(asRecord(asRecord(mixed.paths)?.['/methods'])?.additionalOperations)).toEqual({
      Copy: expect.objectContaining({ operationId: 'mixedCopy' }),
    });
    expect(asReady(exportDocument(document, '/methods', 'QUERY', snapshot)).document).toEqual(query);
    expect(fetchSpy.mock.calls.length).toBe(calls);
  });

  it('copies $self, Media Type refs, itemSchema/Encoding, defaultMapping and URI security without fetching metadata', async () => {
    const schemeUri = 'https://auth.example.test/schemes/bearer.json';
    const document = valid32({
      $self: './contract.json#identity',
      jsonSchemaDialect: OPENAPI_32_DIALECT,
      paths: {
        '/events': {
          query: {
            security: [{ [schemeUri]: [] }],
            requestBody: {
              content: {
                'application/json-seq': { $ref: '#/components/mediaTypes/Events' },
              },
            },
            responses: {
              200: {
                description: 'ok',
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
                    examples: {
                      sample: {
                        value: { $ref: 'https://opaque.example/not-a-schema', itemSchema: { $ref: './never.json' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Known: { type: 'object', properties: { kind: { const: 'known' } } },
          Other: { type: 'object', properties: { kind: { const: 'other' } } },
        },
        mediaTypes: {
          Events: {
            schema: { type: 'array' },
            itemSchema: { type: 'integer' },
            prefixEncoding: [{ contentType: 'text/plain' }],
            itemEncoding: { contentType: 'application/json' },
          },
        },
        securitySchemes: {
          Metadata: {
            type: 'oauth2',
            oauth2MetadataUrl: '../oauth-metadata',
            flows: {},
          },
        },
      },
    });
    const scheme = { type: 'http', scheme: 'bearer' };
    const { snapshot, fetchSpy } = await loadedSnapshot(document, { [schemeUri]: scheme });
    expect(snapshot.complete).toBe(true);
    const callsAfterLoad = fetchSpy.mock.calls.length;

    const output = asReady(exportDocument(document, '/events', 'QUERY', snapshot)).document;
    expect(fetchSpy.mock.calls.length).toBe(callsAfterLoad);
    expect(output.openapi).toBe('3.2.0');
    expect(output.$self).toBe('https://fixtures.knife4j.example/apis/contract.json#identity');
    expect(output.jsonSchemaDialect).toBe(OPENAPI_32_DIALECT);

    const media = asRecord(
      asRecord(asRecord(asRecord(asRecord(asRecord(output.paths)?.['/events'])?.query)?.requestBody)?.content)?.[
        'application/json-seq'
      ],
    );
    expect(media?.$ref).toBe('#/components/mediaTypes/Events');
    const mediaTarget = asRecord(asRecord(asRecord(output.components)?.mediaTypes)?.Events);
    expect(mediaTarget).toMatchObject({
      prefixEncoding: [{ contentType: 'text/plain' }],
      itemEncoding: { contentType: 'application/json' },
    });
    expect(typeof asRecord(mediaTarget?.itemSchema)?.$ref).toBe('string');
    expect(String(asRecord(mediaTarget?.itemSchema)?.$ref)).toMatch(/^urn:knife4j:oas32-schema:/);

    const serialized = JSON.stringify(output);
    expect(serialized).toMatch(/"defaultMapping":"urn:knife4j:oas32-schema:[0-9a-f]+"/);
    expect(serialized).toMatch(/"known":"urn:knife4j:oas32-schema:[0-9a-f]+"/);

    const exampleValue = asRecord(
      asRecord(
        asRecord(asRecord(asRecord(asRecord(asRecord(output.paths)?.['/events'])?.query)?.responses)?.['200'])?.content,
      )?.['application/json'],
    );
    expect(asRecord(asRecord(asRecord(exampleValue?.examples)?.sample)?.value)).toEqual({
      $ref: 'https://opaque.example/not-a-schema',
      itemSchema: { $ref: './never.json' },
    });

    const schemes = asRecord(asRecord(output.components)?.securitySchemes);
    expect(Object.values(schemes ?? {})).toEqual([expect.objectContaining({ type: 'http', scheme: 'bearer' })]);
    expect(asRecord(asRecord(asRecord(output.paths)?.['/events'])?.query)?.security).toEqual([
      expect.objectContaining({ UriScheme: [] }),
    ]);

    await expectOfflineReload(output);
    const yaml = serializeOperationOpenApiYaml(output);
    expect(parse(yaml)).toMatchObject({ openapi: '3.2.0', $self: output.$self });
    expect(yaml).toContain('query:');
    expect(yaml).not.toContain('openapi: 3.1');
  });

  it('copies nested Encoding Media Type refs into components.mediaTypes', async () => {
    const document = valid32({
      paths: {
        '/upload': {
          post: {
            requestBody: {
              content: {
                'multipart/mixed': { $ref: '#/components/mediaTypes/Multipart' },
              },
            },
            responses: { 200: { description: 'ok' } },
          },
        },
      },
      components: {
        mediaTypes: {
          JsonString: { schema: { type: 'string' } },
          Multipart: {
            schema: {
              type: 'array',
              prefixItems: [{ type: 'string' }],
              items: { type: 'array', items: { type: 'string' } },
            },
            prefixEncoding: [
              {
                contentType: 'text/plain',
                headers: {
                  'X-Part': { content: { 'text/plain': { $ref: '#/components/mediaTypes/JsonString' } } },
                },
              },
            ],
            itemEncoding: {
              contentType: 'multipart/mixed',
              itemEncoding: {
                contentType: 'text/plain',
                headers: {
                  'X-Context': {
                    content: { 'application/json': { $ref: '#/components/mediaTypes/JsonString' } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const { snapshot } = snapshotOf(document);
    const output = asReady(exportDocument(document, '/upload', 'post', snapshot)).document;
    const mediaTypes = asRecord(asRecord(output.components)?.mediaTypes);
    expect(String(asRecord(asRecord(mediaTypes?.JsonString)?.schema)?.$ref)).toMatch(/^urn:knife4j:oas32-schema:/);
    const multipart = asRecord(mediaTypes?.Multipart);
    const prefixHeader = asRecord(
      asRecord(asRecord(asRecord((multipart?.prefixEncoding as unknown[])?.[0])?.headers)?.['X-Part'])?.content,
    )?.['text/plain'];
    const nestedHeader = asRecord(
      asRecord(asRecord(asRecord(asRecord(multipart?.itemEncoding)?.itemEncoding)?.headers)?.['X-Context'])?.content,
    )?.['application/json'];
    expect(asRecord(prefixHeader)?.$ref).toBe('#/components/mediaTypes/JsonString');
    expect(asRecord(nestedHeader)?.$ref).toBe('#/components/mediaTypes/JsonString');
    await expectOfflineReload(output);
  });

  it('relocates additionalOperations link targets with path-item parameters', () => {
    const document = valid32({
      paths: {
        '/selected': {
          query: {
            responses: {
              200: {
                description: 'ok',
                links: {
                  next: { operationRef: '#/paths/~1items~1%7Bid%7D/additionalOperations/COPY' },
                },
              },
            },
          },
        },
        '/items/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          additionalOperations: {
            COPY: { operationId: 'copyItem', responses: { 200: { description: 'copied' } } },
            Copy: { operationId: 'mustNotLeak', responses: { 200: { description: 'mixed' } } },
          },
        },
      },
    });
    const { snapshot } = snapshotOf(document);
    const output = asReady(exportDocument(document, '/selected', 'QUERY', snapshot)).document;
    const selected = asRecord(asRecord(output.paths)?.['/selected'])?.query as JsonRecord;
    const link = asRecord(asRecord(asRecord(asRecord(selected.responses)?.['200'])?.links)?.next);
    const tokens = parseLocalJsonPointer(String(link?.operationRef)).tokens!;
    expect(tokens.slice(-4)).toEqual(['paths', '/items/{id}', 'additionalOperations', 'COPY']);
    const target = asRecord(resolveJsonPointerTokens(output, tokens).value);
    const parent = asRecord(resolveJsonPointerTokens(output, tokens.slice(0, -2)).value);
    expect(target?.operationId).toBe('copyItem');
    expect(parent?.parameters).toMatchObject([{ name: 'id', in: 'path', required: true }]);
    expect(asRecord(asRecord(parent?.additionalOperations)?.COPY)?.operationId).toBe('copyItem');
    expect(asRecord(parent?.additionalOperations)?.Copy).toBeUndefined();
    expect(parent?.query).toBeUndefined();
  });

  it('copies oauth2MetadataUrl as a portable URI without fetching it', () => {
    const document = valid32({
      paths: {
        '/secure': {
          get: {
            security: [{ Metadata: [] }],
            responses: { 200: { description: 'ok' } },
          },
        },
      },
      components: {
        securitySchemes: {
          Metadata: { type: 'oauth2', oauth2MetadataUrl: '../oauth-metadata', flows: {} },
        },
      },
    });
    const { snapshot, fetchSpy } = snapshotOf(document);
    const output = asReady(exportDocument(document, '/secure', 'get', snapshot)).document;
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(asRecord(asRecord(asRecord(output.components)?.securitySchemes)?.Metadata)).toMatchObject({
      oauth2MetadataUrl: 'https://fixtures.knife4j.example/oauth-metadata',
    });
  });

  it('fails closed when a required resource is still pending', () => {
    const document = valid32({
      paths: {
        '/pets': {
          query: {
            responses: {
              200: {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: './missing.json' } } },
              },
            },
          },
        },
      },
    });
    const { snapshot } = snapshotOf(document);
    const result = exportDocument(document, '/pets', 'QUERY', snapshot);
    expect(result).toMatchObject({
      status: 'unavailable',
      blockers: [expect.objectContaining({ code: 'RESOURCE_PENDING' })],
    });
  });

  it('fails when the graph digest no longer matches the document', () => {
    const document = valid32({
      paths: { '/pets': { query: { responses: { 200: { description: 'ok' } } } } },
    });
    const { snapshot } = snapshotOf(document);
    const stale = { ...document, info: { title: 'Changed', version: '2' } } as SwaggerDoc;
    expect(exportDocument(stale, '/pets', 'QUERY', snapshot)).toMatchObject({
      status: 'unavailable',
      blockers: [expect.objectContaining({ code: 'GRAPH_STALE' })],
    });
  });

  it('keeps change fingerprints disabled for OAS 3.2', () => {
    const document = valid32({
      paths: { '/pets': { query: { responses: { 200: { description: 'ok' } } } } },
    });
    const { snapshot } = snapshotOf(document);
    expect(
      buildApiChangeFingerprintSnapshot(document, {
        status: 'ready',
        retrievalUri: entryUri,
        snapshot,
        documentDiagnostics: [],
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'version-unsupported' });
  });

  it('distinguishes the raw entry document from the single-operation portable snapshot', () => {
    const document = valid32({
      paths: {
        '/selected': { query: { operationId: 'selected', responses: { 200: { description: 'ok' } } } },
        '/other': { get: { operationId: 'other', responses: { 200: { description: 'no' } } } },
      },
    });
    const { snapshot } = snapshotOf(document);
    const portable = asReady(exportDocument(document, '/selected', 'QUERY', snapshot)).document;
    const rawYaml = serializeOperationOpenApiYaml(document);
    const portableYaml = serializeOperationOpenApiYaml(portable);
    expect(rawYaml).toContain('/other');
    expect(portableYaml).not.toContain('/other');
    expect(portableYaml).toContain('/selected');
    expect(asRecord(portable.paths)?.['/other']).toBeUndefined();
  });
});

describe('OAS 3.2 OpenAPI view wiring', () => {
  it('downloads COPY by identity and keeps sibling methods out of the snapshot', () => {
    const document = valid32({
      paths: {
        '/methods': {
          query: { responses: { 200: { description: 'query' } } },
          additionalOperations: {
            COPY: { operationId: 'upperCopy', responses: { 200: { description: 'upper' } } },
            Copy: { operationId: 'mixedCopy', responses: { 200: { description: 'mixed' } } },
          },
        },
      },
    });
    const { snapshot } = snapshotOf(document);
    const operation = parseMenuTags(document, { retrievalUri: entryUri })
      .flatMap((tag) => tag.operations)
      .find((item) => item.method === 'COPY');
    expect(operation).toBeDefined();
    const state = buildOpenApiViewState(document, operation, {
      status: 'ready',
      retrievalUri: entryUri,
      snapshot,
    });
    expect(state).toMatchObject({ status: 'ready', downloadable: true, notice: null });
    const output = JSON.parse(state.status === 'ready' ? state.json : '{}');
    expect(output.paths['/methods'].additionalOperations).toEqual({
      COPY: expect.objectContaining({ operationId: 'upperCopy' }),
    });
    expect(output.paths['/methods'].query).toBeUndefined();
    expect(output.paths['/methods'].additionalOperations.Copy).toBeUndefined();
  });
});
