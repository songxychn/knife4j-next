import { SpecParserFactory } from '../../../models/SpecParserFactory';
import { SpecType } from '../../../models/SpecType';
import { Knife4jValidateNumericObject } from '../../../models/knife4j/validate/Knife4jValidateNumericObject';
import data from './test.json';
import referencedPathDocument from '../../fixtures/openapi31/document-objects-3.1.2.json';

test('creates a Knife4j instance from an OpenAPI document', () => {
  const factory = new SpecParserFactory();
  const parser = factory.getParser(SpecType.OpenAPI);

  const instance = parser.parse(data, {});

  expect(instance.version).toBe('3.1.0');
  expect(instance.info.title).toBe('Swagger Petstore - OpenAPI 3.1');
  expect(instance.tagNames.pet).toBe(8);
  expect(instance.servers[0].url).toBe('https://petstore3.swagger.io/api/v3');
  expect(instance.paths.some((path) => path.url === '/pet/findByStatus' && path.methodType === 'get')).toBe(true);
});

test('accepts a 3.1 document without paths', () => {
  const parser = new SpecParserFactory().getParser(SpecType.OpenAPI);
  const instance = parser.parse(
    {
      openapi: '3.1.1',
      info: { title: 'Webhook only', version: '1.0.0' },
      webhooks: {
        changed: {
          post: { summary: 'Changed', responses: { 200: { description: 'OK' } } },
        },
      },
    },
    {},
  );

  expect(instance.version).toBe('3.1.1');
  expect(instance.paths).toEqual([]);
});

test('only parses standard HTTP operation fields from a Path Item', () => {
  const parser = new SpecParserFactory().getParser(SpecType.OpenAPI);
  const instance = parser.parse(
    {
      openapi: '3.1.1',
      info: { title: 'Trace API', version: '1.0.0' },
      paths: {
        '/trace': {
          summary: 'Path metadata',
          parameters: [{ name: 'requestId', in: 'query', schema: { type: 'string' } }],
          trace: { summary: 'Trace endpoint', tags: ['trace'], responses: { 200: { description: 'OK' } } },
        },
      },
    },
    {},
  );

  expect(instance.paths).toHaveLength(1);
  expect(instance.paths[0]).toMatchObject({ url: '/trace', methodType: 'trace', summary: 'Trace endpoint' });
});

test.each(['3.0.4', '3.1.2'])('ignores Paths specification extensions for OpenAPI %s', (openapi) => {
  const parser = new SpecParserFactory().getParser(SpecType.OpenAPI);
  const instance = parser.parse(
    {
      openapi,
      info: { title: 'Paths extensions', version: '1.0.0' },
      paths: {
        'x-vendor': {
          get: { summary: 'Extension payload, not an operation', responses: { 200: { description: 'Ignored' } } },
        },
        '/pets': {
          get: { summary: 'List pets', responses: { 200: { description: 'OK' } } },
        },
      },
    },
    {},
  );

  expect(instance.paths.map(({ url, methodType }) => ({ url, methodType }))).toEqual([
    { url: '/pets', methodType: 'get' },
  ]);
});

test('resolves Path Item references and inherited component parameters without guessing conflicts', () => {
  const parser = new SpecParserFactory().getParser(SpecType.OpenAPI);
  const instance = parser.parse(referencedPathDocument, {});

  expect(instance.paths).toHaveLength(2);
  const post = instance.paths.find((operation) => operation.methodType === 'post');
  expect(post).toMatchObject({
    url: '/pets/{id}',
    summary: 'Update pet',
    description: 'Local path description',
  });

  parser.parsePathAsync(post!, instance, {});
  expect(post?.parameters.map(({ name, description }) => ({ name, description }))).toEqual([
    { name: 'id', description: 'Operation-specific id' },
    { name: 'locale', description: '' },
  ]);
});

test('keeps the existing OpenAPI 3.0 parser behavior for Path Item references', () => {
  const parser = new SpecParserFactory().getParser(SpecType.OpenAPI);
  const instance = parser.parse(
    {
      openapi: '3.0.4',
      info: { title: 'Legacy Path Item handling', version: '1.0.0' },
      paths: {
        '/pets': {
          $ref: '#/components/pathItems/Pets',
          post: { summary: 'Local POST', responses: { 204: { description: 'Updated' } } },
        },
      },
      components: {
        pathItems: {
          Pets: { get: { summary: 'Referenced GET', responses: { 200: { description: 'OK' } } } },
        },
      },
    },
    {},
  );

  expect(instance.paths.map(({ methodType, summary }) => ({ methodType, summary }))).toEqual([
    { methodType: 'post', summary: 'Local POST' },
  ]);
});

test('parses request body properties from the media type schema', () => {
  const parser = new SpecParserFactory().getParser(SpecType.OpenAPI);
  const instance = parser.parse(
    {
      openapi: '3.1.1',
      info: { title: 'Request body', version: '1.0.0' },
      paths: {
        '/pets': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                  },
                },
              },
            },
            responses: { 200: { description: 'OK' } },
          },
        },
      },
    },
    {},
  );

  parser.parsePathAsync(instance.paths[0], instance, {});
  expect(instance.paths[0].requestBody[0].parameters).toHaveLength(1);
  expect(instance.paths[0].requestBody[0].parameters[0].name).toBe('name');
});

test('preserves OpenAPI 3.1 numeric exclusive bounds', () => {
  const constraints = new Knife4jValidateNumericObject();

  constraints.resolveOpenAPI3Schema({ exclusiveMinimum: 0, exclusiveMaximum: 10 });

  expect(constraints).toMatchObject({ exclusiveMinimum: 0, exclusiveMaximum: 10 });
});
