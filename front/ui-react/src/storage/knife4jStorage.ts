import { del as deleteIndexedDbKey, keys as listIndexedDbKeys } from 'idb-keyval';

/**
 * Every persistent Knife4j value must use a key or prefix declared here and be
 * registered below so cleanup never removes unrelated host application keys.
 */
export const KNIFE4J_STORAGE_KEYS = {
  settings: 'Knife4jGlobalSettings',
  language: 'knife4j-lang',
  legacyGlobalParams: 'knife4j_global_params',
  legacyAuth: 'knife4j_auth',
  legacyAuthMigrated: 'knife4j_auth_migrated',
  tabItems: 'knife4j-next:tab-items',
  tabActive: 'knife4j-next:tab-active',
  debugPanelLayout: 'knife4j-next:debug-panel-layout',
} as const;

export const KNIFE4J_STORAGE_PREFIXES = {
  debugCache: 'knife4j-next:debug-cache:',
  debugHistory: 'knife4j-next:debug-history:',
  /** Per-document baseline used by per-operation API change prompts. */
  apiVersionBaseline: 'knife4j-next:api-version-baseline:',
  /** Exact-URI hash grants for one immutable OAS document scope; never stores response bodies or full query values. */
  resourceGrants: 'knife4j-next:resource-grants:',
  /** Per-operation declarative response extraction rules (never stores extracted secret logs). */
  responseExtractionRules: 'knife4j-next:response-extraction:',
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
    { match: 'prefix', value: KNIFE4J_STORAGE_PREFIXES.resourceGrants, scope: 'all-local-data' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.settings, scope: 'all-local-data' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.language, scope: 'all-local-data' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.debugPanelLayout, scope: 'all-local-data' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.legacyGlobalParams, scope: 'all-local-data' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.legacyAuth, scope: 'all-local-data' },
    { match: 'exact', value: KNIFE4J_STORAGE_KEYS.legacyAuthMigrated, scope: 'all-local-data' },
    { match: 'prefix', value: KNIFE4J_STORAGE_PREFIXES.responseExtractionRules, scope: 'all-local-data' },
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
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
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

export interface Knife4jStorageItemUpdateResult {
  persisted: boolean;
  value: string | null;
}

const CLEANUP_CHANNEL_NAME = 'knife4j-next:storage-cleanup';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function matchesScope(entry: RegisteredEntry, scope: Knife4jStorageCleanupScope): boolean {
  return scope === 'all-local-data' || entry.scope === 'request-cache';
}

function matchesRegisteredKey(
  key: string,
  entries: readonly RegisteredEntry[],
  scope: Knife4jStorageCleanupScope,
): boolean {
  return entries.some((entry) => {
    if (!matchesScope(entry, scope)) return false;
    return entry.match === 'exact' ? key === entry.value : key.startsWith(entry.value);
  });
}

export function getKnife4jStorageItem(storage: Pick<Storage, 'getItem'>, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function setKnife4jStorageItem(storage: Pick<Storage, 'setItem'>, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function setKnife4jSessionStorageItem(storage: Pick<Storage, 'setItem'>, key: string, value: string): boolean {
  return setKnife4jStorageItem(storage, key, value);
}

export function removeKnife4jStorageItem(storage: Pick<Storage, 'removeItem'>, key: string): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function updateKnife4jStorageItem(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  updater: (current: string | null) => string,
): Knife4jStorageItemUpdateResult {
  try {
    const next = updater(storage.getItem(key));
    storage.setItem(key, next);
    return { persisted: true, value: next };
  } catch {
    return { persisted: false, value: null };
  }
}

export function subscribeKnife4jStorageCleanup(listener: (scope: Knife4jStorageCleanupScope) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  try {
    const channel = new BroadcastChannel(CLEANUP_CHANNEL_NAME);
    const onMessage = (event: MessageEvent<unknown>) => {
      const data = event.data as { scope?: unknown } | null;
      if (data?.scope === 'request-cache' || data?.scope === 'all-local-data') {
        listener(data.scope);
      }
    };
    channel.addEventListener('message', onMessage);
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  } catch {
    return () => {};
  }
}

function broadcastStorageCleanup(scope: Knife4jStorageCleanupScope): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(CLEANUP_CHANNEL_NAME);
    channel.postMessage({ scope });
    channel.close();
  } catch {
    // Best-effort cross-tab notification; current tab still reloads on cleanup.
  }
}

function clearWebStorageArea(
  area: 'localStorage' | 'sessionStorage',
  storage: Knife4jWebStorage | null,
  scope: Knife4jStorageCleanupScope,
  removed: Record<Knife4jStorageArea, number>,
  failures: Knife4jStorageCleanupFailure[],
): void {
  const entries = KNIFE4J_STORAGE_REGISTRY[area];
  if (!entries.some((entry) => matchesScope(entry, scope))) return;
  if (!storage) {
    failures.push({ area, reason: `${area} is unavailable` });
    return;
  }

  const keysToRemove: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && matchesRegisteredKey(key, entries, scope)) {
        keysToRemove.push(key);
      }
    }
  } catch (error) {
    failures.push({ area, reason: errorMessage(error) });
    return;
  }

  for (const key of keysToRemove) {
    try {
      storage.removeItem(key);
      removed[area] += 1;
    } catch (error) {
      failures.push({ area, key, reason: errorMessage(error) });
    }
  }
}

