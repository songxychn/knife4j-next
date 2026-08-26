import type { SwaggerDoc } from '../../types/swagger';

type OpenApiRecord = Record<string, unknown>;

const PATH_ITEM_SUPPORT_FIELDS = ['summary', 'description', 'servers', 'parameters'] as const;
const HTTP_METHOD_FIELDS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'] as const;
const SINGLE_SCHEMA_FIELDS = [
  'not',
  'items',
  'additionalItems',
  'contains',
  'propertyNames',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'if',
  'then',
  'else',
  'contentSchema',
] as const;
const ARRAY_SCHEMA_FIELDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;
const MAP_SCHEMA_FIELDS = ['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions'] as const;
const STANDARD_COMPONENT_SECTIONS = new Set([
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'callbacks',
  'pathItems',
]);
// A specification extension keeps support objects addressable without exposing extra paths or operations.
const LOCAL_REF_TARGETS_FIELD = 'x-knife4j-local-ref-targets';
const ILLEGAL_FILENAME_CHARACTERS = new Set('/\\:*?"<>|');

interface LocalJsonPointer {
  key: string;
  tokens: string[];
}

function asRecord(value: unknown): OpenApiRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as OpenApiRecord) : null;
}

function hasOwn(record: OpenApiRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function createOpenApiRecord(): OpenApiRecord {
  return Object.create(null) as OpenApiRecord;
}

function decodeJsonPointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function encodeJsonPointerToken(token: string): string {
  return encodeURIComponent(token.replace(/~/g, '~0').replace(/\//g, '~1')).replace(/%24/g, '$');
}

function localJsonPointer(ref: string): LocalJsonPointer | null {
  if (!ref.startsWith('#')) return null;

  let pointer: string;
  try {
    pointer = decodeURIComponent(ref.slice(1));
  } catch {
    return null;
  }

  if (!pointer.startsWith('/')) return null;
  const tokens = pointer.slice(1).split('/').map(decodeJsonPointerToken);
  return { key: JSON.stringify(tokens), tokens };
}

function componentTarget(ref: string): { section: string; name: string } | null {
  const pointer = localJsonPointer(ref);
  if (!pointer) return null;

  const { tokens } = pointer;
  if (tokens.length < 3 || tokens[0] !== 'components') return null;

  const section = tokens[1];
  const name = tokens[2];
  return section && name && STANDARD_COMPONENT_SECTIONS.has(section) ? { section, name } : null;
}

function resolveJsonPointer(source: unknown, tokens: string[]): { found: boolean; value?: unknown } {
  let current = source;
  for (const token of tokens) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) {
      return { found: false };
    }
    current = (current as OpenApiRecord)[token];
  }
  return { found: true, value: current };
}

function selectedPathItem(
  document: OpenApiRecord,
  source: OpenApiRecord,
  method: string,
  operation: unknown,
): OpenApiRecord {
  const result = createOpenApiRecord();
  const visited = new WeakSet<object>();

  const collectSupport = (pathItem: OpenApiRecord): void => {
    if (visited.has(pathItem)) return;
    visited.add(pathItem);

    let materializedReference = false;
    if (typeof pathItem.$ref === 'string') {
      const pointer = localJsonPointer(pathItem.$ref);
      if (pointer) {
        const resolved = resolveJsonPointer(document, pointer.tokens);
        const referencedPathItem = resolved.found ? asRecord(resolved.value) : null;
        if (referencedPathItem) {
          collectSupport(referencedPathItem);
          materializedReference = true;
        }
      }
    }
    if (!materializedReference && hasOwn(pathItem, '$ref')) result.$ref = pathItem.$ref;

    PATH_ITEM_SUPPORT_FIELDS.forEach((field) => {
      if (hasOwn(pathItem, field)) result[field] = pathItem[field];
    });
    Object.entries(pathItem).forEach(([key, value]) => {
      if (key.startsWith('x-')) result[key] = value;
    });
  };

  collectSupport(source);
  result[method] = operation;

  return result;
}

/**
 * Build an OAS3 document containing only one path and HTTP operation.
 * Reachable OAS and JSON Schema references are copied recursively while
 * instance data stays opaque. Non-component local targets are relocated so
 * they remain addressable without exporting supporting operations as paths.
 */
export function buildOperationOpenApiDocument(
  swaggerDoc: SwaggerDoc,
  path: string,
  method: string,
  documentUri?: string,
): OpenApiRecord | null {
  const source = swaggerDoc as unknown as OpenApiRecord;
  if (typeof source.openapi !== 'string' || !source.openapi.startsWith('3.')) return null;
  if (!asRecord(source.info)) return null;

  const paths = asRecord(source.paths);
  const pathItem = paths ? asRecord(paths[path]) : null;
  const normalizedMethod = method.toLowerCase();
  const operation = pathItem ? asRecord(pathItem[normalizedMethod]) : null;
  if (!pathItem || !operation) return null;

  type CopyKind =
    | 'opaque'
    | 'schema'
    | 'schemaMap'
    | 'pathItem'
    | 'operation'
    | 'parameters'
    | 'parameter'
    | 'requestBody'
    | 'responses'
    | 'response'
    | 'headers'
    | 'header'
    | 'content'
    | 'mediaType'
    | 'examples'
    | 'example'
    | 'links'
    | 'link'
    | 'callbacks'
    | 'callback'
    | 'encodingMap'
    | 'encoding'
    | 'securityScheme';

  interface PendingLocalRefTarget {
    kind: CopyKind;
    name: string;
    schemaBase: string;
    value: unknown;
  }

  interface ComponentSchemaTarget {
    type: 'component';
    name: string;
    section: string;
  }

  interface RelocatedSchemaTarget {
    type: 'local';
    key: string;
    schemaBase: string;
    value: OpenApiRecord;
  }

  type SchemaReferenceTarget = ComponentSchemaTarget | RelocatedSchemaTarget;

  interface OperationIdTarget {
    key: string;
    value: OpenApiRecord;
  }

  const minorVersion = Number(source.openapi.split('.')[1]);
  const supportsJsonSchema202012 = Number.isFinite(minorVersion) && minorVersion >= 1;
  const fallbackDocumentSchemaBase = 'https://knife4j.invalid/openapi-document';
  let documentSchemaBase = fallbackDocumentSchemaBase;
  let hasConcreteDocumentSchemaBase = false;
  if (documentUri) {
    try {
      const retrievalUri = new URL(documentUri);
      retrievalUri.hash = '';
      documentSchemaBase = retrievalUri.href;
      hasConcreteDocumentSchemaBase = true;
    } catch {
      // Keep the stable fallback when the caller cannot provide an absolute retrieval URI.
    }
  }
  if (minorVersion >= 2 && typeof source.$self === 'string') {
    try {
      const selfUri = new URL(source.$self, documentSchemaBase);
      selfUri.hash = '';
      documentSchemaBase = selfUri.href;
      if (!hasConcreteDocumentSchemaBase) {
        try {
          new URL(source.$self);
          hasConcreteDocumentSchemaBase = true;
        } catch {
          // A relative $self still needs a concrete retrieval URI.
        }
      }
    } catch {
      // An invalid $self cannot establish a base; retain the retrieval URI or fallback.
    }
  }
  const DOCUMENT_SCHEMA_BASE = documentSchemaBase;
  const selectedSourcePathItem = selectedPathItem(source, pathItem, normalizedMethod, operation);
  const sourceComponents = asRecord(source.components);
  const sourceSchemas = sourceComponents ? asRecord(sourceComponents.schemas) : null;
  const outputComponents = createOpenApiRecord();
  const outputLocalRefTargets = createOpenApiRecord();
  const pendingComponents: Array<{ section: string; name: string }> = [];
  const pendingLocalRefTargets: PendingLocalRefTarget[] = [];
  const pendingSecuritySchemes: string[] = [];
  const localRefTargets = new Map<string, PendingLocalRefTarget>();
  const schemaAnchors = new Map<string, SchemaReferenceTarget | null>();
  const schemaResources = new Map<string, SchemaReferenceTarget | null>();
  const operationIds = new Map<string, OperationIdTarget | null>();
  const visitedComponents = new Set<string>();
  const copiedObjects = new WeakMap<object, Map<string, unknown>>();
  const indexedSchemaObjects = new WeakMap<object, Set<string>>();
  const indexedSemanticObjects = new WeakMap<object, Set<string>>();
  const indexedOperations = new WeakSet<object>();
  const indexedPathItems = new WeakSet<object>();
  const indexedCallbacks = new WeakSet<object>();
  const visitedSecurityObjects = new WeakSet<object>();
  const hasRootSecurity = hasOwn(source, 'security');
  let rootSecurityRequired = hasRootSecurity && !hasOwn(operation, 'security');
  let rootSecurityCollected = false;

  const collectSecurityRequirements = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    value.forEach((requirement) => {
      const requirementRecord = asRecord(requirement);
      if (requirementRecord) pendingSecuritySchemes.push(...Object.keys(requirementRecord));
    });
  };

  function collectOperationSecurity(value: unknown, mayInheritRootSecurity = false): void {
    const operationRecord = asRecord(value);
    if (!operationRecord || visitedSecurityObjects.has(operationRecord)) return;
    visitedSecurityObjects.add(operationRecord);
    if (mayInheritRootSecurity && hasRootSecurity && !hasOwn(operationRecord, 'security')) {
      rootSecurityRequired = true;
    }
    collectSecurityRequirements(operationRecord.security);

    const callbacks = asRecord(operationRecord.callbacks);
    if (!callbacks) return;
    Object.values(callbacks).forEach(collectCallbackSecurity);
  }

  function collectPathItemSecurity(value: unknown, mayInheritRootSecurity = false): void {
    const pathItemRecord = asRecord(value);
    if (!pathItemRecord || visitedSecurityObjects.has(pathItemRecord)) return;
    visitedSecurityObjects.add(pathItemRecord);
    HTTP_METHOD_FIELDS.forEach((field) => collectOperationSecurity(pathItemRecord[field], mayInheritRootSecurity));
  }

  function collectCallbackSecurity(value: unknown): void {
    const callbackRecord = asRecord(value);
    if (!callbackRecord || visitedSecurityObjects.has(callbackRecord)) return;
    visitedSecurityObjects.add(callbackRecord);
    Object.values(callbackRecord).forEach((pathItem) => collectPathItemSecurity(pathItem, true));
  }

  function schemaResourceBase(parentBase: string, record: OpenApiRecord): string | null {
    if (!supportsJsonSchema202012 || typeof record.$id !== 'string') return null;
    try {
      const resolved = new URL(record.$id, parentBase);
      resolved.hash = '';
      return resolved.href;
    } catch {
      return null;
    }
  }

  function resolveSchemaPointer(tokens: string[]): {
    resourceRoot?: {
      key: string;
      schemaBase: string;
      suffixTokens: string[];
      value: unknown;
    };
    value: unknown;
  } | null {
    const values: unknown[] = [source];
    let current: unknown = source;
    for (const token of tokens) {
      if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) {
        return null;
      }
      current = (current as OpenApiRecord)[token];
      values.push(current);
    }

    const schemaDepths = new Set<number>([tokens.length]);
    for (let depth = tokens.length; depth > 0; depth -= 1) {
      if (!schemaDepths.has(depth)) continue;

      const directField = tokens[depth - 1];
      if ((SINGLE_SCHEMA_FIELDS as readonly string[]).includes(directField)) {
        schemaDepths.add(depth - 1);
      }

      if (depth < 2) continue;
      const containerField = tokens[depth - 2];
      if (
        (ARRAY_SCHEMA_FIELDS as readonly string[]).includes(containerField) ||
        (MAP_SCHEMA_FIELDS as readonly string[]).includes(containerField) ||
        (containerField === 'dependencies' && !Array.isArray(values[depth]))
      ) {
        schemaDepths.add(depth - 2);
      }
    }

    let schemaBase = DOCUMENT_SCHEMA_BASE;
    let resourceRoot:
      | {
          key: string;
          schemaBase: string;
          suffixTokens: string[];
          value: unknown;
        }
      | undefined;

    values.forEach((value, depth) => {
      if (schemaDepths.has(depth)) {
        const schema = asRecord(value);
        if (!schema) return;
        const resourceBase = schemaResourceBase(schemaBase, schema);
        if (resourceBase) {
          if (!resourceRoot) {
            const resourceTokens = tokens.slice(0, depth);
            resourceRoot = {
              key: JSON.stringify(resourceTokens),
              schemaBase,
              suffixTokens: tokens.slice(depth),
              value,
            };
          }
          schemaBase = resourceBase;
        }
      }
    });
    return { resourceRoot, value: current };
  }

  function schemaReferenceTarget(ref: string, schemaBase: string): SchemaReferenceTarget | null {
    try {
      const resolved = new URL(ref, schemaBase);
      const fragment = decodeURIComponent(resolved.hash.slice(1));
      resolved.hash = '';
      if (!fragment || fragment.startsWith('/')) return schemaResources.get(resolved.href) ?? null;
      return schemaAnchors.get(`${resolved.href}#${fragment}`) ?? null;
    } catch {
      return null;
    }
  }

  function registerSchemaTarget(
    index: Map<string, SchemaReferenceTarget | null>,
    key: string,
    target: SchemaReferenceTarget,
  ): void {
    if (index.has(key)) {
      index.set(key, null);
    } else {
      index.set(key, target);
    }
  }

  function indexSchemaTargets(value: unknown, target: SchemaReferenceTarget, parentBase: string): void {
    if (Array.isArray(value)) {
      value.forEach((item) => indexSchemaTargets(item, target, parentBase));
      return;
    }

    const schema = asRecord(value);
    if (!schema) return;
    const resourceBase = schemaResourceBase(parentBase, schema);
    const base = resourceBase ?? parentBase;
    const visitedBases = indexedSchemaObjects.get(schema) ?? new Set<string>();
    if (visitedBases.has(base)) return;
    visitedBases.add(base);
    indexedSchemaObjects.set(schema, visitedBases);

    if (resourceBase) registerSchemaTarget(schemaResources, resourceBase, target);
    if (typeof schema.$anchor === 'string') registerSchemaTarget(schemaAnchors, `${base}#${schema.$anchor}`, target);
    if (typeof schema.$dynamicAnchor === 'string') {
      registerSchemaTarget(schemaAnchors, `${base}#${schema.$dynamicAnchor}`, target);
    }

    SINGLE_SCHEMA_FIELDS.forEach((field) => indexSchemaTargets(schema[field], target, base));
    ARRAY_SCHEMA_FIELDS.forEach((field) => indexSchemaTargets(schema[field], target, base));
    MAP_SCHEMA_FIELDS.forEach((field) => {
      const schemas = asRecord(schema[field]);
      if (schemas) Object.values(schemas).forEach((nestedSchema) => indexSchemaTargets(nestedSchema, target, base));
    });
    const dependencies = asRecord(schema.dependencies);
    if (dependencies) {
      Object.values(dependencies).forEach((dependency) => {
        if (!Array.isArray(dependency)) indexSchemaTargets(dependency, target, base);
      });
    }
  }

  if (supportsJsonSchema202012 && sourceSchemas) {
    Object.entries(sourceSchemas).forEach(([name, schema]) => {
      indexSchemaTargets(schema, { type: 'component', section: 'schemas', name }, DOCUMENT_SCHEMA_BASE);
    });
  }

  function indexSemanticSchemaTargets(
    value: unknown,
    kind: CopyKind,
    tokens: string[],
    enclosingTarget?: ComponentSchemaTarget,
  ): void {
    if (kind === 'opaque' || value === null || typeof value !== 'object') return;

    if (kind === 'schema') {
      const schema = asRecord(value);
      if (!schema) return;
      const target: SchemaReferenceTarget = enclosingTarget ?? {
        type: 'local',
        key: JSON.stringify(tokens),
        schemaBase: DOCUMENT_SCHEMA_BASE,
        value: schema,
      };
      indexSchemaTargets(schema, target, DOCUMENT_SCHEMA_BASE);
      return;
    }

    if (Array.isArray(value)) {
      const itemKind: CopyKind = kind === 'parameters' ? 'parameter' : kind;
      value.forEach((item, index) =>
        indexSemanticSchemaTargets(item, itemKind, [...tokens, String(index)], enclosingTarget),
      );
      return;
    }

    const record = value as OpenApiRecord;
    const targetKey = enclosingTarget
      ? `component:${enclosingTarget.section}:${enclosingTarget.name}`
      : JSON.stringify(tokens);
    const visitKey = `${kind}:${targetKey}`;
    const visitedKinds = indexedSemanticObjects.get(record) ?? new Set<string>();
    if (visitedKinds.has(visitKey)) return;
    visitedKinds.add(visitKey);
    indexedSemanticObjects.set(record, visitedKinds);

    indexSemanticLocalReference(record, kind);
    const mappedKind = mapValueKind(kind);
    if (mappedKind) {
      Object.entries(record).forEach(([key, nestedValue]) => {
        indexSemanticSchemaTargets(
          nestedValue,
          kind === 'responses' && key.startsWith('x-') ? 'opaque' : mappedKind,
          [...tokens, key],
          enclosingTarget,
        );
      });
      return;
    }

    if (kind === 'callback' && !hasOwn(record, '$ref')) {
      Object.entries(record).forEach(([key, nestedValue]) => {
        indexSemanticSchemaTargets(
          nestedValue,
          key.startsWith('x-') ? 'opaque' : 'pathItem',
          [...tokens, key],
          enclosingTarget,
        );
      });
      return;
    }

    Object.entries(record).forEach(([key, nestedValue]) => {
      if (key === '$ref') return;
      indexSemanticSchemaTargets(
        nestedValue,
        key.startsWith('x-') ? 'opaque' : childKind(kind, key),
        [...tokens, key],
        enclosingTarget,
      );
    });
  }

  function indexSemanticLocalReference(record: OpenApiRecord, kind: CopyKind): void {
    const targetKind = referenceTargetKind(kind);
    if (!targetKind || typeof record.$ref !== 'string') return;

    const pointer = localJsonPointer(record.$ref);
    if (!pointer) return;
    const resolved = resolveJsonPointer(source, pointer.tokens);
    if (!resolved.found) return;

    const [root, section, name] = pointer.tokens;
    const componentTargetForPointer: ComponentSchemaTarget | undefined =
      pointer.tokens.length === 3 &&
      root === 'components' &&
      section &&
      STANDARD_COMPONENT_SECTIONS.has(section) &&
      name
        ? { type: 'component', section, name }
        : undefined;
    indexSemanticSchemaTargets(resolved.value, targetKind, pointer.tokens, componentTargetForPointer);
  }

  if (supportsJsonSchema202012) {
    const schemaBearingComponentKinds: Array<[string, CopyKind]> = [
      ['parameters', 'parameter'],
      ['responses', 'response'],
      ['requestBodies', 'requestBody'],
      ['headers', 'header'],
      ['callbacks', 'callback'],
      ['pathItems', 'pathItem'],
    ];
    schemaBearingComponentKinds.forEach(([section, kind]) => {
      const components = sourceComponents ? asRecord(sourceComponents[section]) : null;
      if (!components) return;
      Object.entries(components).forEach(([name, value]) => {
        indexSemanticSchemaTargets(value, kind, ['components', section, name], { type: 'component', section, name });
      });
    });

    if (paths) {
      Object.entries(paths).forEach(([sourcePath, sourcePathItem]) => {
        if (sourcePath.startsWith('x-')) return;
        if (sourcePath !== path) {
          indexSemanticSchemaTargets(sourcePathItem, 'pathItem', ['paths', sourcePath]);
          return;
        }
        const sourcePathItemRecord = asRecord(sourcePathItem);
        if (!sourcePathItemRecord) return;
        indexSemanticLocalReference(sourcePathItemRecord, 'pathItem');
        HTTP_METHOD_FIELDS.forEach((sourceMethod) => {
          if (sourceMethod !== normalizedMethod && hasOwn(sourcePathItemRecord, sourceMethod)) {
            indexSemanticSchemaTargets(sourcePathItemRecord[sourceMethod], 'operation', [
              'paths',
              sourcePath,
              sourceMethod,
            ]);
          }
        });
      });
    }
    const sourceWebhooks = asRecord(source.webhooks);
    if (sourceWebhooks) {
      Object.entries(sourceWebhooks).forEach(([name, sourcePathItem]) => {
        indexSemanticSchemaTargets(sourcePathItem, 'pathItem', ['webhooks', name]);
      });
    }
  }

  function indexOperation(value: unknown): void {
    const operationRecord = asRecord(value);
    if (!operationRecord || indexedOperations.has(operationRecord)) return;
    indexedOperations.add(operationRecord);

    if (typeof operationRecord.operationId === 'string') {
      const operationId = operationRecord.operationId;
      if (operationIds.has(operationId)) {
        operationIds.set(operationId, null);
      } else {
        operationIds.set(operationId, {
          key: `operationId:${operationId}`,
          value: operationRecord,
        });
      }
    }

    const callbacks = asRecord(operationRecord.callbacks);
    if (callbacks) Object.values(callbacks).forEach(indexCallback);
  }

  function indexPathItem(value: unknown): void {
    const pathItemRecord = asRecord(value);
    if (!pathItemRecord || indexedPathItems.has(pathItemRecord)) return;
    indexedPathItems.add(pathItemRecord);

    if (typeof pathItemRecord.$ref === 'string') {
      const pointer = localJsonPointer(pathItemRecord.$ref);
      if (pointer) {
        const resolved = resolveJsonPointer(source, pointer.tokens);
        if (resolved.found) indexPathItem(resolved.value);
      }
    }
    HTTP_METHOD_FIELDS.forEach((field) => indexOperation(pathItemRecord[field]));
  }

  function indexCallback(value: unknown): void {
    const callbackRecord = asRecord(value);
    if (!callbackRecord || indexedCallbacks.has(callbackRecord)) return;
    indexedCallbacks.add(callbackRecord);
    if (typeof callbackRecord.$ref === 'string') {
      const pointer = localJsonPointer(callbackRecord.$ref);
      if (pointer) {
        const resolved = resolveJsonPointer(source, pointer.tokens);
        if (resolved.found) indexCallback(resolved.value);
      }
      return;
    }
    Object.entries(callbackRecord).forEach(([key, pathItemValue]) => {
      if (!key.startsWith('x-')) indexPathItem(pathItemValue);
    });
  }

  if (paths) {
    Object.entries(paths).forEach(([sourcePath, sourcePathItem]) => {
      if (!sourcePath.startsWith('x-')) indexPathItem(sourcePathItem);
    });
  }
  const webhooks = asRecord(source.webhooks);
  if (webhooks) Object.values(webhooks).forEach(indexPathItem);
  const reusableCallbacks = sourceComponents ? asRecord(sourceComponents.callbacks) : null;
  if (reusableCallbacks) Object.values(reusableCallbacks).forEach(indexCallback);
  const reusablePathItems = sourceComponents ? asRecord(sourceComponents.pathItems) : null;
  if (reusablePathItems) Object.values(reusablePathItems).forEach(indexPathItem);

  function relocateLocalTarget(
    key: string,
    value: unknown,
    kind: CopyKind,
    schemaBase: string,
    suffixTokens: string[] = [],
  ): string {
    const relocationKey = `${kind}\u0000${key}`;
    let target = localRefTargets.get(relocationKey);
    if (!target) {
      target = {
        kind,
        name: `target-${localRefTargets.size + 1}`,
        schemaBase,
        value,
      };
      localRefTargets.set(relocationKey, target);
      pendingLocalRefTargets.push(target);
    }
    const suffix = suffixTokens.map((token) => `/${encodeJsonPointerToken(token)}`).join('');
    return `#/${LOCAL_REF_TARGETS_FIELD}/${target.name}${suffix}`;
  }

  function rewriteLocalReference(ref: string, kind: CopyKind, schemaBase = DOCUMENT_SCHEMA_BASE): string {
    if (kind === 'schema' && schemaBase !== DOCUMENT_SCHEMA_BASE) return ref;

    const component = componentTarget(ref);
    if (component) {
      pendingComponents.push(component);
      return ref;
    }

    const pointer = localJsonPointer(ref);
    if (!pointer) return ref;
    if (
      kind === 'operation' &&
      pointer.tokens.length === 3 &&
      pointer.tokens[0] === 'paths' &&
      pointer.tokens[1] === path &&
      pointer.tokens[2].toLowerCase() === normalizedMethod
    ) {
      return ref;
    }

    if (kind === 'schema') {
      const resolved = resolveSchemaPointer(pointer.tokens);
      if (!resolved) return ref;
      if (resolved.resourceRoot) {
        const { key, schemaBase: resourceParentBase, suffixTokens, value } = resolved.resourceRoot;
        return relocateLocalTarget(key, value, kind, resourceParentBase, suffixTokens);
      }
      return relocateLocalTarget(pointer.key, resolved.value, kind, DOCUMENT_SCHEMA_BASE);
    }

    const resolved = resolveJsonPointer(source, pointer.tokens);
    if (!resolved.found) return ref;
    return relocateLocalTarget(pointer.key, resolved.value, kind, DOCUMENT_SCHEMA_BASE);
  }

  function rewriteSchemaReference(ref: string, schemaBase: string): string {
    const pointer = localJsonPointer(ref);
    if (pointer) return rewriteLocalReference(ref, 'schema', schemaBase);

    const target = schemaReferenceTarget(ref, schemaBase);
    if (target?.type === 'component') pendingComponents.push(target);
    if (target?.type === 'local') {
      relocateLocalTarget(target.key, target.value, 'schema', target.schemaBase);
    }
    return ref;
  }

  function rewriteLinkOperationId(operationId: string): string | null {
    const target = operationIds.get(operationId);
    if (!target || target.value === operation) return null;
    return relocateLocalTarget(target.key, target.value, 'operation', DOCUMENT_SCHEMA_BASE);
  }

  function rewriteDiscriminatorMapping(value: string): string {
    if (sourceSchemas && hasOwn(sourceSchemas, value)) {
      pendingComponents.push({ section: 'schemas', name: value });
      return value;
    }
    return rewriteSchemaReference(value, DOCUMENT_SCHEMA_BASE);
  }

  function copyDiscriminator(value: unknown, schemaBase: string): unknown {
    const discriminator = asRecord(value);
    if (!discriminator) return copyReachableValue(value, 'opaque', schemaBase);
    const result = createOpenApiRecord();
    Object.entries(discriminator).forEach(([key, nestedValue]) => {
      if (key !== 'mapping') {
        result[key] = copyReachableValue(nestedValue, 'opaque', schemaBase);
        return;
      }
      const mapping = asRecord(nestedValue);
      if (!mapping) {
        result[key] = copyReachableValue(nestedValue, 'opaque', schemaBase);
        return;
      }
      const outputMapping = createOpenApiRecord();
      Object.entries(mapping).forEach(([mappingKey, mappingValue]) => {
        outputMapping[mappingKey] =
          typeof mappingValue === 'string' ? rewriteDiscriminatorMapping(mappingValue) : mappingValue;
      });
      result[key] = outputMapping;
    });
    return result;
  }

  function referenceTargetKind(kind: CopyKind): CopyKind | null {
    switch (kind) {
      case 'pathItem':
      case 'parameter':
      case 'requestBody':
      case 'response':
      case 'header':
      case 'example':
      case 'link':
      case 'callback':
      case 'securityScheme':
        return kind;
      default:
        return null;
    }
  }

  function childKind(kind: CopyKind, key: string): CopyKind {
    switch (kind) {
      case 'pathItem':
        if ((HTTP_METHOD_FIELDS as readonly string[]).includes(key)) return 'operation';
        if (key === 'parameters') return 'parameters';
        return 'opaque';
      case 'operation':
        if (key === 'parameters') return 'parameters';
        if (key === 'requestBody') return 'requestBody';
        if (key === 'responses') return 'responses';
        if (key === 'callbacks') return 'callbacks';
        return 'opaque';
      case 'parameter':
      case 'header':
        if (key === 'schema') return 'schema';
        if (key === 'content') return 'content';
        if (key === 'examples') return 'examples';
        return 'opaque';
      case 'requestBody':
        return key === 'content' ? 'content' : 'opaque';
      case 'response':
        if (key === 'headers') return 'headers';
        if (key === 'content') return 'content';
        if (key === 'links') return 'links';
        return 'opaque';
      case 'mediaType':
        if (key === 'schema' || (minorVersion >= 2 && key === 'itemSchema')) return 'schema';
        if (key === 'examples') return 'examples';
        if (key === 'encoding') return 'encodingMap';
        return 'opaque';
      case 'encoding':
        return key === 'headers' ? 'headers' : 'opaque';
      case 'example':
        return 'opaque';
      case 'link':
        return 'opaque';
      default:
        return 'opaque';
    }
  }

  function mapValueKind(kind: CopyKind): CopyKind | null {
    switch (kind) {
      case 'schemaMap':
        return 'schema';
      case 'responses':
        return 'response';
      case 'headers':
        return 'header';
      case 'content':
        return 'mediaType';
      case 'examples':
        return 'example';
      case 'links':
        return 'link';
      case 'callbacks':
        return 'callback';
      case 'encodingMap':
        return 'encoding';
      default:
        return null;
    }
  }

  function copyReachableValue(value: unknown, kind: CopyKind, schemaBase = DOCUMENT_SCHEMA_BASE): unknown {
    if (value === null || typeof value !== 'object') return value;
    const cacheKey = kind === 'schema' || kind === 'schemaMap' ? `${kind}:${schemaBase}` : kind;
    const cachedByKind = copiedObjects.get(value);
    if (cachedByKind?.has(cacheKey)) return cachedByKind.get(cacheKey);

    if (Array.isArray(value)) {
      const result: unknown[] = [];
      const outputCache = cachedByKind ?? new Map<string, unknown>();
      outputCache.set(cacheKey, result);
      copiedObjects.set(value, outputCache);
      const itemKind: CopyKind = kind === 'parameters' ? 'parameter' : kind;
      value.forEach((item) => result.push(copyReachableValue(item, itemKind, schemaBase)));
      return result;
    }

    const record = value as OpenApiRecord;
    const result = createOpenApiRecord();
    const outputCache = cachedByKind ?? new Map<string, unknown>();
    outputCache.set(cacheKey, result);
    copiedObjects.set(value, outputCache);

    if (kind === 'opaque') {
      Object.entries(record).forEach(([key, nestedValue]) => {
        result[key] = copyReachableValue(nestedValue, 'opaque', schemaBase);
      });
      return result;
    }

    if (kind === 'schema') {
      const resourceBase = schemaResourceBase(schemaBase, record);
      const base = resourceBase ?? schemaBase;
      Object.entries(record).forEach(([key, nestedValue]) => {
        if (key === '$id' && resourceBase && hasConcreteDocumentSchemaBase) {
          result[key] = resourceBase;
        } else if (key === '$ref' && typeof nestedValue === 'string') {
          result[key] = rewriteSchemaReference(nestedValue, base);
        } else if (key === '$dynamicRef' && supportsJsonSchema202012 && typeof nestedValue === 'string') {
          result[key] = rewriteSchemaReference(nestedValue, base);
        } else if (key === 'discriminator') {
          result[key] = copyDiscriminator(nestedValue, base);
        } else if ((SINGLE_SCHEMA_FIELDS as readonly string[]).includes(key)) {
          result[key] = copyReachableValue(nestedValue, 'schema', base);
        } else if ((ARRAY_SCHEMA_FIELDS as readonly string[]).includes(key)) {
          result[key] = copyReachableValue(nestedValue, 'schema', base);
        } else if ((MAP_SCHEMA_FIELDS as readonly string[]).includes(key)) {
          result[key] = copyReachableValue(nestedValue, 'schemaMap', base);
        } else if (key === 'dependencies') {
          const dependencies = asRecord(nestedValue);
          if (!dependencies) {
            result[key] = copyReachableValue(nestedValue, 'opaque', base);
          } else {
            const outputDependencies = createOpenApiRecord();
            Object.entries(dependencies).forEach(([dependencyName, dependency]) => {
              outputDependencies[dependencyName] = copyReachableValue(
                dependency,
                Array.isArray(dependency) ? 'opaque' : 'schema',
                base,
              );
            });
            result[key] = outputDependencies;
          }
        } else {
          result[key] = copyReachableValue(nestedValue, 'opaque', base);
        }
      });
      return result;
    }

    const mappedKind = mapValueKind(kind);
    if (mappedKind) {
      Object.entries(record).forEach(([key, nestedValue]) => {
        const extensionValue = kind === 'responses' && key.startsWith('x-');
        result[key] = copyReachableValue(nestedValue, extensionValue ? 'opaque' : mappedKind, schemaBase);
      });
      return result;
    }

    if (kind === 'callback' && !hasOwn(record, '$ref')) {
      Object.entries(record).forEach(([key, nestedValue]) => {
        result[key] = copyReachableValue(nestedValue, key.startsWith('x-') ? 'opaque' : 'pathItem', schemaBase);
      });
      return result;
    }

    Object.entries(record).forEach(([key, nestedValue]) => {
      const targetKind = key === '$ref' ? referenceTargetKind(kind) : null;
      if (targetKind && typeof nestedValue === 'string') {
        result[key] = rewriteLocalReference(nestedValue, targetKind, schemaBase);
      } else if (kind === 'link' && key === 'operationRef' && typeof nestedValue === 'string') {
        result[key] = rewriteLocalReference(nestedValue, 'operation', schemaBase);
      } else if (
        kind === 'link' &&
        key === 'operationId' &&
        typeof nestedValue === 'string' &&
        !hasOwn(record, 'operationRef')
      ) {
        const operationRef = rewriteLinkOperationId(nestedValue);
        if (operationRef) result.operationRef = operationRef;
        else result[key] = nestedValue;
      } else {
        result[key] = copyReachableValue(
          nestedValue,
          key.startsWith('x-') ? 'opaque' : childKind(kind, key),
          schemaBase,
        );
      }
    });
    return result;
  }

  const outputPathItem = copyReachableValue(selectedSourcePathItem, 'pathItem') as OpenApiRecord;
  const outputPaths = createOpenApiRecord();
  outputPaths[path] = outputPathItem;
  const output: OpenApiRecord = {
    openapi: source.openapi,
    info: copyReachableValue(source.info, 'opaque'),
    paths: outputPaths,
  };

  if (hasOwn(source, 'servers')) output.servers = copyReachableValue(source.servers, 'opaque');
  if (hasOwn(source, 'jsonSchemaDialect')) output.jsonSchemaDialect = source.jsonSchemaDialect;

  const componentKind = (section: string): CopyKind => {
    switch (section) {
      case 'schemas':
        return 'schema';
      case 'parameters':
        return 'parameter';
      case 'responses':
        return 'response';
      case 'requestBodies':
        return 'requestBody';
      case 'headers':
        return 'header';
      case 'examples':
        return 'example';
      case 'links':
        return 'link';
      case 'callbacks':
        return 'callback';
      case 'pathItems':
        return 'pathItem';
      case 'securitySchemes':
        return 'securityScheme';
      default:
        return 'opaque';
    }
  };

  const copyComponent = (section: string, name: string): void => {
    const visitKey = `${section}\u0000${name}`;
    if (visitedComponents.has(visitKey)) return;
    visitedComponents.add(visitKey);

    const sourceSection = sourceComponents ? asRecord(sourceComponents[section]) : null;
    if (!sourceSection || !hasOwn(sourceSection, name)) return;

    const outputSection = asRecord(outputComponents[section]) ?? createOpenApiRecord();
    outputSection[name] = copyReachableValue(sourceSection[name], componentKind(section));
    outputComponents[section] = outputSection;
    if (section === 'callbacks') collectCallbackSecurity(sourceSection[name]);
    if (section === 'pathItems') collectPathItemSecurity(sourceSection[name], true);
  };

  collectPathItemSecurity(outputPathItem);

  while (
    pendingComponents.length > 0 ||
    pendingLocalRefTargets.length > 0 ||
    pendingSecuritySchemes.length > 0 ||
    (rootSecurityRequired && !rootSecurityCollected)
  ) {
    if (rootSecurityRequired && !rootSecurityCollected) {
      output.security = copyReachableValue(source.security, 'opaque');
      collectSecurityRequirements(source.security);
      rootSecurityCollected = true;
    }
    while (pendingLocalRefTargets.length > 0) {
      const target = pendingLocalRefTargets.shift();
      if (!target) continue;
      outputLocalRefTargets[target.name] = copyReachableValue(target.value, target.kind, target.schemaBase);
      if (target.kind === 'callback') collectCallbackSecurity(target.value);
      if (target.kind === 'pathItem') collectPathItemSecurity(target.value, true);
      if (target.kind === 'operation') collectOperationSecurity(target.value, true);
    }
    while (pendingComponents.length > 0) {
      const target = pendingComponents.shift();
      if (target) copyComponent(target.section, target.name);
    }
    while (pendingSecuritySchemes.length > 0) {
      const name = pendingSecuritySchemes.shift();
      if (name) copyComponent('securitySchemes', name);
    }
  }

  if (Object.keys(outputComponents).length > 0) output.components = outputComponents;
  if (Object.keys(outputLocalRefTargets).length > 0) output[LOCAL_REF_TARGETS_FIELD] = outputLocalRefTargets;
  return output;
}

