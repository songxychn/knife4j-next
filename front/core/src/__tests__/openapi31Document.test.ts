import type {
  ComponentsObject,
  LicenseObject,
  PathItemObject,
  ReferenceObject,
  ResponseObject,
} from '../models/openapi3/types';
import {
  OPENAPI_HTTP_METHODS,
  OAS31_STRUCTURE_HELPER,
  collectOas31DocumentDiagnostics,
  dereferenceOasReferenceObject,
  inferReferenceObjectTargetKind,
  isOpenApi31Version,
  parseOpenApiVersion,
  resolveLocalJsonPointer,
  resolvePathItemObject,
  resolvePathItemOperation,
} from '../openapi31';
import document310 from './fixtures/openapi31/document-objects-3.1.0.json';
import document311 from './fixtures/openapi31/document-objects-3.1.1.json';
import document312 from './fixtures/openapi31/document-objects-3.1.2.json';
import invalidDocument from './fixtures/openapi31/document-objects-invalid.json';

describe('OAS 3.1 document primitives', () => {
  test('recognizes every 3.1 patch version without branching capabilities', () => {
    expect(['3.1.0', '3.1.1', '3.1.2', '3.1.3', '3.1.999'].every(isOpenApi31Version)).toBe(true);
    expect(isOpenApi31Version('3.1')).toBe(false);
    expect(isOpenApi31Version('3.2.0')).toBe(false);
    expect(isOpenApi31Version('03.1.2')).toBe(false);
    expect(isOpenApi31Version('3.01.2')).toBe(false);
    expect(isOpenApi31Version(' 3.1.2 ')).toBe(false);
    expect(isOpenApi31Version('3.1.2+build')).toBe(false);
    expect(isOpenApi31Version('3.1.2-beta+build')).toBe(true);
    expect(parseOpenApiVersion('3.1.12-preview.1')).toMatchObject({ major: 3, minor: 1, patch: 12 });
  });

  test('exposes one canonical HTTP method set including TRACE', () => {
    expect(OPENAPI_HTTP_METHODS).toEqual(['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace']);
  });

  test('pins the official structure helper schema used by diagnostics', () => {
    expect(OAS31_STRUCTURE_HELPER.$id).toBe('https://spec.openapis.org/oas/3.1/schema/2025-11-23');
    expect(OAS31_STRUCTURE_HELPER.root.atLeastOne).toEqual(['paths', 'components', 'webhooks']);
  });

  test('resolves local JSON Pointers with URI and RFC 6901 escaping safely', () => {
    const inherited = { inherited: true };
    const document = Object.assign(Object.create(inherited) as Record<string, unknown>, {
      components: {
        pathItems: {
          'order/changed': { post: {} },
          'display name': { get: {} },
          'tilde~name': { trace: {} },
          Encoded: { post: {} },
        },
      },
      inline: {
        parameters: [{ name: 'requestId', in: 'header' }],
      },
    });

    expect(resolveLocalJsonPointer(document, '#/components/pathItems/order~1changed')).toMatchObject({
      found: true,
      value: { post: {} },
    });
    expect(resolveLocalJsonPointer(document, '#/components/pathItems/display%20name').found).toBe(true);
    expect(resolveLocalJsonPointer(document, '#%2Fcomponents%2FpathItems%2FEncoded').found).toBe(true);
    expect(resolveLocalJsonPointer(document, '#/components/pathItems/tilde~0name').found).toBe(true);
    expect(resolveLocalJsonPointer(document, '#/inline/parameters/0')).toMatchObject({
      found: true,
      value: { name: 'requestId', in: 'header' },
    });
    expect(resolveLocalJsonPointer(document, '#/inline/parameters/00').found).toBe(false);
    expect(resolveLocalJsonPointer(document, '#/inline/parameters/-').found).toBe(false);
    expect(resolveLocalJsonPointer(document, '#')).toMatchObject({ found: true, value: document });
    expect(resolveLocalJsonPointer(document, '#/inherited').found).toBe(false);
    expect(resolveLocalJsonPointer(document, '#/bad~2token').found).toBe(false);
    expect(inferReferenceObjectTargetKind('#/components/responses/Ok')).toBe('response');
    expect(inferReferenceObjectTargetKind('#/components/responses/Ok/headers/TraceId')).toBe('header');
    expect(inferReferenceObjectTargetKind('#/components/pathItems/Pets/get/responses/200')).toBe('response');
    expect(inferReferenceObjectTargetKind('#/components/schemas/Envelope/properties/data')).toBe('schema');
    expect(inferReferenceObjectTargetKind('#/components/examples/Payload/value/responses')).toBe('example');
  });
});

