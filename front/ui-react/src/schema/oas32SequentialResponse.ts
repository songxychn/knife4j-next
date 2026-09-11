import type { EvaluationResult } from 'knife4j-schema-engine';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import {
  asOpenApiRecord,
  followLocalReference,
  locateOperationRecord,
  pointerReference,
} from './openApiDocumentPointer';
import {
  locateOperationResponses,
  registeredObjectReference,
  type RegisteredObjectLocation,
} from './registeredResponse';
import { collectLeafSchemaIssues, type SchemaEvaluationIssue } from './schemaEvaluationIssues';
import { evaluateSchemaDocumentDirectionally, type SchemaDocumentSession } from './schemaDocumentSession';
import { responseSchemaMediaTypeKey, responseSchemaStatusKey } from './responseBodySchemaValidation';
import {
  classifyOas32SequentialMedia,
  createOas32SequentialDecoder,
  isOas32SequentialVersion,
  OAS32_SEQUENTIAL_LIMITS,
  type Oas32SequentialDiagnostic,
  type Oas32SequentialKind,
  type Oas32SequentialLimits,
  type Oas32SequentialRecord,
} from './oas32SequentialMedia';

export type Oas32SequentialTermination =
  'eof' | 'cancel' | 'timeout' | 'idle-timeout' | 'budget-bytes' | 'budget-items' | 'network-error';

export type Oas32SequentialSchemaStatus =
  | { readonly status: 'absent' }
  | { readonly status: 'skipped'; readonly reason: 'truncated' | 'not-representable' | 'unavailable' }
  | { readonly status: 'valid' }
  | {
      readonly status: 'invalid';
      readonly issues: readonly SchemaEvaluationIssue[];
      readonly totalIssues: number;
    };

export interface Oas32SequentialItemView {
  readonly record: Oas32SequentialRecord;
  readonly instance: unknown | undefined;
  readonly itemSchema: Oas32SequentialSchemaStatus;
}

export interface Oas32SequentialConsumeResult {
  readonly kind: Oas32SequentialKind | 'unknown';
  readonly termination: Oas32SequentialTermination;
  readonly truncated: boolean;
  readonly receivedBytes: number;
  readonly droppedItems: number;
  readonly items: readonly Oas32SequentialItemView[];
  readonly diagnostics: readonly Oas32SequentialDiagnostic[];
  readonly completeSchema: Oas32SequentialSchemaStatus;
  readonly durationMs: number;
}

export interface Oas32SequentialConsumeLimits extends Oas32SequentialLimits {
  readonly maxMilliseconds: number;
  readonly maxIdleMilliseconds: number;
  readonly maxRetainedItems: number;
}

export const OAS32_SEQUENTIAL_CONSUME_LIMITS: Readonly<Oas32SequentialConsumeLimits> = Object.freeze({
  ...OAS32_SEQUENTIAL_LIMITS,
  maxMilliseconds: 30_000,
  maxIdleMilliseconds: 10_000,
  maxRetainedItems: 128,
});

export interface LocateOas32SequentialSchemasResult {
  readonly responseKey?: string;
  readonly mediaType?: string;
  readonly schemaReference?: string;
  readonly itemSchemaReference?: string;
}

export function shouldConsumeOas32SequentialResponse(isOas32: boolean, contentType: string | undefined): boolean {
  return isOas32 && classifyOas32SequentialMedia(contentType) !== 'unknown';
}

function mediaFieldReference(
  location: RegisteredObjectLocation,
  mediaType: string,
  field: 'schema' | 'itemSchema',
): string | undefined {
  const content = asOpenApiRecord(location.value.content);
  const media = content ? asOpenApiRecord(content[mediaType]) : null;
  if (!media) return undefined;
  const followed = followLocalReference(location.document, media, [...location.tokens, 'content', mediaType]);
  if (followed && Object.prototype.hasOwnProperty.call(followed.value, field)) {
    return `${location.retrievalUri ?? ''}${pointerReference([...followed.tokens, field])}`;
  }
  if (Object.prototype.hasOwnProperty.call(media, field)) {
    return registeredObjectReference(location, ['content', mediaType, field]);
  }
  return undefined;
}

