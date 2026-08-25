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
  /** Internal cross-context coordination lease; never treated as user data. */
  resetLease: 'knife4j-next:storage-reset-lease',
  /** Fallback mutex shared by writes, removals, and full resets when Web Locks are unavailable. */
  mutationLease: 'knife4j-next:storage-mutation-lease',
  /** Durable cross-tab request-cache cleanup epoch; an expired record retains the latest generation. */
  requestCacheEpoch: 'knife4j-next:request-cache-cleanup-epoch',
  /** Last completed or active reset generation, retained to invalidate stale in-memory state. */
  resetGeneration: 'knife4j-next:storage-reset-generation',
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
  /** Per-reset fallback contenders; retained only while acquiring the lease. */
  resetClaim: 'knife4j-next:storage-reset-claim:',
  /** Per-mutation fallback contenders; retained only while acquiring the mutex. */
  mutationClaim: 'knife4j-next:storage-mutation-claim:',
} as const;

export type Knife4jStorageCleanupScope = 'request-cache' | 'all-local-data';
export type Knife4jStorageArea = 'localStorage' | 'sessionStorage' | 'indexedDB';

type RegisteredEntry = {
  match: 'exact' | 'prefix';
  value: string;
  scope: Knife4jStorageCleanupScope;
  preserveDuringCleanup?: boolean;
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
    {
      match: 'exact',
      value: KNIFE4J_STORAGE_KEYS.resetLease,
      scope: 'all-local-data',
      preserveDuringCleanup: true,
    },
    {
      match: 'exact',
      value: KNIFE4J_STORAGE_KEYS.resetGeneration,
      scope: 'all-local-data',
      preserveDuringCleanup: true,
    },
    {
      match: 'prefix',
      value: KNIFE4J_STORAGE_PREFIXES.resetClaim,
      scope: 'all-local-data',
      preserveDuringCleanup: true,
    },
    {
      match: 'exact',
      value: KNIFE4J_STORAGE_KEYS.mutationLease,
      scope: 'all-local-data',
      preserveDuringCleanup: true,
    },
    {
      match: 'exact',
      value: KNIFE4J_STORAGE_KEYS.requestCacheEpoch,
      scope: 'request-cache',
      preserveDuringCleanup: true,
    },
    {
      match: 'prefix',
      value: KNIFE4J_STORAGE_PREFIXES.mutationClaim,
      scope: 'all-local-data',
      preserveDuringCleanup: true,
    },
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

export interface Knife4jStorageLockManager {
  request<T>(
    name: string,
    options: { mode: 'shared' | 'exclusive'; ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => T | PromiseLike<T>,
  ): Promise<T>;
}

const pendingKnife4jStorageWrites = new Set<Promise<unknown>>();
let allLocalDataCleanupCount = 0;
const KNIFE4J_STORAGE_RESET_LOCK = 'knife4j-next:storage-reset';
const KNIFE4J_STORAGE_RESET_LEASE_VERSION = 1;
const KNIFE4J_STORAGE_RESET_LEASE_TTL_MS = 2 * 60 * 1000;
const KNIFE4J_STORAGE_RESET_LEASE_POLL_MS = 50;
const KNIFE4J_STORAGE_RESET_CLAIM_TTL_MS = 10 * 1000;
const KNIFE4J_STORAGE_COORDINATION_DB = 'knife4j-next-storage-coordination';
const KNIFE4J_STORAGE_COORDINATION_STORE = 'locks';
const KNIFE4J_STORAGE_COORDINATION_KEY = 'storage-mutation';
let storageCoordinationDatabase: Promise<IDBDatabase> | null = null;

export interface Knife4jStorageResetSnapshot {
  readonly generation: string;
  readonly active: boolean;
}

/** Value plus the reset/cache epochs observed by the read that produced it. */
export interface Knife4jStorageItemSnapshot {
  readonly value: string | null;
  readonly resetGeneration: string;
  readonly resetActive: boolean;
  readonly requestCacheGeneration?: string;
}

type Knife4jStorageResetListener = (snapshot: Knife4jStorageResetSnapshot) => void;

let observedResetSnapshot: Knife4jStorageResetSnapshot = { generation: '', active: false };
const resetSnapshotListeners = new Set<Knife4jStorageResetListener>();
let resetLeaseExpiryTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledResetLeaseStorage: Knife4jWebStorage | null = null;
let scheduledResetLeaseGeneration = '';
let scheduledResetLeaseExpiresAt = 0;

interface Knife4jStorageResetLease {
  version: typeof KNIFE4J_STORAGE_RESET_LEASE_VERSION;
  generation: string;
  expiresAt: number;
}

interface Knife4jStorageResetClaim extends Knife4jStorageResetLease {
  createdAt: number;
}

interface PendingKnife4jWebStorageValue {
  writeId: string;
  value: string | null;
  generation: string;
  requestCacheGeneration?: string;
}

const pendingWebStorageValues = new WeakMap<object, Map<string, PendingKnife4jWebStorageValue>>();
const fallbackMutationTails = new WeakMap<object, Promise<void>>();

function cancelResetLeaseExpiry(storage?: Knife4jWebStorage | null, generation?: string): void {
  if (
    resetLeaseExpiryTimer === null ||
    (storage !== undefined && scheduledResetLeaseStorage !== storage) ||
    (generation !== undefined && scheduledResetLeaseGeneration !== generation)
  ) {
    return;
  }
  clearTimeout(resetLeaseExpiryTimer);
  resetLeaseExpiryTimer = null;
  scheduledResetLeaseStorage = null;
  scheduledResetLeaseGeneration = '';
  scheduledResetLeaseExpiresAt = 0;
}

function scheduleResetLeaseExpiry(storage: Knife4jWebStorage, lease: Knife4jStorageResetLease, now = Date.now()): void {
  if (lease.expiresAt <= now) {
    cancelResetLeaseExpiry(storage, lease.generation);
    return;
  }
  if (
    resetLeaseExpiryTimer !== null &&
    scheduledResetLeaseStorage === storage &&
    scheduledResetLeaseGeneration === lease.generation &&
    scheduledResetLeaseExpiresAt === lease.expiresAt
  ) {
    return;
  }

  cancelResetLeaseExpiry();
  scheduledResetLeaseStorage = storage;
  scheduledResetLeaseGeneration = lease.generation;
  scheduledResetLeaseExpiresAt = lease.expiresAt;
  resetLeaseExpiryTimer = setTimeout(
    () => {
      resetLeaseExpiryTimer = null;
      scheduledResetLeaseStorage = null;
      scheduledResetLeaseGeneration = '';
      scheduledResetLeaseExpiresAt = 0;
      getKnife4jStorageResetSnapshot(storage);
    },
    Math.max(0, lease.expiresAt - now + 1),
  );
  (resetLeaseExpiryTimer as unknown as { unref?: () => void }).unref?.();
}

function observeResetSnapshot(generation: string, active: boolean): Knife4jStorageResetSnapshot {
  const nextGeneration = generation || observedResetSnapshot.generation;
  if (observedResetSnapshot.generation === nextGeneration && observedResetSnapshot.active === active) {
    return observedResetSnapshot;
  }

  observedResetSnapshot = { generation: nextGeneration, active };
  resetSnapshotListeners.forEach((listener) => {
    try {
      listener(observedResetSnapshot);
    } catch {
      // A consumer refresh failure must not weaken reset coordination.
    }
  });
  return observedResetSnapshot;
}

function parseResetLease(value: string | null): Knife4jStorageResetLease | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Knife4jStorageResetLease>;
    if (
      parsed.version !== KNIFE4J_STORAGE_RESET_LEASE_VERSION ||
      typeof parsed.generation !== 'string' ||
      !parsed.generation ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return null;
    }
    return parsed as Knife4jStorageResetLease;
  } catch {
    return null;
  }
}

