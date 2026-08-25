import { describe, expect, it } from 'vitest';
import {
  KNIFE4J_STORAGE_KEYS,
  KNIFE4J_STORAGE_PREFIXES,
  KNIFE4J_STORAGE_REGISTRY,
  clearRegisteredKnife4jStorage,
  removedKnife4jStorageEntryCount,
  type Knife4jIndexedDbStorage,
  type Knife4jWebStorage,
} from './knife4jStorage';

class MemoryWebStorage implements Knife4jWebStorage {
  readonly values = new Map<string, string>();
  readonly failures = new Set<string>();

  constructor(initial: Record<string, string>) {
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, value));
  }

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
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

    const result = await clearRegisteredKnife4jStorage('all-local-data', {
      localStorage,
      sessionStorage,
      indexedDB,
    });

    expect(result.failures).toEqual([]);
    expect(removedKnife4jStorageEntryCount(result)).toBe(13);
    expect(localStorage.values).toEqual(
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
});
