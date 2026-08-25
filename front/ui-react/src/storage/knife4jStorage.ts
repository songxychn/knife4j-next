import { del as deleteIndexedDbKey, keys as listIndexedDbKeys } from 'idb-keyval';

/**
 * Every persistent Knife4j value must use a key or prefix declared here and be
 * added to the matching registry below. Cleanup must never broaden to an
 * entire browser storage area or IndexedDB store.
 */
export const KNIFE4J_STORAGE_KEYS = {
  settings: 'Knife4jGlobalSettings',
  language: 'knife4j-lang',
  legacyGlobalParams: 'knife4j_global_params',
  legacyAuth: 'knife4j_auth',
  legacyAuthMigrated: 'knife4j_auth_migrated',
  tabItems: 'knife4j-next:tab-items',
  tabActive: 'knife4j-next:tab-active',
} as const;

export const KNIFE4J_STORAGE_PREFIXES = {
  debugCache: 'knife4j-next:debug-cache:',
  debugHistory: 'knife4j-next:debug-history:',
  /** Reserved for the upcoming per-operation version prompt baseline. */
  apiVersionBaseline: 'knife4j-next:api-version-baseline:',
  groupGlobalParams: 'knife4j:global-params:',
  applicationGlobalParams: 'knife4j:application-global-params:',
  oauth2Pending: 'knife4j:oauth2:pending:',
  authIndexedDb: 'knife4j:auth:',
} as const;

export type Knife4jStorageCleanupScope = 'request-cache' | 'all-local-data';
export type Knife4jStorageArea = 'localStorage' | 'sessionStorage' | 'indexedDB';

type RegisteredEntry = {
  match: 'exact' | 'prefix';
  value: string;
  scope: Knife4jStorageCleanupScope;
};

export const KNIFE4J_STORAGE_REGISTRY = {
  localStorage: [
    { match: 'prefix', value: KNIFE4J_STORAGE_PREFIXES.debugCache, scope: 'request-cache' },
    { match: 'prefix', value: KNIFE4J_STORAGE_PREFIXES.debugHistory, scope: 'request-cache' },
    { match: 'prefix', value: KNIFE4J_STORAGE_PREFIXES.apiVersionBaseline, scope: 'request-cache' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.settings, scope: 'all-local-data' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.language, scope: 'all-local-data' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.legacyGlobalParams, scope: 'all-local-data' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.legacyAuth, scope: 'all-local-data' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.legacyAuthMigrated, scope: 'all-local-data' },
    { match: 'prefix', value: KNIFE4J_STORAGE_PREFIXES.groupGlobalParams, scope: 'all-local-data' },
    { match: 'prefix', value: KNIFE4J_STORAGE_PREFIXES.applicationGlobalParams, scope: 'all-local-data' },
  ],
  sessionStorage: [
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.tabItems, scope: 'request-cache' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.tabActive, scope: 'request-cache' },
    { match: 'prefix', value: KNIFE4J_STORAGE_PREFIXES.oauth2Pending, scope: 'all-local-data' },
  ],
  indexedDB: [{ match: 'prefix', value: KNIFE4J_STORAGE_PREFIXES.authIndexedDb, scope: 'all-local-data' }],
} as const satisfies Record<Knife4jStorageArea, readonly RegisteredEntry[]>;