interface Knife4jRequestCacheSnapshot {
  generation: string;
  active: boolean;
  expiresAt: number;
}

function getRequestCacheSnapshot(storage: Knife4jWebStorage | null): Knife4jRequestCacheSnapshot {
  if (!storage) return { generation: '', active: false, expiresAt: 0 };
  try {
    const epoch = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch));
    if (!epoch) return { generation: '', active: false, expiresAt: 0 };
    return {
      generation: epoch.generation,
      active: epoch.expiresAt > Date.now(),
      expiresAt: epoch.expiresAt,
    };
  } catch {
    return { generation: '', active: false, expiresAt: 0 };
  }
}

function beginRequestCacheCleanup(
  storage: Knife4jWebStorage | null,
  onCoordinationError?: (error: unknown) => void,
): Knife4jStorageResetLease | null {
  if (!storage) return null;
  const epoch: Knife4jStorageResetLease = {
    version: KNIFE4J_STORAGE_RESET_LEASE_VERSION,
    generation: createResetGeneration(),
    expiresAt: Date.now() + KNIFE4J_STORAGE_RESET_LEASE_TTL_MS,
  };
  try {
    storage.setItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch, JSON.stringify(epoch));
    const persisted = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch));
    return persisted?.generation === epoch.generation ? epoch : null;
  } catch (error) {
    onCoordinationError?.(error);
    return null;
  }
}

function renewRequestCacheCleanup(storage: Knife4jWebStorage, epoch: Knife4jStorageResetLease): boolean {
  try {
    const current = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch));
    if (current?.generation !== epoch.generation || current.expiresAt <= Date.now()) return false;
    epoch.expiresAt = Date.now() + KNIFE4J_STORAGE_RESET_LEASE_TTL_MS;
    storage.setItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch, JSON.stringify(epoch));
    return parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch))?.generation === epoch.generation;
  } catch {
    return false;
  }
}

function startRequestCacheCleanupHeartbeat(
  storage: Knife4jWebStorage | null,
  epoch: Knife4jStorageResetLease | null,
): () => void {
  if (!storage || !epoch) return () => {};
  const timer = setInterval(() => {
    if (!renewRequestCacheCleanup(storage, epoch)) clearInterval(timer);
  }, KNIFE4J_STORAGE_RESET_LEASE_TTL_MS / 4);
  return () => clearInterval(timer);
}

function completeRequestCacheCleanup(storage: Knife4jWebStorage | null, epoch: Knife4jStorageResetLease | null): void {
  if (!storage || !epoch) return;
  try {
    const current = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch));
    if (current?.generation !== epoch.generation) return;
    epoch.expiresAt = 0;
    storage.setItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch, JSON.stringify(epoch));
  } catch {
    // The active epoch expires and fails closed if completion cannot be persisted.
  }
}

function isRequestCacheStorageKey(key: string): boolean {
  return matchesRegisteredEntry(key, entriesForScope(KNIFE4J_STORAGE_REGISTRY.localStorage, 'request-cache'));
}

async function waitForRequestCacheWriteTurn(
  storage: Knife4jWebStorage | null,
  generation: string | undefined,
): Promise<boolean> {
  if (generation === undefined) return true;
  for (;;) {
    const snapshot = getRequestCacheSnapshot(storage);
    if (snapshot.generation !== generation) return false;
    if (!snapshot.active) return true;
    const remaining = Math.max(0, snapshot.expiresAt - Date.now());
    await new Promise((resolve) => setTimeout(resolve, Math.min(KNIFE4J_STORAGE_RESET_LEASE_POLL_MS, remaining)));
  }
}

function readResetLease(storage: Knife4jWebStorage | null, now = Date.now()): Knife4jStorageResetLease | null {
  if (!storage) return null;
  let lease: Knife4jStorageResetLease | null;
  try {
    lease = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.resetLease));
  } catch {
    return null;
  }
  if (!lease) {
    cancelResetLeaseExpiry(storage);
    return null;
  }
  const active = lease.expiresAt > now;
  if (active) scheduleResetLeaseExpiry(storage, lease, now);
  else cancelResetLeaseExpiry(storage, lease.generation);
  observeResetSnapshot(lease.generation, active);
  if (active) return lease;
  return null;
}

/** Read the durable reset epoch and whether a full reset currently owns the lease. */
export function getKnife4jStorageResetSnapshot(
  storage: Knife4jWebStorage | null = browserStorage('localStorage'),
): Knife4jStorageResetSnapshot {
  let persistedGeneration = '';
  if (storage) {
    try {
      persistedGeneration = storage.getItem(KNIFE4J_STORAGE_KEYS.resetGeneration)?.trim() ?? '';
    } catch {
      // Keep the last generation observed in this browsing context.
    }
  }

  const activeLease = readResetLease(storage);
  const generation = activeLease?.generation || persistedGeneration || observedResetSnapshot.generation;
  return observeResetSnapshot(generation, allLocalDataCleanupCount > 0 || activeLease !== null);
}

/** Subscribe to reset generation or activity changes in this browsing context. */
export function subscribeKnife4jStorageReset(listener: Knife4jStorageResetListener): () => void {
  resetSnapshotListeners.add(listener);
  return () => resetSnapshotListeners.delete(listener);
}

function createResetGeneration(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall back to a non-security-sensitive unique value.
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function observeResetStorageEvent(event: StorageEvent): void {
  if (event.key !== KNIFE4J_STORAGE_KEYS.resetLease && event.key !== KNIFE4J_STORAGE_KEYS.resetGeneration) return;

  const storage = browserStorage('localStorage');
  if (storage) {
    getKnife4jStorageResetSnapshot(storage);
    return;
  }

  if (event.key === KNIFE4J_STORAGE_KEYS.resetLease) {
    const lease = parseResetLease(event.newValue);
    observeResetSnapshot(lease?.generation ?? '', lease !== null && lease.expiresAt > Date.now());
  } else {
    observeResetSnapshot(event.newValue?.trim() ?? '', observedResetSnapshot.active);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', observeResetStorageEvent);
}

function browserStorageLockManager(): Knife4jStorageLockManager | null {
  if (typeof navigator === 'undefined' || !navigator.locks) return null;
  return navigator.locks as unknown as Knife4jStorageLockManager;
}

function openStorageCoordinationDatabase(): Promise<IDBDatabase> {
  if (storageCoordinationDatabase) return storageCoordinationDatabase;
  storageCoordinationDatabase = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB coordination unavailable'));
      return;
    }
    let openFailed = false;
    const rejectOpen = (error: Error) => {
      openFailed = true;
      reject(error);
    };
    const request = indexedDB.open(KNIFE4J_STORAGE_COORDINATION_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(KNIFE4J_STORAGE_COORDINATION_STORE)) {
        request.result.createObjectStore(KNIFE4J_STORAGE_COORDINATION_STORE);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (openFailed) {
        database.close();
        return;
      }
      database.onversionchange = () => {
        database.close();
        storageCoordinationDatabase = null;
      };
      resolve(database);
    };
    request.onerror = () => rejectOpen(request.error ?? new Error('IndexedDB coordination open failed'));
    request.onblocked = () => rejectOpen(new Error('IndexedDB coordination open blocked'));
  }).catch((error) => {
    storageCoordinationDatabase = null;
    throw error;
  });
  return storageCoordinationDatabase;
}

