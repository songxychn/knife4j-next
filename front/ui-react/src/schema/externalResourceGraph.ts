import { parseAllDocuments } from 'yaml';
import { sha256Hex, stableSerializeJson } from '../apiChange/apiChangeTracker';
import {
  fetchExternalResource,
  isRetryableResourceError,
  normalizeExternalResourceUri,
  ResourceLoadError,
  type FetchedExternalResource,
  type ResourceLoadErrorCode,
} from './externalResourcePolicy';

type JsonRecord = Record<string, unknown>;

export type ResourceReferenceKind =
  | 'reference-object'
  | 'path-item-ref'
  | 'schema-ref'
  | 'schema-dynamic-ref'
  | 'link-operation-ref'
  | 'discriminator-mapping';

export type ResourceDiagnosticPhase = 'discover' | 'authorize' | 'fetch' | 'read' | 'parse' | 'index' | 'register';

export interface ResourceLoadLimits {
  readonly maxResourceBytes: number;
  readonly maxTotalBytes: number;
  readonly maxDocuments: number;
  readonly maxReferences: number;
  readonly maxDepth: number;
  readonly maxParsedNodesPerDocument: number;
  readonly maxTotalParsedNodes: number;
  readonly maxSchemaResources: number;
  readonly maxConcurrency: number;
  readonly requestTimeoutMs: number;
  readonly waveTimeoutMs: number;
  readonly maxExplicitRetriesPerResource: number;
  readonly maxYamlAliases: number;
}

export const DEFAULT_RESOURCE_LOAD_LIMITS: Readonly<ResourceLoadLimits> = Object.freeze({
  maxResourceBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxDocuments: 64,
  maxReferences: 10_000,
  maxDepth: 32,
  maxParsedNodesPerDocument: 100_000,
  maxTotalParsedNodes: 250_000,
  maxSchemaResources: 1_000,
  maxConcurrency: 4,
  requestTimeoutMs: 10_000,
  waveTimeoutMs: 30_000,
  maxExplicitRetriesPerResource: 1,
  maxYamlAliases: 100,
});

export const PORTABLE_SCHEMA_RESOURCES_EXTENSION = 'x-knife4j-schema-resources';
export const PORTABLE_SCHEMA_RESOURCES_VERSION = 1;

export interface ResourceReferenceEvidence {
  readonly sourceDocumentUriHash: string;
  readonly sourcePointer: string;
  readonly kind: ResourceReferenceKind;
  readonly rawReferenceDisplay: string;
  readonly resolutionBaseDisplay: string;
  readonly fragment: string;
}

export interface ResourceCandidate {
  readonly retrievalUri: string;
  readonly retrievalUriHash: string;
  readonly displayUri: string;
  readonly sameOrigin: boolean;
  readonly depth: number;
  readonly state: 'pending' | 'failed';
  readonly retryable: boolean;
  readonly failureCode?: ResourceLoadErrorCode;
  readonly references: readonly ResourceReferenceEvidence[];
}

export interface ResourceGrant {
  readonly scope: 'generation' | 'document';
  readonly documentScope: string;
  readonly resourceKey: string;
}

export interface ResourceGraphNode {
  readonly retrievalUri: string;
  readonly retrievalUriHash: string;
  readonly displayUri: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly contentDigest: string;
  readonly documentKind: 'openapi' | 'json-schema' | 'referenceable-object';
  readonly authorizationScope: 'entry' | ResourceGrant['scope'];
  readonly resourceUris: readonly string[];
  readonly document: unknown;
}

export interface ResourceGraphEdge {
  readonly sourceRetrievalUri: string;
  readonly sourcePointer: string;
  readonly kind: ResourceReferenceKind;
  readonly resolvedUri: string;
  readonly targetRetrievalUri: string;
  readonly fragment: string;
  readonly state: 'local' | 'pending' | 'loaded' | 'failed';
}

/** Immutable location metadata for a resource or anchor already indexed by the graph. */
export interface ResourceGraphTarget {
  readonly ownerRetrievalUri: string;
  readonly pointer: string;
  readonly evaluationBaseUri: string;
}

export interface ResourceDiagnostic {
  readonly code: ResourceLoadErrorCode;
  readonly phase: ResourceDiagnosticPhase;
  readonly sourceRetrievalUriHash: string;
  readonly sourcePointer: string;
  readonly referenceKind: ResourceReferenceKind;
  readonly rawReferenceDisplay: string;
  readonly resolutionBaseDisplay: string;
  readonly targetRetrievalUriHash?: string;
  readonly resourceDisplay?: string;
  readonly limit?: number;
  readonly actual?: number;
  readonly generation: number;
  readonly retryable: boolean;
}

export interface ResourceGraphSnapshot {
  readonly generation: number;
  readonly entryRetrievalUri: string;
  readonly documentScope: string;
  readonly nodes: ReadonlyMap<string, ResourceGraphNode>;
  readonly resourceTargets: ReadonlyMap<string, ResourceGraphTarget>;
  readonly anchorTargets: ReadonlyMap<string, ResourceGraphTarget>;
  readonly edges: readonly ResourceGraphEdge[];
  readonly diagnostics: readonly ResourceDiagnostic[];
  readonly complete: boolean;
}

export interface ResourceDiscovery {
  readonly generation: number;
  readonly documentScope: string;
  readonly candidates: readonly ResourceCandidate[];
  readonly diagnostics: readonly ResourceDiagnostic[];
}

