import { SpecParserFactory } from '../../../models/SpecParserFactory';
import { SpecType } from '../../../models/SpecType';
import { Knife4jValidateNumericObject } from '../../../models/knife4j/validate/Knife4jValidateNumericObject';
import data from './test.json';

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
