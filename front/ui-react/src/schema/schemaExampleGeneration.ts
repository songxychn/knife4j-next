import type { EvaluationIssue, EvaluationResult, JsonValue, SchemaNode } from 'knife4j-schema-engine';
import { evaluateSchemaDocumentDirectionally, type SchemaDocumentSession } from './schemaDocumentSession';

export type SchemaExampleDirection = 'request' | 'response';

export type SchemaExampleSource =
  | 'media-example'
  | 'example-object'
  | 'schema-examples'
  | 'schema-example'
  | 'const'
  | 'default'
  | 'enum'
  | 'generated';

export interface ExplicitSchemaExample {
  readonly source: Extract<SchemaExampleSource, 'media-example' | 'example-object'>;
  readonly value: JsonValue;
}

export interface SchemaExampleIssue {
  readonly instanceLocation: string;
  readonly keyword: string;
  readonly absoluteKeywordLocation: string;
}

export type SchemaExampleDiagnosticCode =
  | 'EXPLICIT_VALUE_INVALID'
  | 'EVALUATION_UNAVAILABLE'
  | 'SCHEMA_UNAVAILABLE'
  | 'NO_VALID_CANDIDATE'
  | 'SEARCH_BUDGET_EXCEEDED';

export interface SchemaExampleDiagnostic {
  readonly code: SchemaExampleDiagnosticCode;
  readonly message?: string;
  readonly issues?: readonly SchemaExampleIssue[];
  readonly totalIssues?: number;
}

export type SchemaExampleResult =
  | {
      readonly status: 'value';
      readonly value: JsonValue;
      readonly source: SchemaExampleSource;
      readonly authored: boolean;
      readonly validation: 'valid' | 'invalid' | 'unavailable';
      readonly diagnostics: readonly SchemaExampleDiagnostic[];
    }
  | {
      readonly status: 'none';
      readonly reason:
        | 'false-schema'
        | 'schema-unavailable'
        | 'evaluation-unavailable'
        | 'no-valid-candidate'
        | 'search-budget-exceeded';
      readonly diagnostics: readonly SchemaExampleDiagnostic[];
    };

export interface SchemaExampleSearchLimits {
  readonly maxCandidates?: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxReferences?: number;
  readonly maxEvaluations?: number;
  readonly maxStringLength?: number;
  readonly maxArrayLength?: number;
}

export interface GenerateSchemaExampleOptions {
  readonly direction: SchemaExampleDirection;
  readonly explicit?: readonly ExplicitSchemaExample[];
  readonly signal?: AbortSignal;
  readonly limits?: SchemaExampleSearchLimits;
}

interface EffectiveLimits {
  readonly maxCandidates: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxReferences: number;
  readonly maxEvaluations: number;
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
}

interface AuthoredCandidate {
  readonly source: Exclude<SchemaExampleSource, 'generated' | 'media-example' | 'example-object'>;
  readonly value: JsonValue;
  readonly rank: number;
  readonly depth: number;
}

interface SearchBudget {
  nodes: number;
  references: number;
  exhausted: boolean;
}

interface SearchContext {
  readonly session: SchemaDocumentSession;
  readonly direction: SchemaExampleDirection;
  readonly limits: EffectiveLimits;
  readonly budget: SearchBudget;
  readonly baseUri: string;
  readonly baseAlreadyIncludesOwnId: boolean;
  readonly depth: number;
  readonly referenceChain: ReadonlySet<string>;
  readonly dynamicScope: readonly string[];
  readonly signal?: AbortSignal;
  readonly resolvedNodes: Map<string, Promise<SchemaNode>>;
  readonly directionalAnnotations: Map<string, boolean>;
  readonly directionalProperties: Map<string, ReadonlySet<string>>;
  readonly schemaObjectIds: WeakMap<object, number>;
  readonly schemaObjectSequence: { value: number };
  readonly dynamicAnchorsByResource: Map<string, Readonly<Record<string, string>>>;
}

const DEFAULT_LIMITS: EffectiveLimits = Object.freeze({
  maxCandidates: 48,
  maxDepth: 8,
  maxNodes: 320,
  maxReferences: 64,
  maxEvaluations: 48,
  maxStringLength: 256,
  maxArrayLength: 16,
});

const AUTHOR_SOURCE_RANK: Readonly<Record<AuthoredCandidate['source'], number>> = Object.freeze({
  'schema-examples': 0,
  'schema-example': 1,
  const: 2,
  default: 3,
  enum: 4,
});

