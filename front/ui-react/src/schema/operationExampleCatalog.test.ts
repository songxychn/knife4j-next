import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  buildOperationDebugModel,
  buildRequest,
  collectOas32DocumentDiagnostics,
  exampleParameterInput,
} from 'knife4j-core';
import { parseMenuTags } from '../api/knife4jClient';
import type { SwaggerDoc } from '../types/swagger';
import {
  ExternalResourceLoader,
  schemaDocumentsFromResourceGraph,
  schemaRegistrationContextFromResourceGraph,
} from './externalResourceGraph';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import {
  evaluateOperationExample,
  exampleDebugModel,
  exampleDefaultTarget,
  isOas32ExampleDocument,
  locateOperationExampleCatalog,
} from './operationExampleCatalog';
import { sha256Hex } from '../utils/stableJson';

const uri = 'https://retrieval.example/entry.json';
const sessions: SchemaDocumentSession[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});
function fixture(version = '3.2.0'): SwaggerDoc {
  return {
    openapi: version,
    info: { title: 'Synthetic Example Object contract', version: '1' },
    paths: {
      '/items': {
        additionalOperations: {
          'copy%41': {
            parameters: [
              {
                name: 'filter',
                in: 'query',
                content: {
                  'application/json': {
                    schema: { type: 'object', required: ['n'], properties: { n: { type: 'integer' } } },
                    examples: { same: { dataValue: { n: 2 }, serializedValue: '{ "n": 2 }' } },
                  },
                },
                examples: {
                  remote: { externalValue: './query.txt' },
                  metadata: { summary: 'No data' },
                  same: { dataValue: { n: 1 }, serializedValue: 'filter=%7B%22n%22%3A1%7D' },
                },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: ['integer', 'null', 'boolean', 'string'] },
                  examples: {
                    noData: { summary: 'No value' },
                    external: { externalValue: './body.json' },
                    null: { dataValue: null },
                    false: { dataValue: false },
                    zero: { dataValue: 0 },
                    empty: { dataValue: '' },
                  },
                },
                'text/plain': { schema: { type: 'string' }, examples: { same: { serializedValue: '' } } },
              },
            },
            responses: {
              '200': {
                description: 'Example response',
                headers: {
                  'X-Count': {
                    schema: { type: 'integer' },
                    examples: { zero: { dataValue: 0, serializedValue: '0' } },
                  },
                },
                content: {
                  'application/json': { schema: false, examples: { invalid: { dataValue: 1 } } },
                  'text/plain': { schema: { type: 'string' }, examples: { same: { value: '' } } },
                },
              },
            },
          },
        },
      },
    },
  } as SwaggerDoc;
}
function operation(document: SwaggerDoc, snapshot?: ReturnType<ExternalResourceLoader['currentSnapshot']>) {
  return parseMenuTags(document, { retrievalUri: uri, resourceSnapshot: snapshot }).flatMap((tag) => tag.operations)[0];
}
async function sessionFor(document: SwaggerDoc, snapshot: ReturnType<ExternalResourceLoader['currentSnapshot']>) {
  const session = await createSchemaDocumentSession(document, uri, {
    resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
    registrationContext: schemaRegistrationContextFromResourceGraph(snapshot, uri),
  });
  sessions.push(session);
  return session;
}

