import type { LocalizedMessage } from '../types/i18n';

const CONFIG_KEY = '__KNIFE4X_CONFIG__';

export interface Knife4xConfig {
  specUrl: string;
  basePath: string;
}

export type Knife4xBootstrap =
  { mode: 'java' } | { mode: 'embed'; config: Knife4xConfig } | { mode: 'error'; error: LocalizedMessage };

interface Knife4xWindow {
  location: {
    origin: string;
  };
  __KNIFE4X_CONFIG__?: unknown;
}

export function readKnife4xBootstrap(host: Knife4xWindow = window): Knife4xBootstrap {
  if (!Object.prototype.hasOwnProperty.call(host, CONFIG_KEY)) {
    return { mode: 'java' };
  }

  const raw = host.__KNIFE4X_CONFIG__;
  if (!isRecord(raw)) {
    return configError('error.knife4x.notObject');
  }

  const specUrl = readNonEmptyString(raw.specUrl);
  if (!specUrl) {
    return configError('error.knife4x.specUrlRequired');
  }

  const basePathValue = readNonEmptyString(raw.basePath);
  if (!basePathValue) {
    return configError('error.knife4x.basePathRequired');
  }

  const basePath = normalizeBasePath(basePathValue);
  if (!basePath) {
    return configError('error.knife4x.basePathInvalid');
  }

  try {
    const origin = new URL(host.location.origin);
    if (!isHttpProtocol(origin.protocol)) {
      return configError('error.knife4x.pageProtocol');
    }

    if (specUrl.startsWith('//')) {
      return configError('error.knife4x.protocolRelativeSpecUrl');
    }

    const baseUrl = new URL(basePath === '/' ? '/' : `${basePath}/`, origin);
    const resolvedSpecUrl = new URL(specUrl, baseUrl);
    if (!isHttpProtocol(resolvedSpecUrl.protocol)) {
      return configError('error.knife4x.specUrlProtocol');
    }

    return {
      mode: 'embed',
      config: {
        specUrl: resolvedSpecUrl.href,
        basePath,
      },
    };
  } catch {
    return configError('error.knife4x.invalidUrl');
  }
}

function normalizeBasePath(value: string): string | null {
  if (
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\') ||
    value.startsWith('//') ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)
  ) {
    return null;
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '');
  return withoutTrailingSlash || '/';
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isHttpProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configError(key: string): Knife4xBootstrap {
  return { mode: 'error', error: { key } };
}
