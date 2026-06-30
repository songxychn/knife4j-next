import type { SwaggerDoc, SwaggerServer } from '../types/swagger';
import { currentOrigin, normalizeRequestBaseUrl } from './api/requestBaseUrl';

export function currentHomeOrigin(): string {
  return currentOrigin();
}

function normalizeHomeServerUrl(url: string, origin: string): string {
  const trimmed = url.trim();
  if (!trimmed) return url;
  return normalizeRequestBaseUrl(trimmed, origin, {
    preferHttpsOriginForSameHost: true,
  });
}

export function normalizeHomeHost(host: string | undefined, origin: string): string | undefined {
  const trimmed = host?.trim();
  if (!trimmed) return undefined;

  try {
    const originUrl = new URL(`${origin.replace(/\/+$/, '')}/`);
    const hostUrl = new URL(trimmed.includes('://') ? trimmed : `${originUrl.protocol}//${trimmed}`);
    if (originUrl.protocol === 'https:' && hostUrl.hostname === originUrl.hostname && originUrl.port && !hostUrl.port) {
      hostUrl.port = originUrl.port;
      return hostUrl.host;
    }
  } catch {
    // Keep the original host text when it is not URL-like.
  }

  return trimmed;
}

function legacySwaggerServers(swaggerDoc: SwaggerDoc): SwaggerServer[] {
  if (!swaggerDoc.host) return [];
  const schemes = swaggerDoc.schemes && swaggerDoc.schemes.length > 0 ? swaggerDoc.schemes : ['http'];
  return schemes.map((scheme) => ({
    url: `${scheme}://${swaggerDoc.host}${swaggerDoc.basePath ?? ''}`,
  }));
}

export function resolveHomeServers(
  swaggerDoc: SwaggerDoc | null | undefined,
  origin: string = currentHomeOrigin(),
): SwaggerServer[] {
  if (!swaggerDoc) return [];

  const sourceServers =
    swaggerDoc.servers && swaggerDoc.servers.length > 0 ? swaggerDoc.servers : legacySwaggerServers(swaggerDoc);

  return sourceServers.map((server) => ({
    ...server,
    url: normalizeHomeServerUrl(server.url, origin),
  }));
}

export function resolveHomeHostLabel(
  swaggerDoc: SwaggerDoc | null | undefined,
  servers: SwaggerServer[],
  origin: string = currentHomeOrigin(),
): string {
  const explicitHost = normalizeHomeHost(swaggerDoc?.host, origin);
  if (explicitHost) return explicitHost;

  const primaryServerUrl = servers[0]?.url;
  if (!primaryServerUrl) return '-';

  try {
    const parsed = new URL(primaryServerUrl, origin);
    return parsed.host || primaryServerUrl;
  } catch {
    return primaryServerUrl;
  }
}