/**
 * Hold a browser-managed IndexedDB transaction across a fallback mutation.
 * Unlike the expiring localStorage lease, a suspended renderer cannot let a
 * competing tab enter this critical section; a discarded renderer releases
 * the transaction without resuming its target write.
 */
async function runWithFallbackCriticalSection<T>(
  mutation: (retainsCriticalSection: () => boolean) => Promise<T> | T,
): Promise<T | undefined> {
  // Unit adapters and SSR have no competing browser context. Production
  // browsers must fail closed when IndexedDB coordination is unavailable.
  if (typeof window === 'undefined' || window !== globalThis) return mutation(() => true);

  let database: IDBDatabase;
  try {
    database = await openStorageCoordinationDatabase();
  } catch {
    return undefined;
  }

  return new Promise<T | undefined>((resolve) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(KNIFE4J_STORAGE_COORDINATION_STORE, 'readwrite');
    } catch {
      resolve(undefined);
      return;
    }

    const store = transaction.objectStore(KNIFE4J_STORAGE_COORDINATION_STORE);
    let active = true;
    let started = false;
    let settled = false;
    let failed = false;
    let result: T | undefined;
    let finished = false;
    const finish = (value: T | undefined) => {
      if (finished) return;
      finished = true;
      resolve(value);
    };

    const fail = () => {
      if (failed) return;
      active = false;
      failed = true;
      try {
        transaction.abort();
      } catch {
        finish(undefined);
      }
    };

    transaction.oncomplete = () => {
      active = false;
      finish(failed ? undefined : result);
    };
    transaction.onabort = () => {
      active = false;
      finish(undefined);
    };
    transaction.onerror = fail;

    const keepAlive = () => {
      let request: IDBRequest;
      try {
        request = store.get(KNIFE4J_STORAGE_COORDINATION_KEY);
      } catch {
        fail();
        return;
      }
      request.onsuccess = () => {
        if (!started) {
          started = true;
          void Promise.resolve()
            .then(() => mutation(() => active))
            .then(
              (value) => {
                result = value;
                settled = true;
              },
              () => {
                settled = true;
                fail();
              },
            );
        }
        if (!settled) {
          keepAlive();
          return;
        }
        if (failed) return;
        try {
          store.put(Date.now(), KNIFE4J_STORAGE_COORDINATION_KEY);
        } catch {
          fail();
        }
      };
      request.onerror = fail;
    };

    keepAlive();
  });
}

type Knife4jStorageWriteFence = (() => boolean) & { readonly generation: string };
type Knife4jRequestCacheWriteFence = (() => boolean) & { readonly generation?: string };

function createKnife4jStorageWriteFence(
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
  expectedGeneration?: string,
): Knife4jStorageWriteFence {
  const generation = expectedGeneration ?? getKnife4jStorageResetSnapshot(leaseStorage).generation;
  const canWrite = () => {
    const snapshot = getKnife4jStorageResetSnapshot(leaseStorage);
    return allLocalDataCleanupCount === 0 && !snapshot.active && generation === snapshot.generation;
  };
  return Object.assign(canWrite, { generation });
}

function createRequestCacheWriteFence(
  key: string,
  storage: Knife4jWebStorage | null,
  expectedGeneration?: string,
): Knife4jRequestCacheWriteFence {
  if (!isRequestCacheStorageKey(key)) return Object.assign(() => true, { generation: undefined });
  const generation = expectedGeneration ?? getRequestCacheSnapshot(storage).generation;
  const canWrite = () => {
    const snapshot = getRequestCacheSnapshot(storage);
    return !snapshot.active && snapshot.generation === generation;
  };
  return Object.assign(canWrite, { generation });
}

function pendingWebStorageMap(storage: object): Map<string, PendingKnife4jWebStorageValue> {
  let values = pendingWebStorageValues.get(storage);
  if (!values) {
    values = new Map();
    pendingWebStorageValues.set(storage, values);
  }
  return values;
}

function publishPendingWebStorageRemovals(
  storage: Knife4jWebStorage | null,
  scope: Knife4jStorageCleanupScope,
  generation: string,
  requestCacheGeneration?: string,
): () => void {
  if (!storage) return () => {};

  const keys = new Set(pendingWebStorageValues.get(storage)?.keys() ?? []);
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null) keys.add(key);
    }
  } catch {
    // The coordinated cleanup records storage enumeration failures itself.
  }

  const entries = entriesForScope(KNIFE4J_STORAGE_REGISTRY.localStorage, scope);
  const matchedKeys = Array.from(keys).filter((key) => matchesRegisteredEntry(key, entries));
  if (matchedKeys.length === 0) return () => {};

  const writeId = createResetGeneration();
  const pending = pendingWebStorageMap(storage);
  matchedKeys.forEach((key) => pending.set(key, { writeId, value: null, generation, requestCacheGeneration }));
  return () => {
    matchedKeys.forEach((key) => {
      if (pending.get(key)?.writeId === writeId) pending.delete(key);
    });
  };
}

/** Read through the local pending write/removal overlay before falling back to Web Storage. */
export function getKnife4jStorageItem(
  storage: Pick<Storage, 'getItem'>,
  key: string,
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
): string | null {
  const pending = pendingWebStorageValues.get(storage)?.get(key);
  const requestCacheKey = isRequestCacheStorageKey(key);
  const requestCacheSnapshot = requestCacheKey ? getRequestCacheSnapshot(leaseStorage) : null;
  if (pending) {
    const snapshot = getKnife4jStorageResetSnapshot(leaseStorage);
    if (
      !snapshot.active &&
      snapshot.generation === pending.generation &&
      (!requestCacheKey || pending.requestCacheGeneration === requestCacheSnapshot?.generation)
    ) {
      return pending.value;
    }
  }
  if (requestCacheSnapshot?.active) return null;
  return storage.getItem(key);
}

/**
 * Read a value together with the epochs that made the read valid. If either
 * epoch changes while reading, discard the value so a later write cannot
 * carry pre-cleanup data into the new epoch.
 */
export function getKnife4jStorageItemSnapshot(
  storage: Pick<Storage, 'getItem'>,
  key: string,
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
): Knife4jStorageItemSnapshot {
  const requestCacheKey = isRequestCacheStorageKey(key);
  const resetBefore = getKnife4jStorageResetSnapshot(leaseStorage);
  const requestCacheBefore = requestCacheKey ? getRequestCacheSnapshot(leaseStorage) : null;
  const value = getKnife4jStorageItem(storage, key, leaseStorage);
  const resetAfter = getKnife4jStorageResetSnapshot(leaseStorage);
  const requestCacheAfter = requestCacheKey ? getRequestCacheSnapshot(leaseStorage) : null;
  const stableReset = !resetBefore.active && !resetAfter.active && resetBefore.generation === resetAfter.generation;
  const stableRequestCache =
    !requestCacheKey ||
    (requestCacheBefore !== null &&
      requestCacheAfter !== null &&
      !requestCacheBefore.active &&
      !requestCacheAfter.active &&
      requestCacheBefore.generation === requestCacheAfter.generation);

  return {
    value: stableReset && stableRequestCache ? value : null,
    resetGeneration: resetAfter.generation,
    resetActive: resetAfter.active,
    requestCacheGeneration: requestCacheAfter?.generation,
  };
}

