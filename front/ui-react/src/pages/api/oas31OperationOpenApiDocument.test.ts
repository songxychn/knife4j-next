import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSchemaEngine } from 'knife4j-schema-engine';
import { ExternalResourceLoader, type ResourceGraphSnapshot } from '../../schema/externalResourceGraph';
import type { SwaggerDoc } from '../../types/swagger';
import { buildOas31OperationOpenApiDocument } from './oas31OperationOpenApiDocument';

type JsonRecord = Record<string, unknown>;

const entryUri = 'https://fixtures.knife4j.example/apis/openapi.json';
const treeUri = 'https://fixtures.knife4j.example/apis/schemas/tree.json';
const partUri = 'https://fixtures.knife4j.example/apis/parts.json';
const strictUri = 'https://fixtures.knife4j.example/apis/schemas/strict.json';

function entryDocument(): SwaggerDoc {
  return {
    openapi: '3.1.1',
    jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
    info: { title: 'Portable export fixture', version: '1.0.0', 'x-info': true },
    servers: [{ url: 'https://api.knife4j.example' }],
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
          servers: [{ url: 'https://path.knife4j.example' }],
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
            servers: [{ url: 'https://operation.knife4j.example' }],
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
        Encoded: { $ref: '#/components/schemas/StrictNode/$defs/a%20b' },
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
        examples: { Sample: { value: { id: 'sample' } } },
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
              security: [{ ExternalKey: [] }],
              requestBody: {
                $ref: '#/components/requestBodies/CallbackBody',
                description: 'Request body reference annotation',
              },
              responses: { 204: { description: 'received' } },
            },
          },
        },
        securitySchemes: {
          ExternalKey: { type: 'apiKey', in: 'header', name: 'X-External-Key' },
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OAS 3.1 portable single-operation export', () => {
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
      info: { 'x-info': true },
      servers: [{ url: 'https://api.knife4j.example' }],
      security: [{ ApiKey: [] }],
      'x-root': { preserved: true },
      components: {
        securitySchemes: {
          ApiKey: { description: 'Security reference annotation' },
          ExternalKey: { name: 'X-External-Key' },
        },
      },
    });
    const paths = output.paths as JsonRecord;
    const selected = paths['/selected'] as JsonRecord;
    expect(Object.keys(paths)).toEqual(['/selected']);
    expect(selected.summary).toBe('Selected path item');
    expect(selected.servers).toEqual([{ url: 'https://path.knife4j.example' }]);
    expect(selected['x-path']).toBe('preserved');
    expect(selected).toHaveProperty('post');
    expect(selected).toHaveProperty('post.servers', [{ url: 'https://operation.knife4j.example' }]);
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
    expect(portableGraph.currentSnapshot()).toMatchObject({ complete: true, diagnostics: [] });
    expect(portableGraph.currentDiscovery().candidates).toEqual([]);

    const references = [
      strictUri,
      `${strictUri}#label`,
      `${strictUri}#/$defs/a%20b`,
      `${treeUri}#node`,
      `${entryUri}#/components/schemas/Mapped`,
      `${entryUri}#/components/schemas/CycleA`,
      `${entryUri}#/components/schemas/CycleB`,
      `${partUri}#/components/parameters/Trace/schema`,
    ];
    const cases = [
      {
        reference: strictUri,
        valid: { value: 'root', label: 'label', code: 1, child: { value: 'child', child: { value: 'leaf' } } },
        invalid: { value: 'root', label: 'label', code: 1, child: { value: 'child', child: { value: 1 } } },
      },
      { reference: `${strictUri}#label`, valid: 'label', invalid: 1 },
      { reference: `${strictUri}#/$defs/a%20b`, valid: 1, invalid: '1' },
      { reference: `${treeUri}#node`, valid: { value: 'node' }, invalid: null },
      { reference: `${entryUri}#/components/schemas/Mapped`, valid: { mapped: true }, invalid: { mapped: false } },
      { reference: `${entryUri}#/components/schemas/CycleA`, valid: {}, invalid: null },
      { reference: `${entryUri}#/components/schemas/CycleB`, valid: {}, invalid: null },
      { reference: `${partUri}#/components/parameters/Trace/schema`, valid: 'trace', invalid: 1 },
    ];

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
