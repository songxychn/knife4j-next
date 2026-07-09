import { SpecParserFactory } from '../../../models/SpecParserFactory';
import { SpecType } from '../../../models/SpecType';
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
