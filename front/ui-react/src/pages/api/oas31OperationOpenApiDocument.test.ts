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
                authorizationUrl: 'https://fixtures.knife4j.example/apis/oauth/authorize',
                tokenUrl: 'https://fixtures.knife4j.example/apis/oauth/token',
                refreshUrl: 'https://fixtures.knife4j.example/apis/oauth/refresh',
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
    const lookupName = String(byId.operationRef).split('/').at(-1)!;
    expect(refTargets[lookupName]).toMatchObject({ operationId: 'lookupPet' });
    const linked = targets.find((target) => target.operationId === 'linkedGet')!;
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
