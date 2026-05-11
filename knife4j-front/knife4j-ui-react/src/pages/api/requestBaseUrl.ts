import type { SwaggerDoc } from '../../types/swagger';

export interface ResolveRequestBaseUrlOptions {
  swaggerDoc: SwaggerDoc | null;
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

export function resolveRequestBaseUrl({
  swaggerDoc,
  enableHost,
  enableHostText,
  origin,
}: ResolveRequestBaseUrlOptions): string {
  const hostOverride = enableHost ? enableHostText.trim() : '';
  if (hostOverride) {
    return normalizeRequestBaseUrl(hostOverride, origin);
  }

  const serverUrl = swaggerDoc?.servers?.find((server) => server.url.trim())?.url;
  if (serverUrl) {
    return normalizeRequestBaseUrl(serverUrl, origin);
  }

  return normalizeRequestBaseUrl(origin, origin);
}
