import { enumerateOpenApiOperations } from '../openapiOperations';
import { OpenAPIParser } from '../models/openapi3/parse';

const document = (openapi = '3.2.0') => ({
  openapi,
  info: { title: 'Synthetic operation identity fixture', version: '1' },
  paths: {
    '/items': {
      get: { responses: { '200': { description: 'OK' } } },
      query: {},
      additionalOperations: {
        COPY: { callbacks: { changed: { '{$request.query.callback}': { query: {} } } } },
        Copy: {},
        patch: {},
        get: {},
        'x-PING': {},
      },
    },
    'x-opaque': { query: {}, additionalOperations: { GHOST: {} } },
  },
  webhooks: { changed: { query: {} } },
  components: { pathItems: { Shared: { additionalOperations: { SEARCH: {} } } } },
  'x-payload': { paths: { '/ghost': { query: {} } } },
});

describe('versioned OpenAPI operation identity', () => {
  test.each(['3.2.0', '3.2.42'])('keeps exact methods, empty operations and real positions in %s', (version) => {
    const operations = enumerateOpenApiOperations(document(version));
    expect(operations.map((operation) => operation.method)).toEqual([
      'GET',
      'QUERY',
      'COPY',
      'QUERY',
      'Copy',
      'patch',
      'get',
      'x-PING',
      'QUERY',
      'SEARCH',
    ]);
    expect(new Set(operations.map((operation) => operation.identity)).size).toBe(operations.length);
    expect(operations.find((operation) => operation.method === 'Copy')).toMatchObject({
      methodSource: 'additional',
      operationPointer: '#/paths/~1items/additionalOperations/Copy',
      pathItemPointer: '#/paths/~1items',
      source: 'path',
    });
    expect(operations.filter((operation) => operation.source === 'callback')).toHaveLength(1);
  });

  test.each(['3.0.4', '3.1.2'])('does not enable new methods for %s', (version) => {
    expect(enumerateOpenApiOperations(document(version)).map((operation) => operation.method)).toEqual(['GET']);
  });

  test('invalid tokens and reserved standard methods remain rejected', () => {
    const doc = document();
    doc.paths['/items'].additionalOperations = { 'BAD METHOD': {}, POST: {}, QUERY: {}, Copy: {} } as never;
    expect(
      enumerateOpenApiOperations(doc)
        .filter((operation) => operation.methodSource === 'additional')
        .map((operation) => operation.method),
    ).toEqual(['Copy', 'SEARCH']);
  });

  test('parser retains legal empty 3.2 operations and resolves additional operation parameters by identity', () => {
    const doc = document();
    doc.paths['/items'].additionalOperations.Copy = {
      parameters: [{ name: 'variant', in: 'query', schema: { type: 'string' } }],
    };
    const parser = new OpenAPIParser();
    const instance = parser.parse(doc, {} as never);
    const op = instance.paths.find((operation) => operation.methodType === 'Copy');
    expect(op).toBeDefined();
    parser.parsePathAsync(op!, instance, {} as never);
    expect(op!.parameters).toHaveLength(1);
  });
});
