import type { MenuOperation, SwaggerDoc, SwaggerServer } from '../../types/swagger';

export interface ResolveRequestBaseUrlOptions {
  swaggerDoc: SwaggerDoc | null;
  operation?: MenuOperation | null;
  enableHost: boolean;
  enableHostText: string;
  origin: string;
}

export function currentOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

export function normalizeRequestBaseUrl(url: string, origin: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimTrailingSlashes(origin);

  try {
    return trimTrailingSlashes(new URL(trimmed, `${origin.replace(/\/+$/, '')}/`).toString());
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
    return normalizeRequestBaseUrl(serverUrl, origin);
  }

  return normalizeRequestBaseUrl(origin, origin);
}
