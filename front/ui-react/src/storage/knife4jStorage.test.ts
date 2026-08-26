import { describe, expect, it, vi } from 'vitest';
import {
  KNIFE4J_STORAGE_KEYS,
  KNIFE4J_STORAGE_PREFIXES,
  KNIFE4J_STORAGE_REGISTRY,
  clearRegisteredKnife4jStorage,
  getKnife4jStorageItem,
  getKnife4jStorageItemSnapshot,
  getKnife4jStorageResetSnapshot,
  persistKnife4jStorageItem,
  removeKnife4jStorageItem,
  removedKnife4jStorageEntryCount,
  setKnife4jStorageItem,
  subscribeKnife4jStorageReset,
  withKnife4jStorageWriteLock,
  type Knife4jIndexedDbStorage,
  type Knife4jStorageLockManager,
  type Knife4jWebStorage,
} from './knife4jStorage';

class MemoryWebStorage implements Knife4jWebStorage {
  readonly values: Map<string, string>;
  readonly failures = new Set<string>();

  constructor(initial: Record<string, string>, values: Map<string, string> = new Map()) {
    this.values = values;
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, value));
  }

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (this.failures.has(key)) throw new Error(`cannot remove ${key}`);
    this.values.delete(key);
  }
}

class MemoryIndexedDb implements Knife4jIndexedDbStorage {
  readonly values = new Map<IDBValidKey, unknown>();
  readonly failures = new Set<IDBValidKey>();

  constructor(initial: Array<[IDBValidKey, unknown]>) {
    initial.forEach(([key, value]) => this.values.set(key, value));
  }

  async keys(): Promise<IDBValidKey[]> {
    return Array.from(this.values.keys());
  }

  async delete(key: IDBValidKey): Promise<void> {
    if (this.failures.has(key)) throw new Error(`cannot remove ${String(key)}`);
    this.values.delete(key);
  }
}

class MemoryLockManager implements Knife4jStorageLockManager {
  private activeShared = 0;
  private activeExclusive = false;
  private readonly queue: Array<{ mode: 'shared' | 'exclusive'; start: () => void }> = [];

  request<T>(
    name: string,
    options: { mode: 'shared' | 'exclusive'; ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => T | PromiseLike<T>,
  ): Promise<T> {
    const exclusivePending = this.queue.some((request) => request.mode === 'exclusive');
    if (options.mode === 'shared' && options.ifAvailable && (this.activeExclusive || exclusivePending)) {
      return Promise.resolve(callback(null));
    }

    return new Promise<T>((resolve, reject) => {
      const start = () => {
        if (options.mode === 'shared') this.activeShared += 1;
        else this.activeExclusive = true;
        Promise.resolve(callback({ name }))
          .then(resolve, reject)
          .finally(() => {
            if (options.mode === 'shared') this.activeShared -= 1;
            else this.activeExclusive = false;
            this.drain();
          });
      };
      this.queue.push({ mode: options.mode, start });
      this.drain();
    });
  }

  private drain(): void {
    if (this.activeExclusive || this.activeShared > 0) return;
    const next = this.queue.shift();
    if (!next) return;
    next.start();
  }
}

class SerializedTestIdbTransaction {
  oncomplete: ((event: Event) => unknown) | null = null;
  onabort: ((event: Event) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;

  private readonly operations: Array<() => void> = [];
  private active = false;
  private processing = false;
  private completed = false;
  private processedRequest = false;
  private completionScheduled = false;

  constructor(private readonly release: (transaction: SerializedTestIdbTransaction) => void) {}

  objectStore(): IDBObjectStore {
    return {
      get: () => this.enqueueRequest(),
      put: () => this.enqueueRequest(),
    } as unknown as IDBObjectStore;
  }

  start(): void {
    this.active = true;
    this.drain();
  }

  abort(): void {
    if (this.completed) throw new Error('transaction already completed');
    this.completed = true;
    this.active = false;
    setTimeout(() => {
      this.onabort?.(new Event('abort'));
      this.release(this);
    }, 0);
  }

  private enqueueRequest(): IDBRequest {
    const request = {
      onsuccess: null,
      onerror: null,
    } as unknown as IDBRequest;
    this.operations.push(() => request.onsuccess?.(new Event('success')));
    this.drain();
    return request;
  }

  private drain(): void {
    if (!this.active || this.completed || this.processing) return;
    const operation = this.operations.shift();
    if (!operation) {
      if (!this.processedRequest || this.completionScheduled) return;
      this.completionScheduled = true;
      setTimeout(() => {
        this.completionScheduled = false;
        if (!this.active || this.completed || this.processing || this.operations.length > 0) {
          this.drain();
          return;
        }
        this.completed = true;
        this.active = false;
        this.oncomplete?.(new Event('complete'));
        this.release(this);
      }, 0);
      return;
    }

    this.processing = true;
    setTimeout(() => {
      if (this.completed) return;
      operation();
      this.processedRequest = true;
      this.processing = false;
      this.drain();
    }, 0);
  }
}

class SerializedTestIndexedDb {
  transactionCount = 0;

  private readonly stores = new Set<string>();
  private readonly transactions: SerializedTestIdbTransaction[] = [];
  private activeTransaction: SerializedTestIdbTransaction | null = null;

  readonly database = {
    objectStoreNames: {
      contains: (name: string) => this.stores.has(name),
    },
    createObjectStore: (name: string) => {
      this.stores.add(name);
      return {} as IDBObjectStore;
    },
    transaction: () => {
      const transaction = new SerializedTestIdbTransaction((completed) => this.release(completed));
      this.transactionCount += 1;
      this.transactions.push(transaction);
      this.drain();
      return transaction as unknown as IDBTransaction;
    },
    close: () => {},
    onversionchange: null as ((event: IDBVersionChangeEvent) => unknown) | null,
  } as unknown as IDBDatabase;

  readonly factory = {
    open: () => {
      const request = {
        result: this.database,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      } as unknown as IDBOpenDBRequest;
      setTimeout(() => {
        request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent);
        request.onsuccess?.(new Event('success'));
      }, 0);
      return request;
    },
  } as unknown as IDBFactory;

  closeConnection(): void {
    this.database.onversionchange?.(new Event('versionchange') as IDBVersionChangeEvent);
  }

  private drain(): void {
    if (this.activeTransaction) return;
    const next = this.transactions.shift();
    if (!next) return;
    this.activeTransaction = next;
    next.start();
  }

