import {
  collectOas32DocumentDiagnostics,
  OAS32_STRUCTURE_HELPER,
  type Oas32Document,
  type Oas32DocumentDiagnosticCode,
  type Oas32HeaderObject,
  type Oas32MediaTypeObject,
  type Oas32ParameterObject,
  type Oas32ReferenceObject,
} from '../openapi32';
import { collectOas31DocumentDiagnostics, isOpenApi31Version, OPENAPI_HTTP_METHODS } from '../openapi31';
import validDocument from './fixtures/openapi32/document-objects-3.2.0.json';
import valid31Document from './fixtures/openapi31/document-objects-3.1.0.json';

type JsonRecord = Record<string, unknown>;
const documentWith = (extra: JsonRecord = {}): JsonRecord => ({
  openapi: '3.2.0',
  info: { title: 'Structure', version: '1' },
  paths: {},
  ...extra,
});
const componentsWith = (section: string, value: unknown): JsonRecord =>
  documentWith({ components: { [section]: { Subject: value } } });
const pathWith = (pathItem: unknown): JsonRecord => documentWith({ paths: { '/items': pathItem } });
const operationWith = (operation: unknown): JsonRecord => pathWith({ query: operation });
const query = (name = 'filter'): JsonRecord => ({ name, in: 'query', schema: { type: 'string' } });
const querystring = (name = 'filter'): JsonRecord => ({
  name,
  in: 'querystring',
  content: { 'application/json': { schema: { type: 'object' } } },
});
const expectDiagnostic = (document: unknown, code: Oas32DocumentDiagnosticCode, path: string): void => {
  expect(collectOas32DocumentDiagnostics(document)).toContainEqual(expect.objectContaining({ code, path }));
};