async function clearIndexedDbArea(
  storage: Knife4jIndexedDbStorage | null,
  scope: Knife4jStorageCleanupScope,
  removed: Record<Knife4jStorageArea, number>,
  failures: Knife4jStorageCleanupFailure[],
): Promise<void> {
  const entries = KNIFE4J_STORAGE_REGISTRY.indexedDB;
  if (!entries.some((entry) => matchesScope(entry, scope))) return;
  if (!storage) {
    failures.push({ area: 'indexedDB', reason: 'indexedDB is unavailable' });
    return;
  }

  let keys: IDBValidKey[];
  try {
    keys = await storage.keys();
  } catch (error) {
    failures.push({ area: 'indexedDB', reason: errorMessage(error) });
    return;
  }

  for (const key of keys) {
    if (typeof key !== 'string' || !matchesRegisteredKey(key, entries, scope)) continue;
    try {
      await storage.delete(key);
      removed.indexedDB += 1;
    } catch (error) {
      failures.push({ area: 'indexedDB', key, reason: errorMessage(error) });
    }
  }
}

function browserStorageAdapters(): Knife4jStorageAdapters {
  let local: Knife4jWebStorage | null = null;
  let session: Knife4jWebStorage | null = null;
  try {
    local = typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    local = null;
  }
  try {
    session = typeof globalThis.sessionStorage !== 'undefined' ? globalThis.sessionStorage : null;
  } catch {
    session = null;
  }
  const indexedDB: Knife4jIndexedDbStorage | null =
    typeof globalThis.indexedDB !== 'undefined'
      ? {
          keys: () => listIndexedDbKeys(),
          delete: (key) => deleteIndexedDbKey(key),
        }
      : null;
  return { localStorage: local, sessionStorage: session, indexedDB };
}

export async function clearRegisteredKnife4jStorage(
  scope: Knife4jStorageCleanupScope,
  adapters: Knife4jStorageAdapters,
): Promise<Knife4jStorageCleanupResult> {
  const removed: Record<Knife4jStorageArea, number> = {
    localStorage: 0,
    sessionStorage: 0,
    indexedDB: 0,
  };
  const failures: Knife4jStorageCleanupFailure[] = [];

  clearWebStorageArea('localStorage', adapters.localStorage, scope, removed, failures);
  clearWebStorageArea('sessionStorage', adapters.sessionStorage, scope, removed, failures);
  await clearIndexedDbArea(adapters.indexedDB, scope, removed, failures);

  return { scope, removed, failures };
}

export async function clearKnife4jStorage(scope: Knife4jStorageCleanupScope): Promise<Knife4jStorageCleanupResult> {
  const result = await clearRegisteredKnife4jStorage(scope, browserStorageAdapters());
  if (result.failures.length === 0) {
    broadcastStorageCleanup(scope);
  }
  return result;
}

export function removedKnife4jStorageEntryCount(result: Knife4jStorageCleanupResult): number {
  return result.removed.localStorage + result.removed.sessionStorage + result.removed.indexedDB;
}
