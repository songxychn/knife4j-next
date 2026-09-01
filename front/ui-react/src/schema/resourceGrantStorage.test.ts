import { describe, expect, test } from 'vitest';
import { sha256Hex } from '../apiChange/apiChangeTracker';
import { KNIFE4J_STORAGE_PREFIXES, KNIFE4J_STORAGE_REGISTRY, type Knife4jWebStorage } from '../storage/knife4jStorage';
import type { ResourceCandidate } from './externalResourceGraph';
import {
  parseStoredResourceGrants,
  readRememberedResourceGrants,
  rememberResourceGrants,
} from './resourceGrantStorage';

class MemoryStorage implements Knife4jWebStorage {
  private readonly values = new Map<string, string>();
  public get length(): number {
    return this.values.size;
  }
  public key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  public removeItem(key: string): void {
    this.values.delete(key);
  }
}

const lockManager = {
  request: async <T>(
    name: string,
    _options: { mode: 'shared' | 'exclusive'; ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => T | PromiseLike<T>,
  ): Promise<T> => callback({ name }),
};

const candidate = (uri: string): ResourceCandidate => ({
  retrievalUri: uri,
  retrievalUriHash: sha256Hex(uri),
  displayUri: uri,
  sameOrigin: false,
  depth: 1,
  state: 'pending',
  retryable: false,
  references: [],
});

describe('persistent exact resource grants', () => {
  test('stores only hashes, a redacted label, and time within one document scope', async () => {
    const storage = new MemoryStorage();
    const documentScope = sha256Hex('entry');
    const uri = 'https://schemas.example.test/pet.json?token=secret';
    await expect(
      rememberResourceGrants(documentScope, [candidate(uri)], {
        storage,
        leaseStorage: storage,
        lockManager,
        now: () => 1234,
      }),
    ).resolves.toBe(true);

    const raw = storage.getItem(`${KNIFE4J_STORAGE_PREFIXES.resourceGrants}${documentScope}`) ?? '';
    expect(raw).not.toContain('token=secret');
    expect(raw).not.toContain(uri);
    expect(raw).toContain(sha256Hex(uri));
    expect(readRememberedResourceGrants(documentScope, { storage, leaseStorage: storage })).toEqual([
      {
        resourceKey: sha256Hex(uri),
        displayUri: 'https://schemas.example.test/pet.json?…',
        grantedAt: 1234,
      },
    ]);
    expect(readRememberedResourceGrants(sha256Hex('other'), { storage, leaseStorage: storage })).toEqual([]);
  });

  test('fails closed for malformed, oversized, or scope-mismatched records', () => {
    const scope = sha256Hex('entry');
    expect(parseStoredResourceGrants('{', scope)).toEqual([]);
    expect(
      parseStoredResourceGrants(JSON.stringify({ version: 1, documentScope: sha256Hex('other'), grants: [] }), scope),
    ).toEqual([]);
    expect(
      parseStoredResourceGrants(
        JSON.stringify({
          version: 1,
          documentScope: scope,
          grants: [{ resourceKey: sha256Hex('uri'), displayUri: 'https://u:p@example.test/a', grantedAt: 1 }],
        }),
        scope,
      ),
    ).toEqual([]);
  });

  test('registers the grant prefix for all-local-data cleanup', () => {
    expect(KNIFE4J_STORAGE_REGISTRY.localStorage).toContainEqual({
      match: 'prefix',
      value: KNIFE4J_STORAGE_PREFIXES.resourceGrants,
      scope: 'all-local-data',
    });
  });
});
