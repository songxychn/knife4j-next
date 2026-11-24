import { describe, expect, test } from 'vitest';
import {
  RESPONSE_EXTRACTION_STORAGE_VERSION,
  readResponseExtractionRules,
  removeResponseExtractionRules,
  responseExtractionStorageKey,
  writeResponseExtractionRules,
  type ResponseExtractionStorage,
} from './responseExtractionStorage';
import type { ResponseExtractionRule } from './responseExtraction';

function createMemoryStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  const storage: ResponseExtractionStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return { data, storage };
}

const sampleRule: ResponseExtractionRule = {
  id: 'rule-login',
  enabled: true,
  source: 'json-body',
  expression: '$.data.token',
  prefix: 'Bearer ',
  targetScope: 'application',
  targetIn: 'header',
  targetName: 'Authorization',
  masked: true,
};

describe('responseExtractionStorage', () => {
  test('round-trips rules under the registered prefix and removes key when emptied', () => {
    const { data, storage } = createMemoryStorage();
    const cacheKey = 'default::POST::/api/login';

    expect(writeResponseExtractionRules(cacheKey, [sampleRule], storage)).toBe(true);
    expect(data.has(responseExtractionStorageKey(cacheKey))).toBe(true);
    expect(readResponseExtractionRules(cacheKey, storage)).toEqual([sampleRule]);

    expect(writeResponseExtractionRules(cacheKey, [], storage)).toBe(true);
    expect(data.has(responseExtractionStorageKey(cacheKey))).toBe(false);
    expect(readResponseExtractionRules(cacheKey, storage)).toEqual([]);
  });

  test('ignores corrupt json or unknown schema version without throwing', () => {
    const cacheKey = 'default::POST::/api/login';
    const key = responseExtractionStorageKey(cacheKey);
    const corrupt = createMemoryStorage({ [key]: '{bad-json' });
    expect(readResponseExtractionRules(cacheKey, corrupt.storage)).toEqual([]);

    const wrongVersion = createMemoryStorage({
      [key]: JSON.stringify({ version: RESPONSE_EXTRACTION_STORAGE_VERSION + 1, rules: [sampleRule] }),
    });
    expect(readResponseExtractionRules(cacheKey, wrongVersion.storage)).toEqual([]);
  });

  test('reports false safely when storage throws', () => {
    const broken: ResponseExtractionStorage = {
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

    expect(readResponseExtractionRules('op', broken)).toEqual([]);
    expect(writeResponseExtractionRules('op', [sampleRule], broken)).toBe(false);
    expect(removeResponseExtractionRules('op', broken)).toBe(false);
  });
});