const ASSERTION_KEYS = new Set([
  'type',
  'enum',
  'const',
  'multipleOf',
  'maximum',
  'exclusiveMaximum',
  'minimum',
  'exclusiveMinimum',
  'maxLength',
  'minLength',
  'pattern',
  'maxItems',
  'minItems',
  'uniqueItems',
  'maxContains',
  'minContains',
  'maxProperties',
  'minProperties',
  'required',
  'dependentRequired',
  'properties',
  'patternProperties',
  'additionalProperties',
  'propertyNames',
  'prefixItems',
  'items',
  'contains',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'dependentSchemas',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

function effectiveLimits(overrides: SchemaExampleSearchLimits | undefined): EffectiveLimits {
  const positiveInteger = (value: number | undefined, fallback: number): number =>
    value === undefined || !Number.isFinite(value) ? fallback : Math.max(1, Math.floor(value));
  return {
    maxCandidates: positiveInteger(overrides?.maxCandidates, DEFAULT_LIMITS.maxCandidates),
    maxDepth: positiveInteger(overrides?.maxDepth, DEFAULT_LIMITS.maxDepth),
    maxNodes: positiveInteger(overrides?.maxNodes, DEFAULT_LIMITS.maxNodes),
    maxReferences: positiveInteger(overrides?.maxReferences, DEFAULT_LIMITS.maxReferences),
    maxEvaluations: positiveInteger(overrides?.maxEvaluations, DEFAULT_LIMITS.maxEvaluations),
    maxStringLength: positiveInteger(overrides?.maxStringLength, DEFAULT_LIMITS.maxStringLength),
    maxArrayLength: positiveInteger(overrides?.maxArrayLength, DEFAULT_LIMITS.maxArrayLength),
  };
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function abortError(message = 'Schema example generation was aborted.'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function enterNode(ctx: SearchContext): boolean {
  throwIfAborted(ctx.signal);
  ctx.budget.nodes += 1;
  if (ctx.depth > ctx.limits.maxDepth || ctx.budget.nodes > ctx.limits.maxNodes) {
    ctx.budget.exhausted = true;
    return false;
  }
  return true;
}

function childContext(ctx: SearchContext, baseUri = ctx.baseUri): SearchContext {
  return { ...ctx, baseUri, baseAlreadyIncludesOwnId: false, depth: ctx.depth + 1 };
}

function resolvedContext(ctx: SearchContext, node: SchemaNode, referenceUri: string): SearchContext {
  ctx.dynamicAnchorsByResource.set(node.resourceUri, node.dynamicAnchors);
  return {
    ...ctx,
    baseUri: node.resourceUri,
    baseAlreadyIncludesOwnId: true,
    depth: ctx.depth + 1,
    referenceChain: new Set([...ctx.referenceChain, referenceUri, node.canonicalUri]),
    dynamicScope: ctx.dynamicScope.includes(node.resourceUri)
      ? ctx.dynamicScope
      : [...ctx.dynamicScope, node.resourceUri],
  };
}

function resourceUri(uri: string): string {
  try {
    const url = new URL(uri);
    url.hash = '';
    return url.href;
  } catch {
    return uri;
  }
}

function dynamicScopeWithBase(ctx: SearchContext, baseUri: string): readonly string[] {
  const resource = resourceUri(baseUri);
  return ctx.dynamicScope.includes(resource) ? ctx.dynamicScope : [...ctx.dynamicScope, resource];
}

function effectiveBaseUri(schema: { [key: string]: JsonValue }, ctx: SearchContext): string {
  if (ctx.baseAlreadyIncludesOwnId || typeof schema.$id !== 'string') return ctx.baseUri;
  try {
    return new URL(schema.$id, ctx.baseUri).href;
  } catch {
    return ctx.baseUri;
  }
}

function resolvedReferenceUri(reference: string, baseUri: string): string | null {
  try {
    return new URL(reference, baseUri).href;
  } catch {
    return null;
  }
}

function evaluationReferenceFor(node: SchemaNode): string {
  return node.canonicalUri.endsWith('#') ? node.canonicalUri.slice(0, -1) : node.canonicalUri;
}

function cloneValue<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

function candidateKey(value: JsonValue): string {
  return JSON.stringify(value);
}

function uniqueCandidates(values: readonly JsonValue[], limit: number): JsonValue[] {
  const seen = new Set<string>();
  const result: JsonValue[] = [];
  for (const value of values) {
    const key = candidateKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneValue(value));
    if (result.length >= limit) break;
  }
  return result;
}

function appendCandidate(target: JsonValue[], value: unknown, limit: number): void {
  if (target.length >= limit || !isJsonValue(value)) return;
  target.push(cloneValue(value));
}

function localAuthoredCandidates(
  schema: { [key: string]: JsonValue },
  depth: number,
  limit: number,
): AuthoredCandidate[] {
  const candidates: AuthoredCandidate[] = [];
  const append = (source: AuthoredCandidate['source'], value: unknown): void => {
    if (candidates.length >= limit || !isJsonValue(value)) return;
    candidates.push({ source, value: cloneValue(value), rank: AUTHOR_SOURCE_RANK[source], depth });
  };

  if (Array.isArray(schema.examples)) {
    for (const value of schema.examples) {
      append('schema-examples', value);
      if (candidates.length >= limit) break;
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'example')) append('schema-example', schema.example);
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) append('const', schema.const);
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) append('default', schema.default);
  if (Array.isArray(schema.enum)) {
    for (const value of schema.enum) {
      append('enum', value);
      if (candidates.length >= limit) break;
    }
  }
  return candidates;
}

async function resolveNode(reference: string, ctx: SearchContext): Promise<{ uri: string; node: SchemaNode } | null> {
  throwIfAborted(ctx.signal);
  const uri = resolvedReferenceUri(reference, ctx.baseUri);
  if (!uri || ctx.referenceChain.has(uri)) return null;
  ctx.budget.references += 1;
  if (ctx.budget.references > ctx.limits.maxReferences) {
    ctx.budget.exhausted = true;
    return null;
  }

  let pending = ctx.resolvedNodes.get(uri);
  if (!pending) {
    pending = ctx.session.resolve(uri);
    ctx.resolvedNodes.set(uri, pending);
    pending.catch(() => {
      if (ctx.resolvedNodes.get(uri) === pending) ctx.resolvedNodes.delete(uri);
    });
  }
  try {
    const node = await pending;
    throwIfAborted(ctx.signal);
    if (ctx.referenceChain.has(node.canonicalUri)) return null;
    ctx.dynamicAnchorsByResource.set(node.resourceUri, node.dynamicAnchors);
    return { uri, node };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return null;
  }
}

function referenceAnchor(referenceUri: string): string | null {
  try {
    const url = new URL(referenceUri);
    const fragment = decodeURIComponent(url.hash.slice(1));
    return fragment && !fragment.startsWith('/') ? fragment : null;
  } catch {
    return null;
  }
}

async function resolveSchemaReference(
  reference: string,
  ctx: SearchContext,
  dynamic: boolean,
): Promise<{ uri: string; node: SchemaNode } | null> {
  const resolved = await resolveNode(reference, ctx);
  if (!resolved || !dynamic) return resolved;
  const anchor = referenceAnchor(resolved.uri);
  if (!anchor || !Object.prototype.hasOwnProperty.call(resolved.node.dynamicAnchors, anchor)) return resolved;

  for (const scopeResource of ctx.dynamicScope) {
    const overrideUri = ctx.dynamicAnchorsByResource.get(scopeResource)?.[anchor];
    if (!overrideUri || overrideUri === resolved.node.canonicalUri) continue;
    const override = await resolveNode(overrideUri, ctx);
    if (override) return override;
  }
  return resolved;
}

async function collectRootAuthoredCandidates(
  schema: JsonValue,
  ctx: SearchContext,
  depth = 0,
): Promise<AuthoredCandidate[]> {
  throwIfAborted(ctx.signal);
  if (!isRecord(schema) || depth > ctx.limits.maxDepth) return [];
  const baseUri = effectiveBaseUri(schema, ctx);
  const localCtx = {
    ...ctx,
    baseUri,
    baseAlreadyIncludesOwnId: true,
    dynamicScope: dynamicScopeWithBase(ctx, baseUri),
  };
  const candidates = localAuthoredCandidates(schema, depth, ctx.limits.maxCandidates);
  const referenceKeyword =
    typeof schema.$ref === 'string' ? '$ref' : typeof schema.$dynamicRef === 'string' ? '$dynamicRef' : null;
  if (referenceKeyword) {
    const reference = schema[referenceKeyword] as string;
    const resolved = await resolveSchemaReference(reference, localCtx, referenceKeyword === '$dynamicRef');
    if (resolved) {
      candidates.push(
        ...(await collectRootAuthoredCandidates(
          resolved.node.schema,
          resolvedContext(localCtx, resolved.node, resolved.uri),
          depth + 1,
        )),
      );
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      candidates.push(...(await collectRootAuthoredCandidates(branch, childContext(localCtx), depth + 1)));
    }
  }
  return candidates
    .sort((left, right) => left.rank - right.rank || left.depth - right.depth)
    .slice(0, ctx.limits.maxCandidates);
}

function normalizedTypes(schema: { [key: string]: JsonValue }): string[] {
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type)) {
    return Array.from(new Set(schema.type.filter((value): value is string => typeof value === 'string')));
  }
  if (isRecord(schema.properties) || schema.required !== undefined || schema.additionalProperties !== undefined) {
    return ['object'];
  }
  if (schema.items !== undefined || Array.isArray(schema.prefixItems) || schema.contains !== undefined)
    return ['array'];
  return [];
}

