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
      match: 'prefix',
      value: KNIFE4J_STORAGE_PREFIXES.resetClaim,
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
let observedResetGeneration = '';

interface Knife4jStorageResetLease {
  version: typeof KNIFE4J_STORAGE_RESET_LEASE_VERSION;
  generation: string;
  expiresAt: number;
}

interface Knife4jStorageResetClaim extends Knife4jStorageResetLease {
  createdAt: number;
}

function observeResetGeneration(generation: string): void {
  if (generation) observedResetGeneration = generation;
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
  if (!lease) return null;
  observeResetGeneration(lease.generation);
  if (lease.expiresAt > now) return lease;
  return null;
}

function createResetGeneration(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall back to a non-security-sensitive unique value.
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function observeResetLeaseStorageEvent(event: StorageEvent): void {
  if (event.key !== KNIFE4J_STORAGE_KEYS.resetLease) return;
  const lease = parseResetLease(event.newValue);
  if (lease) observeResetGeneration(lease.generation);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', observeResetLeaseStorageEvent);
}

function browserStorageLockManager(): Knife4jStorageLockManager | null {
  if (typeof navigator === 'undefined' || !navigator.locks) return null;
  return navigator.locks as unknown as Knife4jStorageLockManager;
}

function createKnife4jStorageWriteFence(
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
): () => boolean {
  readResetLease(leaseStorage);
  const generation = observedResetGeneration;
  return () => {
    const activeLease = readResetLease(leaseStorage);
    return allLocalDataCleanupCount === 0 && !activeLease && generation === observedResetGeneration;
  };
}

/** Write one registered Web Storage value only when no full reset invalidated it. */
export function setKnife4jStorageItem(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  key: string,
  value: string,
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
): boolean {
  const canWrite = createKnife4jStorageWriteFence(leaseStorage);
  if (!canWrite()) return false;
  storage.setItem(key, value);
  if (!canWrite()) {
    storage.removeItem(key);
    return false;
  }
  return true;
}

/**
 * Coordinate a Knife4j persistence operation with full resets running in
 * other same-origin browsing contexts. New shared locks are not queued behind
 * a pending reset, so stale writes cannot resume after its deletion pass.
 */
export function withKnife4jStorageWriteLock<T>(
  write: (canWrite: () => boolean) => Promise<T>,
  lockManager: Knife4jStorageLockManager | null = browserStorageLockManager(),
  leaseStorage: Knife4jWebStorage | null = browserStorage('localStorage'),
): Promise<T | undefined> {
  const canWrite = createKnife4jStorageWriteFence(leaseStorage);
  const guardedWrite = () => (canWrite() ? write(canWrite) : undefined);
  if (!lockManager) return Promise.resolve().then(guardedWrite);
  return lockManager.request(KNIFE4J_STORAGE_RESET_LOCK, { mode: 'shared', ifAvailable: true }, (lock) =>
    lock ? guardedWrite() : undefined,
  );
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

async function acquireResetLease(
  storage: Knife4jWebStorage | null,
  result: Knife4jStorageCleanupResult,
): Promise<Knife4jStorageResetLease | null> {
  if (!storage) return null;

  acquisition: for (;;) {
    let current: Knife4jStorageResetLease | null = null;
    let publishedClaimKey: string | null = null;
    try {
      current = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.resetLease));
      if (current) observeResetGeneration(current.generation);
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
        if (current) observeResetGeneration(current.generation);
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
        await new Promise((resolve) => setTimeout(resolve, KNIFE4J_STORAGE_RESET_LEASE_POLL_MS));

        const persisted = parseResetLease(storage.getItem(KNIFE4J_STORAGE_KEYS.resetLease));
        const confirmedWinner = listActiveResetClaims(storage)[0]?.claim;
        if (persisted?.generation === lease.generation && confirmedWinner?.generation === claim.generation) {
          removeResetClaim(storage, claimKey);
          publishedClaimKey = null;
          observeResetGeneration(lease.generation);
          return lease;
        }

        if (persisted) observeResetGeneration(persisted.generation);
        if (persisted?.generation === lease.generation) storage.removeItem(KNIFE4J_STORAGE_KEYS.resetLease);
        await new Promise((resolve) => setTimeout(resolve, KNIFE4J_STORAGE_RESET_LEASE_POLL_MS));
      }
    } catch (error) {
      if (publishedClaimKey) removeResetClaim(storage, publishedClaimKey);
      recordFailure(result, {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.resetLease,
        reason: `reset coordination failed: ${errorMessage(error)}`,
      });
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
    if (current?.generation !== lease.generation) throw new Error('reset lease ownership was lost');
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
  } catch (error) {
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
  if (guardsAsyncWrites) allLocalDataCleanupCount += 1;

  const result: Knife4jStorageCleanupResult = {
    scope,
    removed: { localStorage: 0, sessionStorage: 0, indexedDB: 0 },
    failures: [],
  };
  let lease: Knife4jStorageResetLease | null = null;
  let stopResetLeaseHeartbeat = () => {};

  const retainsResetLease = (): boolean => {
    if (!guardsAsyncWrites || !adapters.localStorage) return true;
    return lease !== null && renewResetLease(adapters.localStorage, lease, result);
  };

  const performCleanup = async (): Promise<void> => {
    if (guardsAsyncWrites) await waitForPendingKnife4jStorageWrites();
    if (!retainsResetLease()) return;

    clearWebStorage('localStorage', adapters.localStorage, KNIFE4J_STORAGE_REGISTRY.localStorage, result);
    clearWebStorage('sessionStorage', adapters.sessionStorage, KNIFE4J_STORAGE_REGISTRY.sessionStorage, result);
    await clearIndexedDbStorage(adapters.indexedDB, result);
    if (guardsAsyncWrites) {
      await waitForPendingKnife4jStorageWrites();
      if (!retainsResetLease()) return;
      await clearIndexedDbStorage(adapters.indexedDB, result);
      if (!retainsResetLease()) return;
      clearWebStorage('localStorage', adapters.localStorage, KNIFE4J_STORAGE_REGISTRY.localStorage, result);
      clearWebStorage('sessionStorage', adapters.sessionStorage, KNIFE4J_STORAGE_REGISTRY.sessionStorage, result);
    }
  };

  try {
    if (guardsAsyncWrites) {
      lease = await acquireResetLease(adapters.localStorage, result);
      stopResetLeaseHeartbeat = startResetLeaseHeartbeat(adapters.localStorage, lease, result);
    }
    if (!guardsAsyncWrites || !lockManager) await performCleanup();
    else await lockManager.request(KNIFE4J_STORAGE_RESET_LOCK, { mode: 'exclusive' }, performCleanup);
  } finally {
    stopResetLeaseHeartbeat();
    releaseResetLease(adapters.localStorage, lease, result);
    if (guardsAsyncWrites) allLocalDataCleanupCount -= 1;
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
