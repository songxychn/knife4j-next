import type { EvaluationResult } from 'knife4j-schema-engine';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import {
  asOpenApiRecord,
  followLocalReference,
  type LocatedRecord,
  type OpenApiRecord,
} from './openApiDocumentPointer';
import { isJsonCompatibleMediaType } from './requestBodySchemaValidation';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import { isOas31SchemaDocument } from './schemaDocumentSession';
import { collectLeafSchemaIssues, type SchemaEvaluationIssue } from './schemaEvaluationIssues';
import { locateOperationResponses, registeredObjectReference } from './registeredResponse';

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
  /** The active immutable resource registry, when available. */
  readonly session?: SchemaDocumentSession;
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

interface ParsedMediaType {
  readonly type: string;
  readonly subtype: string;
  readonly parameters: ReadonlyMap<string, string>;
}

const MEDIA_TYPE_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

/** HTTP parameter separators do not split a quoted-string or its quoted-pairs. */
function parseMediaType(value: string): ParsedMediaType | null {
  const segments: string[] = [];
  let quoted = false;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9) || code === 127 || code > 255) return null;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === ';') {
      segments.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted || escaped) return null;
  segments.push(value.slice(start).trim());

  const [essence, ...parameterSegments] = segments;
  const parts = essence.split('/');
  if (parts.length !== 2 || !parts.every((part) => MEDIA_TYPE_TOKEN.test(part))) return null;
  const parameters = new Map<string, string>();
  for (const segment of parameterSegments) {
    // RFC 9110 permits an empty parameter after a semicolon.
    if (segment === '') continue;
    const separator = segment.indexOf('=');
    if (separator < 0) return null;
    const name = segment.slice(0, separator).toLowerCase();
    const rawValue = segment.slice(separator + 1);
    if (!MEDIA_TYPE_TOKEN.test(name) || parameters.has(name)) return null;

    let parameterValue: string;
    if (MEDIA_TYPE_TOKEN.test(rawValue)) parameterValue = rawValue;
    else {
      if (!rawValue.startsWith('"') || !rawValue.endsWith('"')) return null;
      parameterValue = '';
      for (let index = 1; index < rawValue.length - 1; index += 1) {
        let character = rawValue[index];
        if (character === '\\') {
          index += 1;
          if (index >= rawValue.length - 1) return null;
          character = rawValue[index];
        } else if (character === '"') return null;
        parameterValue += character;
      }
    }
    // Charset names are case-insensitive. Other values (including profile URIs)
    // retain their case; their media type can assign case-sensitive semantics.
    parameters.set(name, name === 'charset' ? parameterValue.toLowerCase() : parameterValue);
  }
  return { type: parts[0].toLowerCase(), subtype: parts[1].toLowerCase(), parameters };
}

function mediaRangeSpecificity(candidate: ParsedMediaType, actual: ParsedMediaType): number {
  for (const [name, value] of candidate.parameters) {
    if (actual.parameters.get(name) !== value) return -1;
  }

  const { type: candidateType, subtype: candidateSubtype } = candidate;
  const { type: actualType, subtype: actualSubtype } = actual;
  if (candidateType === '*' && candidateSubtype === '*') return 0;
  if (candidateType !== '*' && candidateSubtype === '*' && candidateType === actualType) return 1;
  if (candidateType.includes('*') || candidateSubtype.includes('*')) return -1;
  return candidateType === actualType && candidateSubtype === actualSubtype ? 2 : -1;
}

/** Select the most specific OAS media type/range for an actual response Content-Type. */
export function responseSchemaMediaTypeKey(content: OpenApiRecord, actualContentType: string): string | null {
  const actual = parseMediaType(actualContentType);
  if (!actual || actual.type.includes('*') || actual.subtype.includes('*')) return null;
  let selected: string | null = null;
  let selectedSpecificity = -1;
  let selectedParameterCount = -1;
  for (const candidate of Object.keys(content)) {
    const parsed = parseMediaType(candidate);
    if (!parsed) continue;
    const specificity = mediaRangeSpecificity(parsed, actual);
    if (specificity < 0) continue;
    if (
      specificity > selectedSpecificity ||
      (specificity === selectedSpecificity && parsed.parameters.size > selectedParameterCount)
    ) {
      selected = candidate;
      selectedSpecificity = specificity;
      selectedParameterCount = parsed.parameters.size;
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
  session?: SchemaDocumentSession,
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

  const response = locateOperationResponses(document, operation, session).find(
    (candidate) => candidate.statusCode === responseKey,
  )?.location;
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
    reference: registeredObjectReference(response, ['content', mediaType, 'schema']),
    responseKey,
    mediaType,
  };
}

export function prepareResponseBodySchemaEvaluation(
  options: PrepareResponseBodySchemaEvaluationOptions,
): ResponseBodySchemaPreparation {
  const { document, operation, statusCode, contentType, body, session } = options;
  if (!isOas31SchemaDocument(document) || !operation) return { status: 'skipped', reason: 'version' };
  if (!isJsonCompatibleMediaType(contentType)) return { status: 'skipped', reason: 'content-type' };
  if (body.trim() === '') return { status: 'skipped', reason: 'empty-body' };

  const located = locateResponseBodySchema(document, operation, statusCode, contentType, session);
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
  evaluationSession: SchemaDocumentSession,
  currentSession: SchemaDocumentSession | null,
): boolean {
  return (
    evaluationRequestSequence === currentRequestSequence &&
    evaluationDebugCacheKey === currentDebugCacheKey &&
    evaluationSession === currentSession
  );
}

export function responseBodyInstanceLabel(instanceLocation: string): string {
  return instanceLocation ? `$${instanceLocation}` : '$';
}