describe('OAS 3.2 structural contract', () => {
  test.each(['3.2.0', '3.2.1', '3.2.999'])(
    'accepts the normative object fixture for %s without normalizing it',
    (openapi) => {
      const document = { ...validDocument, openapi };
      const before = JSON.stringify(document);
      expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
      expect(JSON.stringify(document)).toBe(before);
    },
  );

  test('pins a structure helper revision without applying its dialect default', () => {
    expect(OAS32_STRUCTURE_HELPER.$id).toBe('https://spec.openapis.org/oas/3.2/schema/2025-11-23');
    const document = documentWith({ $self: '../main.json' });
    Object.freeze(document);
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    expect(document).not.toHaveProperty('jsonSchemaDialect');
  });

  test.each(['main.json#fragment', '#fragment', 'https://example.test/main.json#'])(
    'preserves the URI reference $self %s',
    ($self) => {
      const document = documentWith({ $self });
      expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
      expect(document.$self).toBe($self);
    },
  );

  test('keeps 3.0/3.1 collectors and existing consumer feature gates unchanged', () => {
    expect(collectOas32DocumentDiagnostics(valid31Document)).toEqual([]);
    expect(collectOas31DocumentDiagnostics(valid31Document)).toEqual([]);
    expect(collectOas31DocumentDiagnostics(validDocument)).toEqual([]);
    expect(collectOas32DocumentDiagnostics(documentWith({ openapi: '3.0.4' }))).toEqual([]);
    expect(collectOas32DocumentDiagnostics(documentWith({ openapi: '3.3.0' }))).toEqual([]);
    expect(isOpenApi31Version('3.2.0')).toBe(false);
    expect(OPENAPI_HTTP_METHODS).not.toContain('query');
    expect(collectOas31DocumentDiagnostics({ ...operationWith({}), openapi: '3.1.2' })).toContainEqual(
      expect.objectContaining({ code: 'unknown-field', path: '#/paths/~1items/query' }),
    );
  });

  test.each(['3.2', '3.2.x', '3.2.0+build'])('reports malformed 3.2 declaration %s', (openapi) => {
    expectDiagnostic(documentWith({ openapi }), 'invalid-field-value', '#/openapi');
  });

  test('uses normative optional Operation.responses and Response.description rules', () => {
    expect(collectOas32DocumentDiagnostics(operationWith({}))).toEqual([]);
    expect(
      collectOas32DocumentDiagnostics(operationWith({ responses: { '204': {}, default: { summary: 'Fallback' } } })),
    ).toEqual([]);
    expectDiagnostic(operationWith({ responses: {} }), 'missing-required-field', '#/paths/~1items/query/responses');
    expectDiagnostic(
      operationWith({ responses: { 'x-payload': {} } }),
      'missing-required-field',
      '#/paths/~1items/query/responses',
    );
  });

  test.each([
    ['root self type', documentWith({ $self: [] }), 'invalid-field-type', '#/$self'],
    ['info required', documentWith({ info: undefined }), 'invalid-field-type', '#/info'],
    ['server name', documentWith({ servers: [{ url: '/', name: 2 }] }), 'invalid-field-type', '#/servers/0/name'],
    [
      'response summary',
      componentsWith('responses', { summary: [] }),
      'invalid-field-type',
      '#/components/responses/Subject/summary',
    ],
    [
      'invalid path',
      documentWith({ paths: { invalid: { query: { unknown: 2 } } } }),
      'invalid-path-key',
      '#/paths/invalid',
    ],
    [
      'invalid response',
      operationWith({ responses: { '600': {} } }),
      'invalid-response-key',
      '#/paths/~1items/query/responses/600',
    ],
    [
      'component name',
      documentWith({ components: { mediaTypes: { 'invalid/name': {} } } }),
      'invalid-component-name',
      '#/components/mediaTypes/invalid~1name',
    ],
    [
      'schema shape',
      componentsWith('mediaTypes', { itemSchema: [] }),
      'invalid-field-type',
      '#/components/mediaTypes/Subject/itemSchema',
    ],
  ] as const)('diagnoses %s at its source pointer', (_name, document, code, path) => {
    expectDiagnostic(document, code, path);
  });

  test('does not parse values under invalid path or response keys', () => {
    const diagnostics = collectOas32DocumentDiagnostics(
      documentWith({
        paths: {
          invalid: { query: { unexpected: 2 } },
          '/valid': { query: { responses: { 200: {}, invalid: { unexpected: 2 } } } },
        },
      }),
    );
    expect(diagnostics.map(({ path }) => path)).toEqual(['#/paths/invalid', '#/paths/~1valid/query/responses/invalid']);
  });

  test('checks method tokens and fixed wire names without folding custom method case', () => {
    expect(
      collectOas32DocumentDiagnostics(
        pathWith({ additionalOperations: { COPY: {}, Copy: {}, copy: {}, get: {}, 'x-PING': {} } }),
      ),
    ).toEqual([]);
    for (const method of ['GET', 'POST', 'QUERY', 'TRACE']) {
      expectDiagnostic(
        pathWith({ additionalOperations: { [method]: {} } }),
        'reserved-http-method',
        `#/paths/~1items/additionalOperations/${method}`,
      );
    }
    expectDiagnostic(
      pathWith({ additionalOperations: { 'BAD METHOD': {} } }),
      'invalid-http-method',
      '#/paths/~1items/additionalOperations/BAD METHOD',
    );
    expectDiagnostic(
      pathWith({ additionalOperations: [] }),
      'invalid-field-type',
      '#/paths/~1items/additionalOperations',
    );
    expectDiagnostic(
      pathWith({ additionalOperations: { COPY: false } }),
      'invalid-field-type',
      '#/paths/~1items/additionalOperations/COPY',
    );
  });
});

