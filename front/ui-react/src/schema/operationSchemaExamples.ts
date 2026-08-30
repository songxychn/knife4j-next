import type { JsonValue } from 'knife4j-schema-engine';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import {
  explicitSchemaExampleWithoutSchema,
  generateSchemaExample,
  type ExplicitSchemaExample,
  type SchemaExampleDirection,
  type SchemaExampleResult,
  type SchemaExampleSearchLimits,
} from './schemaExampleGeneration';

type OpenApiRecord = Record<string, unknown>;

interface LocatedRecord {
  readonly value: OpenApiRecord;
  readonly tokens: readonly string[];
}

export interface OperationSchemaExampleTarget {
  readonly key: string;
  readonly mediaType: string;
  readonly schemaReference?: string;
  readonly schema?: JsonValue;
  readonly explicit: readonly ExplicitSchemaExample[];
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

function asRecord(value: unknown): OpenApiRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as OpenApiRecord) : null;
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
  for (let depth = 0; value && typeof value.$ref === 'string' && depth < 12; depth += 1) {
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

function locatedOperation(document: SwaggerDoc, operation: MenuOperation): LocatedRecord | null {
  const source = operation.source === 'webhook' ? 'webhooks' : 'paths';
  const sourceItems = source === 'webhooks' ? document.webhooks : document.paths;
  const pathItem = followLocalReference(document, sourceItems?.[operation.path], [source, operation.path]);
  if (!pathItem) return null;
  const method = operation.method.toLowerCase();
  const operationValue = asRecord(pathItem.value[method]);
  return operationValue ? { value: operationValue, tokens: [...pathItem.tokens, method] } : null;
}

function explicitExamples(mediaObject: OpenApiRecord, document: SwaggerDoc): ExplicitSchemaExample[] {
  const values: ExplicitSchemaExample[] = [];
  if (Object.prototype.hasOwnProperty.call(mediaObject, 'example')) {
    const value = asJsonValue(mediaObject.example);
    if (value !== undefined) values.push({ source: 'media-example', value });
  }
  const examples = asRecord(mediaObject.examples);
  if (!examples) return values;
  for (const [name, rawExample] of Object.entries(examples)) {
    const example =
      followLocalReference(document, rawExample, ['components', 'examples', name])?.value ?? asRecord(rawExample);
    if (!example || !Object.prototype.hasOwnProperty.call(example, 'value')) continue;
    const value = asJsonValue(example.value);
    if (value !== undefined) values.push({ source: 'example-object', value });
  }
  return values;
}

function mediaTargets(
  document: SwaggerDoc,
  contentValue: unknown,
  contentTokens: readonly string[],
  keyPrefix: string,
): OperationSchemaExampleTarget[] {
  const content = asRecord(contentValue);
  if (!content) return [];
  const targets: OperationSchemaExampleTarget[] = [];
  for (const [mediaType, rawMedia] of Object.entries(content)) {
    const media = asRecord(rawMedia);
    if (!media) continue;
    const schema = asJsonValue(media.schema);
    const schemaReference = Object.prototype.hasOwnProperty.call(media, 'schema')
      ? pointerReference([...contentTokens, mediaType, 'schema'])
      : undefined;
    targets.push({
      key: `${keyPrefix}:${mediaType}`,
      mediaType,
      ...(schemaReference === undefined ? {} : { schemaReference }),
      ...(schema === undefined ? {} : { schema }),
      explicit: explicitExamples(media, document),
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
  const located = locatedOperation(document, operation);
  if (!located || !Object.prototype.hasOwnProperty.call(located.value, 'requestBody')) return [];
  const requestBody = followLocalReference(document, located.value.requestBody, [...located.tokens, 'requestBody']);
  if (!requestBody) return [];
  return mediaTargets(document, requestBody.value.content, [...requestBody.tokens, 'content'], 'request');
}

export function locateResponseSchemaExampleTargets(
  document: SwaggerDoc,
  operation: MenuOperation,
): ResponseSchemaExampleTarget[] {
  const located = locatedOperation(document, operation);
  const responses = asRecord(located?.value.responses);
  if (!located || !responses) return [];
  const targets: ResponseSchemaExampleTarget[] = [];
  for (const [statusCode, rawResponse] of Object.entries(responses)) {
    const response = followLocalReference(document, rawResponse, [...located.tokens, 'responses', statusCode]);
    if (!response) continue;
    const selected = preferredTarget(
      mediaTargets(document, response.value.content, [...response.tokens, 'content'], `response:${statusCode}`),
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

export async function generateOperationSchemaExample(
  session: SchemaDocumentSession,
  target: OperationSchemaExampleTarget,
  direction: SchemaExampleDirection,
  options: GenerateOperationSchemaExamplesOptions = {},
): Promise<SchemaExampleResult> {
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
  for (const target of locateResponseSchemaExampleTargets(document, operation)) {
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
