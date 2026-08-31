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
  | 'LEGACY_MEDIA_TYPE'
  | 'RESOURCE_TOO_LARGE'
  | 'RESOURCE_ENCODING_UNSUPPORTED'
  | 'RESOURCE_ABORTED'
  | 'RESOURCE_TIMEOUT'
  | 'DOCUMENT_PARSE_FAILED'
  | 'DOCUMENT_KIND_MISMATCH'
  | 'DIALECT_UNSUPPORTED'
  | 'RESOURCE_URI_CONFLICT'
  | 'FRAGMENT_NOT_FOUND'
  | 'GRAPH_RESOURCE_LIMIT'
  | 'GRAPH_REFERENCE_LIMIT'
  | 'GRAPH_DEPTH_LIMIT'
  | 'GRAPH_NODE_LIMIT'
  | 'STALE_GENERATION';

export type ResourceLoadErrorDetails = Readonly<Record<string, string | number | boolean>>;

export class ResourceLoadError extends Error {
  public readonly code: ResourceLoadErrorCode;
  public readonly details: ResourceLoadErrorDetails;
  public readonly cause?: unknown;

  public constructor(
    code: ResourceLoadErrorCode,
    message: string,
    details: Record<string, string | number | boolean> = {},
    cause?: unknown,
  ) {
    super(message);
    this.name = 'ResourceLoadError';
    this.code = code;
    this.details = Object.freeze({ ...details });
    if (cause !== undefined) this.cause = cause;
  }
}

export interface ResourceMediaType {
  readonly format: ResourceDocumentFormat;
  readonly legacy: boolean;
  readonly essence: string;
}

export interface FetchExternalResourceOptions {
  readonly pageUri: string;
  readonly authorizedUris: ReadonlySet<string>;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  /** Called for every decoded response chunk before it is retained. */
  readonly accountBytes?: (bytes: number) => void;
}

export interface FetchedExternalResource {
  readonly retrievalUri: string;
  readonly mediaType: ResourceMediaType;
  readonly bytes: number;
  readonly text: string;
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

const positiveSafeInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer.`);
};

/** Resolve an exact HTTP(S) retrieval identity and remove only its fragment. */
export function normalizeExternalResourceUri(reference: string, baseUri: string, pageUri = baseUri): string {
  let target: URL;
  let page: URL;
  try {
    target = new URL(reference, baseUri);
    page = new URL(pageUri);
  } catch (error) {
    throw new ResourceLoadError(
      'RESOURCE_URI_INVALID',
      'The external resource URI cannot be resolved against its document base.',
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
      'An HTTPS page cannot authorize an HTTP external resource.',
    );
  }

  target.hash = '';
  return target.href;
}

export function classifyExternalResourceMediaType(value: string | null): ResourceMediaType {
  const essence = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (essence === 'application/json' || essence.endsWith('+json')) {
    return Object.freeze({ format: 'json', legacy: false, essence });
  }
  if (essence === 'application/yaml' || essence.endsWith('+yaml')) {
    return Object.freeze({ format: 'yaml', legacy: false, essence });
  }
  if (LEGACY_YAML_TYPES.has(essence)) {
    return Object.freeze({ format: 'yaml', legacy: true, essence });
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
    // Transport cleanup must not replace the stable policy diagnostic.
  }
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  accountBytes?: (bytes: number) => void,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelResponseBody(response, 'resource byte limit exceeded');
    throw new ResourceLoadError('RESOURCE_TOO_LARGE', 'Resource byte limit exceeded.', {
      limit: maxBytes,
      actual: declaredLength,
      scope: 'resource',
    });
  }

  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    let result = await reader.read();
    while (!result.done) {
      const { value } = result;
      total += value.byteLength;
      try {
        accountBytes?.(value.byteLength);
      } catch (error) {
        try {
          await reader.cancel('resource graph byte limit exceeded');
        } catch {
          // Preserve the graph budget diagnostic.
        }
        throw error;
      }
      if (total > maxBytes) {
        try {
          await reader.cancel('resource byte limit exceeded');
        } catch {
          // Preserve RESOURCE_TOO_LARGE even when stream cleanup fails.
        }
        throw new ResourceLoadError('RESOURCE_TOO_LARGE', 'Resource byte limit exceeded.', {
          limit: maxBytes,
          actual: total,
          scope: 'resource',
        });
      }
      chunks.push(value);
      result = await reader.read();
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

/** Execute the frozen no-ambient-authority browser request contract. */
export async function fetchExternalResource(
  reference: string,
  baseUri: string,
  options: FetchExternalResourceOptions,
): Promise<FetchedExternalResource> {
  positiveSafeInteger('maxBytes', options.maxBytes);
  positiveSafeInteger('timeoutMs', options.timeoutMs);
  const retrievalUri = normalizeExternalResourceUri(reference, baseUri, options.pageUri);
  if (!options.authorizedUris.has(retrievalUri)) {
    throw new ResourceLoadError(
      options.authorizedUris.size === 0 ? 'RESOURCE_LOADING_DISABLED' : 'RESOURCE_NOT_AUTHORIZED',
      'The exact external resource URI has not been explicitly authorized.',
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
      throw new ResourceLoadError(
        'RESOURCE_HTTP_STATUS',
        `Resource returned HTTP ${response.status}; 200 is required.`,
        {
          status: response.status,
        },
      );
    }

    let mediaType: ResourceMediaType;
    try {
      mediaType = classifyExternalResourceMediaType(response.headers.get('content-type'));
    } catch (error) {
      await cancelResponseBody(response, 'resource media type rejected');
      throw error;
    }

    const body = await readBoundedBody(response, options.maxBytes, options.accountBytes);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch (error) {
      throw new ResourceLoadError(
        'RESOURCE_ENCODING_UNSUPPORTED',
        'External resource bodies must be valid UTF-8.',
        {},
        error,
      );
    }
    return Object.freeze({ retrievalUri, mediaType, bytes: body.byteLength, text });
  } catch (error) {
    if (error instanceof ResourceLoadError) throw error;
    if (options.signal?.aborted) {
      throw new ResourceLoadError('RESOURCE_ABORTED', 'Resource loading was cancelled.', {}, error);
    }
    if (timedOut) {
      throw new ResourceLoadError('RESOURCE_TIMEOUT', 'Resource loading timed out.', {}, error);
    }
    throw new ResourceLoadError(
      'RESOURCE_FETCH_BLOCKED',
      'The browser blocked or could not complete the resource request. CSP, CORS, redirects, TLS, and network failures are intentionally not guessed from an opaque fetch error.',
      {},
      error,
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

export function isRetryableResourceError(error: ResourceLoadError): boolean {
  if (error.code === 'RESOURCE_FETCH_BLOCKED' || error.code === 'RESOURCE_TIMEOUT') return true;
  if (error.code !== 'RESOURCE_HTTP_STATUS') return false;
  const status = error.details.status;
  return typeof status === 'number' && (status === 408 || status === 429 || status >= 500);
}