function responseLocation(options: {
  readonly document: SwaggerDoc;
  readonly operation: MenuOperation;
  readonly session?: SchemaDocumentSession;
  readonly statusCode: number;
}): { readonly responseKey: string; readonly location: RegisteredObjectLocation } | { readonly responseKey?: string } {
  const { document, operation, session, statusCode } = options;
  const records = locateOperationResponses(document, operation, session);
  const responses = Object.fromEntries(records.map((record) => [record.statusCode, true]));
  const responseKey = responseSchemaStatusKey(responses, statusCode);
  if (!responseKey) return {};
  const located = records.find((record) => record.statusCode === responseKey)?.location;
  if (located) return { responseKey, location: located };
  const operationRecord = locateOperationRecord(document, operation);
  const operationResponses = operationRecord ? asOpenApiRecord(operationRecord.value.responses) : null;
  const responseValue = operationResponses ? asOpenApiRecord(operationResponses[responseKey]) : null;
  if (!operationRecord || !responseValue) return { responseKey };
  const followed = followLocalReference(document, responseValue, [...operationRecord.tokens, 'responses', responseKey]);
  if (!followed) return { responseKey };
  return {
    responseKey,
    location: {
      value: followed.value,
      document,
      tokens: followed.tokens,
      retrievalUri: session?.retrievalUri,
    },
  };
}

export function locateOas32SequentialSchemas(options: {
  readonly document: SwaggerDoc | null;
  readonly operation: MenuOperation | undefined;
  readonly session?: SchemaDocumentSession;
  readonly statusCode: number;
  readonly contentType: string;
}): LocateOas32SequentialSchemasResult {
  const { document, operation, session, statusCode, contentType } = options;
  if (!document || !isOas32SequentialVersion(document.openapi) || !operation) return {};
  const located = responseLocation({ document, operation, session, statusCode });
  if (!('location' in located) || !located.location)
    return { ...(located.responseKey ? { responseKey: located.responseKey } : {}) };
  const { responseKey, location } = located;
  const content = asOpenApiRecord(location.value.content);
  if (!content) return { responseKey };
  const mediaType = responseSchemaMediaTypeKey(content, contentType);
  if (!mediaType) return { responseKey };
  const schemaReference = mediaFieldReference(location, mediaType, 'schema');
  const itemSchemaReference = mediaFieldReference(location, mediaType, 'itemSchema');
  return {
    responseKey,
    mediaType,
    ...(schemaReference ? { schemaReference } : {}),
    ...(itemSchemaReference ? { itemSchemaReference } : {}),
  };
}

export function sequentialItemInstance(record: Oas32SequentialRecord): unknown | undefined {
  if (record.value.kind === 'sse') return record.value.event;
  if (record.value.kind === 'json') return record.value.json;
  if (record.value.kind === 'multipart') {
    const text = record.value.part.text;
    if (text === undefined) return undefined;
    const contentType = record.value.part.headers['content-type'] ?? '';
    const essence = contentType.split(';', 1)[0].trim().toLowerCase();
    if (essence === 'application/json' || essence.endsWith('+json')) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return undefined;
      }
    }
    return text;
  }
  return undefined;
}

function recordIsRepresentable(item: Oas32SequentialItemView): boolean {
  return item.record.complete && item.instance !== undefined;
}