describe('OAS 3.1 Reference and Path Item resolution', () => {
  test('applies only Reference Object annotations in 3.1 and ignores all siblings in 3.0', () => {
    const components = {
      examples: {
        Message: { summary: 'target summary', description: 'target description', value: { message: 'hello' } },
      },
    };
    const reference = {
      $ref: '#/components/examples/Message',
      summary: 'use-site summary',
      description: 'use-site description',
      value: { message: 'ignored sibling' },
    };

    expect(dereferenceOasReferenceObject(reference, { openapi: '3.1.2', components })).toEqual({
      description: 'use-site description',
      summary: 'use-site summary',
      value: { message: 'hello' },
    });
    expect(dereferenceOasReferenceObject(reference, { openapi: '3.0.4', components })).toEqual(
      components.examples.Message,
    );

    expect(
      dereferenceOasReferenceObject(
        {
          $ref: '#/components/responses/Ok',
          summary: 'has no effect on Response Object',
          description: 'overridden response description',
        },
        {
          openapi: '3.1.2',
          components: { responses: { Ok: { description: 'target response' } } },
        },
      ),
    ).toEqual({ description: 'overridden response description' });

    const inlineResponseDocument = {
      openapi: '3.1.2',
      paths: {
        '/pets': {
          get: { responses: { 200: { description: 'inline response' } } },
        },
      },
    };
    expect(
      dereferenceOasReferenceObject(
        {
          $ref: '#/paths/~1pets/get/responses/200',
          summary: 'ignored for a Response Object',
          description: 'inline override',
        },
        inlineResponseDocument,
      ),
    ).toEqual({ description: 'inline override' });
  });

  test('does not expose ignored siblings when a Reference Object cannot be resolved', () => {
    expect(
      dereferenceOasReferenceObject(
        {
          $ref: '#/components/responses/Missing',
          summary: 'ignored for a Response Object',
          description: 'safe annotation',
          content: { 'application/json': { schema: { type: 'string' } } },
        },
        { openapi: '3.1.2', components: { responses: {} } },
      ),
    ).toEqual({ $ref: '#/components/responses/Missing', description: 'safe annotation' });

    expect(
      dereferenceOasReferenceObject(
        {
          $ref: '#/components/parameters/Id',
          description: 'wrong target type',
        },
        {
          openapi: '3.1.2',
          components: { parameters: { Id: { name: 'id', in: 'query' } } },
        },
        20,
        'response',
      ),
    ).toEqual({ $ref: '#/components/parameters/Id', description: 'wrong target type' });
  });

  test('merges only non-conflicting Path Item fields and rejects undefined conflicts', () => {
    const resolved = resolvePathItemObject(document312.paths['/pets/{id}'], document312);
    expect(resolved.status).toBe('resolved');
    if (resolved.status !== 'resolved') throw new Error(`unexpected resolution status: ${resolved.status}`);
    expect(resolved.value).toMatchObject({
      summary: 'Pet by id',
      description: 'Local path description',
      get: { summary: 'Read pet' },
      post: { summary: 'Update pet' },
      'x-knife4j-note': 'preserved',
    });

    expect(resolvePathItemObject(invalidDocument.paths['/ambiguous'], invalidDocument)).toMatchObject({
      status: 'conflict',
      conflicts: ['get'],
    });
    expect(
      resolvePathItemObject(
        { $ref: '#/components/responses/Ok' },
        {
          openapi: '3.1.2',
          components: { responses: { Ok: { description: 'not a Path Item' } } },
        },
      ),
    ).toMatchObject({ status: 'invalid' });
    expect(
      resolvePathItemObject(
        { $ref: '#/components/callbacks/Changed/event' },
        {
          openapi: '3.1.2',
          components: {
            callbacks: {
              Changed: { event: { post: { responses: { 204: { description: 'Accepted' } } } } },
            },
          },
        },
      ),
    ).toMatchObject({ status: 'resolved', value: { post: expect.any(Object) } });
  });

  test('inherits path metadata and parameters while operation fields override them', () => {
    const result = resolvePathItemOperation(document312.paths['/pets/{id}'], 'post', document312);
    expect(result?.operation.summary).toBe('Update pet');
    expect(result?.operation.description).toBe('Local path description');
    expect(result?.operation.parameters).toHaveLength(2);
    expect(
      result?.operation.parameters?.map((parameter) => dereferenceOasReferenceObject(parameter, document312)),
    ).toEqual([
      expect.objectContaining({ name: 'id', description: 'Operation-specific id' }),
      expect.objectContaining({ name: 'locale' }),
    ]);
  });

  test('sanitizes unsafe operation fields while keeping the raw document available for diagnostics', () => {
    const document = {
      openapi: '3.1.2',
      paths: {
        '/unsafe': {
          summary: 'Path fallback must not repair an invalid operation field',
          description: 'Path description must not repair an invalid operation field',
          get: {
            summary: 42,
            description: null,
            operationId: 42,
            deprecated: 'yes',
            externalDocs: { url: 42 },
            tags: 'invalid',
            servers: 'invalid',
            security: [{ Auth: 'invalid' }],
            parameters: { invalid: true },
            requestBody: 'invalid',
            responses: [],
            callbacks: 'invalid',
          },
        },
      },
    };

    expect(resolvePathItemOperation(document.paths['/unsafe'], 'get', document)?.operation).toEqual({
      parameters: [],
      responses: {},
      callbacks: {},
    });
  });

  test('does not let unresolved or wrong-type references re-enter the operation projection', () => {
    const document = {
      openapi: '3.1.2',
      paths: {
        '/refs': {
          post: {
            requestBody: { $ref: '#/components/responses/Ok' },
            responses: {
              200: { $ref: '#/components/parameters/Id' },
              201: { $ref: '#/components/responses/Missing' },
            },
          },
        },
      },
      components: {
        responses: { Ok: { description: 'OK' } },
        parameters: { Id: { name: 'id', in: 'query' } },
      },
    };

    expect(resolvePathItemOperation(document.paths['/refs'], 'post', document)?.operation).toEqual({
      responses: { 200: {}, 201: {} },
    });
  });

  test('diagnoses Reference Object chains that exceed the safe resolution depth', () => {
    const responses: Record<string, Record<string, unknown>> = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [
        `Response${index}`,
        { $ref: `#/components/responses/Response${index + 1}` },
      ]),
    );
    responses.Response21 = { description: 'terminal response' };
    const document = {
      openapi: '3.1.2',
      info: { title: 'Deep references', version: '1.0.0' },
      components: { responses },
    };

    expect(collectOas31DocumentDiagnostics(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'reference-depth-exceeded',
          path: '#/components/responses/Response0/$ref',
        }),
      ]),
    );
  });
});

