import { describe, expect, test, vi } from 'vitest';
import {
  createOfflineDocumentSnapshot,
  runOfflineDocumentExportTask,
  type OfflineDocumentSnapshot,
} from './offlineDocumentSnapshot';

function snapshot(incomplete = false): OfflineDocumentSnapshot {
  return createOfflineDocumentSnapshot(
    {
      title: 'Snapshot',
      version: '1',
      description: '',
      tags: [],
    },
    incomplete ? [{ code: 'INCOMPLETE', severity: 'warning' }] : [],
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('offline document snapshot lifecycle', () => {
  test('deep-freezes the shared model and derives completeness from warnings', () => {
    const complete = snapshot();
    const incomplete = snapshot(true);

    expect(complete.complete).toBe(true);
    expect(incomplete.complete).toBe(false);
    expect(Object.isFrozen(complete)).toBe(true);
    expect(Object.isFrozen(complete.document.tags)).toBe(true);
    expect(Object.isFrozen(incomplete.issues[0])).toBe(true);
  });

  test('does not confirm or materialize a stale snapshot', async () => {
    const pending = deferred<OfflineDocumentSnapshot>();
    let current = true;
    const confirmIncomplete = vi.fn(async () => true);
    const materialize = vi.fn(async () => vi.fn());
    const running = runOfflineDocumentExportTask({
      signal: new AbortController().signal,
      isCurrent: () => current,
      buildSnapshot: () => pending.promise,
      confirmIncomplete,
      materialize,
    });

    current = false;
    pending.resolve(snapshot(true));

    await expect(running).resolves.toBe('cancelled');
    expect(confirmIncomplete).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
  });

  test('honors explicit cancellation before materializing an incomplete document', async () => {
    const materialize = vi.fn(async () => vi.fn());
    await expect(
      runOfflineDocumentExportTask({
        signal: new AbortController().signal,
        isCurrent: () => true,
        buildSnapshot: async () => snapshot(true),
        confirmIncomplete: async () => false,
        materialize,
      }),
    ).resolves.toBe('cancelled');
    expect(materialize).not.toHaveBeenCalled();
  });

  test('does not commit a Blob prepared for a superseded document', async () => {
    const pending = deferred<() => void>();
    const commit = vi.fn();
    let current = true;
    const running = runOfflineDocumentExportTask({
      signal: new AbortController().signal,
      isCurrent: () => current,
      buildSnapshot: async () => snapshot(),
      confirmIncomplete: vi.fn(async () => true),
      materialize: () => pending.promise,
    });

    current = false;
    pending.resolve(commit);

    await expect(running).resolves.toBe('cancelled');
    expect(commit).not.toHaveBeenCalled();
  });

  test('commits a current complete snapshot without asking for degradation consent', async () => {
    const confirmIncomplete = vi.fn(async () => true);
    const commit = vi.fn();
    await expect(
      runOfflineDocumentExportTask({
        signal: new AbortController().signal,
        isCurrent: () => true,
        buildSnapshot: async () => snapshot(),
        confirmIncomplete,
        materialize: async () => commit,
      }),
    ).resolves.toBe('downloaded');
    expect(confirmIncomplete).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledOnce();
  });
});
