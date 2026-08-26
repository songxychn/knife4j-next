import { buildOperationOpenApiDocument } from '../pages/api/operationOpenApiDocument';
import { KNIFE4J_STORAGE_PREFIXES } from '../storage/knife4jStorage';
import type { SwaggerDoc } from '../types/swagger';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const IDENTITY_FIELDS = ['origin', 'applicationPath', 'group', 'apiDocsUrl'] as const;
const MAX_IDENTITY_FIELD_LENGTH = 8 * 1024;
const MAX_OPERATION_IDENTITY_LENGTH = 16 * 1024;
const MAX_OPERATION_COUNT = 10_000;
const SHA256_FINGERPRINT = /^sha256:[0-9a-f]{64}$/;

export const API_CHANGE_BASELINE_VERSION = 1;
export const API_CHANGE_BASELINE_MAX_BYTES = 1024 * 1024;

export interface ApiDocumentIdentity {
  origin: string;
  applicationPath: string;
  group: string;
  apiDocsUrl: string;
}

export type ApiChangeStatus = 'added' | 'changed';
export type ApiOperationFingerprintMap = Record<string, string>;
export type ApiChangeStatusMap = Record<string, ApiChangeStatus>;

export interface ApiChangeBaseline {
  version: typeof API_CHANGE_BASELINE_VERSION;
  document: ApiDocumentIdentity;
  operations: ApiOperationFingerprintMap;
}

export interface ApiChangeReconciliation {
  baseline: ApiChangeBaseline;
  statuses: ApiChangeStatusMap;
  initialized: boolean;
}

export interface ApiChangeSummary {
  added: number;
  changed: number;
  total: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function emptyFingerprintMap(): ApiOperationFingerprintMap {
  return Object.create(null) as ApiOperationFingerprintMap;
}

function emptyStatusMap(): ApiChangeStatusMap {
  return Object.create(null) as ApiChangeStatusMap;
}

function copyFingerprints(source: ApiOperationFingerprintMap): ApiOperationFingerprintMap {
  const result = emptyFingerprintMap();
  Object.entries(source).forEach(([key, value]) => {
    result[key] = value;
  });
  return result;
}

/** JSON serialization with recursively sorted object keys and preserved array order. */
export function stableSerializeJson(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, nestedValue) => {
    if (!isRecord(nestedValue)) return nestedValue;

    const sorted = Object.create(null) as JsonRecord;
    Object.keys(nestedValue)
      .sort()
      .forEach((key) => {
        sorted[key] = nestedValue[key];
      });
    return sorted;
  });
  if (serialized === undefined) throw new TypeError('Unable to serialize API change snapshot');
  return serialized;
}

const SHA256_INITIAL_STATE = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Small browser-safe SHA-256 implementation so HTTP-hosted doc pages do not depend on SubtleCrypto. */
export function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const bitLength = input.byteLength * 8;
  const paddedLength = Math.ceil((input.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.byteLength] = 0x80;

  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Uint32Array(SHA256_INITIAL_STATE);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = paddedView.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  return Array.from(state, (word) => word.toString(16).padStart(8, '0')).join('');
}

export function apiOperationIdentity(method: string, path: string): string {
  return JSON.stringify([method.trim().toUpperCase(), path]);
}

export function buildApiChangeBaselineStorageKey(identity: ApiDocumentIdentity): string {
  return `${KNIFE4J_STORAGE_PREFIXES.apiVersionBaseline}${sha256Hex(stableSerializeJson(identity))}`;
}

/**
 * Build fingerprints for every operation in an OAS 3.0 document, independent
 * of sidebar filters and operationId. Object order is canonicalized before the
 * #658 snapshot builder runs so generated local-reference target names are
 * deterministic too.
 */
export function buildApiOperationFingerprints(swaggerDoc: SwaggerDoc): ApiOperationFingerprintMap | null {
  if (typeof swaggerDoc.openapi !== 'string' || !swaggerDoc.openapi.startsWith('3.0.')) return null;

  const canonicalDoc = JSON.parse(stableSerializeJson(swaggerDoc)) as SwaggerDoc;
  if (!isRecord(canonicalDoc.paths)) return null;

  const fingerprints = emptyFingerprintMap();
  Object.keys(canonicalDoc.paths)
    .sort()
    .forEach((path) => {
      const pathItem = canonicalDoc.paths[path] as unknown;
      if (!isRecord(pathItem)) return;

      HTTP_METHODS.forEach((method) => {
        if (!isRecord(pathItem[method])) return;
        const operationDocument = buildOperationOpenApiDocument(canonicalDoc, path, method);
        if (!operationDocument) return;

        // Document title/version/contact changes should not mark every API as
        // changed. Request/response semantics, servers, inherited security,
        // extensions, and the reachable component closure remain included.
        const semanticSnapshot = Object.create(null) as JsonRecord;
        Object.entries(operationDocument).forEach(([key, nestedValue]) => {
          if (key !== 'info') semanticSnapshot[key] = nestedValue;
        });
        const serializedSnapshot = stableSerializeJson(semanticSnapshot);
        fingerprints[apiOperationIdentity(method, path)] = `sha256:${sha256Hex(serializedSnapshot)}`;
      });
    });

  return fingerprints;
}

