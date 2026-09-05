import type { JsonValue } from 'knife4j-schema-engine';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import { followRegisteredObject, locateOperationResponses, type RegisteredObjectLocation } from './registeredResponse';
import {
  asOpenApiRecord as asRecord,
  followLocalReference,
  locateOperationRecord,
  pointerReference,
  type OpenApiRecord,
} from './openApiDocumentPointer';
import {
  explicitSchemaExampleWithoutSchema,
  generateSchemaExample,
  type ExplicitSchemaExample,
  type SchemaExampleDirection,
  type SchemaExampleResult,
  type SchemaExampleSearchLimits,
} from './schemaExampleGeneration';

export interface OperationSchemaExampleTarget {
  readonly key: string;
  readonly mediaType: string;
  readonly schemaReference?: string;
  readonly schema?: JsonValue;
  readonly explicit: readonly ExplicitSchemaExample[];
  readonly explicitReferenceUnavailable?: true;
}

export interface ResponseSchemaExampleTarget extends OperationSchemaExampleTarget {
  readonly statusCode: string;
}

export interface SelectedOperationSchemaExample {
  readonly mediaType: string;
  readonly result: SchemaExampleResult;
}

export interface SelectedResponseSchemaExample extends SelectedOperationSchemaExample {
  readonly statusCode: string;
}

export interface OperationSchemaExamples {
  readonly request?: SelectedOperationSchemaExample;
  readonly responses: readonly SelectedResponseSchemaExample[];
}

