export const OPENAPI_HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace'] as const;

export type OpenApiHttpMethod = (typeof OPENAPI_HTTP_METHODS)[number];

export interface ParsedOpenApiVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface LocalJsonPointerResult {
  found: boolean;
  value?: unknown;
  tokens?: string[];
  reason?: 'not-local' | 'invalid-uri-encoding' | 'invalid-json-pointer' | 'missing-target';
}

export interface ParsedLocalJsonPointer {
  valid: boolean;
  tokens?: string[];
  reason?: 'not-local' | 'invalid-uri-encoding' | 'invalid-json-pointer';
}

export type PathItemResolution =
  | { status: 'resolved'; value: Record<string, unknown> }
  | { status: 'invalid'; reason: string }
  | { status: 'external'; ref: string }
  | { status: 'missing'; ref: string }
  | { status: 'cycle'; ref: string }
  | { status: 'depth'; ref: string }
  | { status: 'conflict'; ref: string; conflicts: string[] };

export type ResolvedOperationObject = Record<string, unknown> & {
  summary?: string;
  description?: string;
  parameters?: Record<string, unknown>[];
};

export interface ResolvedPathItemOperation {
  pathItem: Record<string, unknown>;
  operation: ResolvedOperationObject;
}

export type ReferenceObjectTargetKind =
  'response' | 'parameter' | 'example' | 'requestBody' | 'header' | 'securityScheme' | 'link' | 'callback';

export type LocalReferenceTargetKind = ReferenceObjectTargetKind | 'schema' | 'pathItem';

const OPENAPI_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(\d+)(?:-(.+))?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function owns(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

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

export function escapeJsonPointerSegment(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function decodeJsonPointerToken(value: string): string | null {
  if (/~(?:[^01]|$)/.test(value)) return null;
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function parseLocalJsonPointer(ref: string): ParsedLocalJsonPointer {
  if (!ref.startsWith('#')) return { valid: false, reason: 'not-local' };

  let pointer: string;
  try {
    pointer = decodeURIComponent(ref.slice(1));
  } catch {
    return { valid: false, reason: 'invalid-uri-encoding' };
  }
  if (pointer === '') return { valid: true, tokens: [] };
  if (!pointer.startsWith('/')) return { valid: false, reason: 'not-local' };

  const tokens: string[] = [];
  for (const encodedToken of pointer.slice(1).split('/')) {
    const token = decodeJsonPointerToken(encodedToken);
    if (token === null) return { valid: false, reason: 'invalid-json-pointer' };
    tokens.push(token);
  }

  return { valid: true, tokens };
}

export function resolveJsonPointerTokens(document: unknown, tokens: readonly string[]): LocalJsonPointerResult {
  let current = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token)) {
        return { found: false, tokens: [...tokens], reason: 'missing-target' };
      }
      const index = Number(token);
      if (!Number.isSafeInteger(index) || !Object.prototype.hasOwnProperty.call(current, index)) {
        return { found: false, tokens: [...tokens], reason: 'missing-target' };
      }
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, token)) {
      return { found: false, tokens: [...tokens], reason: 'missing-target' };
    }
    current = current[token];
  }
  return { found: true, value: current, tokens: [...tokens] };
}

/**
 * Resolve a same-document URI fragment as an RFC 6901 JSON Pointer.
 * Only own properties are followed so prototype values cannot become targets.
 */
export function resolveLocalJsonPointer(document: unknown, ref: string): LocalJsonPointerResult {
  const parsed = parseLocalJsonPointer(ref);
  if (!parsed.valid || !parsed.tokens) return { found: false, reason: parsed.reason };
  return resolveJsonPointerTokens(document, parsed.tokens);
}

type ReferenceAnnotationField = 'summary' | 'description';
const ALL_REFERENCE_ANNOTATIONS: ReadonlySet<ReferenceAnnotationField> = new Set<ReferenceAnnotationField>([
  'summary',
  'description',
]);
const DESCRIPTION_REFERENCE_ANNOTATION: ReadonlySet<ReferenceAnnotationField> = new Set<ReferenceAnnotationField>([
  'description',
]);
const NO_REFERENCE_ANNOTATIONS: ReadonlySet<ReferenceAnnotationField> = new Set<ReferenceAnnotationField>();

