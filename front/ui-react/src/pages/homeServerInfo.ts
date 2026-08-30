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

function explicitPortFromHostText(host: string): string | undefined {
  const absoluteAuthority = /^[a-z][a-z\d+\-.]*:\/\/([^/?#]*)/i.exec(host)?.[1];
  const protocolRelativeAuthority = /^\/\/([^/?#]*)/.exec(host)?.[1];
  const authority = absoluteAuthority ?? protocolRelativeAuthority ?? host.split(/[/?#]/)[0];
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  const ipv6PortMatch = /^\[[^\]]+\]:(\d+)$/.exec(hostPort);
  if (ipv6PortMatch) return ipv6PortMatch[1];
  if (hostPort.startsWith('[')) return undefined;

  return /:(\d+)$/.exec(hostPort)?.[1];
}

export function normalizeHomeHost(host: string | undefined, origin: string): string | undefined {
  const trimmed = host?.trim();
  if (!trimmed) return undefined;

  try {
    const originUrl = new URL(`${origin.replace(/\/+$/, '')}/`);
    const hostUrl = new URL(trimmed.includes('://') ? trimmed : `${originUrl.protocol}//${trimmed}`);
    if (
      originUrl.protocol === 'https:' &&
      hostUrl.hostname === originUrl.hostname &&
      originUrl.port &&
      !hostUrl.port &&
      !explicitPortFromHostText(trimmed)
    ) {
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
  const configuredSchemes = Array.isArray(swaggerDoc.schemes)
    ? swaggerDoc.schemes.filter((scheme): scheme is string => typeof scheme === 'string')
    : [];
  const schemes = configuredSchemes.length > 0 ? configuredSchemes : ['http'];
  return schemes.map((scheme) => ({
    url: `${scheme}://${swaggerDoc.host}${swaggerDoc.basePath ?? ''}`,
  }));
}

export function resolveHomeServers(
  swaggerDoc: SwaggerDoc | null | undefined,
  origin: string = currentHomeOrigin(),
): SwaggerServer[] {
  if (!swaggerDoc) return [];

  const validServers = Array.isArray(swaggerDoc.servers)
    ? swaggerDoc.servers.filter(
        (server): server is SwaggerServer =>
          server !== null && typeof server === 'object' && typeof (server as { url?: unknown }).url === 'string',
      )
    : [];
  const sourceServers = validServers.length > 0 ? validServers : legacySwaggerServers(swaggerDoc);

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
