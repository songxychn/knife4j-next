import type { SwaggerDoc } from '../../types/swagger';

type OpenApiRecord = Record<string, unknown>;

const PATH_ITEM_FIELDS = ['$ref', 'summary', 'description', 'servers', 'parameters'] as const;
const HTTP_METHOD_FIELDS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const SINGLE_SCHEMA_FIELDS = ['not', 'items', 'additionalProperties'] as const;
const ARRAY_SCHEMA_FIELDS = ['allOf', 'anyOf', 'oneOf'] as const;
const MAP_SCHEMA_FIELDS = ['properties'] as const;
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
  if (tokens.length < 3 || tokens[0] !== 'components' || !STANDARD_COMPONENT_SECTIONS.has(tokens[1])) return null;

  const section = tokens[1];
  const name = tokens[2];
  return section && name ? { section, name } : null;
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

function selectedPathItem(source: OpenApiRecord, method: string, operation: unknown): OpenApiRecord {
  const result: OpenApiRecord = {};

  PATH_ITEM_FIELDS.forEach((field) => {
    if (hasOwn(source, field)) result[field] = source[field];
  });
  Object.entries(source).forEach(([key, value]) => {
    if (key.startsWith('x-')) result[key] = value;
  });
  result[method] = operation;

  return result;
}

/**
 * Build an OAS 3.0.x document containing only one path and HTTP operation.
 * Reachable standard components and fragment-only JSON Pointer targets are
 * copied recursively. External references remain unchanged.
 */