describe('OAS 3.2 parameter structure and effective collections', () => {
  test.each([
    [{ name: 'q', in: 'querystring', schema: true }, 'missing-required-field', '/content'],
    [{ in: 'querystring', content: { 'application/json': {} } }, 'missing-required-field', '/name'],
    [{ ...querystring(), style: 'form' }, 'invalid-field-value', '/style'],
    [{ ...querystring(), allowReserved: true }, 'invalid-field-value', '/allowReserved'],
    [{ ...querystring(), content: {} }, 'invalid-field-value', '/content'],
    [{ ...querystring(), content: { 'application/json': {}, 'text/plain': {} } }, 'invalid-field-value', '/content'],
    [{ ...query(), content: { 'application/json': {} } }, 'mutually-exclusive-fields', ''],
    [{ name: 'id', in: 'path', schema: true }, 'invalid-field-value', '/required'],
    [{ ...query(), style: 'cookie' }, 'invalid-field-value', '/style'],
    [{ name: 'Cookie', in: 'cookie', schema: true, allowEmptyValue: true }, 'invalid-field-value', '/allowEmptyValue'],
  ] as const)('rejects malformed parameter %#', (parameter, code, suffix) => {
    expectDiagnostic(componentsWith('parameters', parameter), code, `#/components/parameters/Subject${suffix}`);
  });

  test('accepts content or schema parameters and the new cookie/allowReserved field shapes', () => {
    const parameters = [
      { name: 'p', in: 'path', required: true, allowReserved: true, schema: { type: 'string' } },
      { name: 'X-Test', in: 'header', schema: true },
      { name: 'form-cookie', in: 'cookie', style: 'form', allowReserved: true, schema: true },
      { name: 'sid', in: 'cookie', style: 'cookie', explode: true, schema: true },
      querystring(),
    ];
    expect(collectOas32DocumentDiagnostics(documentWith({ paths: { '/{p}': { query: { parameters } } } }))).toEqual([]);
  });

  test('merges path and operation parameters before checking query/querystring exclusivity', () => {
    expectDiagnostic(
      pathWith({ parameters: [query()], query: { parameters: [querystring()] } }),
      'query-querystring-conflict',
      '#/paths/~1items/query/parameters/0',
    );
    expectDiagnostic(
      pathWith({ parameters: [querystring()], query: { parameters: [query()] } }),
      'query-querystring-conflict',
      '#/paths/~1items/parameters/0',
    );
    expectDiagnostic(
      operationWith({ parameters: [querystring('a'), querystring('b')] }),
      'multiple-querystring-parameters',
      '#/paths/~1items/query/parameters/1',
    );
    expect(
      collectOas32DocumentDiagnostics(
        pathWith({ parameters: [querystring()], query: { parameters: [querystring()] } }),
      ),
    ).toEqual([]);
  });

  test('resolves local parameter aliases without letting annotation siblings override identity', () => {
    const document = documentWith({
      paths: {
        '/items': { parameters: [{ $ref: '#/components/parameters/Alias' }], query: { parameters: [querystring()] } },
      },
      components: {
        parameters: {
          Filter: query(),
          Alias: { $ref: '#/components/parameters/Filter', description: 'Shared filter' },
        },
      },
    });
    expectDiagnostic(document, 'query-querystring-conflict', '#/paths/~1items/query/parameters/0');
    expectDiagnostic(
      operationWith({ parameters: [query(), query()] }),
      'duplicate-parameter',
      '#/paths/~1items/query/parameters/1',
    );
    expectDiagnostic(
      operationWith({
        parameters: [
          { name: 'X-Id', in: 'header', schema: true },
          { name: 'X-Id', in: 'header', schema: true },
        ],
      }),
      'duplicate-parameter',
      '#/paths/~1items/query/parameters/1',
    );
  });

  test('preserves case-sensitive Parameter names before any HTTP header processing', () => {
    expect(
      collectOas32DocumentDiagnostics(
        operationWith({
          parameters: [
            { name: 'X-Id', in: 'header', schema: true },
            { name: 'x-id', in: 'header', schema: true },
          ],
        }),
      ),
    ).toEqual([]);
  });

  test('retains source pointers when a local Path Item supplies the operation', () => {
    const document = documentWith({
      paths: { '/items': { $ref: '#/components/pathItems/Shared', parameters: [query()] } },
      components: { pathItems: { Shared: { query: { parameters: [querystring()] } } } },
    });
    expectDiagnostic(document, 'query-querystring-conflict', '#/components/pathItems/Shared/query/parameters/0');
    expectDiagnostic(
      documentWith({
        paths: { '/items': { $ref: '#/components/pathItems/Shared', query: {} } },
        components: { pathItems: { Shared: { query: {} } } },
      }),
      'path-item-reference-conflict',
      '#/paths/~1items',
    );
  });

  test('checks custom operations and webhook maps, including x-* webhook names', () => {
    expectDiagnostic(
      pathWith({ parameters: [query()], additionalOperations: { COPY: { parameters: [querystring()] } } }),
      'query-querystring-conflict',
      '#/paths/~1items/additionalOperations/COPY/parameters/0',
    );
    expectDiagnostic(
      documentWith({ webhooks: { 'x-event': { parameters: [query()], query: { parameters: [querystring()] } } } }),
      'query-querystring-conflict',
      '#/webhooks/x-event/query/parameters/0',
    );
  });
});

