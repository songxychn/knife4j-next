export const DEBUG_HISTORY_VERSION = 1 as const;
export const DEBUG_HISTORY_MAX_ENTRIES = 20;
/** Body / response body truncation limit (~64KB). */
export const DEBUG_HISTORY_BODY_MAX_BYTES = 64 * 1024;
export const DEBUG_HISTORY_MASK = '***';

const STORAGE_PREFIX = 'knife4j-next:debug-history:';

export type DebugHistoryStatus = 'pending' | 'completed' | 'error' | 'aborted';

export type DebugHistoryRawMode = 'text' | 'json' | 'javascript' | 'xml' | 'html';

export interface DebugHistoryCustomParamRow {
  id: string;
  name: string;
  value: string;
}

/** Snapshot of form state sufficient to re-apply into the debug panel. */
export interface DebugHistoryFormSnapshot {
  baseUrl: string;
  method: string;
  path: string;
  paramValues: Record<string, string>;
  paramEnabled: Record<string, boolean>;
  selectedContentType: string;
  body: string;
  formFields: Record<string, string>;
  rawMode: DebugHistoryRawMode;
  customQueryParams: DebugHistoryCustomParamRow[];
  customHeaders: DebugHistoryCustomParamRow[];
  customCookies: DebugHistoryCustomParamRow[];
  /** File field name → staged file names (File contents are never persisted). */
  fileFieldNames?: Record<string, string[]>;
  hasFileFields?: boolean;
}

export interface DebugHistoryEntry {
  id: string;
  version: typeof DEBUG_HISTORY_VERSION;
  createdAt: number;
  updatedAt?: number;
  status: DebugHistoryStatus;
  groupName?: string;
  operationId?: string;
  method: string;
  path: string;
  baseUrl: string;
  resolvedUrl: string;
  /** Request headers with sensitive values masked. */
  headers: Record<string, string>;
  query?: Record<string, string>;
  body?: string;
  bodyTruncated?: boolean;
  contentType?: string;
  httpStatus?: number;
  statusText?: string;
  durationMs?: number;
  responseBody?: string;
  responseTruncated?: boolean;
  errorMessage?: string;
  /** True when the response was consumed as SSE. */
  isSse?: boolean;
  formSnapshot?: DebugHistoryFormSnapshot;
}

export interface DebugHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CreatePendingEntryInput {
  id?: string;
  createdAt?: number;
  groupName?: string;
  operationId?: string;
  method: string;
  path: string;
  baseUrl: string;
  resolvedUrl: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string;
  contentType?: string;
  formSnapshot?: DebugHistoryFormSnapshot;
}

export interface CompleteEntryPatch {
  updatedAt?: number;
  status?: Extract<DebugHistoryStatus, 'completed' | 'error'>;
  httpStatus?: number;
  statusText?: string;
  durationMs?: number;
  responseBody?: string;
  errorMessage?: string;
  isSse?: boolean;
}

const RAW_MODES = new Set<DebugHistoryRawMode>(['text', 'json', 'javascript', 'xml', 'html']);

/** Header names treated as sensitive (case-insensitive). */
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
  'access-token',
  'token',
  'x-token',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
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

function readStringArrayRecord(value: unknown): Record<string, string[]> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item) && item.every((v) => typeof v === 'string')) {
      result[key] = item as string[];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function readCustomRows(value: unknown): DebugHistoryCustomParamRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (row): row is DebugHistoryCustomParamRow =>
      isRecord(row) && typeof row.id === 'string' && typeof row.name === 'string' && typeof row.value === 'string',
  );
}

function readRawMode(value: unknown): DebugHistoryRawMode {
  return typeof value === 'string' && RAW_MODES.has(value as DebugHistoryRawMode)
    ? (value as DebugHistoryRawMode)
    : 'text';
}

function getDebugHistoryStorage(): DebugHistoryStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  // Fallback approximation for non-browser test envs without TextEncoder.
  return unescape(encodeURIComponent(text)).length;
}

function truncateToMaxBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (utf8ByteLength(text) <= maxBytes) {
    return { text, truncated: false };
  }
  // Binary search the largest prefix whose UTF-8 size is within the limit.
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (utf8ByteLength(text.slice(0, mid)) <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { text: text.slice(0, low), truncated: true };
}