/** Persist one registered value while sharing the same reset/mutation lock. */
export async function persistKnife4jStorageItem(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  key: string,
  value: string,
  lockManager: Knife4jStorageLockManager | null = browserStorageLockManager(),
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
  expectedSnapshot?: Knife4jStorageItemSnapshot,
): Promise<boolean> {
  try {
    if (expectedSnapshot?.resetActive) return false;
    const resetCanWrite = createKnife4jStorageWriteFence(leaseStorage, expectedSnapshot?.resetGeneration);
    const requestCacheCanWrite = createRequestCacheWriteFence(
      key,
      leaseStorage,
      expectedSnapshot?.requestCacheGeneration,
    );
    if (!(await waitForRequestCacheWriteTurn(leaseStorage, requestCacheCanWrite.generation))) return false;
    if (!resetCanWrite()) return false;
    const persisted = await trackKnife4jStorageWrite(
      async (canWrite) => {
        const retainsWriteFence = () => canWrite() && resetCanWrite() && requestCacheCanWrite();
        if (!retainsWriteFence()) return false;
        storage.setItem(key, value);
        if (retainsWriteFence()) return true;
        if (storage.getItem(key) === value) storage.removeItem(key);
        return false;
      },
      lockManager,
      leaseStorage,
    );
    return persisted === true;
  } catch {
    return false;
  }
}

/**
 * Queue a registered Web Storage write, expose its latest value locally
 * immediately, and resolve only after durable persistence succeeds or fails.
 */
export function setKnife4jStorageItem(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  key: string,
  value: string,
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
  lockManager: Knife4jStorageLockManager | null = browserStorageLockManager(),
  expectedSnapshot?: Knife4jStorageItemSnapshot,
): Promise<boolean> {
  if (!leaseStorage) {
    try {
      storage.setItem(key, value);
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }
  const snapshot = getKnife4jStorageResetSnapshot(leaseStorage);
  if (snapshot.active || expectedSnapshot?.resetActive) return Promise.resolve(false);
  const requestCacheCanWrite = createRequestCacheWriteFence(
    key,
    leaseStorage,
    expectedSnapshot?.requestCacheGeneration,
  );
  const writeSnapshot: Knife4jStorageItemSnapshot =
    expectedSnapshot ??
    ({
      value: null,
      resetGeneration: snapshot.generation,
      resetActive: snapshot.active,
      requestCacheGeneration: requestCacheCanWrite.generation,
    } satisfies Knife4jStorageItemSnapshot);

  const writeId = createResetGeneration();
  const pending = pendingWebStorageMap(storage);
  pending.set(key, {
    writeId,
    value,
    generation: writeSnapshot.resetGeneration,
    requestCacheGeneration: writeSnapshot.requestCacheGeneration,
  });
  return persistKnife4jStorageItem(storage, key, value, lockManager, leaseStorage, writeSnapshot).finally(() => {
    if (pending.get(key)?.writeId === writeId) pending.delete(key);
  });
}

/** Session Storage is tab-scoped, so a synchronous write only needs the local reset fence. */
export function setKnife4jSessionStorageItem(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  key: string,
  value: string,
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
): boolean {
  const canWrite = createKnife4jStorageWriteFence(leaseStorage);
  if (!canWrite()) return false;
  storage.setItem(key, value);
  if (canWrite()) return true;
  if (storage.getItem(key) === value) storage.removeItem(key);
  return false;
}

/** Remove one registered value under the same cross-context mutation lock as a full reset. */
export async function removeKnife4jStorageItem(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  key: string,
  lockManager: Knife4jStorageLockManager | null = browserStorageLockManager(),
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
): Promise<boolean> {
  try {
    if (!leaseStorage) {
      storage.removeItem(key);
      return true;
    }
    const snapshot = getKnife4jStorageResetSnapshot(leaseStorage);
    if (snapshot.active) return false;
    const resetCanWrite = createKnife4jStorageWriteFence(leaseStorage);
    const requestCacheCanWrite = createRequestCacheWriteFence(key, leaseStorage);

    const writeId = createResetGeneration();
    const pending = pendingWebStorageMap(storage);
    pending.set(key, {
      writeId,
      value: null,
      generation: snapshot.generation,
      requestCacheGeneration: requestCacheCanWrite.generation,
    });
    try {
      if (!(await waitForRequestCacheWriteTurn(leaseStorage, requestCacheCanWrite.generation))) return false;
      if (!resetCanWrite()) return false;
      const removed = await trackKnife4jStorageWrite(
        async (canWrite) => {
          const retainsWriteFence = () => canWrite() && resetCanWrite() && requestCacheCanWrite();
          if (!retainsWriteFence()) return false;
          storage.removeItem(key);
          return retainsWriteFence();
        },
        lockManager,
        leaseStorage,
      );
      return removed === true;
    } finally {
      if (pending.get(key)?.writeId === writeId) pending.delete(key);
    }
  } catch {
    return false;
  }
}

/**
 * Serialize every Knife4j persistence operation with full resets running in
 * other same-origin browsing contexts. A mutation queued behind a reset keeps
 * its original generation fence and is refused after the reset completes.
 */
export function withKnife4jStorageWriteLock<T>(
  write: (canWrite: () => boolean) => Promise<T>,
  lockManager: Knife4jStorageLockManager | null = browserStorageLockManager(),
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
): Promise<T | undefined> {
  const canWrite = createKnife4jStorageWriteFence(leaseStorage);
  const guardedWrite = () => (canWrite() ? write(canWrite) : undefined);
  if (!lockManager) {
    if (!leaseStorage) return Promise.resolve().then(guardedWrite);
    return enqueueFallbackMutation(leaseStorage, () => runWithFallbackMutationLease(write, canWrite, leaseStorage));
  }
  return lockManager.request(KNIFE4J_STORAGE_RESET_LOCK, { mode: 'exclusive' }, guardedWrite);
}

function enqueueFallbackMutation<T>(
  storage: Knife4jWebStorage,
  mutation: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const previous = fallbackMutationTails.get(storage) ?? Promise.resolve();
  const current = previous.then(mutation, mutation);
  const tail = current.then(
    () => undefined,
    () => undefined,
  );
  fallbackMutationTails.set(storage, tail);
  void tail.finally(() => {
    if (fallbackMutationTails.get(storage) === tail) fallbackMutationTails.delete(storage);
  });
  return current;
}

async function runWithFallbackMutationLease<T>(
  write: (canWrite: () => boolean) => Promise<T>,
  canWrite: () => boolean,
  storage: Knife4jWebStorage,
): Promise<T | undefined> {
  const lease = await acquireMutationLease(storage);
  if (!lease) return undefined;
  const stopHeartbeat = startMutationLeaseHeartbeat(storage, lease);
  const retainsMutationLease = () => renewMutationLease(storage, lease) && canWrite();
  try {
    return await runWithFallbackCriticalSection((retainsCriticalSection) => {
      const retainsFallbackCoordination = () => retainsCriticalSection() && retainsMutationLease();
      if (!retainsFallbackCoordination()) return Promise.resolve(undefined);
      return write(retainsFallbackCoordination);
    });
  } finally {
    stopHeartbeat();
    releaseMutationLease(storage, lease);
  }
}

/**
 * Register an asynchronous Knife4j persistence operation. A full reset waits
 * for writes that already started and suppresses new writes until its final
 * deletion pass has completed.
 */
export function trackKnife4jStorageWrite<T>(
  write: (canWrite: () => boolean) => Promise<T>,
  lockManager: Knife4jStorageLockManager | null = browserStorageLockManager(),
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
): Promise<T | undefined> {
  if (allLocalDataCleanupCount > 0) return Promise.resolve(undefined);

  const pending = withKnife4jStorageWriteLock(write, lockManager, leaseStorage);
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

function isQuotaExceededError(error: unknown): boolean {
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'].includes(error.name)
  ) {
    return true;
  }
  return /quota/i.test(errorMessage(error));
}

function entriesForScope(
  registry: readonly RegisteredEntry[],
  scope: Knife4jStorageCleanupScope,
): readonly RegisteredEntry[] {
  return registry.filter(
    (entry) => !entry.preserveDuringCleanup && (scope === 'all-local-data' || entry.scope === 'request-cache'),
  );
}

function matchesRegisteredEntry(key: string, entries: readonly RegisteredEntry[]): boolean {
  return entries.some((entry) => (entry.match === 'exact' ? key === entry.value : key.startsWith(entry.value)));
}

function recordFailure(result: Knife4jStorageCleanupResult, failure: Knife4jStorageCleanupFailure): void {
  const duplicate = result.failures.some(
    (existing) => existing.area === failure.area && existing.key === failure.key && existing.reason === failure.reason,
  );
  if (!duplicate) result.failures.push(failure);
}

function recordUnavailable(result: Knife4jStorageCleanupResult, area: Knife4jStorageArea): void {
  recordFailure(result, { area, reason: `${area} unavailable` });
}

function recordFallbackCriticalSectionUnavailable(
  result: Knife4jStorageCleanupResult,
  operation: 'request cache' | 'storage reset',
): void {
  recordFailure(result, {
    area: 'indexedDB',
    key: KNIFE4J_STORAGE_COORDINATION_DB,
    reason: `${operation} coordination unavailable`,
  });
}

function waitForResetLeaseTurn(lease: Knife4jStorageResetLease): Promise<void> {
  const remaining = Math.max(0, lease.expiresAt - Date.now());
  return new Promise((resolve) => setTimeout(resolve, Math.min(KNIFE4J_STORAGE_RESET_LEASE_POLL_MS, remaining)));
}

function parseResetClaim(value: string | null): Knife4jStorageResetClaim | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Knife4jStorageResetClaim>;
    if (
      parsed.version !== KNIFE4J_STORAGE_RESET_LEASE_VERSION ||
      typeof parsed.generation !== 'string' ||
      !parsed.generation ||
      typeof parsed.createdAt !== 'number' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return null;
    }
    return parsed as Knife4jStorageResetClaim;
  } catch {
    return null;
  }
}

