import type { MenuOperation, SwaggerDoc, SwaggerServer } from '../../types/swagger';

export interface ResolveRequestBaseUrlOptions {
  swaggerDoc: SwaggerDoc | null;
  operation?: MenuOperation | null;
  enableHost: boolean;
  enableHostText: string;
  groupContextPath?: string;
  origin: string;
}

export type RequestServerSource = 'gateway' | 'operation' | 'path' | 'document';

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

function explicitPortFromAuthority(authority: string): string | undefined {
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  const ipv6PortMatch = /^\[[^\]]+\]:(\d+)$/.exec(hostPort);
  if (ipv6PortMatch) return ipv6PortMatch[1];
  if (hostPort.startsWith('[')) return undefined;

  return /:(\d+)$/.exec(hostPort)?.[1];
}

function explicitPortFromUrlText(url: string): string | undefined {
  const absoluteAuthority = /^[a-z][a-z\d+\-.]*:\/\/([^/?#]*)/i.exec(url)?.[1];
  const protocolRelativeAuthority = /^\/\/([^/?#]*)/.exec(url)?.[1];
  const authority = absoluteAuthority ?? protocolRelativeAuthority;

  return authority ? explicitPortFromAuthority(authority) : undefined;
}

function alignSameHostWithHttpsOrigin(url: URL, origin: URL, explicitPort: string | undefined): void {
  if (origin.protocol !== 'https:' || url.hostname !== origin.hostname) return;

  if (url.protocol === 'http:') {
    url.protocol = origin.protocol;
  }
  if (explicitPort) {
    url.port = explicitPort;
    return;
  }
  if (origin.port && !url.port) {
    url.port = origin.port;
  }
}

function normalizeGroupContextPath(contextPath: string | undefined): string {
  const trimmed = contextPath?.trim() ?? '';
  if (!trimmed || trimmed === '/') return '';
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function appendContextPath(baseUrl: string, contextPath: string | undefined, origin: string): string {
  const normalizedBaseUrl = normalizeRequestBaseUrl(baseUrl, origin);
  const normalizedContextPath = normalizeGroupContextPath(contextPath);
  if (!normalizedContextPath) return normalizedBaseUrl;

  try {
    const url = new URL(normalizedBaseUrl);
    const basePath = trimTrailingSlashes(url.pathname);
    const hasContextPath = basePath === normalizedContextPath || basePath.endsWith(normalizedContextPath);
    if (!hasContextPath) {
      url.pathname = basePath && basePath !== '/' ? `${basePath}${normalizedContextPath}` : normalizedContextPath;
    }
    return trimTrailingSlashes(url.toString());
  } catch {
    return normalizedBaseUrl.endsWith(normalizedContextPath)
      ? normalizedBaseUrl
      : `${trimTrailingSlashes(normalizedBaseUrl)}${normalizedContextPath}`;
  }
}

function resolveGatewayContextBaseUrl(origin: string, groupContextPath: string | undefined): string | null {
  const normalizedContextPath = normalizeGroupContextPath(groupContextPath);
  if (!normalizedContextPath) return null;
  return appendContextPath(origin, groupContextPath, origin);
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
      alignSameHostWithHttpsOrigin(requestUrl, originUrl, explicitPortFromUrlText(trimmed));
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
  groupContextPath,
  origin,
}: Pick<
  ResolveRequestBaseUrlOptions,
  'swaggerDoc' | 'operation' | 'groupContextPath' | 'origin'
>): RequestServerOption[] {
  const pathItem = operation ? swaggerDoc?.paths[operation.path] : undefined;
  const result: RequestServerOption[] = [];
  const seen = new Set<string>();
  const gatewayContextBaseUrl = resolveGatewayContextBaseUrl(origin, groupContextPath);

  if (gatewayContextBaseUrl) {
    seen.add(gatewayContextBaseUrl);
    result.push({
      source: 'gateway',
      url: gatewayContextBaseUrl,
      rawUrl: normalizeGroupContextPath(groupContextPath),
    });
  }

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
  groupContextPath,
  origin,
}: ResolveRequestBaseUrlOptions): string {
  const hostOverride = enableHost ? enableHostText.trim() : '';
  if (hostOverride) {
    return normalizeRequestBaseUrl(hostOverride, origin);
  }

  const serverUrl = resolveRequestServerOptions({ swaggerDoc, operation, groupContextPath, origin })[0]?.url;
  if (serverUrl) {
    return serverUrl;
  }

  return normalizeRequestBaseUrl(origin, origin);
}
