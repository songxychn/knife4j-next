import type { MenuOperation, SwaggerDoc, SwaggerServer } from '../../types/swagger';

export interface ResolveRequestBaseUrlOptions {
  swaggerDoc: SwaggerDoc | null;
  operation?: MenuOperation | null;
  enableHost: boolean;
  enableHostText: string;
  origin: string;
}

interface NormalizeRequestBaseUrlOptions {
  upgradeSameHostHttpToHttps?: boolean;
}

export function currentOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

function shouldUpgradeSameHostHttpUrl(url: URL, origin: URL): boolean {
  return origin.protocol === 'https:' && url.protocol === 'http:' && url.hostname === origin.hostname;
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
    if (options.upgradeSameHostHttpToHttps && shouldUpgradeSameHostHttpUrl(requestUrl, originUrl)) {
      requestUrl.protocol = originUrl.protocol;
    }
    return trimTrailingSlashes(requestUrl.toString());
  } catch {
    return trimTrailingSlashes(trimmed);
  }
}

function firstServerUrl(servers: SwaggerServer[] | undefined): string | undefined {
  return servers?.find((server) => server.url.trim())?.url;
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

  const pathItem = operation ? swaggerDoc?.paths[operation.path] : undefined;
  const serverUrl =
    firstServerUrl(operation?.operation.servers) ??
    firstServerUrl(pathItem?.servers) ??
    firstServerUrl(swaggerDoc?.servers);
  if (serverUrl) {
    return normalizeRequestBaseUrl(serverUrl, origin, {
      upgradeSameHostHttpToHttps: true,
    });
  }

  return normalizeRequestBaseUrl(origin, origin);
}
