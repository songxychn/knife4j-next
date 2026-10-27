import type { EvaluationResult, SchemaNode } from 'knife4j-schema-engine';
import type { SwaggerDoc } from '../types/swagger';
import {
  bindSchemaDocumentResources,
  type CreateSchemaDocumentSessionOptions,
  type SchemaDocumentSession,
} from './schemaDocumentSession';
import type { GenerateSchemaExampleOptions, SchemaExampleResult } from './schemaExampleGeneration';
import type { SelectedAuthoredExample } from './schemaExampleAuthored';
import {
  SCHEMA_WORKER_TASK_TIMEOUT_MS,
  type SchemaWorkerCommand,
  type SchemaWorkerRequest,
  type SchemaWorkerResponse,
  type SchemaWorkerSource,
} from './schemaDocumentWorkerProtocol';

const abortError = () => new DOMException('Schema operation was cancelled.', 'AbortError');

class SchemaExampleWorkerTimeoutError extends Error {
  public constructor() {
    super(`Schema Worker reached its ${SCHEMA_WORKER_TASK_TIMEOUT_MS}ms total task deadline.`);
    this.name = 'SchemaExampleWorkerTimeoutError';
  }
}

function unavailableError(): Error {
  const error = new Error(
    'Schema Worker could not start. Serve its module as JavaScript from the UI origin and allow that origin in CSP worker-src and script-src.',
  );
  error.name = 'SchemaExampleWorkerUnavailableError';
  return error;
}

const defaultWorkerFactory = (): Worker =>
  new Worker(new URL('./schemaDocumentWorker.ts', import.meta.url), {
    type: 'module',
    name: 'knife4j-schema-examples',
  });

interface PendingRequest {
  readonly id: number;
  readonly source: SchemaWorkerSource;
  readonly command: SchemaWorkerCommand;
  readonly deadline: number;
  authored?: SelectedAuthoredExample;
  settle(result: unknown, error?: Error): void;
}

/** FIFO is necessary: field projection/export consumers legitimately issue concurrent RPCs. */
export class SchemaDocumentWorkerRuntime {
  private worker: Worker | null = null;
  private boundSource: number | null = null;
  private sequence = 0;
  private active: PendingRequest | null = null;
  private readonly queue: PendingRequest[] = [];

  public constructor(private readonly workerFactory: () => Worker = defaultWorkerFactory) {}

  public request<T>(source: SchemaWorkerSource, command: SchemaWorkerCommand, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cancel = () => entry.settle(undefined, abortError());
      const timeout = setTimeout(
        () => entry.settle(undefined, new SchemaExampleWorkerTimeoutError()),
        SCHEMA_WORKER_TASK_TIMEOUT_MS,
      );
      const entry: PendingRequest = {
        id: ++this.sequence,
        source,
        command,
        deadline: performance.now() + SCHEMA_WORKER_TASK_TIMEOUT_MS,
        settle: (result, error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal?.removeEventListener('abort', cancel);
          const index = this.queue.indexOf(entry);
          if (index >= 0) this.queue.splice(index, 1);
          if (this.active === entry) {
            if (error?.name === 'AbortError' || error instanceof SchemaExampleWorkerTimeoutError) this.terminate();
            this.active = null;
          }
          if (error) {
            const failure =
              entry.authored && error.name !== 'AbortError'
                ? Object.assign(new Error(error.message), error, { name: error.name, authored: entry.authored })
                : error;
            reject(failure);
          } else resolve(result as T);
          queueMicrotask(() => this.pump());
        },
      };
      this.queue.push(entry);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      this.pump();
    });
  }

  public release(sourceId: number): void {
    for (const pending of [...this.queue]) {
      if (pending.source.id === sourceId) pending.settle(undefined, abortError());
    }
    if (this.active?.source.id === sourceId) this.active.settle(undefined, abortError());
    if (this.boundSource === sourceId) this.terminate();
  }

  public dispose(): void {
    for (const pending of [...this.queue]) pending.settle(undefined, abortError());
    this.active?.settle(undefined, abortError());
    this.terminate();
  }

  private terminate(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
    }
    this.worker = null;
    this.boundSource = null;
  }

  private failWorker(): void {
    const error = unavailableError();
    this.terminate();
    this.active?.settle(undefined, error);
    for (const entry of [...this.queue]) entry.settle(undefined, error);
  }

  private pump(): void {
    if (this.active) return;
    const entry = this.queue.shift();
    if (!entry) return;
    if (performance.now() >= entry.deadline) {
      entry.settle(undefined, new SchemaExampleWorkerTimeoutError());
      return;
    }
    this.active = entry;
    try {
      if (!this.worker) {
        this.worker = this.workerFactory();
        this.worker.onmessage = (event: MessageEvent<SchemaWorkerResponse>) => {
          const response = event.data;
          const current = this.active;
          if (!current || response.id !== current.id || response.sourceId !== current.source.id) return;
          if ('authored' in response) current.authored = response.authored;
          if (performance.now() > current.deadline) {
            current.settle(undefined, new SchemaExampleWorkerTimeoutError());
            return;
          }
          if ('authored' in response) return;
          if ('error' in response) {
            const error = Object.assign(new Error(response.error.message), response.error);
            if (current.command.method === 'open') this.terminate();
            current.settle(undefined, error);
          } else {
            this.boundSource = current.source.id;
            current.settle(response.result);
          }
        };
        this.worker.onerror = () => this.failWorker();
        this.worker.onmessageerror = () => this.failWorker();
      }
      const request: SchemaWorkerRequest = {
        id: entry.id,
        sourceId: entry.source.id,
        ...(this.boundSource === entry.source.id ? {} : { source: entry.source }),
        command: entry.command,
      };
      // The posted operation may replace the realm's cached graph before its reply arrives.
      // Releasing the previous source must never terminate that different active operation.
      if (request.source) this.boundSource = null;
      this.worker.postMessage(request);
    } catch {
      this.failWorker();
    }
  }
}