const REFERENCE_SECTION_KINDS: Readonly<Record<string, LocalReferenceTargetKind>> = {
  schemas: 'schema',
  responses: 'response',
  parameters: 'parameter',
  examples: 'example',
  requestBodies: 'requestBody',
  headers: 'header',
  securitySchemes: 'securityScheme',
  links: 'link',
  callbacks: 'callback',
  pathItems: 'pathItem',
};

/** Infer a target kind only when the pointer names a reusable component itself. */
export function inferDirectComponentReferenceTargetKind(ref: string): LocalReferenceTargetKind | undefined {
  const parsed = parseLocalJsonPointer(ref);
  if (!parsed.valid || parsed.tokens?.length !== 3 || parsed.tokens[0] !== 'components') return undefined;
  return REFERENCE_SECTION_KINDS[parsed.tokens[1]];
}

export function inferReferenceObjectTargetKind(ref: string): LocalReferenceTargetKind | undefined {
  const parsed = parseLocalJsonPointer(ref);
  if (!parsed.valid || !parsed.tokens) return undefined;

  const componentSection = parsed.tokens[0] === 'components' ? parsed.tokens[1] : undefined;
  const componentKind = componentSection ? REFERENCE_SECTION_KINDS[componentSection] : undefined;
  // Schema payloads and the literal-bearing reusable objects below are opaque
  // to structural token inference. A property named `responses` inside an
  // Example value or Link parameter map must not be mistaken for an OAS
  // Response Object.
  if (
    componentKind === 'schema' ||
    componentKind === 'example' ||
    componentKind === 'securityScheme' ||
    componentKind === 'link'
  ) {
    return componentKind;
  }

  const lowerBound = componentSection ? 3 : 0;
  for (let index = parsed.tokens.length - 1; index >= lowerBound; index--) {
    const token = parsed.tokens[index];
    if (token === 'requestBody') return 'requestBody';
    if (token === 'schema') return 'schema';
    const kind = REFERENCE_SECTION_KINDS[token];
    if (kind) return kind;
  }
  return componentKind;
}

function referenceAnnotationFields(
  ref: string,
  targetKind?: ReferenceObjectTargetKind,
): ReadonlySet<ReferenceAnnotationField> {
  switch (targetKind ?? inferReferenceObjectTargetKind(ref)) {
    case 'example':
      return ALL_REFERENCE_ANNOTATIONS;
    case 'response':
    case 'parameter':
    case 'requestBody':
    case 'header':
    case 'securityScheme':
    case 'link':
      return DESCRIPTION_REFERENCE_ANNOTATION;
    case 'callback':
      return NO_REFERENCE_ANNOTATIONS;
    default:
      // Without an expected object type, neither annotation can be applied
      // safely because their effect depends on fields allowed by that type.
      return NO_REFERENCE_ANNOTATIONS;
  }
}

function sanitizedReferenceObject(
  object: Record<string, unknown>,
  document: Record<string, unknown>,
  targetKind?: ReferenceObjectTargetKind,
): Record<string, unknown> {
  if (typeof object.$ref !== 'string') return object;
  const result: Record<string, unknown> = { $ref: object.$ref };
  if (!isOpenApi31Version(document.openapi)) return result;

  const fields = referenceAnnotationFields(object.$ref, targetKind);
  if (fields.has('summary') && typeof object.summary === 'string') result.summary = object.summary;
  if (fields.has('description') && typeof object.description === 'string') result.description = object.description;
  return result;
}

/**
 * Resolve an OAS Reference Object. OAS 3.1 permits only `summary` and
 * `description` siblings; OAS 3.0 ignores every sibling. Other fields never
 * participate in resolution.
 */
export function dereferenceOasReferenceObject(
  object: Record<string, unknown>,
  document: Record<string, unknown>,
  maxResolveDepth = 20,
  targetKind?: ReferenceObjectTargetKind,
): Record<string, unknown> {
  const allowAnnotations = isOpenApi31Version(document.openapi);
  let current = object;
  const seen = new Set<string>();

  for (let depth = 0; typeof current.$ref === 'string' && depth < maxResolveDepth; depth++) {
    const ref = current.$ref;
    const unresolved = sanitizedReferenceObject(current, document, targetKind);
    if (seen.has(ref)) return unresolved;
    seen.add(ref);
    const inferredTargetKind = inferDirectComponentReferenceTargetKind(ref);
    if (targetKind && inferredTargetKind && inferredTargetKind !== targetKind) return unresolved;
    const resolved = resolveLocalJsonPointer(document, ref);
    if (!resolved.found || !isRecord(resolved.value)) return unresolved;

    const annotations: Record<string, string> = {};
    const annotationFields = referenceAnnotationFields(ref, targetKind);
    if (allowAnnotations && annotationFields.has('summary') && typeof current.summary === 'string') {
      annotations.summary = current.summary;
    }
    if (allowAnnotations && annotationFields.has('description') && typeof current.description === 'string') {
      annotations.description = current.description;
    }
    current = { ...resolved.value, ...annotations };
  }

  return typeof current.$ref === 'string' ? sanitizedReferenceObject(current, document, targetKind) : current;
}