describe('OAS 3.2 shared Example catalog', () => {
  test.each(['3.2.0', '3.2.99'])(
    'enumerates every author example at real operation/parameter/media locations in %s',
    async (version) => {
      const document = fixture(version);
      expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
      const op = operation(document);
      const catalog = locateOperationExampleCatalog(document, op);
      expect(catalog.targets).toHaveLength(20);
      expect(new Set(catalog.targets.map((target) => target.id)).size).toBe(20);
      expect(catalog.targets.every((target) => target.operationIdentity === op.identity?.identity)).toBe(true);
      expect(catalog.targets[0].sourceLocation.pointer).toContain('/additionalOperations/copy%41/parameters/0/');
      const parameterTargets = catalog.targets.filter((target) => target.group === 'parameter:query:filter');
      const selected = exampleDefaultTarget(parameterTargets)!;
      expect(selected).toMatchObject({ name: 'same', layer: 'parameter' });
      expect(parameterTargets.filter((target) => target.name === 'same').map((target) => target.layer)).toEqual([
        'parameter',
        'media',
      ]);
      const session = await sessionFor(document, op.resourceSnapshot!);
      const result = await evaluateOperationExample(selected, session);
      expect(result.representation).toMatchObject({
        data: { n: 1 },
        text: 'filter=%7B%22n%22%3A1%7D',
        pairing: 'valid',
      });
      expect(result.schemaResult).toMatchObject({ status: 'value', validation: 'valid', authored: true });
      expect(
        exampleDefaultTarget(catalog.targets.filter((target) => target.group === 'body:application/json'))?.name,
      ).toBe('empty');
      const nullTarget = catalog.targets.find(
        (target) => target.group === 'body:application/json' && target.name === 'null',
      )!;
      expect((await evaluateOperationExample(nullTarget, session)).representation.data).toBeNull();
      const invalid = catalog.targets.find((target) => target.name === 'invalid')!;
      expect((await evaluateOperationExample(invalid, session)).schemaResult).toMatchObject({
        status: 'value',
        value: 1,
        validation: 'invalid',
        authored: true,
      });
      const metadata = catalog.targets.find((target) => target.name === 'noData')!;
      expect((await evaluateOperationExample(metadata, session)).representation).not.toHaveProperty('data');
    },
  );

  test('retains media/Example owners across $self and external reference chains without additional fetching', async () => {
    const document = {
      openapi: '3.2.0',
      $self: 'https://logical.example/api.json',
      info: { title: 'References', version: '1' },
      paths: {
        '/items': {
          post: {
            requestBody: { content: { 'application/json': { $ref: './media.json' } } },
            responses: { '204': { description: 'done' } },
          },
        },
      },
    } as SwaggerDoc;
    const mediaUri = 'https://logical.example/media.json';
    const examplesUri = 'https://logical.example/examples.json';
    const documents = new Map<string, unknown>([
      [
        mediaUri,
        { schema: { type: 'object' }, examples: { pair: { $ref: './examples.json#/components/examples/pair' } } },
      ],
      [
        examplesUri,
        {
          openapi: '3.2.0',
          $self: 'https://author.example/contract.json',
          info: { title: 'Example library', version: '1' },
          components: {
            examples: {
              pair: {
                dataValue: { $id: 'opaque', $ref: 'https://never.example/data', zero: 0 },
                externalValue: './wire.json',
              },
            },
          },
        },
      ],
    ]);
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(JSON.stringify(documents.get(String(input))), { headers: { 'content-type': 'application/json' } }),
    );
    const loader = new ExternalResourceLoader(document, uri, { fetchImpl, pageUri: uri });
    const grants = [mediaUri, examplesUri].map((resource) => ({
      scope: 'generation' as const,
      documentScope: loader.documentScope,
      resourceKey: sha256Hex(resource),
    }));
    await loader.load(grants);
    const snapshot = loader.currentSnapshot();
    const op = operation(document, snapshot);
    const before = JSON.stringify([...snapshot.nodes]);
    const target = locateOperationExampleCatalog(document, op).targets.find((target) => target.name === 'pair')!;
    expect(target.mediaLocation?.ownerRetrievalUri).toBe(mediaUri);
    expect(target.sourceLocation.ownerRetrievalUri).toBe(examplesUri);
    expect(target.schemaLocation?.ownerRetrievalUri).toBe(mediaUri);
    const session = await sessionFor(document, snapshot);
    const calls = fetchImpl.mock.calls.length;
    const result = await evaluateOperationExample(target, session);
    expect(result.representation).toMatchObject({
      data: { $id: 'opaque', $ref: 'https://never.example/data', zero: 0 },
      external: { value: './wire.json', resolvedUri: 'https://author.example/wire.json' },
      serialization: 'unavailable',
    });
    expect(result.schemaResult).toMatchObject({ status: 'value', validation: 'valid' });
    expect(result.representation.text).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
    expect(JSON.stringify([...snapshot.nodes])).toBe(before);
  });

  test('missing and wrong-type references cannot become schema candidates', async () => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'Unavailable Examples', version: '1' },
      paths: {
        '/items': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'integer', default: 9 },
                  examples: {
                    missing: { $ref: '#/components/examples/Missing' },
                    wrong: { $ref: '#/components/schemas/Wrong' },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: { Wrong: { type: 'integer' } } },
    } as SwaggerDoc;
    const catalog = locateOperationExampleCatalog(document, operation(document));
    for (const target of catalog.targets.filter((target) => target.unavailable)) {
      expect(target.unavailable).toBe(true);
      const result = await evaluateOperationExample(target);
      expect(result.representation).not.toHaveProperty('data');
      expect(result.representation.diagnostics[0].code).toBe('EXAMPLE_REFERENCE_UNAVAILABLE');
    }
  });

  test('metadata stays selectable while the real Schema default remains the automatic choice', async () => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'Metadata', version: '1' },
      paths: {
        '/items': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'integer', default: 7 },
                  examples: { note: { summary: 'Only metadata' } },
                },
              },
            },
            responses: { '204': { description: 'done' } },
          },
        },
      },
    } as SwaggerDoc;
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const op = operation(document);
    const catalog = locateOperationExampleCatalog(document, op);
    const targets = catalog.targets.filter((target) => target.group === 'body:application/json');
    expect(targets.map((target) => target.name)).toEqual(['note', 'candidate']);
    expect(exampleDefaultTarget(targets)?.name).toBe('candidate');
    const session = await sessionFor(document, op.resourceSnapshot!);
    expect((await evaluateOperationExample(exampleDefaultTarget(targets)!, session)).representation).toMatchObject({
      data: 7,
      text: '7',
    });
    expect((await evaluateOperationExample(targets[0], session)).representation).not.toHaveProperty('data');
  });

  test('parameter-layer external authors precede media authors, and unresolved Header/Media refs remain visible', async () => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'Reference boundaries', version: '1' },
      paths: {
        '/items': {
          get: {
            parameters: [
              {
                name: 'q',
                in: 'query',
                examples: { remote: { externalValue: './query' } },
                content: { 'application/json': { schema: { type: 'integer' }, examples: { media: { dataValue: 1 } } } },
              },
            ],
            responses: {
              '200': {
                description: 'done',
                headers: {
                  'X-External': { $ref: 'https://not-authorized.example/header' },
                  'X-Wrong': { $ref: '#/components/schemas/Wrong' },
                  'X-Media': { content: { 'text/plain': { $ref: 'https://not-authorized.example/media' } } },
                },
              },
            },
          },
        },
      },
      components: { schemas: { Wrong: { type: 'integer' } } },
    } as SwaggerDoc;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const catalog = locateOperationExampleCatalog(document, operation(document));
    const selected = exampleDefaultTarget(catalog.targets.filter((target) => target.group === 'parameter:query:q'))!;
    expect(selected).toMatchObject({ name: 'remote', layer: 'parameter' });
    const missing = catalog.targets.filter((target) => target.direction === 'response');
    expect(missing).toHaveLength(3);
    for (const target of missing) {
      expect(target.unavailable).toBe(true);
      expect(target.sourceLocation.pointer).toContain('#/paths/~1items/get/responses/200/headers/');
      expect((await evaluateOperationExample(target)).representation.diagnostics).toContainEqual({
        phase: 'structure',
        code: 'EXAMPLE_REFERENCE_UNAVAILABLE',
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('valid author data does not hide invalid serialized data or an unsafe-number boundary', async () => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'Separate checks', version: '1' },
      paths: {
        '/items': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'integer', maximum: 1 },
                  examples: {
                    mismatch: { dataValue: 1, serializedValue: '2' },
                    unsafe: { serializedValue: '9007199254740993' },
                  },
                },
              },
            },
            responses: { '204': { description: 'done' } },
          },
        },
      },
    } as SwaggerDoc;
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const op = operation(document);
    const catalog = locateOperationExampleCatalog(document, op);
    const session = await sessionFor(document, op.resourceSnapshot!);
    const mismatch = await evaluateOperationExample(
      catalog.targets.find((target) => target.name === 'mismatch')!,
      session,
    );
    expect(mismatch.schemaResult).toMatchObject({ status: 'value', validation: 'valid', value: 1 });
    expect(mismatch.serializedSchemaResult).toMatchObject({ status: 'value', validation: 'invalid', value: 2 });
    expect(mismatch.representation).toMatchObject({ pairing: 'invalid', text: '2' });
    const unsafe = await evaluateOperationExample(
      catalog.targets.find((target) => target.name === 'unsafe')!,
      session,
    );
    expect(unsafe.schemaResult).toBeUndefined();
    expect(unsafe.serializedSchemaResult).toBeUndefined();
    expect(unsafe.representation).toMatchObject({ serialization: 'unavailable', text: '9007199254740993' });
  });

  test('returns no catalog for 3.0/3.1, and aborts before committing late work', async () => {
    const document = fixture();
    const op = operation(document);
    expect(locateOperationExampleCatalog({ ...document, openapi: '3.1.1' }, op).targets).toEqual([]);
    expect(locateOperationExampleCatalog({ ...document, openapi: '3.0.4' }, op).targets).toEqual([]);
    const target = locateOperationExampleCatalog(document, op).targets[2];
    let release!: (value: unknown) => void;
    const resolve = new Promise((resolve) => {
      release = resolve;
    });
    const session = {
      retrievalUri: uri,
      resolve: () => resolve,
      evaluate: vi.fn(),
      dispose: vi.fn(),
    } as unknown as SchemaDocumentSession;
    const controller = new AbortController();
    const result = evaluateOperationExample(target, session, { signal: controller.signal });
    controller.abort();
    release({ schema: { type: 'object' } });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.evaluate).not.toHaveBeenCalled();
  });

  test('real request model uses the selected media layer without reformatting JSON text', async () => {
    const document = fixture();
    const op = operation(document);
    const catalog = locateOperationExampleCatalog(document, op);
    const model = exampleDebugModel(
      buildOperationDebugModel({
        doc: document as unknown as Record<string, unknown>,
        path: op.path,
        method: op.method,
        operationIdentity: op.identity,
      }),
      catalog,
    );
    const target = catalog.targets.find(
      (target) => target.parameterKey === 'query:filter' && target.layer === 'media',
    )!;
    const result = await evaluateOperationExample(target);
    const built = buildRequest({
      baseUrl: 'https://api.example',
      path: op.path,
      method: op.method,
      preserveMethodCase: true,
      debugModel: model,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        serializedExampleParameters: { 'query:filter': exampleParameterInput(result.representation, target.layer)! },
      },
    });
    expect(built.method).toBe('copy%41');
    expect(built.url).toBe('https://api.example/items?filter=%7B+%22n%22%3A+2+%7D');
  });
});