function adjustedString(value: string, schema: { [key: string]: JsonValue }, maxLength: number): string | null {
  const min = typeof schema.minLength === 'number' ? Math.max(0, Math.floor(schema.minLength)) : 0;
  const max = typeof schema.maxLength === 'number' ? Math.max(0, Math.floor(schema.maxLength)) : maxLength;
  if (min > max || min > maxLength) return null;
  const cappedMax = Math.min(max, maxLength);
  let result = value;
  if (result.length < min) result += 'a'.repeat(min - result.length);
  if (result.length > cappedMax) result = result.slice(0, cappedMax);
  return result.length >= min ? result : null;
}

function patternSamples(pattern: string, maxLength: number): string[] {
  const samples: string[] = [];
  const exactClass = /^\^\[([A-Za-z0-9-]+)\]\{(\d+)(?:,(\d+))?\}\$$/.exec(pattern);
  if (exactClass) {
    const count = Math.min(Number(exactClass[2]), maxLength);
    const classValue = exactClass[1];
    const char = classValue.includes('A-Z') ? 'A' : classValue.includes('a-z') ? 'a' : '0';
    samples.push(char.repeat(count));
  }
  const literal = /^\^([A-Za-z0-9 _.-]+)\$$/.exec(pattern);
  if (literal) samples.push(literal[1]);
  if (pattern.includes('\\d') || pattern.includes('[0-9]')) samples.push('0', '000000');
  if (pattern.includes('[A-Z]')) samples.push('A', 'ABC');
  if (pattern.includes('[a-z]')) samples.push('a', 'abc');
  return samples;
}

function stringCandidates(schema: { [key: string]: JsonValue }, ctx: SearchContext): JsonValue[] {
  const values: JsonValue[] = [];
  const samplesByFormat: Record<string, string> = {
    date: '2024-01-01',
    'date-time': '2024-01-01T00:00:00Z',
    time: '00:00:00Z',
    duration: 'P1D',
    email: 'user@example.com',
    hostname: 'example.com',
    ipv4: '192.0.2.1',
    ipv6: '2001:db8::1',
    uri: 'https://example.com',
    uuid: '00000000-0000-4000-8000-000000000000',
    byte: 'AA==',
    binary: '',
  };
  const formatSample = typeof schema.format === 'string' ? samplesByFormat[schema.format] : undefined;
  const rawSamples = [
    ...(formatSample === undefined ? [] : [formatSample]),
    ...(typeof schema.pattern === 'string' ? patternSamples(schema.pattern, ctx.limits.maxStringLength) : []),
    '',
    'string',
    'example',
    'a',
    '0',
  ];
  const minLength = typeof schema.minLength === 'number' ? Math.max(0, Math.floor(schema.minLength)) : 0;
  if (minLength <= ctx.limits.maxStringLength) rawSamples.push('a'.repeat(minLength), '0'.repeat(minLength));
  if (typeof schema.contentMediaType === 'string' && schema.contentMediaType.toLowerCase().includes('json')) {
    rawSamples.unshift('{}');
  }
  for (const sample of rawSamples) {
    const adjusted = adjustedString(sample, schema, ctx.limits.maxStringLength);
    if (adjusted !== null) appendCandidate(values, adjusted, ctx.limits.maxCandidates);
  }
  return uniqueCandidates(values, ctx.limits.maxCandidates);
}

