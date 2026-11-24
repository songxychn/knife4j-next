import { isRecord } from 'knife4j-core';
import {
  KNIFE4J_STORAGE_PREFIXES,
  getKnife4jStorageItem,
  removeKnife4jStorageItem,
  setKnife4jStorageItem,
} from '../../storage/knife4jStorage';
import { normalizeResponseExtractionRules, type ResponseExtractionRule } from './responseExtraction';

export const RESPONSE_EXTRACTION_STORAGE_VERSION = 1;

export interface ResponseExtractionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(): ResponseExtractionStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function responseExtractionStorageKey(operationCacheKey: string): string {
  return `${KNIFE4J_STORAGE_PREFIXES.responseExtractionRules}${encodeURIComponent(operationCacheKey)}`;
}

export function readResponseExtractionRules(
  operationCacheKey: string,
  storage: ResponseExtractionStorage | null = getBrowserStorage(),
): ResponseExtractionRule[] {
  if (!storage) return [];
  try {
    const raw = getKnife4jStorageItem(storage, responseExtractionStorageKey(operationCacheKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== RESPONSE_EXTRACTION_STORAGE_VERSION) return [];
    return normalizeResponseExtractionRules(parsed.rules);
  } catch {
    return [];
  }
}

export function writeResponseExtractionRules(
  operationCacheKey: string,
  rules: readonly ResponseExtractionRule[],
  storage: ResponseExtractionStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  const key = responseExtractionStorageKey(operationCacheKey);
  const normalized = normalizeResponseExtractionRules(rules);
  if (normalized.length === 0) {
    return removeKnife4jStorageItem(storage, key);
  }
  return setKnife4jStorageItem(
    storage,
    key,
    JSON.stringify({ version: RESPONSE_EXTRACTION_STORAGE_VERSION, rules: normalized }),
  );
}

export function removeResponseExtractionRules(
  operationCacheKey: string,
  storage: ResponseExtractionStorage | null = getBrowserStorage(),
): boolean {
  if (!storage) return false;
  return removeKnife4jStorageItem(storage, responseExtractionStorageKey(operationCacheKey));
}
