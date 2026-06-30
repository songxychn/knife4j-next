import type { MenuOperation, SwaggerDoc, SwaggerServer } from '../../types/swagger';

export interface ResolveRequestBaseUrlOptions {
  swaggerDoc: SwaggerDoc | null;
  operation?: MenuOperation | null;
  enableHost: boolean;
  enableHostText: string;
  origin: string;
}

export type RequestServerSource = 'operation' | 'path' | 'document';

export interface RequestServerOption {
  source: RequestServerSource;
  url: string;
  rawUrl: string;
  description?: string;
}

export interface NormalizeRequestBaseUrlOptions {
  preferHttpsOriginForSameHost?: boolean;
}

export function currentOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

function alignSameHostWithHttpsOrigin(url: URL, origin: URL): void {
  if (origin.protocol !== 'https:' || url.hostname !== origin.hostname) return;

  if (url.protocol === 'http:') {
    url.protocol = origin.protocol;
  }
  if (origin.port && !url.port) {
    url.port = origin.port;
  }
}

export function normalizeRequestBaseUrl(
  url: string,
  origin: string,
  options: NormalizeRequestBaseUrlOptions = {},
): string {
  const trimmed = url.trim();
  if (!trimmed) return trimTrailingSlashes(origin);

  try {
    const originUrl = new URL(`${origin.replace(/\/+$/, '')}/`);
    const requestUrl = new URL(trimmed, originUrl);
    if (options.preferHttpsOriginForSameHost) {
      alignSameHostWithHttpsOrigin(requestUrl, originUrl);
    }
    return trimTrailingSlashes(requestUrl.toString());
  } catch {
    return trimTrailingSlashes(trimmed);
  }
}

function appendServerOptions(
  result: RequestServerOption[],
  seen: Set<string>,
  source: RequestServerSource,
  servers: SwaggerServer[] | undefined,
  origin: string,
): void {
  if (!servers) return;

  for (const server of servers) {
    const rawUrl = server.url.trim();
    if (!rawUrl) continue;

    const url = normalizeRequestBaseUrl(rawUrl, origin, {
      preferHttpsOriginForSameHost: true,
    });
    if (seen.has(url)) continue;

    seen.add(url);
    result.push({
      source,
      url,
      rawUrl,
      description: server.description,
    });
  }
}

export function resolveRequestServerOptions({
  swaggerDoc,
  operation,
  origin,
}: Pick<ResolveRequestBaseUrlOptions, 'swaggerDoc' | 'operation' | 'origin'>): RequestServerOption[] {
  const pathItem = operation ? swaggerDoc?.paths[operation.path] : undefined;
  const result: RequestServerOption[] = [];
  const seen = new Set<string>();

  appendServerOptions(result, seen, 'operation', operation?.operation.servers, origin);
  appendServerOptions(result, seen, 'path', pathItem?.servers, origin);
  appendServerOptions(result, seen, 'document', swaggerDoc?.servers, origin);

  return result;
}

export function resolveRequestBaseUrl({
  swaggerDoc,
  operation,
  enableHost,
  enableHostText,
  origin,
}: ResolveRequestBaseUrlOptions): string {
  const hostOverride = enableHost ? enableHostText.trim() : '';
  if (hostOverride) {
    return normalizeRequestBaseUrl(hostOverride, origin);
  }

  const serverUrl = resolveRequestServerOptions({ swaggerDoc, operation, origin })[0]?.url;
  if (serverUrl) {
    return serverUrl;
  }

  return normalizeRequestBaseUrl(origin, origin);
}