export interface Knife4jWebStorage {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

export interface Knife4jIndexedDbStorage {
  keys(): Promise<IDBValidKey[]>;
  delete(key: IDBValidKey): Promise<void>;
}

export interface Knife4jStorageAdapters {
  localStorage: Knife4jWebStorage | null;
  sessionStorage: Knife4jWebStorage | null;
  indexedDB: Knife4jIndexedDbStorage | null;
}

export interface Knife4jStorageCleanupFailure {
  area: Knife4jStorageArea;
  key?: string;
  reason: string;
}

export interface Knife4jStorageCleanupResult {
  scope: Knife4jStorageCleanupScope;
  removed: Record<Knife4jStorageArea, number>;
  failures: Knife4jStorageCleanupFailure[];
}

const pendingKnife4jStorageWrites = new Set<Promise<unknown>>();
let allLocalDataCleanupCount = 0;

/**
 * Register an asynchronous Knife4j persistence operation. A full reset waits
 * for writes that already started and suppresses new writes until its final
 * deletion pass has completed.
 */
export function trackKnife4jStorageWrite<T>(write: () => Promise<T>): Promise<T | undefined> {
  if (allLocalDataCleanupCount > 0) return Promise.resolve(undefined);

  const pending = Promise.resolve().then(write);
  pendingKnife4jStorageWrites.add(pending);
  void pending.then(
    () => pendingKnife4jStorageWrites.delete(pending),
    () => pendingKnife4jStorageWrites.delete(pending),
  );
  return pending;
}

async function waitForPendingKnife4jStorageWrites(): Promise<void> {
  while (pendingKnife4jStorageWrites.size > 0) {
    await Promise.allSettled(Array.from(pendingKnife4jStorageWrites));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function entriesForScope(
  registry: readonly RegisteredEntry[],
  scope: Knife4jStorageCleanupScope,
): readonly RegisteredEntry[] {
  return registry.filter((entry) => scope === 'all-local-data' || entry.scope === 'request-cache');
}

function matchesRegisteredEntry(key: string, entries: readonly RegisteredEntry[]): boolean {
  return entries.some((entry) => (entry.match === 'exact' ? key === entry.value : key.startsWith(entry.value)));
}

function recordUnavailable(result: Knife4jStorageCleanupResult, area: Knife4jStorageArea): void {
  result.failures.push({ area, reason: `${area} unavailable` });
}

function clearWebStorage(
  area: 'localStorage' | 'sessionStorage',
  storage: Knife4jWebStorage | null,
  registry: readonly RegisteredEntry[],
  result: Knife4jStorageCleanupResult,
): void {
  if (!storage) {
    recordUnavailable(result, area);
    return;
  }

  const entries = entriesForScope(registry, result.scope);
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) keys.push(key);
    }
  } catch (error) {
    result.failures.push({ area, reason: errorMessage(error) });
    return;
  }

  for (const key of keys) {
    if (!matchesRegisteredEntry(key, entries)) continue;
    try {
      storage.removeItem(key);
      result.removed[area] += 1;
    } catch (error) {
      result.failures.push({ area, key, reason: errorMessage(error) });
    }
  }
}

async function clearIndexedDbStorage(
  storage: Knife4jIndexedDbStorage | null,
  result: Knife4jStorageCleanupResult,
): Promise<void> {
  if (result.scope !== 'all-local-data') return;
  if (!storage) {
    recordUnavailable(result, 'indexedDB');
    return;
  }

  let keys: IDBValidKey[];
  try {
    keys = await storage.keys();
  } catch (error) {
    result.failures.push({ area: 'indexedDB', reason: errorMessage(error) });
    return;
  }

  const entries = entriesForScope(KNIFE4J_STORAGE_REGISTRY.indexedDB, result.scope);
  for (const key of keys) {
    if (typeof key !== 'string' || !matchesRegisteredEntry(key, entries)) continue;
    try {
      await storage.delete(key);
      result.removed.indexedDB += 1;
    } catch (error) {
      result.failures.push({ area: 'indexedDB', key, reason: errorMessage(error) });
    }
  }
}

export async function clearRegisteredKnife4jStorage(
  scope: Knife4jStorageCleanupScope,
  adapters: Knife4jStorageAdapters,
): Promise<Knife4jStorageCleanupResult> {
  const guardsAsyncWrites = scope === 'all-local-data';
  if (guardsAsyncWrites) allLocalDataCleanupCount += 1;

  try {
    if (guardsAsyncWrites) await waitForPendingKnife4jStorageWrites();

    const result: Knife4jStorageCleanupResult = {
      scope,
      removed: { localStorage: 0, sessionStorage: 0, indexedDB: 0 },
      failures: [],
    };

    clearWebStorage('localStorage', adapters.localStorage, KNIFE4J_STORAGE_REGISTRY.localStorage, result);
    clearWebStorage('sessionStorage', adapters.sessionStorage, KNIFE4J_STORAGE_REGISTRY.sessionStorage, result);
    await clearIndexedDbStorage(adapters.indexedDB, result);
    return result;
  } finally {
    if (guardsAsyncWrites) allLocalDataCleanupCount -= 1;
  }
}

function browserStorage(area: 'localStorage' | 'sessionStorage'): Knife4jWebStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window[area];
  } catch {
    return null;
  }
}

function browserIndexedDb(): Knife4jIndexedDbStorage | null {
  if (typeof indexedDB === 'undefined') return null;
  return {
    keys: () => listIndexedDbKeys(),
    delete: (key) => deleteIndexedDbKey(key),
  };
}

export function clearKnife4jStorage(scope: Knife4jStorageCleanupScope): Promise<Knife4jStorageCleanupResult> {
  return clearRegisteredKnife4jStorage(scope, {
    localStorage: browserStorage('localStorage'),
    sessionStorage: browserStorage('sessionStorage'),
    indexedDB: browserIndexedDb(),
  });
}

export function removedKnife4jStorageEntryCount(result: Knife4jStorageCleanupResult): number {
  return Object.values(result.removed).reduce((total, count) => total + count, 0);
}
