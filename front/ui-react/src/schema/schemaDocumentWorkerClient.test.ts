import { afterEach, expect, test, vi } from 'vitest';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import { evaluateSchemaDocumentDirectionally, registeredSchemaDocument } from './schemaDocumentSession';
import { SchemaDocumentWorkerRuntime, createWorkerSchemaDocumentSession } from './schemaDocumentWorkerClient';
import { SchemaDocumentWorkerHandler } from './schemaDocumentWorkerRuntime';
import type { SchemaWorkerRequest, SchemaWorkerResponse } from './schemaDocumentWorkerProtocol';
import { generateSchemaExample } from './schemaExampleGeneration';
import type { SwaggerDoc } from '../types/swagger';

const sessions: SchemaDocumentSession[] = [];
const runtimes: SchemaDocumentWorkerRuntime[] = [];
const document = (value = 'value'): SwaggerDoc => ({
  openapi: '3.1.1',
  info: { title: 'Worker registry', version: '1' },
  paths: {},
  components: { schemas: { Value: { type: 'object', properties: { id: { const: value } }, required: ['id'] } } },
});
const uri = 'https://examples.knife4j.test/service/openapi.json';
const reference = '#/components/schemas/Value';

class FakeWorker {
  public onmessage: ((event: MessageEvent<SchemaWorkerResponse>) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onmessageerror: (() => void) | null = null;
  public readonly handler = new SchemaDocumentWorkerHandler();
  public readonly requests: SchemaWorkerRequest[] = [];
  public terminated = false;
  public holdGeneration = false;
  public holdOpen = false;
  public pendingOpen: (() => Promise<void>) | null = null;
  public pendingMessage: (() => void) | null = null;

  public postMessage(request: SchemaWorkerRequest): void {
    this.requests.push(structuredClone(request));
    const listener = this.onmessage;
    if (this.holdOpen && request.command.method === 'open') {
      this.pendingOpen = async () => {
        listener?.({ data: await this.handler.handle(request) } as MessageEvent<SchemaWorkerResponse>);
      };
      return;
    }
    if (this.holdGeneration && request.command.method === 'generate') {
      this.pendingMessage = () =>
        listener?.({
          data: { id: request.id, sourceId: request.sourceId, result: null },
        } as MessageEvent<SchemaWorkerResponse>);
      return;
    }
    void this.handler.handle(request).then((result) => {
      if (!this.terminated) listener?.({ data: structuredClone(result) } as MessageEvent<SchemaWorkerResponse>);
    });
  }

  public terminate(): void {
    this.terminated = true;
    this.handler.dispose();
  }
}

function runtime() {
  const workers: FakeWorker[] = [];
  const value = new SchemaDocumentWorkerRuntime(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  runtimes.push(value);
  return { value, workers };
}

async function session(value: SchemaDocumentWorkerRuntime, doc = document()) {
  const result = await createWorkerSchemaDocumentSession(doc, uri, { runtime: value });
  sessions.push(result);
  return result;
}

afterEach(() => {
  sessions.splice(0).forEach((value) => value.dispose());
  runtimes.splice(0).forEach((value) => value.dispose());
  vi.useRealTimers();
});

test('executes complete generation in the registry realm and retains immutable registered documents', async () => {
  const { value, workers } = runtime();
  const original = document();
  const current = await session(value, original);
  original.info.title = 'mutated';
  expect((registeredSchemaDocument(current, uri) as SwaggerDoc).info.title).toBe('Worker registry');
  await expect(generateSchemaExample(current, reference, { direction: 'response' })).resolves.toMatchObject({
    status: 'value',
    value: { id: 'value' },
    validation: 'valid',
    authored: false,
  });
  expect(workers).toHaveLength(1);
  expect(workers[0].requests.map((request) => request.command.method)).toEqual(['open', 'generate']);
  expect(workers[0].requests[1].source).toBeUndefined();
  current.dispose();
  expect(registeredSchemaDocument(current, uri)).toBeUndefined();
  expect(workers[0].terminated).toBe(true);
});

test('serializes concurrent resolve/evaluation RPCs instead of cancelling other field consumers', async () => {
  const { value, workers } = runtime();
  const current = await session(value);
  const results = await Promise.all([
    current.resolve(reference),
    current.evaluate(reference, { id: 'value' }),
    evaluateSchemaDocumentDirectionally(current, reference, { id: 'value' }, 'response'),
    generateSchemaExample(current, reference, { direction: 'request' }),
  ]);
  expect(results[0]).toHaveProperty('canonicalUri');
  expect(results[1]).toMatchObject({ valid: true });
  expect(results[2]).toMatchObject({ valid: true });
  expect(results[3]).toMatchObject({ status: 'value', validation: 'valid' });
  expect(workers).toHaveLength(1);
});

test('binds the same frozen source even if the caller mutates its input while the worker is opening', async () => {
  const { value } = runtime();
  const original = document('before');
  const pending = session(value, original);
  original.info.title = 'changed while opening';
  original.components!.schemas!.Value = { const: 'after' };
  const current = await pending;
  expect((registeredSchemaDocument(current, uri) as SwaggerDoc).info.title).toBe('Worker registry');
  await expect(generateSchemaExample(current, reference, { direction: 'response' })).resolves.toMatchObject({
    value: { id: 'before' },
  });
});

test('preserves retrieval identities, external resource snapshots and reopens after switching sources', async () => {
  const { value, workers } = runtime();
  const firstDoc = document();
  firstDoc.components!.schemas!.Value = { $ref: './shared.json#/$defs/Value' };
  const first = await createWorkerSchemaDocumentSession(firstDoc, uri, {
    runtime: value,
    resourceDocuments: [
      {
        retrievalUri: 'https://examples.knife4j.test/service/shared.json',
        document: { $defs: { Value: { const: 'external' } } },
      },
    ],
  });
  sessions.push(first);
  await expect(generateSchemaExample(first, reference, { direction: 'response' })).resolves.toMatchObject({
    status: 'value',
    value: 'external',
  });
  const second = await session(value, document('second'));
  await expect(generateSchemaExample(second, reference, { direction: 'response' })).resolves.toMatchObject({
    value: { id: 'second' },
  });
  await expect(generateSchemaExample(first, reference, { direction: 'response' })).resolves.toMatchObject({
    value: 'external',
  });
  expect(workers).toHaveLength(1);
});

test('cancels a blocked job, ignores its late reply and restores the exact source before queued work', async () => {
  const { value, workers } = runtime();
  const current = await session(value);
  workers[0].holdGeneration = true;
  const controller = new AbortController();
  const cancelled = generateSchemaExample(current, reference, { direction: 'request', signal: controller.signal });
  const queued = current.resolve(reference);
  const late = workers[0].pendingMessage;
  const assertion = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  late?.();
  await assertion;
  await expect(queued).resolves.toHaveProperty('canonicalUri');
  expect(workers[0].terminated).toBe(true);
  expect(workers).toHaveLength(2);
  expect(workers[1].requests[0].source?.retrievalUri).toBe(uri);
});

test('disposal cancels pending and active operations and never reuses a revoked source', async () => {
  const { value, workers } = runtime();
  const current = await session(value);
  workers[0].holdGeneration = true;
  const first = expect(generateSchemaExample(current, reference, { direction: 'request' })).rejects.toMatchObject({
    name: 'AbortError',
  });
  const second = expect(current.resolve(reference)).rejects.toMatchObject({ name: 'AbortError' });
  current.dispose();
  await Promise.all([first, second]);
  await expect(current.resolve(reference)).rejects.toMatchObject({ name: 'AbortError' });
  expect(workers[0].terminated).toBe(true);
});

test('disposing the previous source cannot terminate a different source that is already opening', async () => {
  const { value, workers } = runtime();
  const first = await session(value, document('first'));
  const worker = workers[0];
  worker.holdOpen = true;
  const pending = session(value, document('second')).catch((error: unknown) => error);
  first.dispose();
  expect(worker.terminated).toBe(false);
  await worker.pendingOpen?.();
  const second = (await pending) as SchemaDocumentSession;
  await expect(generateSchemaExample(second, reference, { direction: 'response' })).resolves.toMatchObject({
    value: { id: 'second' },
  });
});

test('does not start a cancelled initializer and gives actionable Worker/CSP failure without a local fallback', async () => {
  let calls = 0;
  const value = new SchemaDocumentWorkerRuntime(() => {
    calls++;
    throw new Error('CSP');
  });
  runtimes.push(value);
  const controller = new AbortController();
  controller.abort();
  await expect(
    createWorkerSchemaDocumentSession(document(), uri, { runtime: value, signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls).toBe(0);
  await expect(createWorkerSchemaDocumentSession(document(), uri, { runtime: value })).rejects.toMatchObject({
    name: 'SchemaExampleWorkerUnavailableError',
    message: expect.stringContaining('CSP worker-src'),
  });
  expect(calls).toBe(1);
});

test('deadline includes FIFO waiting; generated values stop and authored values remain unavailable, never forged valid', async () => {
  const { value, workers } = runtime();
  const current = await session(value);
  workers[0].holdGeneration = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const generated = generateSchemaExample(current, reference, { direction: 'response' });
  const authored = generateSchemaExample(current, reference, {
    direction: 'response',
    explicit: [{ source: 'media-example', value: 'author' }],
  });
  await vi.advanceTimersByTimeAsync(2001);
  await expect(generated).resolves.toMatchObject({
    status: 'none',
    reason: 'search-budget-exceeded',
    diagnostics: [{ code: 'SEARCH_BUDGET_EXCEEDED' }],
  });
  await expect(authored).resolves.toMatchObject({
    status: 'value',
    value: 'author',
    source: 'media-example',
    validation: 'unavailable',
    authored: true,
  });
  expect(workers[0].terminated).toBe(true);
});

test('reports the real selected schema author before validation and does not replace it on timeout', async () => {
  const { value, workers } = runtime();
  const authoredDocument = document();
  authoredDocument.components!.schemas!.Value = { type: 'integer', examples: ['selected'], default: 5 };
  const current = await session(value, authoredDocument);
  const selected: SchemaWorkerResponse[] = [];
  const handler = new SchemaDocumentWorkerHandler((progress) => selected.push(progress));
  const source = workers[0].requests[0].source!;
  // The existing worker registry must release ownership before testing its actual realm handler.
  current.dispose();
  try {
    const result = await handler.handle({
      id: 1,
      sourceId: source.id,
      source,
      command: { method: 'generate', reference, options: { direction: 'request' } },
    });
    expect(selected).toEqual([
      { id: 1, sourceId: source.id, authored: { source: 'schema-examples', value: 'selected' } },
    ]);
    expect(result).toMatchObject({ result: { status: 'value', validation: 'invalid', value: 'selected' } });
  } finally {
    handler.dispose();
  }
  const next = await session(value, authoredDocument);
  const worker = workers[1];
  worker.holdGeneration = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const pending = generateSchemaExample(next, reference, { direction: 'request' });
  const request = worker.requests.at(-1)!;
  worker.onmessage?.({
    data: { id: request.id, sourceId: request.sourceId, authored: { source: 'schema-examples', value: 'selected' } },
  } as MessageEvent<SchemaWorkerResponse>);
  await vi.advanceTimersByTimeAsync(2001);
  await expect(pending).resolves.toMatchObject({
    status: 'value',
    source: 'schema-examples',
    value: 'selected',
    authored: true,
    validation: 'unavailable',
  });
});
