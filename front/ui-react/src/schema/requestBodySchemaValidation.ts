import type { EvaluationResult } from 'knife4j-schema-engine';
import type { FormBodyEncodingPlan } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import {
  evaluateSchemaDocumentDirectionallyIgnoringProperties,
  isSchemaEngineDocument,
  type SchemaDocumentSession,
} from './schemaDocumentSession';
import {
  asOpenApiRecord as asRecord,
  followLocalReference,
  locateOperationRecord,
  pointerReference,
} from './openApiDocumentPointer';
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
      readonly ignoredProperties?: readonly string[];
      readonly skipComplete?: boolean;
      readonly itemSchemaReference?: string;
      readonly itemInstances?: readonly unknown[];
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
  /** Logical OAS 3.1 form instance and file/read-only exclusions from the shared encoding plan. */
  readonly formBodyPlan?: FormBodyEncodingPlan;
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

function locateRequestBodySchemaField(
  document: SwaggerDoc,
  operation: MenuOperation,
  mediaType: string,
  field: 'schema' | 'itemSchema',
): LocatedSchema {
  const locatedOperation = locateOperationRecord(document, operation);
  if (!locatedOperation) return { status: 'unavailable' };
  const operationValue = locatedOperation.value;
  const operationTokens = locatedOperation.tokens;
  if (!Object.prototype.hasOwnProperty.call(operationValue, 'requestBody')) return { status: 'none' };

  const requestBodyTokens = [...operationTokens, 'requestBody'];
  const requestBody = followLocalReference(document, operationValue.requestBody, requestBodyTokens);
  if (!requestBody) return { status: 'unavailable' };

  const content = asRecord(requestBody.value.content);
  const media = content ? asRecord(content[mediaType]) : null;
  if (!media || !Object.prototype.hasOwnProperty.call(media, field)) return { status: 'none' };

  return {
    status: 'found',
    reference: pointerReference([...requestBody.tokens, 'content', mediaType, field]),
  };
}

function locateRequestBodySchema(document: SwaggerDoc, operation: MenuOperation, mediaType: string): LocatedSchema {
  return locateRequestBodySchemaField(document, operation, mediaType, 'schema');
}

export function prepareRequestBodySchemaEvaluation(
  options: PrepareRequestBodySchemaEvaluationOptions,
): RequestBodySchemaPreparation {
  const { document, operation, schemaMediaType, effectiveContentType, body, formBodyPlan } = options;
  if (!isSchemaEngineDocument(document) || !operation) return { status: 'skipped', reason: 'version' };
  if (!formBodyPlan && !isJsonCompatibleMediaType(effectiveContentType)) {
    return { status: 'skipped', reason: 'content-type' };
  }
  if (!formBodyPlan && (body === undefined || body.trim() === '')) return { status: 'skipped', reason: 'empty-body' };

  const located = locateRequestBodySchema(document, operation, schemaMediaType);
  const itemLocated = locateRequestBodySchemaField(document, operation, schemaMediaType, 'itemSchema');
  if (located.status === 'unavailable' || itemLocated.status === 'unavailable') return { status: 'unavailable' };
  if (located.status === 'none' && itemLocated.status === 'none') return { status: 'skipped', reason: 'no-schema' };

  let instance: unknown;
  let ignoredProperties: readonly string[] | undefined;
  if (formBodyPlan) {
    instance = formBodyPlan.instance;
    ignoredProperties = formBodyPlan.ignoredProperties;
  } else {
    if (body === undefined) return { status: 'skipped', reason: 'empty-body' };
    try {
      instance = JSON.parse(body) as unknown;
    } catch {
      return { status: 'invalid-json' };
    }
  }

  const itemInstances = Array.isArray(instance) ? instance : undefined;
  if (located.status === 'found') {
    return {
      status: 'ready',
      reference: located.reference,
      instance,
      ...(ignoredProperties ? { ignoredProperties } : {}),
      ...(itemLocated.status === 'found' && itemInstances
        ? { itemSchemaReference: itemLocated.reference, itemInstances }
        : {}),
    };
  }
  return {
    status: 'ready',
    reference: itemLocated.status === 'found' ? itemLocated.reference : '',
    instance,
    skipComplete: true,
    ...(itemLocated.status === 'found' && itemInstances
      ? { itemSchemaReference: itemLocated.reference, itemInstances }
      : {}),
  };
}

export async function evaluateRequestBodySchema(
  session: SchemaDocumentSession,
  preparation: Extract<RequestBodySchemaPreparation, { status: 'ready' }>,
  options: { readonly signal?: AbortSignal; readonly maxIssues?: number } = {},
): Promise<RequestBodySchemaEvaluation> {
  const collected: RequestBodySchemaIssue[] = [];
  const evaluateOne = async (reference: string, instance: unknown, locationPrefix = '') => {
    const result: EvaluationResult =
      preparation.ignoredProperties && preparation.ignoredProperties.length > 0 && locationPrefix === ''
        ? await evaluateSchemaDocumentDirectionallyIgnoringProperties(
            session,
            reference,
            instance,
            'request',
            preparation.ignoredProperties,
            { signal: options.signal },
          )
        : await session.evaluate(reference, instance, { signal: options.signal });
    if (result.valid) return;
    const issues = collectLeafSchemaIssues(result.errors);
    if (issues.length === 0) {
      collected.push({
        instanceLocation: locationPrefix,
        keyword: 'schema',
        absoluteKeywordLocation: reference,
      });
      return;
    }
    for (const issue of issues) {
      collected.push({
        ...issue,
        instanceLocation: `${locationPrefix}${issue.instanceLocation}`,
      });
    }
  };

  if (!preparation.skipComplete) {
    await evaluateOne(preparation.reference, preparation.instance);
  }
  if (preparation.itemSchemaReference && preparation.itemInstances) {
    for (const [index, item] of preparation.itemInstances.entries()) {
      await evaluateOne(preparation.itemSchemaReference, item, `/${index}`);
    }
  }

  if (collected.length === 0) return { status: 'valid' };
  const maxIssues = Math.max(1, options.maxIssues ?? 8);
  return {
    status: 'invalid',
    issues: collected.slice(0, maxIssues),
    totalIssues: collected.length,
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
