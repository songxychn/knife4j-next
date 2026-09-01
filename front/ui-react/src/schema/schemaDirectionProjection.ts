import type { JsonValue } from 'knife4j-schema-engine';
import type { SwaggerDoc } from '../types/swagger';

export type SchemaEvaluationDirection = 'request' | 'response';

export interface DirectionalSchemaProjection {
  readonly document: JsonValue;
  readonly retrievalUri: string;
  referenceFor(reference: string): string;
}

export interface DirectionalSchemaProjectionOptions {
  /**
   * Properties that are intentionally outside JSON evaluation (for example
   * multipart files). They are removed from required/dependentRequired while
   * the remaining logical object is evaluated normally.
   */
  readonly ignoredProperties?: readonly {
    readonly reference: string;
    readonly names: readonly string[];
  }[];
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
  readonly location: Pick<SchemaLocation, 'originalResource' | 'originalPath' | 'projectedResource' | 'projectedPath'>;
}

interface ProjectionSpecialization {
  readonly index: number;
  readonly resources: Map<string, string>;
}

interface ProjectionIgnoredProperties {
  readonly id: number;
  readonly names: ReadonlySet<string>;
}

const OPENAPI_BASE_DIALECT = 'https://spec.openapis.org/oas/3.1/dialect/base';
// Keep construction bounded before the lazily loaded engine can apply its
// matching registration limits. A runtime import here would collapse that
// engine back into the main UI chunk.
const DIRECTIONAL_PROJECTION_LIMITS = Object.freeze({
  maxAnalysisDepth: 2_048,
  maxAnalysisStates: 20_000,
  maxDepth: 256,
  maxNodes: 100_000,
  maxResources: 1_000,
  maxReferences: 20_000,
  maxMetadataEntries: 100_000,
  maxMetadataOperations: 1_000_000,
});
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

class DirectionalProjectionBudgetError extends Error {
  public readonly code = 'SCHEMA_BUDGET_EXCEEDED';
  public readonly details: Readonly<{ limit: number; actual: number }>;

  public constructor(
    kind: 'analysis' | 'analysis-depth' | 'depth' | 'metadata' | 'metadata-work' | 'node' | 'reference' | 'resource',
    limit: number,
    actual: number,
  ) {
    super(`Directional schema projection ${kind} limit exceeded.`);
    this.name = 'SchemaEngineError';
    this.details = Object.freeze({ limit, actual });
  }
}

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
  const rawFragment = url.hash.slice(1);
  if (!rawFragment) return JSON.stringify([resource, 'resource']);
  try {
    const fragment = decodeURIComponent(rawFragment);
    if (!fragment.startsWith('/')) return JSON.stringify([resource, 'anchor', fragment]);
    const tokens = fragment.slice(1).split('/');
    return JSON.stringify([resource, 'pointer', tokens]);
  } catch {
    return JSON.stringify([resource, 'raw', rawFragment]);
  }
}

