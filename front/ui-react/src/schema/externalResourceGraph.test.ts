import { describe, expect, test, vi } from 'vitest';
import { sha256Hex } from '../apiChange/apiChangeTracker';
import {
  ExternalResourceLoader,
  parseExternalResourceDocument,
  safeResourceDisplay,
  type ResourceGrant,
} from './externalResourceGraph';

const entryUri = 'https://docs.knife4j.example/v3/api-docs';
const pageUri = 'https://docs.knife4j.example/doc.html';

const entryDocument = (schemas: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  openapi: '3.1.1',
  info: { title: 'Resource graph fixture', version: '1.0.0' },
  paths: {},
  components: { schemas },
  ...extra,
});

const grant = (loader: ExternalResourceLoader, uri: string): ResourceGrant => ({
  scope: 'generation',
  documentScope: loader.documentScope,
  resourceKey: sha256Hex(uri),
});

describe('resource graph discovery and exact grants', () => {
  test('keeps same-origin and cross-origin references pending with zero requests by default', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const loader = new ExternalResourceLoader(
      entryDocument({
        Same: { $ref: './schemas/same.json' },
        Cross: { $ref: 'https://schemas.example.test/cross.json' },
      }),
      entryUri,
      { pageUri, fetchImpl },
    );

    const discovery = loader.discover();
    expect(discovery.candidates).toHaveLength(2);
    expect(discovery.candidates.map((candidate) => candidate.sameOrigin)).toEqual([true, false]);
    expect(fetchImpl).not.toHaveBeenCalled();

    const snapshot = await loader.load([]);
    expect(snapshot.nodes.size).toBe(1);
    expect(snapshot.complete).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('deduplicates fragments, parses the complete document, and indexes retrieval and canonical ids', async () => {
    const resourceUri = 'https://schemas.example.test/common.json';
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            $id: 'https://canonical.example.test/common',
            $defs: {
              A: { type: 'string' },
              B: { $anchor: 'namedB', type: 'integer' },
            },
          }),
          { headers: { 'content-type': 'application/schema+json' } },
        ),
    );
    const loader = new ExternalResourceLoader(
      entryDocument({
        A: { $ref: `${resourceUri}#/$defs/A` },
        B: { $ref: `${resourceUri}#/$defs/B` },
      }),
      entryUri,
      { pageUri, fetchImpl },
    );

    const snapshot = await loader.load([grant(loader, resourceUri)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.edges).toHaveLength(2);
    expect(snapshot.edges.every((edge) => edge.state === 'loaded')).toBe(true);
    expect(snapshot.nodes.get(resourceUri)?.resourceUris).toEqual(
      expect.arrayContaining([resourceUri, 'https://canonical.example.test/common']),
    );
    expect(Object.isFrozen(snapshot.nodes.get(resourceUri)?.document)).toBe(true);
  });

  test('uses embedded ids as the base for relative refs and resolves local anchors and dynamic anchors', async () => {
    const root = 'https://schemas.example.test/root.json';
    const child = 'https://schemas.example.test/nested/child.json';
    const requested: string[] = [];
    const loader = new ExternalResourceLoader(entryDocument({ Root: { $ref: `${root}#/$defs/Embedded` } }), entryUri, {
      pageUri,
      fetchImpl: async (input) => {
        requested.push(String(input));
        return String(input) === root
          ? new Response(
              JSON.stringify({
                $defs: {
                  Embedded: {
                    $id: 'nested/',
                    $anchor: 'inside',
                    $dynamicAnchor: 'node',
                    type: 'object',
                    properties: {
                      relative: { $ref: 'child.json' },
                      anchored: { $ref: '#inside' },
                      dynamic: { $dynamicRef: '#node' },
                    },
                  },
                },
              }),
              { headers: { 'content-type': 'application/schema+json' } },
            )
          : new Response('{"type":"string"}', { headers: { 'content-type': 'application/schema+json' } });
      },
    });

    const snapshot = await loader.load([grant(loader, root), grant(loader, child)]);
    expect(requested).toEqual([root, child]);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.nodes.get(root)?.resourceUris).toEqual(
      expect.arrayContaining([root, 'https://schemas.example.test/nested/']),
    );
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'schema-ref', targetRetrievalUri: child, state: 'loaded' }),
        expect.objectContaining({ kind: 'schema-ref', fragment: '#inside', state: 'local' }),
        expect.objectContaining({ kind: 'schema-dynamic-ref', fragment: '#node', state: 'local' }),
      ]),
    );
  });

  test('discovers only protocol resource edges, not link-only OpenAPI URLs', () => {
    const loader = new ExternalResourceLoader(
      entryDocument(
        {
          Pet: {
            type: 'object',
            discriminator: {
              propertyName: 'kind',
              mapping: {
                localName: 'Pet',
                external: './schemas/dog.json#/Dog',
              },
            },
          },
        },
        {
          externalDocs: { url: 'https://links.example.test/docs' },
          servers: [{ url: 'https://api.example.test' }],
          components: {
            schemas: {
              Pet: {
                type: 'object',
                discriminator: {
                  propertyName: 'kind',
                  mapping: { localName: 'Pet', external: './schemas/dog.json#/Dog' },
                },
              },
            },
            examples: { Pet: { externalValue: 'https://links.example.test/example.json' } },
          },
        },
      ),
      entryUri,
      { pageUri },
    );

    const candidates = loader.discover().candidates;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].displayUri).toContain('/schemas/dog.json');
    expect(candidates[0].references[0].kind).toBe('discriminator-mapping');
  });

  test('rejects userinfo, file, and mixed-content targets before any request', () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const loader = new ExternalResourceLoader(
      entryDocument({
        Userinfo: { $ref: 'https://u:p@schemas.example.test/a.json' },
        File: { $ref: 'file:///tmp/a.json' },
        Mixed: { $ref: 'http://schemas.example.test/a.json' },
      }),
      entryUri,
      { pageUri, fetchImpl },
    );
    const discovery = loader.discover();

    expect(discovery.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'RESOURCE_URI_CREDENTIALS_FORBIDDEN',
        'RESOURCE_SCHEME_UNSUPPORTED',
        'RESOURCE_MIXED_CONTENT_BLOCKED',
      ]),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('redacts URL credentials and query values from every display identity', () => {
    const display = safeResourceDisplay('https://user:secret@schemas.example.test/pet.json?token=secret#Pet');
    expect(display).toBe('https://schemas.example.test/pet.json?…#Pet');
    expect(display).not.toMatch(/user|secret|token/);
  });
});

