export type ResourceDocumentFormat = 'json' | 'yaml';

export type ResourceLoadErrorCode =
  | 'RESOURCE_LOADING_DISABLED'
  | 'RESOURCE_NOT_AUTHORIZED'
  | 'RESOURCE_URI_INVALID'
  | 'RESOURCE_URI_CREDENTIALS_FORBIDDEN'
  | 'RESOURCE_SCHEME_UNSUPPORTED'
  | 'RESOURCE_MIXED_CONTENT_BLOCKED'
  | 'RESOURCE_FETCH_BLOCKED'
  | 'RESOURCE_HTTP_STATUS'
  | 'RESOURCE_CONTENT_TYPE_UNSUPPORTED'
  | 'RESOURCE_TOO_LARGE'
  | 'RESOURCE_ENCODING_UNSUPPORTED'
  | 'RESOURCE_ABORTED'
  | 'RESOURCE_TIMEOUT'
  | 'GRAPH_RESOURCE_LIMIT'
  | 'GRAPH_REFERENCE_LIMIT'
  | 'GRAPH_DEPTH_LIMIT'
  | 'DOCUMENT_PARSE_FAILED';

export class ResourceLoadError extends Error {
  public readonly code: ResourceLoadErrorCode;
  public readonly details: Readonly<Record<string, string | number | boolean>>;

