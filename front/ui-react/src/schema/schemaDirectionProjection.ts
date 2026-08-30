import type { JsonValue } from 'knife4j-schema-engine';
import type { SwaggerDoc } from '../types/swagger';

export type SchemaEvaluationDirection = 'request' | 'response';

export interface DirectionalSchemaProjection {
  readonly document: JsonValue;
  readonly retrievalUri: string;
  referenceFor(reference: string): string;
}

interface SchemaRoot {
  readonly path: readonly string[];
  readonly schema: JsonSchema;
  readonly key: string;
}

interface SchemaLocation {
  readonly originalResource: string;
  readonly originalPath: readonly string[];
  readonly projectedResource: string;
  readonly projectedPath: readonly string[];
  readonly originalDocumentPath: readonly string[];
  readonly projectedBundlePath: readonly string[];
}

const OPENAPI_BASE_DIALECT = 'https://spec.openapis.org/oas/3.1/dialect/base';
const OPENAPI_DATA_KEYS = new Set(['example', 'examples', 'value']);
const OMITTED_PROJECTION_ANNOTATIONS = new Set(['default', 'example', 'examples']);
const SCHEMA_MAP_KEYS = new Set(['$defs', 'definitions', 'dependentSchemas', 'patternProperties', 'properties']);
const SAME_INSTANCE_MAP_KEYS = new Set(['dependentSchemas']);
const SCHEMA_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SAME_INSTANCE_ARRAY_KEYS = new Set(['allOf', 'anyOf', 'oneOf']);
const SCHEMA_VALUE_KEYS = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);
const SAME_INSTANCE_VALUE_KEYS = new Set(['else', 'if', 'not', 'then']);
const REFERENCE_KEYS = new Set(['$dynamicRef', '$recursiveRef', '$ref']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

type JsonSchema = boolean | { [key: string]: JsonValue };

const isSchemaValue = (value: unknown): value is JsonSchema => typeof value === 'boolean' || isRecord(value);

function resourcePart(uri: string): string {
  const url = new URL(uri);
  url.hash = '';
  return url.href;
}

function absoluteReference(reference: string, baseUri: string): string {
  const url = new URL(reference, baseUri);
  if (url.hash === '#') url.hash = '';
  return url.href;
}

function resolveResource(identifier: string, baseUri: string): string {
  return resourcePart(absoluteReference(identifier, baseUri));
}

function pointerToken(token: string): string {
  return encodeURIComponent(token.replace(/~/g, '~0').replace(/\//g, '~1'));
}

function locationReference(resourceUri: string, path: readonly string[]): string {
  if (path.length === 0) return resourcePart(resourceUri);
  return `${resourcePart(resourceUri)}#/${path.map(pointerToken).join('/')}`;
}

function referenceLookupKey(reference: string): string {
  const url = new URL(reference);
  const resource = resourcePart(url.href);
  const fragment = url.hash.slice(1);
  if (!fragment) return JSON.stringify([resource, 'resource']);
  try {
    if (!fragment.startsWith('/')) return JSON.stringify([resource, 'anchor', decodeURIComponent(fragment)]);
    const tokens = fragment
      .slice(1)
      .split('/')
      .map((token) => decodeURIComponent(token));
    return JSON.stringify([resource, 'pointer', tokens]);
  } catch {
    return JSON.stringify([resource, 'raw', fragment]);
  }
}

function collectOpenApiSchemaRoots(document: SwaggerDoc): SchemaRoot[] {
  const roots: SchemaRoot[] = [];

  const visit = (value: unknown, path: readonly string[]): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }
    if (!isRecord(value)) return;

    for (const [key, child] of Object.entries(value)) {
      if (path.length === 1 && path[0] === 'components' && key === 'schemas' && isRecord(child)) {
        for (const [name, schema] of Object.entries(child)) {
          if (!isSchemaValue(schema)) continue;
          roots.push({ path: [...path, key, name], schema, key: `schema${roots.length}` });
        }
        continue;
      }
      if (key === 'schema' && isSchemaValue(child)) {
        roots.push({ path: [...path, key], schema: child, key: `schema${roots.length}` });
        continue;
      }
      if (key.startsWith('x-') || OPENAPI_DATA_KEYS.has(key)) continue;
      visit(child, [...path, key]);
    }
  };

  visit(document, []);
  return roots;
}

function schemaChildren(schema: JsonValue): Array<{ path: readonly string[]; schema: JsonValue }> {
  if (!isRecord(schema)) return [];
  const children: Array<{ path: readonly string[]; schema: JsonValue }> = [];

  for (const keyword of SCHEMA_MAP_KEYS) {
    const values = schema[keyword];
    if (!isRecord(values)) continue;
    for (const [name, child] of Object.entries(values)) {
      if (isSchemaValue(child)) children.push({ path: [keyword, name], schema: child });
    }
  }
  for (const keyword of SCHEMA_ARRAY_KEYS) {
    const values = schema[keyword];
    if (!Array.isArray(values)) continue;
    values.forEach((child, index) => {
      if (isSchemaValue(child)) children.push({ path: [keyword, String(index)], schema: child });
    });
  }
  for (const keyword of SCHEMA_VALUE_KEYS) {
    const child = schema[keyword];
    if (isSchemaValue(child)) children.push({ path: [keyword], schema: child });
    else if (keyword === 'items' && Array.isArray(child)) {
      child.forEach((item, index) => {
        if (isSchemaValue(item)) children.push({ path: [keyword, String(index)], schema: item });
      });
    }
  }
  return children;
}

function ownDirectionalProperties(
  schema: Record<string, unknown>,
  direction: SchemaEvaluationDirection,
): ReadonlySet<string> {
  const ignored = new Set<string>();
  const properties = schema.properties;
  if (!isRecord(properties)) return ignored;
  for (const [name, propertySchema] of Object.entries(properties)) {
    if (!isRecord(propertySchema)) continue;
    if (direction === 'request' ? propertySchema.readOnly === true : propertySchema.writeOnly === true) {
      ignored.add(name);
    }
  }
  return ignored;
}

function cloneRecord(): { [key: string]: JsonValue } {
  return Object.create(null) as { [key: string]: JsonValue };
}

/**
 * Builds a registry-isolated JSON Schema bundle for one OpenAPI direction.
 * The original OpenAPI document remains registered unchanged; only generated
 * candidates are evaluated against this projection.
 */
export function createDirectionalSchemaProjection(
  document: SwaggerDoc,
  retrievalUri: string,
  direction: SchemaEvaluationDirection,
  namespaceUri: string,
): DirectionalSchemaProjection {
  const originalRetrieval = resourcePart(retrievalUri);
  const documentRecord = document as SwaggerDoc & { $id?: unknown };
  const originalDocumentResource =
    typeof documentRecord.$id === 'string' ? resolveResource(documentRecord.$id, originalRetrieval) : originalRetrieval;
  const namespace = new URL(`${direction}/`, namespaceUri).href;
  const projectedRetrieval = new URL('bundle', namespace).href;
  const roots = collectOpenApiSchemaRoots(document);
  const resourceMap = new Map<string, string>([
    [originalRetrieval, projectedRetrieval],
    [originalDocumentResource, projectedRetrieval],
  ]);
  let projectedResourceIndex = 0;

  const mappedResource = (originalResource: string): string => {
    const normalized = resourcePart(originalResource);
    const existing = resourceMap.get(normalized);
    if (existing) return existing;
    const mapped = new URL(`resources/${projectedResourceIndex}`, namespace).href;
    projectedResourceIndex += 1;
    resourceMap.set(normalized, mapped);
    return mapped;
  };

  const collectResources = (schema: JsonValue, baseUri: string): void => {
    if (!isRecord(schema)) return;
    const localBase = typeof schema.$id === 'string' ? resolveResource(schema.$id, baseUri) : baseUri;
    if (typeof schema.$id === 'string') mappedResource(localBase);
    schemaChildren(schema).forEach((child) => collectResources(child.schema, localBase));
  };
  roots.forEach((root) => collectResources(root.schema, originalDocumentResource));

  const locationMap = new Map<string, string>();
  const rememberLocation = (original: string, projected: string): void => {
    const key = referenceLookupKey(original);
    if (!locationMap.has(key)) locationMap.set(key, projected);
  };

  const collectLocations = (schema: JsonValue, location: SchemaLocation): void => {
    const originalAlias = locationReference(originalRetrieval, location.originalDocumentPath);
    const projectedAlias = locationReference(projectedRetrieval, location.projectedBundlePath);
    rememberLocation(originalAlias, projectedAlias);
    rememberLocation(
      locationReference(location.originalResource, location.originalPath),
      locationReference(location.projectedResource, location.projectedPath),
    );

    let scopedLocation = location;
    if (isRecord(schema) && typeof schema.$id === 'string') {
      const originalResource = resolveResource(schema.$id, location.originalResource);
      const projectedResource = mappedResource(originalResource);
      rememberLocation(originalResource, projectedResource);
      scopedLocation = {
        ...location,
        originalResource,
        originalPath: [],
        projectedResource,
        projectedPath: [],
      };
    }

    for (const child of schemaChildren(schema)) {
      collectLocations(child.schema, {
        originalResource: scopedLocation.originalResource,
        originalPath: [...scopedLocation.originalPath, ...child.path],
        projectedResource: scopedLocation.projectedResource,
        projectedPath: [...scopedLocation.projectedPath, ...child.path],
        originalDocumentPath: [...location.originalDocumentPath, ...child.path],
        projectedBundlePath: [...location.projectedBundlePath, ...child.path],
      });
    }
  };

  roots.forEach((root) =>
    collectLocations(root.schema, {
      originalResource: originalDocumentResource,
      originalPath: root.path,
      projectedResource: projectedRetrieval,
      projectedPath: ['$defs', root.key],
      originalDocumentPath: root.path,
      projectedBundlePath: ['$defs', root.key],
    }),
  );

  const rewriteReference = (reference: string, baseUri: string): string => {
    const absolute = absoluteReference(reference, baseUri);
    const exact = locationMap.get(referenceLookupKey(absolute));
    if (exact) return exact;
    const url = new URL(absolute);
    const fragment = url.hash;
    url.hash = '';
    const mapped = resourceMap.get(url.href);
    return mapped ? `${mapped}${fragment}` : absolute;
  };

  const cloneData = (value: unknown): JsonValue => structuredClone(value) as JsonValue;

  const cloneSchema = (
    schema: JsonValue,
    location: Pick<SchemaLocation, 'originalResource' | 'originalPath' | 'projectedResource' | 'projectedPath'>,
    inheritedIgnored: ReadonlySet<string>,
  ): JsonValue => {
    if (!isRecord(schema)) return schema;

    let scopedLocation = location;
    if (typeof schema.$id === 'string') {
      const originalResource = resolveResource(schema.$id, location.originalResource);
      scopedLocation = {
        originalResource,
        originalPath: [],
        projectedResource: mappedResource(originalResource),
        projectedPath: [],
      };
    }

    const ignored = new Set(inheritedIgnored);
    ownDirectionalProperties(schema, direction).forEach((name) => ignored.add(name));
    const result = cloneRecord();

    for (const [key, child] of Object.entries(schema)) {
      // Candidate-source annotations are read from the unchanged document.
      // They do not constrain validation and may contain schema-shaped data.
      if (OMITTED_PROJECTION_ANNOTATIONS.has(key)) continue;
      if (key === '$id' && typeof child === 'string') {
        result[key] = scopedLocation.projectedResource;
        continue;
      }
      if (REFERENCE_KEYS.has(key) && typeof child === 'string') {
        result[key] = rewriteReference(child, scopedLocation.originalResource);
        continue;
      }
      if (key === 'required' && Array.isArray(child)) {
        result[key] = child.filter((name) => typeof name !== 'string' || !ignored.has(name)) as JsonValue;
        continue;
      }
      if (key === 'dependentRequired' && isRecord(child)) {
        const dependencies = cloneRecord();
        for (const [name, names] of Object.entries(child)) {
          dependencies[name] = Array.isArray(names)
            ? (names.filter((candidate) => typeof candidate !== 'string' || !ignored.has(candidate)) as JsonValue)
            : cloneData(names);
        }
        result[key] = dependencies;
        continue;
      }
      if (SCHEMA_MAP_KEYS.has(key) && isRecord(child)) {
        const values = cloneRecord();
        for (const [name, nested] of Object.entries(child)) {
          const childLocation = {
            originalResource: scopedLocation.originalResource,
            originalPath: [...scopedLocation.originalPath, key, name],
            projectedResource: scopedLocation.projectedResource,
            projectedPath: [...scopedLocation.projectedPath, key, name],
          };
          values[name] = isSchemaValue(nested)
            ? cloneSchema(nested, childLocation, SAME_INSTANCE_MAP_KEYS.has(key) ? ignored : new Set())
            : cloneData(nested);
        }
        result[key] = values;
        continue;
      }
      if (SCHEMA_ARRAY_KEYS.has(key) && Array.isArray(child)) {
        result[key] = child.map((nested, index) => {
          if (!isSchemaValue(nested)) return cloneData(nested);
          return cloneSchema(
            nested,
            {
              originalResource: scopedLocation.originalResource,
              originalPath: [...scopedLocation.originalPath, key, String(index)],
              projectedResource: scopedLocation.projectedResource,
              projectedPath: [...scopedLocation.projectedPath, key, String(index)],
            },
            SAME_INSTANCE_ARRAY_KEYS.has(key) ? ignored : new Set(),
          );
        });
        continue;
      }
      if (SCHEMA_VALUE_KEYS.has(key)) {
        const cloneNested = (nested: unknown, suffix: readonly string[]): JsonValue =>
          isSchemaValue(nested)
            ? cloneSchema(
                nested,
                {
                  originalResource: scopedLocation.originalResource,
                  originalPath: [...scopedLocation.originalPath, key, ...suffix],
                  projectedResource: scopedLocation.projectedResource,
                  projectedPath: [...scopedLocation.projectedPath, key, ...suffix],
                },
                SAME_INSTANCE_VALUE_KEYS.has(key) ? ignored : new Set(),
              )
            : cloneData(nested);
        result[key] =
          key === 'items' && Array.isArray(child)
            ? child.map((nested, index) => cloneNested(nested, [String(index)]))
            : cloneNested(child, []);
        continue;
      }
      result[key] = cloneData(child);
    }
    return result;
  };

  const definitions = cloneRecord();
  for (const root of roots) {
    definitions[root.key] = cloneSchema(
      root.schema,
      {
        originalResource: originalDocumentResource,
        originalPath: root.path,
        projectedResource: projectedRetrieval,
        projectedPath: ['$defs', root.key],
      },
      new Set(),
    );
  }

  const projectionDocument = cloneRecord();
  projectionDocument.$schema =
    typeof document.jsonSchemaDialect === 'string' ? document.jsonSchemaDialect : OPENAPI_BASE_DIALECT;
  projectionDocument.$id = projectedRetrieval;
  projectionDocument.$defs = definitions;

  return Object.freeze({
    document: projectionDocument,
    retrievalUri: projectedRetrieval,
    referenceFor: (reference: string): string => rewriteReference(reference, originalRetrieval),
  });
}