function numberCandidates(schema: { [key: string]: JsonValue }, integer: boolean, ctx: SearchContext): JsonValue[] {
  const values: number[] = [0, 1, -1];
  const minimum = typeof schema.minimum === 'number' ? schema.minimum : undefined;
  const exclusiveMinimum = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined;
  const maximum = typeof schema.maximum === 'number' ? schema.maximum : undefined;
  const exclusiveMaximum = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined;
  const multipleOf = typeof schema.multipleOf === 'number' && schema.multipleOf > 0 ? schema.multipleOf : undefined;
  if (minimum !== undefined) values.unshift(minimum);
  if (exclusiveMinimum !== undefined) values.unshift(exclusiveMinimum + (integer ? 1 : (multipleOf ?? 0.5)));
  if (maximum !== undefined) values.push(maximum);
  if (exclusiveMaximum !== undefined) values.push(exclusiveMaximum - (integer ? 1 : (multipleOf ?? 0.5)));
  if (multipleOf !== undefined) {
    const base = exclusiveMinimum ?? minimum ?? 0;
    const multiplier = Math.ceil(base / multipleOf + (exclusiveMinimum === undefined ? 0 : Number.EPSILON));
    values.unshift(multiplier * multipleOf);
  }
  return uniqueCandidates(
    values
      .map((value) => (integer ? Math.round(value) : value))
      .filter((value) => Number.isFinite(value)) as JsonValue[],
    ctx.limits.maxCandidates,
  );
}

function primitiveCandidates(schema: { [key: string]: JsonValue }, type: string, ctx: SearchContext): JsonValue[] {
  if (type === 'string') return stringCandidates(schema, ctx);
  if (type === 'integer') return numberCandidates(schema, true, ctx);
  if (type === 'number') return numberCandidates(schema, false, ctx);
  if (type === 'boolean') return [true, false];
  if (type === 'null') return [null];
  return [];
}

async function shouldIgnoreProperty(
  schema: JsonValue,
  ctx: SearchContext,
  activeReferences: ReadonlySet<string> = new Set(),
): Promise<boolean> {
  if (!enterNode(ctx) || !isRecord(schema)) return false;
  const baseUri = effectiveBaseUri(schema, ctx);
  const localCtx = {
    ...ctx,
    baseUri,
    baseAlreadyIncludesOwnId: true,
    dynamicScope: dynamicScopeWithBase(ctx, baseUri),
  };
  if (ctx.direction === 'request' ? schema.readOnly === true : schema.writeOnly === true) return true;

  for (const [keyword, reference] of [
    ['$ref', schema.$ref],
    ['$dynamicRef', schema.$dynamicRef],
    ['$recursiveRef', schema.$recursiveRef],
  ] as const) {
    if (typeof reference !== 'string') continue;
    const referenceUri = resolvedReferenceUri(reference, baseUri);
    const dynamicScopeKey = localCtx.dynamicScope.join('\u0001');
    const cacheKey =
      referenceUri === null ? null : `${ctx.direction}\u0000${keyword}\u0000${referenceUri}\u0000${dynamicScopeKey}`;
    if (cacheKey !== null) {
      const cached = ctx.directionalAnnotations.get(cacheKey);
      if (cached === true) return true;
    }
    if (referenceUri !== null && !activeReferences.has(referenceUri)) {
      const resolved = await resolveSchemaReference(reference, localCtx, keyword === '$dynamicRef');
      if (resolved) {
        const ignored = await shouldIgnoreProperty(
          resolved.node.schema,
          resolvedContext(localCtx, resolved.node, resolved.uri),
          new Set(activeReferences).add(referenceUri),
        );
        if (cacheKey !== null && ignored) ctx.directionalAnnotations.set(cacheKey, true);
        if (ignored) return true;
      }
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      if (await shouldIgnoreProperty(branch, childContext(localCtx), activeReferences)) return true;
      if (ctx.budget.exhausted) return false;
    }
  }
  return false;
}

function directionalSchemaAnalysisKey(schema: object, ctx: SearchContext): string {
  let objectId = ctx.schemaObjectIds.get(schema);
  if (objectId === undefined) {
    objectId = ctx.schemaObjectSequence.value;
    ctx.schemaObjectSequence.value += 1;
    ctx.schemaObjectIds.set(schema, objectId);
  }
  return `${ctx.baseUri}\u0000${ctx.dynamicScope.join('\u0001')}\u0000${objectId}`;
}

