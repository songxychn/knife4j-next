import type { EvaluationIssue, EvaluationResult, JsonValue, SchemaNode } from 'knife4j-schema-engine';
import { toSchemaDocumentFailure } from './schemaDocumentSession';
import { evaluateSchemaDocumentDirectionally, type SchemaDocumentSession } from './schemaDocumentSession';
import { notifySelectedAuthoredExample } from './schemaExampleAuthored';

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
  | 'EXAMPLE_REFERENCE_UNAVAILABLE'
  | 'EVALUATION_UNAVAILABLE'
  | 'SCHEMA_UNAVAILABLE'
  | 'NO_VALID_CANDIDATE'
  | 'SEARCH_BUDGET_EXCEEDED';

export interface SchemaExampleDiagnostic {
  readonly code: SchemaExampleDiagnosticCode;
  readonly message?: string;
  readonly issues?: readonly SchemaExampleIssue[];
  readonly totalIssues?: number;
  readonly schemaIssues?: import('knife4j-schema-engine').SchemaEngineErrorDetails['schemaIssues'];
  readonly budget?: keyof SchemaExampleSearchLimits;
  readonly limit?: number;
  readonly actual?: number;
  readonly path?: string;
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
  readonly maxReferenceTargets?: number;
  readonly maxInstanceDepth?: number;
  readonly maxSearchChoices?: number;
  readonly maxOutputNodes?: number;
  readonly maxOutputBytes?: number;
  readonly maxConstructedNodes?: number;
  readonly maxDurationMs?: number;
}

export interface GenerateSchemaExampleOptions {
  readonly direction: SchemaExampleDirection;
  readonly explicit?: readonly ExplicitSchemaExample[];
  readonly signal?: AbortSignal;
  readonly limits?: SchemaExampleSearchLimits;
}

type EffectiveLimits = Required<SchemaExampleSearchLimits>;

interface AuthoredCandidate {
  readonly source: Exclude<SchemaExampleSource, 'generated' | 'media-example' | 'example-object'>;
  readonly value: JsonValue;
  readonly rank: number;
  readonly depth: number;
}

interface CollectedAuthoredCandidate extends AuthoredCandidate {
  readonly order: number;
}

interface AuthoredCandidateCollector {
  readonly limit: number;
  readonly candidates: CollectedAuthoredCandidate[];
  nextOrder: number;
}

interface SearchBudget {
  nodes: number;
  references: number;
  exhausted: boolean;
  constructedNodes: number;
  searchChoices: number;
  readonly started: number;
  readonly referenceTargets: Set<string>;
  diagnostic?: SchemaExampleDiagnostic;
}

interface SearchChoice {
  readonly key: string;
  readonly path: string;
  readonly selected: number;
  readonly count: number;
}
interface CandidateSearch {
  plan: ReadonlyMap<string, number>;
  choices: SearchChoice[];
}

interface SearchContext {
  readonly session: SchemaDocumentSession;
  readonly direction: SchemaExampleDirection;
  readonly limits: EffectiveLimits;
  readonly budget: SearchBudget;
  readonly baseUri: string;
  readonly baseAlreadyIncludesOwnId: boolean;
  readonly depth: number;
  readonly instanceDepth: number;
  readonly path: string;
  readonly choicePath: string;
  readonly search: CandidateSearch;
  readonly referenceVisits: ReadonlyMap<string, number>;
  readonly providedProperties?: ReadonlySet<string>;
  readonly excludedCandidates?: ReadonlySet<string>;
  readonly referenceChain: ReadonlySet<string>;
  readonly dynamicScope: readonly string[];
  readonly signal?: AbortSignal;
  readonly resolvedNodes: Map<string, Promise<SchemaNode>>;
  readonly directionalAnnotations: Map<string, boolean>;
  readonly directionalProperties: Map<string, ReadonlySet<string>>;
  readonly intersectionProperties: Map<string, ReadonlySet<string>>;
  readonly schemaObjectIds: WeakMap<object, number>;
  readonly schemaObjectSequence: { value: number };
  readonly dynamicAnchorsByResource: Map<string, Readonly<Record<string, string>>>;
}

export const DEFAULT_SCHEMA_EXAMPLE_LIMITS: Readonly<EffectiveLimits> = Object.freeze({
  // The initial attempt plus the 256 globally shared changes.
  maxCandidates: 257,
  maxDepth: 128,
  maxNodes: 50_000,
  maxReferences: 16_000,
  maxReferenceTargets: 4096,
  maxInstanceDepth: 32,
  maxSearchChoices: 256,
  maxEvaluations: 32,
  maxOutputNodes: 20_000,
  maxOutputBytes: 1_048_576,
  maxConstructedNodes: 200_000,
  maxStringLength: 4096,
  maxArrayLength: 64,
  maxDurationMs: 2000,
});
const DEFAULT_LIMITS = DEFAULT_SCHEMA_EXAMPLE_LIMITS;

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
  return Object.fromEntries(
    Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [
      key,
      positiveInteger(overrides?.[key as keyof SchemaExampleSearchLimits], fallback),
    ]),
  ) as unknown as EffectiveLimits;
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

function exceed(ctx: SearchContext, budget: keyof EffectiveLimits, actual: number): false {
  ctx.budget.exhausted = true;
  ctx.budget.diagnostic ??= {
    code: 'SEARCH_BUDGET_EXCEEDED',
    budget,
    limit: ctx.limits[budget],
    actual,
    path: ctx.path,
  };
  return false;
}

function checkpoint(ctx: SearchContext): boolean {
  throwIfAborted(ctx.signal);
  if (ctx.budget.exhausted) return false;
  const elapsed = performance.now() - ctx.budget.started;
  return elapsed > ctx.limits.maxDurationMs ? exceed(ctx, 'maxDurationMs', elapsed) : true;
}

function enterNode(ctx: SearchContext): boolean {
  if (!checkpoint(ctx)) return false;
  ctx.budget.nodes += 1;
  if (ctx.depth > ctx.limits.maxDepth) return exceed(ctx, 'maxDepth', ctx.depth);
  if (ctx.instanceDepth > ctx.limits.maxInstanceDepth) return exceed(ctx, 'maxInstanceDepth', ctx.instanceDepth);
  if (ctx.budget.nodes > ctx.limits.maxNodes) return exceed(ctx, 'maxNodes', ctx.budget.nodes);
  return true;
}