describe('OAS 3.2 recursive object positions and opaque payloads', () => {
  test('traverses Header.content through every nested Encoding form', () => {
    const header = { content: { 'application/json': { $ref: '#/components/mediaTypes/Missing' } } };
    for (const [field, value, suffix] of [
      ['encoding', { part: { headers: { 'x-context': header } } }, '/encoding/part'],
      ['prefixEncoding', [{ headers: { 'x-context': header } }], '/prefixEncoding/0'],
      ['itemEncoding', { headers: { 'x-context': header } }, '/itemEncoding'],
      [
        'itemEncoding',
        { contentType: 'multipart/mixed', itemEncoding: { headers: { 'x-context': header } } },
        '/itemEncoding/itemEncoding',
      ],
    ] as const) {
      expectDiagnostic(
        componentsWith('mediaTypes', { itemSchema: {}, [field]: value }),
        'unresolved-local-reference',
        `#/components/mediaTypes/Subject${suffix}/headers/x-context/content/application~1json/$ref`,
      );
    }
  });

  test('keeps Header fixed fields separate from Parameter fixed fields', () => {
    for (const field of ['name', 'in', 'allowReserved', 'allowEmptyValue']) {
      expectDiagnostic(
        componentsWith('headers', { schema: true, [field]: true }),
        'unknown-field',
        `#/components/headers/Subject/${field}`,
      );
    }
  });

  test.each(['prefixEncoding', 'itemEncoding'])(
    'rejects encoding combined with %s, including nested Encoding Objects',
    (field) => {
      const value = field === 'prefixEncoding' ? [] : {};
      expectDiagnostic(
        componentsWith('mediaTypes', { encoding: {}, [field]: value }),
        'mutually-exclusive-fields',
        '#/components/mediaTypes/Subject',
      );
      expectDiagnostic(
        componentsWith('mediaTypes', { itemEncoding: { encoding: {}, [field]: value } }),
        'mutually-exclusive-fields',
        '#/components/mediaTypes/Subject/itemEncoding',
      );
    },
  );

  test('accepts independent schema/itemSchema and positional Encoding together', () => {
    expect(
      collectOas32DocumentDiagnostics(
        componentsWith('mediaTypes', {
          schema: { type: 'array' },
          itemSchema: true,
          prefixEncoding: [],
          itemEncoding: {},
        }),
      ),
    ).toEqual([]);
  });

  test('validates Example field combinations without interpreting literal example data', () => {
    for (const example of [
      { dataValue: 1 },
      { dataValue: 1, serializedValue: '1' },
      { dataValue: 1, externalValue: './one.txt' },
      { value: 1 },
      { serializedValue: '1' },
    ]) {
      expect(collectOas32DocumentDiagnostics(componentsWith('examples', example))).toEqual([]);
    }
    for (const example of [
      { value: 1, dataValue: 1 },
      { value: 1, serializedValue: '1' },
      { value: 1, externalValue: './one.txt' },
      { serializedValue: '1', externalValue: './one.txt' },
    ]) {
      expectDiagnostic(
        componentsWith('examples', example),
        'mutually-exclusive-fields',
        '#/components/examples/Subject',
      );
    }
    expectDiagnostic(
      componentsWith('examples', { serializedValue: 1 }),
      'invalid-field-type',
      '#/components/examples/Subject/serializedValue',
    );
  });

  test('keeps unknown fields, extensions and every literal-bearing Schema position opaque', () => {
    const payload = { $ref: '#/missing', $self: '#fragment', xml: { nodeType: 'invalid' }, discriminator: {} };
    const schema = {
      example: payload,
      examples: [payload],
      default: payload,
      enum: [payload],
      const: payload,
      'x-data': payload,
      customVocabulary: payload,
    };
    const document = documentWith({
      'x-root': payload,
      unknown: payload,
      components: {
        schemas: { Payload: schema },
        examples: { 'x-literal': { dataValue: payload } },
        links: { Link: { operationRef: '#/paths/~1items/query', parameters: { payload }, requestBody: payload } },
      },
      paths: {
        '/items': { query: { responses: { 200: {}, 'x-data': payload } }, 'x-data': payload },
        'x-data': payload,
      },
    });
    expect(collectOas32DocumentDiagnostics(document)).toEqual([
      expect.objectContaining({ code: 'unknown-field', path: '#/unknown' }),
    ]);
  });

  test('does not promote a referenced object inside opaque data into a parameter', () => {
    const document = documentWith({
      paths: { '/items': { query: { parameters: [{ $ref: '#/components/examples/Payload/value' }, querystring()] } } },
      components: { examples: { Payload: { value: query() } } },
    });
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    expect(
      collectOas32DocumentDiagnostics(
        documentWith({
          paths: { '/items': { query: { parameters: [{ $ref: '#/x-data' }] } } },
          'x-data': false,
        }),
      ),
    ).toEqual([]);
  });

  test('walks real Schema positions for XML and discriminator metadata only', () => {
    const badXml = { xml: { nodeType: 'bad' } };
    for (const schema of [
      { properties: { 'x-field': badXml } },
      { $defs: { Inner: badXml } },
      { items: badXml },
      { prefixItems: [badXml] },
      { allOf: [badXml] },
      { if: badXml },
      { contentSchema: badXml },
    ]) {
      const diagnostics = collectOas32DocumentDiagnostics(componentsWith('schemas', schema));
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({ code: 'invalid-field-value' });
      expect(diagnostics[0].path.endsWith('/xml/nodeType')).toBe(true);
    }
  });

  test('terminates cyclic non-JSON inputs without mutating or serializing opaque payloads', () => {
    const schema: JsonRecord = {};
    schema.items = schema;
    expectDiagnostic(
      componentsWith('schemas', schema),
      'structure-limit-exceeded',
      '#/components/schemas/Subject/items',
    );
    const opaque: JsonRecord = {};
    opaque.self = opaque;
    expect(collectOas32DocumentDiagnostics(componentsWith('examples', { value: opaque }))).toEqual([]);
  });
});

