import {
  getKnife4jStorageItem,
  KNIFE4J_STORAGE_PREFIXES,
  updateKnife4jStorageItem,
  type Knife4jStorageLockManager,
  type Knife4jWebStorage,
} from '../storage/knife4jStorage';
import { safeResourceDisplay, type ResourceCandidate } from './externalResourceGraph';

export const RESOURCE_GRANT_STORAGE_VERSION = 1;
const HASH = /^[0-9a-f]{64}$/;
const MAX_GRANTS_PER_DOCUMENT = 128;
const MAX_STORED_BYTES = 128 * 1024;
const MAX_DISPLAY_LENGTH = 512;

export interface StoredResourceGrant {
  readonly resourceKey: string;
  readonly displayUri: string;
  readonly grantedAt: number;
}

interface StoredResourceGrantDocument {
  readonly version: typeof RESOURCE_GRANT_STORAGE_VERSION;
  readonly documentScope: string;
  readonly grants: readonly StoredResourceGrant[];
}

export interface ResourceGrantStorageOptions {
  readonly storage?: Knife4jWebStorage | null;
  readonly leaseStorage?: Knife4jWebStorage | null;
  readonly lockManager?: Knife4jStorageLockManager | null;
  readonly now?: () => number;
}

function browserLocalStorage(): Knife4jWebStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function storageKey(documentScope: string): string {
  return `${KNIFE4J_STORAGE_PREFIXES.resourceGrants}${documentScope}`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isSafeStoredDisplay(value: string): boolean {
  if (!value || value.length > MAX_DISPLAY_LENGTH || /\/\/[^/@\s]+@/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return !parsed.username && !parsed.password && (!parsed.search || parsed.search === '?%E2%80%A6');
  } catch {
    return false;
  }
}

export function parseStoredResourceGrants(raw: string | null, documentScope: string): readonly StoredResourceGrant[] {
  if (!raw || !HASH.test(documentScope) || byteLength(raw) > MAX_STORED_BYTES) return Object.freeze([]);
  try {
    const parsed = JSON.parse(raw) as Partial<StoredResourceGrantDocument>;
    if (
      parsed.version !== RESOURCE_GRANT_STORAGE_VERSION ||
      parsed.documentScope !== documentScope ||
      !Array.isArray(parsed.grants) ||
      parsed.grants.length > MAX_GRANTS_PER_DOCUMENT
    ) {
      return Object.freeze([]);
    }
    const seen = new Set<string>();
    const grants: StoredResourceGrant[] = [];
    for (const candidate of parsed.grants) {
      if (
        candidate === null ||
        typeof candidate !== 'object' ||
        !HASH.test(candidate.resourceKey) ||
        !isSafeStoredDisplay(candidate.displayUri) ||
        !Number.isSafeInteger(candidate.grantedAt) ||
        candidate.grantedAt < 0 ||
        seen.has(candidate.resourceKey)
      ) {
        return Object.freeze([]);
      }
      seen.add(candidate.resourceKey);
      grants.push(
        Object.freeze({
          resourceKey: candidate.resourceKey,
          displayUri: candidate.displayUri,
          grantedAt: candidate.grantedAt,
        }),
      );
    }
    return Object.freeze(grants);
  } catch {
    return Object.freeze([]);
  }
}

export function readRememberedResourceGrants(
  documentScope: string,
  options: ResourceGrantStorageOptions = {},
): readonly StoredResourceGrant[] {
  if (!HASH.test(documentScope)) return Object.freeze([]);
  const storage = options.storage === undefined ? browserLocalStorage() : options.storage;
  if (!storage) return Object.freeze([]);
  const leaseStorage = options.leaseStorage === undefined ? storage : options.leaseStorage;
  try {
    return parseStoredResourceGrants(
      getKnife4jStorageItem(storage, storageKey(documentScope), leaseStorage),
      documentScope,
    );
  } catch {
    return Object.freeze([]);
  }
}

function serializedGrantDocument(
  documentScope: string,
  currentRaw: string | null,
  candidates: readonly ResourceCandidate[],
  grantedAt: number,
): string {
  const existing = parseStoredResourceGrants(currentRaw, documentScope);
  const byKey = new Map(existing.map((grant) => [grant.resourceKey, grant]));
  candidates.forEach((candidate) => {
    byKey.set(
      candidate.retrievalUriHash,
      Object.freeze({
        resourceKey: candidate.retrievalUriHash,
        displayUri: safeResourceDisplay(candidate.retrievalUri),
        grantedAt,
      }),
    );
  });
  const grants = [...byKey.values()]
    .sort((left, right) => right.grantedAt - left.grantedAt || left.resourceKey.localeCompare(right.resourceKey))
    .slice(0, MAX_GRANTS_PER_DOCUMENT);
  return JSON.stringify({ version: RESOURCE_GRANT_STORAGE_VERSION, documentScope, grants });
}

export async function rememberResourceGrants(
  documentScope: string,
  candidates: readonly ResourceCandidate[],
  options: ResourceGrantStorageOptions = {},
): Promise<boolean> {
  if (!HASH.test(documentScope) || candidates.length === 0) return false;
  const storage = options.storage === undefined ? browserLocalStorage() : options.storage;
  if (!storage) return false;
  const leaseStorage = options.leaseStorage === undefined ? storage : options.leaseStorage;
  const result = await updateKnife4jStorageItem(
    storage,
    storageKey(documentScope),
    (current) => serializedGrantDocument(documentScope, current, candidates, (options.now ?? Date.now)()),
    leaseStorage,
    options.lockManager,
  );
  return result.persisted;
}
