import type {
  EvaluationOptions,
  EvaluationResult,
  SchemaEngineErrorCode,
  SchemaEngineErrorDetails,
  SchemaNode,
} from 'knife4j-schema-engine';
import type { SwaggerDoc } from '../types/swagger';

const OAS_31_VERSION = /^3\.1\.\d+(?:-.+)?$/;
const FALLBACK_SCHEMA_ORIGIN = 'https://knife4j.invalid/';

type SchemaEngineModule = typeof import('knife4j-schema-engine');

export interface SchemaDocumentSession {
  readonly retrievalUri: string;
  resolve(reference: string): Promise<SchemaNode>;
  evaluate(reference: string, instance: unknown, options?: EvaluationOptions): Promise<EvaluationResult>;
  dispose(): void;
}

export interface SchemaDocumentFailure {
  readonly code?: SchemaEngineErrorCode;
  readonly message: string;
  readonly details: Readonly<SchemaEngineErrorDetails>;
}

export interface CreateSchemaDocumentSessionOptions {
  signal?: AbortSignal;
  loadEngine?: () => Promise<SchemaEngineModule>;
}

export type SchemaDocumentSessionFactory = (
  document: SwaggerDoc,
  retrievalUri: string,
  options?: CreateSchemaDocumentSessionOptions,
) => Promise<SchemaDocumentSession>;

export type SchemaDocumentOpenResult = { status: 'ready'; session: SchemaDocumentSession } | { status: 'stale' };

class SchemaDocumentSessionAbortedError extends Error {
  public constructor() {
    super('Schema document session initialization was aborted.');
    this.name = 'SchemaDocumentSessionAbortedError';
  }
}

const assertNotAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new SchemaDocumentSessionAbortedError();
};

const defaultEngineLoader = (): Promise<SchemaEngineModule> => import('knife4j-schema-engine');

const fallbackRetrievalUri = (groupName: string): string => {
  const name = groupName.trim() || 'default';
  return new URL(`groups/${encodeURIComponent(name)}/openapi.json`, FALLBACK_SCHEMA_ORIGIN).href;
};

/**
 * Turn the already-loaded api-docs URL into a stable identity for JSON Schema
 * resolution. This URI is only a registry key; it never grants network access.
 */
export function schemaDocumentRetrievalUri(sourceUrl: string, groupName: string, baseHref?: string): string {
  const trimmedSource = sourceUrl.trim();
  if (!trimmedSource) return fallbackRetrievalUri(groupName);

  try {
    const effectiveBase = baseHref?.trim() || globalThis.location?.href || FALLBACK_SCHEMA_ORIGIN;
    const url = new URL(trimmedSource, effectiveBase);
    url.hash = '';
    url.username = '';
    url.password = '';
    return url.href;
  } catch {
    return fallbackRetrievalUri(groupName);
  }
}

export function isOas31SchemaDocument(document: SwaggerDoc | null): document is SwaggerDoc {
  return typeof document?.openapi === 'string' && OAS_31_VERSION.test(document.openapi);
}

export function schemaReferenceUri(retrievalUri: string, reference: string): string {
  try {
    return new URL(reference, retrievalUri).href;
  } catch {
    throw new TypeError(`Schema reference '${reference}' cannot be resolved against '${retrievalUri}'.`);
  }
}

export function toSchemaDocumentFailure(error: unknown): SchemaDocumentFailure {
  if (error instanceof Error) {
    const candidate = error as Error & {
      code?: SchemaEngineErrorCode;
      details?: SchemaEngineErrorDetails;
    };
    return Object.freeze({
      ...(candidate.code === undefined ? {} : { code: candidate.code }),
      message: candidate.message,
      details: Object.freeze({ ...(candidate.details ?? {}) }),
    });
  }
  return Object.freeze({
    message: 'Unable to initialize the JSON Schema document session.',
    details: Object.freeze({}),
  });
}

export async function createSchemaDocumentSession(
  document: SwaggerDoc,
  retrievalUri: string,
  options: CreateSchemaDocumentSessionOptions = {},
): Promise<SchemaDocumentSession> {
  assertNotAborted(options.signal);
  const engineModule = await (options.loadEngine ?? defaultEngineLoader)();
  assertNotAborted(options.signal);

  const engine = engineModule.createSchemaEngine();
  try {
    await engine.registerDocument(document, retrievalUri);
    assertNotAborted(options.signal);
  } catch (error) {
    engine.dispose();
    throw error;
  }

  let disposed = false;
  return Object.freeze({
    retrievalUri,
    resolve: (reference: string) => engine.resolve(schemaReferenceUri(retrievalUri, reference)),
    evaluate: (reference: string, instance: unknown, evaluationOptions?: EvaluationOptions) =>
      engine.evaluate(schemaReferenceUri(retrievalUri, reference), instance, evaluationOptions),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      engine.dispose();
    },
  });
}

/** Owns the single active Hyperjump registry owner used by the React app. */
export class SchemaDocumentSessionManager {
  private revision = 0;
  private current: SchemaDocumentSession | null = null;
  private pending: { controller: AbortController; settled: Promise<void> } | null = null;

  public constructor(private readonly factory: SchemaDocumentSessionFactory = createSchemaDocumentSession) {}

  public open(document: SwaggerDoc, retrievalUri: string): Promise<SchemaDocumentOpenResult> {
    const revision = ++this.revision;
    const previousSettled = this.pending?.settled ?? Promise.resolve();
    this.pending?.controller.abort();
    const controller = new AbortController();
    this.current?.dispose();
    this.current = null;

    const run = async (): Promise<SchemaDocumentOpenResult> => {
      try {
        // Hyperjump's registry is realm-global. Wait for an aborted initializer
        // to release any owner it may already have before starting the next one.
        await previousSettled;
        if (revision !== this.revision || controller.signal.aborted) return { status: 'stale' };

        const session = await this.factory(document, retrievalUri, { signal: controller.signal });
        if (revision !== this.revision || controller.signal.aborted) {
          session.dispose();
          return { status: 'stale' };
        }
        this.current = session;
        return { status: 'ready', session };
      } catch (error) {
        if (revision !== this.revision || controller.signal.aborted) return { status: 'stale' };
        throw error;
      } finally {
        if (this.pending?.controller === controller) this.pending = null;
      }
    };

    const result = run();
    this.pending = {
      controller,
      settled: result.then(
        () => undefined,
        () => undefined,
      ),
    };
    return result;
  }

  public clear(): void {
    this.revision += 1;
    this.pending?.controller.abort();
    this.current?.dispose();
    this.current = null;
  }
}