export function serializeOperationOpenApiDocument(document: OpenApiRecord): string {
  const serialized = JSON.stringify(document, null, 2);
  if (serialized === undefined) throw new TypeError('Unable to serialize the operation OpenAPI document');
  return serialized;
}

export function buildOperationOpenApiFilename(method: string, path: string, operationId?: string): string {
  const identity = operationId?.trim() || path.trim() || 'operation';
  let safeCharacters = '';
  let previousCharacterWasIllegal = false;
  Array.from(`${method.toUpperCase()}-${identity}`).forEach((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const illegal = codePoint <= 0x1f || codePoint === 0x7f || ILLEGAL_FILENAME_CHARACTERS.has(character);
    if (illegal) {
      if (!previousCharacterWasIllegal) safeCharacters += '_';
    } else {
      safeCharacters += character;
    }
    previousCharacterWasIllegal = illegal;
  });
  const stem = safeCharacters.replace(/\s+/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  return `${stem || 'operation'}.openapi.json`;
}

/**
 * Start a browser download. Returns false when the required browser APIs are
 * unavailable; runtime failures are left to the caller to report.
 */
export function downloadOperationOpenApiJson(content: string, filename: string): boolean {
  if (
    typeof Blob === 'undefined' ||
    typeof document === 'undefined' ||
    !document.body ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function' ||
    typeof globalThis.setTimeout !== 'function'
  ) {
    return false;
  }

  const anchor = document.createElement('a');
  if (!('download' in anchor) || typeof anchor.click !== 'function') return false;

  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const revokeObjectURL = URL.revokeObjectURL.bind(URL);

  try {
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    return true;
  } finally {
    try {
      anchor.remove();
    } finally {
      globalThis.setTimeout(() => revokeObjectURL(objectUrl), 100);
    }
  }
}