function resolvePathItemInternal(
  pathItem: unknown,
  document: Record<string, unknown>,
  seenRefs: ReadonlySet<string>,
  depth: number,
  maxResolveDepth: number,
): PathItemResolution {
  if (!isRecord(pathItem)) return { status: 'invalid', reason: 'Path Item 必须是对象' };
  if (typeof pathItem.$ref !== 'string') return { status: 'resolved', value: { ...pathItem } };

  const ref = pathItem.$ref;
  if (!ref.startsWith('#')) return { status: 'external', ref };
  if (depth >= maxResolveDepth) return { status: 'depth', ref };
  if (seenRefs.has(ref)) return { status: 'cycle', ref };
  const inferredTargetKind = inferDirectComponentReferenceTargetKind(ref);
  if (inferredTargetKind && inferredTargetKind !== 'pathItem') {
    return { status: 'invalid', reason: `Path Item $ref 不能指向 ${inferredTargetKind}` };
  }

  const target = resolveLocalJsonPointer(document, ref);
  if (!target.found || !isRecord(target.value)) return { status: 'missing', ref };
  const nextSeen = new Set(seenRefs);
  nextSeen.add(ref);
  const resolvedTarget = resolvePathItemInternal(target.value, document, nextSeen, depth + 1, maxResolveDepth);
  if (resolvedTarget.status !== 'resolved') return resolvedTarget;

  const siblings = Object.fromEntries(Object.entries(pathItem).filter(([key]) => key !== '$ref'));
  const conflicts = Object.keys(siblings).filter((key) =>
    Object.prototype.hasOwnProperty.call(resolvedTarget.value, key),
  );
  if (conflicts.length > 0) return { status: 'conflict', ref, conflicts };

  return { status: 'resolved', value: { ...resolvedTarget.value, ...siblings } };
}

/**
 * Resolve a Path Item `$ref` without inventing behavior for the undefined
 * overlapping-field case. Non-conflicting local fields are retained; any
 * overlap makes the result unusable and is reported to the caller.
 */
export function resolvePathItemObject(
  pathItem: unknown,
  document: Record<string, unknown>,
  maxResolveDepth = 20,
): PathItemResolution {
  return resolvePathItemInternal(pathItem, document, new Set(), 0, maxResolveDepth);
}

function parameterIdentity(
  parameter: Record<string, unknown>,
  document: Record<string, unknown>,
  fallback: string,
): string {
  const resolved = dereferenceOasReferenceObject(parameter, document, 20, 'parameter');
  if (typeof resolved.name === 'string' && typeof resolved.in === 'string') {
    return `${resolved.in}\u0000${resolved.name}`;
  }
  if (typeof parameter.$ref === 'string') return `$ref\u0000${parameter.$ref}`;
  return fallback;
}

function asParameterRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function isSecurityRequirement(value: unknown): value is Record<string, string[]> {
  return (
    isRecord(value) &&
    Object.values(value).every((scopes) => Array.isArray(scopes) && scopes.every((scope) => typeof scope === 'string'))
  );
}

function resolveReferenceMap(
  value: unknown,
  document: Record<string, unknown>,
  targetKind: ReferenceObjectTargetKind,
  project?: (resolved: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => targetKind !== 'response' || !key.startsWith('x-'))
      .map(([key, entry]) => {
        // The raw document remains untouched for diagnostics/export. The
        // consumer projection replaces malformed map entries with inert objects
        // so a safe warning never turns into a rendering exception.
        if (!isRecord(entry)) return [key, {}];
        const resolved = dereferenceOasReferenceObject(entry, document, 20, targetKind);
        if (typeof resolved.$ref === 'string') return [key, {}];
        return [key, project ? project(resolved) : resolved];
      }),
  );
}