async function directionalPropertyNames(
  schema: JsonValue,
  ctx: SearchContext,
  active: ReadonlySet<string> = new Set(),
): Promise<ReadonlySet<string>> {
  if (!isRecord(schema)) return new Set();
  const baseUri = effectiveBaseUri(schema, ctx);
  const localCtx = {
    ...ctx,
    baseUri,
    baseAlreadyIncludesOwnId: true,
    dynamicScope: dynamicScopeWithBase(ctx, baseUri),
  };
  const key = directionalSchemaAnalysisKey(schema, localCtx);
  const cached = ctx.directionalProperties.get(key);
  if (cached) return cached;
  if (active.has(key)) return new Set();
  if (!enterNode(ctx)) return new Set();
  const nextActive = new Set(active).add(key);
  const names = new Set<string>();

  if (isRecord(schema.properties)) {
    for (const [name, propertySchema] of Object.entries(schema.properties)) {
      if (await shouldIgnoreProperty(propertySchema, childContext(localCtx))) names.add(name);
      if (ctx.budget.exhausted) return new Set();
    }
  }
  for (const [keyword, reference] of [
    ['$ref', schema.$ref],
    ['$dynamicRef', schema.$dynamicRef],
    ['$recursiveRef', schema.$recursiveRef],
  ] as const) {
    if (typeof reference !== 'string') continue;
    const resolved = await resolveSchemaReference(reference, localCtx, keyword === '$dynamicRef');
    if (!resolved) continue;
    const resolvedNames = await directionalPropertyNames(
      resolved.node.schema,
      resolvedContext(localCtx, resolved.node, resolved.uri),
      nextActive,
    );
    resolvedNames.forEach((name) => names.add(name));
    if (ctx.budget.exhausted) return new Set();
  }
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      const branchNames = await directionalPropertyNames(branch, childContext(localCtx), nextActive);
      branchNames.forEach((name) => names.add(name));
      if (ctx.budget.exhausted) return new Set();
    }
  }
  ctx.directionalProperties.set(key, names);
  return names;
}

function omitDirectionalProperties(value: JsonValue, names: ReadonlySet<string>): JsonValue {
  if (!isRecord(value) || names.size === 0) return value;
  const result = { ...value };
  names.forEach((name) => delete result[name]);
  return result;
}

function mergeObjects(left: JsonValue, right: JsonValue): JsonValue | null {
  if (!isRecord(left) || !isRecord(right)) return null;
  return { ...cloneValue(left), ...cloneValue(right) };
}

function combineIntersection(left: readonly JsonValue[], right: readonly JsonValue[], limit: number): JsonValue[] {
  if (left.length === 0) return uniqueCandidates(right, limit);
  if (right.length === 0) return uniqueCandidates(left, limit);
  const values: JsonValue[] = [];
  for (const leftValue of left) {
    for (const rightValue of right) {
      const merged = mergeObjects(leftValue, rightValue);
      if (merged !== null) appendCandidate(values, merged, limit);
      if (candidateKey(leftValue) === candidateKey(rightValue)) appendCandidate(values, leftValue, limit);
      if (values.length >= limit) return uniqueCandidates(values, limit);
    }
  }
  values.push(...left, ...right);
  return uniqueCandidates(values, limit);
}

function overlayBaseCandidates(base: readonly JsonValue[], branches: readonly JsonValue[], limit: number): JsonValue[] {
  const values: JsonValue[] = [];
  for (const branch of branches) {
    let mergedAny = false;
    for (const baseValue of base) {
      const merged = mergeObjects(baseValue, branch);
      if (merged !== null) {
        appendCandidate(values, merged, limit);
        mergedAny = true;
      }
    }
    if (!mergedAny) appendCandidate(values, branch, limit);
  }
  values.push(...base);
  return uniqueCandidates(values, limit);
}

async function objectCandidates(schema: { [key: string]: JsonValue }, ctx: SearchContext): Promise<JsonValue[]> {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === 'string') : [],
  );
  const entries: Array<[string, JsonValue]> = [];
  const ignoredProperties = new Set<string>();
  for (const [name, propertySchema] of Object.entries(properties)) {
    if (await shouldIgnoreProperty(propertySchema, childContext(ctx))) ignoredProperties.add(name);
    else entries.push([name, propertySchema]);
    if (ctx.budget.exhausted) return [];
  }
  const requiredEntries = entries.filter(([name]) => required.has(name));
  const optionalEntries = entries.filter(([name]) => !required.has(name));
  const maxProperties =
    typeof schema.maxProperties === 'number' ? Math.max(0, Math.floor(schema.maxProperties)) : Number.POSITIVE_INFINITY;
  const minProperties = typeof schema.minProperties === 'number' ? Math.max(0, Math.floor(schema.minProperties)) : 0;

  const buildVariants = async (selected: readonly [string, JsonValue][]): Promise<JsonValue[]> => {
    let variants: Array<{ [key: string]: JsonValue }> = [{}];
    for (const [name, propertySchema] of selected) {
      const propertyValues = await buildCandidates(propertySchema, childContext(ctx));
      if (propertyValues.length === 0) {
        if (required.has(name)) return [];
        continue;
      }
      const next: Array<{ [key: string]: JsonValue }> = [];
      for (const variant of variants) {
        for (const value of propertyValues.slice(0, 4)) {
          next.push({ ...variant, [name]: cloneValue(value) });
          if (next.length >= ctx.limits.maxCandidates) break;
        }
        if (next.length >= ctx.limits.maxCandidates) break;
      }
      variants = next;
    }
    return variants;
  };

  const minimumOptionalCount = Math.max(0, minProperties - requiredEntries.length);
  const minimumEntries = [...requiredEntries, ...optionalEntries.slice(0, minimumOptionalCount)];
  const fullEntries = [...requiredEntries, ...optionalEntries].slice(
    0,
    Number.isFinite(maxProperties) ? maxProperties : undefined,
  );
  const values: JsonValue[] = [];
  values.push(...(await buildVariants(fullEntries)));
  values.push(...(await buildVariants(minimumEntries)));
  if (requiredEntries.length === 0 && minProperties === 0) values.push({});

  const dependentRequired = isRecord(schema.dependentRequired) ? schema.dependentRequired : null;
  if (dependentRequired) {
    for (const candidate of [...values]) {
      if (!isRecord(candidate)) continue;
      const next = { ...candidate };
      for (const [trigger, dependencies] of Object.entries(dependentRequired)) {
        if (!Object.prototype.hasOwnProperty.call(next, trigger) || !Array.isArray(dependencies)) continue;
        for (const dependency of dependencies) {
          if (typeof dependency !== 'string' || Object.prototype.hasOwnProperty.call(next, dependency)) continue;
          const propertySchema = properties[dependency];
          if (propertySchema === undefined || ignoredProperties.has(dependency)) continue;
          const [value] = await buildCandidates(propertySchema, childContext(ctx));
          if (value !== undefined) next[dependency] = cloneValue(value);
        }
      }
      appendCandidate(values, next, ctx.limits.maxCandidates);
    }
  }

  if (values.every((value) => !isRecord(value) || Object.keys(value).length < minProperties)) {
    const additionalSchema = schema.additionalProperties;
    if (additionalSchema !== false) {
      const propertySchema = additionalSchema === undefined ? true : additionalSchema;
      const [additionalValue = null] = await buildCandidates(propertySchema, childContext(ctx));
      const additional: { [key: string]: JsonValue } = {};
      for (let index = 0; index < Math.min(minProperties, ctx.limits.maxArrayLength); index += 1) {
        additional[`property${index + 1}`] = cloneValue(additionalValue);
      }
      appendCandidate(values, additional, ctx.limits.maxCandidates);
    }
  }
  return uniqueCandidates(values, ctx.limits.maxCandidates);
}

