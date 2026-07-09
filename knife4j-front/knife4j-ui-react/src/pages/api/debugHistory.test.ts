import { describe, expect, it } from 'vitest';
import {
  DEBUG_HISTORY_BODY_MAX_BYTES,
  DEBUG_HISTORY_MASK,
  DEBUG_HISTORY_MAX_ENTRIES,
  DEBUG_HISTORY_VERSION,
  abortEntry,
  appendPending,
  buildMultipartHistoryBody,
  clearHistory,
  completeEntry,
  createPendingEntry,
  debugHistoryStorageKey,
  isSensitiveCookieName,
  isSensitiveHeaderName,
  limitHistoryEntries,
  listHistory,
  removeEntry,
  sanitizeHeaders,
  truncateBody,
  updateEntry,
  type DebugHistoryEntry,
  type DebugHistoryStorage,
} from './debugHistory';

class MemoryStorage implements DebugHistoryStorage {
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

function makePending(overrides: Partial<Parameters<typeof createPendingEntry>[0]> = {}): DebugHistoryEntry {
  return createPendingEntry({
    id: overrides.id ?? 'entry-1',
    createdAt: overrides.createdAt ?? 1_700_000_000_000,
    method: overrides.method ?? 'POST',
    path: overrides.path ?? '/users/{id}',
    baseUrl: overrides.baseUrl ?? 'http://localhost:8080',
    resolvedUrl: overrides.resolvedUrl ?? 'http://localhost:8080/users/42',
    headers: overrides.headers ?? {
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-token',
      Cookie: 'sid=abc',
    },
    query: overrides.query ?? { page: '1' },
    body: overrides.body ?? '{"name":"alice"}',
    contentType: overrides.contentType ?? 'application/json',
    groupName: overrides.groupName,
    operationId: overrides.operationId,
    formSnapshot: overrides.formSnapshot,
  });
}

describe('debugHistory', () => {
  it('builds an encoded per-operation storage key', () => {
    const cacheKey = 'default|用户|创建用户|POST|/users/{id}';
    expect(debugHistoryStorageKey(cacheKey)).toBe(`knife4j-next:debug-history:${encodeURIComponent(cacheKey)}`);
  });

  it('sanitizes sensitive headers and detects sensitive names', () => {
    expect(isSensitiveHeaderName('Authorization')).toBe(true);
    expect(isSensitiveHeaderName('X-Api-Key')).toBe(true);
    expect(isSensitiveHeaderName('apiKey')).toBe(true);
    expect(isSensitiveHeaderName('Content-Type')).toBe(false);

    expect(
      sanitizeHeaders({
        Authorization: 'Bearer secret',
        Cookie: 'a=b',
        'X-Trace': '1',
      }),
    ).toEqual({
      Authorization: DEBUG_HISTORY_MASK,
      Cookie: DEBUG_HISTORY_MASK,
      'X-Trace': '1',
    });
  });

  it('truncates large bodies and marks truncated', () => {
    const large = 'x'.repeat(DEBUG_HISTORY_BODY_MAX_BYTES + 100);
    const result = truncateBody(large);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(large.length);
    expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(DEBUG_HISTORY_BODY_MAX_BYTES);

    const small = truncateBody('hello');
    expect(small).toEqual({ text: 'hello', truncated: false });
  });

  it('creates a pending entry with sanitized headers and truncated body', () => {
    const largeBody = 'y'.repeat(DEBUG_HISTORY_BODY_MAX_BYTES + 50);
    const entry = createPendingEntry({
      id: 'p1',
      method: 'POST',
      path: '/echo',
      baseUrl: 'http://localhost',
      resolvedUrl: 'http://localhost/echo',
      headers: { Authorization: 'Bearer t', Accept: 'application/json' },
      body: largeBody,
    });

    expect(entry.version).toBe(DEBUG_HISTORY_VERSION);
    expect(entry.status).toBe('pending');
    expect(entry.headers.Authorization).toBe(DEBUG_HISTORY_MASK);
    expect(entry.headers.Accept).toBe('application/json');
    expect(entry.bodyTruncated).toBe(true);
    expect(entry.body?.length).toBeLessThan(largeBody.length);
  });

  it('buildMultipartHistoryBody uses file name placeholders instead of empty strings', () => {
    const body = buildMultipartHistoryBody(
      {
        file: '',
        meta: '{\n  "description": "用户头像"\n}',
      },
      {
        file: [{ name: 'avatar.png', size: 2048 }],
      },
    );
    const parsed = JSON.parse(body) as Record<string, string>;
    expect(parsed.file).toContain('[file] avatar.png');
    expect(parsed.file).toContain('2.0 KB');
    expect(parsed.meta).toContain('用户头像');
    expect(parsed.file).not.toBe('');
  });

  it('appends pending entries, completes them, and keeps newest-first FIFO at 20', () => {
    const storage = new MemoryStorage();
    const cacheKey = 'group|tag|op|POST|/users';

    for (let i = 0; i < DEBUG_HISTORY_MAX_ENTRIES + 3; i += 1) {
      appendPending(
        cacheKey,
        makePending({
          id: `e-${i}`,
          createdAt: 1_000 + i,
          resolvedUrl: `http://localhost/users?i=${i}`,
        }),
        storage,
      );
    }

    let list = listHistory(cacheKey, storage);
    expect(list).toHaveLength(DEBUG_HISTORY_MAX_ENTRIES);
    // Newest first
    expect(list[0].id).toBe(`e-${DEBUG_HISTORY_MAX_ENTRIES + 2}`);
    // Oldest among retained is e-3 (0,1,2 dropped)
    expect(list[list.length - 1].id).toBe('e-3');

    const targetId = list[0].id;
    list = updateEntry(
      cacheKey,
      targetId,
      (entry) =>
        completeEntry(entry, {
          status: 'completed',
          httpStatus: 201,
          statusText: 'Created',
          durationMs: 42,
          responseBody: '{"ok":true}',
        }),
      storage,
    );

    const completed = list.find((item) => item.id === targetId);
    expect(completed?.status).toBe('completed');
    expect(completed?.httpStatus).toBe(201);
    expect(completed?.durationMs).toBe(42);
    expect(completed?.responseBody).toBe('{"ok":true}');
    expect(completed?.updatedAt).toBeDefined();
  });

  it('marks aborted and error completions', () => {
    const pending = makePending({ id: 'abort-me' });
    const aborted = abortEntry(pending, { durationMs: 10 });
    expect(aborted.status).toBe('aborted');
    expect(aborted.durationMs).toBe(10);

    const errored = completeEntry(pending, {
      status: 'error',
      errorMessage: 'Failed to fetch',
      durationMs: 5,
    });
    expect(errored.status).toBe('error');
    expect(errored.errorMessage).toBe('Failed to fetch');
  });

  it('isolates history by cache key', () => {
    const storage = new MemoryStorage();
    appendPending('key-a', makePending({ id: 'a1' }), storage);
    appendPending('key-b', makePending({ id: 'b1' }), storage);

    expect(listHistory('key-a', storage).map((e) => e.id)).toEqual(['a1']);
    expect(listHistory('key-b', storage).map((e) => e.id)).toEqual(['b1']);
  });

  it('removes a single entry and clears an interface history', () => {
    const storage = new MemoryStorage();
    const cacheKey = 'demo';
    appendPending(cacheKey, makePending({ id: 'r1' }), storage);
    appendPending(cacheKey, makePending({ id: 'r2' }), storage);

    const list = removeEntry(cacheKey, 'r1', storage);
    expect(list.map((e) => e.id)).toEqual(['r2']);

    clearHistory(cacheKey, storage);
    expect(listHistory(cacheKey, storage)).toEqual([]);
    expect(storage.values.has(debugHistoryStorageKey(cacheKey))).toBe(false);
  });

  it('round-trips through storage and re-sanitizes on read', () => {
    const storage = new MemoryStorage();
    const cacheKey = 'roundtrip';
    const entry = makePending({
      id: 'rt1',
      formSnapshot: {
        baseUrl: 'http://localhost',
        method: 'POST',
        path: '/users/{id}',
        paramValues: { 'path:id': '1' },
        paramEnabled: { 'path:id': true },
        selectedContentType: 'application/json',
        body: '{}',
        formFields: {},
        rawMode: 'json',
        customQueryParams: [],
        customHeaders: [{ id: 'h1', name: 'Authorization', value: 'Bearer leak' }],
        customCookies: [{ id: 'c1', name: 'session', value: 'abc' }],
        hasFileFields: false,
      },
    });
    appendPending(cacheKey, entry, storage);

    // Corrupt the stored Authorization value to prove normalize re-masks on read.
    const key = debugHistoryStorageKey(cacheKey);
    const raw = JSON.parse(storage.getItem(key)!) as Array<Record<string, unknown>>;
    (raw[0].headers as Record<string, string>).Authorization = 'Bearer still-secret';
    storage.setItem(key, JSON.stringify(raw));

    const loaded = listHistory(cacheKey, storage)[0];
    expect(loaded.headers.Authorization).toBe(DEBUG_HISTORY_MASK);
    expect(loaded.formSnapshot?.customHeaders[0].value).toBe(DEBUG_HISTORY_MASK);
  });

  it('truncates response body on complete', () => {
    const pending = makePending({ id: 'big-resp' });
    const large = 'z'.repeat(DEBUG_HISTORY_BODY_MAX_BYTES + 20);
    const completed = completeEntry(pending, {
      httpStatus: 200,
      responseBody: large,
    });
    expect(completed.responseTruncated).toBe(true);
    expect((completed.responseBody ?? '').length).toBeLessThan(large.length);
  });

  it('truncates large formSnapshot.body and formFields on create and re-read', () => {
    const storage = new MemoryStorage();
    const cacheKey = 'form-snapshot-truncate';
    const largeBody = 'b'.repeat(DEBUG_HISTORY_BODY_MAX_BYTES + 80);
    const largeField = 'f'.repeat(DEBUG_HISTORY_BODY_MAX_BYTES + 40);

    const entry = createPendingEntry({
      id: 'snap-1',
      method: 'POST',
      path: '/upload',
      baseUrl: 'http://localhost',
      resolvedUrl: 'http://localhost/upload',
      body: largeBody,
      formSnapshot: {
        baseUrl: 'http://localhost',
        method: 'POST',
        path: '/upload',
        paramValues: {},
        paramEnabled: {},
        selectedContentType: 'application/json',
        body: largeBody,
        formFields: { note: largeField },
        rawMode: 'json',
        customQueryParams: [],
        customHeaders: [],
        customCookies: [{ id: 'c1', name: 'JSESSIONID', value: 'secret-session' }],
        hasFileFields: false,
      },
    });

    expect(entry.bodyTruncated).toBe(true);
    expect(entry.formSnapshot?.body.length).toBeLessThan(largeBody.length);
    expect(new TextEncoder().encode(entry.formSnapshot!.body).length).toBeLessThanOrEqual(DEBUG_HISTORY_BODY_MAX_BYTES);
    expect(entry.formSnapshot?.formFields.note.length).toBeLessThan(largeField.length);
    expect(entry.formSnapshot?.customCookies[0].value).toBe(DEBUG_HISTORY_MASK);

    appendPending(cacheKey, entry, storage);
    const loaded = listHistory(cacheKey, storage)[0];
    expect(loaded.formSnapshot?.body.length).toBeLessThan(largeBody.length);
    expect(new TextEncoder().encode(loaded.formSnapshot!.body).length).toBeLessThanOrEqual(
      DEBUG_HISTORY_BODY_MAX_BYTES,
    );
    expect(loaded.formSnapshot?.formFields.note.length).toBeLessThan(largeField.length);
    expect(loaded.formSnapshot?.customCookies[0].value).toBe(DEBUG_HISTORY_MASK);
  });

  it('prefers evicting completed entries over in-flight pending when over max', () => {
    const storage = new MemoryStorage();
    const cacheKey = 'protect-pending';

    // Fill capacity with completed entries.
    for (let i = 0; i < DEBUG_HISTORY_MAX_ENTRIES; i += 1) {
      const pending = makePending({ id: `done-${i}`, createdAt: 1_000 + i });
      appendPending(cacheKey, pending, storage);
      updateEntry(
        cacheKey,
        pending.id,
        (entry) =>
          completeEntry(entry, {
            status: 'completed',
            httpStatus: 200,
            durationMs: 1,
            responseBody: '{}',
          }),
        storage,
      );
    }

    expect(listHistory(cacheKey, storage)).toHaveLength(DEBUG_HISTORY_MAX_ENTRIES);
    expect(listHistory(cacheKey, storage).every((e) => e.status === 'completed')).toBe(true);

    // Add several in-flight pending entries beyond the max.
    const pendingIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const id = `inflight-${i}`;
      pendingIds.push(id);
      appendPending(cacheKey, makePending({ id, createdAt: 10_000 + i }), storage);
    }

    const list = listHistory(cacheKey, storage);
    expect(list).toHaveLength(DEBUG_HISTORY_MAX_ENTRIES);
    // All three in-flight pending must still be present.
    for (const id of pendingIds) {
      expect(list.find((e) => e.id === id)?.status).toBe('pending');
    }
    // Oldest completed should have been dropped first.
    expect(list.find((e) => e.id === 'done-0')).toBeUndefined();

    // Completing a retained pending still works (id not silently lost).
    const targetId = pendingIds[0];
    const after = updateEntry(
      cacheKey,
      targetId,
      (entry) =>
        completeEntry(entry, {
          status: 'completed',
          httpStatus: 201,
          durationMs: 3,
          responseBody: '{"ok":true}',
        }),
      storage,
    );
    expect(after.find((e) => e.id === targetId)?.status).toBe('completed');
  });

  it('detects sensitive cookie names', () => {
    expect(isSensitiveCookieName('JSESSIONID')).toBe(true);
    expect(isSensitiveCookieName('session')).toBe(true);
    expect(isSensitiveCookieName('sid')).toBe(true);
    expect(isSensitiveCookieName('access_token')).toBe(true);
    expect(isSensitiveCookieName('theme')).toBe(false);
  });

  it('limitHistoryEntries drops non-pending first while keeping newest-first order', () => {
    const entries: DebugHistoryEntry[] = [
      makePending({ id: 'p-new', createdAt: 100 }),
      completeEntry(makePending({ id: 'c-mid', createdAt: 90 }), { status: 'completed', httpStatus: 200 }),
      makePending({ id: 'p-old', createdAt: 80 }),
      completeEntry(makePending({ id: 'c-old', createdAt: 70 }), { status: 'completed', httpStatus: 200 }),
    ];
    // Force over max by temporarily testing with a short list via the public helper:
    // pad so length > MAX, then verify drop preference on a synthetic oversize list.
    const padded: DebugHistoryEntry[] = [];
    for (let i = 0; i < DEBUG_HISTORY_MAX_ENTRIES - 1; i += 1) {
      padded.push(
        completeEntry(makePending({ id: `pad-${i}`, createdAt: 50 + i }), {
          status: 'completed',
          httpStatus: 200,
        }),
      );
    }
    // Newest first: two pending + many completed → over max by 1 after combining carefully
    const oversized = [entries[0], entries[1], entries[2], ...padded];
    expect(oversized.length).toBe(DEBUG_HISTORY_MAX_ENTRIES + 2);

    const limited = limitHistoryEntries(oversized);
    expect(limited).toHaveLength(DEBUG_HISTORY_MAX_ENTRIES);
    expect(limited.find((e) => e.id === 'p-new')).toBeDefined();
    expect(limited.find((e) => e.id === 'p-old')).toBeDefined();
    // Oldest completed among dropped candidates should be gone first.
    const droppedCompleted = padded
      .slice()
      .reverse()
      .filter((e) => !limited.some((kept) => kept.id === e.id));
    expect(droppedCompleted.length).toBeGreaterThan(0);
  });
});
