import type { ExportDocument } from 'knife4j-core';

export type OfflineDocumentIssueSeverity = 'info' | 'warning';

export interface OfflineDocumentIssue {
  readonly code: string;
  readonly severity: OfflineDocumentIssueSeverity;
  readonly operation?: string;
  readonly region?: string;
  readonly keyword?: string;
}

export interface OfflineDocumentSnapshot {
  readonly document: ExportDocument;
  readonly complete: boolean;
  readonly issues: readonly OfflineDocumentIssue[];
}

export interface OfflineDocumentExportTask {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  buildSnapshot(): Promise<OfflineDocumentSnapshot>;
  confirmIncomplete(snapshot: OfflineDocumentSnapshot): Promise<boolean>;
  materialize(snapshot: OfflineDocumentSnapshot): Promise<() => void>;
}

export type OfflineDocumentExportTaskResult = 'downloaded' | 'cancelled';

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  Reflect.ownKeys(object).forEach((key) => {
    deepFreeze((object as Record<PropertyKey, unknown>)[key], seen);
  });
  return Object.freeze(value);
}

export function createOfflineDocumentSnapshot(
  document: ExportDocument,
  issues: readonly OfflineDocumentIssue[] = [],
): OfflineDocumentSnapshot {
  const snapshot: OfflineDocumentSnapshot = {
    document,
    complete: issues.every((issue) => issue.severity === 'info'),
    issues: issues.map((issue) => ({ ...issue })),
  };
  return deepFreeze(snapshot);
}

export function incompleteOfflineDocumentIssues(snapshot: OfflineDocumentSnapshot): readonly OfflineDocumentIssue[] {
  return snapshot.issues.filter((issue) => issue.severity !== 'info');
}

export async function runOfflineDocumentExportTask(
  task: OfflineDocumentExportTask,
): Promise<OfflineDocumentExportTaskResult> {
  const cancelled = (): boolean => task.signal.aborted || !task.isCurrent();
  const snapshot = await task.buildSnapshot();
  if (cancelled()) return 'cancelled';
  if (!snapshot.complete && !(await task.confirmIncomplete(snapshot))) return 'cancelled';
  if (cancelled()) return 'cancelled';
  const commit = await task.materialize(snapshot);
  if (cancelled()) return 'cancelled';
  commit();
  return 'downloaded';
}