describe('OAS 3.1 document diagnostics', () => {
  test.each([
    ['3.1.0', document310],
    ['3.1.1', document311],
    ['3.1.2', document312],
  ])('accepts the fixed %s document-object fixture', (_version, document) => {
    expect(collectOas31DocumentDiagnostics(document)).toEqual([]);
  });

  test('reports object paths and reasons without interpreting Schema vocabulary payloads', () => {
    const diagnostics = collectOas31DocumentDiagnostics(invalidDocument);
    const codes = diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        'invalid-field-type',
        'license-fields-mutually-exclusive',
        'invalid-path-key',
        'path-item-reference-conflict',
        'unresolved-local-reference',
        'duplicate-parameter',
        'reference-sibling-ignored',
        'reference-target-type-mismatch',
        'invalid-component-name',
        'unknown-field',
      ]),
    );
    expect(diagnostics.every((diagnostic) => diagnostic.path.startsWith('#') && diagnostic.reason.length > 0)).toBe(
      true,
    );
    expect(
      collectOas31DocumentDiagnostics(document310).some(
        (diagnostic) => diagnostic.value === './literal-vocabulary-value.json',
      ),
    ).toBe(false);
  });

  test('diagnoses a malformed 3.1 declaration instead of silently changing capability branches', () => {
    expect(
      collectOas31DocumentDiagnostics({
        openapi: '3.1',
        info: { title: 'Malformed declaration', version: '1' },
        paths: {},
      }),
    ).toContainEqual(expect.objectContaining({ code: 'invalid-field-type', path: '#/openapi', value: '3.1' }));
  });

  test('diagnoses wrong Path Item targets and mismatches inside Reference chains', () => {
    const document = {
      openapi: '3.1.2',
      info: { title: 'Wrong reference targets', version: '1' },
      paths: {
        '/wrong': { $ref: '#/components/responses/Ok' },
        '/chain': {
          get: {
            responses: { 200: { $ref: '#/components/responses/Alias' } },
          },
        },
      },
      components: {
        responses: {
          Ok: { description: 'OK' },
          Alias: { $ref: '#/components/parameters/Id' },
        },
        parameters: { Id: { name: 'id', in: 'query' } },
      },
    };

    expect(collectOas31DocumentDiagnostics(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'reference-target-type-mismatch',
          path: '#/paths/~1wrong/$ref',
          value: '#/components/responses/Ok',
        }),
        expect.objectContaining({
          code: 'reference-target-type-mismatch',
          path: '#/paths/~1chain/get/responses/200/$ref',
          value: '#/components/parameters/Id',
        }),
      ]),
    );
  });
});

test('component reusable objects expose Reference Object unions at compile time', () => {
  const reference: ReferenceObject = { $ref: '#/components/responses/Ok', description: 'alias' };
  const response: ResponseObject = { description: 'OK' };
  const components: ComponentsObject = {
    responses: { Ok: response, Alias: reference },
    parameters: { Alias: { $ref: '#/components/parameters/Id' } },
    examples: { Alias: { $ref: '#/components/examples/Example' } },
    requestBodies: { Alias: { $ref: '#/components/requestBodies/Body' } },
    headers: { Alias: { $ref: '#/components/headers/Header' } },
    securitySchemes: { Alias: { $ref: '#/components/securitySchemes/Auth' } },
    links: { Alias: { $ref: '#/components/links/Link' } },
    callbacks: { Alias: { $ref: '#/components/callbacks/Callback' } },
  };
  const pathItem: PathItemObject = { $ref: '#/components/pathItems/Base', summary: 'Path alias' };
  components.pathItems = { Alias: pathItem };
  const license: LicenseObject = { name: 'Apache License 2.0', identifier: 'Apache-2.0' };

  expect(components.responses?.Alias).toBe(reference);
  expect(components.pathItems.Alias).toBe(pathItem);
  expect(license.identifier).toBe('Apache-2.0');
});
