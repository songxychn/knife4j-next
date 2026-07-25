const CONFIG_KEY = '__KNIFE4X_CONFIG__';

export interface Knife4xConfig {
  specUrl: string;
  basePath: string;
}

export type Knife4xBootstrap =
  | { mode: 'java' }
  | { mode: 'embed'; config: Knife4xConfig }
  | { mode: 'error'; error: string };

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
    return configError('必须是对象');
  }

  const specUrl = readNonEmptyString(raw.specUrl);
  if (!specUrl) {
    return configError('specUrl 必须是非空字符串');
  }

  const basePathValue = readNonEmptyString(raw.basePath);
  if (!basePathValue) {
    return configError('basePath 必须是非空字符串');
  }

  const basePath = normalizeBasePath(basePathValue);
  if (!basePath) {
    return configError('basePath 必须是 URL 路径');
  }

  try {
    const origin = new URL(host.location.origin);
    if (!isHttpProtocol(origin.protocol)) {
      return configError('页面必须通过 HTTP(S) 提供');
    }

    if (specUrl.startsWith('//')) {
      return configError('specUrl 不支持省略协议的跨域地址');
    }

    const baseUrl = new URL(basePath === '/' ? '/' : `${basePath}/`, origin);
    const resolvedSpecUrl = new URL(specUrl, baseUrl);
    if (!isHttpProtocol(resolvedSpecUrl.protocol)) {
      return configError('specUrl 只支持 HTTP(S) URL');
    }

    return {
      mode: 'embed',
      config: {
        specUrl: resolvedSpecUrl.href,
        basePath,
      },
    };
  } catch {
    return configError('specUrl 或页面 origin 不是有效 URL');
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

function configError(message: string): Knife4xBootstrap {
  return { mode: 'error', error: `Knife4x 启动配置错误：${message}。` };
}
