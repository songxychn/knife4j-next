import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSchemaEngine } from 'knife4j-schema-engine';
import { parseLocalJsonPointer, resolveJsonPointerTokens } from 'knife4j-core';
import { apiOperationIdentity, buildApiChangeFingerprintSnapshot } from '../../apiChange/apiChangeTracker';
import { ExternalResourceLoader, type ResourceGraphSnapshot } from '../../schema/externalResourceGraph';
import type { SwaggerDoc } from '../../types/swagger';
import { buildOas31OperationOpenApiDocument } from './oas31OperationOpenApiDocument';

type JsonRecord = Record<string, unknown>;

const entryUri = 'https://fixtures.knife4j.example/apis/openapi.json';
const treeUri = 'https://fixtures.knife4j.example/apis/schemas/tree.json';
const partUri = 'https://fixtures.knife4j.example/apis/parts.json';
const strictUri = 'https://fixtures.knife4j.example/apis/schemas/strict.json';
const urnSchemaUri = 'urn:example:knife4j-schema';

function entryDocument(): SwaggerDoc {
  return {
    openapi: '3.1.1',
    jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
    info: {
      title: 'Portable export fixture',
      version: '1.0.0',
      termsOfService: './terms',
      contact: { url: './contact' },
      license: { name: 'Apache-2.0', url: './LICENSE' },
      'x-info': true,
    },
    servers: [
      {
        url: './api/{version}',
        variables: { version: { default: 'v1' } },
      },
    ],
    security: [{ ApiKey: [] }],
    'x-root': { preserved: true },
    paths: {
      '/selected': { $ref: '#/components/pathItems/Selected' },
      '/unrelated': {
        get: {
          operationId: 'unrelated',
          responses: { 200: { description: 'must not be exported' } },
        },
      },
      '/lookup': {
        get: {
          operationId: 'lookupPet',
          responses: {
            200: {
              description: 'lookup',
              content: { 'application/json': { schema: { type: 'number', minimum: 0 } } },
            },
          },
        },
      },
    },
    webhooks: {
      'pet.created': {
        post: {
          operationId: 'petCreated',
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/StrictNode' } } },
          },
          responses: { 204: { description: 'accepted' } },
        },
      },
      'pet.unrelated': {
        post: { operationId: 'unrelatedWebhook', responses: { 204: { description: 'no' } } },
      },
    },
    components: {
      pathItems: {
        Selected: {
          summary: 'Selected path item',
          servers: [{ url: './path-api' }],
          'x-path': 'preserved',
          parameters: [
            {
              $ref: './parts.json#/components/parameters/Trace',
              description: 'Parameter reference annotation',
            },
          ],
          get: { operationId: 'mustNotLeak', responses: { 200: { description: 'no' } } },
          post: {
            operationId: 'createPet',
            servers: [{ url: '../operation-api' }],
            externalDocs: { url: './guide' },
            'x-operation': 'preserved',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/StrictNode' } },
                'application/cycle+json': { schema: { $ref: '#/components/schemas/CycleA' } },
              },
            },
            responses: {
              200: {
                $ref: '#/components/responses/SelectedResponse',
                description: 'Reference annotation',
              },
            },
            callbacks: {
              changed: {
                $ref: './parts.json#/components/callbacks/Changed',
                summary: 'Ignored callback annotation',
              },
            },
          },
        },
      },
      responses: {
        SelectedResponse: {
          description: 'Selected response',
          headers: {
            Trace: {
              $ref: './parts.json#/components/headers/Trace',
              description: 'Header reference annotation',
            },
          },
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Encoded' },
              examples: {
                sample: {
                  $ref: './parts.json#/components/examples/Sample',
                  summary: 'Example reference annotation',
                },
              },
            },
          },
          links: {
            next: {
              $ref: './parts.json#/components/links/Next',
              description: 'Link reference annotation',
            },
            byId: { operationId: 'lookupPet' },
          },
        },
      },
      securitySchemes: {
        ApiKey: {
          $ref: './parts.json#/components/securitySchemes/ExternalKey',
          description: 'Security reference annotation',
        },
      },
      schemas: {
        StrictNode: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $id: 'schemas/strict.json',
          $dynamicAnchor: 'node',
          type: 'object',
          required: ['value'],
          properties: {
            value: { type: 'string' },
            label: { $ref: '#label' },
            code: { type: 'integer' },
            child: { $ref: './tree.json#node' },
          },
          $defs: {
            label: { $anchor: 'label', type: 'string' },
            'a b': { type: 'integer' },
          },
          discriminator: { propertyName: 'kind', mapping: { mapped: 'Mapped' } },
          additionalProperties: false,
        },
        Mapped: { type: 'object', properties: { mapped: { const: true } } },
        Encoded: { $ref: 'schemas/strict.json#/$defs/a%20b' },
        CycleA: { type: 'object', properties: { next: { $ref: '#/components/schemas/CycleB' } } },
        CycleB: { type: 'object', properties: { next: { $ref: '#/components/schemas/CycleA' } } },
      },
    },
  } as unknown as SwaggerDoc;
}

function externalDocuments(): Readonly<Record<string, unknown>> {
  return {
    [treeUri]: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: treeUri,
      $dynamicAnchor: 'node',
      type: 'object',
      required: ['value'],
      properties: { value: true, child: { $dynamicRef: '#node' } },
    },
    [partUri]: {
      openapi: '3.1.1',
      info: { title: 'External parts', version: '1.0.0' },
      servers: [{ url: './external-api' }],
      security: [{ ExternalKey: [] }],
      paths: {
        '/linked': {
          get: {
            operationId: 'linkedGet',
            responses: {
              200: {
                description: 'linked',
                content: { 'application/json': { schema: { type: 'string', minLength: 2 } } },
              },
            },
          },
        },
        '/external-unrelated': {
          delete: { operationId: 'externalUnrelated', responses: { 204: { description: 'no' } } },
        },
      },
      components: {
        parameters: { Trace: { name: 'trace', in: 'header', schema: { type: 'string' } } },
        headers: { Trace: { description: 'trace header', schema: { type: 'string' } } },
        requestBodies: {
          CallbackBody: {
            content: {
              'application/json': { schema: { $ref: './openapi.json#/components/schemas/StrictNode' } },
            },
          },
        },
        examples: { Sample: { externalValue: './examples/sample.json' } },
        callbacks: {
          Changed: {
            '{$request.body#/callbackUrl}': {
              $ref: '#/components/pathItems/CallbackPath',
              description: 'Callback path description',
            },
          },
        },
        links: { Next: { operationRef: '#/paths/~1linked/get' } },
        pathItems: {
          CallbackPath: {
            post: {
              operationId: 'callbackChanged',
              security: [{ ApiKey: [] }],
              requestBody: {
                $ref: '#/components/requestBodies/CallbackBody',
                description: 'Request body reference annotation',
              },
              responses: { 204: { description: 'received' } },
            },
          },
        },
        securitySchemes: {
          ExternalKey: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: './oauth/authorize',
                tokenUrl: './oauth/token',
                refreshUrl: './oauth/refresh',
                scopes: {},
              },
            },
          },
        },
      },
    },
  };
}