describe('OAS 3.2 metadata and helper corrections', () => {
  test('uses normative propertyName required instead of the permissive metadata helper', () => {
    expectDiagnostic(
      componentsWith('schemas', { oneOf: [{}], discriminator: { defaultMapping: '#/components/schemas/Subject' } }),
      'missing-required-field',
      '#/components/schemas/Subject/discriminator/propertyName',
    );
    expect(
      collectOas32DocumentDiagnostics(
        componentsWith('schemas', { allOf: [{ required: ['kind'] }], discriminator: { propertyName: 'kind' } }),
      ),
    ).toEqual([]);
    expectDiagnostic(
      componentsWith('schemas', { discriminator: { propertyName: 'kind', defaultMapping: 1 } }),
      'invalid-field-type',
      '#/components/schemas/Subject/discriminator/defaultMapping',
    );
  });

  test('does not adopt the helper-only Media Type.description field', () => {
    expectDiagnostic(
      componentsWith('mediaTypes', { description: 'not a normative field' }),
      'unknown-field',
      '#/components/mediaTypes/Subject/description',
    );
    expect(
      collectOas32DocumentDiagnostics(
        componentsWith('mediaTypes', {
          $ref: './media.json#/components/mediaTypes/Shared',
          description: 'Reference annotation',
        }),
      ),
    ).toEqual([]);
  });

  test('keeps arbitrary Link parameter literals despite the helper string-map restriction', () => {
    expect(
      collectOas32DocumentDiagnostics(
        componentsWith('links', {
          operationId: 'next',
          parameters: { int: 42, bool: false, nil: null, object: { $ref: '#/missing' }, array: [1, true] },
        }),
      ),
    ).toEqual([]);
  });

  test('checks XML node types, legacy field exclusivity and non-relative IRI namespaces', () => {
    for (const nodeType of ['element', 'attribute', 'text', 'cdata', 'none']) {
      expect(collectOas32DocumentDiagnostics(componentsWith('schemas', { xml: { nodeType } }))).toEqual([]);
    }
    for (const legacy of ['attribute', 'wrapped'])
      expectDiagnostic(
        componentsWith('schemas', { xml: { nodeType: 'element', [legacy]: false } }),
        'mutually-exclusive-fields',
        '#/components/schemas/Subject/xml',
      );
    expectDiagnostic(
      componentsWith('schemas', { xml: { namespace: './relative' } }),
      'invalid-field-value',
      '#/components/schemas/Subject/xml/namespace',
    );
    expect(
      collectOas32DocumentDiagnostics(
        componentsWith('schemas', { xml: { namespace: 'https://example.test/节点#fragment' } }),
      ),
    ).toEqual([]);
  });

  test('checks tags without restricting kind to the current registry', () => {
    expect(
      collectOas32DocumentDiagnostics(
        documentWith({
          tags: [
            { name: 'root', kind: 'unregistered' },
            { name: 'child', parent: 'root' },
          ],
        }),
      ),
    ).toEqual([]);
    expectDiagnostic(documentWith({ tags: [{ name: 'same' }, { name: 'same' }] }), 'duplicate-tag', '#/tags/1/name');
    expectDiagnostic(
      documentWith({ tags: [{ name: 'child', parent: 'missing' }] }),
      'unknown-parent-tag',
      '#/tags/0/parent',
    );
    expectDiagnostic(
      documentWith({
        tags: [
          { name: 'a', parent: 'b' },
          { name: 'b', parent: 'a' },
        ],
      }),
      'tag-parent-cycle',
      '#/tags/0/parent',
    );
  });

  test('checks the Device Authorization object without executing OAuth', () => {
    const scheme = {
      type: 'oauth2',
      oauth2MetadataUrl: 'https://auth.example.test/metadata',
      deprecated: true,
      flows: {
        deviceAuthorization: {
          deviceAuthorizationUrl: 'https://auth.example.test/device',
          tokenUrl: 'https://auth.example.test/token',
          scopes: {},
        },
      },
    };
    expect(collectOas32DocumentDiagnostics(componentsWith('securitySchemes', scheme))).toEqual([]);
    expectDiagnostic(
      componentsWith('securitySchemes', { ...scheme, flows: { deviceAuthorization: { scopes: {} } } }),
      'missing-required-field',
      '#/components/securitySchemes/Subject/flows/deviceAuthorization/deviceAuthorizationUrl',
    );
    expectDiagnostic(
      componentsWith('securitySchemes', { ...scheme, flows: { deviceAuthorization: { scopes: {} } } }),
      'missing-required-field',
      '#/components/securitySchemes/Subject/flows/deviceAuthorization/tokenUrl',
    );
    expectDiagnostic(
      componentsWith('securitySchemes', { ...scheme, deprecated: 'true' }),
      'invalid-field-type',
      '#/components/securitySchemes/Subject/deprecated',
    );
  });
});

