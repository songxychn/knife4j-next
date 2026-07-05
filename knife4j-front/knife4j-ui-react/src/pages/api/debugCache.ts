export const DEBUG_CACHE_VERSION = 1;

const STORAGE_PREFIX = 'knife4j-next:debug-cache:';

export type DebugCacheRawMode = 'text' | 'json' | 'javascript' | 'xml' | 'html' | 'graphql';

export interface DebugCacheCustomParamRow {
  id: string;
  name: string;
  value: string;
}

export interface DebugCacheState {
  version: typeof DEBUG_CACHE_VERSION;
  baseUrl: string;
  method: string;
  path: string;
  paramValues: Record<string, string>;
  paramEnabled: Record<string, boolean>;
  selectedContentType: string;
  body: string;
  formFields: Record<string, string>;
  rawMode: DebugCacheRawMode;
  customQueryParams: DebugCacheCustomParamRow[];
  customHeaders: DebugCacheCustomParamRow[];
  customCookies: DebugCacheCustomParamRow[];
}

export interface DebugCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RAW_MODES = new Set<DebugCacheRawMode>(['text', 'json', 'javascript', 'xml', 'html', 'graphql']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readStringRecord(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!isRecord(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      result[key] = item;
    }
  }
  return result;
}

function readBooleanRecord(value: unknown): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!isRecord(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'boolean') {
      result[key] = item;
    }
  }
  return result;
}

function readRawMode(value: unknown): DebugCacheRawMode {
  return typeof value === 'string' && RAW_MODES.has(value as DebugCacheRawMode) ? (value as DebugCacheRawMode) : 'text';
}

function readCustomRows(value: unknown): DebugCacheCustomParamRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is DebugCacheCustomParamRow =>
      isRecord(row) && typeof row.id === 'string' && typeof row.name === 'string' && typeof row.value === 'string',
  );
}

function getDebugCacheStorage(): DebugCacheStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeDebugCacheState(value: unknown): DebugCacheState | null {
  if (!isRecord(value) || value.version !== DEBUG_CACHE_VERSION) return null;
  return {
    version: DEBUG_CACHE_VERSION,
    baseUrl: readString(value.baseUrl),
    method: readString(value.method),
    path: readString(value.path),
    paramValues: readStringRecord(value.paramValues),
    paramEnabled: readBooleanRecord(value.paramEnabled),
    selectedContentType: readString(value.selectedContentType),
    body: readString(value.body),
    formFields: readStringRecord(value.formFields),
    rawMode: readRawMode(value.rawMode),
    customQueryParams: readCustomRows(value.customQueryParams),
    customHeaders: readCustomRows(value.customHeaders),
    customCookies: readCustomRows(value.customCookies),
  };
}

export function debugCacheStorageKey(cacheKey: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(cacheKey)}`;
}

export function readDebugCache(
  cacheKey: string,
  storage: DebugCacheStorage | null = getDebugCacheStorage(),
): DebugCacheState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(debugCacheStorageKey(cacheKey));
    if (!raw) return null;
    return normalizeDebugCacheState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeDebugCache(
  cacheKey: string,
  state: DebugCacheState,
  storage: DebugCacheStorage | null = getDebugCacheStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(debugCacheStorageKey(cacheKey), JSON.stringify({ ...state, version: DEBUG_CACHE_VERSION }));
  } catch {
    // localStorage can be disabled or full; debug caching should never block the UI.
  }
}

export function removeDebugCache(cacheKey: string, storage: DebugCacheStorage | null = getDebugCacheStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(debugCacheStorageKey(cacheKey));
  } catch {
    // ignore storage failures
  }
}
