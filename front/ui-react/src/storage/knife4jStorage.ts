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

export interface Knife4jStorageResetSnapshot {
  readonly generation: string;
  readonly active: boolean;
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

type Knife4jStorageWriteFence = (() => boolean) & { readonly generation: string };

function createKnife4jStorageWriteFence(
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
): Knife4jStorageWriteFence {
  const generation = getKnife4jStorageResetSnapshot(leaseStorage).generation;
  const canWrite = () => {
    const snapshot = getKnife4jStorageResetSnapshot(leaseStorage);
    return allLocalDataCleanupCount === 0 && !snapshot.active && generation === snapshot.generation;
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
  matchedKeys.forEach((key) => pending.set(key, { writeId, value: null, generation }));
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
  if (pending) {
    const snapshot = getKnife4jStorageResetSnapshot(leaseStorage);
    if (!snapshot.active && snapshot.generation === pending.generation) return pending.value;
  }
  return storage.getItem(key);
}

/** Persist one registered value while sharing the same reset/mutation lock. */
export async function persistKnife4jStorageItem(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  key: string,
  value: string,
  lockManager: Knife4jStorageLockManager | null = browserStorageLockManager(),
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
): Promise<boolean> {
  try {
    const persisted = await trackKnife4jStorageWrite(
      async (canWrite) => {
        if (!canWrite()) return false;
        storage.setItem(key, value);
        if (canWrite()) return true;
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
  if (snapshot.active) return Promise.resolve(false);

  const writeId = createResetGeneration();
  const pending = pendingWebStorageMap(storage);
  pending.set(key, { writeId, value, generation: snapshot.generation });
  return persistKnife4jStorageItem(storage, key, value, lockManager, leaseStorage).finally(() => {
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

    const writeId = createResetGeneration();
    const pending = pendingWebStorageMap(storage);
    pending.set(key, { writeId, value: null, generation: snapshot.generation });
    try {
      const removed = await trackKnife4jStorageWrite(
        async (canWrite) => {
          if (!canWrite()) return false;
          storage.removeItem(key);
          return canWrite();
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
    if (!retainsMutationLease()) return undefined;
    return await write(retainsMutationLease);
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

async function acquireMutationLease(storage: Knife4jWebStorage): Promise<Knife4jStorageResetLease | null> {
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
    } catch {
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
    const requestCacheSnapshot = getKnife4jStorageResetSnapshot(adapters.localStorage);
    const releasePendingRemovals = publishPendingWebStorageRemovals(
      adapters.localStorage,
      scope,
      requestCacheSnapshot.generation,
    );
    const retainsRequestCacheGeneration = () => {
      const snapshot = getKnife4jStorageResetSnapshot(adapters.localStorage);
      return !snapshot.active && snapshot.generation === requestCacheSnapshot.generation;
    };
    const performRequestCacheCleanup = () =>
      trackKnife4jStorageWrite(
        async (canWrite) => {
          if (!canWrite()) return false;
          clearWebStorage(
            'localStorage',
            adapters.localStorage,
            KNIFE4J_STORAGE_REGISTRY.localStorage,
            result,
            canWrite,
          );
          clearWebStorage(
            'sessionStorage',
            adapters.sessionStorage,
            KNIFE4J_STORAGE_REGISTRY.sessionStorage,
            result,
            canWrite,
          );
          return canWrite();
        },
        lockManager,
        adapters.localStorage,
      );

    try {
      let completed = await performRequestCacheCleanup();
      if (completed !== true && !lockManager && adapters.localStorage && retainsRequestCacheGeneration()) {
        // A full localStorage quota can prevent publishing the fallback claim.
        // Remove only the requested registered entries, then retry coordination
        // before clearing session state or running the final deletion scan.
        clearWebStorage(
          'localStorage',
          adapters.localStorage,
          KNIFE4J_STORAGE_REGISTRY.localStorage,
          result,
          retainsRequestCacheGeneration,
        );
        if (retainsRequestCacheGeneration()) completed = await performRequestCacheCleanup();
      }
      if (completed !== true) {
        recordFailure(result, {
          area: 'localStorage',
          key: KNIFE4J_STORAGE_KEYS.mutationLease,
          reason: 'request cache coordination unavailable',
        });
      }
    } catch (error) {
      recordFailure(result, {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.mutationLease,
        reason: `request cache coordination failed: ${errorMessage(error)}`,
      });
    } finally {
      releasePendingRemovals();
    }
    return result;
  }

  let lease: Knife4jStorageResetLease | null = null;
  let mutationLease: Knife4jStorageResetLease | null = null;
  let usesExclusiveLockFallback = false;
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
    if (!guardsAsyncWrites || !adapters.localStorage || usesExclusiveLockFallback) return true;
    return lease !== null && renewResetLease(adapters.localStorage, lease, result);
  };

  const performCleanup = async (): Promise<void> => {
    if (guardsAsyncWrites) await waitForPendingKnife4jStorageWrites();
    if (!retainsResetLease()) return;

    clearWebStorage(
      'localStorage',
      adapters.localStorage,
      KNIFE4J_STORAGE_REGISTRY.localStorage,
      result,
      retainsResetLease,
    );
    clearWebStorage(
      'sessionStorage',
      adapters.sessionStorage,
      KNIFE4J_STORAGE_REGISTRY.sessionStorage,
      result,
      retainsResetLease,
    );
    await clearIndexedDbStorage(adapters.indexedDB, result, retainsResetLease);
    if (guardsAsyncWrites) {
      await waitForPendingKnife4jStorageWrites();
      if (!retainsResetLease()) return;
      await clearIndexedDbStorage(adapters.indexedDB, result, retainsResetLease);
      if (!retainsResetLease()) return;
      clearWebStorage(
        'localStorage',
        adapters.localStorage,
        KNIFE4J_STORAGE_REGISTRY.localStorage,
        result,
        retainsResetLease,
      );
      clearWebStorage(
        'sessionStorage',
        adapters.sessionStorage,
        KNIFE4J_STORAGE_REGISTRY.sessionStorage,
        result,
        retainsResetLease,
      );
    }
  };

  const performCoordinatedCleanup = async (): Promise<void> => {
    if (guardsAsyncWrites) {
      if (!lockManager && adapters.localStorage) {
        mutationLease = await acquireMutationLease(adapters.localStorage);
        if (!mutationLease) {
          // Recover enough quota to publish the fallback mutex before any
          // non-localStorage deletion can race a cross-tab mutation.
          clearWebStorage('localStorage', adapters.localStorage, KNIFE4J_STORAGE_REGISTRY.localStorage, result);
          mutationLease = await acquireMutationLease(adapters.localStorage);
        }
        if (!mutationLease) {
          recordFailure(result, {
            area: 'localStorage',
            key: KNIFE4J_STORAGE_KEYS.mutationLease,
            reason: 'mutation coordination unavailable',
          });
          return;
        }
        stopMutationLeaseHeartbeat = startMutationLeaseHeartbeat(adapters.localStorage, mutationLease);
      }
      lease = await acquireResetLease(adapters.localStorage, result, false);
      if (!lease && adapters.localStorage) {
        // A full localStorage quota can prevent even the coordination claim.
        // Free only registered Knife4j values, then publish the lease before
        // touching IndexedDB or running the final deletion passes.
        clearWebStorage('localStorage', adapters.localStorage, KNIFE4J_STORAGE_REGISTRY.localStorage, result);
        lease = await acquireResetLease(adapters.localStorage, result);
        // The exclusive Web Lock still serializes compliant writers when the
        // lease store remains unwritable. Keep the coordination failure in the
        // result, but continue clearing the other registered storage areas.
        usesExclusiveLockFallback = lease === null && lockManager !== null;
      }
      stopResetLeaseHeartbeat = startResetLeaseHeartbeat(adapters.localStorage, lease, result);
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