export function isSensitiveHeaderName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (SENSITIVE_HEADER_NAMES.has(lower)) return true;
  // Common api-key style names: apiKey, X-ApiKey, x_api_key
  const normalized = lower.replace(/[_-]/g, '');
  if (normalized === 'apikey' || normalized === 'xapikey') return true;
  if (normalized.includes('authorization')) return true;
  return false;
}

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    result[name] = isSensitiveHeaderName(name) ? DEBUG_HISTORY_MASK : value;
  }
  return result;
}

export function sanitizeCustomRows(rows: DebugHistoryCustomParamRow[]): DebugHistoryCustomParamRow[] {
  return rows.map((row) => (isSensitiveHeaderName(row.name) ? { ...row, value: DEBUG_HISTORY_MASK } : { ...row }));
}

export function truncateBody(
  body: string,
  maxBytes: number = DEBUG_HISTORY_BODY_MAX_BYTES,
): { text: string; truncated: boolean } {
  return truncateToMaxBytes(body, maxBytes);
}

export function debugHistoryStorageKey(cacheKey: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(cacheKey)}`;
}

export function createHistoryEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `hist-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeFormSnapshot(value: unknown): DebugHistoryFormSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const fileFieldNames = readStringArrayRecord(value.fileFieldNames);
  return {
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
    customHeaders: sanitizeCustomRows(readCustomRows(value.customHeaders)),
    customCookies: sanitizeCustomRows(readCustomRows(value.customCookies)),
    fileFieldNames,
    hasFileFields:
      readBoolean(value.hasFileFields) ?? Boolean(fileFieldNames && Object.keys(fileFieldNames).length > 0),
  };
}

function normalizeEntry(value: unknown): DebugHistoryEntry | null {
  if (!isRecord(value) || value.version !== DEBUG_HISTORY_VERSION) return null;
  if (typeof value.id !== 'string' || !value.id) return null;
  const status = value.status;
  if (status !== 'pending' && status !== 'completed' && status !== 'error' && status !== 'aborted') {
    return null;
  }

  const bodyRaw = readOptionalString(value.body);
  const responseBodyRaw = readOptionalString(value.responseBody);
  const bodyTruncated = readBoolean(value.bodyTruncated);
  const responseTruncated = readBoolean(value.responseTruncated);

  let body = bodyRaw;
  let bodyWasTruncated = bodyTruncated ?? false;
  if (body !== undefined) {
    const truncated = truncateBody(body);
    body = truncated.text;
    bodyWasTruncated = bodyWasTruncated || truncated.truncated;
  }

  let responseBody = responseBodyRaw;
  let responseWasTruncated = responseTruncated ?? false;
  if (responseBody !== undefined) {
    const truncated = truncateBody(responseBody);
    responseBody = truncated.text;
    responseWasTruncated = responseWasTruncated || truncated.truncated;
  }

  return {
    id: value.id,
    version: DEBUG_HISTORY_VERSION,
    createdAt: readNumber(value.createdAt) ?? 0,
    updatedAt: readNumber(value.updatedAt),
    status,
    groupName: readOptionalString(value.groupName),
    operationId: readOptionalString(value.operationId),
    method: readString(value.method),
    path: readString(value.path),
    baseUrl: readString(value.baseUrl),
    resolvedUrl: readString(value.resolvedUrl),
    headers: sanitizeHeaders(readStringRecord(value.headers)),
    query: isRecord(value.query) ? readStringRecord(value.query) : undefined,
    body,
    bodyTruncated: body !== undefined ? bodyWasTruncated : undefined,
    contentType: readOptionalString(value.contentType),
    httpStatus: readNumber(value.httpStatus),
    statusText: readOptionalString(value.statusText),
    durationMs: readNumber(value.durationMs),
    responseBody,
    responseTruncated: responseBody !== undefined ? responseWasTruncated : undefined,
    errorMessage: readOptionalString(value.errorMessage),
    isSse: readBoolean(value.isSse),
    formSnapshot: normalizeFormSnapshot(value.formSnapshot),
  };
}

function readHistoryList(cacheKey: string, storage: DebugHistoryStorage | null): DebugHistoryEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(debugHistoryStorageKey(cacheKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => normalizeEntry(item)).filter((item): item is DebugHistoryEntry => item !== null);
  } catch {
    return [];
  }
}

function writeHistoryList(cacheKey: string, entries: DebugHistoryEntry[], storage: DebugHistoryStorage | null): void {
  if (!storage) return;
  try {
    // Newest first; enforce FIFO max.
    const limited = entries.slice(0, DEBUG_HISTORY_MAX_ENTRIES);
    storage.setItem(debugHistoryStorageKey(cacheKey), JSON.stringify(limited));
  } catch {
    // localStorage can be disabled or full; history must never block the UI.
  }
}

