import type { BodyContent, OperationDebugModel } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import type { SchemaExampleResult, SchemaExampleSearchLimits } from '../../schema/schemaExampleGeneration';
import {
  formatSchemaExampleValue,
  generateOperationSchemaExample,
  locateRequestSchemaExampleTargets,
  unavailableOperationSchemaExample,
} from '../../schema/operationSchemaExamples';
import { extractSchemaFields, stringifyDebugValue, type BodyContentDefaults } from './debugDefaultValues';

export interface Oas31DebugBodyExamples {
  readonly defaults: BodyContentDefaults;
  readonly resultByMediaType: Readonly<Record<string, SchemaExampleResult>>;
}

export interface Oas31DebugExampleIdentity {
  readonly retrievalUri: string;
  readonly operationKey: string;
}

export type Oas31DebugExampleState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly identity: Oas31DebugExampleIdentity }
  | {
      readonly status: 'ready';
      readonly identity: Oas31DebugExampleIdentity;
      readonly examples: Oas31DebugBodyExamples;
    }
  | { readonly status: 'error'; readonly identity: Oas31DebugExampleIdentity; readonly message: string };

export interface GenerateOas31DebugBodyExamplesOptions {
  readonly signal?: AbortSignal;
  readonly limits?: SchemaExampleSearchLimits;
}

function blankFormFields(bodyContent: BodyContent): Record<string, string> {
  return Object.fromEntries(extractSchemaFields(bodyContent).map((field) => [field.name, '']));
}

export function emptyOas31BodyContentDefaults(debugModel: OperationDebugModel | null): BodyContentDefaults {
  if (!debugModel) return { bodyByMediaType: {}, formFieldsByMediaType: {} };
  return {
    bodyByMediaType: Object.fromEntries(debugModel.bodyContents.map((content) => [content.mediaType, ''])),
    formFieldsByMediaType: Object.fromEntries(
      debugModel.bodyContents.map((content) => [content.mediaType, blankFormFields(content)]),
    ),
  };
}

function formFieldsFromValue(bodyContent: BodyContent, value: unknown): Record<string, string> {
  const fields = blankFormFields(bodyContent);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fields;
  const record = value as Record<string, unknown>;
  for (const field of extractSchemaFields(bodyContent)) {
    if (field.isFile || !Object.prototype.hasOwnProperty.call(record, field.name)) continue;
    const fieldValue = record[field.name];
    if (fieldValue !== undefined && fieldValue !== null) {
      fields[field.name] = stringifyDebugValue(fieldValue, field.type);
    }
  }
  return fields;
}

function bodyValueFromResult(bodyContent: BodyContent, result: SchemaExampleResult): string {
  if (result.status !== 'value') return '';
  if (bodyContent.category === 'json') return JSON.stringify(result.value, null, 2);
  if (bodyContent.category === 'raw') return formatSchemaExampleValue(result.value, bodyContent.mediaType);
  return '';
}

function missingTargetResult(): SchemaExampleResult {
  return {
    status: 'none',
    reason: 'schema-unavailable',
    diagnostics: [{ code: 'SCHEMA_UNAVAILABLE' }],
  };
}

export async function generateOas31DebugBodyExamples(
  document: SwaggerDoc,
  operation: MenuOperation,
  debugModel: OperationDebugModel,
  session: SchemaDocumentSession,
  options: GenerateOas31DebugBodyExamplesOptions = {},
): Promise<Oas31DebugBodyExamples> {
  const targets = new Map(
    locateRequestSchemaExampleTargets(document, operation).map((target) => [target.mediaType, target]),
  );
  const bodyByMediaType: Record<string, string> = {};
  const formFieldsByMediaType: Record<string, Record<string, string>> = {};
  const resultByMediaType: Record<string, SchemaExampleResult> = {};

  for (const bodyContent of debugModel.bodyContents) {
    if (options.signal?.aborted) {
      const error = new Error('OAS 3.1 debug example generation was aborted.');
      error.name = 'AbortError';
      throw error;
    }
    const target = targets.get(bodyContent.mediaType);
    const result = target
      ? await generateOperationSchemaExample(session, target, 'request', options)
      : missingTargetResult();
    resultByMediaType[bodyContent.mediaType] = result;
    bodyByMediaType[bodyContent.mediaType] = bodyValueFromResult(bodyContent, result);
    formFieldsByMediaType[bodyContent.mediaType] =
      result.status === 'value' ? formFieldsFromValue(bodyContent, result.value) : blankFormFields(bodyContent);
  }

  return {
    defaults: { bodyByMediaType, formFieldsByMediaType },
    resultByMediaType,
  };
}

export function unavailableOas31DebugBodyExamples(
  document: SwaggerDoc,
  operation: MenuOperation,
  debugModel: OperationDebugModel,
  message?: string,
): Oas31DebugBodyExamples {
  const targets = new Map(
    locateRequestSchemaExampleTargets(document, operation).map((target) => [target.mediaType, target]),
  );
  const bodyByMediaType: Record<string, string> = {};
  const formFieldsByMediaType: Record<string, Record<string, string>> = {};
  const resultByMediaType: Record<string, SchemaExampleResult> = {};
  for (const bodyContent of debugModel.bodyContents) {
    const target = targets.get(bodyContent.mediaType);
    const result = target ? unavailableOperationSchemaExample(target, message) : missingTargetResult();
    resultByMediaType[bodyContent.mediaType] = result;
    bodyByMediaType[bodyContent.mediaType] = bodyValueFromResult(bodyContent, result);
    formFieldsByMediaType[bodyContent.mediaType] =
      result.status === 'value' ? formFieldsFromValue(bodyContent, result.value) : blankFormFields(bodyContent);
  }
  return { defaults: { bodyByMediaType, formFieldsByMediaType }, resultByMediaType };
}

export function sameOas31DebugExampleIdentity(
  left: Oas31DebugExampleIdentity | null,
  right: Oas31DebugExampleIdentity | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.retrievalUri === right.retrievalUri &&
    left.operationKey === right.operationKey
  );
}

export function canHydrateOas31DebugDefaults(options: {
  readonly state: Oas31DebugExampleState;
  readonly currentIdentity: Oas31DebugExampleIdentity | null;
  readonly editRevision: number;
  readonly hydratedDebugCacheKey: string | null;
  readonly currentDebugCacheKey: string | null;
  readonly alreadyApplied: boolean;
}): options is typeof options & {
  readonly state: Extract<Oas31DebugExampleState, { status: 'ready' }>;
} {
  return (
    options.state.status === 'ready' &&
    sameOas31DebugExampleIdentity(options.state.identity, options.currentIdentity) &&
    options.editRevision === 0 &&
    options.hydratedDebugCacheKey === options.currentDebugCacheKey &&
    !options.alreadyApplied
  );
}