async function loadedSnapshot(
  document: SwaggerDoc,
): Promise<{ snapshot: ResourceGraphSnapshot; fetchSpy: ReturnType<typeof vi.fn> }> {
  const external = externalDocuments();
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const uri = String(input);
    const value = external[uri];
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
  expect(snapshot.complete).toBe(true);
  return { snapshot, fetchSpy };
}

function asReady(
  result: ReturnType<typeof buildOas31OperationOpenApiDocument>,
): Extract<NonNullable<typeof result>, { status: 'ready' }> {
  expect(result?.status).toBe('ready');
  return result as Extract<NonNullable<typeof result>, { status: 'ready' }>;
}

async function expectPortableReload(document: JsonRecord, retrievalUri: string): Promise<void> {
  const fetchSpy = vi.fn(async () => {
    throw new Error('Portable export must not fetch resources');
  });
  const loader = new ExternalResourceLoader(document, retrievalUri, { fetchImpl: fetchSpy });
  const engine = createSchemaEngine();
  try {
    expect(loader.currentSnapshot()).toMatchObject({ complete: true, diagnostics: [] });
    expect(loader.currentDiscovery().candidates).toEqual([]);
    await engine.registerDocument(document, retrievalUri);
    expect((await engine.evaluate('https://spec.openapis.org/oas/3.1/schema-base', document)).valid).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    engine.dispose();
    loader.dispose();
  }
}