function validIdentity(value: unknown): value is ApiDocumentIdentity {
  if (!isRecord(value)) return false;
  return IDENTITY_FIELDS.every(
    (field) => typeof value[field] === 'string' && (value[field] as string).length <= MAX_IDENTITY_FIELD_LENGTH,
  );
}

function sameIdentity(left: ApiDocumentIdentity, right: ApiDocumentIdentity): boolean {
  return IDENTITY_FIELDS.every((field) => left[field] === right[field]);
}

function serializedByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function parseApiChangeBaseline(raw: string | null, identity: ApiDocumentIdentity): ApiChangeBaseline | null {
  if (!raw || serializedByteLength(raw) > API_CHANGE_BASELINE_MAX_BYTES) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== API_CHANGE_BASELINE_VERSION) return null;
    if (!validIdentity(parsed.document) || !sameIdentity(parsed.document, identity)) return null;
    if (!isRecord(parsed.operations)) return null;

    const entries = Object.entries(parsed.operations);
    if (entries.length > MAX_OPERATION_COUNT) return null;
    const operations = emptyFingerprintMap();
    for (const [key, value] of entries) {
      if (
        !key ||
        key.length > MAX_OPERATION_IDENTITY_LENGTH ||
        typeof value !== 'string' ||
        !SHA256_FINGERPRINT.test(value)
      ) {
        return null;
      }
      operations[key] = value;
    }

    return {
      version: API_CHANGE_BASELINE_VERSION,
      document: { ...parsed.document },
      operations,
    };
  } catch {
    return null;
  }
}

export function serializeApiChangeBaseline(baseline: ApiChangeBaseline): string | null {
  const serialized = stableSerializeJson(baseline);
  return serializedByteLength(serialized) <= API_CHANGE_BASELINE_MAX_BYTES ? serialized : null;
}

export function createApiChangeBaseline(
  identity: ApiDocumentIdentity,
  fingerprints: ApiOperationFingerprintMap,
): ApiChangeBaseline {
  return {
    version: API_CHANGE_BASELINE_VERSION,
    document: { ...identity },
    operations: copyFingerprints(fingerprints),
  };
}

export function compareApiChangeBaseline(
  baseline: ApiChangeBaseline,
  fingerprints: ApiOperationFingerprintMap,
): ApiChangeStatusMap {
  const statuses = emptyStatusMap();
  Object.entries(fingerprints).forEach(([key, fingerprint]) => {
    if (!hasOwn(baseline.operations, key)) {
      statuses[key] = 'added';
    } else if (baseline.operations[key] !== fingerprint) {
      statuses[key] = 'changed';
    }
  });
  return statuses;
}

export function reconcileApiChangeBaseline(
  identity: ApiDocumentIdentity,
  fingerprints: ApiOperationFingerprintMap,
  rawBaseline: string | null,
): ApiChangeReconciliation {
  const existing = parseApiChangeBaseline(rawBaseline, identity);
  if (!existing) {
    return {
      baseline: createApiChangeBaseline(identity, fingerprints),
      statuses: emptyStatusMap(),
      initialized: true,
    };
  }
  return {
    baseline: existing,
    statuses: compareApiChangeBaseline(existing, fingerprints),
    initialized: false,
  };
}

export function acknowledgeApiOperation(
  baseline: ApiChangeBaseline,
  fingerprints: ApiOperationFingerprintMap,
  method: string,
  path: string,
): ApiChangeBaseline {
  const key = apiOperationIdentity(method, path);
  const fingerprint = fingerprints[key];
  if (!fingerprint || baseline.operations[key] === fingerprint) return baseline;

  return {
    ...baseline,
    operations: { ...baseline.operations, [key]: fingerprint },
  };
}

export function acknowledgeAllApiOperations(
  identity: ApiDocumentIdentity,
  fingerprints: ApiOperationFingerprintMap,
): ApiChangeBaseline {
  return createApiChangeBaseline(identity, fingerprints);
}

export function summarizeApiChanges(statuses: ApiChangeStatusMap): ApiChangeSummary {
  let added = 0;
  let changed = 0;
  Object.values(statuses).forEach((status) => {
    if (status === 'added') added += 1;
    else changed += 1;
  });
  return { added, changed, total: added + changed };
}