describe('complete JSON/YAML parsing and graph budgets', () => {
  test('rejects duplicate JSON keys, trailing content, YAML merge/custom tags, and multiple YAML documents', () => {
    const limits = { maxParsedNodesPerDocument: 1000, maxDepth: 32, maxYamlAliases: 100 };
    expect(() =>
      parseExternalResourceDocument(
        { mediaType: { format: 'json', legacy: false, essence: 'application/json' }, text: '{"a":1,"a":2}' },
        limits,
      ),
    ).toThrow(expect.objectContaining({ code: 'DOCUMENT_PARSE_FAILED' }));
    expect(() =>
      parseExternalResourceDocument(
        { mediaType: { format: 'json', legacy: false, essence: 'application/json' }, text: '{} trailing' },
        limits,
      ),
    ).toThrow(expect.objectContaining({ code: 'DOCUMENT_PARSE_FAILED' }));
    expect(() =>
      parseExternalResourceDocument(
        { mediaType: { format: 'json', legacy: false, essence: 'application/json' }, text: '\u00a0{}' },
        limits,
      ),
    ).toThrow(expect.objectContaining({ code: 'DOCUMENT_PARSE_FAILED' }));
    for (const text of [
      'base: &base { a: 1 }\nvalue:\n  <<: *base\n',
      'value: !custom test\n',
      '---\na: 1\n---\nb: 2\n',
    ]) {
      expect(() =>
        parseExternalResourceDocument(
          { mediaType: { format: 'yaml', legacy: false, essence: 'application/yaml' }, text },
          limits,
        ),
      ).toThrow(expect.objectContaining({ code: 'DOCUMENT_PARSE_FAILED' }));
    }
  });

  test('loads safe YAML and reports a legacy media type without exposing query values', async () => {
    const resourceUri = 'https://schemas.example.test/pet.yaml?token=secret';
    const loader = new ExternalResourceLoader(entryDocument({ Pet: { $ref: `${resourceUri}#/Pet` } }), entryUri, {
      pageUri,
      fetchImpl: async () =>
        new Response('Pet:\n  type: object\n  properties:\n    id:\n      type: integer\n', {
          headers: { 'content-type': 'text/yaml' },
        }),
    });
    const discovery = loader.discover();
    expect(discovery.candidates[0].displayUri).toContain('?…');
    expect(discovery.candidates[0].displayUri).not.toContain('secret');

    const snapshot = await loader.load([grant(loader, resourceUri)]);
    expect(snapshot.nodes.get(resourceUri)?.document).toMatchObject({ Pet: { type: 'object' } });
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'LEGACY_MEDIA_TYPE' })]),
    );
  });

  test('aborts a graph-wide document budget before issuing the next request and discards partial nodes', async () => {
    const first = 'https://schemas.example.test/a.json';
    const second = 'https://schemas.example.test/b.json';
    const fetchImpl = vi.fn(
      async () => new Response('{"type":"string"}', { headers: { 'content-type': 'application/schema+json' } }),
    );
    const loader = new ExternalResourceLoader(entryDocument({ A: { $ref: first }, B: { $ref: second } }), entryUri, {
      pageUri,
      fetchImpl,
      limits: { maxDocuments: 1 },
    });

    const snapshot = await loader.load([grant(loader, first), grant(loader, second)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(snapshot.nodes.size).toBe(1);
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'GRAPH_RESOURCE_LIMIT' })]),
    );
  });

  test('deduplicates a cross-resource cycle and fetches each exact URI once', async () => {
    const a = 'https://schemas.example.test/a.json';
    const b = 'https://schemas.example.test/b.json';
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const uri = String(input);
      return new Response(JSON.stringify({ $ref: uri === a ? b : a }), {
        headers: { 'content-type': 'application/schema+json' },
      });
    });
    const loader = new ExternalResourceLoader(entryDocument({ Cycle: { $ref: a } }), entryUri, {
      pageUri,
      fetchImpl,
    });

    const snapshot = await loader.load([grant(loader, a), grant(loader, b)]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(snapshot.nodes.size).toBe(3);
    expect(snapshot.complete).toBe(true);
  });

  test('reports duplicate canonical ids instead of silently replacing the first owner', async () => {
    const a = 'https://schemas.example.test/a.json';
    const b = 'https://schemas.example.test/b.json';
    const canonical = 'https://schemas.example.test/canonical';
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ $id: canonical, type: 'string' }), {
          headers: { 'content-type': 'application/schema+json' },
        }),
    );
    const loader = new ExternalResourceLoader(entryDocument({ A: { $ref: a }, B: { $ref: b } }), entryUri, {
      pageUri,
      fetchImpl,
    });

    const snapshot = await loader.load([grant(loader, a), grant(loader, b)]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(snapshot.nodes.size).toBe(2);
    expect(snapshot.complete).toBe(false);
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'RESOURCE_URI_CONFLICT', phase: 'index' })]),
    );
  });

  test('rejects unsupported external dialects as a resource-level diagnostic', async () => {
    const resourceUri = 'https://schemas.example.test/custom.json';
    const loader = new ExternalResourceLoader(entryDocument({ Custom: { $ref: resourceUri } }), entryUri, {
      pageUri,
      fetchImpl: async () =>
        new Response('{"$schema":"https://dialects.example.test/custom","type":"string"}', {
          headers: { 'content-type': 'application/schema+json' },
        }),
    });

    const snapshot = await loader.load([grant(loader, resourceUri)]);
    expect(snapshot.nodes.size).toBe(1);
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DIALECT_UNSUPPORTED', phase: 'index' })]),
    );
  });

  test('enforces graph depth before the next request and discards the partial graph', async () => {
    const uris = Array.from({ length: 7 }, (_, index) => `https://schemas.example.test/depth-${index}.json`);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const index = uris.indexOf(String(input));
      return new Response(JSON.stringify(index < uris.length - 1 ? { $ref: uris[index + 1] } : { type: 'string' }), {
        headers: { 'content-type': 'application/schema+json' },
      });
    });
    const loader = new ExternalResourceLoader(entryDocument({ A: { $ref: uris[0] } }), entryUri, {
      pageUri,
      fetchImpl,
      limits: { maxDepth: 5 },
    });

    const snapshot = await loader.load(uris.map((uri) => grant(loader, uri)));
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(snapshot.nodes.size).toBe(1);
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'GRAPH_DEPTH_LIMIT' })]),
    );
  });
});

