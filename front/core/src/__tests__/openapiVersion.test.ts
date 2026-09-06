import * as core from '../index';
import * as legacyDocument from '../openapi31/document';
import * as legacyOpenApi31 from '../openapi31';
import {
  OPENAPI_HTTP_METHODS,
  getOpenApiSpecificationFeatures,
  getOpenApiStandardHttpMethods,
  isOpenApi3Version,
  isOpenApi31Version,
  parseOpenApiVersion,
  type OpenApiHttpMethod,
  type OpenApiVersionFamily,
} from '../openapiVersion';

describe('OpenAPI specification features', () => {
  test.each<OpenApiVersionFamily>(['3.0', '3.1', '3.2'])(
    'shares one immutable description across %s patches',
    (family) => {
      const features = getOpenApiSpecificationFeatures(`${family}.0`);
      expect(features?.family).toBe(family);
      expect(Object.isFrozen(features)).toBe(true);
      expect(Object.isFrozen(features?.standardHttpMethods)).toBe(true);
      for (const patch of ['1', '2', '4', '999', '123456789']) {
        expect(getOpenApiSpecificationFeatures(`${family}.${patch}`)).toBe(features);
      }
    },
  );

  test.each(['3.3.0', '3.10.0', '4.0.0', '2.0.0', '0.0.0'])(
    'does not infer a known feature family for %s',
    (version) => {
      expect(parseOpenApiVersion(version)).not.toBeNull();
      expect(getOpenApiSpecificationFeatures(version)).toBeNull();
      expect(getOpenApiStandardHttpMethods(version)).toBeNull();
    },
  );

  test.each([
    undefined,
    null,
    false,
    3.2,
    {},
    ['3.2.0'],
    '',
    '3.2',
    '3.2.',
    '3.2.0.1',
    '03.2.0',
    '3.02.0',
    ' 3.2.0 ',
    'v3.2.0',
    '3.2.0+build',
    '3.2.0-',
  ])('returns no features or methods for invalid version %p', (version) => {
    expect(parseOpenApiVersion(version)).toBeNull();
    expect(getOpenApiSpecificationFeatures(version)).toBeNull();
    expect(getOpenApiStandardHttpMethods(version)).toBeNull();
  });

  test('preserves the existing parser syntax for patch and prerelease strings', () => {
    for (const family of ['3.0', '3.1', '3.2']) {
      const features = getOpenApiSpecificationFeatures(`${family}.0`);
      for (const suffix of ['0-beta', '0-beta+build', '12-preview.1', '001']) {
        expect(getOpenApiSpecificationFeatures(`${family}.${suffix}`)).toBe(features);
      }
    }
    expect(parseOpenApiVersion('3.1.12-preview.1')).toEqual({ major: 3, minor: 1, patch: 12 });
    expect(parseOpenApiVersion('3.2.001')).toEqual({ major: 3, minor: 2, patch: 1 });
    expect(isOpenApi31Version('3.1.2+build')).toBe(false);
    expect(isOpenApi31Version('3.1.2-beta+build')).toBe(true);
  });

  test('keeps the legacy method contract and only adds query to the 3.2 specification methods', () => {
    const legacyMethods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'];
    expect(OPENAPI_HTTP_METHODS).toEqual(legacyMethods);
    expect(getOpenApiStandardHttpMethods('3.0.4')).toEqual(legacyMethods);
    expect(getOpenApiStandardHttpMethods('3.1.2')).toEqual(legacyMethods);
    expect(getOpenApiStandardHttpMethods('3.2.0')).toEqual([...legacyMethods, 'query']);
    expect(getOpenApiStandardHttpMethods('3.2.999')).toBe(
      getOpenApiSpecificationFeatures('3.2.0')?.standardHttpMethods,
    );

    const queryIsLegacyMethod: 'query' extends OpenApiHttpMethod ? true : false = false;
    expect(queryIsLegacyMethod).toBe(false);
  });

  test('does not enable the existing 3.1 predicate for other recognized or future families', () => {
    expect(isOpenApi31Version('3.1.999')).toBe(true);
    for (const version of ['3.0.4', '3.2.0', '3.2.999', '3.3.0', '4.0.0']) {
      expect(isOpenApi31Version(version)).toBe(false);
    }
    expect(isOpenApi3Version('3.3.0')).toBe(true);
    expect(isOpenApi3Version('4.0.0')).toBe(false);
  });

  test('retains the existing root, openapi31, and document import paths', () => {
    for (const exports of [core, legacyOpenApi31, legacyDocument]) {
      expect(exports.OPENAPI_HTTP_METHODS).toBe(OPENAPI_HTTP_METHODS);
      expect(exports.parseOpenApiVersion).toBe(parseOpenApiVersion);
      expect(exports.isOpenApi3Version).toBe(isOpenApi3Version);
      expect(exports.isOpenApi31Version).toBe(isOpenApi31Version);
    }
    expect(core.getOpenApiSpecificationFeatures).toBe(getOpenApiSpecificationFeatures);
    expect(core.getOpenApiStandardHttpMethods).toBe(getOpenApiStandardHttpMethods);
  });
});
