import type { EvaluationResult } from 'knife4j-schema-engine';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import {
  asOpenApiRecord,
  followLocalReference,
  pointerReference,
  type LocatedRecord,
  type OpenApiRecord,
} from './openApiDocumentPointer';
import { isJsonCompatibleMediaType } from './requestBodySchemaValidation';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import { isOas31SchemaDocument } from './schemaDocumentSession';
import { collectLeafSchemaIssues, type SchemaEvaluationIssue } from './schemaEvaluationIssues';

export type ResponseBodySchemaPreparation =
  | {
      readonly status: 'skipped';
      readonly reason: 'version' | 'content-type' | 'empty-body' | 'no-response' | 'no-schema';
    }
  | { readonly status: 'unavailable' }
  | { readonly status: 'invalid-json' }
  | {
      readonly status: 'ready';
      readonly reference: string;
      readonly instance: unknown;
      readonly responseKey: string;
      readonly mediaType: string;
    };

export type ResponseBodySchemaIssue = SchemaEvaluationIssue;

export type ResponseBodySchemaEvaluation =
  | { readonly status: 'valid' }
  | {
      readonly status: 'invalid';
      readonly issues: readonly ResponseBodySchemaIssue[];
      readonly totalIssues: number;
    };

export type ResponseBodySchemaUnavailableReason =
  'engine-inactive' | 'engine-failed' | 'reference-unavailable' | 'budget-rejected' | 'evaluation-failed';

export type ResponseBodySchemaDiagnostic =
  | { readonly status: 'running' }
  | { readonly status: 'invalid-json' }
  | {
      readonly status: 'invalid';
      readonly issues: readonly ResponseBodySchemaIssue[];
      readonly totalIssues: number;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: ResponseBodySchemaUnavailableReason;
      readonly message?: string;
    };

export interface PrepareResponseBodySchemaEvaluationOptions {
  readonly document: SwaggerDoc | null;
  readonly operation: MenuOperation | undefined;
  readonly statusCode: number;
  /** The Content-Type actually returned by the server. */
  readonly contentType: string;
  /** The response body after the existing non-SSE path has read it completely. */
  readonly body: string;
}

type LocatedSchema =
  | {
      readonly status: 'found';
      readonly reference: string;
      readonly responseKey: string;
      readonly mediaType: string;
    }
  | { readonly status: 'none'; readonly reason: 'no-response' | 'no-schema' }
  | { readonly status: 'unavailable' };

const BUDGET_ERROR_CODES = new Set([
  'SCHEMA_BUDGET_EXCEEDED',
  'INSTANCE_BUDGET_EXCEEDED',
  'EVALUATION_BUDGET_EXCEEDED',
]);

const REFERENCE_ERROR_CODES = new Set([
  'INVALID_URI',
  'RESOURCE_NOT_REGISTERED',
  'SCHEMA_RESOLUTION_FAILED',
  'EXTERNAL_RESOURCE_LOADING_DISABLED',
]);

function mediaTypeEssence(value: string): string {
  return value.split(';', 1)[0].trim().toLowerCase();
}

function mediaRangeSpecificity(candidate: string, actual: string): number {
  const candidateParts = mediaTypeEssence(candidate).split('/');
  const actualParts = mediaTypeEssence(actual).split('/');
  if (candidateParts.length !== 2 || actualParts.length !== 2) return -1;

  const [candidateType, candidateSubtype] = candidateParts;
  const [actualType, actualSubtype] = actualParts;
  if (!candidateType || !candidateSubtype || !actualType || !actualSubtype) return -1;
  if (candidateType === '*' && candidateSubtype === '*') return 0;
  if (candidateType !== '*' && candidateSubtype === '*' && candidateType === actualType) return 1;
  if (candidateType.includes('*') || candidateSubtype.includes('*')) return -1;
  return candidateType === actualType && candidateSubtype === actualSubtype ? 2 : -1;
}

/** Select the most specific OAS media type/range for an actual response Content-Type. */
export function responseSchemaMediaTypeKey(content: OpenApiRecord, actualContentType: string): string | null {
  let selected: string | null = null;
  let selectedSpecificity = -1;
  for (const candidate of Object.keys(content)) {
    const specificity = mediaRangeSpecificity(candidate, actualContentType);
    if (specificity > selectedSpecificity) {
      selected = candidate;
      selectedSpecificity = specificity;
    }
  }
  return selected;
}

/** Exact response code wins, followed by the uppercase nXX range, then default. */
export function responseSchemaStatusKey(responses: OpenApiRecord, statusCode: number): string | null {
  const exact = String(statusCode);
  if (Object.prototype.hasOwnProperty.call(responses, exact)) return exact;

  if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) {
    const range = `${Math.floor(statusCode / 100)}XX`;
    if (Object.prototype.hasOwnProperty.call(responses, range)) return range;
  }

  return Object.prototype.hasOwnProperty.call(responses, 'default') ? 'default' : null;
}