function projectResponseReferences(
  response: Record<string, unknown>,
  document: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...response };
  const headers = resolveReferenceMap(response.headers, document, 'header');
  const links = resolveReferenceMap(response.links, document, 'link');
  if (headers) result.headers = headers;
  if (links) result.links = links;
  return result;
}

/**
 * Project the operation users actually consume: Path Item metadata is the
 * fallback, path parameters are inherited, and an operation parameter with
 * the same `(in, name)` replaces the inherited one without changing order.
 */
export function resolvePathItemOperation(
  rawPathItem: unknown,
  method: OpenApiHttpMethod,
  document: Record<string, unknown>,
): ResolvedPathItemOperation | null {
  const resolved = resolvePathItemObject(rawPathItem, document);
  if (resolved.status !== 'resolved') return null;
  const rawOperation = resolved.value[method];
  if (!isRecord(rawOperation)) return null;

  const operation: ResolvedOperationObject = { ...rawOperation };
  if (owns(rawOperation, 'summary')) {
    if (typeof rawOperation.summary !== 'string') delete operation.summary;
  } else if (typeof resolved.value.summary === 'string') {
    operation.summary = resolved.value.summary;
  }
  if (owns(rawOperation, 'description')) {
    if (typeof rawOperation.description !== 'string') delete operation.description;
  } else if (typeof resolved.value.description === 'string') {
    operation.description = resolved.value.description;
  }
  if (owns(rawOperation, 'operationId') && typeof rawOperation.operationId !== 'string') {
    delete operation.operationId;
  }
  if (owns(rawOperation, 'deprecated') && typeof rawOperation.deprecated !== 'boolean') {
    delete operation.deprecated;
  }
  if (owns(rawOperation, 'externalDocs')) {
    if (!isRecord(rawOperation.externalDocs) || typeof rawOperation.externalDocs.url !== 'string') {
      delete operation.externalDocs;
    }
  }
  if (owns(rawOperation, 'tags')) {
    if (Array.isArray(rawOperation.tags)) {
      operation.tags = rawOperation.tags.filter((tag): tag is string => typeof tag === 'string');
    } else {
      delete operation.tags;
    }
  }
  if (owns(rawOperation, 'servers')) {
    if (Array.isArray(rawOperation.servers)) {
      operation.servers = rawOperation.servers.filter((server) => isRecord(server) && typeof server.url === 'string');
    } else {
      delete operation.servers;
    }
  }
  if (owns(rawOperation, 'security')) {
    if (Array.isArray(rawOperation.security) && rawOperation.security.every(isSecurityRequirement)) {
      operation.security = rawOperation.security;
    } else {
      delete operation.security;
    }
  }

  const pathParameters = asParameterRecords(resolved.value.parameters);
  const operationParameters = asParameterRecords(rawOperation.parameters);
  if (pathParameters.length > 0 || owns(rawOperation, 'parameters')) {
    const parameters = new Map<string, Record<string, unknown>>();
    pathParameters.forEach((parameter, index) => {
      parameters.set(parameterIdentity(parameter, document, `path\u0000${index}`), parameter);
    });
    operationParameters.forEach((parameter, index) => {
      parameters.set(parameterIdentity(parameter, document, `operation\u0000${index}`), parameter);
    });
    operation.parameters = Array.from(parameters.values())
      .map((parameter) => dereferenceOasReferenceObject(parameter, document, 20, 'parameter'))
      .filter((parameter) => typeof parameter.name === 'string' && typeof parameter.in === 'string');
  }

  if (owns(rawOperation, 'requestBody')) {
    if (isRecord(rawOperation.requestBody)) {
      const requestBody = dereferenceOasReferenceObject(rawOperation.requestBody, document, 20, 'requestBody');
      if (typeof requestBody.$ref === 'string') delete operation.requestBody;
      else operation.requestBody = requestBody;
    } else {
      delete operation.requestBody;
    }
  }
  const responses = resolveReferenceMap(rawOperation.responses, document, 'response', (response) =>
    projectResponseReferences(response, document),
  );
  if (responses) operation.responses = responses;
  else if (owns(rawOperation, 'responses')) operation.responses = {};
  const callbacks = resolveReferenceMap(rawOperation.callbacks, document, 'callback');
  if (callbacks) operation.callbacks = callbacks;
  else if (owns(rawOperation, 'callbacks')) operation.callbacks = {};

  return { pathItem: resolved.value, operation };
}
