import type { BuiltParameterInstance, ParamIn } from 'knife4j-core';
import type { EvaluationResult, JsonValue } from 'knife4j-schema-engine';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import { isOas31SchemaDocument } from './schemaDocumentSession';
import {
  asOpenApiRecord as asRecord,
  followLocalReference,
  locateOperationRecord,
  locatePathItemMember,
  pointerReference,
  type LocatedRecord,
} from './openApiDocumentPointer';
import { collectLeafSchemaIssues, type SchemaEvaluationIssue } from './schemaEvaluationIssues';
import type { ExplicitSchemaExample } from './schemaExampleGeneration';

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

export interface OperationParameterSchemaTarget {
  readonly key: string;
  readonly reference: string;
  readonly mediaType: string;
  readonly explicit: readonly ExplicitSchemaExample[];
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
  const operationValue = locateOperationRecord(document, operation);
  if (!operationValue) return null;
  const pathParameters = locatePathItemMember(document, operation, 'parameters');

  const parameters = new Map<string, LocatedParameter>();
  if (pathParameters) collectParameters(document, pathParameters.value, pathParameters.tokens, parameters);
  // Operation-level parameters override same-name, same-location Path Item parameters.
  collectParameters(document, operationValue.value.parameters, [...operationValue.tokens, 'parameters'], parameters);
  return parameters;
}

function asJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const items = value.map(asJsonValue);
    return items.every((item) => item !== undefined) ? (items as JsonValue[]) : undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const entries: Array<[string, JsonValue]> = [];
  for (const [key, item] of Object.entries(record)) {
    const jsonItem = asJsonValue(item);
    if (jsonItem === undefined) return undefined;
    entries.push([key, jsonItem]);
  }
  return Object.fromEntries(entries);
}

function explicitExamples(value: Record<string, unknown>, document: SwaggerDoc): ExplicitSchemaExample[] {
  if (Object.prototype.hasOwnProperty.call(value, 'example')) {
    const example = asJsonValue(value.example);
    if (example !== undefined) return [{ source: 'media-example', value: example }];
  }
  const examples = asRecord(value.examples);
  if (!examples) return [];
  for (const [name, rawExample] of Object.entries(examples)) {
    const example = followLocalReference(document, rawExample, ['components', 'examples', name])?.value;
    if (!example || !Object.prototype.hasOwnProperty.call(example, 'value')) continue;
    const exampleValue = asJsonValue(example.value);
    if (exampleValue !== undefined) return [{ source: 'example-object', value: exampleValue }];
  }
  return [];
}

function schemaTarget(
  parameter: LocatedParameter,
  document: SwaggerDoc,
): Omit<OperationParameterSchemaTarget, 'key'> | null {
  if (Object.prototype.hasOwnProperty.call(parameter.value, 'schema')) {
    return {
      reference: pointerReference([...parameter.tokens, 'schema']),
      mediaType: '',
      explicit: explicitExamples(parameter.value, document),
    };
  }

  const content = asRecord(parameter.value.content);
  if (!content) return null;
  const entries = Object.entries(content);
  if (entries.length !== 1) return null;
  const [mediaType, mediaObjectValue] = entries[0];
  const mediaObject = asRecord(mediaObjectValue);
  if (!mediaObject || !Object.prototype.hasOwnProperty.call(mediaObject, 'schema')) return null;
  return {
    reference: pointerReference([...parameter.tokens, 'content', mediaType, 'schema']),
    mediaType,
    explicit: explicitExamples(mediaObject, document),
  };
}

export function locateOperationParameterSchemaTargets(
  document: SwaggerDoc,
  operation: MenuOperation,
): OperationParameterSchemaTarget[] {
  const parameters = parametersForOperation(document, operation);
  if (!parameters) return [];
  return Array.from(parameters.values()).flatMap((parameter) => {
    const target = schemaTarget(parameter, document);
    return target ? [{ key: parameter.key, ...target }] : [];
  });
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
    const target = schemaTarget(parameter, document);
    if (target) evaluations.push({ ...instance, reference: target.reference });
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