function absoluteSchemaReferenceUris(document: unknown): string[] {
  const references = new Set<string>();
  const absoluteUriPattern = /^[A-Za-z][A-Za-z0-9+.-]*:/;
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const item = value as JsonRecord;
    ['$ref', '$dynamicRef'].forEach((field) => {
      const reference = item[field];
      if (typeof reference === 'string' && absoluteUriPattern.test(reference)) references.add(reference);
    });
    const mapping = (item.discriminator as JsonRecord | undefined)?.mapping;
    if (mapping && typeof mapping === 'object' && !Array.isArray(mapping)) {
      Object.values(mapping).forEach((reference) => {
        if (typeof reference === 'string' && absoluteUriPattern.test(reference)) references.add(reference);
      });
    }
    Object.values(item).forEach(visit);
  };
  visit(document);
  return [...references].sort();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OAS 3.1 portable single-operation export', () => {
  it.each(
    ['3.1.0', '3.1.1', '3.1.2'].flatMap((version) => [
      { version, external: false },
      { version, external: true },
    ]),
  )(
    'exports encoded anchors without changing retrieval identity ($version, external: $external)',
    async ({ version, external }) => {
      const resourceUri = 'https://schemas.knife4j.example/%66oo.json?source=%61';
      const anchorUri = `${external ? resourceUri : entryUri}#%66oo`;
      const anchorSchema = { $anchor: 'foo', type: 'string' };
      const resource = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: resourceUri,
        $defs: { Value: anchorSchema },
      };
      const document = {
        openapi: version,
        info: { title: 'Encoded anchor export', version: '1' },
        paths: {
          '/value': {
            get: {
              responses: {
                '200': {
                  description: 'Value',
                  content: { 'application/json': { schema: { $ref: external ? anchorUri : '#%66oo' } } },
                },
              },
            },
          },
        },
        ...(!external ? { components: { schemas: { Value: anchorSchema } } } : {}),
      } as SwaggerDoc;
      const sourceBefore = JSON.stringify(document);
      const networkFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
      const resourceFetch = vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(resourceUri);
        return new Response(JSON.stringify(resource), { headers: { 'content-type': 'application/schema+json' } });
      });
      const loader = new ExternalResourceLoader(document, entryUri, { fetchImpl: resourceFetch });
      const discovery = loader.discover();
      const snapshot = external
        ? await loader.load(
            discovery.candidates.map((candidate) => ({
              scope: 'generation' as const,
              documentScope: discovery.documentScope,
              resourceKey: candidate.retrievalUriHash,
            })),
          )
        : loader.currentSnapshot();
      expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
      expect(snapshot.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            resolvedUri: anchorUri,
            targetRetrievalUri: external ? resourceUri : entryUri,
          }),
        ]),
      );
      const original = createSchemaEngine();
      let originalResults: boolean[];
      try {
        expect((await original.evaluate('https://spec.openapis.org/oas/3.1/schema-base', document)).valid).toBe(true);
        await original.registerDocument(document, entryUri);
        if (external) await original.registerDocument(resource, resourceUri);
        originalResults = await Promise.all(
          ['ok', 1].map(async (value) => (await original.evaluate(anchorUri, value)).valid),
        );
      } finally {
        original.dispose();
      }
      const output = asReady(
        buildOas31OperationOpenApiDocument(document, '/value', 'get', 'path', {
          retrievalUri: entryUri,
          snapshot,
        }),
      ).document;
      expect(absoluteSchemaReferenceUris(output)).toContain(anchorUri);
      const fingerprints = buildApiChangeFingerprintSnapshot(document, {
        status: 'ready',
        retrievalUri: entryUri,
        snapshot,
        documentDiagnostics: [],
      });
      expect(fingerprints).toMatchObject({
        status: 'ready',
        fingerprints: { [apiOperationIdentity('GET', '/value')]: expect.any(String) },
      });
      const portableUri = 'https://portable.knife4j.example/encoded-anchor.json';
      await expectPortableReload(output, portableUri);
      const portable = createSchemaEngine();
      try {
        await portable.registerDocument(output, portableUri);
        const operation = ((output.paths as JsonRecord)['/value'] as JsonRecord).get as JsonRecord;
        const response = (operation.responses as JsonRecord)['200'] as JsonRecord;
        const schema = ((response.content as JsonRecord)['application/json'] as JsonRecord).schema as JsonRecord;
        const results = await Promise.all(
          ['ok', 1].map(async (value) => (await portable.evaluate(String(schema.$ref), value)).valid),
        );
        expect(originalResults).toEqual([true, false]);
        expect(results).toEqual(originalResults);
        expect((await portable.evaluate(anchorUri, 'ok')).valid).toBe(true);
      } finally {
        portable.dispose();
        loader.dispose();
      }
      expect(JSON.stringify(document)).toBe(sourceBefore);
      expect(resourceFetch).toHaveBeenCalledTimes(external ? 1 : 0);
      expect(networkFetch).not.toHaveBeenCalled();
    },
  );

  it.each(
    ['3.1.0', '3.1.1', '3.1.2'].flatMap((version) => [
      { version, servers: undefined },
      { version, servers: [] },
    ]),
  )('preserves the default API origin after relocation ($version, $servers)', async ({ version, servers }) => {
    const document = {
      openapi: version,
      info: { title: 'Default API server', version: '1' },
      ...(servers === undefined ? {} : { servers }),
      paths: { '/selected': { get: { responses: { '200': { description: 'OK' } } } } },
    } as SwaggerDoc;
    const validator = createSchemaEngine();
    try {
      expect((await validator.evaluate('https://spec.openapis.org/oas/3.1/schema-base', document)).valid).toBe(true);
    } finally {
      validator.dispose();
    }
    const snapshot = new ExternalResourceLoader(document, entryUri).currentSnapshot();
    const output = asReady(
      buildOas31OperationOpenApiDocument(document, '/selected', 'get', 'path', {
        retrievalUri: entryUri,
        snapshot,
      }),
    ).document;
    const portableUri = 'https://portable.knife4j.example/saved.json';
    const server = (output.servers as Array<{ url: string }> | undefined)?.[0]?.url ?? '/';
    expect(new URL(server, portableUri).href).toBe(new URL('/', entryUri).href);
    await expectPortableReload(output, portableUri);
  });

  it.each(['root', 'path', 'operation', 'multiple'] as const)(
    'keeps OAuth API references relative to the effective %s servers',
    async (scope) => {
      const servers =
        scope === 'multiple'
          ? [
              {
                url: 'https://one.example.test/{version}/',
                variables: { version: { default: 'v1', enum: ['v1', 'v2'] } },
              },
              { url: './second/' },
            ]
          : [{ url: 'https://api.example.test/v1/' }];
      const flow = { authorizationUrl: 'authorize', tokenUrl: 'token', refreshUrl: 'refresh', scopes: {} };
      const document = {
        openapi: '3.1.2',
        info: { title: 'OAuth API URLs', version: '1' },
        servers: scope === 'root' || scope === 'multiple' ? servers : [{ url: 'https://root.example.test/' }],
        security: [{ oauth: [] }],
        paths: {
          '/selected': {
            ...(scope === 'path' ? { servers } : {}),
            get: {
              ...(scope === 'operation' ? { servers } : {}),
              responses: { '200': { description: 'OK' } },
            },
          },
        },
        components: { securitySchemes: { oauth: { type: 'oauth2', flows: { authorizationCode: flow } } } },
      } as unknown as SwaggerDoc;
      const validator = createSchemaEngine();
      try {
        expect((await validator.evaluate('https://spec.openapis.org/oas/3.1/schema-base', document)).valid).toBe(true);
      } finally {
        validator.dispose();
      }
      const snapshot = new ExternalResourceLoader(document, entryUri).currentSnapshot();
      const output = asReady(
        buildOas31OperationOpenApiDocument(document, '/selected', 'get', 'path', {
          retrievalUri: entryUri,
          snapshot,
        }),
      ).document;
      const pathItem = (output.paths as JsonRecord)['/selected'] as JsonRecord;
      const operation = pathItem.get as JsonRecord;
      const outputServers = (operation.servers ?? pathItem.servers ?? output.servers) as Array<{
        url: string;
        variables?: Record<string, { default: string }>;
      }>;
      const outputScheme = ((output.components as JsonRecord).securitySchemes as JsonRecord).oauth as JsonRecord;
      const outputFlow = (outputScheme.flows as JsonRecord).authorizationCode as JsonRecord;
      expect(outputFlow).toEqual(flow);
      const portableUri = 'https://portable.knife4j.example/export.json';
      const expandServer = (
        server: { url: string; variables?: Record<string, { default: string }> },
        base: string,
        version?: string,
      ) =>
        new URL(
          server.url.replace(/\{([^{}]+)\}/g, (_match, name: string) => version ?? server.variables![name].default),
          base,
        ).href;
      for (const version of [undefined, 'v2']) {
        for (const field of ['authorizationUrl', 'tokenUrl', 'refreshUrl'] as const) {
          expect(
            outputServers.map(
              (server) => new URL(String(outputFlow[field]), expandServer(server, portableUri, version)).href,
            ),
          ).toEqual(servers.map((server) => new URL(flow[field], expandServer(server, entryUri, version)).href));
        }
      }
      if (scope === 'multiple') expect(outputServers[0].variables).toEqual(servers[0].variables);
      await expectPortableReload(output, portableUri);
    },
  );

  it.each([false, true])(
    'retains Link target path, method and inherited parameters (own servers: %s)',
    async (ownServers) => {
      const document = {
        openapi: '3.1.2',
        info: { title: 'Link target context', version: '1' },
        servers: [{ url: 'https://api.example.test/v1/' }],
        'x-knife4j-operation-ref-targets': { note: 'User extension remains opaque' },
        paths: {
          '/selected': {
            get: {
              responses: {
                '200': {
                  description: 'OK',
                  links: {
                    next: { operationRef: '#/paths/~1orders~1%7Bid%7D/get', parameters: { 'path.id': 'alpha' } },
                  },
                },
              },
            },
          },
          '/orders/{id}': {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^alpha' } }],
            servers: [{ url: './orders-api/' }],
            get: {
              operationId: 'readOrder',
              ...(ownServers ? { servers: [{ url: 'https://orders.example.test/' }] } : {}),
              responses: { '200': { description: 'Order' } },
            },
            delete: { responses: { '204': { description: 'Unrelated delete' } } },
          },
        },
      } as unknown as SwaggerDoc;
      const validator = createSchemaEngine();
      try {
        expect((await validator.evaluate('https://spec.openapis.org/oas/3.1/schema-base', document)).valid).toBe(true);
      } finally {
        validator.dispose();
      }
      const snapshot = new ExternalResourceLoader(document, entryUri).currentSnapshot();
      const output = asReady(
        buildOas31OperationOpenApiDocument(document, '/selected', 'get', 'path', {
          retrievalUri: entryUri,
          snapshot,
        }),
      ).document;
      const selected = ((output.paths as JsonRecord)['/selected'] as JsonRecord).get as JsonRecord;
      const link = (((selected.responses as JsonRecord)['200'] as JsonRecord).links as JsonRecord).next as JsonRecord;
      const tokens = parseLocalJsonPointer(String(link.operationRef)).tokens!;
      expect(tokens[0]).toBe('x-knife4j-operation-ref-targets-2');
      expect(tokens.slice(-3)).toEqual(['paths', '/orders/{id}', 'get']);
      const target = resolveJsonPointerTokens(output, tokens).value as JsonRecord;
      const parent = resolveJsonPointerTokens(output, tokens.slice(0, -1)).value as JsonRecord;
      expect(target.operationId).toBe('readOrder');
      expect(parent).not.toHaveProperty('delete');
      expect(parent.parameters).toMatchObject([{ name: 'id', in: 'path', required: true }]);
      const expectedServer = ownServers
        ? 'https://orders.example.test/'
        : 'https://fixtures.knife4j.example/apis/orders-api/';
      expect(target.servers ?? parent.servers).toEqual([{ url: expectedServer }]);
      const portableUri = 'https://portable.knife4j.example/saved.json';
      const portableGraph = new ExternalResourceLoader(output, portableUri);
      expect(portableGraph.currentSnapshot()).toMatchObject({ complete: true, diagnostics: [] });
      expect(portableGraph.currentDiscovery().candidates).toEqual([]);
      const reexport = asReady(
        buildOas31OperationOpenApiDocument(output as unknown as SwaggerDoc, '/selected', 'get', 'path', {
          retrievalUri: portableUri,
          snapshot: portableGraph.currentSnapshot(),
        }),
      ).document;
      const originalSchemaRef = `${entryUri}#/paths/~1orders~1%7Bid%7D/parameters/0/schema`;
      const original = createSchemaEngine();
      let originalResults: boolean[];
      try {
        await original.registerDocument(document, entryUri);
        originalResults = await Promise.all(
          ['alpha', 'beta'].map(async (value) => (await original.evaluate(originalSchemaRef, value)).valid),
        );
      } finally {
        original.dispose();
      }
      for (const [exported, uri] of [
        [output, portableUri],
        [reexport, 'https://second.knife4j.example/again.json'],
      ] as const) {
        const portable = createSchemaEngine();
        try {
          const exportedSelected = ((exported.paths as JsonRecord)['/selected'] as JsonRecord).get as JsonRecord;
          const exportedLink = (((exportedSelected.responses as JsonRecord)['200'] as JsonRecord).links as JsonRecord)
            .next as JsonRecord;
          const exportedTokens = parseLocalJsonPointer(String(exportedLink.operationRef)).tokens!;
          expect(exportedTokens.slice(-3)).toEqual(['paths', '/orders/{id}', 'get']);
          const exportedParent = resolveJsonPointerTokens(exported, exportedTokens.slice(0, -1)).value as JsonRecord;
          const exportedParameter = (exportedParent.parameters as JsonRecord[])[0];
          expect(exportedParameter).toMatchObject({ name: 'id', in: 'path', required: true });
          const exportedSchemaRef = (exportedParameter.schema as JsonRecord).$ref as string;
          await portable.registerDocument(exported, uri);
          const portableResults = await Promise.all(
            ['alpha', 'beta'].map(async (value) => (await portable.evaluate(exportedSchemaRef, value)).valid),
          );
          expect(originalResults).toEqual([true, false]);
          expect(portableResults).toEqual(originalResults);
          expect((await portable.evaluate('https://spec.openapis.org/oas/3.1/schema-base', exported)).valid).toBe(true);
        } finally {
          portable.dispose();
        }
      }
      portableGraph.dispose();
      await expectPortableReload(reexport, 'https://second.knife4j.example/again.json');
    },
  );

  it('blocks a Link target without a path/method context instead of inventing one from extension data', async () => {
    const document = {
      openapi: '3.1.2',
      info: { title: 'Unlocated Link operation', version: '1' },
      paths: {
        '/selected': {
          get: {
            responses: {
              '200': { description: 'OK', links: { next: { operationRef: '#/paths/~1selected/x-target/get' } } },
            },
          },
          'x-target': { get: { responses: { '200': { description: 'Operation without a callable path' } } } },
        },
      },
    } as unknown as SwaggerDoc;
    const engine = createSchemaEngine();
    const loader = new ExternalResourceLoader(document, entryUri);
    try {
      expect((await engine.evaluate('https://spec.openapis.org/oas/3.1/schema-base', document)).valid).toBe(true);
      expect(loader.currentSnapshot()).toMatchObject({ complete: true, diagnostics: [] });
      expect(
        buildOas31OperationOpenApiDocument(document, '/selected', 'get', 'path', {
          retrievalUri: entryUri,
          snapshot: loader.currentSnapshot(),
        }),
      ).toMatchObject({
        status: 'unavailable',
        blockers: [expect.objectContaining({ code: 'LINK_OPERATION_CONTEXT_UNRESOLVED' })],
      });
    } finally {
      engine.dispose();
      loader.dispose();
    }
  });

  it('requires and carries the registered dependency of a Link target inherited parameter', async () => {
    const parameterUri = 'https://fixtures.knife4j.example/apis/parameters/order-id.json';
    const parameterDocument = {
      openapi: '3.1.2',
      info: { title: 'Order parameters', version: '1' },
      components: {
        parameters: {
          OrderId: { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^order-' } },
        },
      },
    };
    const document = {
      openapi: '3.1.2',
      info: { title: 'External inherited Link parameter', version: '1' },
      paths: {
        '/selected': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                links: {
                  next: { operationRef: '#/paths/~1orders~1%7Bid%7D/get', parameters: { 'path.id': 'order-1' } },
                },
              },
            },
          },
        },
        '/orders/{id}': {
          parameters: [{ $ref: `${parameterUri}#/components/parameters/OrderId` }],
          get: { servers: [{ url: 'https://orders.example.test/' }], responses: { '200': { description: 'Order' } } },
        },
      },
    } as unknown as SwaggerDoc;
    const sourceBefore = JSON.stringify(document);
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(parameterUri);
      return new Response(JSON.stringify(parameterDocument), { headers: { 'content-type': 'application/json' } });
    });
    const loader = new ExternalResourceLoader(document, entryUri, { fetchImpl: fetchSpy });
    const original = createSchemaEngine();
    const portable = createSchemaEngine();
    try {
      for (const source of [document, parameterDocument]) {
        expect((await original.evaluate('https://spec.openapis.org/oas/3.1/schema-base', source)).valid).toBe(true);
      }
      expect(
        buildOas31OperationOpenApiDocument(document, '/selected', 'get', 'path', {
          retrievalUri: entryUri,
          snapshot: loader.currentSnapshot(),
        }),
      ).toMatchObject({
        status: 'unavailable',
        blockers: [expect.objectContaining({ code: 'RESOURCE_PENDING', resourceDisplay: parameterUri })],
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      const discovery = loader.discover();
      const snapshot = await loader.load(
        discovery.candidates.map((candidate) => ({
          scope: 'generation' as const,
          documentScope: discovery.documentScope,
          resourceKey: candidate.retrievalUriHash,
        })),
      );
      expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
      const output = asReady(
        buildOas31OperationOpenApiDocument(document, '/selected', 'get', 'path', {
          retrievalUri: entryUri,
          snapshot,
        }),
      ).document;
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(document)).toBe(sourceBefore);
      const selected = ((output.paths as JsonRecord)['/selected'] as JsonRecord).get as JsonRecord;
      const link = (((selected.responses as JsonRecord)['200'] as JsonRecord).links as JsonRecord).next as JsonRecord;
      const tokens = parseLocalJsonPointer(String(link.operationRef)).tokens!;
      const parent = resolveJsonPointerTokens(output, tokens.slice(0, -1)).value as JsonRecord;
      const parameter = (parent.parameters as JsonRecord[])[0];
      const registeredParameter = resolveJsonPointerTokens(
        output,
        parseLocalJsonPointer(String(parameter.$ref)).tokens!,
      ).value as JsonRecord;
      expect(registeredParameter).toMatchObject({ name: 'id', in: 'path', required: true });
      const portableSchemaRef = (registeredParameter.schema as JsonRecord).$ref as string;
      await original.registerDocument(document, entryUri);
      await original.registerDocument(parameterDocument, parameterUri);
      const values = ['order-1', 'invalid'];
      const originalResults = await Promise.all(
        values.map(
          async (value) =>
            (await original.evaluate(`${parameterUri}#/components/parameters/OrderId/schema`, value)).valid,
        ),
      );
      original.dispose();
      const portableUri = 'https://portable.knife4j.example/inherited-parameter.json';
      await expectPortableReload(output, portableUri);
      const importedLoader = new ExternalResourceLoader(output, portableUri);
      let reexport: JsonRecord;
      try {
        reexport = asReady(
          buildOas31OperationOpenApiDocument(output as unknown as SwaggerDoc, '/selected', 'get', 'path', {
            retrievalUri: portableUri,
            snapshot: importedLoader.currentSnapshot(),
          }),
        ).document;
      } finally {
        importedLoader.dispose();
      }
      const reselected = ((reexport.paths as JsonRecord)['/selected'] as JsonRecord).get as JsonRecord;
      const relink = (((reselected.responses as JsonRecord)['200'] as JsonRecord).links as JsonRecord)
        .next as JsonRecord;
      const reparent = resolveJsonPointerTokens(
        reexport,
        parseLocalJsonPointer(String(relink.operationRef)).tokens!.slice(0, -1),
      ).value as JsonRecord;
      const reparameter = resolveJsonPointerTokens(
        reexport,
        parseLocalJsonPointer(String((reparent.parameters as JsonRecord[])[0].$ref)).tokens!,
      ).value as JsonRecord;
      expect((reparameter.schema as JsonRecord).$ref).toBe(portableSchemaRef);
      const reexportUri = 'https://second.knife4j.example/inherited-parameter.json';
      await expectPortableReload(reexport, reexportUri);
      await portable.registerDocument(reexport, reexportUri);
      const portableResults = await Promise.all(
        values.map(async (value) => (await portable.evaluate(portableSchemaRef, value)).valid),
      );
      expect(originalResults).toEqual([true, false]);
      expect(portableResults).toEqual(originalResults);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      original.dispose();
      portable.dispose();
      loader.dispose();
    }
  });

  it('ignores operationId-shaped Paths extension payloads when resolving a Link', async () => {
    const target = { operationId: 'readOrder', responses: { '200': { description: 'Order' } } };
    const opaqueTargets = { 'target-1': { paths: { '/shadow': { get: target } } } };
    const document = {
      openapi: '3.1.2',
      info: { title: 'Opaque operation names', version: '1' },
      'x-knife4j-operation-ref-targets': opaqueTargets,
      paths: {
        '/selected': {
          get: { responses: { '200': { description: 'OK', links: { next: { operationId: 'readOrder' } } } } },
        },
        '/orders': { get: target },
        'x-business-data': { get: { ...target, description: 'Opaque, not an API operation' } },
      },
    } as unknown as SwaggerDoc;
    const engine = createSchemaEngine();
    const loader = new ExternalResourceLoader(document, entryUri);
    try {
      expect((await engine.evaluate('https://spec.openapis.org/oas/3.1/schema-base', document)).valid).toBe(true);
      const output = asReady(
        buildOas31OperationOpenApiDocument(document, '/selected', 'get', 'path', {
          retrievalUri: entryUri,
          snapshot: loader.currentSnapshot(),
        }),
      ).document;
      expect(Object.keys(output.paths as JsonRecord)).toEqual(['/selected']);
      expect(JSON.stringify(output)).not.toContain('Opaque, not an API operation');
      expect(output['x-knife4j-operation-ref-targets']).toEqual(opaqueTargets);
      await expectPortableReload(output, 'https://portable.knife4j.example/operation-id.json');
    } finally {
      engine.dispose();
      loader.dispose();
    }
  });

  it('closes path objects and compound Schema resources without copying unrelated operations', async () => {
    const document = entryDocument();
    const sourceBeforeBuild = JSON.stringify(document);
    const { snapshot, fetchSpy } = await loadedSnapshot(document);
    const requestsBeforeBuild = fetchSpy.mock.calls.length;

    const { document: output } = asReady(
      buildOas31OperationOpenApiDocument(document, '/selected', 'POST', 'path', {
        retrievalUri: entryUri,
        snapshot,
      }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(requestsBeforeBuild);
    expect(JSON.stringify(document)).toBe(sourceBeforeBuild);
    expect(output).toMatchObject({
      openapi: '3.1.1',
      jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
      info: {
        termsOfService: 'https://fixtures.knife4j.example/apis/terms',
        contact: { url: 'https://fixtures.knife4j.example/apis/contact' },
        license: { url: 'https://fixtures.knife4j.example/apis/LICENSE' },
        'x-info': true,
      },
      servers: [{ url: 'https://fixtures.knife4j.example/apis/api/{version}' }],
      security: [{ ApiKey: [] }],
      'x-root': { preserved: true },
      components: {
        securitySchemes: {
          ApiKey: { description: 'Security reference annotation' },
          ExternalKey: {
            flows: {
              authorizationCode: {
                authorizationUrl: './oauth/authorize',
                tokenUrl: './oauth/token',
                refreshUrl: './oauth/refresh',
              },
            },
          },
        },
      },
    });
    const paths = output.paths as JsonRecord;
    const selected = paths['/selected'] as JsonRecord;
    expect(Object.keys(paths)).toEqual(['/selected']);
    expect(selected.summary).toBe('Selected path item');
    expect(selected.servers).toEqual([{ url: 'https://fixtures.knife4j.example/apis/path-api' }]);
    expect(selected['x-path']).toBe('preserved');
    expect(selected).toHaveProperty('post');
    expect(selected).toHaveProperty('post.servers', [{ url: 'https://fixtures.knife4j.example/operation-api' }]);
    expect(selected).toHaveProperty('post.externalDocs.url', 'https://fixtures.knife4j.example/apis/guide');
    expect(selected).toHaveProperty('post.x-operation', 'preserved');
    expect(selected).not.toHaveProperty('get');
    expect(output).not.toHaveProperty('webhooks');

    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain('/unrelated');
    expect(serialized).not.toContain('/external-unrelated');
    expect(serialized).not.toContain('mustNotLeak');
    expect(serialized).toContain('linkedGet');

    const refTargets = output['x-knife4j-operation-ref-targets'] as JsonRecord;
    expect(Object.keys(refTargets).length).toBeGreaterThanOrEqual(7);
    expect(serialized).toContain('Reference annotation');
    expect(serialized).toContain('trace header');
    expect(serialized).not.toContain('Ignored callback annotation');
    expect(serialized).toContain('Example reference annotation');
    expect(serialized).toContain('Parameter reference annotation');
    expect(serialized).toContain('Header reference annotation');
    expect(serialized).toContain('Link reference annotation');
    expect(serialized).toContain('Request body reference annotation');
    expect(serialized).toContain('Security reference annotation');
    expect(serialized).toContain('callbackChanged');
    expect(serialized).toContain('sample');

    const targets = Object.values(refTargets) as JsonRecord[];
    const selectedResponse = targets.find((target) => target.description === 'Selected response')!;
    const byId = ((selectedResponse.links as JsonRecord).byId ?? {}) as JsonRecord;
    expect(byId).not.toHaveProperty('operationId');
    expect(byId.operationRef).toMatch(/^#\/x-knife4j-operation-ref-targets\/target-/);
    const lookup = resolveJsonPointerTokens(output, parseLocalJsonPointer(String(byId.operationRef)).tokens!).value;
    expect(lookup).toMatchObject({ operationId: 'lookupPet' });
    const linkedContainer = targets.find((target) => (target.paths as JsonRecord | undefined)?.['/linked'])!;
    const linked = ((linkedContainer.paths as JsonRecord)['/linked'] as JsonRecord).get;
    expect(linked).toMatchObject({
      servers: [{ url: 'https://fixtures.knife4j.example/apis/external-api' }],
      security: [{ ExternalKey: [] }],
    });
    expect(serialized).toContain('https://fixtures.knife4j.example/apis/examples/sample.json');

    const resources = Object.values(
      ((output['x-knife4j-schema-resources'] as JsonRecord).resources ?? {}) as JsonRecord,
    ) as JsonRecord[];
    const strict = resources.find((resource) => resource.$id === strictUri)!;
    const tree = resources.find((resource) => resource.$id === treeUri)!;
    const entry = resources.find((resource) => resource.$id === entryUri)!;
    const parts = resources.find((resource) => resource.$id === partUri)!;
    expect(strict).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $dynamicAnchor: 'node',
      properties: {
        label: { $ref: `${strictUri}#label` },
        child: { $ref: `${treeUri}#node` },
      },
      $defs: { 'a b': { type: 'integer' } },
    });
    expect((strict.discriminator as JsonRecord).mapping).toEqual({
      mapped: `${entryUri}#/components/schemas/Mapped`,
    });
    expect(tree).toMatchObject({ $dynamicAnchor: 'node', properties: { child: { $dynamicRef: `${treeUri}#node` } } });
    expect(entry).toHaveProperty('components.schemas.Mapped');
    expect(parts).toHaveProperty('components.parameters.Trace.schema');
  });

  it('prefers a root Schema $id over its retrieval alias without changing dynamic scope', async () => {
    const retrievalUri = 'https://a.example/schema.json';
    const canonicalUri = 'https://z.example/canonical.json';
    const document = {
      openapi: '3.1.1',
      info: { title: 'Root Schema id', version: '1.0.0' },
      paths: {
        '/tree': {
          get: {
            responses: {
              200: {
                description: 'Tree',
                content: { 'application/json': { schema: { $ref: retrievalUri } } },
              },
            },
          },
        },
      },
    } as unknown as SwaggerDoc;
    const externalSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: canonicalUri,
      $dynamicAnchor: 'node',
      type: 'object',
      required: ['value'],
      properties: {
        value: { type: 'string' },
        child: { $dynamicRef: `${canonicalUri}#node` },
      },
      additionalProperties: false,
    };
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) !== retrievalUri) return new Response('missing', { status: 404 });
      return new Response(JSON.stringify(externalSchema), {
        headers: { 'content-type': 'application/schema+json' },
      });
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
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    expect([...snapshot.resourceTargets.keys()]).toEqual(expect.arrayContaining([retrievalUri, canonicalUri]));
    const requestsBeforeBuild = fetchSpy.mock.calls.length;

    const output = asReady(
      buildOas31OperationOpenApiDocument(document, '/tree', 'get', 'path', {
        retrievalUri: entryUri,
        snapshot,
      }),
    ).document;
    const reversedTargetSnapshot = {
      ...snapshot,
      resourceTargets: new Map([...snapshot.resourceTargets.entries()].reverse()),
    };
    const reversedOutput = asReady(
      buildOas31OperationOpenApiDocument(document, '/tree', 'get', 'path', {
        retrievalUri: entryUri,
        snapshot: reversedTargetSnapshot,
      }),
    ).document;

    expect(fetchSpy).toHaveBeenCalledTimes(requestsBeforeBuild);
    expect(output).toEqual(reversedOutput);
    const resources = Object.values(
      ((output['x-knife4j-schema-resources'] as JsonRecord).resources ?? {}) as JsonRecord,
    ) as JsonRecord[];
    expect(resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $id: canonicalUri,
          $dynamicAnchor: 'node',
          properties: { child: { $dynamicRef: `${canonicalUri}#node` }, value: { type: 'string' } },
        }),
      ]),
    );

    const cases = [
      { value: { value: 'root', child: { value: 'leaf' } }, valid: true },
      { value: { value: 'root', child: { value: 1 } }, valid: false },
    ];
    const original = createSchemaEngine();
    await original.registerDocument(document, entryUri);
    await original.registerDocument(externalSchema, retrievalUri);
    const originalNode = await original.resolve(`${canonicalUri}#node`);
    const originalResults = await Promise.all(
      cases.map(({ value }) => original.evaluate(`${canonicalUri}#node`, value)),
    );
    original.dispose();

    const portable = createSchemaEngine();
    await portable.registerDocument(output, 'https://portable.knife4j.example/root-id.openapi.json');
    const portableNode = await portable.resolve(`${canonicalUri}#node`);
    const portableResults = await Promise.all(
      cases.map(({ value }) => portable.evaluate(`${canonicalUri}#node`, value)),
    );
    portable.dispose();
    loader.dispose();

    expect(portableNode).toMatchObject({
      canonicalUri: originalNode.canonicalUri,
      resourceUri: originalNode.resourceUri,
      dynamicAnchors: originalNode.dynamicAnchors,
    });
    expect(originalResults.map((result) => result.valid)).toEqual(cases.map(({ valid }) => valid));
    expect(portableResults.map((result) => result.valid)).toEqual(cases.map(({ valid }) => valid));
  });

  it('keeps path and read-only webhook exports in their original top-level containers', async () => {
    const document = entryDocument();
    const { snapshot } = await loadedSnapshot(document);
    const pathOutput = asReady(
      buildOas31OperationOpenApiDocument(document, '/selected', 'post', 'path', {
        retrievalUri: entryUri,
        snapshot,
      }),
    ).document;
    const webhookOutput = asReady(
      buildOas31OperationOpenApiDocument(document, 'pet.created', 'post', 'webhook', {
        retrievalUri: entryUri,
        snapshot,
      }),
    ).document;

    expect(pathOutput).toHaveProperty('paths./selected.post');
    expect(pathOutput).not.toHaveProperty('webhooks');
    expect(((webhookOutput.webhooks as JsonRecord)['pet.created'] as JsonRecord).post).toBeDefined();
    expect(webhookOutput).not.toHaveProperty('paths');
    expect(JSON.stringify(webhookOutput)).not.toContain('pet.unrelated');
  });

  it('relocates a relative Server URL nested in a Link Object', () => {
    const document = {
      openapi: '3.1.1',
      info: { title: 'Link server', version: '1.0.0' },
      paths: {
        '/selected': {
          get: {
            responses: {
              200: {
                description: 'selected',
                links: { next: { $ref: '#/components/links/Next' } },
              },
            },
          },
        },
        '/linked': {
          get: { operationId: 'linkedGet', responses: { 204: { description: 'linked' } } },
        },
      },
      components: {
        links: {
          Next: {
            operationRef: '#/paths/~1linked/get',
            server: { url: './link-api' },
          },
        },
      },
    } as unknown as SwaggerDoc;
    const snapshot = new ExternalResourceLoader(document, entryUri).currentSnapshot();
    const output = asReady(
      buildOas31OperationOpenApiDocument(document, '/selected', 'get', 'path', {
        retrievalUri: entryUri,
        snapshot,
      }),
    ).document;
    const targets = Object.values(output['x-knife4j-operation-ref-targets'] as JsonRecord);
    expect(targets).toContainEqual(
      expect.objectContaining({
        operationRef: expect.stringMatching(/^#\/x-knife4j-operation-ref-targets\/target-/),
        server: { url: 'https://fixtures.knife4j.example/apis/link-api' },
      }),
    );
  });

  it('resolves and evaluates every reachable Schema with an independent engine after relocation', async () => {
    const document = entryDocument();
    const external = externalDocuments();
    const { snapshot } = await loadedSnapshot(document);
    const output = asReady(
      buildOas31OperationOpenApiDocument(document, '/selected', 'post', 'path', {
        retrievalUri: entryUri,
        snapshot,
      }),
    ).document;
    const portableRetrievalUri = 'https://portable.knife4j.example/export.openapi.json';
    const portableGraph = new ExternalResourceLoader(output as SwaggerDoc, portableRetrievalUri);
    const portableSnapshot = portableGraph.currentSnapshot();
    expect(portableSnapshot).toMatchObject({ complete: true, diagnostics: [] });
    expect(portableGraph.currentDiscovery().candidates).toEqual([]);

    const strictValid = {
      value: 'root',
      label: 'label',
      code: 1,
      child: { value: 'child', child: { value: 'leaf' } },
    };
    const strictInvalid = {
      value: 'root',
      label: 'label',
      code: 1,
      child: { value: 'child', child: { value: 1 } },
    };
    const cases = [
      { reference: strictUri, valid: strictValid, invalid: strictInvalid },
      { reference: `${strictUri}#label`, valid: 'label', invalid: 1 },
      { reference: `${strictUri}#/$defs/a%20b`, valid: 1, invalid: '1' },
      { reference: `${treeUri}#node`, valid: { value: 'node' }, invalid: null },
      { reference: `${entryUri}#/components/schemas/Mapped`, valid: { mapped: true }, invalid: { mapped: false } },
      { reference: `${entryUri}#/components/schemas/CycleA`, valid: {}, invalid: null },
      { reference: `${entryUri}#/components/schemas/CycleB`, valid: {}, invalid: null },
      { reference: `${entryUri}#/components/schemas/Encoded`, valid: 1, invalid: '1' },
      {
        reference: `${entryUri}#/components/pathItems/Selected/post/requestBody/content/application~1json/schema`,
        valid: strictValid,
        invalid: strictInvalid,
      },
      {
        reference: `${entryUri}#/components/pathItems/Selected/post/requestBody/content/application~1cycle+json/schema`,
        valid: {},
        invalid: null,
      },
      {
        reference: `${entryUri}#/components/responses/SelectedResponse/content/application~1json/schema`,
        valid: 1,
        invalid: '1',
      },
      {
        reference: `${entryUri}#/paths/~1lookup/get/responses/200/content/application~1json/schema`,
        valid: 1,
        invalid: -1,
      },
      { reference: `${partUri}#/components/parameters/Trace/schema`, valid: 'trace', invalid: 1 },
      { reference: `${partUri}#/components/headers/Trace/schema`, valid: 'trace', invalid: 1 },
      {
        reference: `${partUri}#/paths/~1linked/get/responses/200/content/application~1json/schema`,
        valid: 'ok',
        invalid: 'x',
      },
      {
        reference: `${partUri}#/components/requestBodies/CallbackBody/content/application~1json/schema`,
        valid: strictValid,
        invalid: strictInvalid,
      },
    ];
    const references = cases.map(({ reference }) => reference);
    const coveredReferences = new Set(references);
    expect(absoluteSchemaReferenceUris(output).filter((reference) => !coveredReferences.has(reference))).toEqual([]);
    const original = createSchemaEngine();
    await original.registerDocument(document, entryUri);
    await original.registerDocument(external[treeUri], treeUri);
    await original.registerDocument(external[partUri], partUri);
    const originalNodes = await Promise.all(references.map((reference) => original.resolve(reference)));
    const originalEvaluations = await Promise.all(
      cases.flatMap(({ reference, valid, invalid }) => [
        original.evaluate(reference, valid),
        original.evaluate(reference, invalid),
      ]),
    );
    original.dispose();

    const portable = createSchemaEngine();
    await portable.registerDocument(output, portableRetrievalUri);
    const portableNodes = await Promise.all(references.map((reference) => portable.resolve(reference)));
    const portableEvaluations = await Promise.all(
      cases.flatMap(({ reference, valid, invalid }) => [
        portable.evaluate(reference, valid),
        portable.evaluate(reference, invalid),
      ]),
    );
    const portableDocumentValidation = await portable.evaluate('https://spec.openapis.org/oas/3.1/schema-base', output);
    portable.dispose();

    const normalizedDialect = (dialect: string): string =>
      dialect === 'https://spec.openapis.org/oas/3.1/schema-base'
        ? 'https://spec.openapis.org/oas/3.1/dialect/base'
        : dialect;
    expect(
      portableNodes.map(({ canonicalUri, resourceUri, dialectId, anchors, dynamicAnchors }) => ({
        canonicalUri,
        resourceUri,
        dialectId: normalizedDialect(dialectId),
        anchors: Object.keys(anchors).sort(),
        dynamicAnchors: Object.keys(dynamicAnchors).sort(),
      })),
    ).toEqual(
      originalNodes.map(({ canonicalUri, resourceUri, dialectId, anchors, dynamicAnchors }) => ({
        canonicalUri,
        resourceUri,
        dialectId: normalizedDialect(dialectId),
        anchors: Object.keys(anchors).sort(),
        dynamicAnchors: Object.keys(dynamicAnchors).sort(),
      })),
    );
    expect(portableEvaluations.map((result) => result.valid)).toEqual(
      originalEvaluations.map((result) => result.valid),
    );
    expect(portableEvaluations.map((result) => result.valid)).toEqual(cases.flatMap(() => [true, false]));
    expect(portableDocumentValidation.valid).toBe(true);
  });

  it('preserves a reachable Schema resource identified by an absolute non-HTTP URI', async () => {
    const document = {
      openapi: '3.1.1',
      info: { title: 'URN Schema', version: '1.0.0' },
      paths: {
        '/urn': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: urnSchemaUri } } },
            },
            responses: { 204: { description: 'accepted' } },
          },
        },
      },
      components: {
        schemas: {
          UrnValue: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            $id: urnSchemaUri,
            type: 'string',
            pattern: '^urn:',
          },
        },
      },
    } as unknown as SwaggerDoc;
    const snapshot = new ExternalResourceLoader(document, entryUri).currentSnapshot();
    expect(snapshot).toMatchObject({ complete: true, diagnostics: [] });
    const output = asReady(
      buildOas31OperationOpenApiDocument(document, '/urn', 'post', 'path', {
        retrievalUri: entryUri,
        snapshot,
      }),
    ).document;
    expect(absoluteSchemaReferenceUris(output)).toContain(urnSchemaUri);

    const original = createSchemaEngine();
    await original.registerDocument(document, entryUri);
    const originalNode = await original.resolve(urnSchemaUri);
    const originalValid = await original.evaluate(urnSchemaUri, 'urn:value');
    const originalInvalid = await original.evaluate(urnSchemaUri, 'value');
    original.dispose();

    const portable = createSchemaEngine();
    await portable.registerDocument(output, 'https://portable.knife4j.example/urn.openapi.json');
    const portableNode = await portable.resolve(urnSchemaUri);
    const portableValid = await portable.evaluate(urnSchemaUri, 'urn:value');
    const portableInvalid = await portable.evaluate(urnSchemaUri, 'value');
    portable.dispose();

    expect(portableNode).toMatchObject({
      canonicalUri: originalNode.canonicalUri,
      resourceUri: originalNode.resourceUri,
      dialectId: originalNode.dialectId,
    });
    expect([portableValid.valid, portableInvalid.valid]).toEqual([originalValid.valid, originalInvalid.valid]);
    expect([portableValid.valid, portableInvalid.valid]).toEqual([true, false]);
  });

  it('bundles an already loaded external boolean Schema without another request', async () => {
    const falseUri = 'https://fixtures.knife4j.example/apis/schemas/never.json';
    const document = {
      openapi: '3.1.1',
      info: { title: 'Boolean Schema', version: '1.0.0' },
      paths: {
        '/never': {
          get: {
            responses: {
              200: {
                description: 'never',
                content: { 'application/json': { schema: { $ref: './schemas/never.json' } } },
              },
            },
          },
        },
      },
    } as unknown as SwaggerDoc;
    const fetchSpy = vi.fn(
      async () => new Response('false', { headers: { 'content-type': 'application/schema+json' } }),
    );
    const loader = new ExternalResourceLoader(document, entryUri, { fetchImpl: fetchSpy });
    const discovery = loader.discover();
    const snapshot = await loader.load(
      discovery.candidates.map((candidate) => ({
        scope: 'generation' as const,
        documentScope: discovery.documentScope,
        resourceKey: candidate.retrievalUriHash,
      })),
    );
    expect(snapshot.complete).toBe(true);
    const requestCount = fetchSpy.mock.calls.length;

    const output = asReady(
      buildOas31OperationOpenApiDocument(document, '/never', 'get', 'path', {
        retrievalUri: entryUri,
        snapshot,
      }),
    ).document;
    expect(fetchSpy).toHaveBeenCalledTimes(requestCount);
    const resources = Object.values(
      ((output['x-knife4j-schema-resources'] as JsonRecord).resources ?? {}) as JsonRecord,
    ) as JsonRecord[];
    expect(resources.find((resource) => resource.$id === falseUri)).toMatchObject({ not: {} });

    const portableUri = 'https://portable.knife4j.example/boolean.openapi.json';
    const portableGraph = new ExternalResourceLoader(output as SwaggerDoc, portableUri);
    expect(portableGraph.currentSnapshot()).toMatchObject({ complete: true, diagnostics: [] });
    const original = createSchemaEngine();
    await original.registerDocument(false, falseUri);
    const originalCanonicalUri = (await original.resolve(falseUri)).canonicalUri;
    const originalValid = (await original.evaluate(falseUri, null)).valid;
    original.dispose();
    const portable = createSchemaEngine();
    await portable.registerDocument(output, portableUri);
    expect((await portable.resolve(falseUri)).canonicalUri).toBe(originalCanonicalUri);
    expect((await portable.evaluate(falseUri, null)).valid).toBe(originalValid);
    portable.dispose();
  });

  it('blocks only selected-operation missing resources and leaves unrelated pending edges alone', () => {
    const document = entryDocument();
    const localLoader = new ExternalResourceLoader(document, entryUri, {
      pageUri: 'https://fixtures.knife4j.example/doc.html',
    });
    const snapshot = localLoader.currentSnapshot();

    const selected = buildOas31OperationOpenApiDocument(document, '/selected', 'post', 'path', {
      retrievalUri: entryUri,
      snapshot,
    });
    expect(selected).toMatchObject({
      status: 'unavailable',
      blockers: expect.arrayContaining([
        expect.objectContaining({
          code: 'RESOURCE_PENDING',
          resourceDisplay: partUri,
        }),
        expect.objectContaining({
          code: 'RESOURCE_PENDING',
          resourceDisplay: treeUri,
        }),
      ]),
    });

    const localOnly = {
      ...document,
      paths: {
        '/local': { get: { security: [], responses: { 204: { description: 'ok' } } } },
        '/pending': {
          get: {
            parameters: [{ $ref: './parts.json#/components/parameters/Trace' }],
            responses: { 204: { description: 'pending elsewhere' } },
          },
        },
      },
    } as SwaggerDoc;
    const unrelatedLoader = new ExternalResourceLoader(localOnly, entryUri, {
      pageUri: 'https://fixtures.knife4j.example/doc.html',
    });
    expect(
      buildOas31OperationOpenApiDocument(localOnly, '/local', 'get', 'path', {
        retrievalUri: entryUri,
        snapshot: unrelatedLoader.currentSnapshot(),
      }),
    ).toMatchObject({ status: 'ready' });

    const danglingLink = {
      ...localOnly,
      paths: {
        '/local': {
          get: {
            security: [],
            responses: {
              200: {
                description: 'ok',
                links: { missing: { operationId: 'missingOperation' } },
              },
            },
          },
        },
      },
    } as SwaggerDoc;
    const danglingLoader = new ExternalResourceLoader(danglingLink, entryUri);
    expect(
      buildOas31OperationOpenApiDocument(danglingLink, '/local', 'get', 'path', {
        retrievalUri: entryUri,
        snapshot: danglingLoader.currentSnapshot(),
      }),
    ).toMatchObject({
      status: 'unavailable',
      blockers: [
        {
          code: 'LINK_OPERATION_ID_NOT_FOUND',
          sourcePointer: '#/paths/~1local/get/responses/200/links/missing/operationId',
        },
      ],
    });

    expect(
      buildOas31OperationOpenApiDocument(
        { ...localOnly, info: { ...localOnly.info, version: '2.0.0' } },
        '/local',
        'get',
        'path',
        {
          retrievalUri: entryUri,
          snapshot: unrelatedLoader.currentSnapshot(),
        },
      ),
    ).toMatchObject({ status: 'unavailable', blockers: [{ code: 'GRAPH_STALE', sourcePointer: '#' }] });
  });
});
