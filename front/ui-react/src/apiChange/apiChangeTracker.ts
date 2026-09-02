import { isOpenApi31Version, OPENAPI_HTTP_METHODS } from 'knife4j-core';
import { buildOperationOpenApiDocument } from '../pages/api/operationOpenApiDocument';
import {
  buildOas31OperationOpenApiDocument,
  type Oas31OperationExportBlocker,
} from '../pages/api/oas31OperationOpenApiDocument';
import type { ResourceGraphSnapshot } from '../schema/externalResourceGraph';
import { KNIFE4J_STORAGE_PREFIXES } from '../storage/knife4jStorage';
import type { SwaggerDoc } from '../types/swagger';
import { sha256Hex, stableSerializeJson } from '../utils/stableJson';

export { sha256Hex, stableSerializeJson } from '../utils/stableJson';

const IDENTITY_FIELDS = ['origin', 'applicationPath', 'group', 'apiDocsUrl'] as const;
const MAX_IDENTITY_FIELD_LENGTH = 8 * 1024;
const MAX_OPERATION_IDENTITY_LENGTH = 16 * 1024;
const MAX_OPERATION_COUNT = 10_000;
const SHA256_FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
const RESOURCE_BUDGET_FAILURES = new Set([
  'RESOURCE_TOO_LARGE',
  'GRAPH_RESOURCE_LIMIT',
  'GRAPH_REFERENCE_LIMIT',
  'GRAPH_DEPTH_LIMIT',
  'GRAPH_NODE_LIMIT',
]);

export const API_CHANGE_BASELINE_VERSION = 2;
export const API_CHANGE_BASELINE_MAX_BYTES = 1024 * 1024;
export const OAS30_API_CHANGE_SNAPSHOT_VERSION = 'oas3.0-v1';
export const OAS31_API_CHANGE_SNAPSHOT_VERSION = 'oas3.1-v1';

export type ApiChangeSnapshotVersion =
  typeof OAS30_API_CHANGE_SNAPSHOT_VERSION | typeof OAS31_API_CHANGE_SNAPSHOT_VERSION;

export type ApiChangeUnavailableReason =
  | 'preparing'
  | 'resource-pending'
  | 'resource-budget'
  | 'dialect-unsupported'
  | 'resource-failed'
  | 'snapshot-unavailable'
  | 'version-unsupported';

export interface Oas31ApiChangeEnvironment {
  readonly status: 'preparing' | 'ready' | 'failed';
  readonly retrievalUri: string | null;
  readonly snapshot: ResourceGraphSnapshot | null;
  readonly errorCode?: string;
}

export type ApiChangeFingerprintBuildResult =
  | {
      readonly status: 'ready';
      readonly snapshotVersion: ApiChangeSnapshotVersion;
      readonly fingerprints: ApiOperationFingerprintMap;
    }
  | {
      readonly status: 'unavailable';
      readonly snapshotVersion: ApiChangeSnapshotVersion | null;
      readonly reason: ApiChangeUnavailableReason;
      readonly blockers?: readonly Oas31OperationExportBlocker[];
    };

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
  snapshotVersion: ApiChangeSnapshotVersion;
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function apiOperationIdentity(method: string, path: string): string {
  return JSON.stringify([method.trim().toUpperCase(), path]);
}

export function buildApiChangeBaselineStorageKey(
  identity: ApiDocumentIdentity,
  snapshotVersion: ApiChangeSnapshotVersion,
): string {
  return `${KNIFE4J_STORAGE_PREFIXES.apiVersionBaseline}${sha256Hex(
    stableSerializeJson({ document: identity, snapshotVersion }),
  )}`;
}

function fingerprintOperationDocument(operationDocument: JsonRecord): string {
  const semanticSnapshot = Object.create(null) as JsonRecord;
  Object.entries(operationDocument).forEach(([key, nestedValue]) => {
    if (key !== 'info' && key !== 'openapi') semanticSnapshot[key] = nestedValue;
  });
  return `sha256:${sha256Hex(stableSerializeJson(semanticSnapshot))}`;
}

function buildOas30ApiOperationFingerprints(swaggerDoc: SwaggerDoc): ApiOperationFingerprintMap | null {
  if (typeof swaggerDoc.openapi !== 'string' || !swaggerDoc.openapi.startsWith('3.0.')) return null;

  const canonicalDoc = JSON.parse(stableSerializeJson(swaggerDoc)) as SwaggerDoc;
  const canonicalPaths = canonicalDoc.paths;
  if (!isRecord(canonicalPaths)) return null;

  const fingerprints = emptyFingerprintMap();
  Object.keys(canonicalPaths)
    .sort()
    .forEach((path) => {
      const pathItem = canonicalPaths[path] as unknown;
      if (!isRecord(pathItem)) return;

      OPENAPI_HTTP_METHODS.forEach((method) => {
        if (!isRecord(pathItem[method])) return;
        const operationDocument = buildOperationOpenApiDocument(canonicalDoc, path, method);
        if (!operationDocument) return;
        fingerprints[apiOperationIdentity(method, path)] = fingerprintOperationDocument(operationDocument);
      });
    });

  return fingerprints;
}

