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

interface IndexedSchema {
  readonly schema: JsonSchema;
  /** Base URI before applying this schema's own `$id`. */
  readonly baseUri: string;
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

function schemaChildren(schema: JsonValue): Array<{ path: readonly string[]; schema: JsonSchema }> {
  if (!isRecord(schema)) return [];
  const children: Array<{ path: readonly string[]; schema: JsonSchema }> = [];

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
  const schemaIndex = new Map<string, IndexedSchema>();
  const rememberLocation = (original: string, projected: string): void => {
    const key = referenceLookupKey(original);
    if (!locationMap.has(key)) locationMap.set(key, projected);
  };
  const rememberSchema = (reference: string, schema: JsonSchema, baseUri: string): void => {
    const key = referenceLookupKey(reference);
    if (!schemaIndex.has(key)) schemaIndex.set(key, { schema, baseUri });
  };

  const collectLocations = (schema: JsonSchema, location: SchemaLocation): void => {
    const originalAlias = locationReference(originalRetrieval, location.originalDocumentPath);
    const projectedAlias = locationReference(projectedRetrieval, location.projectedBundlePath);
    rememberLocation(originalAlias, projectedAlias);
    rememberSchema(originalAlias, schema, location.originalResource);
    const originalLocation = locationReference(location.originalResource, location.originalPath);
    rememberLocation(originalLocation, locationReference(location.projectedResource, location.projectedPath));
    rememberSchema(originalLocation, schema, location.originalResource);

    let scopedLocation = location;
    if (isRecord(schema) && typeof schema.$id === 'string') {
      const originalResource = resolveResource(schema.$id, location.originalResource);
      const projectedResource = mappedResource(originalResource);
      rememberLocation(originalResource, projectedResource);
      rememberSchema(originalResource, schema, location.originalResource);
      scopedLocation = {
        ...location,
        originalResource,
        originalPath: [],
        projectedResource,
        projectedPath: [],
      };
    }
    if (isRecord(schema)) {
      for (const keyword of ['$anchor', '$dynamicAnchor'] as const) {
        const anchor = schema[keyword];
        if (typeof anchor !== 'string') continue;
        rememberSchema(
          absoluteReference(`#${anchor}`, scopedLocation.originalResource),
          schema,
          location.originalResource,
        );
      }
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

  const schemaObjectIds = new WeakMap<Record<string, unknown>, number>();
  let schemaObjectSequence = 0;
  const schemaAnalysisKey = (schema: Record<string, unknown>, baseUri: string): string => {
    let objectId = schemaObjectIds.get(schema);
    if (objectId === undefined) {
      objectId = schemaObjectSequence;
      schemaObjectSequence += 1;
      schemaObjectIds.set(schema, objectId);
    }
    return `${baseUri}\u0000${objectId}`;
  };
  const directionalAnnotationCache = new Map<string, boolean>();
  const directionalPropertiesCache = new Map<string, ReadonlySet<string>>();

  const resolveIndexedSchema = (reference: string, baseUri: string): IndexedSchema | null => {
    try {
      return schemaIndex.get(referenceLookupKey(absoluteReference(reference, baseUri))) ?? null;
    } catch {
      return null;
    }
  };

  const hasDirectionalAnnotation = (
    schema: JsonSchema,
    baseUri: string,
    active: ReadonlySet<string> = new Set(),
  ): boolean => {
    if (!isRecord(schema)) return false;
    const localBase = typeof schema.$id === 'string' ? resolveResource(schema.$id, baseUri) : baseUri;
    const key = schemaAnalysisKey(schema, localBase);
    const cached = directionalAnnotationCache.get(key);
    if (cached !== undefined) return cached;
    if (active.has(key)) return false;
    const nextActive = new Set(active).add(key);

    const annotation = direction === 'request' ? schema.readOnly : schema.writeOnly;
    let result = annotation === true;
    for (const keyword of REFERENCE_KEYS) {
      if (result || typeof schema[keyword] !== 'string') continue;
      const target = resolveIndexedSchema(schema[keyword] as string, localBase);
      if (target) result = hasDirectionalAnnotation(target.schema, target.baseUri, nextActive);
    }
    if (!result && Array.isArray(schema.allOf)) {
      result = schema.allOf.some(
        (branch) => isSchemaValue(branch) && hasDirectionalAnnotation(branch, localBase, nextActive),
      );
    }
    directionalAnnotationCache.set(key, result);
    return result;
  };

  /**
   * Collect annotations that are guaranteed to apply to the same object.
   * `$ref` and every `allOf` branch apply together; `oneOf`/`anyOf` remain
   * branch-local and must not leak directional fields into their siblings.
   */
  const directionalPropertyNames = (
    schema: JsonSchema,
    baseUri: string,
    active: ReadonlySet<string> = new Set(),
  ): ReadonlySet<string> => {
    if (!isRecord(schema)) return new Set();
    const localBase = typeof schema.$id === 'string' ? resolveResource(schema.$id, baseUri) : baseUri;
    const key = schemaAnalysisKey(schema, localBase);
    const cached = directionalPropertiesCache.get(key);
    if (cached) return cached;
    if (active.has(key)) return new Set();
    const nextActive = new Set(active).add(key);
    const names = new Set<string>();

    if (isRecord(schema.properties)) {
      for (const [name, propertySchema] of Object.entries(schema.properties)) {
        if (isSchemaValue(propertySchema) && hasDirectionalAnnotation(propertySchema, localBase)) names.add(name);
      }
    }
    for (const keyword of REFERENCE_KEYS) {
      if (typeof schema[keyword] !== 'string') continue;
      const target = resolveIndexedSchema(schema[keyword] as string, localBase);
      if (target) {
        directionalPropertyNames(target.schema, target.baseUri, nextActive).forEach((name) => names.add(name));
      }
    }
    if (Array.isArray(schema.allOf)) {
      for (const branch of schema.allOf) {
        if (!isSchemaValue(branch)) continue;
        directionalPropertyNames(branch, localBase, nextActive).forEach((name) => names.add(name));
      }
    }
    directionalPropertiesCache.set(key, names);
    return names;
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
    directionalPropertyNames(schema, location.originalResource).forEach((name) => ignored.add(name));
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