function collectOpenApiSchemaRoots(document: SwaggerDoc): SchemaRoot[] {
  const roots: SchemaRoot[] = [];
  const addSchema = (schema: unknown, path: readonly string[]): void => {
    if (isSchemaValue(schema)) roots.push({ path, schema, key: `schema${roots.length}` });
  };
  const visitMap = (
    value: unknown,
    path: readonly string[],
    visit: (entry: unknown, entryPath: readonly string[]) => void,
  ): void => {
    if (!isRecord(value)) return;
    for (const [name, entry] of Object.entries(value)) visit(entry, [...path, name]);
  };
  const visitContent = (value: unknown, path: readonly string[]): void => {
    visitMap(value, path, (mediaType, mediaTypePath) => {
      if (!isRecord(mediaType)) return;
      addSchema(mediaType.schema, [...mediaTypePath, 'schema']);
      visitMap(mediaType.encoding, [...mediaTypePath, 'encoding'], (encoding, encodingPath) => {
        if (isRecord(encoding)) visitHeaders(encoding.headers, [...encodingPath, 'headers']);
      });
    });
  };
  const visitParameter = (value: unknown, path: readonly string[]): void => {
    if (!isRecord(value)) return;
    addSchema(value.schema, [...path, 'schema']);
    visitContent(value.content, [...path, 'content']);
  };
  const visitHeader = (value: unknown, path: readonly string[]): void => visitParameter(value, path);
  function visitHeaders(value: unknown, path: readonly string[]): void {
    visitMap(value, path, visitHeader);
  }
  const visitRequestBody = (value: unknown, path: readonly string[]): void => {
    if (isRecord(value)) visitContent(value.content, [...path, 'content']);
  };
  const visitResponse = (value: unknown, path: readonly string[]): void => {
    if (!isRecord(value)) return;
    visitHeaders(value.headers, [...path, 'headers']);
    visitContent(value.content, [...path, 'content']);
  };
  const visitOperation = (value: unknown, path: readonly string[]): void => {
    if (!isRecord(value)) return;
    if (Array.isArray(value.parameters)) {
      value.parameters.forEach((parameter, index) => visitParameter(parameter, [...path, 'parameters', String(index)]));
    }
    visitRequestBody(value.requestBody, [...path, 'requestBody']);
    visitMap(value.responses, [...path, 'responses'], visitResponse);
    visitMap(value.callbacks, [...path, 'callbacks'], visitCallback);
  };
  function visitPathItem(value: unknown, path: readonly string[]): void {
    if (!isRecord(value)) return;
    if (Array.isArray(value.parameters)) {
      value.parameters.forEach((parameter, index) => visitParameter(parameter, [...path, 'parameters', String(index)]));
    }
    for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      visitOperation(value[method], [...path, method]);
    }
  }
  function visitCallback(value: unknown, path: readonly string[]): void {
    visitMap(value, path, (pathItem, expressionPath) => {
      if (expressionPath[expressionPath.length - 1] !== '$ref') visitPathItem(pathItem, expressionPath);
    });
  }

  if (isRecord(document.components)) {
    const components = document.components;
    visitMap(components.schemas, ['components', 'schemas'], (schema, path) => addSchema(schema, path));
    visitMap(components.parameters, ['components', 'parameters'], visitParameter);
    visitMap(components.headers, ['components', 'headers'], visitHeader);
    visitMap(components.requestBodies, ['components', 'requestBodies'], visitRequestBody);
    visitMap(components.responses, ['components', 'responses'], visitResponse);
    visitMap(components.callbacks, ['components', 'callbacks'], visitCallback);
    visitMap(components.pathItems, ['components', 'pathItems'], visitPathItem);
  }
  visitMap(document.paths, ['paths'], visitPathItem);
  visitMap((document as SwaggerDoc & { webhooks?: unknown }).webhooks, ['webhooks'], visitPathItem);
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
  options: DirectionalSchemaProjectionOptions = {},
): DirectionalSchemaProjection {
  const originalRetrieval = resourcePart(retrievalUri);
  const documentRecord = document as SwaggerDoc & { $id?: unknown };
  const originalDocumentResource =
    typeof documentRecord.$id === 'string' ? resolveResource(documentRecord.$id, originalRetrieval) : originalRetrieval;
  const namespace = new URL(`${direction}/`, namespaceUri).href;
  const projectedRetrieval = new URL('bundle', namespace).href;
  const roots = collectOpenApiSchemaRoots(document);
  const explicitlyIgnoredNames = new Map<string, ReadonlySet<string>>();
  for (const entry of options.ignoredProperties ?? []) {
    try {
      explicitlyIgnoredNames.set(
        referenceLookupKey(absoluteReference(entry.reference, originalRetrieval)),
        new Set(entry.names),
      );
    } catch {
      // The eventual reference lookup reports an unavailable schema. Keeping
      // projection construction side-effect free is safer than guessing here.
    }
  }
  let projectionMetadataEntries = 0;
  let projectionMetadataOperations = 0;
  const reserveProjectionMetadataEntries = (count: number): void => {
    const actual = projectionMetadataEntries + count;
    if (actual > DIRECTIONAL_PROJECTION_LIMITS.maxMetadataEntries) {
      throw new DirectionalProjectionBudgetError('metadata', DIRECTIONAL_PROJECTION_LIMITS.maxMetadataEntries, actual);
    }
    projectionMetadataEntries = actual;
  };
  const reserveProjectionMetadataOperations = (count = 1): void => {
    const actual = projectionMetadataOperations + count;
    if (actual > DIRECTIONAL_PROJECTION_LIMITS.maxMetadataOperations) {
      throw new DirectionalProjectionBudgetError(
        'metadata-work',
        DIRECTIONAL_PROJECTION_LIMITS.maxMetadataOperations,
        actual,
      );
    }
    projectionMetadataOperations = actual;
  };
  const sourceCosts = new WeakMap<object, { readonly nodes: number; readonly references: number }>();
  const sourceCost = (value: JsonValue, depth = 0): { readonly nodes: number; readonly references: number } => {
    if (depth > DIRECTIONAL_PROJECTION_LIMITS.maxDepth) {
      throw new DirectionalProjectionBudgetError('depth', DIRECTIONAL_PROJECTION_LIMITS.maxDepth, depth);
    }
    if (value === null || typeof value !== 'object') return { nodes: 1, references: 0 };
    const cached = sourceCosts.get(value);
    if (cached) return cached;
    let nodes = 1;
    let references = 0;
    const children = Array.isArray(value) ? value.map((child) => [null, child] as const) : Object.entries(value);
    for (const [key, child] of children) {
      const childCost = sourceCost(child as JsonValue, depth + 1);
      nodes += childCost.nodes;
      references += childCost.references;
      if (key === '$ref' || key === '$dynamicRef') references += 1;
    }
    const cost = { nodes, references };
    sourceCosts.set(value, cost);
    return cost;
  };
  let projectedNodes = 4;
  let projectedReferences = 0;
  const reserveProjectedClone = (schema: JsonValue, additionalNodes = 0): void => {
    const cost = sourceCost(schema);
    const nextNodes = projectedNodes + cost.nodes + additionalNodes;
    if (nextNodes > DIRECTIONAL_PROJECTION_LIMITS.maxNodes) {
      throw new DirectionalProjectionBudgetError('node', DIRECTIONAL_PROJECTION_LIMITS.maxNodes, nextNodes);
    }
    const nextReferences = projectedReferences + cost.references;
    if (nextReferences > DIRECTIONAL_PROJECTION_LIMITS.maxReferences) {
      throw new DirectionalProjectionBudgetError(
        'reference',
        DIRECTIONAL_PROJECTION_LIMITS.maxReferences,
        nextReferences,
      );
    }
    projectedNodes = nextNodes;
    projectedReferences = nextReferences;
  };
  const projectedResources = new Set<string>([projectedRetrieval]);
  const reserveProjectedResource = (resource: string): string => {
    const normalized = resourcePart(resource);
    if (projectedResources.has(normalized)) return normalized;
    const nextResources = projectedResources.size + 1;
    if (nextResources > DIRECTIONAL_PROJECTION_LIMITS.maxResources) {
      throw new DirectionalProjectionBudgetError('resource', DIRECTIONAL_PROJECTION_LIMITS.maxResources, nextResources);
    }
    projectedResources.add(normalized);
    return normalized;
  };
  const resourceMap = new Map<string, string>([
    [originalRetrieval, projectedRetrieval],
    [originalDocumentResource, projectedRetrieval],
  ]);
  let projectedResourceIndex = 0;

  const mappedResource = (originalResource: string): string => {
    const normalized = resourcePart(originalResource);
    const existing = resourceMap.get(normalized);
    if (existing) return existing;
    const mapped = reserveProjectedResource(new URL(`resources/${projectedResourceIndex}`, namespace).href);
    projectedResourceIndex += 1;
    resourceMap.set(normalized, mapped);
    return mapped;
  };

  const collectResources = (schema: JsonValue, baseUri: string, depth = 0): void => {
    if (depth > DIRECTIONAL_PROJECTION_LIMITS.maxDepth) {
      throw new DirectionalProjectionBudgetError('depth', DIRECTIONAL_PROJECTION_LIMITS.maxDepth, depth);
    }
    if (!isRecord(schema)) return;
    const localBase = typeof schema.$id === 'string' ? resolveResource(schema.$id, baseUri) : baseUri;
    if (typeof schema.$id === 'string') mappedResource(localBase);
    schemaChildren(schema).forEach((child) => collectResources(child.schema, localBase, depth + 1));
  };
  roots.forEach((root) => collectResources(root.schema, originalDocumentResource));

  const locationMap = new Map<string, string>();
  const schemaIndex = new Map<string, IndexedSchema>();
  const dynamicAnchorsByResource = new Map<string, Map<string, IndexedSchema>>();
  const dynamicReferences: Array<{ readonly reference: string; readonly baseUri: string }> = [];
  const rememberLocation = (original: string, projected: string): void => {
    const key = referenceLookupKey(original);
    if (!locationMap.has(key)) locationMap.set(key, projected);
  };
  const rememberSchema = (reference: string, schema: JsonSchema, location: SchemaLocation): IndexedSchema => {
    const key = referenceLookupKey(reference);
    let indexed = schemaIndex.get(key);
    if (!indexed) {
      indexed = {
        schema,
        baseUri: location.originalResource,
        location: {
          originalResource: location.originalResource,
          originalPath: location.originalPath,
          projectedResource: location.projectedResource,
          projectedPath: location.projectedPath,
        },
      };
      schemaIndex.set(key, indexed);
    }
    return indexed;
  };

  const collectLocations = (schema: JsonSchema, location: SchemaLocation, depth = 0): void => {
    if (depth > DIRECTIONAL_PROJECTION_LIMITS.maxDepth) {
      throw new DirectionalProjectionBudgetError('depth', DIRECTIONAL_PROJECTION_LIMITS.maxDepth, depth);
    }
    const originalAlias = locationReference(originalRetrieval, location.originalDocumentPath);
    const projectedAlias = locationReference(projectedRetrieval, location.projectedBundlePath);
    rememberLocation(originalAlias, projectedAlias);
    rememberSchema(originalAlias, schema, location);
    const originalLocation = locationReference(location.originalResource, location.originalPath);
    rememberLocation(originalLocation, locationReference(location.projectedResource, location.projectedPath));
    rememberSchema(originalLocation, schema, location);

    let scopedLocation = location;
    if (isRecord(schema) && typeof schema.$id === 'string') {
      const originalResource = resolveResource(schema.$id, location.originalResource);
      const projectedResource = mappedResource(originalResource);
      rememberLocation(originalResource, projectedResource);
      rememberSchema(originalResource, schema, location);
      scopedLocation = {
        ...location,
        originalResource,
        originalPath: [],
        projectedResource,
        projectedPath: [],
      };
    }
    if (isRecord(schema)) {
      if (typeof schema.$dynamicRef === 'string') {
        dynamicReferences.push({ reference: schema.$dynamicRef, baseUri: scopedLocation.originalResource });
      }
      for (const keyword of ['$anchor', '$dynamicAnchor'] as const) {
        const anchor = schema[keyword];
        if (typeof anchor !== 'string') continue;
        const indexed = rememberSchema(
          absoluteReference(`#${anchor}`, scopedLocation.originalResource),
          schema,
          location,
        );
        if (keyword === '$dynamicAnchor') {
          const resource = resourcePart(scopedLocation.originalResource);
          const anchors = dynamicAnchorsByResource.get(resource) ?? new Map<string, IndexedSchema>();
          if (!anchors.has(anchor)) anchors.set(anchor, indexed);
          dynamicAnchorsByResource.set(resource, anchors);
        }
      }
    }

    for (const child of schemaChildren(schema)) {
      collectLocations(
        child.schema,
        {
          originalResource: scopedLocation.originalResource,
          originalPath: [...scopedLocation.originalPath, ...child.path],
          projectedResource: scopedLocation.projectedResource,
          projectedPath: [...scopedLocation.projectedPath, ...child.path],
          originalDocumentPath: [...location.originalDocumentPath, ...child.path],
          projectedBundlePath: [...location.projectedBundlePath, ...child.path],
        },
        depth + 1,
      );
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

  const indexedResource = (indexed: IndexedSchema): string =>
    isRecord(indexed.schema) && typeof indexed.schema.$id === 'string'
      ? resolveResource(indexed.schema.$id, indexed.baseUri)
      : resourcePart(indexed.baseUri);

  const dynamicAnchorName = (reference: string, baseUri: string): string | null => {
    try {
      const url = new URL(absoluteReference(reference, baseUri));
      const fragment = decodeURIComponent(url.hash.slice(1));
      return fragment && !fragment.startsWith('/') ? fragment : null;
    } catch {
      return null;
    }
  };

  const referencedDynamicAnchorIds = new Map<string, number>();
  for (const { reference, baseUri } of dynamicReferences) {
    const anchor = dynamicAnchorName(reference, baseUri);
    if (!anchor || referencedDynamicAnchorIds.has(anchor)) continue;
    let target: IndexedSchema | undefined;
    try {
      target = schemaIndex.get(referenceLookupKey(absoluteReference(reference, baseUri)));
    } catch {
      continue;
    }
    if (!target || !dynamicAnchorsByResource.get(indexedResource(target))?.has(anchor)) continue;
    referencedDynamicAnchorIds.set(anchor, referencedDynamicAnchorIds.size);
  }

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
  const schemaAnalysisBaseIds = new Map<string, number>();
  let schemaObjectSequence = 0;
  const dynamicScopeSignatureIds = new WeakMap<readonly string[], number>();
  const internedDynamicScopeSignatures = new Map<string, number>([['', 0]]);
  const dynamicScopeResourceIds = new Map<string, number>();
  let dynamicScopeSignatureSequence = 1;
  const dynamicScopeSignature = (dynamicScope: readonly string[]): number => {
    const cached = dynamicScopeSignatureIds.get(dynamicScope);
    if (cached !== undefined) return cached;
    if (referencedDynamicAnchorIds.size === 0) {
      dynamicScopeSignatureIds.set(dynamicScope, 0);
      return 0;
    }
    const targets: number[] = [];
    for (const [anchor, anchorId] of referencedDynamicAnchorIds) {
      for (const scopeResource of dynamicScope) {
        reserveProjectionMetadataOperations();
        const resource = resourcePart(scopeResource);
        if (!dynamicAnchorsByResource.get(resource)?.has(anchor)) continue;
        let resourceId = dynamicScopeResourceIds.get(resource);
        if (resourceId === undefined) {
          resourceId = dynamicScopeResourceIds.size;
          dynamicScopeResourceIds.set(resource, resourceId);
        }
        targets.push(anchorId, resourceId);
        break;
      }
    }
    const signature = targets.join(',');
    let signatureId = internedDynamicScopeSignatures.get(signature);
    if (signatureId === undefined) {
      reserveProjectionMetadataEntries(targets.length / 2);
      signatureId = dynamicScopeSignatureSequence;
      dynamicScopeSignatureSequence += 1;
      internedDynamicScopeSignatures.set(signature, signatureId);
    }
    dynamicScopeSignatureIds.set(dynamicScope, signatureId);
    return signatureId;
  };
  const schemaAnalysisKey = (
    schema: Record<string, unknown>,
    baseUri: string,
    dynamicScope: readonly string[],
  ): string => {
    let baseId = schemaAnalysisBaseIds.get(baseUri);
    if (baseId === undefined) {
      baseId = schemaAnalysisBaseIds.size;
      schemaAnalysisBaseIds.set(baseUri, baseId);
    }
    let objectId = schemaObjectIds.get(schema);
    if (objectId === undefined) {
      objectId = schemaObjectSequence;
      schemaObjectSequence += 1;
      schemaObjectIds.set(schema, objectId);
    }
    return `${baseId}\u0000${dynamicScopeSignature(dynamicScope)}\u0000${objectId}`;
  };
  const directionalAnnotationCache = new Map<string, boolean>();
  const directionalPropertiesCache = new Map<string, ReadonlySet<string>>();
  interface DirectionalAnnotationAnalysis {
    readonly value: boolean;
    readonly complete: boolean;
  }
  interface DirectionalPropertiesAnalysis {
    readonly names: ReadonlySet<string>;
    readonly complete: boolean;
  }
  const emptyDirectionalProperties: ReadonlySet<string> = new Set();
  let projectionAnalysisStates = 0;
  const enterProjectionAnalysis = (): void => {
    projectionAnalysisStates += 1;
    if (projectionAnalysisStates > DIRECTIONAL_PROJECTION_LIMITS.maxAnalysisStates) {
      throw new DirectionalProjectionBudgetError(
        'analysis',
        DIRECTIONAL_PROJECTION_LIMITS.maxAnalysisStates,
        projectionAnalysisStates,
      );
    }
  };
  const assertProjectionAnalysisDepth = (active: ReadonlySet<string>): void => {
    const actual = active.size + 1;
    if (actual > DIRECTIONAL_PROJECTION_LIMITS.maxAnalysisDepth) {
      throw new DirectionalProjectionBudgetError(
        'analysis-depth',
        DIRECTIONAL_PROJECTION_LIMITS.maxAnalysisDepth,
        actual,
      );
    }
  };

  const resolveIndexedSchema = (reference: string, baseUri: string): IndexedSchema | null => {
    try {
      return schemaIndex.get(referenceLookupKey(absoluteReference(reference, baseUri))) ?? null;
    } catch {
      return null;
    }
  };

  const dynamicScopeWithResource = (dynamicScope: readonly string[], resource: string): readonly string[] => {
    const normalized = resourcePart(resource);
    return dynamicScope.includes(normalized) ? dynamicScope : [...dynamicScope, normalized];
  };

  const dynamicScopeForSchema = (
    dynamicScope: readonly string[],
    schema: JsonSchema,
    baseUri: string,
  ): readonly string[] =>
    dynamicScopeWithResource(
      dynamicScope,
      isRecord(schema) && typeof schema.$id === 'string' ? resolveResource(schema.$id, baseUri) : baseUri,
    );

  const resolveIndexedReference = (
    keyword: string,
    reference: string,
    baseUri: string,
    dynamicScope: readonly string[],
  ): IndexedSchema | null => {
    const target = resolveIndexedSchema(reference, baseUri);
    if (!target || keyword !== '$dynamicRef') return target;
    const anchor = dynamicAnchorName(reference, baseUri);
    if (!anchor || !dynamicAnchorsByResource.get(indexedResource(target))?.has(anchor)) return target;
    for (const scopeResource of dynamicScope) {
      const override = dynamicAnchorsByResource.get(resourcePart(scopeResource))?.get(anchor);
      if (override) return override;
    }
    return target;
  };

  const analyzeDirectionalAnnotation = (
    schema: JsonSchema,
    baseUri: string,
    dynamicScope: readonly string[],
    active: Set<string> = new Set(),
  ): DirectionalAnnotationAnalysis => {
    if (!isRecord(schema)) return { value: false, complete: true };
    const localBase = typeof schema.$id === 'string' ? resolveResource(schema.$id, baseUri) : baseUri;
    const localDynamicScope = dynamicScopeForSchema(dynamicScope, schema, baseUri);
    const key = schemaAnalysisKey(schema, localBase, localDynamicScope);
    const cached = directionalAnnotationCache.get(key);
    if (cached !== undefined) return { value: cached, complete: true };
    if (active.has(key)) return { value: false, complete: false };
    assertProjectionAnalysisDepth(active);
    enterProjectionAnalysis();
    active.add(key);
    try {
      const annotation = direction === 'request' ? schema.readOnly : schema.writeOnly;
      if (annotation === true) {
        directionalAnnotationCache.set(key, true);
        return { value: true, complete: true };
      }
      let complete = true;
      for (const keyword of REFERENCE_KEYS) {
        if (typeof schema[keyword] !== 'string') continue;
        const target = resolveIndexedReference(keyword, schema[keyword] as string, localBase, localDynamicScope);
        if (target) {
          const analysis = analyzeDirectionalAnnotation(
            target.schema,
            target.baseUri,
            dynamicScopeWithResource(localDynamicScope, indexedResource(target)),
            active,
          );
          if (analysis.value) {
            directionalAnnotationCache.set(key, true);
            return { value: true, complete: true };
          }
          complete &&= analysis.complete;
        }
      }
      if (Array.isArray(schema.allOf)) {
        for (const branch of schema.allOf) {
          if (!isSchemaValue(branch)) continue;
          const analysis = analyzeDirectionalAnnotation(branch, localBase, localDynamicScope, active);
          if (analysis.value) {
            directionalAnnotationCache.set(key, true);
            return { value: true, complete: true };
          }
          complete &&= analysis.complete;
        }
      }
      if (complete) directionalAnnotationCache.set(key, false);
      return { value: false, complete };
    } finally {
      active.delete(key);
    }
  };

  /**
   * Collect annotations that are guaranteed to apply to the same object.
   * `$ref` and every `allOf` branch apply together; `oneOf`/`anyOf` remain
   * branch-local and must not leak directional fields into their siblings.
   */
  const analyzeDirectionalPropertyNames = (
    schema: JsonSchema,
    baseUri: string,
    dynamicScope: readonly string[],
    active: Set<string> = new Set(),
  ): DirectionalPropertiesAnalysis => {
    if (!isRecord(schema)) return { names: emptyDirectionalProperties, complete: true };
    const localBase = typeof schema.$id === 'string' ? resolveResource(schema.$id, baseUri) : baseUri;
    const localDynamicScope = dynamicScopeForSchema(dynamicScope, schema, baseUri);
    const key = schemaAnalysisKey(schema, localBase, localDynamicScope);
    const cached = directionalPropertiesCache.get(key);
    if (cached) return { names: cached, complete: true };
    if (active.has(key)) return { names: emptyDirectionalProperties, complete: false };
    assertProjectionAnalysisDepth(active);
    enterProjectionAnalysis();
    active.add(key);
    try {
      const names = new Set<string>();
      const addName = (name: string): void => {
        reserveProjectionMetadataOperations();
        if (names.has(name)) return;
        reserveProjectionMetadataEntries(1);
        names.add(name);
      };
      const addNames = (additional: ReadonlySet<string>): void => additional.forEach(addName);
      let complete = true;

      if (isRecord(schema.properties)) {
        for (const [name, propertySchema] of Object.entries(schema.properties)) {
          if (isSchemaValue(propertySchema)) {
            const analysis = analyzeDirectionalAnnotation(propertySchema, localBase, localDynamicScope);
            if (analysis.value) addName(name);
            complete &&= analysis.complete;
          }
        }
      }
      for (const keyword of REFERENCE_KEYS) {
        if (typeof schema[keyword] !== 'string') continue;
        const target = resolveIndexedReference(keyword, schema[keyword] as string, localBase, localDynamicScope);
        if (target) {
          const analysis = analyzeDirectionalPropertyNames(
            target.schema,
            target.baseUri,
            dynamicScopeWithResource(localDynamicScope, indexedResource(target)),
            active,
          );
          addNames(analysis.names);
          complete &&= analysis.complete;
        }
      }
      if (Array.isArray(schema.allOf)) {
        for (const branch of schema.allOf) {
          if (!isSchemaValue(branch)) continue;
          const analysis = analyzeDirectionalPropertyNames(branch, localBase, localDynamicScope, active);
          addNames(analysis.names);
          complete &&= analysis.complete;
        }
      }
      if (complete) directionalPropertiesCache.set(key, names);
      return { names, complete };
    } finally {
      active.delete(key);
    }
  };

  const cloneData = (value: unknown): JsonValue => structuredClone(value) as JsonValue;
  const definitions = cloneRecord();
  const specializationReferences = new Map<string, string>();
  const specializationTargetIds = new WeakMap<IndexedSchema, number>();
  const emptyIgnoredProperties: ProjectionIgnoredProperties = Object.freeze({
    id: 0,
    names: emptyDirectionalProperties,
  });
  const ignoredPropertyExtensions = new WeakMap<object, Map<number, ProjectionIgnoredProperties>>();
  let specializationSequence = 0;
  let specializationTargetSequence = 0;
  let ignoredPropertiesSequence = 1;

  const extendIgnoredProperties = (
    inherited: ProjectionIgnoredProperties,
    additional: ReadonlySet<string>,
  ): ProjectionIgnoredProperties => {
    if (additional.size === 0) return inherited;
    let byInherited = ignoredPropertyExtensions.get(additional);
    const cached = byInherited?.get(inherited.id);
    if (cached) return cached;
    if (!byInherited) {
      byInherited = new Map();
      ignoredPropertyExtensions.set(additional, byInherited);
    }

    const additions: string[] = [];
    for (const name of additional) {
      reserveProjectionMetadataOperations();
      if (!inherited.names.has(name)) additions.push(name);
    }
    if (additions.length === 0) {
      byInherited.set(inherited.id, inherited);
      return inherited;
    }

    reserveProjectionMetadataEntries(inherited.names.size + additions.length);
    const names = new Set(inherited.names);
    additions.forEach((name) => names.add(name));
    const extended = Object.freeze({ id: ignoredPropertiesSequence, names });
    ignoredPropertiesSequence += 1;
    byInherited.set(inherited.id, extended);
    return extended;
  };

  const specializationResource = (specialization: ProjectionSpecialization, originalResource: string): string => {
    const normalized = resourcePart(originalResource);
    const existing = specialization.resources.get(normalized);
    if (existing) return existing;
    const resource = new URL(
      `specializations/${specialization.index}/resources/${specialization.resources.size}`,
      namespace,
    ).href;
    const reserved = reserveProjectedResource(resource);
    specialization.resources.set(normalized, reserved);
    return reserved;
  };

  const specializedReference = (
    keyword: string,
    reference: string,
    baseUri: string,
    ignored: ProjectionIgnoredProperties,
    dynamicScope: readonly string[],
  ): string | null => {
    try {
      absoluteReference(reference, baseUri);
    } catch {
      return null;
    }
    const target = resolveIndexedReference(keyword, reference, baseUri, dynamicScope);
    if (!target) return null;
    let targetId = specializationTargetIds.get(target);
    if (targetId === undefined) {
      targetId = specializationTargetSequence;
      specializationTargetSequence += 1;
      specializationTargetIds.set(target, targetId);
    }
    const specializationKey = `${keyword}\u0000${targetId}\u0000${ignored.id}\u0000${dynamicScopeSignature(dynamicScope)}`;
    const existing = specializationReferences.get(specializationKey);
    if (existing) return existing;

    const index = specializationSequence;
    specializationSequence += 1;
    const definitionName = `directional${index}`;
    const resource = isRecord(target.schema)
      ? reserveProjectedResource(new URL(`specializations/${index}`, namespace).href)
      : undefined;
    const definitionReference = locationReference(projectedRetrieval, ['$defs', definitionName]);
    const specialization: ProjectionSpecialization = { index, resources: new Map() };
    specializationReferences.set(specializationKey, definitionReference);
    definitions[definitionName] = true;
    definitions[definitionName] = cloneSchemaWithBudget(
      target.schema,
      target.location,
      ignored,
      dynamicScopeWithResource(dynamicScope, indexedResource(target)),
      specialization,
      resource,
    );
    return definitionReference;
  };

  function cloneSchemaWithBudget(
    schema: JsonValue,
    location: Pick<SchemaLocation, 'originalResource' | 'originalPath' | 'projectedResource' | 'projectedPath'>,
    inheritedIgnored: ProjectionIgnoredProperties,
    dynamicScope: readonly string[],
    specialization?: ProjectionSpecialization,
    forcedProjectedResource?: string,
  ): JsonValue {
    reserveProjectedClone(
      schema,
      forcedProjectedResource !== undefined && isRecord(schema) && typeof schema.$id !== 'string' ? 1 : 0,
    );
    return cloneSchema(schema, location, inheritedIgnored, dynamicScope, specialization, forcedProjectedResource);
  }

  function cloneSchema(
    schema: JsonValue,
    location: Pick<SchemaLocation, 'originalResource' | 'originalPath' | 'projectedResource' | 'projectedPath'>,
    inheritedIgnored: ProjectionIgnoredProperties,
    dynamicScope: readonly string[],
    specialization?: ProjectionSpecialization,
    forcedProjectedResource?: string,
  ): JsonValue {
    if (!isRecord(schema)) return schema;

    let scopedLocation =
      forcedProjectedResource === undefined
        ? location
        : { ...location, projectedResource: forcedProjectedResource, projectedPath: [] };
    if (typeof schema.$id === 'string') {
      const originalResource = resolveResource(schema.$id, location.originalResource);
      const projectedResource =
        forcedProjectedResource ??
        (specialization ? specializationResource(specialization, originalResource) : mappedResource(originalResource));
      if (specialization && forcedProjectedResource) {
        specialization.resources.set(resourcePart(originalResource), forcedProjectedResource);
      }
      scopedLocation = {
        originalResource,
        originalPath: [],
        projectedResource,
        projectedPath: [],
      };
    }

    const localDynamicScope = dynamicScopeForSchema(dynamicScope, schema, location.originalResource);
    const ignored = extendIgnoredProperties(
      inheritedIgnored,
      analyzeDirectionalPropertyNames(schema, location.originalResource, dynamicScope).names,
    );
    const result = cloneRecord();
    if (forcedProjectedResource !== undefined && typeof schema.$id !== 'string') {
      result.$id = forcedProjectedResource;
    }

    for (const [key, child] of Object.entries(schema)) {
      // Candidate-source annotations are read from the unchanged document.
      // They do not constrain validation and may contain schema-shaped data.
      if (OMITTED_PROJECTION_ANNOTATIONS.has(key)) continue;
      if (key === '$id' && typeof child === 'string') {
        result[key] = scopedLocation.projectedResource;
        continue;
      }
      if (REFERENCE_KEYS.has(key) && typeof child === 'string') {
        result[key] =
          (ignored.names.size > 0
            ? specializedReference(key, child, scopedLocation.originalResource, ignored, localDynamicScope)
            : null) ?? rewriteReference(child, scopedLocation.originalResource);
        continue;
      }
      if (key === 'required' && Array.isArray(child)) {
        result[key] = child.filter((name) => typeof name !== 'string' || !ignored.names.has(name)) as JsonValue;
        continue;
      }
      if (key === 'dependentRequired' && isRecord(child)) {
        const dependencies = cloneRecord();
        for (const [name, names] of Object.entries(child)) {
          dependencies[name] = Array.isArray(names)
            ? (names.filter((candidate) => typeof candidate !== 'string' || !ignored.names.has(candidate)) as JsonValue)
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
            ? cloneSchema(
                nested,
                childLocation,
                SAME_INSTANCE_MAP_KEYS.has(key) ? ignored : emptyIgnoredProperties,
                localDynamicScope,
                specialization,
              )
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
            SAME_INSTANCE_ARRAY_KEYS.has(key) ? ignored : emptyIgnoredProperties,
            localDynamicScope,
            specialization,
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
                SAME_INSTANCE_VALUE_KEYS.has(key) ? ignored : emptyIgnoredProperties,
                localDynamicScope,
                specialization,
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
  }

  for (const root of roots) {
    const rootIgnoredNames =
      explicitlyIgnoredNames.get(referenceLookupKey(locationReference(originalRetrieval, root.path))) ??
      emptyDirectionalProperties;
    definitions[root.key] = cloneSchemaWithBudget(
      root.schema,
      {
        originalResource: originalDocumentResource,
        originalPath: root.path,
        projectedResource: projectedRetrieval,
        projectedPath: ['$defs', root.key],
      },
      extendIgnoredProperties(emptyIgnoredProperties, rootIgnoredNames),
      dynamicScopeForSchema([], root.schema, originalDocumentResource),
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