function resetClaimStorageKey(generation: string): string {
  return `${KNIFE4J_STORAGE_PREFIXES.resetClaim}${generation}`;
}

function removeResetClaim(storage: Knife4jWebStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Acquisition will report any storage failure that affects correctness.
  }
}

function listActiveResetClaims(
  storage: Knife4jWebStorage,
  now = Date.now(),
): Array<{ key: string; claim: Knife4jStorageResetClaim }> {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(KNIFE4J_STORAGE_PREFIXES.resetClaim)) keys.push(key);
  }

  const claims: Array<{ key: string; claim: Knife4jStorageResetClaim }> = [];
  for (const key of keys) {
    const claim = parseResetClaim(storage.getItem(key));
    if (!claim || claim.expiresAt <= now) {
      removeResetClaim(storage, key);
      continue;
    }
    claims.push({ key, claim });
  }
  return claims.sort(
    (left, right) =>
      left.claim.createdAt - right.claim.createdAt || left.claim.generation.localeCompare(right.claim.generation),
  );
}

function mutationClaimStorageKey(generation: string): string {
  return `${KNIFE4J_STORAGE_PREFIXES.mutationClaim}${generation}`;
}

function listActiveMutationClaims(
  storage: Knife4jWebStorage,
  now = Date.now(),
): Array<{ key: string; claim: Knife4jStorageResetClaim }> {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(KNIFE4J_STORAGE_PREFIXES.mutationClaim)) keys.push(key);
  }

  const claims: Array<{ key: string; claim: Knife4jStorageResetClaim }> = [];
  for (const key of keys) {
    const claim = parseResetClaim(storage.getItem(key));
    if (!claim || claim.expiresAt <= now) {
      removeResetClaim(storage, key);
      continue;
    }
    claims.push({ key, claim });
  }
  return claims.sort(
    (left, right) =>
      left.claim.createdAt - right.claim.createdAt || left.claim.generation.localeCompare(right.claim.generation),
  );
}

async function acquireMutationLease(
  storage: Knife4jWebStorage,
  onCoordinationError?: (error: unknown) => void,
): Promise<Knife4jStorageResetLease | null> {
  for (;;) {
    let publishedClaimKey: string | null = null;
    let candidateLease: Knife4jStorageResetLease | null = null;
    try {
      const createdAt = Date.now();
      const claim: Knife4jStorageResetClaim = {
        version: KNIFE4J_STORAGE_RESET_LEASE_VERSION,
        generation: createResetGeneration(),
        createdAt,
        expiresAt: createdAt + KNIFE4J_STORAGE_RESET_CLAIM_TTL_MS,
      };
      const claimKey = mutationClaimStorageKey(claim.generation);
      publishedClaimKey = claimKey;
      storage.setItem(claimKey, JSON.stringify(claim));
      await new Promise((resolve) => setTimeout(resolve, KNIFE4J_STORAGE_RESET_LEASE_POLL_MS));

      for (;;) {
        claim.expiresAt = Date.now() + KNIFE4J_STORAGE_RESET_CLAIM_TTL_MS;
        storage.setItem(claimKey, JSON.stringify(claim));
        const activeLease = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.mutationLease));
        if (activeLease && activeLease.expiresAt > Date.now()) {
          await waitForResetLeaseTurn(activeLease);
          continue;
        }

        if (listActiveMutationClaims(storage)[0]?.claim.generation !== claim.generation) {
          await new Promise((resolve) => setTimeout(resolve, KNIFE4J_STORAGE_RESET_LEASE_POLL_MS));
          continue;
        }

        const recheckedLease = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.mutationLease));
        if (recheckedLease && recheckedLease.expiresAt > Date.now()) continue;

        const lease: Knife4jStorageResetLease = {
          version: KNIFE4J_STORAGE_RESET_LEASE_VERSION,
          generation: claim.generation,
          expiresAt: Date.now() + KNIFE4J_STORAGE_RESET_LEASE_TTL_MS,
        };
        storage.setItem(KNIFE4J_STORAGE_KEYS.mutationLease, JSON.stringify(lease));
        candidateLease = lease;
        await new Promise((resolve) => setTimeout(resolve, KNIFE4J_STORAGE_RESET_LEASE_POLL_MS));

        const persisted = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.mutationLease));
        const winner = listActiveMutationClaims(storage)[0]?.claim;
        if (persisted?.generation === lease.generation && winner?.generation === claim.generation) {
          removeResetClaim(storage, claimKey);
          publishedClaimKey = null;
          return lease;
        }

        if (persisted?.generation === lease.generation) {
          storage.removeItem(KNIFE4J_STORAGE_KEYS.mutationLease);
          candidateLease = null;
        }
        await new Promise((resolve) => setTimeout(resolve, KNIFE4J_STORAGE_RESET_LEASE_POLL_MS));
      }
    } catch (error) {
      onCoordinationError?.(error);
      if (publishedClaimKey) removeResetClaim(storage, publishedClaimKey);
      if (candidateLease) {
        try {
          const persisted = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.mutationLease));
          if (persisted?.generation === candidateLease.generation) {
            storage.removeItem(KNIFE4J_STORAGE_KEYS.mutationLease);
          }
        } catch {
          // The caller treats an unavailable fallback mutex as a refused mutation.
        }
      }
      return null;
    }
  }
}