export function createPendingEntry(input: CreatePendingEntryInput): DebugHistoryEntry {
  const bodyInput = input.body;
  let body: string | undefined;
  let bodyTruncated: boolean | undefined;
  if (bodyInput !== undefined) {
    const truncated = truncateBody(bodyInput);
    body = truncated.text;
    bodyTruncated = truncated.truncated || undefined;
  }

  const formSnapshot = input.formSnapshot
    ? {
        ...input.formSnapshot,
        customHeaders: sanitizeCustomRows(input.formSnapshot.customHeaders),
        customCookies: sanitizeCustomRows(input.formSnapshot.customCookies),
      }
    : undefined;

  return {
    id: input.id ?? createHistoryEntryId(),
    version: DEBUG_HISTORY_VERSION,
    createdAt: input.createdAt ?? Date.now(),
    status: 'pending',
    groupName: input.groupName,
    operationId: input.operationId,
    method: input.method,
    path: input.path,
    baseUrl: input.baseUrl,
    resolvedUrl: input.resolvedUrl,
    headers: sanitizeHeaders(input.headers ?? {}),
    query: input.query,
    body,
    bodyTruncated,
    contentType: input.contentType,
    formSnapshot,
  };
}

export function completeEntry(entry: DebugHistoryEntry, patch: CompleteEntryPatch): DebugHistoryEntry {
  let responseBody = patch.responseBody;
  let responseTruncated: boolean | undefined;
  if (responseBody !== undefined) {
    const truncated = truncateBody(responseBody);
    responseBody = truncated.text;
    responseTruncated = truncated.truncated || undefined;
  }

  const status: DebugHistoryStatus = patch.status ?? (patch.errorMessage ? 'error' : 'completed');

  return {
    ...entry,
    updatedAt: patch.updatedAt ?? Date.now(),
    status,
    httpStatus: patch.httpStatus ?? entry.httpStatus,
    statusText: patch.statusText ?? entry.statusText,
    durationMs: patch.durationMs ?? entry.durationMs,
    responseBody: responseBody ?? entry.responseBody,
    responseTruncated: responseTruncated ?? entry.responseTruncated,
    errorMessage: patch.errorMessage ?? entry.errorMessage,
    isSse: patch.isSse ?? entry.isSse,
  };
}

export function abortEntry(
  entry: DebugHistoryEntry,
  patch: { updatedAt?: number; durationMs?: number; errorMessage?: string } = {},
): DebugHistoryEntry {
  return {
    ...entry,
    updatedAt: patch.updatedAt ?? Date.now(),
    status: 'aborted',
    durationMs: patch.durationMs ?? entry.durationMs,
    errorMessage: patch.errorMessage ?? entry.errorMessage,
  };
}

export function listHistory(
  cacheKey: string,
  storage: DebugHistoryStorage | null = getDebugHistoryStorage(),
): DebugHistoryEntry[] {
  return readHistoryList(cacheKey, storage);
}

export function appendPending(
  cacheKey: string,
  entry: DebugHistoryEntry,
  storage: DebugHistoryStorage | null = getDebugHistoryStorage(),
): DebugHistoryEntry[] {
  const pending = entry.status === 'pending' ? entry : { ...entry, status: 'pending' as const };
  const next = [pending, ...readHistoryList(cacheKey, storage).filter((item) => item.id !== pending.id)];
  writeHistoryList(cacheKey, next, storage);
  return next.slice(0, DEBUG_HISTORY_MAX_ENTRIES);
}

export function updateEntry(
  cacheKey: string,
  id: string,
  updater: (entry: DebugHistoryEntry) => DebugHistoryEntry,
  storage: DebugHistoryStorage | null = getDebugHistoryStorage(),
): DebugHistoryEntry[] {
  const current = readHistoryList(cacheKey, storage);
  let found = false;
  const next = current.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return updater(item);
  });
  if (!found) return current;
  writeHistoryList(cacheKey, next, storage);
  return next;
}

export function removeEntry(
  cacheKey: string,
  id: string,
  storage: DebugHistoryStorage | null = getDebugHistoryStorage(),
): DebugHistoryEntry[] {
  const next = readHistoryList(cacheKey, storage).filter((item) => item.id !== id);
  writeHistoryList(cacheKey, next, storage);
  return next;
}

export function clearHistory(cacheKey: string, storage: DebugHistoryStorage | null = getDebugHistoryStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(debugHistoryStorageKey(cacheKey));
  } catch {
    // ignore storage failures
  }
}