const browserRuntime = new SchemaDocumentWorkerRuntime();
let sourceSequence = 0;

export async function createWorkerSchemaDocumentSession(
  document: SwaggerDoc,
  retrievalUri: string,
  options: CreateSchemaDocumentSessionOptions & { runtime?: SchemaDocumentWorkerRuntime } = {},
): Promise<SchemaDocumentSession> {
  const runtime = options.runtime ?? browserRuntime;
  const source: SchemaWorkerSource = structuredClone({
    id: ++sourceSequence,
    document,
    retrievalUri,
    resourceDocuments: (options.resourceDocuments ?? []).filter((resource) => resource.retrievalUri !== retrievalUri),
    ...(options.registrationContext === undefined ? {} : { registrationContext: options.registrationContext }),
  });
  let disposed = false;
  const request = <T>(command: SchemaWorkerCommand, signal?: AbortSignal): Promise<T> =>
    disposed ? Promise.reject(abortError()) : runtime.request<T>(source, command, signal);
  try {
    await request({ method: 'open' }, options.signal);
  } catch (error) {
    runtime.release(source.id);
    throw error;
  }
  const documents = new Map<string, unknown>([
    [retrievalUri, structuredClone(source.document)],
    ...source.resourceDocuments.map((resource) => [resource.retrievalUri, structuredClone(resource.document)] as const),
  ]);
  let unbind = () => {};
  const session: SchemaDocumentSession = Object.freeze({
    retrievalUri,
    resolve: (reference: string) => request<SchemaNode>({ method: 'resolve', reference }),
    evaluate: (reference: string, instance: unknown, evaluationOptions?: { signal?: AbortSignal }) =>
      request<EvaluationResult>({ method: 'evaluate', reference, instance }, evaluationOptions?.signal),
    evaluateDirectionally: (
      reference: string,
      instance: unknown,
      direction: 'request' | 'response',
      ignoredProperties: readonly string[] | undefined,
      evaluationOptions?: { signal?: AbortSignal },
    ) =>
      request<EvaluationResult>(
        { method: 'directional', reference, instance, direction, ignoredProperties },
        evaluationOptions?.signal,
      ),
    generateExample: async (
      reference: string,
      generateOptions: GenerateSchemaExampleOptions,
    ): Promise<SchemaExampleResult> => {
      const { signal, ...serializableOptions } = generateOptions;
      try {
        return await request<SchemaExampleResult>(
          { method: 'generate', reference, options: serializableOptions },
          signal,
        );
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        const message = error instanceof Error ? error.message : String(error);
        const authored =
          generateOptions.explicit?.[0] ?? (error as Error & { authored?: SelectedAuthoredExample }).authored;
        if (authored) {
          return {
            status: 'value',
            value: structuredClone(authored.value),
            source: authored.source,
            authored: true,
            validation: 'unavailable',
            diagnostics: [{ code: 'EVALUATION_UNAVAILABLE', message }],
          };
        }
        return error instanceof SchemaExampleWorkerTimeoutError
          ? {
              status: 'none',
              reason: 'search-budget-exceeded',
              diagnostics: [{ code: 'SEARCH_BUDGET_EXCEEDED', message }],
            }
          : {
              status: 'none',
              reason: 'evaluation-unavailable',
              diagnostics: [{ code: 'EVALUATION_UNAVAILABLE', message }],
            };
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unbind();
      runtime.release(source.id);
    },
  });
  unbind = bindSchemaDocumentResources(session, documents);
  return session;
}