function renewMutationLease(storage: Knife4jWebStorage, lease: Knife4jStorageResetLease): boolean {
  try {
    const current = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.mutationLease));
    if (current?.generation !== lease.generation || current.expiresAt <= Date.now()) return false;
    lease.expiresAt = Date.now() + KNIFE4J_STORAGE_RESET_LEASE_TTL_MS;
    storage.setItem(KNIFE4J_STORAGE_KEYS.mutationLease, JSON.stringify(lease));
    return parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.mutationLease))?.generation === lease.generation;
  } catch {
    return false;
  }
}

function startMutationLeaseHeartbeat(storage: Knife4jWebStorage, lease: Knife4jStorageResetLease): () => void {
  const timer = setInterval(() => {
    if (!renewMutationLease(storage, lease)) clearInterval(timer);
  }, KNIFE4J_STORAGE_RESET_LEASE_TTL_MS / 4);
  return () => clearInterval(timer);
}

function releaseMutationLease(storage: Knife4jWebStorage, lease: Knife4jStorageResetLease): void {
  try {
    const current = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.mutationLease));
    if (current?.generation === lease.generation) storage.removeItem(KNIFE4J_STORAGE_KEYS.mutationLease);
  } catch {
    // Expiry still lets another mutation recover from an unavailable cleanup write.
  }
}

async function acquireResetLease(
  storage: Knife4jWebStorage | null,
  result: Knife4jStorageCleanupResult,
  recordCoordinationFailure = true,
  onCoordinationError?: (error: unknown) => void,
): Promise<Knife4jStorageResetLease | null> {
  if (!storage) return null;

  acquisition: for (;;) {
    let current: Knife4jStorageResetLease | null = null;
    let publishedClaimKey: string | null = null;
    let candidateLease: Knife4jStorageResetLease | null = null;
    try {
      current = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.resetLease));
      if (current) observeResetSnapshot(current.generation, current.expiresAt > Date.now());
      if (current && current.expiresAt > Date.now()) {
        await waitForResetLeaseTurn(current);
        continue;
      }

      const createdAt = Date.now();
      const claim: Knife4jStorageResetClaim = {
        version: KNIFE4J_STORAGE_RESET_LEASE_VERSION,
        generation: createResetGeneration(),
        createdAt,
        expiresAt: createdAt + KNIFE4J_STORAGE_RESET_CLAIM_TTL_MS,
      };
      const claimKey = resetClaimStorageKey(claim.generation);
      publishedClaimKey = claimKey;
      storage.setItem(claimKey, JSON.stringify(claim));
      await new Promise((resolve) => setTimeout(resolve, KNIFE4J_STORAGE_RESET_LEASE_POLL_MS));

      for (;;) {
        current = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.resetLease));
        if (current) observeResetSnapshot(current.generation, current.expiresAt > Date.now());
        if (current && current.expiresAt > Date.now()) {
          removeResetClaim(storage, claimKey);
          publishedClaimKey = null;
          await waitForResetLeaseTurn(current);
          continue acquisition;
        }

        claim.expiresAt = Date.now() + KNIFE4J_STORAGE_RESET_CLAIM_TTL_MS;
        storage.setItem(claimKey, JSON.stringify(claim));
        const winner = listActiveResetClaims(storage)[0]?.claim;
        if (winner?.generation !== claim.generation) {
          await new Promise((resolve) => setTimeout(resolve, KNIFE4J_STORAGE_RESET_LEASE_POLL_MS));
          continue;
        }

        current = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.resetLease));
        if (current && current.expiresAt > Date.now()) continue;

        const lease: Knife4jStorageResetLease = {
          version: KNIFE4J_STORAGE_RESET_LEASE_VERSION,
          generation: claim.generation,
          expiresAt: Date.now() + KNIFE4J_STORAGE_RESET_LEASE_TTL_MS,
        };
        storage.setItem(KNIFE4J_STORAGE_KEYS.resetLease, JSON.stringify(lease));
        candidateLease = lease;
        await new Promise((resolve) => setTimeout(resolve, KNIFE4J_STORAGE_RESET_LEASE_POLL_MS));

        const persisted = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.resetLease));
        const confirmedWinner = listActiveResetClaims(storage)[0]?.claim;
        if (persisted?.generation === lease.generation && confirmedWinner?.generation === claim.generation) {
          storage.setItem(KNIFE4J_STORAGE_KEYS.resetGeneration, lease.generation);
          if (storage.getItem(KNIFE4J_STORAGE_KEYS.resetGeneration) !== lease.generation) {
            throw new Error('reset generation was not persisted');
          }
          removeResetClaim(storage, claimKey);
          publishedClaimKey = null;
          observeResetSnapshot(lease.generation, true);
          return lease;
        }

        if (persisted) observeResetSnapshot(persisted.generation, persisted.expiresAt > Date.now());
        if (persisted?.generation === lease.generation) {
          storage.removeItem(KNIFE4J_STORAGE_KEYS.resetLease);
          candidateLease = null;
        }
        await new Promise((resolve) => setTimeout(resolve, KNIFE4J_STORAGE_RESET_LEASE_POLL_MS));
      }
    } catch (error) {
      onCoordinationError?.(error);
      if (publishedClaimKey) removeResetClaim(storage, publishedClaimKey);
      if (candidateLease) {
        try {
          const persisted = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.resetLease));
          if (persisted?.generation === candidateLease.generation) {
            storage.removeItem(KNIFE4J_STORAGE_KEYS.resetLease);
          }
        } catch {
          // The coordination failure below already makes the reset incomplete.
        }
      }
      if (recordCoordinationFailure) {
        recordFailure(result, {
          area: 'localStorage',
          key: KNIFE4J_STORAGE_KEYS.resetLease,
          reason: `reset coordination failed: ${errorMessage(error)}`,
        });
      }
      return null;
    }
  }
}

function renewResetLease(
  storage: Knife4jWebStorage,
  lease: Knife4jStorageResetLease,
  result: Knife4jStorageCleanupResult,
): boolean {
  try {
    const current = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.resetLease));
    if (current) observeResetSnapshot(current.generation, current.expiresAt > Date.now());
    if (current?.generation !== lease.generation) throw new Error('reset lease ownership was lost');
    if (current.expiresAt <= Date.now()) throw new Error('reset lease expired');
    lease.expiresAt = Date.now() + KNIFE4J_STORAGE_RESET_LEASE_TTL_MS;
    storage.setItem(KNIFE4J_STORAGE_KEYS.resetLease, JSON.stringify(lease));
    const persisted = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.resetLease));
    if (persisted?.generation !== lease.generation) throw new Error('reset lease renewal was lost');
    return true;
  } catch (error) {
    recordFailure(result, {
      area: 'localStorage',
      key: KNIFE4J_STORAGE_KEYS.resetLease,
      reason: `reset coordination renewal failed: ${errorMessage(error)}`,
    });
    return false;
  }
}

