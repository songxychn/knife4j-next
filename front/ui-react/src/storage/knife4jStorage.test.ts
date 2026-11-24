import { describe, expect, it, vi } from 'vitest';
import {
  KNIFE4J_STORAGE_KEYS,
  KNIFE4J_STORAGE_PREFIXES,
  clearRegisteredKnife4jStorage,
  getKnife4jStorageItem,
  removeKnife4jStorageItem,
  removedKnife4jStorageEntryCount,
  setKnife4jStorageItem,
  subscribeKnife4jStorageCleanup,
  updateKnife4jStorageItem,
  type Knife4jIndexedDbStorage,
  type Knife4jWebStorage,
} from './knife4jStorage';

function createMemoryStorage(
  initial: Record<string, string> = {},
): Knife4jWebStorage & { dump(): Record<string, string> } {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key(index: number) {
      return Array.from(data.keys())[index] ?? null;
    },
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data.entries());
    },
  };
}

function createMemoryIndexedDb(initial: Record<string, unknown> = {}): Knife4jIndexedDbStorage & { dump(): string[] } {
  const data = new Map<IDBValidKey, unknown>(Object.entries(initial));
  return {
    async keys() {
      return Array.from(data.keys());
    },
    async delete(key: IDBValidKey) {
      data.delete(key);
    },
    dump() {
      return Array.from(data.keys()).map(String);
    },
  };
}

describe('knife4jStorage helpers', () => {
  it('reads, writes, updates, and removes values safely without throwing on storage errors', () => {
    const storage = createMemoryStorage();
    expect(setKnife4jStorageItem(storage, 'k', 'v1')).toBe(true);
    expect(getKnife4jStorageItem(storage, 'k')).toBe('v1');
    expect(updateKnife4jStorageItem(storage, 'k', (cur) => `${cur}-v2`)).toEqual({ persisted: true, value: 'v1-v2' });
    expect(removeKnife4jStorageItem(storage, 'k')).toBe(true);
    expect(getKnife4jStorageItem(storage, 'k')).toBeNull();

    const broken: Knife4jWebStorage = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(getKnife4jStorageItem(broken, 'k')).toBeNull();
    expect(setKnife4jStorageItem(broken, 'k', 'v')).toBe(false);
    expect(removeKnife4jStorageItem(broken, 'k')).toBe(false);
    expect(updateKnife4jStorageItem(broken, 'k', () => 'v')).toEqual({ persisted: false, value: null });
  });
});