async function evaluateStatus(
  session: SchemaDocumentSession | undefined,
  reference: string | undefined,
  instance: unknown | undefined,
  signal?: AbortSignal,
): Promise<Oas32SequentialSchemaStatus> {
  if (!reference) return { status: 'absent' };
  if (instance === undefined || !session) return { status: 'skipped', reason: 'unavailable' };
  try {
    const result: EvaluationResult = await evaluateSchemaDocumentDirectionally(
      session,
      reference,
      instance,
      'response',
      {
        signal,
      },
    );
    if (result.valid) return { status: 'valid' };
    const issues = collectLeafSchemaIssues(result.errors);
    return {
      status: 'invalid',
      issues: issues.slice(0, 8),
      totalIssues: issues.length,
    };
  } catch {
    return { status: 'skipped', reason: 'unavailable' };
  }
}

function delay(ms: number, signal: AbortSignal): Promise<'timeout' | 'cancelled'> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve('cancelled');
      return;
    }
    const id = setTimeout(() => resolve('timeout'), ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        resolve('cancelled');
      },
      { once: true },
    );
  });
}

function waitForAbort(signal: AbortSignal): Promise<'abort'> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve('abort');
      return;
    }
    signal.addEventListener('abort', () => resolve('abort'), { once: true });
  });
}

function boundLimits(overrides?: Partial<Oas32SequentialConsumeLimits>): Oas32SequentialConsumeLimits {
  const defaults = OAS32_SEQUENTIAL_CONSUME_LIMITS;
  return {
    maxBytes: Math.min(overrides?.maxBytes ?? defaults.maxBytes, defaults.maxBytes),
    maxItems: Math.min(overrides?.maxItems ?? defaults.maxItems, defaults.maxItems),
    maxRecordCharacters: Math.min(
      overrides?.maxRecordCharacters ?? defaults.maxRecordCharacters,
      defaults.maxRecordCharacters,
    ),
    maxMilliseconds: Math.min(overrides?.maxMilliseconds ?? defaults.maxMilliseconds, defaults.maxMilliseconds),
    maxIdleMilliseconds: Math.min(
      overrides?.maxIdleMilliseconds ?? defaults.maxIdleMilliseconds,
      defaults.maxIdleMilliseconds,
    ),
    maxRetainedItems: Math.min(overrides?.maxRetainedItems ?? defaults.maxRetainedItems, defaults.maxRetainedItems),
  };
}