async function arrayCandidates(schema: { [key: string]: JsonValue }, ctx: SearchContext): Promise<JsonValue[]> {
  const prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
  const minItems = typeof schema.minItems === 'number' ? Math.max(0, Math.floor(schema.minItems)) : 0;
  const maxItems =
    typeof schema.maxItems === 'number'
      ? Math.min(ctx.limits.maxArrayLength, Math.max(0, Math.floor(schema.maxItems)))
      : ctx.limits.maxArrayLength;
  if (minItems > maxItems) return [];

  const values: JsonValue[] = [];
  const tuple: JsonValue[] = [];
  for (const itemSchema of prefixItems.slice(0, maxItems)) {
    const [itemValue] = await buildCandidates(itemSchema, childContext(ctx));
    if (itemValue === undefined) break;
    tuple.push(cloneValue(itemValue));
  }
  if (tuple.length >= minItems) appendCandidate(values, tuple, ctx.limits.maxCandidates);

  const itemSchema = schema.items === undefined ? true : schema.items;
  if (itemSchema !== false) {
    const itemValues = await buildCandidates(itemSchema, childContext(ctx));
    const targetLength = Math.max(minItems, Math.min(prefixItems.length, maxItems));
    const filled = tuple.slice(0, targetLength);
    let itemIndex = 0;
    while (filled.length < targetLength && itemValues.length > 0) {
      filled.push(cloneValue(itemValues[itemIndex % itemValues.length]));
      itemIndex += 1;
    }
    if (filled.length >= minItems) appendCandidate(values, filled, ctx.limits.maxCandidates);
  }

  if (schema.contains !== undefined) {
    const containsValues = await buildCandidates(schema.contains, childContext(ctx));
    const minContains = typeof schema.minContains === 'number' ? Math.max(0, Math.floor(schema.minContains)) : 1;
    const requiredContains = Math.min(Math.max(1, minContains), maxItems);
    for (const [candidateIndex, containsValue] of containsValues.slice(0, 4).entries()) {
      const withContains = tuple.slice(0, Math.max(0, maxItems - requiredContains));
      for (let offset = 0; offset < requiredContains; offset += 1) {
        const nextValue = containsValues[(candidateIndex + offset) % containsValues.length] ?? containsValue;
        withContains.push(cloneValue(nextValue));
      }
      while (withContains.length < minItems && itemSchema !== false) withContains.push(null);
      if (withContains.length <= maxItems) appendCandidate(values, withContains, ctx.limits.maxCandidates);
    }
  }
  if (minItems === 0) values.push([]);
  return uniqueCandidates(values, ctx.limits.maxCandidates);
}

async function referenceCandidates(schema: { [key: string]: JsonValue }, ctx: SearchContext): Promise<JsonValue[]> {
  const keyword =
    typeof schema.$ref === 'string'
      ? '$ref'
      : typeof schema.$dynamicRef === 'string'
        ? '$dynamicRef'
        : typeof schema.$recursiveRef === 'string'
          ? '$recursiveRef'
          : null;
  if (!keyword) return [];
  const reference = schema[keyword] as string;
  const resolved = await resolveSchemaReference(reference, ctx, keyword === '$dynamicRef');
  if (!resolved) return [];
  const targetCandidates = await buildCandidates(
    resolved.node.schema,
    resolvedContext(ctx, resolved.node, resolved.uri),
  );
  const siblingSchema = Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== '$ref' && key !== '$dynamicRef' && key !== '$recursiveRef'),
  ) as { [key: string]: JsonValue };
  if (!Object.keys(siblingSchema).some((key) => ASSERTION_KEYS.has(key))) return targetCandidates;
  const siblingCandidates = await buildCandidates(siblingSchema, { ...ctx, depth: ctx.depth + 1 });
  return combineIntersection(targetCandidates, siblingCandidates, ctx.limits.maxCandidates);
}

