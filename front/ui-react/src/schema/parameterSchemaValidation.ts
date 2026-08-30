import type { BuiltParameterInstance, ParamIn } from 'knife4j-core';
import type { EvaluationResult } from 'knife4j-schema-engine';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import { isOas31SchemaDocument } from './schemaDocumentSession';
import {
  asOpenApiRecord as asRecord,
  followLocalReference,
  pointerReference,
  type LocatedRecord,
} from './openApiDocumentPointer';
import { collectLeafSchemaIssues, type SchemaEvaluationIssue } from './schemaEvaluationIssues';

export interface PreparedParameterSchemaEvaluation extends BuiltParameterInstance {
  readonly reference: string;
}

export type ParameterSchemaPreparation =
  | { readonly status: 'skipped'; readonly reason: 'version' | 'no-instances' }
  | {
      readonly status: 'ready';
      readonly evaluations: readonly PreparedParameterSchemaEvaluation[];
      readonly unavailable: readonly BuiltParameterInstance[];
    };

export interface ParameterSchemaIssue extends SchemaEvaluationIssue {
  readonly key: string;
  readonly name: string;
  readonly in: ParamIn;
}

export type ParameterSchemaEvaluation =
  | { readonly status: 'valid' }
  | {
      readonly status: 'invalid';
      readonly issues: readonly ParameterSchemaIssue[];
      readonly totalIssues: number;
    };

interface LocatedParameter extends LocatedRecord {
  readonly key: string;
}

function parameterKey(value: Record<string, unknown>): string | null {
  return typeof value.name === 'string' && typeof value.in === 'string' ? `${value.in}:${value.name}` : null;
}

function collectParameters(
  document: SwaggerDoc,
  values: unknown,
  tokens: readonly string[],
  target: Map<string, LocatedParameter>,
): void {
  if (!Array.isArray(values)) return;
  values.forEach((value, index) => {
    const located = followLocalReference(document, value, [...tokens, String(index)]);
    if (!located) return;
    const key = parameterKey(located.value);
    if (key) target.set(key, { ...located, key });
  });
}

function parametersForOperation(document: SwaggerDoc, operation: MenuOperation): Map<string, LocatedParameter> | null {
  const source = operation.source === 'webhook' ? 'webhooks' : 'paths';
  const sourceItems = source === 'webhooks' ? document.webhooks : document.paths;
  const pathItem = followLocalReference(document, sourceItems?.[operation.path], [source, operation.path]);
  if (!pathItem) return null;

  const method = operation.method.toLowerCase();
  const operationValue = asRecord(pathItem.value[method]);
  if (!operationValue) return null;

  const parameters = new Map<string, LocatedParameter>();
  collectParameters(document, pathItem.value.parameters, [...pathItem.tokens, 'parameters'], parameters);
  // Operation-level parameters override same-name, same-location Path Item parameters.
  collectParameters(document, operationValue.parameters, [...pathItem.tokens, method, 'parameters'], parameters);
  return parameters;
}

function schemaReference(parameter: LocatedParameter): string | null {
  if (Object.prototype.hasOwnProperty.call(parameter.value, 'schema')) {
    return pointerReference([...parameter.tokens, 'schema']);
  }

  const content = asRecord(parameter.value.content);
  if (!content) return null;
  const entries = Object.entries(content);
  if (entries.length !== 1) return null;
  const [mediaType, mediaObjectValue] = entries[0];
  const mediaObject = asRecord(mediaObjectValue);
  if (!mediaObject || !Object.prototype.hasOwnProperty.call(mediaObject, 'schema')) return null;
  return pointerReference([...parameter.tokens, 'content', mediaType, 'schema']);
}

export function prepareParameterSchemaEvaluation(options: {
  readonly document: SwaggerDoc | null;
  readonly operation: MenuOperation | undefined;
  readonly instances: readonly BuiltParameterInstance[] | undefined;
}): ParameterSchemaPreparation {
  const { document, operation, instances } = options;
  if (!isOas31SchemaDocument(document) || !operation) return { status: 'skipped', reason: 'version' };
  if (!instances || instances.length === 0) return { status: 'skipped', reason: 'no-instances' };

  const parameters = parametersForOperation(document, operation);
  if (!parameters) return { status: 'ready', evaluations: [], unavailable: [...instances] };

  const evaluations: PreparedParameterSchemaEvaluation[] = [];
  const unavailable: BuiltParameterInstance[] = [];
  for (const instance of instances) {
    const parameter = parameters.get(instance.key);
    if (!parameter) {
      unavailable.push(instance);
      continue;
    }
    const reference = schemaReference(parameter);
    if (reference) evaluations.push({ ...instance, reference });
  }
  return { status: 'ready', evaluations, unavailable };
}

export async function evaluateParameterSchemas(
  session: SchemaDocumentSession,
  preparation: Extract<ParameterSchemaPreparation, { status: 'ready' }>,
  options: { readonly signal?: AbortSignal; readonly maxIssues?: number } = {},
): Promise<ParameterSchemaEvaluation> {
  const issues: ParameterSchemaIssue[] = [];

  for (const evaluation of preparation.evaluations) {
    if (options.signal?.aborted) return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    const result: EvaluationResult = await session.evaluate(evaluation.reference, evaluation.instance, {
      signal: options.signal,
    });
    if (result.valid) continue;

    const leafIssues = collectLeafSchemaIssues(result.errors);
    const normalizedIssues =
      leafIssues.length > 0
        ? leafIssues
        : [
            {
              instanceLocation: '',
              keyword: 'schema',
              absoluteKeywordLocation: evaluation.reference,
            },
          ];
    issues.push(
      ...normalizedIssues.map((issue) => ({
        ...issue,
        key: evaluation.key,
        name: evaluation.name,
        in: evaluation.in,
      })),
    );
  }

  if (issues.length === 0) return { status: 'valid' };
  const maxIssues = Math.max(1, options.maxIssues ?? 8);
  return { status: 'invalid', issues: issues.slice(0, maxIssues), totalIssues: issues.length };
}

export function parameterInstanceLabel(instanceLocation: string): string {
  return instanceLocation ? `$${instanceLocation}` : '$';
}