  public constructor(
    code: ResourceLoadErrorCode,
    message: string,
    details: Record<string, string | number | boolean> = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ResourceLoadError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export interface ResourceMediaType {
  format: ResourceDocumentFormat;
  legacy: boolean;
  essence: string;
}

export interface FetchResourceOptions {
  pageUri: string;
  authorizedUris: ReadonlySet<string>;
  maxBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface FetchedResource {
  retrievalUri: string;
  mediaType: ResourceMediaType;
  bytes: number;
  text: string;
}

export interface ProbeGraphLimits {
  maxResources: number;
  maxReferences: number;
  maxDepth: number;
}

export interface ProbeGraph {
  documents: ReadonlyMap<string, unknown>;
  references: number;
  edges: ReadonlyArray<{ from: string; to: string }>;
  cycles: ReadonlyArray<{ from: string; to: string }>;
}

export const RESOURCE_ACCEPT_HEADER = [
  'application/openapi+json',
  'application/openapi+yaml',
  'application/schema+json',
  'application/json',
  'application/yaml',
].join(', ');

const SUPPORTED_SCHEMES = new Set(['http:', 'https:']);
const LEGACY_YAML_TYPES = new Set(['application/x-yaml', 'text/yaml', 'text/x-yaml']);

const positiveInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer.`);
  }
};

export function normalizeResourceDocumentUri(reference: string, baseUri: string, pageUri = baseUri): string {
  let target: URL;
  let page: URL;
  try {
    target = new URL(reference, baseUri);
    page = new URL(pageUri);
  } catch (error) {
    throw new ResourceLoadError(
      'RESOURCE_URI_INVALID',
      `Resource URI '${reference}' cannot be resolved against '${baseUri}'.`,
      {},
      error,
    );
  }

  if (target.username || target.password) {
    throw new ResourceLoadError(
      'RESOURCE_URI_CREDENTIALS_FORBIDDEN',
      'Resource URIs containing a username or password are not allowed.',
    );
  }
  if (!SUPPORTED_SCHEMES.has(target.protocol)) {
    throw new ResourceLoadError(
      'RESOURCE_SCHEME_UNSUPPORTED',
      `Resource URI scheme '${target.protocol}' is not supported.`,
      { scheme: target.protocol },
    );
  }
  if (page.protocol === 'https:' && target.protocol === 'http:') {
    throw new ResourceLoadError(
      'RESOURCE_MIXED_CONTENT_BLOCKED',
      'An HTTPS document cannot authorize an HTTP external resource.',
    );
  }

  target.hash = '';
  return target.href;
}

export function classifyResourceMediaType(value: string | null): ResourceMediaType {
  const essence = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (essence === 'application/json' || essence.endsWith('+json')) {
    return { format: 'json', legacy: false, essence };
  }
  if (essence === 'application/yaml' || essence.endsWith('+yaml')) {
    return { format: 'yaml', legacy: false, essence };
  }
  if (LEGACY_YAML_TYPES.has(essence)) {
    return { format: 'yaml', legacy: true, essence };
  }
  throw new ResourceLoadError(
    'RESOURCE_CONTENT_TYPE_UNSUPPORTED',
    `Resource media type '${essence || '(missing)'}' is not an accepted JSON or YAML document type.`,
    { mediaType: essence || '(missing)' },
  );
}

async function cancelResponseBody(response: Response, reason: string): Promise<void> {
  try {
    await response.body?.cancel(reason);
  } catch {
    // A failed transport cleanup must not replace the stable policy diagnostic.
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelResponseBody(response, 'resource byte limit exceeded');
    throw new ResourceLoadError('RESOURCE_TOO_LARGE', 'Resource byte limit exceeded.', {
      limit: maxBytes,
      actual: declaredLength,
    });
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel('resource byte limit exceeded');
        } catch {
          // Preserve RESOURCE_TOO_LARGE even when stream cleanup fails.
        }
        throw new ResourceLoadError('RESOURCE_TOO_LARGE', 'Resource byte limit exceeded.', {
          limit: maxBytes,
          actual: total,
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function fetchAuthorizedResource(
  reference: string,
  baseUri: string,
  options: FetchResourceOptions,
): Promise<FetchedResource> {
  positiveInteger('maxBytes', options.maxBytes);
  positiveInteger('timeoutMs', options.timeoutMs);
  const retrievalUri = normalizeResourceDocumentUri(reference, baseUri, options.pageUri);
  if (!options.authorizedUris.has(retrievalUri)) {
    throw new ResourceLoadError(
      options.authorizedUris.size === 0 ? 'RESOURCE_LOADING_DISABLED' : 'RESOURCE_NOT_AUTHORIZED',
      `Resource '${retrievalUri}' has not been explicitly authorized.`,
      { retrievalUri },
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);

  try {
    const response = await (options.fetchImpl ?? fetch)(retrievalUri, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      headers: { Accept: RESOURCE_ACCEPT_HEADER },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      await cancelResponseBody(response, 'HTTP status rejected');
      throw new ResourceLoadError('RESOURCE_HTTP_STATUS', `Resource returned HTTP ${response.status}; 200 is required.`, {
        status: response.status,
        retrievalUri,
      });
    }
    let mediaType: ResourceMediaType;
    try {
      mediaType = classifyResourceMediaType(response.headers.get('content-type'));
    } catch (error) {
      await cancelResponseBody(response, 'resource media type rejected');
      throw error;
    }
    const body = await readBoundedBody(response, options.maxBytes);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch (error) {
      throw new ResourceLoadError(
        'RESOURCE_ENCODING_UNSUPPORTED',
        'External resource bodies must be valid UTF-8.',
        { retrievalUri },
        error,
      );
    }
    return { retrievalUri, mediaType, bytes: body.byteLength, text };
  } catch (error) {
    if (error instanceof ResourceLoadError) throw error;
    if (options.signal?.aborted) {
      throw new ResourceLoadError('RESOURCE_ABORTED', 'Resource loading was cancelled.', { retrievalUri }, error);
    }
    if (timedOut) {
      throw new ResourceLoadError('RESOURCE_TIMEOUT', 'Resource loading timed out.', { retrievalUri }, error);
    }
    throw new ResourceLoadError(
      'RESOURCE_FETCH_BLOCKED',
      'The browser blocked or could not complete the resource request. CSP, CORS, redirects, TLS, and network failures are intentionally not guessed from an opaque fetch error.',
      { retrievalUri },
      error,
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

function collectProbeSchemaReferences(value: unknown): string[] {
  const references: string[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (candidate === null || typeof candidate !== 'object') return;
    for (const [key, child] of Object.entries(candidate)) {
      if ((key === '$ref' || key === '$dynamicRef') && typeof child === 'string') references.push(child);
      else visit(child);
    }
  };
  visit(value);
  return references;
}

export async function loadProbeSchemaGraph(
  rootUri: string,
  fetchDocument: (uri: string) => Promise<FetchedResource>,
  limits: ProbeGraphLimits,
  pageUri: string,
): Promise<ProbeGraph> {
  positiveInteger('maxResources', limits.maxResources);
  positiveInteger('maxReferences', limits.maxReferences);
  positiveInteger('maxDepth', limits.maxDepth);
  const root = normalizeResourceDocumentUri(rootUri, rootUri, pageUri);
  const documents = new Map<string, unknown>();
  const edges: Array<{ from: string; to: string }> = [];
  const cycles: Array<{ from: string; to: string }> = [];
  let references = 0;

  const visit = async (uri: string, depth: number, ancestors: ReadonlySet<string>): Promise<void> => {
    if (depth > limits.maxDepth) {
      throw new ResourceLoadError('GRAPH_DEPTH_LIMIT', 'Resource graph depth limit exceeded.', {
        limit: limits.maxDepth,
        actual: depth,
      });
    }
    if (ancestors.has(uri)) return;
    if (documents.has(uri)) return;
    if (documents.size >= limits.maxResources) {
      throw new ResourceLoadError('GRAPH_RESOURCE_LIMIT', 'Resource graph document limit exceeded.', {
        limit: limits.maxResources,
        actual: documents.size + 1,
      });
    }

    const loaded = await fetchDocument(uri);
    if (loaded.mediaType.format !== 'json') {
      throw new ResourceLoadError('DOCUMENT_PARSE_FAILED', 'The minimal graph probe expects JSON fixtures.');
    }
    let document: unknown;
    try {
      document = JSON.parse(loaded.text);
    } catch (error) {
      throw new ResourceLoadError('DOCUMENT_PARSE_FAILED', 'Unable to parse the complete JSON document.', {}, error);
    }
    documents.set(uri, document);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(uri);

    for (const reference of collectProbeSchemaReferences(document)) {
      references += 1;
      if (references > limits.maxReferences) {
        throw new ResourceLoadError('GRAPH_REFERENCE_LIMIT', 'Resource graph reference limit exceeded.', {
          limit: limits.maxReferences,
          actual: references,
        });
      }
      const target = normalizeResourceDocumentUri(reference, uri, pageUri);
      if (target === uri) continue;
      edges.push({ from: uri, to: target });
      if (nextAncestors.has(target)) {
        cycles.push({ from: uri, to: target });
        continue;
      }
      await visit(target, depth + 1, nextAncestors);
    }
  };

  await visit(root, 0, new Set());
  return {
    documents,
    references,
    edges: Object.freeze(edges.map((edge) => Object.freeze({ ...edge }))),
    cycles: Object.freeze(cycles.map((edge) => Object.freeze({ ...edge }))),
  };
}