function startResetLeaseHeartbeat(
  storage: Knife4jWebStorage | null,
  lease: Knife4jStorageResetLease | null,
  result: Knife4jStorageCleanupResult,
): () => void {
  if (!storage || !lease) return () => {};
  const timer = setInterval(() => {
    if (!renewResetLease(storage, lease, result)) clearInterval(timer);
  }, KNIFE4J_STORAGE_RESET_LEASE_TTL_MS / 4);
  return () => clearInterval(timer);
}

function releaseResetLease(
  storage: Knife4jWebStorage | null,
  lease: Knife4jStorageResetLease | null,
  result: Knife4jStorageCleanupResult,
): void {
  if (!storage || !lease) return;
  try {
    const current = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.resetLease));
    if (current?.generation !== lease.generation) throw new Error('reset lease ownership was lost');
    storage.removeItem(KNIFE4J_STORAGE_KEYS.resetLease);
    cancelResetLeaseExpiry(storage, lease.generation);
    observeResetSnapshot(
      storage.getItem(KNIFE4J_STORAGE_KEYS.resetGeneration)?.trim() || lease.generation,
      allLocalDataCleanupCount > 0,
    );
  } catch (error) {
    getKnife4jStorageResetSnapshot(storage);
    recordFailure(result, {
      area: 'localStorage',
      key: KNIFE4J_STORAGE_KEYS.resetLease,
      reason: `reset coordination cleanup failed: ${errorMessage(error)}`,
    });
  }
}

function clearWebStorage(
  area: 'localStorage' | 'sessionStorage',
  storage: Knife4jWebStorage | null,
  registry: readonly RegisteredEntry[],
  result: Knife4jStorageCleanupResult,
  retainsResetLease: () => boolean = () => true,
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
    recordFailure(result, { area, reason: errorMessage(error) });
    return;
  }

  for (const key of keys) {
    if (!matchesRegisteredEntry(key, entries)) continue;
    if (!retainsResetLease()) return;
    try {
      storage.removeItem(key);
      result.removed[area] += 1;
    } catch (error) {
      recordFailure(result, { area, key, reason: errorMessage(error) });
    }
  }
}

async function clearIndexedDbStorage(
  storage: Knife4jIndexedDbStorage | null,
  result: Knife4jStorageCleanupResult,
  retainsResetLease: () => boolean,
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
    recordFailure(result, { area: 'indexedDB', reason: errorMessage(error) });
    return;
  }

  const entries = entriesForScope(KNIFE4J_STORAGE_REGISTRY.indexedDB, result.scope);
  for (const key of keys) {
    if (typeof key !== 'string' || !matchesRegisteredEntry(key, entries)) continue;
    if (!retainsResetLease()) return;
    try {
      await storage.delete(key);
      result.removed.indexedDB += 1;
    } catch (error) {
      recordFailure(result, { area: 'indexedDB', key, reason: errorMessage(error) });
    }
  }
}