describe('clearRegisteredKnife4jStorage', () => {
  it('removes only request-cache entries when scope is request-cache and preserves settings, auth, and host keys', async () => {
    const localStorage = createMemoryStorage({
      [`${KNIFE4J_STORAGE_PREFIXES.debugCache}g1`]: '{}',
      [`${KNIFE4J_STORAGE_PREFIXES.debugHistory}g1`]: '[]',
      [`${KNIFE4J_STORAGE_PREFIXES.apiVersionBaseline}g1`]: '{}',
      [KNIFE4J_STORAGE_KEYS.settings]: '{"version":1}',
      [KNIFE4J_STORAGE_KEYS.debugPanelLayout]: '{"responseBodyHeight":680}',
      [`${KNIFE4J_STORAGE_PREFIXES.groupGlobalParams}g1`]: '{}',
      'host-app-key': 'keep',
    });
    const sessionStorage = createMemoryStorage({
      [KNIFE4J_STORAGE_KEYS.tabItems]: '[]',
      [KNIFE4J_STORAGE_KEYS.tabActive]: '/home',
      [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}s1`]: '{}',
      'host-session-key': 'keep',
    });
    const indexedDB = createMemoryIndexedDb({
      [`${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}g1`]: { bearer: {} },
      'host-idb-key': { keep: true },
    });

    const result = await clearRegisteredKnife4jStorage('request-cache', {
      localStorage,
      sessionStorage,
      indexedDB,
    });

    expect(result.failures).toEqual([]);
    expect(result.removed).toEqual({ localStorage: 3, sessionStorage: 2, indexedDB: 0 });
    expect(removedKnife4jStorageEntryCount(result)).toBe(5);
    expect(localStorage.dump()).toEqual({
      [KNIFE4J_STORAGE_KEYS.settings]: '{"version":1}',
      [KNIFE4J_STORAGE_KEYS.debugPanelLayout]: '{"responseBodyHeight":680}',
      [`${KNIFE4J_STORAGE_PREFIXES.groupGlobalParams}g1`]: '{}',
      'host-app-key': 'keep',
    });
    expect(sessionStorage.dump()).toEqual({
      [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}s1`]: '{}',
      'host-session-key': 'keep',
    });
    expect(indexedDB.dump()).toEqual([`${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}g1`, 'host-idb-key']);
  });

  it('removes all registered Knife4j keys across all areas for all-local-data while preserving host keys', async () => {
    const localStorage = createMemoryStorage({
      [`${KNIFE4J_STORAGE_PREFIXES.debugCache}g1`]: '{}',
      [`${KNIFE4J_STORAGE_PREFIXES.resourceGrants}doc`]: '{}',
      [KNIFE4J_STORAGE_KEYS.settings]: '{}',
      [KNIFE4J_STORAGE_KEYS.language]: 'en-US',
      [KNIFE4J_STORAGE_KEYS.debugPanelLayout]: '{"responseBodyHeight":680}',
      [`${KNIFE4J_STORAGE_PREFIXES.applicationGlobalParams}/`]: '[]',
      'host-app-key': 'keep',
    });
    const sessionStorage = createMemoryStorage({
      [KNIFE4J_STORAGE_KEYS.tabItems]: '[]',
      [`${KNIFE4J_STORAGE_PREFIXES.oauth2Pending}s1`]: '{}',
      'host-session-key': 'keep',
    });
    const indexedDB = createMemoryIndexedDb({
      [`${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}g1`]: { bearer: {} },
      'host-idb-key': { keep: true },
    });

    const result = await clearRegisteredKnife4jStorage('all-local-data', {
      localStorage,
      sessionStorage,
      indexedDB,
    });

    expect(result.failures).toEqual([]);
    expect(result.removed).toEqual({ localStorage: 6, sessionStorage: 2, indexedDB: 1 });
    expect(removedKnife4jStorageEntryCount(result)).toBe(9);
    expect(localStorage.dump()).toEqual({ 'host-app-key': 'keep' });
    expect(sessionStorage.dump()).toEqual({ 'host-session-key': 'keep' });
    expect(indexedDB.dump()).toEqual(['host-idb-key']);
  });

  it('reports per-area failures without aborting remaining areas', async () => {
    const localStorage = createMemoryStorage({ [KNIFE4J_STORAGE_KEYS.settings]: '{}' });
    const failingIndexedDb: Knife4jIndexedDbStorage = {
      keys: async () => {
        throw new Error('IDB blocked');
      },
      delete: async () => {},
    };

    const result = await clearRegisteredKnife4jStorage('all-local-data', {
      localStorage,
      sessionStorage: null,
      indexedDB: failingIndexedDb,
    });

    expect(result.removed.localStorage).toBe(1);
    expect(result.failures).toEqual([
      { area: 'sessionStorage', reason: 'sessionStorage is unavailable' },
      { area: 'indexedDB', reason: 'IDB blocked' },
    ]);
  });

  it('gracefully handles BroadcastChannel subscription when unsupported', () => {
    const original = globalThis.BroadcastChannel;
    vi.stubGlobal('BroadcastChannel', undefined);
    try {
      const unsubscribe = subscribeKnife4jStorageCleanup(() => {});
      expect(() => unsubscribe()).not.toThrow();
    } finally {
      vi.stubGlobal('BroadcastChannel', original);
    }
  });
});
