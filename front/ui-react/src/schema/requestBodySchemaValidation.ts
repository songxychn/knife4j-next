import type { EvaluationResult } from 'knife4j-schema-engine';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import { isOas31SchemaDocument } from './schemaDocumentSession';
import { asOpenApiRecord as asRecord, followLocalReference, pointerReference } from './openApiDocumentPointer';
import { collectLeafSchemaIssues, type SchemaEvaluationIssue } from './schemaEvaluationIssues';

export type RequestBodySchemaPreparation =
  | {
      readonly status: 'skipped';
      readonly reason: 'version' | 'content-type' | 'empty-body' | 'no-schema';
    }
  | { readonly status: 'unavailable' }
  | { readonly status: 'invalid-json' }
  | {
      readonly status: 'ready';
      readonly reference: string;
      readonly instance: unknown;
    };

export type RequestBodySchemaIssue = SchemaEvaluationIssue;

export type RequestBodySchemaEvaluation =
  | { readonly status: 'valid' }
  | {
      readonly status: 'invalid';
      readonly issues: readonly RequestBodySchemaIssue[];
      readonly totalIssues: number;
    };

export interface PrepareRequestBodySchemaEvaluationOptions {
  readonly document: SwaggerDoc | null;
  readonly operation: MenuOperation | undefined;
  /** The media key selected from requestBody.content. */
  readonly schemaMediaType: string;
  /** The Content-Type that the built request will actually send. */
  readonly effectiveContentType: string;
  readonly body: string | undefined;
}

type LocatedSchema =
  | { readonly status: 'found'; readonly reference: string }
  | { readonly status: 'none' }
  | { readonly status: 'unavailable' };

export function isJsonCompatibleMediaType(value: string): boolean {
  const essence = value.split(';', 1)[0].trim().toLowerCase();
  if (essence === 'application/json') return true;
  const slash = essence.indexOf('/');
  return slash > 0 && slash < essence.length - 1 && essence.endsWith('+json');
}

export function effectiveRequestContentType(headers: Readonly<Record<string, string>>, fallback = ''): string {
  const header = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type');
  return header?.[1] ?? fallback;
}

function locateRequestBodySchema(document: SwaggerDoc, operation: MenuOperation, mediaType: string): LocatedSchema {
  const source = operation.source === 'webhook' ? 'webhooks' : 'paths';
  const sourceItems = source === 'webhooks' ? document.webhooks : document.paths;
  const pathItemTokens = [source, operation.path];
  const pathItem = followLocalReference(document, sourceItems?.[operation.path], pathItemTokens);
  if (!pathItem) return { status: 'unavailable' };

  const method = operation.method.toLowerCase();
  const operationValue = asRecord(pathItem.value[method]);
  if (!operationValue) return { status: 'unavailable' };
  const operationTokens = [...pathItem.tokens, method];
  if (!Object.prototype.hasOwnProperty.call(operationValue, 'requestBody')) return { status: 'none' };

  const requestBodyTokens = [...operationTokens, 'requestBody'];
  const requestBody = followLocalReference(document, operationValue.requestBody, requestBodyTokens);
  if (!requestBody) return { status: 'unavailable' };

  const content = asRecord(requestBody.value.content);
  const media = content ? asRecord(content[mediaType]) : null;
  if (!media || !Object.prototype.hasOwnProperty.call(media, 'schema')) return { status: 'none' };

  return {
    status: 'found',
    reference: pointerReference([...requestBody.tokens, 'content', mediaType, 'schema']),
  };
}

export function prepareRequestBodySchemaEvaluation(
  options: PrepareRequestBodySchemaEvaluationOptions,
): RequestBodySchemaPreparation {
  const { document, operation, schemaMediaType, effectiveContentType, body } = options;
  if (!isOas31SchemaDocument(document) || !operation) return { status: 'skipped', reason: 'version' };
  if (!isJsonCompatibleMediaType(effectiveContentType)) return { status: 'skipped', reason: 'content-type' };
  if (body === undefined || body.trim() === '') return { status: 'skipped', reason: 'empty-body' };

  const located = locateRequestBodySchema(document, operation, schemaMediaType);
  if (located.status === 'none') return { status: 'skipped', reason: 'no-schema' };
  if (located.status === 'unavailable') return located;

  try {
    return {
      status: 'ready',
      reference: located.reference,
      instance: JSON.parse(body) as unknown,
    };
  } catch {
    return { status: 'invalid-json' };
  }
}

export async function evaluateRequestBodySchema(
  session: SchemaDocumentSession,
  preparation: Extract<RequestBodySchemaPreparation, { status: 'ready' }>,
  options: { readonly signal?: AbortSignal; readonly maxIssues?: number } = {},
): Promise<RequestBodySchemaEvaluation> {
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

export function requestBodyInstanceLabel(instanceLocation: string): string {
  return instanceLocation ? `$${instanceLocation}` : '$';
}

export function consumeRequestBodySchemaOverride(
  pendingRevision: number,
  currentRevision: number,
  pendingDebugCacheKey: string | null,
  currentDebugCacheKey: string | null,
): number | null {
  if (pendingRevision !== currentRevision || pendingDebugCacheKey !== currentDebugCacheKey) return null;
  return currentRevision + 1;
}