export function buildOperationOpenApiDocument(
  swaggerDoc: SwaggerDoc,
  path: string,
  method: string,
): OpenApiRecord | null {
  const source = swaggerDoc as unknown as OpenApiRecord;
  if (typeof source.openapi !== 'string' || !source.openapi.startsWith('3.0.')) return null;
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
    value: unknown;
  }

  const selectedSourcePathItem = selectedPathItem(pathItem, normalizedMethod, operation);
  const sourceComponents = asRecord(source.components);
  const sourceSchemas = sourceComponents ? asRecord(sourceComponents.schemas) : null;
  const outputComponents = createOpenApiRecord();
  const outputLocalRefTargets = createOpenApiRecord();
  const pendingComponents: Array<{ section: string; name: string }> = [];
  const pendingLocalRefTargets: PendingLocalRefTarget[] = [];
  const pendingSecuritySchemes: string[] = [];
  const localRefTargetNames = new Map<string, string>();
  const visitedComponents = new Set<string>();
  const copiedObjects = new WeakMap<object, Map<CopyKind, unknown>>();
  const visitedSchemaObjects = new WeakSet<object>();
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

  const collectDiscriminatorMapping = (value: unknown): void => {
    if (typeof value !== 'string') return;

    const target = componentTarget(value);
    if (target?.section === 'schemas') {
      pendingComponents.push(target);
      return;
    }

    if (sourceSchemas && hasOwn(sourceSchemas, value)) {
      pendingComponents.push({ section: 'schemas', name: value });
    }
  };

  function collectSchemaDiscriminatorMappings(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(collectSchemaDiscriminatorMappings);
      return;
    }

    const schema = asRecord(value);
    if (!schema || visitedSchemaObjects.has(schema)) return;
    visitedSchemaObjects.add(schema);

    const discriminator = asRecord(schema.discriminator);
    const mapping = discriminator ? asRecord(discriminator.mapping) : null;
    if (mapping) Object.values(mapping).forEach(collectDiscriminatorMapping);

    SINGLE_SCHEMA_FIELDS.forEach((field) => collectSchemaDiscriminatorMappings(schema[field]));
    ARRAY_SCHEMA_FIELDS.forEach((field) => collectSchemaDiscriminatorMappings(schema[field]));
    MAP_SCHEMA_FIELDS.forEach((field) => {
      const schemas = asRecord(schema[field]);
      if (schemas) Object.values(schemas).forEach(collectSchemaDiscriminatorMappings);
    });
  }

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

  const rewriteLocalRef = (ref: string, kind: CopyKind): string => {
    const component = componentTarget(ref);
    if (component) {
      pendingComponents.push(component);
      return ref;
    }

    const pointer = localJsonPointer(ref);
    if (!pointer) return ref;
    const resolved = resolveJsonPointer(source, pointer.tokens);
    if (!resolved.found) return ref;

    const targetKey = `${kind}\u0000${pointer.key}`;
    let name = localRefTargetNames.get(targetKey);
    if (!name) {
      name = `target-${localRefTargetNames.size + 1}`;
      localRefTargetNames.set(targetKey, name);
      pendingLocalRefTargets.push({ kind, name, value: resolved.value });
    }
    return `#/${LOCAL_REF_TARGETS_FIELD}/${name}`;
  };

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
        if (key === 'schema') return 'schema';
        if (key === 'examples') return 'examples';
        if (key === 'encoding') return 'encodingMap';
        return 'opaque';
      case 'encoding':
        return key === 'headers' ? 'headers' : 'opaque';
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

  function copyReachableValue(value: unknown, kind: CopyKind): unknown {
    if (value === null || typeof value !== 'object') return value;
    const cachedByKind = copiedObjects.get(value);
    if (cachedByKind?.has(kind)) return cachedByKind.get(kind);

    if (Array.isArray(value)) {
      const result: unknown[] = [];
      const outputCache = cachedByKind ?? new Map<CopyKind, unknown>();
      outputCache.set(kind, result);
      copiedObjects.set(value, outputCache);
      const itemKind: CopyKind = kind === 'parameters' ? 'parameter' : kind;
      value.forEach((item) => result.push(copyReachableValue(item, itemKind)));
      return result;
    }

    const record = value as OpenApiRecord;
    const result = createOpenApiRecord();
    const outputCache = cachedByKind ?? new Map<CopyKind, unknown>();
    outputCache.set(kind, result);
    copiedObjects.set(value, outputCache);

    if (kind === 'opaque') {
      Object.entries(record).forEach(([key, nestedValue]) => {
        result[key] = copyReachableValue(nestedValue, 'opaque');
      });
      return result;
    }

    if (kind === 'schema') {
      collectSchemaDiscriminatorMappings(record);
      Object.entries(record).forEach(([key, nestedValue]) => {
        if (key === '$ref' && typeof nestedValue === 'string') {
          result[key] = rewriteLocalRef(nestedValue, 'schema');
        } else if ((SINGLE_SCHEMA_FIELDS as readonly string[]).includes(key)) {
          result[key] = copyReachableValue(nestedValue, 'schema');
        } else if ((ARRAY_SCHEMA_FIELDS as readonly string[]).includes(key)) {
          result[key] = copyReachableValue(nestedValue, 'schema');
        } else if ((MAP_SCHEMA_FIELDS as readonly string[]).includes(key)) {
          result[key] = copyReachableValue(nestedValue, 'schemaMap');
        } else {
          result[key] = copyReachableValue(nestedValue, 'opaque');
        }
      });
      return result;
    }

    const mappedKind = mapValueKind(kind);
    if (mappedKind) {
      Object.entries(record).forEach(([key, nestedValue]) => {
        const extensionValue = kind === 'responses' && key.startsWith('x-');
        result[key] = copyReachableValue(nestedValue, extensionValue ? 'opaque' : mappedKind);
      });
      return result;
    }

    if (kind === 'callback' && !hasOwn(record, '$ref')) {
      Object.entries(record).forEach(([key, nestedValue]) => {
        result[key] = copyReachableValue(nestedValue, key.startsWith('x-') ? 'opaque' : 'pathItem');
      });
      return result;
    }

    Object.entries(record).forEach(([key, nestedValue]) => {
      const targetKind = key === '$ref' ? referenceTargetKind(kind) : null;
      if (targetKind && typeof nestedValue === 'string') {
        result[key] = rewriteLocalRef(nestedValue, targetKind);
      } else {
        result[key] = copyReachableValue(nestedValue, key.startsWith('x-') ? 'opaque' : childKind(kind, key));
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
      if (target) {
        if (target.kind === 'operation') collectOperationSecurity(target.value, true);
        if (target.kind === 'pathItem') collectPathItemSecurity(target.value, true);
        if (target.kind === 'callback') collectCallbackSecurity(target.value);
        outputLocalRefTargets[target.name] = copyReachableValue(target.value, target.kind);
      }
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

export function supportsOperationOpenApiDownload(swaggerDoc: SwaggerDoc): boolean {
  return typeof swaggerDoc.openapi === 'string' && swaggerDoc.openapi.startsWith('3.0.');
}

/**
 * Preserve the pre-download preview behavior for newer OAS3 documents. The
 * portable download contract is intentionally limited to OAS 3.0.x; preview
 * and copy remain available for documents that require newer Schema dialects.
 */
export function buildOperationOpenApiPreviewDocument(
  swaggerDoc: SwaggerDoc,
  path: string,
  method: string,
): OpenApiRecord | null {
  if (supportsOperationOpenApiDownload(swaggerDoc)) {
    return buildOperationOpenApiDocument(swaggerDoc, path, method);
  }

  const source = swaggerDoc as unknown as OpenApiRecord;
  const paths = asRecord(source.paths);
  const pathItem = paths ? asRecord(paths[path]) : null;
  const operation = pathItem ? asRecord(pathItem[method.toLowerCase()]) : null;
  if (!operation || !asRecord(source.info)) return null;

  const referencedSchemas = createOpenApiRecord();
  const components = asRecord(source.components);
  const componentSchemas = components ? asRecord(components.schemas) : null;
  const definitions = asRecord(source.definitions);
  const allSchemas = componentSchemas ?? definitions ?? createOpenApiRecord();
  const seenSchemas = new Set<string>();

  const collectSchemaRefs = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collectSchemaRefs);
      return;
    }
    const record = asRecord(value);
    if (!record) return;

    if (typeof record.$ref === 'string') {
      const match = record.$ref.match(/^#\/components\/schemas\/(.+)$/) ?? record.$ref.match(/^#\/definitions\/(.+)$/);
      const name = match?.[1];
      if (name && !seenSchemas.has(name) && hasOwn(allSchemas, name)) {
        seenSchemas.add(name);
        referencedSchemas[name] = allSchemas[name];
        collectSchemaRefs(allSchemas[name]);
      }
    }
    Object.values(record).forEach(collectSchemaRefs);
  };

  collectSchemaRefs(operation);
  const outputPathItem = createOpenApiRecord();
  outputPathItem[method.toLowerCase()] = operation;
  const outputPaths = createOpenApiRecord();
  outputPaths[path] = outputPathItem;
  const output: OpenApiRecord = {
    openapi: source.openapi ?? '3.0.0',
    info: source.info,
    paths: outputPaths,
  };

  if (Object.keys(referencedSchemas).length > 0) {
    if (componentSchemas) output.components = { schemas: referencedSchemas };
    else output.definitions = referencedSchemas;
  }
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