export async function consumeOas32SequentialResponse(options: {
  readonly response: Response;
  readonly contentType: string;
  readonly document: SwaggerDoc | null;
  readonly operation: MenuOperation | undefined;
  readonly session?: SchemaDocumentSession;
  readonly signal?: AbortSignal;
  readonly limits?: Partial<Oas32SequentialConsumeLimits>;
  readonly now?: () => number;
  readonly onItem?: (item: Oas32SequentialItemView) => void;
}): Promise<Oas32SequentialConsumeResult> {
  const clock = options.now ?? Date.now;
  const started = clock();
  const limits = boundLimits(options.limits);
  const kind = classifyOas32SequentialMedia(options.contentType);
  const schemas = locateOas32SequentialSchemas({
    document: options.document,
    operation: options.operation,
    session: options.session,
    statusCode: options.response.status,
    contentType: options.contentType,
  });
  const decoder = createOas32SequentialDecoder(options.contentType, limits);
  const items: Oas32SequentialItemView[] = [];
  let receivedBytes = 0;
  let droppedItems = 0;
  let acceptedItems = 0;
  let termination: Oas32SequentialTermination = 'eof';

  const accept = async (records: readonly Oas32SequentialRecord[]): Promise<boolean> => {
    let budgetExceeded = false;
    for (const record of records) {
      if (acceptedItems >= limits.maxItems) {
        budgetExceeded = true;
        droppedItems += 1;
        continue;
      }
      acceptedItems += 1;
      const instance = sequentialItemInstance(record);
      const itemSchema = await evaluateStatus(options.session, schemas.itemSchemaReference, instance, options.signal);
      const item: Oas32SequentialItemView = { record, instance, itemSchema };
      if (items.length < limits.maxRetainedItems) {
        items.push(item);
        options.onItem?.(item);
      } else {
        droppedItems += 1;
      }
    }
    if (budgetExceeded) termination = 'budget-items';
    return budgetExceeded;
  };

  const finish = async (reason: Oas32SequentialTermination): Promise<Oas32SequentialConsumeResult> => {
    const truncated = reason !== 'eof' || droppedItems > 0;
    const representable = !truncated && droppedItems === 0 && items.every(recordIsRepresentable);
    let completeSchema: Oas32SequentialSchemaStatus;
    if (!schemas.schemaReference) completeSchema = { status: 'absent' };
    else if (truncated) completeSchema = { status: 'skipped', reason: 'truncated' };
    else if (!representable) completeSchema = { status: 'skipped', reason: 'not-representable' };
    else {
      completeSchema = await evaluateStatus(
        options.session,
        schemas.schemaReference,
        items.map((item) => item.instance),
        options.signal,
      );
    }
    return {
      kind,
      termination: reason,
      truncated,
      receivedBytes,
      droppedItems,
      items,
      diagnostics: items.flatMap((item) => item.record.diagnostics),
      completeSchema,
      durationMs: clock() - started,
    };
  };

  if (options.signal?.aborted) {
    return finish('cancel');
  }
  if (!options.response.body) {
    return finish('network-error');
  }

  const reader = options.response.body.getReader();
  let lastActivity = started;
  const aborted = options.signal ? waitForAbort(options.signal) : undefined;
  try {
    let pendingRead = reader.read();
    for (;;) {
      if (options.signal?.aborted) {
        termination = 'cancel';
        break;
      }
      const now = clock();
      if (now - started > limits.maxMilliseconds) {
        termination = 'timeout';
        break;
      }
      const remainingTotal = limits.maxMilliseconds - (now - started);
      const remainingIdle = limits.maxIdleMilliseconds - (now - lastActivity);
      const wait = Math.max(1, Math.min(remainingTotal, remainingIdle));
      const timeout = new AbortController();
      const winner = await Promise.race([
        pendingRead.then((chunk) => ({ type: 'read' as const, chunk })),
        delay(wait, timeout.signal).then((result) =>
          result === 'timeout' ? ({ type: 'timer' as const } as const) : ({ type: 'cancelled' as const } as const),
        ),
        ...(aborted ? [aborted.then(() => ({ type: 'abort' as const }) as const)] : []),
      ]);
      timeout.abort();
      if (winner.type === 'cancelled') continue;
      if (winner.type === 'abort' || options.signal?.aborted) {
        termination = 'cancel';
        await reader.cancel().catch(() => undefined);
        await pendingRead.catch(() => undefined);
        break;
      }
      if (winner.type === 'timer') {
        const later = clock();
        termination = later - started > limits.maxMilliseconds ? 'timeout' : 'idle-timeout';
        await reader.cancel().catch(() => undefined);
        await pendingRead.catch(() => undefined);
        break;
      }
      if (winner.chunk.done) {
        const exceeded = await accept(decoder.flush(false));
        return finish(exceeded ? 'budget-items' : 'eof');
      }
      lastActivity = clock();
      receivedBytes += winner.chunk.value.byteLength;
      if (receivedBytes > limits.maxBytes) {
        termination = 'budget-bytes';
        await reader.cancel().catch(() => undefined);
        await pendingRead.catch(() => undefined);
        break;
      }
      if (await accept(decoder.push(winner.chunk.value))) {
        termination = 'budget-items';
        await reader.cancel().catch(() => undefined);
        await pendingRead.catch(() => undefined);
        break;
      }
      pendingRead = reader.read();
    }
    await accept(decoder.flush(true));
    return finish(termination);
  } catch {
    await reader.cancel().catch(() => undefined);
    await accept(decoder.flush(true));
    return finish(options.signal?.aborted ? 'cancel' : 'network-error');
  }
}