export interface GenerateOperationSchemaExamplesOptions {
  readonly signal?: AbortSignal;
  readonly limits?: SchemaExampleSearchLimits;
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

interface ExplicitExampleSelection {
  readonly values: readonly ExplicitSchemaExample[];
  readonly referenceUnavailable?: true;
}

function explicitExamples(
  mediaObject: OpenApiRecord,
  document: SwaggerDoc,
  location?: RegisteredObjectLocation,
  session?: SchemaDocumentSession,
): ExplicitExampleSelection {
  if (Object.prototype.hasOwnProperty.call(mediaObject, 'example')) {
    const value = asJsonValue(mediaObject.example);
    if (value !== undefined) return { values: [{ source: 'media-example', value }] };
  }
  const examples = asRecord(mediaObject.examples);
  if (!examples) return { values: [] };
  for (const name in examples) {
    if (!Object.prototype.hasOwnProperty.call(examples, name)) continue;
    const rawExample = examples[name];
    const record = asRecord(rawExample);
    const example =
      location && record
        ? followRegisteredObject(
            { ...location, value: record, tokens: [...location.tokens, 'examples', name] },
            'example',
            session,
          )?.value
        : (followLocalReference(document, rawExample, ['components', 'examples', name])?.value ?? record);
    // A loaded graph need not make every referenced OAS object consumable by
    // the Schema session. Do not silently replace authored data with a sample.
    if (!example && location && typeof record?.$ref === 'string') {
      return { values: [], referenceUnavailable: true };
    }
    if (!example || !Object.prototype.hasOwnProperty.call(example, 'value')) continue;
    const value = asJsonValue(example.value);
    if (value !== undefined) return { values: [{ source: 'example-object', value }] };
  }
  return { values: [] };
}

function mediaTargets(
  document: SwaggerDoc,
  contentValue: unknown,
  contentTokens: readonly string[],
  keyPrefix: string,
  location?: RegisteredObjectLocation,
  session?: SchemaDocumentSession,
): OperationSchemaExampleTarget[] {
  const content = asRecord(contentValue);
  if (!content) return [];
  const targets: OperationSchemaExampleTarget[] = [];
  for (const [mediaType, rawMedia] of Object.entries(content)) {
    const media = asRecord(rawMedia);
    if (!media) continue;
    const schema = asJsonValue(media.schema);
    const schemaReference = Object.prototype.hasOwnProperty.call(media, 'schema')
      ? `${location?.retrievalUri ?? ''}${pointerReference([...contentTokens, mediaType, 'schema'])}`
      : undefined;
    const explicit = explicitExamples(
      media,
      document,
      location ? { ...location, value: media, tokens: [...contentTokens, mediaType] } : undefined,
      session,
    );
    targets.push({
      key: `${keyPrefix}:${mediaType}`,
      mediaType,
      ...(schemaReference === undefined ? {} : { schemaReference }),
      ...(schema === undefined ? {} : { schema }),
      explicit: explicit.values,
      ...(explicit.referenceUnavailable ? { explicitReferenceUnavailable: true } : {}),
    });
  }
  return targets;
}

function preferredTarget<T extends OperationSchemaExampleTarget>(targets: readonly T[]): T | undefined {
  return targets.find((target) => target.mediaType === 'application/json') ?? targets[0];
}

export function locateRequestSchemaExampleTargets(
  document: SwaggerDoc,
  operation: MenuOperation,
): OperationSchemaExampleTarget[] {
  const located = locateOperationRecord(document, operation);
  if (!located || !Object.prototype.hasOwnProperty.call(located.value, 'requestBody')) return [];
  const requestBody = followLocalReference(document, located.value.requestBody, [...located.tokens, 'requestBody']);
  if (!requestBody) return [];
  return mediaTargets(document, requestBody.value.content, [...requestBody.tokens, 'content'], 'request');
}

export function locateResponseSchemaExampleTargets(
  document: SwaggerDoc,
  operation: MenuOperation,
  session?: SchemaDocumentSession,
): ResponseSchemaExampleTarget[] {
  const targets: ResponseSchemaExampleTarget[] = [];
  for (const { statusCode, location: response } of locateOperationResponses(document, operation, session)) {
    if (!response) continue;
    const selected = preferredTarget(
      mediaTargets(
        response.document,
        response.value.content,
        [...response.tokens, 'content'],
        `response:${statusCode}`,
        response,
        session,
      ),
    );
    if (selected) targets.push({ ...selected, statusCode });
  }
  return targets;
}

function noSchemaResult(target: OperationSchemaExampleTarget): SchemaExampleResult {
  const explicit = target.explicit[0];
  if (explicit) return explicitSchemaExampleWithoutSchema(explicit);
  return {
    status: 'none',
    reason: 'schema-unavailable',
    diagnostics: [{ code: 'SCHEMA_UNAVAILABLE' }],
  };
}

function unavailableExampleReference(): SchemaExampleResult {
  return {
    status: 'none',
    reason: 'evaluation-unavailable',
    diagnostics: [{ code: 'EXAMPLE_REFERENCE_UNAVAILABLE' }],
  };
}

export async function generateOperationSchemaExample(
  session: SchemaDocumentSession,
  target: OperationSchemaExampleTarget,
  direction: SchemaExampleDirection,
  options: GenerateOperationSchemaExamplesOptions = {},
): Promise<SchemaExampleResult> {
  if (target.explicitReferenceUnavailable) return unavailableExampleReference();
  if (!target.schemaReference) return noSchemaResult(target);
  return generateSchemaExample(session, target.schemaReference, {
    direction,
    explicit: target.explicit,
    signal: options.signal,
    limits: options.limits,
  });
}

export async function generateOperationSchemaExamples(
  document: SwaggerDoc,
  operation: MenuOperation,
  session: SchemaDocumentSession,
  options: GenerateOperationSchemaExamplesOptions = {},
): Promise<OperationSchemaExamples> {
  const requestTarget = preferredTarget(locateRequestSchemaExampleTargets(document, operation));
  const request = requestTarget
    ? {
        mediaType: requestTarget.mediaType,
        result: await generateOperationSchemaExample(session, requestTarget, 'request', options),
      }
    : undefined;
  const responses: SelectedResponseSchemaExample[] = [];
  for (const target of locateResponseSchemaExampleTargets(document, operation, session)) {
    responses.push({
      statusCode: target.statusCode,
      mediaType: target.mediaType,
      result: await generateOperationSchemaExample(session, target, 'response', options),
    });
  }
  return { ...(request === undefined ? {} : { request }), responses };
}

export function unavailableOperationSchemaExample(
  target: OperationSchemaExampleTarget,
  message?: string,
): SchemaExampleResult {
  if (target.explicitReferenceUnavailable) return unavailableExampleReference();
  const explicit = target.explicit[0];
  if (explicit) {
    return {
      status: 'value',
      value: structuredClone(explicit.value),
      source: explicit.source,
      authored: true,
      validation: 'unavailable',
      diagnostics: [{ code: 'EVALUATION_UNAVAILABLE', ...(message === undefined ? {} : { message }) }],
    };
  }
  return {
    status: 'none',
    reason: 'evaluation-unavailable',
    diagnostics: [{ code: 'EVALUATION_UNAVAILABLE', ...(message === undefined ? {} : { message }) }],
  };
}

export function unavailableOperationSchemaExamples(
  document: SwaggerDoc,
  operation: MenuOperation,
  message?: string,
): OperationSchemaExamples {
  const requestTarget = preferredTarget(locateRequestSchemaExampleTargets(document, operation));
  return {
    ...(requestTarget === undefined
      ? {}
      : {
          request: {
            mediaType: requestTarget.mediaType,
            result: unavailableOperationSchemaExample(requestTarget, message),
          },
        }),
    responses: locateResponseSchemaExampleTargets(document, operation).map((target) => ({
      statusCode: target.statusCode,
      mediaType: target.mediaType,
      result: unavailableOperationSchemaExample(target, message),
    })),
  };
}

export function formatSchemaExampleValue(value: JsonValue, mediaType: string): string {
  const essence = mediaType.split(';', 1)[0].trim().toLowerCase();
  const isJson = essence === 'application/json' || essence.endsWith('+json');
  if (typeof value === 'string' && !isJson) return value;
  return JSON.stringify(value, null, 2);
}