function canonicalResourceGraphSnapshot(snapshot: ResourceGraphSnapshot): ResourceGraphSnapshot {
  const canonicalNodes = new Map(
    [...snapshot.nodes.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([uri, node]) => [
        uri,
        {
          ...node,
          document: JSON.parse(stableSerializeJson(node.document)) as unknown,
        },
      ]),
  );
  const canonicalTargets = <T>(targets: ReadonlyMap<string, T>): ReadonlyMap<string, T> =>
    new Map([...targets.entries()].sort(([left], [right]) => compareText(left, right)));
  const canonicalEdges = [...snapshot.edges].sort((left, right) => {
    const leftKey = [left.sourceRetrievalUri, left.sourcePointer, left.kind, left.resolvedUri].join('\n');
    const rightKey = [right.sourceRetrievalUri, right.sourcePointer, right.kind, right.resolvedUri].join('\n');
    return compareText(leftKey, rightKey);
  });
  return {
    ...snapshot,
    nodes: canonicalNodes,
    resourceTargets: canonicalTargets(snapshot.resourceTargets),
    anchorTargets: canonicalTargets(snapshot.anchorTargets),
    edges: canonicalEdges,
  };
}

function graphUnavailableReason(snapshot: ResourceGraphSnapshot): ApiChangeUnavailableReason | null {
  const diagnostics = snapshot.diagnostics.filter((diagnostic) => diagnostic.code !== 'LEGACY_MEDIA_TYPE');
  if (diagnostics.some((diagnostic) => diagnostic.code === 'DIALECT_UNSUPPORTED')) {
    return 'dialect-unsupported';
  }
  if (diagnostics.some((diagnostic) => RESOURCE_BUDGET_FAILURES.has(diagnostic.code))) {
    return 'resource-budget';
  }
  if (
    snapshot.edges.some((edge) => edge.state === 'pending') ||
    diagnostics.some(
      (diagnostic) => diagnostic.code === 'RESOURCE_LOADING_DISABLED' || diagnostic.code === 'RESOURCE_NOT_AUTHORIZED',
    )
  ) {
    return 'resource-pending';
  }
  if (diagnostics.length > 0) return 'resource-failed';
  return snapshot.complete ? null : 'resource-pending';
}

function blockerUnavailableReason(blockers: readonly Oas31OperationExportBlocker[]): ApiChangeUnavailableReason {
  if (blockers.some((blocker) => blocker.code === 'RESOURCE_PENDING')) return 'resource-pending';
  if (blockers.some((blocker) => blocker.code === 'RESOURCE_FAILED')) return 'resource-failed';
  return 'snapshot-unavailable';
}

function unavailable(
  snapshotVersion: ApiChangeSnapshotVersion | null,
  reason: ApiChangeUnavailableReason,
  blockers?: readonly Oas31OperationExportBlocker[],
): ApiChangeFingerprintBuildResult {
  return {
    status: 'unavailable',
    snapshotVersion,
    reason,
    ...(blockers ? { blockers } : {}),
  };
}