describe('reviewed catalog codec integration', () => {
  test.each(['"1"', '1'])(
    'nullable query literal quotes are validated against const %p without editor unescaping',
    async (expected) => {
      const document = {
        openapi: '3.2.0',
        info: { title: 'Wire quotes', version: '1' },
        paths: {
          '/items': {
            get: {
              parameters: [
                {
                  name: 'q',
                  in: 'query',
                  schema: { type: ['string', 'null'], const: expected },
                  examples: { quoted: { serializedValue: 'q=%221%22' } },
                },
              ],
              responses: { '204': { description: 'done' } },
            },
          },
        },
      } as SwaggerDoc;
      expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
      const op = operation(document);
      const catalog = locateOperationExampleCatalog(document, op);
      const session = await sessionFor(document, op.resourceSnapshot!);
      const result = await evaluateOperationExample(
        catalog.targets.find((target) => target.name === 'quoted')!,
        session,
      );
      const validation = expected === '"1"' ? 'valid' : 'invalid';
      expect(result.schemaResult).toMatchObject({ value: '"1"', validation });
      expect(result.serializedSchemaResult).toMatchObject({ value: '"1"', validation });
      const model = exampleDebugModel(
        buildOperationDebugModel({
          doc: document as unknown as Record<string, unknown>,
          path: op.path,
          method: op.method,
          operationIdentity: op.identity,
        }),
        catalog,
      );
      const request = buildRequest({
        baseUrl: 'https://api.example',
        path: op.path,
        method: op.method,
        debugModel: model,
        formValues: {
          pathParams: {},
          queryParams: {},
          headerParams: {},
          cookieParams: {},
          serializedExampleParameters: { 'query:q': exampleParameterInput(result.representation, 'parameter')! },
        },
      });
      expect(request.url).toBe('https://api.example/items?q=%221%22');
      expect(request.oas32ParameterPlan?.results).toContainEqual(
        expect.objectContaining({
          parameter: expect.objectContaining({ key: 'query:q' }),
          decodedData: '"1"',
        }),
      );
    },
  );

  test('field editing keeps the form encoding and actual Media Type owner after a reference', async () => {
    const mediaUri = 'https://retrieval.example/forms.json';
    const schema = { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } };
    const media = {
      schema: { $ref: '#/components/schemas/Form' },
      encoding: { tags: { style: 'form', explode: false } },
      examples: { sample: { dataValue: { tags: ['a', 'b'] } } },
    };
    const library = {
      openapi: '3.2.0',
      info: { title: 'Form library', version: '1' },
      components: { schemas: { Form: schema }, mediaTypes: { Form: media } },
    };
    const document = {
      openapi: '3.2.0',
      info: { title: 'Form owner', version: '1' },
      paths: {
        '/items': {
          post: {
            requestBody: {
              required: true,
              content: { 'application/x-www-form-urlencoded': { $ref: './forms.json#/components/mediaTypes/Form' } },
            },
            responses: { '204': { description: 'done' } },
          },
        },
      },
    } as SwaggerDoc;
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(library), { headers: { 'content-type': 'application/json' } }),
    );
    const loader = new ExternalResourceLoader(document, uri, { fetchImpl, pageUri: uri });
    await loader.load([{ scope: 'generation', documentScope: loader.documentScope, resourceKey: sha256Hex(mediaUri) }]);
    const op = operation(document, loader.currentSnapshot());
    const catalog = locateOperationExampleCatalog(document, op);
    const target = catalog.targets.find((item) => item.name === 'sample')!;
    expect(target.schemaLocation).toMatchObject({
      ownerRetrievalUri: mediaUri,
      pointer: '#/components/mediaTypes/Form/schema',
      value: media.schema,
    });
    const model = exampleDebugModel(
      buildOperationDebugModel({
        doc: document as unknown as Record<string, unknown>,
        path: op.path,
        method: op.method,
        operationIdentity: op.identity,
      }),
      catalog,
    );
    expect(model.bodyContents[0].oas31Form?.fields[0]).toMatchObject({
      name: 'tags',
      schema: schema.properties.tags,
      encoding: { kind: 'style', style: 'form', explode: false },
    });
    const result = await evaluateOperationExample(target, await sessionFor(document, op.resourceSnapshot!));
    expect(result.representation.text).toBe('tags=a,b');
    const request = buildRequest({
      baseUrl: 'https://api.example',
      path: op.path,
      method: op.method,
      debugModel: model,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        selectedContentType: 'application/x-www-form-urlencoded',
        formFields: { tags: '["a","b"]' },
      },
    });
    expect(request.body).toBe(result.representation.text);
    expect(request.formBodyPlan?.diagnostics).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('JSON string format binary remains a JSON string in the catalog and the built body', async () => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'JSON annotation', version: '1' },
      paths: {
        '/items': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'string', format: 'binary' },
                  examples: { sample: { dataValue: 'test' } },
                },
              },
            },
            responses: { '204': { description: 'done' } },
          },
        },
      },
    } as SwaggerDoc;
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const op = operation(document);
    const catalog = locateOperationExampleCatalog(document, op);
    expect(catalog.bodies[0]).toMatchObject({ category: 'json' });
    expect(catalog.bodies[0].binary).not.toBe(true);
    const result = await evaluateOperationExample(
      catalog.targets.find((target) => target.name === 'sample')!,
      await sessionFor(document, op.resourceSnapshot!),
    );
    expect(result.schemaResult).toMatchObject({ value: 'test', validation: 'valid' });
    const model = exampleDebugModel(
      buildOperationDebugModel({
        doc: document as unknown as Record<string, unknown>,
        path: op.path,
        method: op.method,
        operationIdentity: op.identity,
      }),
      catalog,
    );
    const request = buildRequest({
      baseUrl: 'https://api.example',
      path: op.path,
      method: op.method,
      debugModel: model,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        selectedContentType: 'application/json',
        serializedExampleBody: { mediaType: 'application/json', text: result.representation.text! },
      },
    });
    expect(request.body).toBe('"test"');
  });

  test.each(['3.2.0', '3.2.99'])('keeps querystring examples out of the query table for %s', async (version) => {
    const document = {
      openapi: version,
      info: { title: 'Whole querystring catalog', version: '1' },
      paths: {
        '/search': {
          get: {
            parameters: [
              {
                name: 'whole',
                in: 'querystring',
                required: true,
                content: {
                  'application/x-www-form-urlencoded': {
                    schema: { type: 'object', properties: { q: { type: 'string' } } },
                    examples: {
                      raw: { serializedValue: 'q=%2B+' },
                      data: { dataValue: { q: '+ ' } },
                    },
                  },
                },
              },
            ],
            responses: { '204': { description: 'done' } },
          },
        },
      },
    } as SwaggerDoc;
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const op = operation(document);
    const catalog = locateOperationExampleCatalog(document, op);
    expect([...catalog.parameters.keys()]).toEqual(['querystring:whole']);
    expect(catalog.parameters.get('querystring:whole')?.in).toBe('querystring');
    const model = exampleDebugModel(
      buildOperationDebugModel({
        doc: document as unknown as Record<string, unknown>,
        path: '/search',
        method: 'GET',
        operationIdentity: op.identity,
        operationDocuments: op.identity ? { [uri]: document as unknown as Record<string, unknown> } : undefined,
      }),
      catalog,
    );
    expect(model.queryParams).toEqual([]);
    expect(model.oas32Parameters?.parameters.map((parameter) => parameter.key)).toEqual(['querystring:whole']);
    const raw = catalog.targets.find(
      (target) => target.group === 'parameter:querystring:whole' && target.name === 'raw' && target.layer === 'media',
    );
    expect(raw).toMatchObject({
      name: 'raw',
      layer: 'media',
      parameter32: expect.objectContaining({ in: 'querystring' }),
    });
    const session = await sessionFor(document, op.resourceSnapshot!);
    const result = await evaluateOperationExample(raw!, session);
    expect(result.parameterResult).toMatchObject({
      present: true,
      parameterText: 'q=%2B+',
    });
    expect(result.representation.text).toBe('q=%2B+');
  });

  test('does not treat OAS 3.0 or 3.1 documents as 3.2 example catalogs', () => {
    for (const openapi of ['3.0.3', '3.1.0']) {
      const document = {
        openapi,
        info: { title: 'Legacy', version: '1' },
        paths: { '/items': { get: { responses: { '204': { description: 'done' } } } } },
      } as SwaggerDoc;
      expect(isOas32ExampleDocument(document)).toBe(false);
      expect(locateOperationExampleCatalog(document, operation(document)).targets).toEqual([]);
    }
  });
});