export interface ExternalResourceLoaderOptions {
  readonly pageUri?: string;
  readonly limits?: Partial<ResourceLoadLimits>;
  readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

type ExpectedTargetKind =
  | 'schema'
  | 'path-item'
  | 'operation'
  | 'parameter'
  | 'request-body'
  | 'response'
  | 'header'
  | 'callback'
  | 'link'
  | 'example'
  | 'security-scheme';

interface MutableEdge {
  readonly sourceRetrievalUri: string;
  readonly sourcePointer: string;
  readonly kind: ResourceReferenceKind;
  readonly resolvedUri: string;
  targetRetrievalUri: string;
  readonly fragment: string;
  readonly rawReference: string;
  readonly rawReferenceDisplay: string;
  readonly resolutionBase: string;
  readonly depth: number;
  readonly expectedTarget: ExpectedTargetKind;
  expanded: boolean;
  state: ResourceGraphEdge['state'];
}

interface ResourceTarget {
  readonly ownerRetrievalUri: string;
  readonly value: unknown;
  readonly pointer: string;
  readonly evaluationBaseUri: string;
}

interface ScanCollector {
  readonly sourceRetrievalUri: string;
  readonly resources: Map<string, ResourceTarget>;
  readonly anchors: Map<string, ResourceTarget>;
  readonly edges: MutableEdge[];
  readonly diagnostics: ResourceDiagnostic[];
}

interface ResourceFailure {
  readonly error: ResourceLoadError;
  readonly phase: ResourceDiagnosticPhase;
}

interface MutableGraphState {
  readonly generation: number;
  readonly nodes: Map<string, ResourceGraphNode>;
  readonly resourceTargets: Map<string, ResourceTarget>;
  readonly anchorTargets: Map<string, ResourceTarget>;
  readonly edges: MutableEdge[];
  readonly diagnostics: ResourceDiagnostic[];
  readonly failures: Map<string, ResourceFailure>;
  readonly attempts: Map<string, number>;
  readonly grants: Map<string, ResourceGrant['scope']>;
  totalBytes: number;
  totalParsedNodes: number;
}

const OAS_31_VERSION = /^3\.1\.\d+(?:[-+].*)?$/;
const KNIFE4J_SCHEMA_RESOURCES_FIELD = /^x-knife4j-schema-resources(?:-(?:[2-9]|[1-9]\d+))?$/;
const SUPPORTED_SCHEMA_DIALECT =
  /^(?:https:\/\/spec\.openapis\.org\/oas\/3\.1\/dialect\/base|https:\/\/json-schema\.org\/draft\/2020-12\/schema)#?$/;
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const SCHEMA_SINGLE_KEYWORDS = [
  'not',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contentSchema',
] as const;
const SCHEMA_ARRAY_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;
const SCHEMA_MAP_KEYWORDS = ['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions'] as const;
const ANCHOR_NAME = /^[A-Za-z_][-A-Za-z0-9._]*$/;
const COMPONENT_NAME = /^[A-Za-z0-9._-]+$/;

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const pointerToken = (value: string): string => value.replace(/~/g, '~0').replace(/\//g, '~1');
const childPointer = (pointer: string, key: string | number): string => `${pointer}/${pointerToken(String(key))}`;

function normalizeLimits(overrides: Partial<ResourceLoadLimits> = {}): Readonly<ResourceLoadLimits> {
  const limits = { ...DEFAULT_RESOURCE_LOAD_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer.`);
  }
  return Object.freeze(limits);
}

function uriWithoutFragment(uri: string): string {
  const parsed = new URL(uri);
  parsed.hash = '';
  return parsed.href;
}

function fragmentOf(uri: string): string {
  return new URL(uri).hash;
}

/** Remove credentials and query values from every user-visible resource identity. */
export function safeResourceDisplay(uri: string): string {
  try {
    const parsed = new URL(uri);
    parsed.username = '';
    parsed.password = '';
    const hadQuery = parsed.search.length > 0;
    parsed.search = '';
    const safeUri = parsed.href;
    if (!hadQuery) return safeUri;
    const fragmentIndex = safeUri.indexOf('#');
    return fragmentIndex < 0 ? `${safeUri}?…` : `${safeUri.slice(0, fragmentIndex)}?…${safeUri.slice(fragmentIndex)}`;
  } catch {
    return uri
      .replace(/\/\/[^/@\s]+@/g, '//…@')
      .replace(/\?[^#\s]*/g, '?…')
      .slice(0, 512);
  }
}

function safeRawReferenceDisplay(reference: string): string {
  if (reference.startsWith('#')) return reference.slice(0, 512);
  return safeResourceDisplay(reference);
}

function readonlyMap<K, V>(values: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const snapshot = new Map(values);
  const facade: ReadonlyMap<K, V> = Object.freeze({
    get size() {
      return snapshot.size;
    },
    get: (key: K) => snapshot.get(key),
    has: (key: K) => snapshot.has(key),
    forEach: (callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) => {
      snapshot.forEach((value, key) => callbackfn.call(thisArg, value, key, facade));
    },
    entries: () => snapshot.entries(),
    keys: () => snapshot.keys(),
    values: () => snapshot.values(),
    [Symbol.iterator]: () => snapshot[Symbol.iterator](),
  });
  return facade;
}

function genericDiagnostic(
  error: ResourceLoadError,
  phase: ResourceDiagnosticPhase,
  generation: number,
  sourceRetrievalUri: string,
  edge?: MutableEdge,
): ResourceDiagnostic {
  const target =
    edge?.targetRetrievalUri || (typeof error.details.retrievalUri === 'string' ? error.details.retrievalUri : '');
  const limit = typeof error.details.limit === 'number' ? error.details.limit : undefined;
  const actual = typeof error.details.actual === 'number' ? error.details.actual : undefined;
  return Object.freeze({
    code: error.code,
    phase,
    sourceRetrievalUriHash: sha256Hex(sourceRetrievalUri),
    sourcePointer: edge?.sourcePointer ?? '#',
    referenceKind: edge?.kind ?? 'reference-object',
    rawReferenceDisplay: edge?.rawReferenceDisplay ?? '',
    resolutionBaseDisplay: safeResourceDisplay(edge?.resolutionBase ?? sourceRetrievalUri),
    ...(target ? { targetRetrievalUriHash: sha256Hex(target), resourceDisplay: safeResourceDisplay(target) } : {}),
    ...(limit === undefined ? {} : { limit }),
    ...(actual === undefined ? {} : { actual }),
    generation,
    retryable: isRetryableResourceError(error),
  });
}

class StrictJsonParser {
  private index = 0;
  private nodes = 0;

  public constructor(
    private readonly source: string,
    private readonly maxNodes: number,
    private readonly maxDepth: number,
  ) {}

  public parse(): { value: unknown; nodes: number } {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) this.fail('Trailing JSON content is not allowed.');
    return { value, nodes: this.nodes };
  }

  private parseValue(depth: number): unknown {
    this.reserveNode(depth);
    const token = this.source[this.index];
    if (token === '{') return this.parseObject(depth);
    if (token === '[') return this.parseArray(depth);
    if (token === '"') return this.parseString();
    if (token === 't' && this.source.startsWith('true', this.index)) {
      this.index += 4;
      return true;
    }
    if (token === 'f' && this.source.startsWith('false', this.index)) {
      this.index += 5;
      return false;
    }
    if (token === 'n' && this.source.startsWith('null', this.index)) {
      this.index += 4;
      return null;
    }
    return this.parseNumber();
  }

  private parseObject(depth: number): JsonRecord {
    this.index += 1;
    this.skipWhitespace();
    const result = Object.create(null) as JsonRecord;
    const keys = new Set<string>();
    if (this.source[this.index] === '}') {
      this.index += 1;
      return result;
    }
    for (;;) {
      if (this.source[this.index] !== '"') this.fail('JSON object keys must be strings.');
      const key = this.parseString();
      if (keys.has(key)) this.fail('Duplicate JSON object keys are not allowed.');
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.index] !== ':') this.fail("Expected ':' after a JSON object key.");
      this.index += 1;
      this.skipWhitespace();
      result[key] = this.parseValue(depth + 1);
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === '}') {
        this.index += 1;
        return result;
      }
      if (separator !== ',') this.fail("Expected ',' or '}' in a JSON object.");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): unknown[] {
    this.index += 1;
    this.skipWhitespace();
    const result: unknown[] = [];
    if (this.source[this.index] === ']') {
      this.index += 1;
      return result;
    }
    for (;;) {
      result.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const separator = this.source[this.index];
      if (separator === ']') {
        this.index += 1;
        return result;
      }
      if (separator !== ',') this.fail("Expected ',' or ']' in a JSON array.");
      this.index += 1;
      this.skipWhitespace();
    }
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    while (this.index < this.source.length) {
      const code = this.source.charCodeAt(this.index);
      if (code === 0x22) {
        this.index += 1;
        try {
          return JSON.parse(this.source.slice(start, this.index)) as string;
        } catch {
          this.fail('Invalid JSON string escape.');
        }
      }
      if (code < 0x20) this.fail('Unescaped control characters are not allowed in JSON strings.');
      if (code === 0x5c) {
        this.index += 1;
        const escape = this.source[this.index];
        if (escape === 'u') {
          const digits = this.source.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(digits)) this.fail('Invalid JSON unicode escape.');
          this.index += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escape ?? '')) this.fail('Invalid JSON string escape.');
      }
      this.index += 1;
    }
    this.fail('Unterminated JSON string.');
  }

  private parseNumber(): number {
    const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.index))?.[0];
    if (!token) this.fail('Expected a JSON value.');
    this.index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) this.fail('JSON numbers must be finite.');
    return value;
  }

  private reserveNode(depth: number): void {
    this.nodes += 1;
    if (this.nodes > this.maxNodes) {
      throw new ResourceLoadError('GRAPH_NODE_LIMIT', 'Parsed document node limit exceeded.', {
        limit: this.maxNodes,
        actual: this.nodes,
        scope: 'document',
      });
    }
    if (depth > this.maxDepth) {
      throw new ResourceLoadError('GRAPH_NODE_LIMIT', 'Parsed document depth limit exceeded.', {
        limit: this.maxDepth,
        actual: depth,
        scope: 'document-depth',
      });
    }
  }

  private skipWhitespace(): void {
    while (/[ \t\r\n]/.test(this.source[this.index] ?? '')) this.index += 1;
  }

  private fail(message: string): never {
    throw new ResourceLoadError('DOCUMENT_PARSE_FAILED', message);
  }
}

function freezeJsonValue<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value as Record<string, unknown>).forEach((nested) => freezeJsonValue(nested));
  return Object.freeze(value);
}

function cloneYamlValue(value: unknown, maxNodes: number, maxDepth: number): { value: unknown; nodes: number } {
  let nodes = 0;
  const ancestors = new Set<object>();
  const visit = (candidate: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > maxNodes) {
      throw new ResourceLoadError('GRAPH_NODE_LIMIT', 'Parsed document node limit exceeded.', {
        limit: maxNodes,
        actual: nodes,
        scope: 'document',
      });
    }
    if (depth > maxDepth) {
      throw new ResourceLoadError('GRAPH_NODE_LIMIT', 'Parsed document depth limit exceeded.', {
        limit: maxDepth,
        actual: depth,
        scope: 'document-depth',
      });
    }
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new ResourceLoadError('DOCUMENT_PARSE_FAILED', 'Numbers must be finite.');
      return candidate;
    }
    if (typeof candidate !== 'object') {
      throw new ResourceLoadError(
        'DOCUMENT_PARSE_FAILED',
        'The YAML document is not compatible with the JSON data model.',
      );
    }
    if (ancestors.has(candidate)) {
      throw new ResourceLoadError('DOCUMENT_PARSE_FAILED', 'Cyclic YAML aliases are not allowed.');
    }
    ancestors.add(candidate);
    try {
      if (Array.isArray(candidate)) return candidate.map((item) => visit(item, depth + 1));
      if (!(candidate instanceof Map)) {
        throw new ResourceLoadError('DOCUMENT_PARSE_FAILED', 'The YAML document contains a non-JSON collection.');
      }
      const result = Object.create(null) as JsonRecord;
      for (const [key, nested] of candidate) {
        if (typeof key !== 'string') {
          throw new ResourceLoadError('DOCUMENT_PARSE_FAILED', 'YAML object keys must be strings.');
        }
        if (key === '<<') throw new ResourceLoadError('DOCUMENT_PARSE_FAILED', 'YAML merge keys are not allowed.');
        result[key] = visit(nested, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(candidate);
    }
  };
  return { value: visit(value, 0), nodes };
}

export function parseExternalResourceDocument(
  fetched: Pick<FetchedExternalResource, 'mediaType' | 'text'>,
  limits: Pick<ResourceLoadLimits, 'maxParsedNodesPerDocument' | 'maxDepth' | 'maxYamlAliases'>,
): { document: unknown; nodes: number } {
  if (fetched.mediaType.format === 'json') {
    const parsed = new StrictJsonParser(fetched.text, limits.maxParsedNodesPerDocument, limits.maxDepth).parse();
    return { document: freezeJsonValue(parsed.value), nodes: parsed.nodes };
  }

  let documents;
  try {
    documents = parseAllDocuments(fetched.text, {
      version: '1.2',
      // YAML 1.2 core keeps ordinary unquoted OpenAPI strings usable while
      // excluding YAML 1.1 object-producing tags; the JSON-model clone below
      // rejects every remaining non-string key, merge, cycle, and non-finite value.
      schema: 'core',
      customTags: [],
      merge: false,
      resolveKnownTags: false,
      strict: true,
      uniqueKeys: true,
      stringKeys: true,
      prettyErrors: false,
      logLevel: 'silent',
    });
  } catch (error) {
    throw new ResourceLoadError(
      'DOCUMENT_PARSE_FAILED',
      'Unable to safely parse the complete YAML document.',
      {},
      error,
    );
  }
  if (documents.length !== 1) {
    throw new ResourceLoadError('DOCUMENT_PARSE_FAILED', 'A YAML resource must contain exactly one complete document.');
  }
  const document = documents[0];
  if (document.errors.length > 0) {
    throw new ResourceLoadError(
      'DOCUMENT_PARSE_FAILED',
      'Unable to safely parse the complete YAML document.',
      {},
      document.errors[0],
    );
  }
  if (document.warnings.length > 0) {
    throw new ResourceLoadError(
      'DOCUMENT_PARSE_FAILED',
      'The YAML document uses a tag or construct outside the safe YAML 1.2 profile.',
      {},
      document.warnings[0],
    );
  }
  let value: unknown;
  try {
    value = document.toJS({ mapAsMap: true, maxAliasCount: limits.maxYamlAliases });
  } catch (error) {
    throw new ResourceLoadError('DOCUMENT_PARSE_FAILED', 'Unable to safely expand YAML aliases.', {}, error);
  }
  const parsed = cloneYamlValue(value, limits.maxParsedNodesPerDocument, limits.maxDepth);
  return { document: freezeJsonValue(parsed.value), nodes: parsed.nodes };
}

function cloneAndCountEntry(
  document: unknown,
  limits: ResourceLoadLimits,
): { document: unknown; nodes: number; text: string } {
  let text: string;
  try {
    text = stableSerializeJson(document);
  } catch (error) {
    throw new ResourceLoadError('DOCUMENT_PARSE_FAILED', 'The entry document is not valid JSON data.', {}, error);
  }
  const parsed = new StrictJsonParser(text, limits.maxParsedNodesPerDocument, limits.maxDepth).parse();
  return { document: freezeJsonValue(parsed.value), nodes: parsed.nodes, text };
}

function addResourceTarget(
  collector: ScanCollector,
  uri: string,
  value: unknown,
  pointer: string,
  evaluationBaseUri = uri,
): void {
  const identity = uriWithoutFragment(uri);
  const existing = collector.resources.get(identity);
  if (existing && existing.pointer !== pointer) {
    throw new ResourceLoadError('RESOURCE_URI_CONFLICT', 'A Schema resource URI is declared more than once.', {
      retrievalUri: identity,
    });
  }
  collector.resources.set(identity, {
    ownerRetrievalUri: collector.sourceRetrievalUri,
    value,
    pointer,
    evaluationBaseUri,
  });
}

function addAnchorTarget(
  collector: ScanCollector,
  uri: string,
  value: unknown,
  pointer: string,
  evaluationBaseUri: string,
): void {
  const existing = collector.anchors.get(uri);
  if (existing && existing.pointer !== pointer) {
    throw new ResourceLoadError('RESOURCE_URI_CONFLICT', 'A Schema anchor URI is declared more than once.', {
      retrievalUri: uri,
    });
  }
  collector.anchors.set(uri, {
    ownerRetrievalUri: collector.sourceRetrievalUri,
    value,
    pointer,
    evaluationBaseUri,
  });
}

function edgeIdentity(
  edge: Pick<MutableEdge, 'sourceRetrievalUri' | 'sourcePointer' | 'kind' | 'resolvedUri' | 'expectedTarget'>,
): string {
  return `${edge.sourceRetrievalUri}\n${edge.sourcePointer}\n${edge.kind}\n${edge.resolvedUri}\n${edge.expectedTarget}`;
}

function addReference(
  collector: ScanCollector,
  rawReference: string,
  baseUri: string,
  sourcePointer: string,
  kind: ResourceReferenceKind,
  expectedTarget: ExpectedTargetKind,
  depth: number,
  generation: number,
): void {
  let resolvedUri: string;
  try {
    resolvedUri = new URL(rawReference, baseUri).href;
  } catch (error) {
    collector.diagnostics.push(
      genericDiagnostic(
        new ResourceLoadError('RESOURCE_URI_INVALID', 'A resource reference cannot be resolved.', {}, error),
        'discover',
        generation,
        collector.sourceRetrievalUri,
        {
          sourceRetrievalUri: collector.sourceRetrievalUri,
          sourcePointer,
          kind,
          resolvedUri: '',
          targetRetrievalUri: '',
          fragment: '',
          state: 'failed',
          rawReference,
          rawReferenceDisplay: safeRawReferenceDisplay(rawReference),
          resolutionBase: baseUri,
          depth,
          expectedTarget,
          expanded: true,
        },
      ),
    );
    return;
  }
  const edge: MutableEdge = {
    sourceRetrievalUri: collector.sourceRetrievalUri,
    sourcePointer,
    kind,
    resolvedUri,
    targetRetrievalUri: uriWithoutFragment(resolvedUri),
    fragment: fragmentOf(resolvedUri),
    state: 'pending',
    rawReference,
    rawReferenceDisplay: safeRawReferenceDisplay(rawReference),
    resolutionBase: baseUri,
    depth,
    expectedTarget,
    expanded: false,
  };
  if (!collector.edges.some((existing) => edgeIdentity(existing) === edgeIdentity(edge))) collector.edges.push(edge);
}

function walkSchema(
  value: unknown,
  pointer: string,
  inheritedBase: string,
  collector: ScanCollector,
  emitReferences: boolean,
  depth: number,
  generation: number,
): void {
  if (typeof value === 'boolean' || !isRecord(value)) return;
  if (typeof value.$schema === 'string' && !SUPPORTED_SCHEMA_DIALECT.test(value.$schema)) {
    throw new ResourceLoadError(
      'DIALECT_UNSUPPORTED',
      'The Schema declares a dialect outside the supported OAS 3.1 base and Draft 2020-12 dialects.',
    );
  }
  const evaluationBaseUri = inheritedBase;
  let baseUri = inheritedBase;
  if (typeof value.$id === 'string') {
    try {
      const identifier = new URL(value.$id, inheritedBase);
      if (identifier.hash) {
        throw new ResourceLoadError('RESOURCE_URI_INVALID', 'Schema $id values must not contain a non-empty fragment.');
      }
      baseUri = identifier.href;
      addResourceTarget(collector, baseUri, value, pointer, evaluationBaseUri);
    } catch (error) {
      if (error instanceof ResourceLoadError) throw error;
      throw new ResourceLoadError('RESOURCE_URI_INVALID', 'Schema $id cannot be resolved.', {}, error);
    }
  }
  for (const keyword of ['$anchor', '$dynamicAnchor'] as const) {
    const anchor = value[keyword];
    if (typeof anchor !== 'string') continue;
    if (!ANCHOR_NAME.test(anchor)) {
      throw new ResourceLoadError('RESOURCE_URI_INVALID', `Schema ${keyword} is invalid.`);
    }
    addAnchorTarget(collector, `${uriWithoutFragment(baseUri)}#${anchor}`, value, pointer, evaluationBaseUri);
  }

  if (emitReferences && typeof value.$ref === 'string') {
    addReference(
      collector,
      value.$ref,
      baseUri,
      childPointer(pointer, '$ref'),
      'schema-ref',
      'schema',
      depth + 1,
      generation,
    );
  }
  if (emitReferences && typeof value.$dynamicRef === 'string') {
    addReference(
      collector,
      value.$dynamicRef,
      baseUri,
      childPointer(pointer, '$dynamicRef'),
      'schema-dynamic-ref',
      'schema',
      depth + 1,
      generation,
    );
  }
  const mapping =
    isRecord(value.discriminator) && isRecord(value.discriminator.mapping) ? value.discriminator.mapping : null;
  if (emitReferences && mapping) {
    Object.entries(mapping).forEach(([name, target]) => {
      if (typeof target !== 'string') return;
      // OAS component-name shorthand wins for bare values. Every other value is
      // an explicit URI reference and, unlike Schema $ref, resolves against the
      // physical OpenAPI document rather than the nearest Schema Resource $id.
      if (COMPONENT_NAME.test(target)) return;
      addReference(
        collector,
        target,
        collector.sourceRetrievalUri,
        childPointer(childPointer(childPointer(pointer, 'discriminator'), 'mapping'), name),
        'discriminator-mapping',
        'schema',
        depth + 1,
        generation,
      );
    });
  }

  SCHEMA_SINGLE_KEYWORDS.forEach((keyword) => {
    if (owns(value, keyword)) {
      walkSchema(value[keyword], childPointer(pointer, keyword), baseUri, collector, emitReferences, depth, generation);
    }
  });
  SCHEMA_ARRAY_KEYWORDS.forEach((keyword) => {
    const schemas = value[keyword];
    if (!Array.isArray(schemas)) return;
    schemas.forEach((schema, index) =>
      walkSchema(
        schema,
        childPointer(childPointer(pointer, keyword), index),
        baseUri,
        collector,
        emitReferences,
        depth,
        generation,
      ),
    );
  });
  if (Array.isArray(value.items)) {
    value.items.forEach((schema, index) =>
      walkSchema(
        schema,
        childPointer(childPointer(pointer, 'items'), index),
        baseUri,
        collector,
        emitReferences,
        depth,
        generation,
      ),
    );
  } else if (owns(value, 'items')) {
    walkSchema(value.items, childPointer(pointer, 'items'), baseUri, collector, emitReferences, depth, generation);
  }
  SCHEMA_MAP_KEYWORDS.forEach((keyword) => {
    const schemas = value[keyword];
    if (!isRecord(schemas)) return;
    Object.entries(schemas).forEach(([name, schema]) =>
      walkSchema(
        schema,
        childPointer(childPointer(pointer, keyword), name),
        baseUri,
        collector,
        emitReferences,
        depth,
        generation,
      ),
    );
  });
}

function walkReferenceOr(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emitReferences: boolean,
  depth: number,
  generation: number,
  expectedTarget: ExpectedTargetKind,
  walkValue: (value: unknown, pointer: string, emit: boolean) => void,
  kind: ResourceReferenceKind = 'reference-object',
): void {
  if (!isRecord(value)) return;
  if (emitReferences && typeof value.$ref === 'string') {
    addReference(
      collector,
      value.$ref,
      baseUri,
      childPointer(pointer, '$ref'),
      kind,
      expectedTarget,
      depth + 1,
      generation,
    );
    if (kind === 'reference-object') return;
  }
  walkValue(value, pointer, emitReferences);
}

function walkMediaType(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  if (!isRecord(value)) return;
  if (owns(value, 'schema'))
    walkSchema(value.schema, childPointer(pointer, 'schema'), baseUri, collector, emit, depth, generation);
  walkExamples(value.examples, childPointer(pointer, 'examples'), baseUri, collector, emit, depth, generation);
  if (!isRecord(value.encoding)) return;
  Object.entries(value.encoding).forEach(([name, encoding]) => {
    if (!isRecord(encoding) || !isRecord(encoding.headers)) return;
    Object.entries(encoding.headers).forEach(([headerName, header]) =>
      walkHeader(
        header,
        childPointer(childPointer(childPointer(childPointer(pointer, 'encoding'), name), 'headers'), headerName),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      ),
    );
  });
}

function walkContent(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([mediaType, media]) =>
    walkMediaType(media, childPointer(pointer, mediaType), baseUri, collector, emit, depth, generation),
  );
}

function walkParameter(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'parameter',
    (parameter, parameterPointer, nestedEmit) => {
      if (!isRecord(parameter)) return;
      if (owns(parameter, 'schema')) {
        walkSchema(
          parameter.schema,
          childPointer(parameterPointer, 'schema'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
      if (owns(parameter, 'content')) {
        walkContent(
          parameter.content,
          childPointer(parameterPointer, 'content'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
      walkExamples(
        parameter.examples,
        childPointer(parameterPointer, 'examples'),
        baseUri,
        collector,
        nestedEmit,
        depth,
        generation,
      );
    },
  );
}

function walkHeader(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'header',
    (header, headerPointer, nestedEmit) => {
      if (!isRecord(header)) return;
      if (owns(header, 'schema')) {
        walkSchema(
          header.schema,
          childPointer(headerPointer, 'schema'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
      if (owns(header, 'content')) {
        walkContent(
          header.content,
          childPointer(headerPointer, 'content'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
      walkExamples(
        header.examples,
        childPointer(headerPointer, 'examples'),
        baseUri,
        collector,
        nestedEmit,
        depth,
        generation,
      );
    },
  );
}

function walkRequestBody(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'request-body',
    (body, bodyPointer, nestedEmit) => {
      if (isRecord(body) && owns(body, 'content')) {
        walkContent(
          body.content,
          childPointer(bodyPointer, 'content'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
    },
  );
}

function walkLink(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'link',
    (link, linkPointer, nestedEmit) => {
      if (nestedEmit && isRecord(link) && typeof link.operationRef === 'string') {
        addReference(
          collector,
          link.operationRef,
          baseUri,
          childPointer(linkPointer, 'operationRef'),
          'link-operation-ref',
          'operation',
          depth + 1,
          generation,
        );
      }
    },
  );
}

function walkResponse(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'response',
    (response, responsePointer, nestedEmit) => {
      if (!isRecord(response)) return;
      if (isRecord(response.headers)) {
        Object.entries(response.headers).forEach(([name, header]) =>
          walkHeader(
            header,
            childPointer(childPointer(responsePointer, 'headers'), name),
            baseUri,
            collector,
            nestedEmit,
            depth,
            generation,
          ),
        );
      }
      if (owns(response, 'content')) {
        walkContent(
          response.content,
          childPointer(responsePointer, 'content'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
      if (isRecord(response.links)) {
        Object.entries(response.links).forEach(([name, link]) =>
          walkLink(
            link,
            childPointer(childPointer(responsePointer, 'links'), name),
            baseUri,
            collector,
            nestedEmit,
            depth,
            generation,
          ),
        );
      }
    },
  );
}

function walkCallback(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'callback',
    (callback, callbackPointer, nestedEmit) => {
      if (!isRecord(callback)) return;
      Object.entries(callback).forEach(([expression, pathItem]) => {
        if (expression === '$ref' || expression === 'summary' || expression === 'description') return;
        walkPathItem(
          pathItem,
          childPointer(callbackPointer, expression),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      });
    },
  );
}

function walkOperation(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  if (!isRecord(value)) return;
  if (Array.isArray(value.parameters)) {
    value.parameters.forEach((parameter, index) =>
      walkParameter(
        parameter,
        childPointer(childPointer(pointer, 'parameters'), index),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      ),
    );
  }
  if (owns(value, 'requestBody')) {
    walkRequestBody(
      value.requestBody,
      childPointer(pointer, 'requestBody'),
      baseUri,
      collector,
      emit,
      depth,
      generation,
    );
  }
  if (isRecord(value.responses)) {
    Object.entries(value.responses).forEach(([status, response]) =>
      walkResponse(
        response,
        childPointer(childPointer(pointer, 'responses'), status),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      ),
    );
  }
  if (isRecord(value.callbacks)) {
    Object.entries(value.callbacks).forEach(([name, callback]) =>
      walkCallback(
        callback,
        childPointer(childPointer(pointer, 'callbacks'), name),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      ),
    );
  }
}

function walkPathItem(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'path-item',
    (pathItem, pathPointer, nestedEmit) => {
      if (!isRecord(pathItem)) return;
      if (Array.isArray(pathItem.parameters)) {
        pathItem.parameters.forEach((parameter, index) =>
          walkParameter(
            parameter,
            childPointer(childPointer(pathPointer, 'parameters'), index),
            baseUri,
            collector,
            nestedEmit,
            depth,
            generation,
          ),
        );
      }
      HTTP_METHODS.forEach((method) => {
        if (owns(pathItem, method)) {
          walkOperation(
            pathItem[method],
            childPointer(pathPointer, method),
            baseUri,
            collector,
            nestedEmit,
            depth,
            generation,
          );
        }
      });
    },
    'path-item-ref',
  );
}

function walkExample(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(value, pointer, baseUri, collector, emit, depth, generation, 'example', () => {});
}

function walkExamples(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([name, example]) =>
    walkExample(example, childPointer(pointer, name), baseUri, collector, emit, depth, generation),
  );
}

function walkSecurityScheme(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(value, pointer, baseUri, collector, emit, depth, generation, 'security-scheme', () => {});
}

function walkComponentMap(
  components: JsonRecord,
  key: string,
  walk: (value: unknown, pointer: string) => void,
  pointer: string,
): void {
  const values = components[key];
  if (!isRecord(values)) return;
  Object.entries(values).forEach(([name, value]) => walk(value, childPointer(childPointer(pointer, key), name)));
}

function walkOpenApiDocument(
  document: unknown,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  if (!isRecord(document)) return;
  if (typeof document.jsonSchemaDialect === 'string' && !SUPPORTED_SCHEMA_DIALECT.test(document.jsonSchemaDialect)) {
    throw new ResourceLoadError(
      'DIALECT_UNSUPPORTED',
      'The OpenAPI document declares an unsupported JSON Schema dialect.',
    );
  }
  const baseUri = collector.sourceRetrievalUri;
  Object.entries(document).forEach(([key, container]) => {
    if (
      !KNIFE4J_SCHEMA_RESOURCES_FIELD.test(key) ||
      !isRecord(container) ||
      container.version !== PORTABLE_SCHEMA_RESOURCES_VERSION ||
      !isRecord(container.resources)
    ) {
      return;
    }
    Object.entries(container.resources).forEach(([name, schema]) =>
      walkSchema(
        schema,
        childPointer(childPointer(childPointer('#', key), 'resources'), name),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      ),
    );
  });
  if (isRecord(document.paths)) {
    Object.entries(document.paths).forEach(([path, item]) =>
      walkPathItem(item, childPointer(childPointer('#', 'paths'), path), baseUri, collector, emit, depth, generation),
    );
  }
  if (isRecord(document.webhooks)) {
    Object.entries(document.webhooks).forEach(([name, item]) =>
      walkPathItem(
        item,
        childPointer(childPointer('#', 'webhooks'), name),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      ),
    );
  }
  if (!isRecord(document.components)) return;
  const components = document.components;
  const pointer = childPointer('#', 'components');
  walkComponentMap(
    components,
    'schemas',
    (schema, schemaPointer) => walkSchema(schema, schemaPointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'parameters',
    (value, valuePointer) => walkParameter(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'headers',
    (value, valuePointer) => walkHeader(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'requestBodies',
    (value, valuePointer) => walkRequestBody(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'responses',
    (value, valuePointer) => walkResponse(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'callbacks',
    (value, valuePointer) => walkCallback(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'links',
    (value, valuePointer) => walkLink(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'examples',
    (value, valuePointer) => walkExample(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'securitySchemes',
    (value, valuePointer) => walkSecurityScheme(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'pathItems',
    (value, valuePointer) => walkPathItem(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
}

function decodedJsonPointer(fragment: string): string | undefined {
  if (!fragment || fragment === '#') return '';
  if (!fragment.startsWith('#')) return undefined;
  let pointer: string;
  try {
    pointer = decodeURIComponent(fragment.slice(1));
  } catch {
    return undefined;
  }
  if (!pointer.startsWith('/')) return undefined;
  if (
    pointer
      .slice(1)
      .split('/')
      .some((token) => /~(?:[^01]|$)/.test(token))
  )
    return undefined;
  return pointer;
}

function resolveJsonPointer(root: unknown, fragment: string): unknown {
  const pointer = decodedJsonPointer(fragment);
  if (pointer === undefined) return undefined;
  if (!pointer) return root;
  let current = root;
  for (const encoded of pointer.slice(1).split('/')) {
    const token = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || typeof current !== 'object' || !owns(current, token)) return undefined;
    current = (current as JsonRecord)[token];
  }
  return current;
}

function pointerWithinResource(resourcePointer: string, fragment: string): string {
  const pointer = decodedJsonPointer(fragment);
  if (!pointer) return resourcePointer;
  return resourcePointer === '#' ? `#${pointer}` : `${resourcePointer}${pointer}`;
}

interface IndexedTargetValue {
  readonly value: unknown;
  readonly pointer: string;
  readonly baseUri: string;
  readonly ownerRetrievalUri: string;
}

function expectedTargetValue(
  edge: MutableEdge,
  resourceTarget: (uri: string) => ResourceTarget | undefined,
  anchorTarget: (uri: string) => ResourceTarget | undefined,
): IndexedTargetValue | undefined {
  const directAnchor = anchorTarget(edge.resolvedUri);
  if (directAnchor)
    return {
      value: directAnchor.value,
      pointer: directAnchor.pointer,
      baseUri: directAnchor.evaluationBaseUri,
      ownerRetrievalUri: directAnchor.ownerRetrievalUri,
    };
  const resource = resourceTarget(edge.targetRetrievalUri);
  if (resource) {
    const value = resolveJsonPointer(resource.value, edge.fragment);
    if (value !== undefined) {
      return {
        value,
        pointer: pointerWithinResource(resource.pointer, edge.fragment),
        baseUri: edge.fragment ? edge.targetRetrievalUri : resource.evaluationBaseUri,
        ownerRetrievalUri: resource.ownerRetrievalUri,
      };
    }
    throw new ResourceLoadError(
      'FRAGMENT_NOT_FOUND',
      'The complete external document does not contain the referenced fragment.',
    );
  }
  return undefined;
}

function walkExpectedTarget(
  target: { value: unknown; pointer: string; baseUri: string },
  edge: MutableEdge,
  collector: ScanCollector,
  generation: number,
): void {
  const { value, pointer, baseUri } = target;
  if (edge.expectedTarget === 'schema') {
    if (typeof value !== 'boolean' && !isRecord(value)) {
      throw new ResourceLoadError('DOCUMENT_KIND_MISMATCH', 'The referenced target is not a Schema Object.');
    }
    if (!edge.fragment && isRecord(value) && typeof value.openapi === 'string') {
      throw new ResourceLoadError('DOCUMENT_KIND_MISMATCH', 'An OpenAPI document root is not a Schema Object.');
    }
    walkSchema(value, pointer, baseUri, collector, true, edge.depth, generation);
    return;
  }
  if (!isRecord(value)) {
    throw new ResourceLoadError('DOCUMENT_KIND_MISMATCH', 'The referenced OpenAPI target is not an object.');
  }
  switch (edge.expectedTarget) {
    case 'path-item':
      walkPathItem(value, pointer, baseUri, collector, true, edge.depth, generation);
      break;
    case 'operation':
      walkOperation(value, pointer, baseUri, collector, true, edge.depth, generation);
      break;
    case 'parameter':
      walkParameter(value, pointer, baseUri, collector, true, edge.depth, generation);
      break;
    case 'request-body':
      walkRequestBody(value, pointer, baseUri, collector, true, edge.depth, generation);
      break;
    case 'response':
      walkResponse(value, pointer, baseUri, collector, true, edge.depth, generation);
      break;
    case 'header':
      walkHeader(value, pointer, baseUri, collector, true, edge.depth, generation);
      break;
    case 'callback':
      walkCallback(value, pointer, baseUri, collector, true, edge.depth, generation);
      break;
    case 'link':
      walkLink(value, pointer, baseUri, collector, true, edge.depth, generation);
      break;
    case 'example':
      walkExample(value, pointer, baseUri, collector, true, edge.depth, generation);
      break;
    case 'security-scheme':
      walkSecurityScheme(value, pointer, baseUri, collector, true, edge.depth, generation);
      break;
  }
}

function documentKind(document: unknown, incoming: readonly MutableEdge[]): ResourceGraphNode['documentKind'] {
  if (isRecord(document) && typeof document.openapi === 'string') {
    if (!OAS_31_VERSION.test(document.openapi)) {
      throw new ResourceLoadError(
        'DOCUMENT_KIND_MISMATCH',
        `External OpenAPI document '${document.openapi}' is outside the supported 3.1.x range.`,
      );
    }
    return 'openapi';
  }
  if (typeof document === 'boolean' || incoming.some((edge) => edge.expectedTarget === 'schema')) return 'json-schema';
  return 'referenceable-object';
}

function createCollector(retrievalUri: string): ScanCollector {
  return {
    sourceRetrievalUri: retrievalUri,
    resources: new Map(),
    anchors: new Map(),
    edges: [],
    diagnostics: [],
  };
}

function phaseForError(error: ResourceLoadError): ResourceDiagnosticPhase {
  if (error.code === 'RESOURCE_CONTENT_TYPE_UNSUPPORTED') return 'read';
  if (error.code === 'RESOURCE_ENCODING_UNSUPPORTED' || error.code === 'RESOURCE_TOO_LARGE') return 'read';
  if (error.code === 'DOCUMENT_PARSE_FAILED' || error.code === 'GRAPH_NODE_LIMIT') return 'parse';
  if (
    error.code === 'DOCUMENT_KIND_MISMATCH' ||
    error.code === 'DIALECT_UNSUPPORTED' ||
    error.code === 'RESOURCE_URI_CONFLICT' ||
    error.code === 'FRAGMENT_NOT_FOUND'
  ) {
    return 'index';
  }
  return 'fetch';
}

function freezeNode(node: ResourceGraphNode): ResourceGraphNode {
  return Object.freeze({ ...node, resourceUris: Object.freeze([...node.resourceUris]) });
}

export class ExternalResourceLoader {
  public readonly entryRetrievalUri: string;
  public readonly documentScope: string;

  private readonly entryDocument: unknown;
  private readonly entryText: string;
  private readonly entryNodes: number;
  private readonly pageUri: string;
  private readonly limits: Readonly<ResourceLoadLimits>;
  private readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  private generation = 0;
  private state: MutableGraphState;
  private controller: AbortController | null = null;
  private disposed = false;

  public constructor(entryDocument: unknown, retrievalUri: string, options: ExternalResourceLoaderOptions = {}) {
    this.limits = normalizeLimits(options.limits);
    this.pageUri = options.pageUri ?? retrievalUri;
    this.entryRetrievalUri = normalizeExternalResourceUri(retrievalUri, retrievalUri, this.pageUri);
    const entry = cloneAndCountEntry(entryDocument, this.limits);
    if (
      !isRecord(entry.document) ||
      typeof entry.document.openapi !== 'string' ||
      !OAS_31_VERSION.test(entry.document.openapi)
    ) {
      throw new ResourceLoadError(
        'DOCUMENT_KIND_MISMATCH',
        'The entry document must declare a supported OpenAPI 3.1.x version.',
      );
    }
    this.entryDocument = entry.document;
    this.entryText = entry.text;
    this.entryNodes = entry.nodes;
    this.documentScope = sha256Hex(`${this.entryRetrievalUri}\n${sha256Hex(entry.text)}`);
    this.fetchImpl = options.fetchImpl;
    this.state = this.buildBaseState();
  }

  public discover(): ResourceDiscovery {
    this.assertUsable();
    this.refreshGraph(this.state);
    return this.discoverySnapshot(this.state);
  }

  public async load(grants: readonly ResourceGrant[], signal?: AbortSignal): Promise<ResourceGraphSnapshot> {
    this.assertUsable();
    this.cancel();
    const state = this.buildBaseState();
    grants.forEach((grant) => {
      if (grant.documentScope !== this.documentScope) return;
      const previous = state.grants.get(grant.resourceKey);
      if (grant.scope === 'document' || (grant.scope === 'generation' && previous === undefined)) {
        state.grants.set(grant.resourceKey, grant.scope);
      }
    });
    this.state = state;
    return this.runWave(state, signal);
  }

  public async retry(retrievalUriHash: string, signal?: AbortSignal): Promise<ResourceGraphSnapshot> {
    this.assertUsable();
    const previous = this.state;
    this.refreshGraph(previous);
    const previousCandidate = this.candidates(previous).find((item) => item.retrievalUriHash === retrievalUriHash);
    const failure = previousCandidate ? previous.failures.get(previousCandidate.retrievalUri) : undefined;
    if (!previousCandidate || !failure || !previousCandidate.retryable) return this.graphSnapshot(previous);
    const attempts = previous.attempts.get(previousCandidate.retrievalUri) ?? 0;
    if (attempts >= 1 + this.limits.maxExplicitRetriesPerResource) return this.graphSnapshot(previous);

    this.cancel();
    const state = this.forkState(previous);
    this.state = state;
    const candidate = this.candidates(state).find((item) => item.retrievalUriHash === retrievalUriHash)!;

    state.failures.delete(candidate.retrievalUri);
    state.diagnostics.splice(
      0,
      state.diagnostics.length,
      ...state.diagnostics.filter((diagnostic) => diagnostic.targetRetrievalUriHash !== retrievalUriHash),
    );
    state.edges.forEach((edge) => {
      if (edge.targetRetrievalUri === candidate.retrievalUri && edge.state === 'failed') edge.state = 'pending';
    });
    return this.runWave(state, signal, candidate.retrievalUri);
  }

  public currentDiscovery(): ResourceDiscovery {
    this.assertUsable();
    this.refreshGraph(this.state);
    return this.discoverySnapshot(this.state);
  }

  public currentSnapshot(): ResourceGraphSnapshot {
    this.assertUsable();
    this.refreshGraph(this.state);
    return this.graphSnapshot(this.state);
  }

  public cancel(): void {
    this.controller?.abort();
    this.controller = null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
  }

  private buildBaseState(): MutableGraphState {
    this.generation += 1;
    const state: MutableGraphState = {
      generation: this.generation,
      nodes: new Map(),
      resourceTargets: new Map(),
      anchorTargets: new Map(),
      edges: [],
      diagnostics: [],
      failures: new Map(),
      attempts: new Map(),
      grants: new Map(),
      totalBytes: 0,
      totalParsedNodes: this.entryNodes,
    };
    if (this.entryNodes > this.limits.maxTotalParsedNodes) {
      throw new ResourceLoadError('GRAPH_NODE_LIMIT', 'Resource graph node limit exceeded by the entry document.', {
        limit: this.limits.maxTotalParsedNodes,
        actual: this.entryNodes,
        scope: 'graph',
      });
    }
    const collector = createCollector(this.entryRetrievalUri);
    addResourceTarget(collector, this.entryRetrievalUri, this.entryDocument, '#');
    walkOpenApiDocument(this.entryDocument, collector, true, 0, state.generation);
    if (collector.resources.size > this.limits.maxSchemaResources) {
      throw new ResourceLoadError('GRAPH_RESOURCE_LIMIT', 'Schema resource limit exceeded by the entry document.', {
        limit: this.limits.maxSchemaResources,
        actual: collector.resources.size,
        scope: 'graph',
      });
    }
    const collectors = new Map([[this.entryRetrievalUri, collector]]);
    this.assertCollectorsFit(state, collectors, 0);
    this.commitCollectors(state, collectors, new Set());
    const node = freezeNode({
      retrievalUri: this.entryRetrievalUri,
      retrievalUriHash: sha256Hex(this.entryRetrievalUri),
      displayUri: safeResourceDisplay(this.entryRetrievalUri),
      mediaType: 'application/json',
      byteLength: new TextEncoder().encode(this.entryText).byteLength,
      contentDigest: sha256Hex(this.entryText),
      documentKind: 'openapi',
      authorizationScope: 'entry',
      resourceUris: [...collector.resources.keys()].sort(),
      document: this.entryDocument,
    });
    state.nodes.set(this.entryRetrievalUri, node);
    this.refreshGraph(state);
    state.edges.forEach((edge) => {
      if (edge.state === 'local') edge.expanded = true;
    });
    return state;
  }

  private forkState(previous: MutableGraphState): MutableGraphState {
    this.generation += 1;
    return {
      generation: this.generation,
      nodes: new Map(previous.nodes),
      resourceTargets: new Map(previous.resourceTargets),
      anchorTargets: new Map(previous.anchorTargets),
      edges: previous.edges.map((edge) => ({ ...edge })),
      diagnostics: previous.diagnostics.map((diagnostic) =>
        Object.freeze({ ...diagnostic, generation: this.generation }),
      ),
      failures: new Map(previous.failures),
      attempts: new Map(previous.attempts),
      grants: new Map(previous.grants),
      totalBytes: previous.totalBytes,
      totalParsedNodes: previous.totalParsedNodes,
    };
  }

  private async runWave(
    state: MutableGraphState,
    signal?: AbortSignal,
    explicitRetryUri?: string,
  ): Promise<ResourceGraphSnapshot> {
    const controller = new AbortController();
    this.controller = controller;
    let waveTimedOut = false;
    const forwardAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });
    if (signal?.aborted) forwardAbort();
    const waveTimeout = setTimeout(() => {
      waveTimedOut = true;
      controller.abort();
    }, this.limits.waveTimeoutMs);

    try {
      for (;;) {
        if (this.state !== state) return this.graphSnapshot(this.state);
        this.refreshGraph(state);
        const eligible = this.candidates(state).filter((candidate) => {
          if (!state.grants.has(candidate.retrievalUriHash)) return false;
          if (candidate.state === 'failed' && candidate.retrievalUri !== explicitRetryUri) return false;
          return !state.nodes.has(candidate.retrievalUri) && !state.failures.has(candidate.retrievalUri);
        });
        if (eligible.length === 0) break;

        const ready: ResourceCandidate[] = [];
        let documentBudgetBlocked = false;
        for (const candidate of eligible) {
          if (ready.length >= this.limits.maxConcurrency) break;
          if (candidate.depth > this.limits.maxDepth) {
            throw new ResourceLoadError('GRAPH_DEPTH_LIMIT', 'Resource graph depth limit exceeded.', {
              limit: this.limits.maxDepth,
              actual: candidate.depth,
            });
          }
          const attempts = state.attempts.get(candidate.retrievalUri) ?? 0;
          if (attempts === 0 && state.attempts.size >= this.limits.maxDocuments) {
            documentBudgetBlocked = true;
            break;
          }
          state.attempts.set(candidate.retrievalUri, attempts + 1);
          ready.push(candidate);
        }
        if (ready.length === 0 && documentBudgetBlocked) {
          throw new ResourceLoadError('GRAPH_RESOURCE_LIMIT', 'Resource graph document limit exceeded.', {
            limit: this.limits.maxDocuments,
            actual: state.attempts.size + 1,
          });
        }

        await Promise.all(
          ready.map((candidate) => this.loadCandidate(state, candidate, controller.signal, waveTimedOut)),
        );
        if (controller.signal.aborted) {
          if (waveTimedOut) throw new ResourceLoadError('RESOURCE_TIMEOUT', 'Resource load wave timed out.');
          throw new ResourceLoadError('RESOURCE_ABORTED', 'Resource loading was cancelled.');
        }
      }
      this.refreshGraph(state);
      return this.graphSnapshot(state);
    } catch (error) {
      const failure =
        error instanceof ResourceLoadError
          ? waveTimedOut && error.code === 'RESOURCE_ABORTED'
            ? new ResourceLoadError('RESOURCE_TIMEOUT', 'Resource load wave timed out.')
            : error
          : new ResourceLoadError('RESOURCE_FETCH_BLOCKED', 'Resource graph loading failed.', {}, error);
      if (failure.code === 'STALE_GENERATION' || (failure.code === 'RESOURCE_ABORTED' && !waveTimedOut)) {
        return this.graphSnapshot(this.state === state ? state : this.state);
      }
      const fatal = this.isFatalGraphFailure(failure);
      state.diagnostics.push(
        genericDiagnostic(failure, phaseForError(failure), state.generation, this.entryRetrievalUri),
      );
      if (fatal) {
        controller.abort();
        const base = this.buildBaseState();
        base.grants.clear();
        state.grants.forEach((scope, key) => base.grants.set(key, scope));
        base.diagnostics.push(
          genericDiagnostic(failure, phaseForError(failure), base.generation, this.entryRetrievalUri),
        );
        this.state = base;
        return this.graphSnapshot(base);
      }
      return this.graphSnapshot(state);
    } finally {
      clearTimeout(waveTimeout);
      signal?.removeEventListener('abort', forwardAbort);
      if (this.controller === controller) this.controller = null;
    }
  }

  private async loadCandidate(
    state: MutableGraphState,
    candidate: ResourceCandidate,
    signal: AbortSignal,
    waveTimedOut: boolean,
  ): Promise<void> {
    if (this.state !== state)
      throw new ResourceLoadError('STALE_GENERATION', 'A newer resource graph generation is active.');
    const incoming = state.edges.filter((edge) => edge.targetRetrievalUri === candidate.retrievalUri);
    let fetched: FetchedExternalResource;
    try {
      fetched = await fetchExternalResource(candidate.retrievalUri, this.entryRetrievalUri, {
        pageUri: this.pageUri,
        authorizedUris: new Set([candidate.retrievalUri]),
        maxBytes: this.limits.maxResourceBytes,
        timeoutMs: this.limits.requestTimeoutMs,
        signal,
        fetchImpl: this.fetchImpl,
        accountBytes: (bytes) => {
          state.totalBytes += bytes;
          if (state.totalBytes > this.limits.maxTotalBytes) {
            throw new ResourceLoadError('RESOURCE_TOO_LARGE', 'Resource graph byte limit exceeded.', {
              limit: this.limits.maxTotalBytes,
              actual: state.totalBytes,
              scope: 'graph',
            });
          }
        },
      });
      const parsed = parseExternalResourceDocument(fetched, {
        maxParsedNodesPerDocument: this.limits.maxParsedNodesPerDocument,
        maxDepth: this.limits.maxDepth,
        maxYamlAliases: this.limits.maxYamlAliases,
      });
      if (signal.aborted) throw new ResourceLoadError('RESOURCE_ABORTED', 'Resource loading was cancelled.');
      if (this.state !== state)
        throw new ResourceLoadError('STALE_GENERATION', 'A newer resource graph generation is active.');
      if (state.totalParsedNodes + parsed.nodes > this.limits.maxTotalParsedNodes) {
        throw new ResourceLoadError('GRAPH_NODE_LIMIT', 'Resource graph node limit exceeded.', {
          limit: this.limits.maxTotalParsedNodes,
          actual: state.totalParsedNodes + parsed.nodes,
          scope: 'graph',
        });
      }
      const kind = documentKind(parsed.document, incoming);
      const collector = createCollector(candidate.retrievalUri);
      addResourceTarget(collector, candidate.retrievalUri, parsed.document, '#');
      if (kind === 'openapi') walkOpenApiDocument(parsed.document, collector, false, candidate.depth, state.generation);
      if (kind === 'json-schema') {
        walkSchema(parsed.document, '#', candidate.retrievalUri, collector, false, candidate.depth, state.generation);
      }
      const resourceUris = [...collector.resources.keys()].sort();
      const collectors = new Map<string, ScanCollector>([[candidate.retrievalUri, collector]]);
      this.assertCollectorsFit(state, collectors, parsed.nodes);
      const expandedEdges = this.expandReachableTargets(state, collectors);
      this.assertCollectorsFit(state, collectors, parsed.nodes);
      if (signal.aborted) throw new ResourceLoadError('RESOURCE_ABORTED', 'Resource loading was cancelled.');
      if (this.state !== state)
        throw new ResourceLoadError('STALE_GENERATION', 'A newer resource graph generation is active.');
      this.commitCollectors(state, collectors, expandedEdges);
      state.totalParsedNodes += parsed.nodes;
      const node = freezeNode({
        retrievalUri: candidate.retrievalUri,
        retrievalUriHash: candidate.retrievalUriHash,
        displayUri: candidate.displayUri,
        mediaType: fetched.mediaType.essence,
        byteLength: fetched.bytes,
        contentDigest: sha256Hex(fetched.text),
        documentKind: kind,
        authorizationScope: state.grants.get(candidate.retrievalUriHash) ?? 'generation',
        resourceUris,
        document: parsed.document,
      });
      state.nodes.set(candidate.retrievalUri, node);
      if (fetched.mediaType.legacy) {
        state.diagnostics.push(
          genericDiagnostic(
            new ResourceLoadError('LEGACY_MEDIA_TYPE', 'A deprecated YAML media type was accepted.'),
            'read',
            state.generation,
            candidate.retrievalUri,
            incoming[0],
          ),
        );
      }
    } catch (error) {
      const failure =
        error instanceof ResourceLoadError
          ? waveTimedOut && error.code === 'RESOURCE_ABORTED'
            ? new ResourceLoadError('RESOURCE_TIMEOUT', 'Resource load wave timed out.')
            : error
          : new ResourceLoadError(
              'DOCUMENT_PARSE_FAILED',
              'Unable to process the complete external document.',
              {},
              error,
            );
      if (failure.code === 'STALE_GENERATION' || (failure.code === 'RESOURCE_ABORTED' && signal.aborted)) throw failure;
      if (this.isFatalGraphFailure(failure)) throw failure;
      const phase = phaseForError(failure);
      state.failures.set(candidate.retrievalUri, { error: failure, phase });
      incoming.forEach((edge) => {
        edge.state = 'failed';
        state.diagnostics.push(genericDiagnostic(failure, phase, state.generation, edge.sourceRetrievalUri, edge));
      });
    }
  }

  private collectorFor(collectors: Map<string, ScanCollector>, ownerRetrievalUri: string): ScanCollector {
    const existing = collectors.get(ownerRetrievalUri);
    if (existing) return existing;
    const collector = createCollector(ownerRetrievalUri);
    collectors.set(ownerRetrievalUri, collector);
    return collector;
  }

  private targetFromCollectors(
    state: MutableGraphState,
    collectors: ReadonlyMap<string, ScanCollector>,
    edge: MutableEdge,
  ): IndexedTargetValue | undefined {
    const findResource = (uri: string): ResourceTarget | undefined => {
      for (const collector of collectors.values()) {
        const target = collector.resources.get(uri);
        if (target) return target;
      }
      return state.resourceTargets.get(uri);
    };
    const findAnchor = (uri: string): ResourceTarget | undefined => {
      for (const collector of collectors.values()) {
        const target = collector.anchors.get(uri);
        if (target) return target;
      }
      return state.anchorTargets.get(uri);
    };
    return expectedTargetValue(edge, findResource, findAnchor);
  }

  private expandReachableTargets(
    state: MutableGraphState,
    collectors: Map<string, ScanCollector>,
  ): ReadonlySet<string> {
    const expandedEdges = new Set<string>();
    for (;;) {
      const edges = new Map<string, MutableEdge>();
      state.edges.forEach((edge) => edges.set(edgeIdentity(edge), edge));
      collectors.forEach((collector) => {
        collector.edges.forEach((edge) => {
          if (!edges.has(edgeIdentity(edge))) edges.set(edgeIdentity(edge), edge);
        });
      });

      let progressed = false;
      for (const [identity, edge] of edges) {
        if (edge.state === 'failed' || edge.expanded || expandedEdges.has(identity)) continue;
        const target = this.targetFromCollectors(state, collectors, edge);
        if (!target) continue;
        const ownerCollector = this.collectorFor(collectors, target.ownerRetrievalUri);
        walkExpectedTarget(target, edge, ownerCollector, state.generation);
        expandedEdges.add(identity);
        progressed = true;
      }
      if (!progressed) return expandedEdges;
    }
  }

  private assertCollectorsFit(
    state: MutableGraphState,
    collectors: ReadonlyMap<string, ScanCollector>,
    parsedNodes: number,
  ): void {
    const referenceKeys = new Set(state.edges.map(edgeIdentity));
    collectors.forEach((collector) => collector.edges.forEach((edge) => referenceKeys.add(edgeIdentity(edge))));
    if (referenceKeys.size > this.limits.maxReferences) {
      throw new ResourceLoadError('GRAPH_REFERENCE_LIMIT', 'Resource graph reference limit exceeded.', {
        limit: this.limits.maxReferences,
        actual: referenceKeys.size,
      });
    }
    if (state.totalParsedNodes + parsedNodes > this.limits.maxTotalParsedNodes) {
      throw new ResourceLoadError('GRAPH_NODE_LIMIT', 'Resource graph node limit exceeded.', {
        limit: this.limits.maxTotalParsedNodes,
        actual: state.totalParsedNodes + parsedNodes,
        scope: 'graph',
      });
    }

    const resources = new Map(state.resourceTargets);
    collectors.forEach((collector) => {
      collector.resources.forEach((target, uri) => {
        const existing = resources.get(uri);
        if (
          existing &&
          (existing.ownerRetrievalUri !== target.ownerRetrievalUri || existing.pointer !== target.pointer)
        ) {
          throw new ResourceLoadError(
            'RESOURCE_URI_CONFLICT',
            'A Schema resource URI is already owned by another resource location.',
            { retrievalUri: uri },
          );
        }
        resources.set(uri, target);
      });
    });
    if (resources.size > this.limits.maxSchemaResources) {
      throw new ResourceLoadError('GRAPH_RESOURCE_LIMIT', 'Schema resource limit exceeded.', {
        limit: this.limits.maxSchemaResources,
        actual: resources.size,
      });
    }

    const anchors = new Map(state.anchorTargets);
    collectors.forEach((collector) => {
      collector.anchors.forEach((target, uri) => {
        const existing = anchors.get(uri);
        if (
          existing &&
          (existing.ownerRetrievalUri !== target.ownerRetrievalUri || existing.pointer !== target.pointer)
        ) {
          throw new ResourceLoadError(
            'RESOURCE_URI_CONFLICT',
            'A Schema anchor URI is already owned by another resource location.',
            { retrievalUri: uri },
          );
        }
        anchors.set(uri, target);
      });
    });
  }

  private commitCollectors(
    state: MutableGraphState,
    collectors: ReadonlyMap<string, ScanCollector>,
    expandedEdges: ReadonlySet<string>,
  ): void {
    const existingEdges = new Map(state.edges.map((edge) => [edgeIdentity(edge), edge]));
    state.edges.forEach((edge) => {
      if (expandedEdges.has(edgeIdentity(edge))) edge.expanded = true;
    });
    collectors.forEach((collector) => {
      collector.resources.forEach((target, uri) => {
        if (!state.resourceTargets.has(uri)) state.resourceTargets.set(uri, target);
      });
      collector.anchors.forEach((target, uri) => {
        if (!state.anchorTargets.has(uri)) state.anchorTargets.set(uri, target);
      });
      collector.edges.forEach((edge) => {
        const identity = edgeIdentity(edge);
        const existing = existingEdges.get(identity);
        if (existing) {
          if (expandedEdges.has(identity)) existing.expanded = true;
          return;
        }
        edge.expanded = expandedEdges.has(identity);
        state.edges.push(edge);
        existingEdges.set(identity, edge);
      });
      collector.diagnostics.forEach((diagnostic) => {
        const duplicate = state.diagnostics.some(
          (existing) =>
            existing.code === diagnostic.code &&
            existing.sourceRetrievalUriHash === diagnostic.sourceRetrievalUriHash &&
            existing.sourcePointer === diagnostic.sourcePointer &&
            existing.referenceKind === diagnostic.referenceKind,
        );
        if (!duplicate) state.diagnostics.push(diagnostic);
      });
    });
  }

  private refreshGraph(state: MutableGraphState): void {
    state.edges.forEach((edge) => {
      if (state.failures.has(edge.targetRetrievalUri)) {
        edge.state = 'failed';
        return;
      }
      const target = state.anchorTargets.get(edge.resolvedUri) ?? state.resourceTargets.get(edge.targetRetrievalUri);
      if (target) {
        const fragmentTarget = state.anchorTargets.get(edge.resolvedUri) ?? {
          ...target,
          value: resolveJsonPointer(target.value, edge.fragment),
        };
        if (fragmentTarget.value === undefined) {
          edge.state = 'failed';
          const error = new ResourceLoadError(
            'FRAGMENT_NOT_FOUND',
            'The complete resource document does not contain the referenced fragment.',
          );
          if (
            !state.diagnostics.some(
              (diagnostic) =>
                diagnostic.code === error.code &&
                diagnostic.sourcePointer === edge.sourcePointer &&
                diagnostic.sourceRetrievalUriHash === sha256Hex(edge.sourceRetrievalUri),
            )
          ) {
            state.diagnostics.push(genericDiagnostic(error, 'index', state.generation, edge.sourceRetrievalUri, edge));
          }
          return;
        }
        edge.state = target.ownerRetrievalUri === edge.sourceRetrievalUri ? 'local' : 'loaded';
        return;
      }
      if (edge.state !== 'failed') edge.state = 'pending';
      try {
        edge.targetRetrievalUri = normalizeExternalResourceUri(edge.resolvedUri, edge.resolutionBase, this.pageUri);
      } catch (error) {
        const failure =
          error instanceof ResourceLoadError
            ? error
            : new ResourceLoadError('RESOURCE_URI_INVALID', 'Resource URI is invalid.', {}, error);
        edge.state = 'failed';
        state.failures.set(edge.targetRetrievalUri || edge.resolvedUri, { error: failure, phase: 'authorize' });
        if (
          !state.diagnostics.some(
            (diagnostic) =>
              diagnostic.code === failure.code &&
              diagnostic.sourcePointer === edge.sourcePointer &&
              diagnostic.sourceRetrievalUriHash === sha256Hex(edge.sourceRetrievalUri),
          )
        ) {
          state.diagnostics.push(
            genericDiagnostic(failure, 'authorize', state.generation, edge.sourceRetrievalUri, edge),
          );
        }
      }
    });
  }

  private candidates(state: MutableGraphState): ResourceCandidate[] {
    const grouped = new Map<string, MutableEdge[]>();
    state.edges.forEach((edge) => {
      if (edge.state !== 'pending' && (edge.state !== 'failed' || !state.failures.has(edge.targetRetrievalUri))) return;
      if (!edge.targetRetrievalUri) return;
      const group = grouped.get(edge.targetRetrievalUri) ?? [];
      group.push(edge);
      grouped.set(edge.targetRetrievalUri, group);
    });
    return [...grouped.entries()]
      .map(([retrievalUri, edges]) => {
        const failure = state.failures.get(retrievalUri);
        const retrievalUriHash = sha256Hex(retrievalUri);
        let sameOrigin = false;
        try {
          sameOrigin = new URL(retrievalUri).origin === new URL(this.pageUri).origin;
        } catch {
          // Invalid URIs are retained only as failed diagnostics.
        }
        return Object.freeze({
          retrievalUri,
          retrievalUriHash,
          displayUri: safeResourceDisplay(retrievalUri),
          sameOrigin,
          depth: Math.min(...edges.map((edge) => edge.depth)),
          state: failure ? 'failed' : 'pending',
          retryable:
            failure && isRetryableResourceError(failure.error)
              ? (state.attempts.get(retrievalUri) ?? 0) < 1 + this.limits.maxExplicitRetriesPerResource
              : false,
          ...(failure ? { failureCode: failure.error.code } : {}),
          references: Object.freeze(
            edges.map((edge) =>
              Object.freeze({
                sourceDocumentUriHash: sha256Hex(edge.sourceRetrievalUri),
                sourcePointer: edge.sourcePointer,
                kind: edge.kind,
                rawReferenceDisplay: edge.rawReferenceDisplay,
                resolutionBaseDisplay: safeResourceDisplay(edge.resolutionBase),
                fragment: edge.fragment,
              }),
            ),
          ),
        }) satisfies ResourceCandidate;
      })
      .sort((left, right) => left.displayUri.localeCompare(right.displayUri));
  }

  private discoverySnapshot(state: MutableGraphState): ResourceDiscovery {
    return Object.freeze({
      generation: state.generation,
      documentScope: this.documentScope,
      candidates: Object.freeze(this.candidates(state)),
      diagnostics: Object.freeze([...state.diagnostics]),
    });
  }

  private graphSnapshot(state: MutableGraphState): ResourceGraphSnapshot {
    this.refreshGraph(state);
    const edges = Object.freeze(
      state.edges.map((edge) =>
        Object.freeze({
          sourceRetrievalUri: edge.sourceRetrievalUri,
          sourcePointer: edge.sourcePointer,
          kind: edge.kind,
          resolvedUri: edge.resolvedUri,
          targetRetrievalUri: edge.targetRetrievalUri,
          fragment: edge.fragment,
          state: edge.state,
        }),
      ),
    );
    return Object.freeze({
      generation: state.generation,
      entryRetrievalUri: this.entryRetrievalUri,
      documentScope: this.documentScope,
      nodes: readonlyMap(state.nodes),
      resourceTargets: readonlyMap(
        new Map(
          [...state.resourceTargets].map(([uri, target]) => [
            uri,
            Object.freeze({
              ownerRetrievalUri: target.ownerRetrievalUri,
              pointer: target.pointer,
              evaluationBaseUri: target.evaluationBaseUri,
            }),
          ]),
        ),
      ),
      anchorTargets: readonlyMap(
        new Map(
          [...state.anchorTargets].map(([uri, target]) => [
            uri,
            Object.freeze({
              ownerRetrievalUri: target.ownerRetrievalUri,
              pointer: target.pointer,
              evaluationBaseUri: target.evaluationBaseUri,
            }),
          ]),
        ),
      ),
      edges,
      diagnostics: Object.freeze([...state.diagnostics]),
      complete: edges.every((edge) => edge.state === 'local' || edge.state === 'loaded'),
    });
  }

  private isFatalGraphFailure(error: ResourceLoadError): boolean {
    if (error.code === 'RESOURCE_URI_CONFLICT') return true;
    if (
      error.code === 'GRAPH_RESOURCE_LIMIT' ||
      error.code === 'GRAPH_REFERENCE_LIMIT' ||
      error.code === 'GRAPH_DEPTH_LIMIT' ||
      error.code === 'GRAPH_NODE_LIMIT'
    ) {
      return error.details.scope !== 'document' && error.details.scope !== 'document-depth';
    }
    return error.code === 'RESOURCE_TOO_LARGE' && error.details.scope === 'graph';
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('ExternalResourceLoader has been disposed.');
  }
}

export function schemaDocumentsFromResourceGraph(
  snapshot: ResourceGraphSnapshot,
): readonly { retrievalUri: string; document: unknown }[] {
  return Object.freeze(
    [...snapshot.nodes.values()]
      .filter(
        (node) =>
          node.retrievalUri !== snapshot.entryRetrievalUri &&
          (node.documentKind === 'openapi' || node.documentKind === 'json-schema'),
      )
      .sort((left, right) => left.retrievalUri.localeCompare(right.retrievalUri))
      .map((node) => Object.freeze({ retrievalUri: node.retrievalUri, document: node.document })),
  );
}