function locateOpenApiOperation(document: SwaggerDoc, operation: MenuOperation): LocatedRecord | null {
  const source = operation.source === 'webhook' ? 'webhooks' : 'paths';
  const sourceItems = source === 'webhooks' ? document.webhooks : document.paths;
  const pathItem = followLocalReference(document, sourceItems?.[operation.path], [source, operation.path]);
  if (!pathItem) return null;

  const method = operation.method.toLowerCase();
  const operationValue = asOpenApiRecord(pathItem.value[method]);
  if (!operationValue) return null;
  return { value: operationValue, tokens: [...pathItem.tokens, method] };
}

function locateResponseBodySchema(
  document: SwaggerDoc,
  operation: MenuOperation,
  statusCode: number,
  contentType: string,
): LocatedSchema {
  const locatedOperation = locateOpenApiOperation(document, operation);
  if (!locatedOperation) return { status: 'unavailable' };

  if (!Object.prototype.hasOwnProperty.call(locatedOperation.value, 'responses')) {
    return { status: 'none', reason: 'no-response' };
  }
  const responses = asOpenApiRecord(locatedOperation.value.responses);
  if (!responses) return { status: 'unavailable' };

  const responseKey = responseSchemaStatusKey(responses, statusCode);
  if (!responseKey) return { status: 'none', reason: 'no-response' };

  const responseTokens = [...locatedOperation.tokens, 'responses', responseKey];
  const response = followLocalReference(document, responses[responseKey], responseTokens);
  if (!response) return { status: 'unavailable' };

  const content = asOpenApiRecord(response.value.content);
  if (!content) return { status: 'none', reason: 'no-schema' };
  const mediaType = responseSchemaMediaTypeKey(content, contentType);
  if (!mediaType) return { status: 'none', reason: 'no-schema' };

  const media = asOpenApiRecord(content[mediaType]);
  if (!media || !Object.prototype.hasOwnProperty.call(media, 'schema')) {
    return { status: 'none', reason: 'no-schema' };
  }

  return {
    status: 'found',
    reference: pointerReference([...response.tokens, 'content', mediaType, 'schema']),
    responseKey,
    mediaType,
  };
}

export function prepareResponseBodySchemaEvaluation(
  options: PrepareResponseBodySchemaEvaluationOptions,
): ResponseBodySchemaPreparation {
  const { document, operation, statusCode, contentType, body } = options;
  if (!isOas31SchemaDocument(document) || !operation) return { status: 'skipped', reason: 'version' };
  if (!isJsonCompatibleMediaType(contentType)) return { status: 'skipped', reason: 'content-type' };
  if (body.trim() === '') return { status: 'skipped', reason: 'empty-body' };

  const located = locateResponseBodySchema(document, operation, statusCode, contentType);
  if (located.status !== 'found') {
    return located.status === 'none' ? { status: 'skipped', reason: located.reason } : located;
  }

  try {
    return {
      status: 'ready',
      reference: located.reference,
      instance: JSON.parse(body) as unknown,
      responseKey: located.responseKey,
      mediaType: located.mediaType,
    };
  } catch {
    return { status: 'invalid-json' };
  }
}

export async function evaluateResponseBodySchema(
  session: SchemaDocumentSession,
  preparation: Extract<ResponseBodySchemaPreparation, { status: 'ready' }>,
  options: { readonly signal?: AbortSignal; readonly maxIssues?: number } = {},
): Promise<ResponseBodySchemaEvaluation> {
  const result: EvaluationResult = await session.evaluate(preparation.reference, preparation.instance, {
    signal: options.signal,
  });
  if (result.valid) return { status: 'valid' };

  const issues = collectLeafSchemaIssues(result.errors);
  const normalizedIssues =
    issues.length > 0
      ? issues
      : [
          {
            instanceLocation: '',
            keyword: 'schema',
            absoluteKeywordLocation: preparation.reference,
          },
        ];
  const maxIssues = Math.max(1, options.maxIssues ?? 8);
  return {
    status: 'invalid',
    issues: normalizedIssues.slice(0, maxIssues),
    totalIssues: normalizedIssues.length,
  };
}

function errorCode(reason: unknown): string | undefined {
  return reason && typeof reason === 'object' && 'code' in reason
    ? String((reason as { readonly code?: unknown }).code)
    : undefined;
}

export function isResponseBodySchemaEvaluationAborted(reason: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || errorCode(reason) === 'OPERATION_ABORTED';
}

export function responseBodySchemaFailureDiagnostic(
  reason: unknown,
): Extract<ResponseBodySchemaDiagnostic, { status: 'unavailable' }> {
  const code = errorCode(reason);
  const message = reason instanceof Error ? reason.message : String(reason);
  if (code && BUDGET_ERROR_CODES.has(code)) return { status: 'unavailable', reason: 'budget-rejected' };
  if (code && REFERENCE_ERROR_CODES.has(code)) {
    return { status: 'unavailable', reason: 'reference-unavailable' };
  }
  return { status: 'unavailable', reason: 'evaluation-failed', message };
}

export function responseBodySchemaResultIsCurrent(
  evaluationRequestSequence: number,
  currentRequestSequence: number,
  evaluationDebugCacheKey: string | null,
  currentDebugCacheKey: string | null,
): boolean {
  return evaluationRequestSequence === currentRequestSequence && evaluationDebugCacheKey === currentDebugCacheKey;
}

export function responseBodyInstanceLabel(instanceLocation: string): string {
  return instanceLocation ? `$${instanceLocation}` : '$';
}
