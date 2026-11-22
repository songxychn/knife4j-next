import type { OfflineDocumentSnapshot } from 'knife4j-core/lib/offlineDocumentSnapshot';

export {
  createOfflineDocumentSnapshot,
  incompleteOfflineDocumentIssues,
  type OfflineDocumentIssue,
  type OfflineDocumentSnapshot,
} from 'knife4j-core/lib/offlineDocumentSnapshot';

export interface OfflineDocumentExportTask {
  readonly signal: AbortSignal;
  isCurrent(): boolean;
  buildSnapshot(): Promise<OfflineDocumentSnapshot>;
  confirmIncomplete(snapshot: OfflineDocumentSnapshot): Promise<boolean>;
  materialize(snapshot: OfflineDocumentSnapshot): Promise<() => void>;
}

export type OfflineDocumentExportTaskResult = 'downloaded' | 'cancelled';

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