  private release(transaction: SerializedTestIdbTransaction): void {
    if (this.activeTransaction !== transaction) return;
    this.activeTransaction = null;
    this.drain();
  }
}

describe('Knife4j storage cleanup registry', () => {
  it('registers every declared key and prefix for cleanup', () => {
    const declaredValues = new Set([
      ...Object.values(KNIFE4J_STORAGE_KEYS),
      ...Object.values(KNIFE4J_STORAGE_PREFIXES),
    ]);
    const registeredValues = new Set(
      Object.values(KNIFE4J_STORAGE_REGISTRY).flatMap((entries) => entries.map((entry) => entry.value)),
    );

    expect(registeredValues).toEqual(declaredValues);
  });

  it('clears only request cache, history, future version baselines, and workspace tabs', async () => {
    const localStorage = new MemoryWebStorage({
      [`${KNIFE4J_STORAGE_PREFIXES.debugCache}operation-a`]: 'cache',
      [`${KNIFE4J_STORAGE_PREFIXES.debugHistory}operation-a`]: 'history',
      [`${KNIFE4J_STORAGE_PREFIXES.apiVersionBaseline}operation-a`]: 'baseline',
      [KNIFE4J_STORAGE_KEYS.settings]: 'settings',
      [`${KNIFE4J_STORAGE_PREFIXES.groupGlobalParams}group-a`]: 'params',
      'knife4j-next:debug-cache': 'near-miss',
      'knife4j-next:debug-cache-other:operation-a': 'near-miss-prefix',
      'host-application:key': 'keep',
    });
    const sessionStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.tabItems]: 'tabs',
      [KNIFE4J_STORAGE_KEYS.tabActive]: 'active',
      [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`]: 'oauth',
      'host-application:session': 'keep',
    });
    const indexedDB = new MemoryIndexedDb([
      [`${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`, { token: 'secret' }],
      ['host-application:idb', { keep: true }],
    ]);

    const result = await clearRegisteredKnife4jStorage('request-cache', {
      localStorage,
      sessionStorage,
      indexedDB,
    });

    expect(result).toEqual({
      scope: 'request-cache',
      removed: { localStorage: 3, sessionStorage: 2, indexedDB: 0 },
      failures: [],
    });
    expect(localStorage.values).toEqual(
      new Map([
        [KNIFE4J_STORAGE_KEYS.settings, 'settings'],
        [KNIFE4J_STORAGE_KEYS.requestCacheEpoch, expect.any(String)],
        [`${KNIFE4J_STORAGE_PREFIXES.groupGlobalParams}group-a`, 'params'],
        ['knife4j-next:debug-cache', 'near-miss'],
        ['knife4j-next:debug-cache-other:operation-a', 'near-miss-prefix'],
        ['host-application:key', 'keep'],
      ]),
    );
    expect(sessionStorage.values).toEqual(
      new Map([
        [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`, 'oauth'],
        ['host-application:session', 'keep'],
      ]),
    );
    expect(indexedDB.values.has(`${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`)).toBe(true);
  });

  it('refuses request-cache cleanup when its cross-tab epoch cannot be published', async () => {
    const cacheKey = `${KNIFE4J_STORAGE_PREFIXES.debugCache}operation-a`;
    const localStorage = new (class extends MemoryWebStorage {
      override setItem(): void {
        throw new Error('storage is read-only');
      }
    })({
      [cacheKey]: 'cache',
      'host-application:key': 'keep',
    });
    const sessionStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.tabItems]: 'tabs',
      'host-application:session': 'keep',
    });

    const result = await clearRegisteredKnife4jStorage(
      'request-cache',
      { localStorage, sessionStorage, indexedDB: new MemoryIndexedDb([]) },
      null,
    );

    expect(result.removed).toEqual({ localStorage: 0, sessionStorage: 0, indexedDB: 0 });
    expect(result.failures).toEqual([
      {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.mutationLease,
        reason: 'request cache coordination failed: storage is read-only',
      },
    ]);
    expect(localStorage.getItem(cacheKey)).toBe('cache');
    expect(localStorage.getItem('host-application:key')).toBe('keep');
    expect(sessionStorage.getItem(KNIFE4J_STORAGE_KEYS.tabItems)).toBe('tabs');
    expect(sessionStorage.getItem('host-application:session')).toBe('keep');
  });

  it('keeps request-cache data when quota prevents publishing every invalidation epoch', async () => {
    const cacheKey = `${KNIFE4J_STORAGE_PREFIXES.debugCache}operation-a`;
    const localStorage = new (class extends MemoryWebStorage {
      override setItem(key: string, value: string): void {
        if (!this.values.has(key)) throw new Error('quota exceeded for a new key');
        super.setItem(key, value);
      }
    })({
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation',
      [cacheKey]: 'cache',
      'host-application:key': 'keep',
    });
    const sessionStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.tabItems]: 'tabs',
      'host-application:session': 'keep',
    });

    const result = await clearRegisteredKnife4jStorage(
      'request-cache',
      { localStorage, sessionStorage, indexedDB: new MemoryIndexedDb([]) },
      null,
    );

    expect(result.removed).toEqual({ localStorage: 0, sessionStorage: 0, indexedDB: 0 });
    expect(result.failures).toEqual([
      {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.mutationLease,
        reason: 'request cache coordination failed: quota exceeded for a new key',
      },
    ]);
    expect(localStorage.getItem(cacheKey)).toBe('cache');
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch)).toBeNull();
    expect(localStorage.getItem('host-application:key')).toBe('keep');
    expect(sessionStorage.getItem(KNIFE4J_STORAGE_KEYS.tabItems)).toBe('tabs');
    expect(sessionStorage.getItem('host-application:session')).toBe('keep');
  });

  it('resets every registered Knife4j entry while preserving unrelated same-origin data', async () => {
    const localStorage = new MemoryWebStorage({
      [`${KNIFE4J_STORAGE_PREFIXES.debugCache}operation-a`]: 'cache',
      [`${KNIFE4J_STORAGE_PREFIXES.debugHistory}operation-a`]: 'history',
      [KNIFE4J_STORAGE_KEYS.settings]: 'settings',
      [KNIFE4J_STORAGE_KEYS.language]: 'zh-CN',
      [KNIFE4J_STORAGE_KEYS.legacyGlobalParams]: 'legacy-params',
      [KNIFE4J_STORAGE_KEYS.legacyAuth]: 'legacy-auth',
      [KNIFE4J_STORAGE_KEYS.legacyAuthMigrated]: '1',
      [`${KNIFE4J_STORAGE_PREFIXES.groupGlobalParams}group-a`]: 'group-params',
      [`${KNIFE4J_STORAGE_PREFIXES.applicationGlobalParams}%2Fdoc.html`]: 'application-params',
      'Knife4jGlobalSettings:host-copy': 'keep-near-miss',
      'host-application:key': 'keep',
    });
    const sessionStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.tabItems]: 'tabs',
      [KNIFE4J_STORAGE_KEYS.tabActive]: 'active',
      [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`]: 'oauth',
      'knife4j:oauth2:pending-other': 'keep-near-miss',
      'host-application:session': 'keep',
    });
    const indexedDB = new MemoryIndexedDb([
      [`${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`, { token: 'secret' }],
      ['knife4j:auth-other', { keep: true }],
      ['host-application:idb', { keep: true }],
      [42, { keep: true }],
    ]);

    const resetSnapshots: Array<{ generation: string; active: boolean }> = [];
    const unsubscribe = subscribeKnife4jStorageReset((snapshot) => resetSnapshots.push({ ...snapshot }));
    const result = await clearRegisteredKnife4jStorage('all-local-data', {
      localStorage,
      sessionStorage,
      indexedDB,
    }).finally(unsubscribe);

    expect(result.failures).toEqual([]);
    expect(removedKnife4jStorageEntryCount(result)).toBe(13);
    const resetGeneration = localStorage.getItem(KNIFE4J_STORAGE_KEYS.resetGeneration);
    expect(resetGeneration).toEqual(expect.any(String));
    expect(resetGeneration).not.toBe('');
    expect(resetSnapshots).toEqual(
      expect.arrayContaining([
        { generation: resetGeneration, active: true },
        { generation: resetGeneration, active: false },
      ]),
    );
    expect(getKnife4jStorageResetSnapshot(localStorage)).toEqual({ generation: resetGeneration, active: false });
    const remainingLocalStorage = new Map(localStorage.values);
    remainingLocalStorage.delete(KNIFE4J_STORAGE_KEYS.resetGeneration);
    expect(remainingLocalStorage).toEqual(
      new Map([
        ['Knife4jGlobalSettings:host-copy', 'keep-near-miss'],
        ['host-application:key', 'keep'],
      ]),
    );
    expect(sessionStorage.values).toEqual(
      new Map([
        ['knife4j:oauth2:pending-other', 'keep-near-miss'],
        ['host-application:session', 'keep'],
      ]),
    );
    expect(indexedDB.values).toEqual(
      new Map<IDBValidKey, unknown>([
        ['knife4j:auth-other', { keep: true }],
        ['host-application:idb', { keep: true }],
        [42, { keep: true }],
      ]),
    );
  });

  it('reports unavailable storage and per-key failures without claiming complete success', async () => {
    const localStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.settings]: 'settings',
      [KNIFE4J_STORAGE_KEYS.language]: 'zh-CN',
    });
    localStorage.failures.add(KNIFE4J_STORAGE_KEYS.settings);
    const indexedDB = new MemoryIndexedDb([[`${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`, { token: 'secret' }]]);
    indexedDB.failures.add(`${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`);

    const result = await clearRegisteredKnife4jStorage('all-local-data', {
      localStorage,
      sessionStorage: null,
      indexedDB,
    });

    expect(result.removed).toEqual({ localStorage: 1, sessionStorage: 0, indexedDB: 0 });
    expect(result.failures).toEqual([
      {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.settings,
        reason: `cannot remove ${KNIFE4J_STORAGE_KEYS.settings}`,
      },
      { area: 'sessionStorage', reason: 'sessionStorage unavailable' },
      {
        area: 'indexedDB',
        key: `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`,
        reason: `cannot remove ${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`,
      },
    ]);
    expect(localStorage.values.has(KNIFE4J_STORAGE_KEYS.settings)).toBe(true);
    expect(localStorage.values.has(KNIFE4J_STORAGE_KEYS.language)).toBe(false);
  });

  it('frees registered local data and retries coordination when quota blocks the first lease write', async () => {
    const localStorage = new (class extends MemoryWebStorage {
      override setItem(key: string, value: string): void {
        if (!this.values.has(key) && this.values.has(KNIFE4J_STORAGE_KEYS.settings)) {
          throw new Error('quota exceeded');
        }
        super.setItem(key, value);
      }
    })({
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation-reservation',
      [KNIFE4J_STORAGE_KEYS.settings]: 'settings',
      [KNIFE4J_STORAGE_KEYS.language]: 'zh-CN',
      'host-application:key': 'keep',
    });
    const sessionStorage = new MemoryWebStorage({
      [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`]: 'oauth',
      'host-application:session': 'keep',
    });
    const authKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`;
    const indexedDB = new MemoryIndexedDb([
      [authKey, { token: 'secret' }],
      ['host-application:idb', { keep: true }],
    ]);

    const result = await clearRegisteredKnife4jStorage(
      'all-local-data',
      { localStorage, sessionStorage, indexedDB },
      null,
    );

    expect(result.failures).toEqual([]);
    expect(result.removed).toEqual({ localStorage: 2, sessionStorage: 1, indexedDB: 1 });
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.resetGeneration)).toEqual(expect.any(String));
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.resetLease)).toBeNull();
    expect(localStorage.getItem('host-application:key')).toBe('keep');
    expect(sessionStorage.values).toEqual(new Map([['host-application:session', 'keep']]));
    expect(indexedDB.values).toEqual(new Map([['host-application:idb', { keep: true }]]));
  });

  it('invalidates stale tabs before quota recovery when freed data is still insufficient for coordination', async () => {
    const applicationKey = `${KNIFE4J_STORAGE_PREFIXES.applicationGlobalParams}%2Fdoc.html`;
    const applicationParams = '[{"id":"stale-application"}]';
    const initialGeneration = 'stable-generation-reservation';
    let generationAtFirstDeletion: string | null = null;
    const localStorage = new (class extends MemoryWebStorage {
      override setItem(key: string, value: string): void {
        if (!this.values.has(key)) throw new Error('quota exceeded after recovery');
        super.setItem(key, value);
      }

      override removeItem(key: string): void {
        if (generationAtFirstDeletion === null && key === KNIFE4J_STORAGE_KEYS.settings) {
          generationAtFirstDeletion = this.getItem(KNIFE4J_STORAGE_KEYS.resetGeneration);
        }
        super.removeItem(key);
      }
    })({
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: initialGeneration,
      [KNIFE4J_STORAGE_KEYS.settings]: 'settings',
      [applicationKey]: applicationParams,
      'host-application:key': 'keep',
    });
    const staleSnapshot = getKnife4jStorageItemSnapshot(localStorage, applicationKey, localStorage);
    const snapshots: Array<{ generation: string; active: boolean }> = [];
    const unsubscribe = subscribeKnife4jStorageReset((snapshot) => snapshots.push({ ...snapshot }));

    const result = await clearRegisteredKnife4jStorage(
      'all-local-data',
      {
        localStorage,
        sessionStorage: new MemoryWebStorage({ [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`]: 'oauth' }),
        indexedDB: new MemoryIndexedDb([[`${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`, { token: 'secret' }]]),
      },
      null,
    ).finally(unsubscribe);

    const completedGeneration = localStorage.getItem(KNIFE4J_STORAGE_KEYS.resetGeneration);
    expect(result.removed).toEqual({ localStorage: 2, sessionStorage: 0, indexedDB: 0 });
    expect(result.failures).toEqual([
      {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.mutationLease,
        reason: 'mutation coordination failed: quota exceeded after recovery',
      },
    ]);
    expect(generationAtFirstDeletion).not.toBe(initialGeneration);
    expect(snapshots).toEqual(
      expect.arrayContaining([
        { generation: generationAtFirstDeletion, active: true },
        { generation: completedGeneration, active: false },
      ]),
    );
    expect(getKnife4jStorageResetSnapshot(localStorage)).toEqual({
      generation: completedGeneration,
      active: false,
    });
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.settings)).toBeNull();
    expect(localStorage.getItem(applicationKey)).toBeNull();
    expect(localStorage.getItem('host-application:key')).toBe('keep');
    await expect(
      setKnife4jStorageItem(localStorage, applicationKey, applicationParams, localStorage, null, staleSnapshot),
    ).resolves.toBe(false);
    expect(localStorage.getItem(applicationKey)).toBeNull();
  });

  it('keeps registered data when a quota recovery reset epoch cannot be published', async () => {
    const applicationKey = `${KNIFE4J_STORAGE_PREFIXES.applicationGlobalParams}%2Fdoc.html`;
    const localStorage = new (class extends MemoryWebStorage {
      override setItem(key: string, value: string): void {
        if (!this.values.has(key)) throw new Error('quota exceeded without reset epoch');
        super.setItem(key, value);
      }
    })({
      [KNIFE4J_STORAGE_KEYS.settings]: 'settings',
      [applicationKey]: '[{"id":"preserved-application"}]',
      'host-application:key': 'keep',
    });
    const sessionStorage = new MemoryWebStorage({
      [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`]: 'oauth',
    });
    const authKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`;
    const indexedDB = new MemoryIndexedDb([[authKey, { token: 'secret' }]]);

    const result = await clearRegisteredKnife4jStorage(
      'all-local-data',
      { localStorage, sessionStorage, indexedDB },
      null,
    );

    expect(result.removed).toEqual({ localStorage: 0, sessionStorage: 0, indexedDB: 0 });
    expect(result.failures).toEqual([
      {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.mutationLease,
        reason: 'mutation coordination failed: quota exceeded without reset epoch',
      },
    ]);
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.settings)).toBe('settings');
    expect(localStorage.getItem(applicationKey)).toBe('[{"id":"preserved-application"}]');
    expect(localStorage.getItem('host-application:key')).toBe('keep');
    expect(sessionStorage.getItem(`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`)).toBe('oauth');
    expect(indexedDB.values.get(authKey)).toEqual({ token: 'secret' });
  });

  it('refuses fallback destructive cleanup when mutation coordination is permanently read-only', async () => {
    const localStorage = new (class extends MemoryWebStorage {
      override setItem(): void {
        throw new Error('storage is read-only');
      }
    })({
      [KNIFE4J_STORAGE_KEYS.settings]: 'settings',
      'host-application:key': 'keep',
    });
    const sessionStorage = new MemoryWebStorage({
      [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`]: 'oauth',
      'host-application:session': 'keep',
    });
    const authKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`;
    const indexedDB = new MemoryIndexedDb([
      [authKey, { token: 'secret' }],
      ['host-application:idb', { keep: true }],
    ]);

    const result = await clearRegisteredKnife4jStorage(
      'all-local-data',
      { localStorage, sessionStorage, indexedDB },
      null,
    );

    expect(result.removed).toEqual({ localStorage: 0, sessionStorage: 0, indexedDB: 0 });
    expect(result.failures).toEqual([
      {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.mutationLease,
        reason: 'mutation coordination failed: storage is read-only',
      },
    ]);
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.settings)).toBe('settings');
    expect(localStorage.getItem('host-application:key')).toBe('keep');
    expect(sessionStorage.getItem(`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`)).toBe('oauth');
    expect(sessionStorage.getItem('host-application:session')).toBe('keep');
    expect(indexedDB.values.get(authKey)).toEqual({ token: 'secret' });
    expect(indexedDB.values.get('host-application:idb')).toEqual({ keep: true });
  });

  it('refuses destructive cleanup under a Web Lock when no reset epoch can be published', async () => {
    const localStorage = new (class extends MemoryWebStorage {
      override setItem(): void {
        throw new Error('storage is read-only');
      }
    })({
      [KNIFE4J_STORAGE_KEYS.settings]: 'settings',
      'host-application:key': 'keep',
    });
    const sessionStorage = new MemoryWebStorage({
      [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`]: 'oauth',
      'host-application:session': 'keep',
    });
    const authKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`;
    const indexedDB = new MemoryIndexedDb([
      [authKey, { token: 'secret' }],
      ['host-application:idb', { keep: true }],
    ]);
    const lockManager = new MemoryLockManager();
    const resetSnapshots: Array<{ generation: string; active: boolean }> = [];
    const unsubscribe = subscribeKnife4jStorageReset((snapshot) => resetSnapshots.push({ ...snapshot }));
    let signalWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const inFlightWrite = withKnife4jStorageWriteLock(
      async (canWrite) => {
        signalWriteStarted?.();
        await writeGate;
        expect(canWrite()).toBe(false);
      },
      lockManager,
      localStorage,
    );
    await writeStarted;

    const cleanup = clearRegisteredKnife4jStorage(
      'all-local-data',
      { localStorage, sessionStorage, indexedDB },
      lockManager,
    );
    releaseWrite?.();
    const [result] = await Promise.all([cleanup, inFlightWrite]).finally(unsubscribe);

    expect(result.removed).toEqual({ localStorage: 0, sessionStorage: 0, indexedDB: 0 });
    expect(result.failures).toEqual([
      {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.resetLease,
        reason: 'reset coordination failed: storage is read-only',
      },
    ]);
    expect(localStorage.values).toEqual(
      new Map([
        [KNIFE4J_STORAGE_KEYS.settings, 'settings'],
        ['host-application:key', 'keep'],
      ]),
    );
    expect(sessionStorage.values).toEqual(
      new Map([
        [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`, 'oauth'],
        ['host-application:session', 'keep'],
      ]),
    );
    expect(indexedDB.values).toEqual(
      new Map([
        [authKey, { token: 'secret' }],
        ['host-application:idb', { keep: true }],
      ]),
    );
    expect(resetSnapshots.map((snapshot) => snapshot.active)).toEqual(expect.arrayContaining([true, false]));
    expect(resetSnapshots.at(-1)?.active).toBe(false);
    expect(getKnife4jStorageResetSnapshot(localStorage).active).toBe(false);
  });

  it('refuses shared-data cleanup when localStorage is unavailable', async () => {
    const sessionStorage = new MemoryWebStorage({
      [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`]: 'oauth',
    });
    const authKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`;
    const indexedDB = new MemoryIndexedDb([[authKey, { token: 'secret' }]]);

    const result = await clearRegisteredKnife4jStorage(
      'all-local-data',
      { localStorage: null, sessionStorage, indexedDB },
      new MemoryLockManager(),
    );

    expect(result.removed).toEqual({ localStorage: 0, sessionStorage: 0, indexedDB: 0 });
    expect(result.failures).toEqual([{ area: 'localStorage', reason: 'localStorage unavailable' }]);
    expect(sessionStorage.getItem(`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`)).toBe('oauth');
    expect(indexedDB.values.get(authKey)).toEqual({ token: 'secret' });
  });

  it('publishes reset activity immediately without relying on an in-flight write', async () => {
    const localStorage = new (class extends MemoryWebStorage {
      override setItem(): void {
        throw new Error('storage is read-only');
      }
    })({
      [KNIFE4J_STORAGE_KEYS.settings]: 'settings',
    });
    const resetSnapshots: Array<{ generation: string; active: boolean }> = [];
    const unsubscribe = subscribeKnife4jStorageReset((snapshot) => resetSnapshots.push({ ...snapshot }));

    const cleanup = clearRegisteredKnife4jStorage(
      'all-local-data',
      {
        localStorage,
        sessionStorage: new MemoryWebStorage({}),
        indexedDB: new MemoryIndexedDb([]),
      },
      new MemoryLockManager(),
    );

    expect(resetSnapshots.at(-1)?.active).toBe(true);
    await cleanup.finally(unsubscribe);
    expect(resetSnapshots.map((snapshot) => snapshot.active)).toEqual([true, false]);
  });

  it('exposes a queued Web Storage value before its fallback mutation lease persists it', async () => {
    const targetKey = KNIFE4J_STORAGE_KEYS.settings;
    const storage = new MemoryWebStorage({ [targetKey]: 'old-value' });
    const leaseStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation',
    });

    const persistence = setKnife4jStorageItem(storage, targetKey, 'new-value', leaseStorage, null);
    expect(getKnife4jStorageItem(storage, targetKey, leaseStorage)).toBe('new-value');
    expect(storage.getItem(targetKey)).toBe('old-value');
    await expect(persistence).resolves.toBe(true);
    expect(storage.getItem(targetKey)).toBe('new-value');
  });

  it('keeps current-generation pending cache values readable during an active cleanup epoch', async () => {
    const targetKey = `${KNIFE4J_STORAGE_PREFIXES.debugHistory}operation-a`;
    const requestCacheGeneration = 'active-cache-cleanup';
    const storage = new MemoryWebStorage({
      [targetKey]: 'old-history',
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation',
      [KNIFE4J_STORAGE_KEYS.requestCacheEpoch]: JSON.stringify({
        version: 1,
        generation: requestCacheGeneration,
        expiresAt: Date.now() + 1_000,
      }),
    });

    const append = setKnife4jStorageItem(storage, targetKey, 'pending-history', storage, null);
    const pendingSnapshot = getKnife4jStorageItemSnapshot(storage, targetKey, storage);
    expect(pendingSnapshot.value).toBe('pending-history');

    const completion = setKnife4jStorageItem(storage, targetKey, 'completed-history', storage, null, pendingSnapshot);
    expect(getKnife4jStorageItemSnapshot(storage, targetKey, storage).value).toBe('completed-history');

    storage.setItem(
      KNIFE4J_STORAGE_KEYS.requestCacheEpoch,
      JSON.stringify({ version: 1, generation: requestCacheGeneration, expiresAt: 0 }),
    );

    await expect(Promise.all([append, completion])).resolves.toEqual([true, true]);
    expect(storage.getItem(targetKey)).toBe('completed-history');
  });

  it('exposes a queued Web Storage removal as a local tombstone', async () => {
    const targetKey = `${KNIFE4J_STORAGE_PREFIXES.debugHistory}operation-a`;
    const storage = new MemoryWebStorage({ [targetKey]: 'old-value' });
    const leaseStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation',
      [KNIFE4J_STORAGE_KEYS.mutationLease]: JSON.stringify({
        version: 1,
        generation: 'blocking-mutation',
        expiresAt: Date.now() + 1_000,
      }),
    });

    const removal = removeKnife4jStorageItem(storage, targetKey, null, leaseStorage);
    expect(getKnife4jStorageItem(storage, targetKey, leaseStorage)).toBeNull();
    expect(storage.getItem(targetKey)).toBe('old-value');

    leaseStorage.removeItem(KNIFE4J_STORAGE_KEYS.mutationLease);
    await expect(removal).resolves.toBe(true);
    expect(storage.getItem(targetKey)).toBeNull();
  });

  it('invalidates an earlier fallback cache write before cleanup', async () => {
    const targetKey = `${KNIFE4J_STORAGE_PREFIXES.debugHistory}operation-a`;
    const localStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation',
    });
    const sessionStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.tabItems]: 'tabs',
    });
    const indexedDB = new MemoryIndexedDb([]);

    const persistence = setKnife4jStorageItem(localStorage, targetKey, 'queued-history', localStorage, null);
    const cleanup = clearRegisteredKnife4jStorage('request-cache', { localStorage, sessionStorage, indexedDB }, null);
    const [persisted, result] = await Promise.all([persistence, cleanup]);

    expect(persisted).toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.removed).toEqual({ localStorage: 0, sessionStorage: 1, indexedDB: 0 });
    expect(localStorage.getItem(targetKey)).toBeNull();
    expect(sessionStorage.getItem(KNIFE4J_STORAGE_KEYS.tabItems)).toBeNull();
  });

  it('publishes a cross-tab request-cache epoch while fallback cleanup is waiting', async () => {
    const targetKey = `${KNIFE4J_STORAGE_PREFIXES.debugHistory}operation-a`;
    const sharedValues = new Map<string, string>();
    const cleanupStorage = new MemoryWebStorage(
      {
        [targetKey]: JSON.stringify(['old-history']),
        [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation',
        [KNIFE4J_STORAGE_KEYS.mutationLease]: JSON.stringify({
          version: 1,
          generation: 'blocking-mutation',
          expiresAt: Date.now() + 1_000,
        }),
      },
      sharedValues,
    );
    const writerStorage = new MemoryWebStorage({}, sharedValues);
    const sessionStorage = new MemoryWebStorage({});
    const indexedDB = new MemoryIndexedDb([]);

    const cleanup = clearRegisteredKnife4jStorage(
      'request-cache',
      { localStorage: cleanupStorage, sessionStorage, indexedDB },
      null,
    );
    const visibleHistory = getKnife4jStorageItem(writerStorage, targetKey, writerStorage);
    expect(visibleHistory).toBeNull();
    expect(writerStorage.getItem(targetKey)).toBe(JSON.stringify(['old-history']));

    const nextHistory = JSON.stringify(['new-history', ...(visibleHistory ? JSON.parse(visibleHistory) : [])]);
    const laterWrite = setKnife4jStorageItem(writerStorage, targetKey, nextHistory, writerStorage, null);
    cleanupStorage.removeItem(KNIFE4J_STORAGE_KEYS.mutationLease);
    const [result, persisted] = await Promise.all([cleanup, laterWrite]);

    expect(result.failures).toEqual([]);
    expect(persisted).toBe(true);
    expect(JSON.parse(writerStorage.getItem(targetKey) ?? '[]')).toEqual(['new-history']);
  });

  it('serializes cache epoch heartbeats behind a superseding reset mutation', async () => {
    const targetKey = `${KNIFE4J_STORAGE_PREFIXES.debugCache}operation-a`;
    const localStorage = new MemoryWebStorage({
      [targetKey]: 'cache',
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation',
    });
    const lockManager = new MemoryLockManager();
    const intervalCallbacks: Array<() => void> = [];
    const intervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void) => {
      intervalCallbacks.push(callback);
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {});
    let releaseBlocker: (() => void) | undefined;
    const blockerGate = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    let signalBlockerStarted: (() => void) | undefined;
    const blockerStarted = new Promise<void>((resolve) => {
      signalBlockerStarted = resolve;
    });
    const blocker = lockManager.request('knife4j-next:storage-reset', { mode: 'exclusive' }, async () => {
      signalBlockerStarted?.();
      await blockerGate;
    });

    try {
      await blockerStarted;
      const cleanup = clearRegisteredKnife4jStorage(
        'request-cache',
        {
          localStorage,
          sessionStorage: new MemoryWebStorage({}),
          indexedDB: new MemoryIndexedDb([]),
        },
        lockManager,
      );
      const activeEpoch = JSON.parse(localStorage.getItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch) ?? 'null') as {
        generation: string;
        expiresAt: number;
      };
      expect(activeEpoch.expiresAt).toBeGreaterThan(Date.now());

      const takeover = lockManager.request('knife4j-next:storage-reset', { mode: 'exclusive' }, () => {
        localStorage.setItem(
          KNIFE4J_STORAGE_KEYS.requestCacheEpoch,
          JSON.stringify({ version: 1, generation: 'superseding-reset', expiresAt: 0 }),
        );
      });
      expect(intervalCallbacks).toHaveLength(1);
      intervalCallbacks[0]();
      releaseBlocker?.();

      const [result] = await Promise.all([cleanup, takeover, blocker]);
      const finalEpoch = JSON.parse(localStorage.getItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch) ?? 'null') as {
        generation: string;
        expiresAt: number;
      };

      expect(result.failures).toEqual([]);
      expect(finalEpoch).toMatchObject({ generation: 'superseding-reset', expiresAt: 0 });
      expect(finalEpoch.generation).not.toBe(activeEpoch.generation);
    } finally {
      releaseBlocker?.();
      intervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it('rejects a history write whose read snapshot predates cross-tab cache cleanup', async () => {
    const targetKey = `${KNIFE4J_STORAGE_PREFIXES.debugHistory}operation-a`;
    const sharedValues = new Map<string, string>();
    const cleanupStorage = new MemoryWebStorage(
      {
        [targetKey]: JSON.stringify(['old-history']),
        [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation',
        [KNIFE4J_STORAGE_KEYS.mutationLease]: JSON.stringify({
          version: 1,
          generation: 'blocking-mutation',
          expiresAt: Date.now() + 1_000,
        }),
      },
      sharedValues,
    );
    const writerStorage = new MemoryWebStorage({}, sharedValues);
    const readSnapshot = getKnife4jStorageItemSnapshot(writerStorage, targetKey, writerStorage);
    expect(JSON.parse(readSnapshot.value ?? '[]')).toEqual(['old-history']);

    const cleanup = clearRegisteredKnife4jStorage(
      'request-cache',
      {
        localStorage: cleanupStorage,
        sessionStorage: new MemoryWebStorage({}),
        indexedDB: new MemoryIndexedDb([]),
      },
      null,
    );
    const staleWrite = setKnife4jStorageItem(
      writerStorage,
      targetKey,
      JSON.stringify(['new-history', 'old-history']),
      writerStorage,
      null,
      readSnapshot,
    );
    cleanupStorage.removeItem(KNIFE4J_STORAGE_KEYS.mutationLease);
    const [result, persisted] = await Promise.all([cleanup, staleWrite]);

    expect(result.failures).toEqual([]);
    expect(persisted).toBe(false);
    expect(writerStorage.getItem(targetKey)).toBeNull();
  });

  it('rejects a cache write that waited across a full reset generation change', async () => {
    const targetKey = `${KNIFE4J_STORAGE_PREFIXES.debugHistory}operation-a`;
    const requestCacheGeneration = 'active-cache-cleanup';
    const localStorage = new MemoryWebStorage({
      [targetKey]: 'old-history',
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation',
      [KNIFE4J_STORAGE_KEYS.requestCacheEpoch]: JSON.stringify({
        version: 1,
        generation: requestCacheGeneration,
        expiresAt: Date.now() + 1_000,
      }),
    });
    const lockManager = new MemoryLockManager();

    const persistence = setKnife4jStorageItem(localStorage, targetKey, 'stale-history', localStorage, lockManager);
    const result = await clearRegisteredKnife4jStorage(
      'all-local-data',
      {
        localStorage,
        sessionStorage: new MemoryWebStorage({}),
        indexedDB: new MemoryIndexedDb([]),
      },
      lockManager,
    );
    const completedEpoch = JSON.parse(localStorage.getItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch) ?? 'null') as {
      generation: string;
      expiresAt: number;
    };

    await expect(persistence).resolves.toBe(false);
    expect(result.failures).toEqual([]);
    expect(result.removed).toEqual({ localStorage: 1, sessionStorage: 0, indexedDB: 0 });
    expect(localStorage.getItem(targetKey)).toBeNull();
    expect(completedEpoch.generation).not.toBe(requestCacheGeneration);
    expect(completedEpoch.expiresAt).toBe(0);
  });

  it('recovers request-cache coordination after registered entries free quota', async () => {
    const firstKey = `${KNIFE4J_STORAGE_PREFIXES.debugCache}operation-a`;
    const secondKey = `${KNIFE4J_STORAGE_PREFIXES.debugHistory}operation-a`;
    const thirdKey = `${KNIFE4J_STORAGE_PREFIXES.apiVersionBaseline}operation-a`;
    const localStorage = new (class extends MemoryWebStorage {
      constructor() {
        super({
          [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation',
          [KNIFE4J_STORAGE_KEYS.requestCacheEpoch]: 'reserved-epoch-slot',
          [firstKey]: 'cache',
          [secondKey]: 'history',
          [thirdKey]: 'baseline',
        });
      }

      override setItem(key: string, value: string): void {
        if (!this.values.has(key) && this.values.size >= 5) throw new Error('quota exceeded');
        super.setItem(key, value);
      }
    })();
    const sessionStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.tabItems]: 'tabs',
    });

    const result = await clearRegisteredKnife4jStorage(
      'request-cache',
      { localStorage, sessionStorage, indexedDB: new MemoryIndexedDb([]) },
      null,
    );

    expect(result.failures).toEqual([]);
    expect(result.removed).toEqual({ localStorage: 3, sessionStorage: 1, indexedDB: 0 });
    expect(localStorage.getItem(firstKey)).toBeNull();
    expect(localStorage.getItem(secondKey)).toBeNull();
    expect(localStorage.getItem(thirdKey)).toBeNull();
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.mutationLease)).toBeNull();
  });

  it('publishes a compact cache epoch before quota recovery deletes shared request data', async () => {
    const cacheKey = `${KNIFE4J_STORAGE_PREFIXES.debugCache}operation-a`;
    const historyKey = `${KNIFE4J_STORAGE_PREFIXES.debugHistory}operation-a`;
    const initialEpoch = 'reserved-epoch-slot';
    const localStorage = new (class extends MemoryWebStorage {
      allowNewKeys = false;

      override setItem(key: string, value: string): void {
        if (key === KNIFE4J_STORAGE_KEYS.requestCacheEpoch && value.startsWith('{')) {
          throw new Error('quota exceeded for the full cache epoch');
        }
        if (!this.values.has(key) && !this.allowNewKeys) throw new Error('quota exceeded for a new key');
        super.setItem(key, value);
      }
    })({
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'stable-generation',
      [KNIFE4J_STORAGE_KEYS.requestCacheEpoch]: initialEpoch,
      [cacheKey]: 'cache',
      [historyKey]: 'history',
      'host-application:key': 'keep',
    });
    const sessionStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.tabItems]: 'tabs',
      'host-application:session': 'keep',
    });
    const staleHistory = getKnife4jStorageItemSnapshot(localStorage, historyKey, localStorage);

    const result = await clearRegisteredKnife4jStorage(
      'request-cache',
      { localStorage, sessionStorage, indexedDB: new MemoryIndexedDb([]) },
      null,
    );

    expect(result.removed).toEqual({ localStorage: 2, sessionStorage: 0, indexedDB: 0 });
    expect(result.failures).toEqual([
      {
        area: 'localStorage',
        key: KNIFE4J_STORAGE_KEYS.mutationLease,
        reason: 'request cache coordination failed: quota exceeded for the full cache epoch',
      },
    ]);
    expect(localStorage.getItem(cacheKey)).toBeNull();
    expect(localStorage.getItem(historyKey)).toBeNull();
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.requestCacheEpoch)).toMatch(/^\.[0-9a-z]+\.[0-9a-z]+$/);
    expect(localStorage.getItem('host-application:key')).toBe('keep');
    expect(sessionStorage.getItem(KNIFE4J_STORAGE_KEYS.tabItems)).toBe('tabs');
    expect(sessionStorage.getItem('host-application:session')).toBe('keep');

    localStorage.allowNewKeys = true;
    await expect(
      setKnife4jStorageItem(localStorage, historyKey, 'stale-history', localStorage, null, staleHistory),
    ).resolves.toBe(false);
    expect(localStorage.getItem(historyKey)).toBeNull();
  });

  it('replaces an existing value at quota through Web Locks without allocating an owner marker', async () => {
    const targetKey = KNIFE4J_STORAGE_KEYS.settings;
    const storage = new (class extends MemoryWebStorage {
      override setItem(key: string, value: string): void {
        if (!this.values.has(key)) throw new Error('quota exceeded for a new key');
        super.setItem(key, value);
      }
    })({ [targetKey]: 'old-value' });
    const persisted = await persistKnife4jStorageItem(storage, targetKey, 'new-value', new MemoryLockManager(), null);

    expect(persisted).toBe(true);
    expect(storage.getItem(targetKey)).toBe('new-value');
  });

  it('refuses a fallback write when quota prevents mutation coordination', async () => {
    const targetKey = KNIFE4J_STORAGE_KEYS.settings;
    const storage = new (class extends MemoryWebStorage {
      override setItem(key: string, value: string): void {
        if (!this.values.has(key)) throw new Error('quota exceeded for a new key');
        super.setItem(key, value);
      }
    })({ [targetKey]: 'old-value' });

    await expect(persistKnife4jStorageItem(storage, targetKey, 'stale-value', null, storage)).resolves.toBe(false);
    expect(storage.getItem(targetKey)).toBe('old-value');
  });

  it('does not let a pre-reset removal delete a post-reset value', async () => {
    const targetKey = `${KNIFE4J_STORAGE_PREFIXES.groupGlobalParams}group-a`;
    const localStorage = new MemoryWebStorage({
      [targetKey]: 'old-value',
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'before-reset',
      [KNIFE4J_STORAGE_KEYS.mutationLease]: JSON.stringify({
        version: 1,
        generation: 'active-reset-mutation',
        expiresAt: Date.now() + 1_000,
      }),
    });

    const staleRemoval = removeKnife4jStorageItem(localStorage, targetKey, null, localStorage);
    await new Promise((resolve) => setTimeout(resolve, 10));
    localStorage.setItem(KNIFE4J_STORAGE_KEYS.resetGeneration, 'after-reset');
    localStorage.setItem(targetKey, 'new-value');
    localStorage.removeItem(KNIFE4J_STORAGE_KEYS.mutationLease);

    await expect(staleRemoval).resolves.toBe(false);
    expect(localStorage.getItem(targetKey)).toBe('new-value');
  });

  it('binds a removal to the reset generation captured by its caller', async () => {
    const targetKey = `${KNIFE4J_STORAGE_PREFIXES.groupGlobalParams}group-a`;
    const localStorage = new MemoryWebStorage({
      [targetKey]: 'old-value',
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: 'before-reset',
    });
    const callerSnapshot = getKnife4jStorageResetSnapshot(localStorage);

    localStorage.setItem(KNIFE4J_STORAGE_KEYS.resetGeneration, 'after-reset');
    localStorage.setItem(targetKey, 'new-value');

    await expect(removeKnife4jStorageItem(localStorage, targetKey, null, localStorage, callerSnapshot)).resolves.toBe(
      false,
    );
    expect(localStorage.getItem(targetKey)).toBe('new-value');
  });

  it('serializes persistent mutations through Web Locks', async () => {
    const lockManager = new MemoryLockManager();
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let signalFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const order: string[] = [];

    const first = withKnife4jStorageWriteLock(
      async () => {
        signalFirstStarted?.();
        await firstGate;
        order.push('first');
      },
      lockManager,
      null,
    );
    await firstStarted;
    const second = withKnife4jStorageWriteLock(
      async () => {
        order.push('second');
      },
      lockManager,
      null,
    );
    await Promise.resolve();

    expect(order).toEqual([]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('serializes fallback mutations in call order within one context', async () => {
    const localStorage = new MemoryWebStorage({});
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let signalFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const order: string[] = [];

    const first = withKnife4jStorageWriteLock(
      async () => {
        signalFirstStarted?.();
        await firstGate;
        order.push('first');
      },
      null,
      localStorage,
    );
    const second = withKnife4jStorageWriteLock(
      async () => {
        order.push('second');
      },
      null,
      localStorage,
    );

    await firstStarted;
    expect(order).toEqual([]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('waits for existing writes and suppresses late writes across browsing contexts', async () => {
    const localStorage = new MemoryWebStorage({});
    const sessionStorage = new MemoryWebStorage({});
    const indexedDB = new MemoryIndexedDb([]);
    const lockManager = new MemoryLockManager();
    const authKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}legacy-group`;
    let releaseExistingWrite: (() => void) | undefined;
    const existingWriteGate = new Promise<void>((resolve) => {
      releaseExistingWrite = resolve;
    });

    const existingWrite = withKnife4jStorageWriteLock(async () => {
      await existingWriteGate;
      indexedDB.values.set(authKey, { token: 'legacy' });
    }, lockManager);
    const cleanup = clearRegisteredKnife4jStorage(
      'all-local-data',
      {
        localStorage,
        sessionStorage,
        indexedDB,
      },
      lockManager,
    );
    let lateWriteRan = false;
    const lateWrite = withKnife4jStorageWriteLock(async () => {
      lateWriteRan = true;
      indexedDB.values.set(authKey, { token: 'late' });
    }, lockManager);

    releaseExistingWrite?.();
    const [result] = await Promise.all([cleanup, existingWrite, lateWrite]);

    expect(result.failures).toEqual([]);
    expect(result.removed.indexedDB).toBe(1);
    expect(lateWriteRan).toBe(false);
    expect(indexedDB.values.has(authKey)).toBe(false);
  });

  it('serializes an in-flight cross-context write before a fallback reset', async () => {
    const localStorage = new MemoryWebStorage({});
    const sessionStorage = new MemoryWebStorage({});
    const indexedDB = new MemoryIndexedDb([]);
    const authKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}legacy-group`;
    let signalWriteStarted: (() => void) | undefined;
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    let releaseWrite: (() => void) | undefined;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    const staleWrite = withKnife4jStorageWriteLock(
      async (canWrite) => {
        signalWriteStarted?.();
        await writeGate;
        if (canWrite()) indexedDB.values.set(authKey, { token: 'stale' });
      },
      null,
      localStorage,
    );
    await writeStarted;

    const cleanup = clearRegisteredKnife4jStorage('all-local-data', { localStorage, sessionStorage, indexedDB }, null);
    releaseWrite?.();
    const [result] = await Promise.all([cleanup, staleWrite]);

    expect(result.failures).toEqual([]);
    expect(indexedDB.values.has(authKey)).toBe(false);
    expect(localStorage.values.has(KNIFE4J_STORAGE_KEYS.resetLease)).toBe(false);
    expect(localStorage.values.has(KNIFE4J_STORAGE_KEYS.mutationLease)).toBe(false);
  });

  it('refuses browser fallback writes when the IndexedDB critical section is unavailable', async () => {
    const localStorage = new MemoryWebStorage({});
    let writeRan = false;
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('indexedDB', undefined);

    try {
      const result = await withKnife4jStorageWriteLock(
        async () => {
          writeRan = true;
          return true;
        },
        null,
        localStorage,
      );

      expect(result).toBeUndefined();
      expect(writeRan).toBe(false);
      expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.mutationLease)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('holds the browser fallback critical section after its localStorage lease expires', async () => {
    const sharedValues = new Map<string, string>([['target', 'initial']]);
    const firstTabStorage = new MemoryWebStorage({}, sharedValues);
    const secondTabStorage = new MemoryWebStorage({}, sharedValues);
    const indexedDb = new SerializedTestIndexedDb();
    let signalFirstChecked: (() => void) | undefined;
    const firstChecked = new Promise<void>((resolve) => {
      signalFirstChecked = resolve;
    });
    let resumeFirst: (() => void) | undefined;
    const suspension = new Promise<void>((resolve) => {
      resumeFirst = resolve;
    });
    let secondWriteRan = false;
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('indexedDB', indexedDb.factory);

    try {
      const firstWrite = withKnife4jStorageWriteLock(
        async (canWrite) => {
          expect(canWrite()).toBe(true);
          signalFirstChecked?.();
          await suspension;
          // Model a renderer resuming after the final pre-write lease check.
          firstTabStorage.setItem('target', 'stale');
        },
        null,
        firstTabStorage,
      );
      await firstChecked;

      const expiredLease = JSON.parse(firstTabStorage.getItem(KNIFE4J_STORAGE_KEYS.mutationLease) ?? 'null') as {
        expiresAt: number;
      };
      expiredLease.expiresAt = Date.now() - 1;
      firstTabStorage.setItem(KNIFE4J_STORAGE_KEYS.mutationLease, JSON.stringify(expiredLease));

      const secondWrite = withKnife4jStorageWriteLock(
        async (canWrite) => {
          expect(canWrite()).toBe(true);
          secondWriteRan = true;
          secondTabStorage.setItem('target', 'newer');
        },
        null,
        secondTabStorage,
      );

      const transactionDeadline = Date.now() + 2_000;
      while (indexedDb.transactionCount < 2 && Date.now() < transactionDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(indexedDb.transactionCount).toBe(2);
      expect(secondWriteRan).toBe(false);
      expect(firstTabStorage.getItem('target')).toBe('initial');

      resumeFirst?.();
      await Promise.all([firstWrite, secondWrite]);

      expect(secondWriteRan).toBe(true);
      expect(firstTabStorage.getItem('target')).toBe('newer');
      expect(firstTabStorage.getItem(KNIFE4J_STORAGE_KEYS.mutationLease)).toBeNull();
    } finally {
      resumeFirst?.();
      indexedDb.closeConnection();
      vi.unstubAllGlobals();
    }
  });

  it('notifies subscribers when a fallback lease expires without a removal event', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const generation = 'crashed-reset';
    const localStorage = new MemoryWebStorage({
      [KNIFE4J_STORAGE_KEYS.resetGeneration]: generation,
      [KNIFE4J_STORAGE_KEYS.resetLease]: JSON.stringify({
        version: 1,
        generation,
        expiresAt: Date.now() + 100,
      }),
    });
    const snapshots: Array<{ generation: string; active: boolean }> = [];
    const unsubscribe = subscribeKnife4jStorageReset((snapshot) => snapshots.push({ ...snapshot }));

    try {
      expect(getKnife4jStorageResetSnapshot(localStorage)).toEqual({ generation, active: true });
      await vi.advanceTimersByTimeAsync(101);
      expect(snapshots.at(-1)).toEqual({ generation, active: false });
    } finally {
      unsubscribe();
      vi.useRealTimers();
    }
  });

  it('blocks guarded writes and removes bypass writes in the final pass without Web Locks', async () => {
    const localStorage = new MemoryWebStorage({ 'host-application:key': 'keep' });
    const sessionStorage = new MemoryWebStorage({});
    const authKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`;
    let signalDeleteStarted: (() => void) | undefined;
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve;
    });
    let releaseDelete: (() => void) | undefined;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const indexedDB = new (class extends MemoryIndexedDb {
      override async delete(key: IDBValidKey): Promise<void> {
        signalDeleteStarted?.();
        await deleteGate;
        await super.delete(key);
      }
    })([[authKey, { token: 'secret' }]]);
    const guardedKey = `${KNIFE4J_STORAGE_PREFIXES.debugCache}guarded`;
    const bypassKey = `${KNIFE4J_STORAGE_PREFIXES.debugHistory}bypass`;

    const cleanup = clearRegisteredKnife4jStorage('all-local-data', { localStorage, sessionStorage, indexedDB }, null);
    await deleteStarted;
    await expect(setKnife4jStorageItem(localStorage, guardedKey, 'guarded', localStorage)).resolves.toBe(false);
    localStorage.setItem(bypassKey, 'bypass');
    releaseDelete?.();
    const result = await cleanup;

    expect(result.failures).toEqual([]);
    expect(result.removed).toEqual({ localStorage: 1, sessionStorage: 0, indexedDB: 1 });
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.resetGeneration)).toEqual(expect.any(String));
    const remainingLocalStorage = new Map(localStorage.values);
    remainingLocalStorage.delete(KNIFE4J_STORAGE_KEYS.resetGeneration);
    expect(remainingLocalStorage).toEqual(new Map([['host-application:key', 'keep']]));
    expect(indexedDB.values.has(authKey)).toBe(false);
  });

  it('waits for an active fallback lease before starting another full reset', async () => {
    const localStorage = new MemoryWebStorage({});
    const sessionStorage = new MemoryWebStorage({});
    const authKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`;
    let signalDeleteStarted: (() => void) | undefined;
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve;
    });
    let releaseDelete: (() => void) | undefined;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const indexedDB = new (class extends MemoryIndexedDb {
      override async delete(key: IDBValidKey): Promise<void> {
        signalDeleteStarted?.();
        await deleteGate;
        await super.delete(key);
      }
    })([[authKey, { token: 'secret' }]]);

    const firstReset = clearRegisteredKnife4jStorage(
      'all-local-data',
      { localStorage, sessionStorage, indexedDB },
      null,
    );
    await deleteStarted;
    const firstLease = localStorage.getItem(KNIFE4J_STORAGE_KEYS.resetLease);
    expect(firstLease).not.toBeNull();

    let secondResetFinished = false;
    const secondReset = clearRegisteredKnife4jStorage(
      'all-local-data',
      { localStorage, sessionStorage, indexedDB },
      null,
    ).then((result) => {
      secondResetFinished = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.resetLease)).toBe(firstLease);
    expect(secondResetFinished).toBe(false);

    releaseDelete?.();
    const [firstResult, secondResult] = await Promise.all([firstReset, secondReset]);

    expect(firstResult.failures).toEqual([]);
    expect(secondResult.failures).toEqual([]);
    expect(localStorage.values.has(KNIFE4J_STORAGE_KEYS.resetLease)).toBe(false);
    expect(indexedDB.values.has(authKey)).toBe(false);
  });

  it('elects one fallback claimant when two resets start from an empty lease', async () => {
    const localStorage = new MemoryWebStorage({});
    const sessionStorage = new MemoryWebStorage({});
    let activeKeyScans = 0;
    let maxConcurrentKeyScans = 0;
    let signalKeyScanStarted: (() => void) | undefined;
    const keyScanStarted = new Promise<void>((resolve) => {
      signalKeyScanStarted = resolve;
    });
    let releaseKeyScans: (() => void) | undefined;
    const keyScanGate = new Promise<void>((resolve) => {
      releaseKeyScans = resolve;
    });
    const indexedDB: Knife4jIndexedDbStorage = {
      keys: async () => {
        activeKeyScans += 1;
        maxConcurrentKeyScans = Math.max(maxConcurrentKeyScans, activeKeyScans);
        signalKeyScanStarted?.();
        await keyScanGate;
        activeKeyScans -= 1;
        return [];
      },
      delete: async () => {},
    };

    const firstReset = clearRegisteredKnife4jStorage(
      'all-local-data',
      { localStorage, sessionStorage, indexedDB },
      null,
    );
    const secondReset = clearRegisteredKnife4jStorage(
      'all-local-data',
      { localStorage, sessionStorage, indexedDB },
      null,
    );

    await keyScanStarted;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(maxConcurrentKeyScans).toBe(1);

    releaseKeyScans?.();
    const [firstResult, secondResult] = await Promise.all([firstReset, secondReset]);

    expect(firstResult.failures).toEqual([]);
    expect(secondResult.failures).toEqual([]);
    expect(localStorage.values.has(KNIFE4J_STORAGE_KEYS.resetLease)).toBe(false);
    expect(
      Array.from(localStorage.values.keys()).some((key) => key.startsWith(KNIFE4J_STORAGE_PREFIXES.resetClaim)),
    ).toBe(false);
  });

  it('stops Web Storage deletion after losing fallback lease ownership', async () => {
    const localStorage = new (class extends MemoryWebStorage {
      override removeItem(key: string): void {
        super.removeItem(key);
        if (key === KNIFE4J_STORAGE_KEYS.settings) {
          super.setItem(
            KNIFE4J_STORAGE_KEYS.resetLease,
            JSON.stringify({ version: 1, generation: 'newer-web-storage-reset', expiresAt: Date.now() + 60_000 }),
          );
        }
      }
    })({
      [KNIFE4J_STORAGE_KEYS.settings]: 'settings',
      [KNIFE4J_STORAGE_KEYS.language]: 'zh-CN',
    });
    const sessionStorage = new MemoryWebStorage({
      [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`]: 'oauth',
    });
    const authKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`;
    const indexedDB = new MemoryIndexedDb([[authKey, { token: 'secret' }]]);

    const result = await clearRegisteredKnife4jStorage(
      'all-local-data',
      { localStorage, sessionStorage, indexedDB },
      null,
    );

    expect(result.removed).toEqual({ localStorage: 1, sessionStorage: 0, indexedDB: 0 });
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.settings)).toBeNull();
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.language)).toBe('zh-CN');
    expect(sessionStorage.getItem(`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}state`)).toBe('oauth');
    expect(indexedDB.values.has(authKey)).toBe(true);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'localStorage',
          key: KNIFE4J_STORAGE_KEYS.resetLease,
          reason: expect.stringContaining('reset lease ownership was lost'),
        }),
      ]),
    );

    localStorage.removeItem(KNIFE4J_STORAGE_KEYS.resetLease);
    getKnife4jStorageResetSnapshot(localStorage);
  });

  it('stops deleting when its fallback lease expires without a takeover', async () => {
    const localStorage = new MemoryWebStorage({});
    const sessionStorage = new MemoryWebStorage({});
    const firstAuthKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`;
    const secondAuthKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-b`;
    let deleteCount = 0;
    let signalDeleteStarted: (() => void) | undefined;
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve;
    });
    let releaseDelete: (() => void) | undefined;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const indexedDB = new (class extends MemoryIndexedDb {
      override async delete(key: IDBValidKey): Promise<void> {
        deleteCount += 1;
        signalDeleteStarted?.();
        await deleteGate;
        await super.delete(key);
      }
    })([
      [firstAuthKey, { token: 'secret-a' }],
      [secondAuthKey, { token: 'secret-b' }],
    ]);

    const cleanup = clearRegisteredKnife4jStorage('all-local-data', { localStorage, sessionStorage, indexedDB }, null);
    await deleteStarted;
    const lease = JSON.parse(localStorage.getItem(KNIFE4J_STORAGE_KEYS.resetLease) ?? 'null') as {
      expiresAt: number;
    };
    lease.expiresAt = Date.now() - 1;
    localStorage.setItem(KNIFE4J_STORAGE_KEYS.resetLease, JSON.stringify(lease));
    releaseDelete?.();
    const result = await cleanup;

    expect(deleteCount).toBe(1);
    expect(indexedDB.values.has(firstAuthKey)).toBe(false);
    expect(indexedDB.values.has(secondAuthKey)).toBe(true);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'localStorage',
          key: KNIFE4J_STORAGE_KEYS.resetLease,
          reason: expect.stringContaining('reset lease expired'),
        }),
      ]),
    );
  });

  it('stops deleting when fallback lease ownership is lost', async () => {
    const localStorage = new MemoryWebStorage({});
    const sessionStorage = new MemoryWebStorage({});
    const authKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-a`;
    const secondAuthKey = `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}group-b`;
    const bypassKey = `${KNIFE4J_STORAGE_PREFIXES.debugHistory}after-lease-loss`;
    let deleteCount = 0;
    let signalDeleteStarted: (() => void) | undefined;
    const deleteStarted = new Promise<void>((resolve) => {
      signalDeleteStarted = resolve;
    });
    let releaseDelete: (() => void) | undefined;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const indexedDB = new (class extends MemoryIndexedDb {
      override async delete(key: IDBValidKey): Promise<void> {
        deleteCount += 1;
        signalDeleteStarted?.();
        await deleteGate;
        await super.delete(key);
      }
    })([
      [authKey, { token: 'secret-a' }],
      [secondAuthKey, { token: 'secret-b' }],
    ]);

    const cleanup = clearRegisteredKnife4jStorage('all-local-data', { localStorage, sessionStorage, indexedDB }, null);
    await deleteStarted;
    localStorage.setItem(
      KNIFE4J_STORAGE_KEYS.resetLease,
      JSON.stringify({ version: 1, generation: 'newer-reset', expiresAt: Date.now() + 60_000 }),
    );
    localStorage.setItem(bypassKey, 'keep-after-loss');
    localStorage.removeItem(KNIFE4J_STORAGE_KEYS.resetLease);
    releaseDelete?.();
    const result = await cleanup;

    expect(deleteCount).toBe(1);
    expect(indexedDB.values.has(authKey)).toBe(false);
    expect(indexedDB.values.has(secondAuthKey)).toBe(true);
    expect(localStorage.getItem(bypassKey)).toBe('keep-after-loss');
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: 'localStorage',
          key: KNIFE4J_STORAGE_KEYS.resetLease,
          reason: expect.stringContaining('reset lease ownership was lost'),
        }),
      ]),
    );
  });
});