describe('OAS 3.2 structural references', () => {
  test('checks local Media Type targets and Reference annotation shapes', () => {
    expectDiagnostic(
      documentWith({
        components: { schemas: { Wrong: {} }, mediaTypes: { Alias: { $ref: '#/components/schemas/Wrong' } } },
      }),
      'reference-target-type-mismatch',
      '#/components/mediaTypes/Alias/$ref',
    );
    expectDiagnostic(
      componentsWith('mediaTypes', { $ref: '#/components/mediaTypes/Missing' }),
      'unresolved-local-reference',
      '#/components/mediaTypes/Subject/$ref',
    );
    expectDiagnostic(
      documentWith({
        components: { schemas: { False: false }, mediaTypes: { Alias: { $ref: '#/components/schemas/False' } } },
      }),
      'reference-target-type-mismatch',
      '#/components/mediaTypes/Alias/$ref',
    );
    expectDiagnostic(
      componentsWith('mediaTypes', { $ref: 1 }),
      'invalid-field-type',
      '#/components/mediaTypes/Subject/$ref',
    );
    expectDiagnostic(
      componentsWith('mediaTypes', { $ref: './media.json', summary: [] }),
      'invalid-field-type',
      '#/components/mediaTypes/Subject/summary',
    );
    expectDiagnostic(
      componentsWith('mediaTypes', { $ref: './media.json', schema: { xml: { nodeType: 'bad' } } }),
      'reference-sibling-ignored',
      '#/components/mediaTypes/Subject/schema',
    );
  });

  test('reports local reference cycles and depth while leaving unloaded references alone', () => {
    const mediaTypes: JsonRecord = { Cycle: { $ref: '#/components/mediaTypes/Cycle' }, Last: {} };
    for (let index = 0; index < 21; index++)
      mediaTypes[`Ref${index}`] = { $ref: `#/components/mediaTypes/${index === 20 ? 'Last' : `Ref${index + 1}`}` };
    const document = documentWith({ components: { mediaTypes } });
    expectDiagnostic(document, 'reference-cycle', '#/components/mediaTypes/Cycle/$ref');
    expectDiagnostic(document, 'reference-depth-exceeded', '#/components/mediaTypes/Ref0/$ref');
    const unloaded = documentWith({
      $self: '../main.json',
      security: [{ './security.json#/components/securitySchemes/Remote': [] }],
      paths: {
        '/items': {
          $ref: './paths.json#/components/pathItems/Shared',
          query: { parameters: [{ $ref: './parameters.json#/components/parameters/Remote' }] },
        },
      },
      components: {
        mediaTypes: { Remote: { $ref: './media.json#/components/mediaTypes/Remote' } },
        schemas: { Remote: { $ref: './schemas.json', $id: 'https://schema.example.test/root' } },
      },
    });
    const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed'));
    try {
      expect(collectOas32DocumentDiagnostics(unloaded)).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});

test('raw 3.2 types express Media Type References at every content use site', () => {
  const reference: Oas32ReferenceObject = { $ref: '#/components/mediaTypes/Text', description: 'Reference annotation' };
  const header: Oas32HeaderObject = { content: { 'text/plain': reference } };
  const parameter: Oas32ParameterObject = { name: 'q', in: 'querystring', content: { 'text/plain': reference } };
  const media: Oas32MediaTypeObject = {
    schema: { type: 'array' },
    itemSchema: false,
    prefixEncoding: [],
    itemEncoding: { headers: { 'X-Header': header }, itemEncoding: { contentType: 'text/plain' } },
  };
  const document: Oas32Document = {
    openapi: '3.2.0',
    info: { title: 'Typed raw input', version: '1' },
    paths: {
      '/items': {
        query: {
          parameters: [parameter],
          requestBody: { content: { 'text/plain': reference } },
          responses: {
            '200': { headers: { 'X-Header': header }, content: { 'text/plain': reference } },
            'x-note': { arbitrary: true },
          },
        },
        additionalOperations: { COPY: {} },
      },
      'x-opaque': 42,
    },
    components: {
      mediaTypes: { Text: { schema: { type: 'string' } }, Alias: reference, Sequence: media },
      schemas: {
        Model: {
          oneOf: [true],
          discriminator: { propertyName: 'kind', defaultMapping: '#/components/schemas/Model' },
          xml: { nodeType: 'none' },
        },
      },
    },
  };
  expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
});