async function compositionCandidates(
  schema: { [key: string]: JsonValue },
  base: readonly JsonValue[],
  ctx: SearchContext,
): Promise<JsonValue[]> {
  let values = uniqueCandidates(base, ctx.limits.maxCandidates);
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      const branchValues = await buildCandidates(branch, childContext(ctx));
      values = combineIntersection(values, branchValues, ctx.limits.maxCandidates);
    }
  }
  for (const keyword of ['oneOf', 'anyOf'] as const) {
    if (!Array.isArray(schema[keyword])) continue;
    const branches: JsonValue[] = [];
    for (const branch of schema[keyword]) branches.push(...(await buildCandidates(branch, childContext(ctx))));
    values = overlayBaseCandidates(values, branches, ctx.limits.maxCandidates);
  }
  for (const keyword of ['then', 'else'] as const) {
    if (schema[keyword] === undefined) continue;
    const branchValues = await buildCandidates(schema[keyword], childContext(ctx));
    values = overlayBaseCandidates(values, branchValues, ctx.limits.maxCandidates);
  }
  if (isRecord(schema.dependentSchemas)) {
    for (const branch of Object.values(schema.dependentSchemas)) {
      const branchValues = await buildCandidates(branch, childContext(ctx));
      values = overlayBaseCandidates(values, branchValues, ctx.limits.maxCandidates);
    }
  }
  return uniqueCandidates(values, ctx.limits.maxCandidates);
}

async function buildCandidates(schema: JsonValue, ctx: SearchContext): Promise<JsonValue[]> {
  if (!enterNode(ctx)) return [];
  if (schema === false) return [];
  if (schema === true) return [{}, [], '', 0, false, null];
  if (!isRecord(schema)) return [];

  const baseUri = effectiveBaseUri(schema, ctx);
  const localCtx = {
    ...ctx,
    baseUri,
    baseAlreadyIncludesOwnId: true,
    dynamicScope: dynamicScopeWithBase(ctx, baseUri),
  };
  const values: JsonValue[] = [];
  for (const authored of localAuthoredCandidates(schema, ctx.depth, ctx.limits.maxCandidates)) {
    appendCandidate(values, authored.value, ctx.limits.maxCandidates);
  }

  const referenceValues = await referenceCandidates(schema, localCtx);
  values.push(...referenceValues);

  const types = normalizedTypes(schema);
  for (const type of types) {
    if (type === 'object') values.push(...(await objectCandidates(schema, childContext(localCtx))));
    else if (type === 'array') values.push(...(await arrayCandidates(schema, childContext(localCtx))));
    else values.push(...primitiveCandidates(schema, type, localCtx));
  }
  if (types.length === 0 && referenceValues.length === 0) {
    values.push({}, [], '', 0, false, null);
  }
  const composed = await compositionCandidates(schema, uniqueCandidates(values, ctx.limits.maxCandidates), localCtx);
  const ignoredProperties = await directionalPropertyNames(schema, localCtx);
  if (ctx.budget.exhausted) return [];
  return uniqueCandidates(
    composed.map((candidate) => omitDirectionalProperties(candidate, ignoredProperties)),
    ctx.limits.maxCandidates,
  );
}

function keywordName(issue: EvaluationIssue): string {
  for (const value of [issue.keyword, issue.absoluteKeywordLocation]) {
    try {
      const url = new URL(value);
      const fragmentParts = url.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
      const fragmentName = fragmentParts[fragmentParts.length - 1];
      if (fragmentName) return decodeURIComponent(fragmentName).replace(/~1/g, '/').replace(/~0/g, '~');
      const pathParts = url.pathname.split('/').filter(Boolean);
      const pathName = pathParts[pathParts.length - 1];
      if (pathName) return decodeURIComponent(pathName);
    } catch {
      const parts = value.split(/[/#]/).filter(Boolean);
      const name = parts[parts.length - 1];
      if (name) return name;
    }
  }
  return 'schema';
}

function collectLeafIssues(
  issues: readonly EvaluationIssue[],
  maxIssues = 8,
): {
  issues: SchemaExampleIssue[];
  totalIssues: number;
} {
  const collected: SchemaExampleIssue[] = [];
  const seen = new Set<string>();
  const visit = (issue: EvaluationIssue): void => {
    const nested = issue.errors?.filter((candidate) => candidate.valid === false) ?? [];
    if (nested.length > 0) {
      nested.forEach(visit);
      return;
    }
    if (issue.valid !== false) return;
    const normalized = {
      instanceLocation: issue.instanceLocation,
      keyword: keywordName(issue),
      absoluteKeywordLocation: issue.absoluteKeywordLocation,
    };
    const key = `${normalized.instanceLocation}\u0000${normalized.keyword}\u0000${normalized.absoluteKeywordLocation}`;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(normalized);
  };
  issues.forEach(visit);
  return { issues: collected.slice(0, Math.max(1, maxIssues)), totalIssues: collected.length };
}

function unavailableMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Schema evaluation is unavailable.';
}

function isRecoverableResolutionFailure(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'SCHEMA_RESOLUTION_FAILED'
  );
}

async function evaluateCandidate(
  session: SchemaDocumentSession,
  reference: string,
  value: JsonValue,
  signal?: AbortSignal,
): Promise<EvaluationResult> {
  try {
    return await session.evaluate(reference, value, { signal });
  } catch (error) {
    if (!isRecoverableResolutionFailure(error)) throw error;
    // Hyperjump can retain a one-call stale browser cursor when an anchor was
    // resolved immediately before compiling its containing resource. The
    // failed compiled promise is evicted by SchemaEngine, so one same-input
    // retry is deterministic and does not broaden resource loading.
    throwIfAborted(signal);
    return session.evaluate(reference, value, { signal });
  }
}

async function evaluateGeneratedCandidate(
  session: SchemaDocumentSession,
  reference: string,
  value: JsonValue,
  direction: SchemaExampleDirection,
  signal?: AbortSignal,
): Promise<EvaluationResult> {
  try {
    return await evaluateSchemaDocumentDirectionally(session, reference, value, direction, { signal });
  } catch (error) {
    if (!isRecoverableResolutionFailure(error)) throw error;
    throwIfAborted(signal);
    return evaluateSchemaDocumentDirectionally(session, reference, value, direction, { signal });
  }
}