function buildOas31ApiOperationFingerprints(
  swaggerDoc: SwaggerDoc,
  environment: Oas31ApiChangeEnvironment | undefined,
): ApiChangeFingerprintBuildResult {
  if (!environment || environment.status === 'preparing') {
    return unavailable(OAS31_API_CHANGE_SNAPSHOT_VERSION, 'preparing');
  }
  if (environment.status === 'failed') {
    const reason =
      environment.errorCode === 'UNSUPPORTED_DIALECT' || environment.errorCode === 'DIALECT_UNSUPPORTED'
        ? 'dialect-unsupported'
        : environment.errorCode && RESOURCE_BUDGET_FAILURES.has(environment.errorCode)
          ? 'resource-budget'
          : 'resource-failed';
    return unavailable(OAS31_API_CHANGE_SNAPSHOT_VERSION, reason);
  }
  if (!environment.retrievalUri || !environment.snapshot) {
    return unavailable(OAS31_API_CHANGE_SNAPSHOT_VERSION, 'snapshot-unavailable');
  }

  const graphReason = graphUnavailableReason(environment.snapshot);
  if (graphReason) return unavailable(OAS31_API_CHANGE_SNAPSHOT_VERSION, graphReason);
  if (environment.snapshot.entryRetrievalUri !== environment.retrievalUri) {
    return unavailable(OAS31_API_CHANGE_SNAPSHOT_VERSION, 'snapshot-unavailable');
  }

  const canonicalDoc = JSON.parse(stableSerializeJson(swaggerDoc)) as SwaggerDoc;
  const canonicalPaths = canonicalDoc.paths;
  if (canonicalPaths !== undefined && !isRecord(canonicalPaths)) {
    return unavailable(OAS31_API_CHANGE_SNAPSHOT_VERSION, 'snapshot-unavailable');
  }
  const canonicalSnapshot = canonicalResourceGraphSnapshot(environment.snapshot);
  const fingerprints = emptyFingerprintMap();

  for (const path of Object.keys(canonicalPaths ?? {}).sort()) {
    const pathItem = canonicalPaths![path] as unknown;
    if (!isRecord(pathItem)) continue;
    for (const method of OPENAPI_HTTP_METHODS) {
      if (!isRecord(pathItem[method])) continue;
      const operationDocument = buildOas31OperationOpenApiDocument(canonicalDoc, path, method, 'path', {
        retrievalUri: environment.retrievalUri,
        snapshot: canonicalSnapshot,
      });
      if (!operationDocument) {
        return unavailable(OAS31_API_CHANGE_SNAPSHOT_VERSION, 'snapshot-unavailable');
      }
      if (operationDocument.status === 'unavailable') {
        return unavailable(
          OAS31_API_CHANGE_SNAPSHOT_VERSION,
          blockerUnavailableReason(operationDocument.blockers),
          operationDocument.blockers,
        );
      }
      fingerprints[apiOperationIdentity(method, path)] = fingerprintOperationDocument(operationDocument.document);
    }
  }

  return {
    status: 'ready',
    snapshotVersion: OAS31_API_CHANGE_SNAPSHOT_VERSION,
    fingerprints,
  };
}

/**
 * Build versioned fingerprints for every executable path operation. OAS 3.1
 * consumes only a fixed, already-loaded graph generation and never owns a
 * loader or fetch path.
 */
export function buildApiChangeFingerprintSnapshot(
  swaggerDoc: SwaggerDoc,
  oas31Environment?: Oas31ApiChangeEnvironment,
): ApiChangeFingerprintBuildResult {
  if (typeof swaggerDoc.openapi === 'string' && swaggerDoc.openapi.startsWith('3.0.')) {
    const fingerprints = buildOas30ApiOperationFingerprints(swaggerDoc);
    return fingerprints
      ? { status: 'ready', snapshotVersion: OAS30_API_CHANGE_SNAPSHOT_VERSION, fingerprints }
      : unavailable(OAS30_API_CHANGE_SNAPSHOT_VERSION, 'snapshot-unavailable');
  }
  if (isOpenApi31Version(swaggerDoc.openapi)) {
    return buildOas31ApiOperationFingerprints(swaggerDoc, oas31Environment);
  }
  return unavailable(null, 'version-unsupported');
}

/** Compatibility wrapper for call sites that only need the ready fingerprint map. */
export function buildApiOperationFingerprints(
  swaggerDoc: SwaggerDoc,
  oas31Environment?: Oas31ApiChangeEnvironment,
): ApiOperationFingerprintMap | null {
  const result = buildApiChangeFingerprintSnapshot(swaggerDoc, oas31Environment);
  return result.status === 'ready' ? result.fingerprints : null;
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

export function parseApiChangeBaseline(
  raw: string | null,
  identity: ApiDocumentIdentity,
  snapshotVersion: ApiChangeSnapshotVersion,
): ApiChangeBaseline | null {
  if (!raw || serializedByteLength(raw) > API_CHANGE_BASELINE_MAX_BYTES) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== API_CHANGE_BASELINE_VERSION) return null;
    if (parsed.snapshotVersion !== snapshotVersion) return null;
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
      snapshotVersion,
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
  snapshotVersion: ApiChangeSnapshotVersion,
  fingerprints: ApiOperationFingerprintMap,
): ApiChangeBaseline {
  return {
    version: API_CHANGE_BASELINE_VERSION,
    snapshotVersion,
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
  snapshotVersion: ApiChangeSnapshotVersion,
  fingerprints: ApiOperationFingerprintMap,
  rawBaseline: string | null,
): ApiChangeReconciliation {
  const existing = parseApiChangeBaseline(rawBaseline, identity, snapshotVersion);
  if (!existing) {
    return {
      baseline: createApiChangeBaseline(identity, snapshotVersion, fingerprints),
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
  snapshotVersion: ApiChangeSnapshotVersion,
  fingerprints: ApiOperationFingerprintMap,
): ApiChangeBaseline {
  return createApiChangeBaseline(identity, snapshotVersion, fingerprints);
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
