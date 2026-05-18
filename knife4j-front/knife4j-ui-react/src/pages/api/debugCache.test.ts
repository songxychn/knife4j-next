import { describe, expect, it } from 'vitest';
import {
  DEBUG_CACHE_VERSION,
  debugCacheStorageKey,
  readDebugCache,
  removeDebugCache,
  writeDebugCache,
  type DebugCacheState,
  type DebugCacheStorage,
} from './debugCache';

class MemoryStorage implements DebugCacheStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function makeState(): DebugCacheState {
  return {
    version: DEBUG_CACHE_VERSION,
    baseUrl: 'http://localhost:8080',
    method: 'POST',
    path: '/users/{id}',
    paramValues: {
      'path:id': '42',
      'query:name': 'alice',
    },
    paramEnabled: {
      'path:id': true,
      'query:name': false,
    },
    selectedContentType: 'application/json',
    body: '{"name":"alice"}',
    formFields: {
      name: 'alice',
    },
    rawMode: 'json',
    customQueryParams: [{ id: 'custom-query', name: 'debug', value: '1' }],
    customHeaders: [{ id: 'custom-header', name: 'X-Trace', value: 'trace-1' }],
    customCookies: [{ id: 'custom-cookie', name: 'sid', value: 'abc' }],
  };
}

describe('debugCache', () => {
  it('round-trips the debug cache under an encoded per-operation key', () => {
    const storage = new MemoryStorage();
    const cacheKey = 'default|用户|创建用户|POST|/users/{id}';
    const state = makeState();

    writeDebugCache(cacheKey, state, storage);

    expect(storage.values.has(debugCacheStorageKey(cacheKey))).toBe(true);
    expect(readDebugCache(cacheKey, storage)).toEqual(state);
  });

  it('normalizes malformed cache payloads before restoring them', () => {
    const storage = new MemoryStorage();
    const cacheKey = 'default|demo';
    storage.setItem(
      debugCacheStorageKey(cacheKey),
      JSON.stringify({
        version: DEBUG_CACHE_VERSION,
        baseUrl: 'http://localhost:8080',
        method: 'POST',
        path: '/users',
        paramValues: { 'query:name': 'alice', broken: 1 },
        paramEnabled: { 'query:name': true, broken: 'yes' },
        selectedContentType: 'application/json',
        body: '{"name":"alice"}',
        formFields: { name: 'alice', ignored: false },
        rawMode: 'bogus',
        customQueryParams: [
          { id: 'q1', name: 'debug', value: '1' },
          { id: 'bad', name: 2, value: 'x' },
        ],
        customHeaders: [{ id: 'h1', name: 'X-Trace', value: 'trace-1' }],
        customCookies: 'not-array',
      }),
    );

    expect(readDebugCache(cacheKey, storage)).toEqual({
      version: DEBUG_CACHE_VERSION,
      baseUrl: 'http://localhost:8080',
      method: 'POST',
      path: '/users',
      paramValues: { 'query:name': 'alice' },
      paramEnabled: { 'query:name': true },
      selectedContentType: 'application/json',
      body: '{"name":"alice"}',
      formFields: { name: 'alice' },
      rawMode: 'text',
      customQueryParams: [{ id: 'q1', name: 'debug', value: '1' }],
      customHeaders: [{ id: 'h1', name: 'X-Trace', value: 'trace-1' }],
      customCookies: [],
    });
  });

  it('ignores unsupported versions and removes cache entries', () => {
    const storage = new MemoryStorage();
    const cacheKey = 'default|demo';
    storage.setItem(debugCacheStorageKey(cacheKey), JSON.stringify({ ...makeState(), version: 0 }));

    expect(readDebugCache(cacheKey, storage)).toBeNull();

    writeDebugCache(cacheKey, makeState(), storage);
    removeDebugCache(cacheKey, storage);

    expect(readDebugCache(cacheKey, storage)).toBeNull();
  });
});
