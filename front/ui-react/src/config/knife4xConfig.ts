import type { LocalizedMessage } from '../types/i18n';
import type { AppSettings } from '../types/settings';
import type { MarkdownFileItem, SwaggerGroup } from '../types/swagger';
import { extractKnife4jSettings } from '../utils/knife4jSettings';

const CONFIG_KEY = '__KNIFE4X_CONFIG__';

export interface Knife4xConfig {
  specUrl?: string;
  specs?: SwaggerGroup[];
  basePath: string;
  settings?: Partial<AppSettings>;
  documents?: MarkdownFileItem[];
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
  const hasSpecs = raw.specs !== undefined;
  if (hasSpecs && (raw.specUrl !== undefined || !Array.isArray(raw.specs) || raw.specs.length === 0)) {
    return configError('error.knife4x.invalidSpecs');
  }
  if (!hasSpecs && !specUrl) {
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

    const baseUrl = new URL(basePath === '/' ? '/' : `${basePath}/`, origin);
    const config: Knife4xConfig = { basePath };
    if (hasSpecs) {
      const names = new Set<string>();
      const specs: SwaggerGroup[] = [];
      for (const entry of raw.specs as unknown[]) {
        if (!isRecord(entry)) return configError('error.knife4x.invalidSpecs');
        const name = readNonEmptyString(entry.name);
        const url = readNonEmptyString(entry.url);
        if (
          !name ||
          !isGroupRouteSegment(name) ||
          names.has(name) ||
          !url ||
          url.startsWith('//') ||
          url.includes('\\')
        ) {
          return configError('error.knife4x.invalidSpecs');
        }
        const resolved = new URL(url, baseUrl);
        if (!isHttpProtocol(resolved.protocol) || resolved.username || resolved.password) {
          return configError('error.knife4x.invalidSpecs');
        }
        names.add(name);
        specs.push({ name, url: resolved.href });
      }
      config.specs = specs;
    } else {
      if (specUrl!.startsWith('//')) return configError('error.knife4x.protocolRelativeSpecUrl');
      const resolved = new URL(specUrl!, baseUrl);
      if (!isHttpProtocol(resolved.protocol)) return configError('error.knife4x.specUrlProtocol');
      config.specUrl = resolved.href;
    }

    if (raw.settings !== undefined) {
      if (!isRecord(raw.settings)) return configError('error.knife4x.invalidSettings');
      // Use the same supported-field reader as spec extensions; never spread arbitrary bootstrap keys.
      config.settings = extractKnife4jSettings({ info: { title: '', version: '' }, 'x-setting': raw.settings });
    }
    if (raw.documents !== undefined) {
      if (!Array.isArray(raw.documents)) return configError('error.knife4x.invalidDocuments');
      const documents: MarkdownFileItem[] = [];
      for (const document of raw.documents) {
        if (!isRecord(document)) return configError('error.knife4x.invalidDocuments');
        const title = readNonEmptyString(document.title);
        if (!title || typeof document.content !== 'string') return configError('error.knife4x.invalidDocuments');
        documents.push({ title, content: document.content });
      }
      config.documents = documents;
    }
    return { mode: 'embed', config };
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

function isGroupRouteSegment(name: string): boolean {
  return name !== '.' && name !== '..' && name !== 'group' && !/[/\\?#%\p{Cc}]/u.test(name);
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