async function evaluateAuthoredCandidate(
  session: SchemaDocumentSession,
  reference: string,
  candidate: { source: SchemaExampleSource; value: JsonValue },
  signal?: AbortSignal,
): Promise<SchemaExampleResult> {
  try {
    const evaluation = await evaluateCandidate(session, reference, candidate.value, signal);
    if (evaluation.valid) {
      return {
        status: 'value',
        value: cloneValue(candidate.value),
        source: candidate.source,
        authored: true,
        validation: 'valid',
        diagnostics: [],
      };
    }
    const issues = collectLeafIssues(evaluation.errors);
    return {
      status: 'value',
      value: cloneValue(candidate.value),
      source: candidate.source,
      authored: true,
      validation: 'invalid',
      diagnostics: [
        {
          code: 'EXPLICIT_VALUE_INVALID',
          issues: issues.issues,
          totalIssues: issues.totalIssues,
        },
      ],
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return {
      status: 'value',
      value: cloneValue(candidate.value),
      source: candidate.source,
      authored: true,
      validation: 'unavailable',
      diagnostics: [{ code: 'EVALUATION_UNAVAILABLE', message: unavailableMessage(error) }],
    };
  }
}

export async function generateSchemaExample(
  session: SchemaDocumentSession,
  reference: string,
  options: GenerateSchemaExampleOptions,
): Promise<SchemaExampleResult> {
  throwIfAborted(options.signal);
  const limits = effectiveLimits(options.limits);
  const budget: SearchBudget = { nodes: 0, references: 0, exhausted: false };
  const resolvedNodes = new Map<string, Promise<SchemaNode>>();
  const directionalAnnotations = new Map<string, boolean>();
  const directionalProperties = new Map<string, ReadonlySet<string>>();
  const schemaObjectIds = new WeakMap<object, number>();
  const schemaObjectSequence = { value: 0 };
  const dynamicAnchorsByResource = new Map<string, Readonly<Record<string, string>>>();
  let root: SchemaNode;
  try {
    root = await session.resolve(reference);
    throwIfAborted(options.signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    const explicit = options.explicit?.[0];
    if (explicit) {
      return {
        status: 'value',
        value: cloneValue(explicit.value),
        source: explicit.source,
        authored: true,
        validation: 'unavailable',
        diagnostics: [{ code: 'SCHEMA_UNAVAILABLE', message: unavailableMessage(error) }],
      };
    }
    return {
      status: 'none',
      reason: 'schema-unavailable',
      diagnostics: [{ code: 'SCHEMA_UNAVAILABLE', message: unavailableMessage(error) }],
    };
  }

  const ctx: SearchContext = {
    session,
    direction: options.direction,
    limits,
    budget,
    baseUri: root.resourceUri,
    baseAlreadyIncludesOwnId: true,
    depth: 0,
    referenceChain: new Set([root.requestedUri, root.canonicalUri]),
    dynamicScope: [root.resourceUri],
    signal: options.signal,
    resolvedNodes,
    directionalAnnotations,
    directionalProperties,
    schemaObjectIds,
    schemaObjectSequence,
    dynamicAnchorsByResource,
  };
  dynamicAnchorsByResource.set(root.resourceUri, root.dynamicAnchors);
  const explicit = options.explicit?.[0];
  // Hyperjump canonicalizes a resource root with an empty fragment. Reusing
  // that empty-fragment browser after resolving an anchor can produce an
  // invalid cursor, while the equivalent fragmentless resource URI remains
  // stable. Non-empty JSON Pointer and anchor fragments are preserved.
  const evaluationReference = evaluationReferenceFor(root);
  if (explicit) return evaluateAuthoredCandidate(session, evaluationReference, explicit, options.signal);

  const authored = (await collectRootAuthoredCandidates(root.schema, ctx))[0];
  if (authored) return evaluateAuthoredCandidate(session, evaluationReference, authored, options.signal);
  if (root.schema === false) {
    return {
      status: 'none',
      reason: 'false-schema',
      diagnostics: [{ code: 'NO_VALID_CANDIDATE' }],
    };
  }

  const candidates = await buildCandidates(root.schema, ctx);
  let evaluations = 0;
  for (const candidate of candidates) {
    throwIfAborted(options.signal);
    if (evaluations >= limits.maxEvaluations) {
      budget.exhausted = true;
      break;
    }
    evaluations += 1;
    try {
      const evaluation = await evaluateGeneratedCandidate(
        session,
        evaluationReference,
        candidate,
        options.direction,
        options.signal,
      );
      if (evaluation.valid) {
        return {
          status: 'value',
          value: cloneValue(candidate),
          source: 'generated',
          authored: false,
          validation: 'valid',
          diagnostics: [],
        };
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      return {
        status: 'none',
        reason: 'evaluation-unavailable',
        diagnostics: [{ code: 'EVALUATION_UNAVAILABLE', message: unavailableMessage(error) }],
      };
    }
  }

  if (budget.exhausted) {
    return {
      status: 'none',
      reason: 'search-budget-exceeded',
      diagnostics: [{ code: 'SEARCH_BUDGET_EXCEEDED' }],
    };
  }
  return {
    status: 'none',
    reason: 'no-valid-candidate',
    diagnostics: [{ code: 'NO_VALID_CANDIDATE' }],
  };
}

export function explicitSchemaExampleWithoutSchema(example: ExplicitSchemaExample): SchemaExampleResult {
  return {
    status: 'value',
    value: cloneValue(example.value),
    source: example.source,
    authored: true,
    validation: 'unavailable',
    diagnostics: [{ code: 'SCHEMA_UNAVAILABLE' }],
  };
}