export async function clearRegisteredKnife4jStorage(
  scope: Knife4jStorageCleanupScope,
  adapters: Knife4jStorageAdapters,
  lockManager: Knife4jStorageLockManager | null = browserStorageLockManager(),
): Promise<Knife4jStorageCleanupResult> {
  const guardsAsyncWrites = scope === 'all-local-data';
  if (guardsAsyncWrites) {
    allLocalDataCleanupCount += 1;
    getKnife4jStorageResetSnapshot(adapters.localStorage);
  }

  const result: Knife4jStorageCleanupResult = {
    scope,
    removed: { localStorage: 0, sessionStorage: 0, indexedDB: 0 },
    failures: [],
  };

  if (!guardsAsyncWrites) {
    const resetSnapshot = getKnife4jStorageResetSnapshot(adapters.localStorage);
    let requestCacheEpochError: unknown;
    let requestCacheEpoch = beginRequestCacheCleanup(adapters.localStorage, (error) => {
      requestCacheEpochError = error;
    });
    let stopRequestCacheHeartbeat = startRequestCacheCleanupHeartbeat(adapters.localStorage, requestCacheEpoch);
    const requestCacheGeneration = getRequestCacheSnapshot(adapters.localStorage).generation;
    const releasePendingRemovals = publishPendingWebStorageRemovals(
      adapters.localStorage,
      scope,
      resetSnapshot.generation,
      requestCacheGeneration,
    );
    const retainsResetGeneration = () => {
      const snapshot = getKnife4jStorageResetSnapshot(adapters.localStorage);
      return !snapshot.active && snapshot.generation === resetSnapshot.generation;
    };
    const hasCrossTabCacheInvalidation = () =>
      adapters.localStorage === null || getRequestCacheSnapshot(adapters.localStorage).active;
    const performRequestCacheCleanup = () =>
      trackKnife4jStorageWrite(
        async (canWrite) => {
          const retainsCleanupFence = () => canWrite() && hasCrossTabCacheInvalidation();
          if (!retainsCleanupFence()) return false;
          clearWebStorage(
            'localStorage',
            adapters.localStorage,
            KNIFE4J_STORAGE_REGISTRY.localStorage,
            result,
            retainsCleanupFence,
          );
          clearWebStorage(
            'sessionStorage',
            adapters.sessionStorage,
            KNIFE4J_STORAGE_REGISTRY.sessionStorage,
            result,
            retainsCleanupFence,
          );
          return retainsCleanupFence();
        },
        lockManager,
        adapters.localStorage,
      );

    try {
      let fallbackCriticalSectionUnavailable = false;
      let completed = await performRequestCacheCleanup();
      if (
        completed !== true &&
        !lockManager &&
        adapters.localStorage &&
        retainsResetGeneration() &&
        (requestCacheEpoch !== null || isQuotaExceededError(requestCacheEpochError))
      ) {
        // A full localStorage quota can prevent publishing the fallback claim.
        // Remove only the requested registered entries, then retry coordination
        // before clearing session state or running the final deletion scan.
        const recovered = await runWithFallbackCriticalSection((retainsCriticalSection) => {
          const retainsRecoveryFence = () => retainsCriticalSection() && retainsResetGeneration();
          if (!retainsRecoveryFence()) return false;
          clearWebStorage(
            'localStorage',
            adapters.localStorage,
            KNIFE4J_STORAGE_REGISTRY.localStorage,
            result,
            retainsRecoveryFence,
          );
          if (!retainsRecoveryFence()) return false;
          if (!getRequestCacheSnapshot(adapters.localStorage).active) {
            stopRequestCacheHeartbeat();
            requestCacheEpochError = undefined;
            requestCacheEpoch = beginRequestCacheCleanup(adapters.localStorage, (error) => {
              requestCacheEpochError = error;
            });
            stopRequestCacheHeartbeat = startRequestCacheCleanupHeartbeat(adapters.localStorage, requestCacheEpoch);
          }
          return retainsRecoveryFence() && hasCrossTabCacheInvalidation();
        });
        fallbackCriticalSectionUnavailable = recovered === undefined;
        if (recovered === true) {
          completed = await performRequestCacheCleanup();
        }
      }
      if (completed !== true) {
        if (fallbackCriticalSectionUnavailable) {
          recordFallbackCriticalSectionUnavailable(result, 'request cache');
        } else {
          recordFailure(result, {
            area: 'localStorage',
            key: KNIFE4J_STORAGE_KEYS.mutationLease,
            reason: requestCacheEpochError
              ? `request cache coordination failed: ${errorMessage(requestCacheEpochError)}`
              : 'request cache coordination unavailable',
          });
        }
      }
    } catch (error) {
      recordFailure(result, {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.mutationLease,
        reason: `request cache coordination failed: ${errorMessage(error)}`,
      });
    } finally {
      stopRequestCacheHeartbeat();
      completeRequestCacheCleanup(adapters.localStorage, requestCacheEpoch);
      releasePendingRemovals();
    }
    return result;
  }

  let lease: Knife4jStorageResetLease | null = null;
  let mutationLease: Knife4jStorageResetLease | null = null;
  let stopResetLeaseHeartbeat = () => {};
  let stopMutationLeaseHeartbeat = () => {};

  const retainsMutationLease = (): boolean => {
    if (!guardsAsyncWrites || lockManager || !adapters.localStorage) return true;
    const retained = mutationLease !== null && renewMutationLease(adapters.localStorage, mutationLease);
    if (!retained) {
      recordFailure(result, {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.mutationLease,
        reason: 'mutation coordination ownership was lost',
      });
    }
    return retained;
  };

  const retainsResetLease = (): boolean => {
    if (!retainsMutationLease()) return false;
    if (!guardsAsyncWrites) return true;
    return adapters.localStorage !== null && lease !== null && renewResetLease(adapters.localStorage, lease, result);
  };

  const performCleanup = async (retainsCriticalSection: () => boolean = () => true): Promise<void> => {
    const retainsCleanupLease = () => retainsCriticalSection() && retainsResetLease();
    if (guardsAsyncWrites) await waitForPendingKnife4jStorageWrites();
    if (!retainsCleanupLease()) return;

    clearWebStorage(
      'localStorage',
      adapters.localStorage,
      KNIFE4J_STORAGE_REGISTRY.localStorage,
      result,
      retainsCleanupLease,
    );
    clearWebStorage(
      'sessionStorage',
      adapters.sessionStorage,
      KNIFE4J_STORAGE_REGISTRY.sessionStorage,
      result,
      retainsCleanupLease,
    );
    await clearIndexedDbStorage(adapters.indexedDB, result, retainsCleanupLease);
    if (guardsAsyncWrites) {
      await waitForPendingKnife4jStorageWrites();
      if (!retainsCleanupLease()) return;
      await clearIndexedDbStorage(adapters.indexedDB, result, retainsCleanupLease);
      if (!retainsCleanupLease()) return;
      clearWebStorage(
        'localStorage',
        adapters.localStorage,
        KNIFE4J_STORAGE_REGISTRY.localStorage,
        result,
        retainsCleanupLease,
      );
      clearWebStorage(
        'sessionStorage',
        adapters.sessionStorage,
        KNIFE4J_STORAGE_REGISTRY.sessionStorage,
        result,
        retainsCleanupLease,
      );
    }
  };

  const performCoordinatedCleanup = async (): Promise<void> => {
    if (guardsAsyncWrites) {
      if (!lockManager && adapters.localStorage) {
        let mutationLeaseError: unknown;
        mutationLease = await acquireMutationLease(adapters.localStorage, (error) => {
          mutationLeaseError = error;
        });
        if (!mutationLease && isQuotaExceededError(mutationLeaseError)) {
          // Recover enough quota to publish the fallback mutex before any
          // non-localStorage deletion can race a cross-tab mutation.
          const recovered = await runWithFallbackCriticalSection((retainsCriticalSection) => {
            if (!retainsCriticalSection()) return false;
            clearWebStorage(
              'localStorage',
              adapters.localStorage,
              KNIFE4J_STORAGE_REGISTRY.localStorage,
              result,
              retainsCriticalSection,
            );
            return retainsCriticalSection();
          });
          if (recovered !== true) {
            if (recovered === undefined) recordFallbackCriticalSectionUnavailable(result, 'storage reset');
            return;
          }
          mutationLease = await acquireMutationLease(adapters.localStorage, (error) => {
            mutationLeaseError = error;
          });
        }
        if (!mutationLease) {
          recordFailure(result, {
            area: 'localStorage',
            key: KNIFE4J_STORAGE_KEYS.mutationLease,
            reason: mutationLeaseError
              ? `mutation coordination failed: ${errorMessage(mutationLeaseError)}`
              : 'mutation coordination unavailable',
          });
          return;
        }
        stopMutationLeaseHeartbeat = startMutationLeaseHeartbeat(adapters.localStorage, mutationLease);
      }
      let resetLeaseError: unknown;
      lease = await acquireResetLease(adapters.localStorage, result, false, (error) => {
        resetLeaseError = error;
      });
      if (!lease && adapters.localStorage && isQuotaExceededError(resetLeaseError)) {
        // A full localStorage quota can prevent even the coordination claim.
        // Free only registered Knife4j values, then publish the lease before
        // touching IndexedDB or running the final deletion passes.
        const recovered = await runWithFallbackCriticalSection((retainsCriticalSection) => {
          const retainsRecoveryFence = () => retainsCriticalSection() && retainsMutationLease();
          if (!retainsRecoveryFence()) return false;
          clearWebStorage(
            'localStorage',
            adapters.localStorage,
            KNIFE4J_STORAGE_REGISTRY.localStorage,
            result,
            retainsRecoveryFence,
          );
          return retainsRecoveryFence();
        });
        if (recovered !== true) {
          if (recovered === undefined) recordFallbackCriticalSectionUnavailable(result, 'storage reset');
          return;
        }
        lease = await acquireResetLease(adapters.localStorage, result);
      }
      if (!lease) {
        if (!adapters.localStorage) {
          recordUnavailable(result, 'localStorage');
        } else if (!isQuotaExceededError(resetLeaseError)) {
          recordFailure(result, {
            area: 'localStorage',
            key: KNIFE4J_STORAGE_KEYS.resetLease,
            reason: `reset coordination failed: ${errorMessage(resetLeaseError ?? 'unavailable')}`,
          });
        }
        return;
      }
      stopResetLeaseHeartbeat = startResetLeaseHeartbeat(adapters.localStorage, lease, result);
    }
    if (!lockManager && adapters.localStorage) {
      const completed = await runWithFallbackCriticalSection(async (retainsCriticalSection) => {
        await performCleanup(retainsCriticalSection);
        return retainsCriticalSection();
      });
      if (completed !== true) recordFallbackCriticalSectionUnavailable(result, 'storage reset');
      return;
    }
    await performCleanup();
  };

  try {
    if (guardsAsyncWrites && !lockManager) await waitForPendingKnife4jStorageWrites();
    if (!guardsAsyncWrites || !lockManager) await performCoordinatedCleanup();
    else await lockManager.request(KNIFE4J_STORAGE_RESET_LOCK, { mode: 'exclusive' }, performCoordinatedCleanup);
  } finally {
    stopResetLeaseHeartbeat();
    stopMutationLeaseHeartbeat();
    if (guardsAsyncWrites) {
      allLocalDataCleanupCount -= 1;
      getKnife4jStorageResetSnapshot(adapters.localStorage);
    }
    releaseResetLease(adapters.localStorage, lease, result);
    if (adapters.localStorage && mutationLease) releaseMutationLease(adapters.localStorage, mutationLease);
  }
  return result;
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