describe('bounded scheduling, cancellation, retry, and generation isolation', () => {
  test('caps concurrent GET requests at the configured scheduler limit', async () => {
    const uris = Array.from({ length: 6 }, (_, index) => `https://schemas.example.test/${index}.json`);
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          releases.push(() => {
            active -= 1;
            resolve(new Response('{"type":"string"}', { headers: { 'content-type': 'application/schema+json' } }));
          });
        }),
    );
    const loader = new ExternalResourceLoader(
      entryDocument(Object.fromEntries(uris.map((uri, index) => [`Schema${index}`, { $ref: uri }]))),
      entryUri,
      { pageUri, fetchImpl, limits: { maxConcurrency: 4 } },
    );

    const loading = loader.load(uris.map((uri) => grant(loader, uri)));
    await vi.waitFor(() => expect(releases).toHaveLength(4));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());
    const snapshot = await loading;

    expect(maxActive).toBe(4);
    expect(snapshot.complete).toBe(true);
  });

  test('cancels an in-flight generation without surfacing cancellation as a failure', async () => {
    const resourceUri = 'https://schemas.example.test/slow.json';
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
            once: true,
          });
        }),
    );
    const loader = new ExternalResourceLoader(entryDocument({ Slow: { $ref: resourceUri } }), entryUri, {
      pageUri,
      fetchImpl,
    });

    const loading = loader.load([grant(loader, resourceUri)]);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    loader.cancel();
    const snapshot = await loading;

    expect(snapshot.nodes.size).toBe(1);
    expect(snapshot.diagnostics.some((diagnostic) => diagnostic.code === 'RESOURCE_ABORTED')).toBe(false);
  });

  test('allows one explicit retry, keeps its byte/request budget, and advances generation', async () => {
    const resourceUri = 'https://schemas.example.test/retry.json';
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 503, headers: { 'content-type': 'application/schema+json' } }),
    );
    const loader = new ExternalResourceLoader(entryDocument({ Retry: { $ref: resourceUri } }), entryUri, {
      pageUri,
      fetchImpl,
    });

    const first = await loader.load([grant(loader, resourceUri)]);
    const second = await loader.retry(sha256Hex(resourceUri));
    const third = await loader.retry(sha256Hex(resourceUri));

    expect(second.generation).toBeGreaterThan(first.generation);
    expect(third.generation).toBe(second.generation);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('does not reuse response bodies across grant generations', async () => {
    const resourceUri = 'https://schemas.example.test/generation.json';
    const fetchImpl = vi.fn(
      async () => new Response('{"type":"string"}', { headers: { 'content-type': 'application/schema+json' } }),
    );
    const loader = new ExternalResourceLoader(entryDocument({ Value: { $ref: resourceUri } }), entryUri, {
      pageUri,
      fetchImpl,
    });

    const first = await loader.load([grant(loader, resourceUri)]);
    const second = await loader.load([grant(loader, resourceUri)]);

    expect(second.generation).toBeGreaterThan(first.generation);
    expect(second.nodes.get(resourceUri)?.authorizationScope).toBe('generation');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
