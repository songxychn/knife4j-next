import type { EvaluationIssue, EvaluationResult } from 'knife4j-schema-engine';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import { isOas31SchemaDocument } from './schemaDocumentSession';

type OpenApiRecord = Record<string, unknown>;

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

export interface RequestBodySchemaIssue {
  readonly instanceLocation: string;
  readonly keyword: string;
  readonly absoluteKeywordLocation: string;
}

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

interface LocatedRecord {
  readonly value: OpenApiRecord;
  readonly tokens: readonly string[];
}

type LocatedSchema =
  | { readonly status: 'found'; readonly reference: string }
  | { readonly status: 'none' }
  | { readonly status: 'unavailable' };

function asRecord(value: unknown): OpenApiRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as OpenApiRecord) : null;
}

function decodePointerToken(value: string): string {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function encodePointerToken(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function localPointerTokens(reference: string): string[] | null {
  if (!reference.startsWith('#')) return null;
  let pointer: string;
  try {
    pointer = decodeURIComponent(reference.slice(1));
  } catch {
    return null;
  }
  if (!pointer.startsWith('/')) return null;
  return pointer.slice(1).split('/').map(decodePointerToken);
}

function valueAtPointer(document: SwaggerDoc, tokens: readonly string[]): unknown {
  let current: unknown = document;
  for (const token of tokens) {
    const record = asRecord(current);
    if (!record || !Object.prototype.hasOwnProperty.call(record, token)) return undefined;
    current = record[token];
  }
  return current;
}

function followLocalReference(
  document: SwaggerDoc,
  initialValue: unknown,
  initialTokens: readonly string[],
): LocatedRecord | null {
  let value = asRecord(initialValue);
  let tokens = [...initialTokens];
  const seen = new Set<string>();

  for (let depth = 0; value && typeof value.$ref === 'string' && depth < 10; depth++) {
    if (seen.has(value.$ref)) return null;
    seen.add(value.$ref);
    const targetTokens = localPointerTokens(value.$ref);
    if (!targetTokens) return null;
    value = asRecord(valueAtPointer(document, targetTokens));
    tokens = targetTokens;
  }

  if (!value || typeof value.$ref === 'string') return null;
  return { value, tokens };
}

function pointerReference(tokens: readonly string[]): string {
  return `#/${tokens.map((token) => encodeURIComponent(encodePointerToken(token))).join('/')}`;
}

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

function keywordName(issue: EvaluationIssue): string {
  for (const value of [issue.keyword, issue.absoluteKeywordLocation]) {
    try {
      const url = new URL(value);
      const fragment = url.hash.replace(/^#\/?/, '');
      const fragmentParts = fragment.split('/').filter(Boolean);
      const fragmentName = fragmentParts[fragmentParts.length - 1];
      if (fragmentName) return decodeURIComponent(fragmentName).replace(/~1/g, '/').replace(/~0/g, '~');
      const pathParts = url.pathname.split('/').filter(Boolean);
      const pathName = pathParts[pathParts.length - 1];
      if (pathName) return decodeURIComponent(pathName);
    } catch {
      const parts = value.split(/[/#]/).filter(Boolean);
      const name = parts[parts.length - 1];
      if (name) return name;
    }
  }
  return 'schema';
}

function collectLeafIssues(issues: readonly EvaluationIssue[]): RequestBodySchemaIssue[] {
  const collected: RequestBodySchemaIssue[] = [];
  const seen = new Set<string>();

  const visit = (issue: EvaluationIssue): void => {
    const nested = issue.errors?.filter((candidate) => candidate.valid === false) ?? [];
    if (nested.length > 0) {
      nested.forEach(visit);
      return;
    }
    if (issue.valid !== false) return;
    const keyword = keywordName(issue);
    const key = `${issue.instanceLocation}\u0000${keyword}\u0000${issue.absoluteKeywordLocation}`;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push({
      instanceLocation: issue.instanceLocation,
      keyword,
      absoluteKeywordLocation: issue.absoluteKeywordLocation,
    });
  };

  issues.forEach(visit);
  return collected;
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

  const issues = collectLeafIssues(result.errors);
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
