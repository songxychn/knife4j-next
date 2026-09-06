export const OPENAPI_HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'] as const;

export type OpenApiHttpMethod = (typeof OPENAPI_HTTP_METHODS)[number];

export interface ParsedOpenApiVersion {
  major: number;
  minor: number;
  patch: number;
}

export type OpenApiVersionFamily = '3.0' | '3.1' | '3.2';

export type OpenApiStandardHttpMethod = OpenApiHttpMethod | 'query';

/**
 * Fields defined by an OpenAPI specification family, not Knife4j workflow support.
 * Consumers must keep their own support gates until they implement that family's semantics.
 */
export interface OpenApiSpecificationFeatures {
  readonly family: OpenApiVersionFamily;
  /** Fixed Path Item fields containing operations; excludes additionalOperations. */
  readonly standardHttpMethods: readonly OpenApiStandardHttpMethod[];
}

const OPENAPI_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(\d+)(?:-(.+))?$/;
const OPENAPI_30_31_STANDARD_HTTP_METHODS = Object.freeze([...OPENAPI_HTTP_METHODS]);
const OPENAPI_32_STANDARD_HTTP_METHODS = Object.freeze([...OPENAPI_HTTP_METHODS, 'query'] as const);
const OPENAPI_SPECIFICATION_FEATURES: Readonly<Record<OpenApiVersionFamily, OpenApiSpecificationFeatures>> =
  Object.freeze({
    '3.0': Object.freeze({ family: '3.0', standardHttpMethods: OPENAPI_30_31_STANDARD_HTTP_METHODS }),
    '3.1': Object.freeze({ family: '3.1', standardHttpMethods: OPENAPI_30_31_STANDARD_HTTP_METHODS }),
    '3.2': Object.freeze({ family: '3.2', standardHttpMethods: OPENAPI_32_STANDARD_HTTP_METHODS }),
  });

export function parseOpenApiVersion(value: unknown): ParsedOpenApiVersion | null {
  if (typeof value !== 'string') return null;
  const match = OPENAPI_VERSION_PATTERN.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isOpenApi3Version(value: unknown): boolean {
  return parseOpenApiVersion(value)?.major === 3;
}

export function isOpenApi31Version(value: unknown): boolean {
  const version = parseOpenApiVersion(value);
  return version?.major === 3 && version.minor === 1;
}

/** Return specification metadata only for known families, without inferring product support. */
export function getOpenApiSpecificationFeatures(value: unknown): OpenApiSpecificationFeatures | null {
  const version = parseOpenApiVersion(value);
  if (version?.major !== 3) return null;
  switch (version.minor) {
    case 0:
      return OPENAPI_SPECIFICATION_FEATURES['3.0'];
    case 1:
      return OPENAPI_SPECIFICATION_FEATURES['3.1'];
    case 2:
      return OPENAPI_SPECIFICATION_FEATURES['3.2'];
    default:
      return null;
  }
}

/** Return the fixed operation field names for a known version, or null for an unrecognized version. */
export function getOpenApiStandardHttpMethods(value: unknown): readonly OpenApiStandardHttpMethod[] | null {
  return getOpenApiSpecificationFeatures(value)?.standardHttpMethods ?? null;
}