function childContext(ctx: SearchContext, baseUri = ctx.baseUri, key = 'child'): SearchContext {
  return {
    ...ctx,
    baseUri,
    baseAlreadyIncludesOwnId: false,
    depth: ctx.depth + 1,
    choicePath: `${ctx.choicePath}/${key}`,
  };
}

function instanceChild(ctx: SearchContext, key: string): SearchContext {
  const child = childContext(ctx, ctx.baseUri, key);
  return {
    ...child,
    excludedCandidates: undefined,
    providedProperties: undefined,
    instanceDepth: ctx.instanceDepth + 1,
    path: `${ctx.path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
  };
}

function selectIndex(ctx: SearchContext, key: string, count: number): number {
  const choiceKey = `${ctx.choicePath}/${key}`;
  const selected = ctx.search.plan.get(choiceKey) ?? 0;
  if (count > 1) ctx.search.choices.push({ key: choiceKey, path: ctx.path, selected, count });
  return selected < count ? selected : -1;
}

function resolvedContext(ctx: SearchContext, node: SchemaNode, referenceUri: string): SearchContext {
  ctx.dynamicAnchorsByResource.set(node.resourceUri, node.dynamicAnchors);
  return {
    ...ctx,
    baseUri: node.resourceUri,
    baseAlreadyIncludesOwnId: true,
    depth: ctx.depth + 1,
    choicePath: `${ctx.choicePath}/ref:${node.canonicalUri}`,
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

/** Compact JSON string bytes, including escaping and well-formed lone surrogates. */
function quotedStringBytes(value: string): number {
  let bytes = 2;
  for (let offset = 0; offset < value.length; offset += 1) {
    const point = value.codePointAt(offset)!;
    if (point > 0xffff) {
      bytes += 4;
      offset += 1;
    } else if (point === 0x22 || point === 0x5c) bytes += 2;
    else if (point < 0x20) bytes += [0x08, 0x09, 0x0a, 0x0c, 0x0d].includes(point) ? 2 : 6;
    else if (point >= 0xd800 && point <= 0xdfff) bytes += 6;
    else bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : 3;
  }
  return bytes;
}

function valueSize(
  value: JsonValue,
  ctx?: SearchContext,
): { nodes: number; bytes: number; depth: number; stringLength: number; arrayLength: number } {
  let nodes = 0;
  let bytes = 0;
  let depth = 0;
  let stringLength = 0;
  let arrayLength = 0;
  // Composite candidates can contain author-provided literal subtrees. Check
  // their partial size before cloning, without serializing the whole value.
  const enforceOutput = ctx !== undefined && value !== null && typeof value === 'object';
  const checkOutput = (): void => {
    if (!ctx || !enforceOutput) return;
    if (nodes > ctx.limits.maxOutputNodes) {
      exceed(ctx, 'maxOutputNodes', nodes);
      throw new SearchStopped();
    }
    if (bytes > ctx.limits.maxOutputBytes) {
      exceed(ctx, 'maxOutputBytes', bytes);
      throw new SearchStopped();
    }
  };
  const pending: Array<[JsonValue, number]> = [[value, 0]];
  while (pending.length > 0) {
    const [item, level] = pending.pop()!;
    nodes += 1;
    if (ctx && ctx.budget.constructedNodes + nodes > ctx.limits.maxConstructedNodes) {
      exceed(ctx, 'maxConstructedNodes', ctx.budget.constructedNodes + nodes);
      throw new SearchStopped();
    }
    if (ctx && nodes % 256 === 0 && !checkpoint(ctx)) throw new SearchStopped();
    depth = Math.max(depth, level);
    if (ctx && level + ctx.instanceDepth > ctx.limits.maxInstanceDepth) {
      exceed(ctx, 'maxInstanceDepth', level + ctx.instanceDepth);
      throw new SearchStopped();
    }
    if (typeof item === 'string') {
      let length = 0;
      for (let offset = 0; offset < item.length; offset += 1) {
        if (item.codePointAt(offset)! > 0xffff) offset += 1;
        length += 1;
        if (ctx && length > ctx.limits.maxStringLength) {
          exceed(ctx, 'maxStringLength', length);
          throw new SearchStopped();
        }
      }
      stringLength = Math.max(stringLength, length);
      bytes += quotedStringBytes(item);
    } else if (Array.isArray(item)) {
      arrayLength = Math.max(arrayLength, item.length);
      if (ctx && item.length > ctx.limits.maxArrayLength) {
        exceed(ctx, 'maxArrayLength', item.length);
        throw new SearchStopped();
      }
      bytes += 2 + Math.max(0, item.length - 1);
      for (const child of item) pending.push([child, level + 1]);
    } else if (isRecord(item)) {
      const entries = Object.entries(item);
      bytes += 2 + Math.max(0, entries.length - 1);
      for (const [name, child] of entries) {
        bytes += quotedStringBytes(name) + 1;
        checkOutput();
        pending.push([child, level + 1]);
      }
    } else bytes += JSON.stringify(item).length;
    checkOutput();
  }
  return { nodes, bytes, depth, stringLength, arrayLength };
}

/** Size of one assembled instance; construction/copy work has its own counter. */
class OutputAssembly {
  private nodes = 1;
  private bytes = 2;
  private readonly entries = new Map<string, { nodes: number; bytes: number }>();

  constructor(
    private readonly ctx: SearchContext,
    private readonly kind: 'object' | 'array',
  ) {
    this.check();
  }

  public add(key: string, value: JsonValue): void {
    const size = valueSize(value);
    const old = this.entries.get(key);
    const keyBytes = this.kind === 'object' ? quotedStringBytes(key) + 1 : 0;
    this.nodes += size.nodes - (old?.nodes ?? 0);
    this.bytes += size.bytes + keyBytes - (old?.bytes ?? 0) + (old ? 0 : this.entries.size > 0 ? 1 : 0);
    this.check();
    this.entries.set(key, { nodes: size.nodes, bytes: size.bytes + keyBytes });
  }

  public remove(key: string): void {
    const old = this.entries.get(key);
    if (!old) return;
    this.nodes -= old.nodes;
    this.bytes -= old.bytes + (this.entries.size > 1 ? 1 : 0);
    this.entries.delete(key);
  }

  private check(): void {
    if (this.nodes > this.ctx.limits.maxOutputNodes) {
      exceed(this.ctx, 'maxOutputNodes', this.nodes);
      throw new SearchStopped();
    }
    if (this.bytes > this.ctx.limits.maxOutputBytes) {
      exceed(this.ctx, 'maxOutputBytes', this.bytes);
      throw new SearchStopped();
    }
    if (!checkpoint(this.ctx)) throw new SearchStopped();
  }
}

function cloneValue<T extends JsonValue>(value: T, ctx?: SearchContext): T {
  if (ctx) {
    const size = valueSize(value, ctx);
    ctx.budget.constructedNodes += size.nodes;
    if (ctx.budget.constructedNodes > ctx.limits.maxConstructedNodes) {
      exceed(ctx, 'maxConstructedNodes', ctx.budget.constructedNodes);
      throw new SearchStopped();
    }
    if (!checkpoint(ctx)) throw new SearchStopped();
  }
  return structuredClone(value);
}
class SearchStopped extends Error {}

function candidateKey(value: JsonValue): string {
  return JSON.stringify(value);
}

function uniqueCandidates(values: readonly JsonValue[], limit: number, ctx?: SearchContext): JsonValue[] {
  const seen = new Set<string>();
  const result: JsonValue[] = [];
  for (const value of values) {
    const key = candidateKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneValue(value, ctx));
    if (result.length >= limit) break;
  }
  return result;
}

function appendCandidate(target: JsonValue[], value: unknown, limit: number, ctx?: SearchContext): void {
  if (target.length >= limit || !isJsonValue(value)) return;
  target.push(cloneValue(value, ctx));
}

function localAuthoredCandidates(
  schema: { [key: string]: JsonValue },
  depth: number,
  limit: number,
): AuthoredCandidate[] {
  const candidates: AuthoredCandidate[] = [];
  const append = (source: AuthoredCandidate['source'], value: unknown): void => {
    if (candidates.length >= limit || !isJsonValue(value)) return;
    candidates.push({ source, value, rank: AUTHOR_SOURCE_RANK[source], depth });
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

function compareAuthoredCandidates(left: CollectedAuthoredCandidate, right: CollectedAuthoredCandidate): number {
  return left.rank - right.rank || left.depth - right.depth || left.order - right.order;
}

function worstAuthoredCandidate(collector: AuthoredCandidateCollector): CollectedAuthoredCandidate | undefined {
  let worst: CollectedAuthoredCandidate | undefined;
  for (const candidate of collector.candidates) {
    if (worst === undefined || compareAuthoredCandidates(candidate, worst) > 0) worst = candidate;
  }
  return worst;
}

function authoredCandidateCanImprove(collector: AuthoredCandidateCollector, rank: number, depth: number): boolean {
  if (collector.candidates.length < collector.limit) return true;
  const worst = worstAuthoredCandidate(collector);
  return (
    worst !== undefined &&
    compareAuthoredCandidates(
      { source: 'schema-examples', value: null, rank, depth, order: collector.nextOrder },
      worst,
    ) < 0
  );
}

function collectLocalAuthoredCandidates(
  schema: { [key: string]: JsonValue },
  depth: number,
  collector: AuthoredCandidateCollector,
): void {
  const append = (source: AuthoredCandidate['source'], value: unknown): boolean => {
    const rank = AUTHOR_SOURCE_RANK[source];
    if (!authoredCandidateCanImprove(collector, rank, depth)) return false;
    if (!isJsonValue(value)) return true;
    const candidate: CollectedAuthoredCandidate = {
      source,
      value,
      rank,
      depth,
      order: collector.nextOrder,
    };
    collector.nextOrder += 1;
    if (collector.candidates.length < collector.limit) {
      collector.candidates.push(candidate);
      return true;
    }
    const worst = worstAuthoredCandidate(collector);
    if (worst !== undefined && compareAuthoredCandidates(candidate, worst) < 0) {
      collector.candidates[collector.candidates.indexOf(worst)] = candidate;
    }
    return true;
  };

  if (Array.isArray(schema.examples)) {
    for (const value of schema.examples) {
      if (!append('schema-examples', value)) return;
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'example') && !append('schema-example', schema.example)) return;
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && !append('const', schema.const)) return;
  if (Object.prototype.hasOwnProperty.call(schema, 'default') && !append('default', schema.default)) return;
  if (Array.isArray(schema.enum)) {
    for (const value of schema.enum) {
      if (!append('enum', value)) return;
    }
  }
}

async function resolveNode(
  reference: string,
  ctx: SearchContext,
  allowReferenceCycle = false,
): Promise<{ uri: string; node: SchemaNode } | null> {
  throwIfAborted(ctx.signal);
  const uri = resolvedReferenceUri(reference, ctx.baseUri);
  if (!uri || (!allowReferenceCycle && ctx.referenceChain.has(uri))) return null;
  ctx.budget.references += 1;
  if (ctx.budget.references > ctx.limits.maxReferences) {
    exceed(ctx, 'maxReferences', ctx.budget.references);
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
    ctx.budget.referenceTargets.add(node.canonicalUri);
    if (ctx.budget.referenceTargets.size > ctx.limits.maxReferenceTargets) {
      exceed(ctx, 'maxReferenceTargets', ctx.budget.referenceTargets.size);
      return null;
    }
    if (!allowReferenceCycle && ctx.referenceChain.has(node.canonicalUri)) return null;
    ctx.dynamicAnchorsByResource.set(node.resourceUri, node.dynamicAnchors);
    return { uri, node };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return null;
  }
}

async function ensureEmbeddedDynamicAnchors(
  schema: { [key: string]: JsonValue },
  ctx: SearchContext,
  baseUri: string,
): Promise<void> {
  if (ctx.baseAlreadyIncludesOwnId || typeof schema.$id !== 'string') return;
  const resource = resourceUri(baseUri);
  if (ctx.dynamicAnchorsByResource.has(resource)) return;
  await resolveNode(resource, ctx, true);
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
  allowReferenceCycle = false,
): Promise<{ uri: string; node: SchemaNode } | null> {
  const resolved = await resolveNode(reference, ctx, allowReferenceCycle);
  if (!resolved || !dynamic) return resolved;
  const anchor = referenceAnchor(resolved.uri);
  if (!anchor || !Object.prototype.hasOwnProperty.call(resolved.node.dynamicAnchors, anchor)) return resolved;

  for (const scopeResource of ctx.dynamicScope) {
    const overrideUri = ctx.dynamicAnchorsByResource.get(scopeResource)?.[anchor];
    if (!overrideUri || overrideUri === resolved.node.canonicalUri) continue;
    const override = await resolveNode(overrideUri, ctx, allowReferenceCycle);
    if (override) return override;
  }
  return resolved;
}

async function visitRootAuthoredCandidates(
  schema: JsonValue,
  ctx: SearchContext,
  collector: AuthoredCandidateCollector,
  depth = 0,
): Promise<void> {
  throwIfAborted(ctx.signal);
  if (
    !isRecord(schema) ||
    depth > ctx.limits.maxDepth ||
    !authoredCandidateCanImprove(collector, AUTHOR_SOURCE_RANK['schema-examples'], depth)
  ) {
    return;
  }
  collectLocalAuthoredCandidates(schema, depth, collector);
  if (!enterNode(ctx)) return;
  const baseUri = effectiveBaseUri(schema, ctx);
  await ensureEmbeddedDynamicAnchors(schema, ctx, baseUri);
  const localCtx = {
    ...ctx,
    baseUri,
    baseAlreadyIncludesOwnId: true,
    dynamicScope: dynamicScopeWithBase(ctx, baseUri),
  };
  const referenceKeyword =
    typeof schema.$ref === 'string' ? '$ref' : typeof schema.$dynamicRef === 'string' ? '$dynamicRef' : null;
  if (referenceKeyword && authoredCandidateCanImprove(collector, AUTHOR_SOURCE_RANK['schema-examples'], depth + 1)) {
    const reference = schema[referenceKeyword] as string;
    const resolved = await resolveSchemaReference(reference, localCtx, referenceKeyword === '$dynamicRef');
    if (resolved) {
      await visitRootAuthoredCandidates(
        resolved.node.schema,
        resolvedContext(localCtx, resolved.node, resolved.uri),
        collector,
        depth + 1,
      );
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      if (!authoredCandidateCanImprove(collector, AUTHOR_SOURCE_RANK['schema-examples'], depth + 1)) break;
      await visitRootAuthoredCandidates(branch, childContext(localCtx), collector, depth + 1);
    }
  }
}

async function collectRootAuthoredCandidates(schema: JsonValue, ctx: SearchContext): Promise<AuthoredCandidate[]> {
  const collector: AuthoredCandidateCollector = {
    limit: ctx.limits.maxCandidates,
    candidates: [],
    nextOrder: 0,
  };
  await visitRootAuthoredCandidates(schema, ctx, collector);
  return collector.candidates.sort(compareAuthoredCandidates).map((candidate) => ({
    source: candidate.source,
    value: candidate.value,
    rank: candidate.rank,
    depth: candidate.depth,
  }));
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
  const points = Array.from(value);
  if (points.length < min) points.push(...Array.from({ length: min - points.length }, () => 'a'));
  return points.slice(0, cappedMax).join('');
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
  if (
    minLength > ctx.limits.maxStringLength &&
    !(typeof schema.maxLength === 'number' && schema.maxLength < minLength)
  ) {
    exceed(ctx, 'maxStringLength', minLength);
    return [];
  }
  if (minLength <= ctx.limits.maxStringLength) rawSamples.push('a'.repeat(minLength), '0'.repeat(minLength));
  if (typeof schema.contentMediaType === 'string' && schema.contentMediaType.toLowerCase().includes('json')) {
    rawSamples.unshift('{}');
  }
  for (const sample of rawSamples) {
    const adjusted = adjustedString(sample, schema, ctx.limits.maxStringLength);
    if (adjusted !== null) appendCandidate(values, adjusted, ctx.limits.maxCandidates, ctx);
  }
  return uniqueCandidates(values, ctx.limits.maxCandidates, ctx);
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
    ctx,
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
  await ensureEmbeddedDynamicAnchors(schema, ctx, baseUri);
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
      const resolved = await resolveSchemaReference(reference, localCtx, keyword === '$dynamicRef', true);
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
  await ensureEmbeddedDynamicAnchors(schema, ctx, baseUri);
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
    const resolved = await resolveSchemaReference(reference, localCtx, keyword === '$dynamicRef', true);
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

/** Property declarations contributed by mandatory intersections at this instance location. */
async function intersectionPropertyNames(
  schema: JsonValue,
  ctx: SearchContext,
  active: ReadonlySet<string> = new Set(),
): Promise<ReadonlySet<string>> {
  if (!isRecord(schema)) return new Set();
  const baseUri = effectiveBaseUri(schema, ctx);
  await ensureEmbeddedDynamicAnchors(schema, ctx, baseUri);
  const localCtx = {
    ...ctx,
    baseUri,
    baseAlreadyIncludesOwnId: true,
    dynamicScope: dynamicScopeWithBase(ctx, baseUri),
  };
  const key = directionalSchemaAnalysisKey(schema, localCtx);
  const cached = ctx.intersectionProperties.get(key);
  if (cached) return cached;
  if (active.has(key) || !enterNode(ctx)) return new Set();
  const nextActive = new Set(active).add(key);
  const names = new Set(Object.keys(isRecord(schema.properties) ? schema.properties : {}));
  for (const [keyword, reference] of [
    ['$ref', schema.$ref],
    ['$dynamicRef', schema.$dynamicRef],
    ['$recursiveRef', schema.$recursiveRef],
  ] as const) {
    if (typeof reference !== 'string') continue;
    const resolved = await resolveSchemaReference(reference, localCtx, keyword === '$dynamicRef', true);
    if (!resolved) continue;
    const contributed = await intersectionPropertyNames(
      resolved.node.schema,
      resolvedContext(localCtx, resolved.node, resolved.uri),
      nextActive,
    );
    contributed.forEach((name) => names.add(name));
    if (ctx.budget.exhausted) return new Set();
  }
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      const contributed = await intersectionPropertyNames(branch, childContext(localCtx), nextActive);
      contributed.forEach((name) => names.add(name));
      if (ctx.budget.exhausted) return new Set();
    }
  }
  ctx.intersectionProperties.set(key, names);
  return names;
}

function mergeObjects(left: JsonValue, right: JsonValue, ctx?: SearchContext): JsonValue | null {
  if (!isRecord(left) || !isRecord(right)) return null;
  if (ctx) {
    const output = new OutputAssembly(ctx, 'object');
    // Right-hand values replace existing members. Count the final member once,
    // before allocating either copied object or the merged object.
    for (const [name, value] of Object.entries(left)) {
      if (!Object.prototype.hasOwnProperty.call(right, name)) output.add(name, value);
    }
    for (const [name, value] of Object.entries(right)) output.add(name, value);
  }
  return { ...cloneValue(left, ctx), ...cloneValue(right, ctx) };
}

function combineIntersection(
  left: readonly JsonValue[],
  right: readonly JsonValue[],
  limit: number,
  ctx?: SearchContext,
): JsonValue[] {
  if (left.length === 0) return uniqueCandidates(right, limit, ctx);
  if (right.length === 0) return uniqueCandidates(left, limit, ctx);
  const values: JsonValue[] = [];
  for (const leftValue of left) {
    for (const rightValue of right) {
      const merged = mergeObjects(leftValue, rightValue, ctx);
      if (merged !== null) appendCandidate(values, merged, limit, ctx);
      if (candidateKey(leftValue) === candidateKey(rightValue)) appendCandidate(values, leftValue, limit, ctx);
      if (values.length >= limit) return uniqueCandidates(values, limit, ctx);
    }
  }
  values.push(...left, ...right);
  return uniqueCandidates(values, limit, ctx);
}

function overlayBaseCandidates(
  base: readonly JsonValue[],
  branches: readonly JsonValue[],
  limit: number,
  ctx?: SearchContext,
): JsonValue[] {
  const values: JsonValue[] = [];
  for (const branch of branches) {
    let mergedAny = false;
    for (const baseValue of base) {
      const merged = mergeObjects(baseValue, branch, ctx);
      if (merged !== null) {
        appendCandidate(values, merged, limit, ctx);
        mergedAny = true;
      }
    }
    if (!mergedAny) appendCandidate(values, branch, limit, ctx);
  }
  values.push(...base);
  return uniqueCandidates(values, limit, ctx);
}

async function objectCandidates(schema: { [key: string]: JsonValue }, ctx: SearchContext): Promise<JsonValue[]> {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const ignored = new Set<string>();
  const annotations = new Map<string, boolean>();
  const ignoreProperty = async (name: string): Promise<boolean> => {
    const known = annotations.get(name);
    if (known !== undefined) return known;
    const property = Object.prototype.hasOwnProperty.call(properties, name) ? properties[name] : true;
    const result = await shouldIgnoreProperty(property, childContext(ctx, ctx.baseUri, `annotation:${name}`));
    annotations.set(name, result);
    if (result) ignored.add(name);
    return result;
  };
  const output = new OutputAssembly(ctx, 'object');
  const required = new Set(
    (Array.isArray(schema.required) ? schema.required : []).filter(
      (name): name is string =>
        typeof name === 'string' &&
        !ignored.has(name) &&
        !(ctx.providedProperties?.has(name) && !Object.prototype.hasOwnProperty.call(properties, name)),
    ),
  );
  const dependencies = isRecord(schema.dependentRequired) ? schema.dependentRequired : {};
  const max = typeof schema.maxProperties === 'number' ? Math.max(0, Math.floor(schema.maxProperties)) : Infinity;
  const min = typeof schema.minProperties === 'number' ? Math.max(0, Math.floor(schema.minProperties)) : 0;
  // Only this exact, presence-only form is safe to use before full validation.
  const forbidden =
    isRecord(schema.not) && Object.keys(schema.not).length === 1 && Array.isArray(schema.not.required)
      ? schema.not.required.filter((name): name is string => typeof name === 'string')
      : null;
  const selected = new Set<string>();
  const blocked = new Set<string>();
  const values = new Map<string, JsonValue>();
  const propertySchema = (name: string): JsonValue =>
    Object.prototype.hasOwnProperty.call(properties, name)
      ? properties[name]
      : schema.additionalProperties === undefined
        ? true
        : schema.additionalProperties;
  const addClosure = async (name: string, added: string[]): Promise<boolean> => {
    const pending = [name];
    while (pending.length > 0) {
      if (!checkpoint(ctx)) return false;
      const next = pending.pop()!;
      if (selected.has(next) || (await ignoreProperty(next))) continue;
      // A sibling intersection supplies this field, including dependencies
      // reached from a local required field. Do not overwrite it with true.
      if (ctx.providedProperties?.has(next) && !Object.prototype.hasOwnProperty.call(properties, next)) continue;
      if (blocked.has(next) || propertySchema(next) === false) return false;
      selected.add(next);
      added.push(next);
      if (selected.size > ctx.limits.maxOutputNodes) return exceed(ctx, 'maxOutputNodes', selected.size + 1);
      if (selected.size > max || (forbidden !== null && forbidden.every((key) => selected.has(key)))) return false;
      for (const dependency of Array.isArray(dependencies[next]) ? dependencies[next] : []) {
        if (typeof dependency === 'string') pending.push(dependency);
      }
    }
    return true;
  };
  for (const name of required) {
    const added: string[] = [];
    if (!(await addClosure(name, added))) return [];
    for (const key of added) {
      const [value] = await buildCandidates(propertySchema(key), instanceChild(ctx, key));
      if (value === undefined) return [];
      output.add(key, value);
      values.set(key, value);
    }
  }
  const mandatory = new Set(selected);
  const optional = Object.keys(properties).filter((name) => !ignored.has(name) && !mandatory.has(name));
  // The full DTO is preferred. A minimal choice remains available when a
  // cross-field constraint can only be discovered by the complete validator.
  const minimal = forbidden !== null || selectIndex(ctx, 'object-selection', optional.length > 0 ? 2 : 1) === 1;
  const tryOptional = async (name: string): Promise<void> => {
    if (selected.has(name)) return;
    const added: string[] = [];
    if (!(await addClosure(name, added))) {
      added.forEach((key) => selected.delete(key));
      return;
    }
    for (const key of added) {
      let value = values.get(key);
      if (value === undefined) {
        [value] = await buildCandidates(propertySchema(key), instanceChild(ctx, key));
        if (value !== undefined) values.set(key, value);
      }
      if (value === undefined) {
        blocked.add(key);
        added.forEach((addedKey) => {
          selected.delete(addedKey);
          output.remove(addedKey);
        });
        return;
      }
      output.add(key, value);
    }
  };
  for (const name of optional) {
    if (minimal && selected.size >= min) break;
    await tryOptional(name);
    if (ctx.budget.exhausted) return [];
  }
  // Additional properties may be needed even after an optional recursive
  // field has terminated. Never replace an existing required field.
  for (let index = 1; selected.size < min && selected.size < max; index += 1) {
    if (schema.additionalProperties === false) return [];
    const name = `property${index}`;
    if (selected.has(name) || Object.prototype.hasOwnProperty.call(properties, name)) continue;
    const before = selected.size;
    await tryOptional(name);
    if (selected.size === before) return [];
    if (selected.size > ctx.limits.maxOutputNodes) {
      exceed(ctx, 'maxOutputNodes', selected.size + 1);
      return [];
    }
  }
  if (selected.size < min) return [];
  const value: { [key: string]: JsonValue } = Object.create(null);
  for (const name of selected) {
    const item = values.get(name);
    if (item === undefined) return [];
    value[name] = item;
  }
  return [value];
}

async function arrayCandidates(schema: { [key: string]: JsonValue }, ctx: SearchContext): Promise<JsonValue[]> {
  const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
  const min = typeof schema.minItems === 'number' ? Math.max(0, Math.floor(schema.minItems)) : 0;
  const max =
    typeof schema.maxItems === 'number'
      ? Math.min(ctx.limits.maxArrayLength, Math.max(0, Math.floor(schema.maxItems)))
      : ctx.limits.maxArrayLength;
  if (min > max) {
    if (min > ctx.limits.maxArrayLength) exceed(ctx, 'maxArrayLength', min);
    return [];
  }
  const item = schema.items === undefined ? true : schema.items;
  const strategies: Array<'tuple' | 'filled' | 'contains' | 'empty'> = [];
  if (Math.min(prefix.length, max) >= min) strategies.push('tuple');
  if (item !== false) strategies.push('filled');
  if (schema.contains !== undefined) strategies.push('contains');
  if (min === 0) strategies.push('empty');
  const selected = selectIndex(ctx, 'array-strategy', strategies.length);
  if (selected < 0) return [];
  const strategy = strategies[selected];
  if (strategy === 'empty') return [[]];
  const value: JsonValue[] = [];
  const output = new OutputAssembly(ctx, 'array');
  const seen = new Set<string>();
  const append = async (itemSchema: JsonValue): Promise<boolean> => {
    const child = instanceChild(ctx, String(value.length));
    const [itemValue] = await buildCandidates(
      itemSchema,
      schema.uniqueItems === true ? { ...child, excludedCandidates: seen } : child,
    );
    if (itemValue === undefined) return false;
    output.add(String(value.length), itemValue);
    value.push(itemValue);
    seen.add(candidateKey(itemValue));
    return true;
  };
  const minContains = typeof schema.minContains === 'number' ? Math.max(0, Math.floor(schema.minContains)) : 1;
  const containsCount = strategy === 'contains' ? Math.max(1, minContains) : 0;
  if (containsCount > max) return [];
  const prefixCount = Math.min(prefix.length, max - containsCount);
  for (let index = 0; index < prefixCount; index += 1) if (!(await append(prefix[index]))) return [];
  for (let index = 0; index < containsCount; index += 1) if (!(await append(schema.contains))) return [];
  const target = strategy === 'tuple' ? prefixCount : Math.max(min, prefixCount + containsCount);
  while (value.length < target) {
    if (item === false || !(await append(item))) return [];
  }
  return value.length >= min ? [value] : [];
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
  const resolved = await resolveSchemaReference(reference, ctx, keyword === '$dynamicRef', true);
  if (!resolved) return [];
  const visits = ctx.referenceVisits.get(resolved.node.canonicalUri) ?? 0;
  if (visits >= 2) {
    // A third non-terminal instance of this target is not expanded. These
    // terminal values remain subject to the complete root validation.
    const target = resolved.node.schema;
    if (isRecord(target)) {
      const types = normalizedTypes(target);
      if (types.includes('null')) return [null];
      if (
        types.includes('array') &&
        !(typeof target.minItems === 'number' && target.minItems > 0) &&
        target.contains === undefined
      )
        return [[]];
    }
    return [];
  }
  const referenceVisits = new Map(ctx.referenceVisits).set(resolved.node.canonicalUri, visits + 1);
  const targetCandidates = await buildCandidates(resolved.node.schema, {
    ...resolvedContext(ctx, resolved.node, resolved.uri),
    referenceVisits,
  });
  const siblingSchema = Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== '$ref' && key !== '$dynamicRef' && key !== '$recursiveRef'),
  ) as { [key: string]: JsonValue };
  if (!Object.keys(siblingSchema).some((key) => ASSERTION_KEYS.has(key))) return targetCandidates;
  const siblingCandidates = await buildCandidates(siblingSchema, { ...ctx, depth: ctx.depth + 1 });
  return combineIntersection(targetCandidates, siblingCandidates, ctx.limits.maxCandidates, ctx);
}

async function compositionCandidates(
  schema: { [key: string]: JsonValue },
  base: readonly JsonValue[],
  ctx: SearchContext,
): Promise<JsonValue[]> {
  let values = uniqueCandidates(base, ctx.limits.maxCandidates, ctx);
  const choose = (candidates: JsonValue[], key: string): JsonValue[] => {
    const index = selectIndex(ctx, key, candidates.length);
    return index < 0 ? [] : [candidates[index]];
  };
  const providedProperties = new Set([
    ...(ctx.providedProperties ?? []),
    ...Object.keys(isRecord(schema.properties) ? schema.properties : {}),
  ]);
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      const names = await intersectionPropertyNames(branch, childContext(ctx));
      names.forEach((name) => providedProperties.add(name));
      if (ctx.budget.exhausted) return [];
    }
  }
  const compositionChild = (key: string): SearchContext => ({
    ...childContext(ctx, ctx.baseUri, key),
    providedProperties,
  });
  if (Array.isArray(schema.allOf)) {
    for (const [index, branch] of schema.allOf.entries()) {
      const branchValues = await buildCandidates(branch, compositionChild(`allOf:${index}`));
      values = choose(
        combineIntersection(values, branchValues, ctx.limits.maxCandidates, ctx),
        `intersection:${index}`,
      );
      if (ctx.budget.exhausted) return [];
    }
  }
  for (const keyword of ['oneOf', 'anyOf'] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    const index = selectIndex(ctx, keyword, branches.length);
    if (index < 0) return [];
    const branchValues = await buildCandidates(branches[index], compositionChild(`${keyword}:${index}`));
    if (branches[index] === false) return [];
    values = choose(overlayBaseCandidates(values, branchValues, ctx.limits.maxCandidates, ctx), `overlay:${keyword}`);
  }
  const conditionals = ['then', 'else'].filter((keyword) => schema[keyword] !== undefined);
  if (conditionals.length > 0) {
    const index = selectIndex(ctx, 'conditional', conditionals.length + 1);
    const keyword = conditionals[index];
    if (keyword) {
      const branchValues = await buildCandidates(schema[keyword], compositionChild(keyword));
      values = choose(
        overlayBaseCandidates(values, branchValues, ctx.limits.maxCandidates, ctx),
        'overlay:conditional',
      );
    }
  }
  if (isRecord(schema.dependentSchemas)) {
    for (const [name, branch] of Object.entries(schema.dependentSchemas)) {
      const branchValues = await buildCandidates(branch, compositionChild(`dependent:${name}`));
      values = choose(
        overlayBaseCandidates(values, branchValues, ctx.limits.maxCandidates, ctx),
        `overlay:dependent:${name}`,
      );
    }
  }
  return uniqueCandidates(values, ctx.limits.maxCandidates, ctx);
}

// Cheap local filters improve the first complete DTO without accepting an
// instance. References, composition and cross-field semantics are always
// checked against the original complete Schema before returning a value.
function primitiveSatisfiesLocal(schema: { [key: string]: JsonValue }, value: JsonValue): boolean {
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (typeof schema.minLength === 'number' && length < schema.minLength) return false;
    if (typeof schema.maxLength === 'number' && length > schema.maxLength) return false;
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern, 'u').test(value)) return false;
      } catch {
        /* The real validator diagnoses this. */
      }
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false;
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false;
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return false;
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) return false;
    if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
      const quotient = value / schema.multipleOf;
      if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * Math.max(1, Math.abs(quotient)) * 4)
        return false;
    }
  }
  return true;
}

async function buildCandidates(schema: JsonValue, ctx: SearchContext): Promise<JsonValue[]> {
  if (!enterNode(ctx)) return [];
  if (schema === false) return [];
  if (schema === true) {
    const values: JsonValue[] = [{}, [], '', 0, false, null];
    const index = selectIndex(ctx, 'unconstrained', Math.min(values.length, ctx.limits.maxCandidates));
    return index < 0 ? [] : [cloneValue(values[index], ctx)];
  }
  if (!isRecord(schema)) return [];
  if (Array.isArray(schema.allOf) && schema.allOf.some((branch) => branch === false)) return [];

  const baseUri = effectiveBaseUri(schema, ctx);
  await ensureEmbeddedDynamicAnchors(schema, ctx, baseUri);
  const localCtx = {
    ...ctx,
    baseUri,
    baseAlreadyIncludesOwnId: true,
    dynamicScope: dynamicScopeWithBase(ctx, baseUri),
  };
  const values: JsonValue[] = [];
  for (const authored of localAuthoredCandidates(schema, ctx.depth, ctx.limits.maxCandidates)) {
    appendCandidate(values, authored.value, ctx.limits.maxCandidates, ctx);
  }

  const referenceValues = await referenceCandidates(schema, localCtx);
  values.push(...referenceValues);

  const types = normalizedTypes(schema);
  for (const type of types) {
    if (type === 'object')
      values.push(...(await objectCandidates(schema, childContext(localCtx, localCtx.baseUri, 'object'))));
    else if (type === 'array')
      values.push(...(await arrayCandidates(schema, childContext(localCtx, localCtx.baseUri, 'array'))));
    else
      values.push(
        ...primitiveCandidates(schema, type, localCtx).filter((value) => primitiveSatisfiesLocal(schema, value)),
      );
  }
  if (
    types.length === 0 &&
    referenceValues.length === 0 &&
    typeof schema.$ref !== 'string' &&
    typeof schema.$dynamicRef !== 'string' &&
    typeof schema.$recursiveRef !== 'string'
  ) {
    // A type-less intersection member can constrain a string supplied by a
    // sibling. Keep the generic strategy first and only construct string hints
    // when selected; these hints do not exclude valid non-string instances.
    const hasStringConstraints =
      typeof schema.minLength === 'number' ||
      typeof schema.maxLength === 'number' ||
      typeof schema.pattern === 'string';
    const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0;
    const useStringHints =
      hasStringConstraints &&
      minLength <= ctx.limits.maxStringLength &&
      selectIndex(localCtx, 'untyped-string', 2) === 1;
    if (useStringHints)
      values.push(...stringCandidates(schema, localCtx).filter((value) => primitiveSatisfiesLocal(schema, value)));
    else values.push({}, [], '', 0, false, null);
  }
  const composed = await compositionCandidates(
    schema,
    uniqueCandidates(values, ctx.limits.maxCandidates, ctx),
    localCtx,
  );
  // A leaf cannot contribute object property names. Its own readOnly/writeOnly
  // annotations are still checked by the parent in shouldIgnoreProperty.
  const hasDirectionalChildren =
    isRecord(schema.properties) ||
    typeof schema.$ref === 'string' ||
    typeof schema.$dynamicRef === 'string' ||
    typeof schema.$recursiveRef === 'string' ||
    Array.isArray(schema.allOf);
  const ignoredProperties = hasDirectionalChildren
    ? await directionalPropertyNames(schema, localCtx)
    : new Set<string>();
  if (ctx.budget.exhausted) return [];
  const candidates = uniqueCandidates(
    composed
      .map((candidate) => omitDirectionalProperties(candidate, ignoredProperties))
      .filter((candidate) => !ctx.excludedCandidates?.has(candidateKey(candidate))),
    ctx.limits.maxCandidates,
    ctx,
  );
  const index = selectIndex(localCtx, 'candidate', candidates.length);
  return index < 0 ? [] : [candidates[index]];
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

function unavailableDiagnostic(
  code: 'EVALUATION_UNAVAILABLE' | 'SCHEMA_UNAVAILABLE',
  error: unknown,
): SchemaExampleDiagnostic {
  const { schemaIssues } = toSchemaDocumentFailure(error).details;
  return { code, message: unavailableMessage(error), ...(schemaIssues ? { schemaIssues } : {}) };
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
      diagnostics: [unavailableDiagnostic('EVALUATION_UNAVAILABLE', error)],
    };
  }
}

export async function generateSchemaExample(
  session: SchemaDocumentSession,
  reference: string,
  options: GenerateSchemaExampleOptions,
): Promise<SchemaExampleResult> {
  if (session.generateExample) return session.generateExample(reference, options);
  throwIfAborted(options.signal);
  const limits = effectiveLimits(options.limits);
  const budget: SearchBudget = {
    nodes: 0,
    references: 0,
    constructedNodes: 0,
    searchChoices: 0,
    exhausted: false,
    started: performance.now(),
    referenceTargets: new Set(),
  };
  const search: CandidateSearch = { plan: new Map(), choices: [] };
  const resolvedNodes = new Map<string, Promise<SchemaNode>>();
  const directionalAnnotations = new Map<string, boolean>();
  const directionalProperties = new Map<string, ReadonlySet<string>>();
  const intersectionProperties = new Map<string, ReadonlySet<string>>();
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
        diagnostics: [unavailableDiagnostic('SCHEMA_UNAVAILABLE', error)],
      };
    }
    return {
      status: 'none',
      reason: 'schema-unavailable',
      diagnostics: [unavailableDiagnostic('SCHEMA_UNAVAILABLE', error)],
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
    instanceDepth: 0,
    path: '',
    choicePath: '',
    search,
    referenceVisits: new Map([[root.canonicalUri, 1]]),
    referenceChain: new Set([root.requestedUri, root.canonicalUri]),
    dynamicScope: [root.resourceUri],
    signal: options.signal,
    resolvedNodes,
    directionalAnnotations,
    directionalProperties,
    intersectionProperties,
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
  if (authored) {
    notifySelectedAuthoredExample(session, authored);
    return evaluateAuthoredCandidate(session, evaluationReference, authored, options.signal);
  }
  if (root.schema === false) {
    return {
      status: 'none',
      reason: 'false-schema',
      diagnostics: [{ code: 'NO_VALID_CANDIDATE' }],
    };
  }

  const plans: ReadonlyMap<string, number>[] = [new Map()];
  const queued = new Set<string>(['[]']);
  const seenCandidates = new Set<string>();
  let evaluations = 0;
  let attempts = 0;
  while (plans.length > 0 && !budget.exhausted) {
    if (attempts > 0 && budget.searchChoices >= limits.maxSearchChoices) {
      exceed(ctx, 'maxSearchChoices', budget.searchChoices + 1);
      break;
    }
    if (attempts >= limits.maxCandidates) {
      exceed(ctx, 'maxCandidates', attempts + 1);
      break;
    }
    attempts += 1;
    if (attempts > 1) {
      budget.searchChoices += 1;
      if (budget.searchChoices > limits.maxSearchChoices) {
        exceed(ctx, 'maxSearchChoices', budget.searchChoices);
        break;
      }
    }
    search.plan = plans.shift()!;
    search.choices = [];
    let candidates: JsonValue[];
    try {
      candidates = await buildCandidates(root.schema, ctx);
    } catch (error) {
      if (error instanceof SearchStopped) break;
      throw error;
    }
    let issues: readonly EvaluationIssue[] = [];
    for (const candidate of candidates) {
      if (!checkpoint(ctx)) break;
      const size = valueSize(candidate);
      const checks: Array<[keyof EffectiveLimits, number]> = [
        ['maxOutputNodes', size.nodes],
        ['maxOutputBytes', size.bytes],
        ['maxInstanceDepth', size.depth],
        ['maxStringLength', size.stringLength],
        ['maxArrayLength', size.arrayLength],
      ];
      for (const [name, actual] of checks)
        if (actual > limits[name]) {
          exceed(ctx, name, actual);
          break;
        }
      if (budget.exhausted) break;
      const key = candidateKey(candidate);
      if (seenCandidates.has(key)) continue;
      seenCandidates.add(key);
      if (evaluations >= limits.maxEvaluations) {
        exceed(ctx, 'maxEvaluations', evaluations + 1);
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
        if (!checkpoint(ctx)) break;
        if (evaluation.valid)
          return {
            status: 'value',
            value: candidate,
            source: 'generated',
            authored: false,
            validation: 'valid',
            diagnostics: [],
          };
        issues = evaluation.errors;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        return {
          status: 'none',
          reason: 'evaluation-unavailable',
          diagnostics: [unavailableDiagnostic('EVALUATION_UNAVAILABLE', error)],
        };
      }
    }
    if (budget.exhausted) break;
    // Prefer alternatives at failing instance locations, then visit choices in
    // document order. No subtree receives a fresh counter or candidate budget.
    const paths = collectLeafIssues(issues, 256)
      .issues.map((issue) => issue.instanceLocation)
      .filter(Boolean);
    const choices = [...search.choices].sort((left, right) => {
      const matches = (choice: SearchChoice) =>
        paths.some((path) => path === choice.path || path.startsWith(`${choice.path}/`));
      return Number(matches(right)) - Number(matches(left));
    });
    for (const choice of choices) {
      if (choice.selected + 1 >= choice.count) continue;
      const plan = new Map(search.plan).set(choice.key, choice.selected + 1);
      const key = JSON.stringify([...plan].sort(([left], [right]) => left.localeCompare(right)));
      if (queued.has(key)) continue;
      if (plans.length >= limits.maxSearchChoices) break;
      queued.add(key);
      plans.push(plan);
    }
  }

  if (budget.exhausted) {
    return {
      status: 'none',
      reason: 'search-budget-exceeded',
      diagnostics: [budget.diagnostic ?? { code: 'SEARCH_BUDGET_EXCEEDED' }],
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
