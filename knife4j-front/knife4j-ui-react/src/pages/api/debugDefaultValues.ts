import { buildSchemaExample, type BodyContent, type DebugParam, type OperationDebugModel } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';

export type ParamValueMap = Record<string, string>;

type JsonRecord = Record<string, unknown>;

export interface SchemaFieldRow {
  name: string;
  type: string;
  format?: string;
  required: boolean;
  description?: string;
  default?: unknown;
  example?: unknown;
  enum?: unknown[];
  isFile: boolean;
  isMultipleFile: boolean;
  isJson: boolean;
  schema?: JsonRecord;
}

export interface BodyContentDefaults {
  bodyByMediaType: Record<string, string>;
  formFieldsByMediaType: Record<string, Record<string, string>>;
}

export const EMPTY_BODY_CONTENT_DEFAULTS: BodyContentDefaults = {
  bodyByMediaType: {},
  formFieldsByMediaType: {},
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodePointerPart(part: string): string {
  const unescaped = part.replace(/~1/g, '/').replace(/~0/g, '~');
  try {
    return decodeURIComponent(unescaped);
  } catch {
    return unescaped;
  }
}

function resolveLocalRef(ref: string | undefined, doc: SwaggerDoc | JsonRecord): unknown {
  if (!ref?.startsWith('#/')) return undefined;
  let current: unknown = doc;
  for (const part of ref.slice(2).split('/').map(decodePointerPart)) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function resolveRecord(value: unknown, doc: SwaggerDoc | JsonRecord): JsonRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.$ref === 'string') {
    const resolved = resolveLocalRef(value.$ref, doc);
    return isRecord(resolved) ? resolved : value;
  }
  return value;
}

function firstExamplesValue(examples: unknown, doc: SwaggerDoc | JsonRecord): unknown {
  if (!isRecord(examples)) return undefined;
  for (const example of Object.values(examples)) {
    const resolved = resolveRecord(example, doc);
    if (!resolved) {
      if (example !== undefined) return example;
      continue;
    }
    if (resolved.value !== undefined) return resolved.value;
  }
  return undefined;
}

function explicitExampleValue(source: unknown, doc: SwaggerDoc | JsonRecord): unknown {
  const record = resolveRecord(source, doc);
  if (!record) return undefined;
  if (record.example !== undefined) return record.example;
  return firstExamplesValue(record.examples, doc);
}

function schemaExampleValue(schema: unknown, doc: SwaggerDoc | JsonRecord): unknown {
  const resolvedSchema = resolveRecord(schema, doc);
  if (!resolvedSchema) return undefined;
  const explicit = explicitExampleValue(resolvedSchema, doc);
  if (explicit !== undefined) return explicit;
  try {
    return buildSchemaExample(resolvedSchema, {
      doc: doc as unknown as Record<string, unknown>,
      maxDepth: 8,
    });
  } catch {
    return undefined;
  }
}

export function stringifyDebugValue(value: unknown, type?: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if ((type === 'array' || type === 'object') && typeof value === 'string') {
    return value;
  }
  return String(value);
}

function stringifyBodyValue(value: unknown, bodyContent: BodyContent): string {
  if (value === undefined || value === null) return '';
  if (bodyContent.category === 'json') {
    if (typeof value === 'string') {
      const schemaType = isRecord(bodyContent.schema) ? bodyContent.schema.type : undefined;
      return schemaType === 'string' ? JSON.stringify(value, null, 2) : value;
    }
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === 'object') return stringifyDebugValue(value);
  return String(value);
}

export function paramKey(param: DebugParam): string {
  return `${param.in}:${param.name}`;
}

function operationObjectFromDoc(doc: SwaggerDoc, operation: MenuOperation): JsonRecord | undefined {
  const pathItem = doc.paths?.[operation.path] as JsonRecord | undefined;
  const fromDoc = pathItem?.[operation.method.toLowerCase()];
  return resolveRecord(fromDoc, doc) ?? (operation.operation as unknown as JsonRecord);
}

function rawParametersForOperation(doc: SwaggerDoc, operation: MenuOperation): Map<string, JsonRecord> {
  const map = new Map<string, JsonRecord>();
  const pathItem = doc.paths?.[operation.path] as JsonRecord | undefined;
  const operationObject = operationObjectFromDoc(doc, operation);
  const rawParams = [
    ...(Array.isArray(pathItem?.parameters) ? pathItem.parameters : []),
    ...(Array.isArray(operationObject?.parameters) ? operationObject.parameters : []),
  ];

  for (const rawParam of rawParams) {
    const param = resolveRecord(rawParam, doc);
    if (!param || typeof param.name !== 'string' || typeof param.in !== 'string') continue;
    map.set(`${param.in}:${param.name}`, param);
  }
  return map;
}

function firstContentExample(content: unknown, doc: SwaggerDoc): unknown {
  if (!isRecord(content)) return undefined;
  const mediaObjects = Object.entries(content);
  const preferred = mediaObjects.find(([mediaType]) => mediaType.includes('json')) ?? mediaObjects[0];
  return preferred ? explicitExampleValue(preferred[1], doc) : undefined;
}

export function initialValueForDebugParam(
  param: DebugParam,
  options: { doc: SwaggerDoc; rawParam?: JsonRecord },
): string {
  const rawExample =
    explicitExampleValue(options.rawParam, options.doc) ?? firstContentExample(options.rawParam?.content, options.doc);
  if (rawExample !== undefined && rawExample !== null) {
    return stringifyDebugValue(rawExample, param.type);
  }
  if (param.example !== undefined && param.example !== null) {
    return stringifyDebugValue(param.example, param.type);
  }
  if (param.default !== undefined && param.default !== null) {
    return stringifyDebugValue(param.default, param.type);
  }
  if (param.schema && (param.type === 'array' || param.type === 'object')) {
    const schemaExample = schemaExampleValue(param.schema, options.doc);
    if (schemaExample !== undefined && schemaExample !== null) {
      return stringifyDebugValue(schemaExample, param.type);
    }
  }
  return '';
}

export function buildInitialParamValues(
  debugModel: OperationDebugModel,
  doc: SwaggerDoc,
  operation: MenuOperation,
): ParamValueMap {
  const rawParams = rawParametersForOperation(doc, operation);
  const paramValues: ParamValueMap = {};
  const allParams = [
    ...debugModel.pathParams,
    ...debugModel.queryParams,
    ...debugModel.headerParams,
    ...debugModel.cookieParams,
  ];
  for (const param of allParams) {
    paramValues[paramKey(param)] = initialValueForDebugParam(param, {
      doc,
      rawParam: rawParams.get(paramKey(param)),
    });
  }
  return paramValues;
}

function requestBodyForOperation(doc: SwaggerDoc, operation: MenuOperation): JsonRecord | undefined {
  const operationObject = operationObjectFromDoc(doc, operation);
  return resolveRecord(operationObject?.requestBody, doc);
}

function mediaObjectsForOperation(doc: SwaggerDoc, operation: MenuOperation): Map<string, JsonRecord> {
  const requestBody = requestBodyForOperation(doc, operation);
  const content = requestBody?.content;
  const map = new Map<string, JsonRecord>();
  if (!isRecord(content)) return map;
  for (const [mediaType, mediaObject] of Object.entries(content)) {
    const resolved = resolveRecord(mediaObject, doc);
    if (resolved) map.set(mediaType, resolved);
  }
  return map;
}

function mediaObjectForBodyContent(
  mediaObjects: Map<string, JsonRecord>,
  bodyContent: BodyContent,
): JsonRecord | undefined {
  const direct = mediaObjects.get(bodyContent.mediaType);
  if (direct) return direct;
  if (mediaObjects.size === 1) return Array.from(mediaObjects.values())[0];
  return undefined;
}

export function initialBodyValueForContent(
  bodyContent: BodyContent | undefined,
  defaults: BodyContentDefaults,
): string {
  if (!bodyContent) return '';
  return defaults.bodyByMediaType[bodyContent.mediaType] ?? bodyContent.exampleValue ?? '';
}

export function initialFormFieldsForContent(
  bodyContent: BodyContent | undefined,
  defaults: BodyContentDefaults,
): Record<string, string> {
  if (!bodyContent) return {};
  return { ...(defaults.formFieldsByMediaType[bodyContent.mediaType] ?? {}) };
}

export function buildBodyContentDefaults(
  doc: SwaggerDoc,
  operation: MenuOperation,
  debugModel: OperationDebugModel,
): BodyContentDefaults {
  const mediaObjects = mediaObjectsForOperation(doc, operation);
  const bodyByMediaType: Record<string, string> = {};
  const formFieldsByMediaType: Record<string, Record<string, string>> = {};

  for (const bodyContent of debugModel.bodyContents) {
    const mediaObject = mediaObjectForBodyContent(mediaObjects, bodyContent);
    const mediaExample = explicitExampleValue(mediaObject, doc);
    const schema = mediaObject?.schema ?? bodyContent.schema;
    if (bodyContent.category === 'json' || bodyContent.category === 'raw') {
      const example = mediaExample ?? schemaExampleValue(schema, doc);
      bodyByMediaType[bodyContent.mediaType] =
        example !== undefined && example !== null
          ? stringifyBodyValue(example, bodyContent)
          : (bodyContent.exampleValue ?? '');
    }
    formFieldsByMediaType[bodyContent.mediaType] = initialFormFieldsFor(bodyContent, doc);
  }

  return {
    bodyByMediaType,
    formFieldsByMediaType,
  };
}

export function extractSchemaFields(bodyContent: BodyContent): SchemaFieldRow[] {
  const schema = bodyContent.schema;
  if (!isRecord(schema) || schema.type !== 'object' || !isRecord(schema.properties)) return [];

  const props = schema.properties as Record<string, JsonRecord>;
  const requiredSet = new Set<string>(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const fileFields = new Set(bodyContent.fileFields ?? []);
  const multipleFileFields = new Set(bodyContent.fileFieldsMultiple ?? []);
  const jsonFields = new Set(bodyContent.jsonFields ?? []);

  return Object.entries(props)
    .filter(([, prop]) => !prop.readOnly)
    .map(([name, prop]) => {
      const t = typeof prop.type === 'string' ? prop.type : 'string';
      const format = typeof prop.format === 'string' ? prop.format : undefined;
      const isFile =
        fileFields.has(name) ||
        t === 'file' ||
        (t === 'string' && prop.format === 'binary') ||
        (t === 'string' && prop.format === 'base64');

      let isMultipleFile = false;
      if (isFile && t === 'array' && isRecord(prop.items)) {
        const hasBinaryFormat = prop.items.format === 'binary' || prop.items.format === 'base64';
        const typeOk = prop.items.type === undefined || prop.items.type === 'string';
        isMultipleFile = hasBinaryFormat && typeOk;
      }
      if (isFile && multipleFileFields.has(name)) {
        isMultipleFile = true;
      }

      return {
        name,
        type: isFile ? 'file' : t,
        format,
        required: requiredSet.has(name),
        description: typeof prop.description === 'string' ? prop.description : undefined,
        default: prop.default,
        example: explicitExampleValue(prop, bodyContent.schema ?? {}),
        enum: Array.isArray(prop.enum) ? prop.enum : undefined,
        isFile,
        isMultipleFile,
        isJson: !isFile && jsonFields.has(name),
        schema: prop,
      };
    });
}

export function initialFieldValue(field: SchemaFieldRow, doc: SwaggerDoc | JsonRecord): string {
  if (field.isFile) return '';
  if (field.example !== undefined && field.example !== null) return stringifyDebugValue(field.example, field.type);
  if (field.default !== undefined && field.default !== null) return stringifyDebugValue(field.default, field.type);
  if (
    field.isJson ||
    field.type === 'array' ||
    field.type === 'object' ||
    field.schema?.$ref ||
    field.schema?.items ||
    field.schema?.properties
  ) {
    const example = schemaExampleValue(field.schema, doc);
    if (example !== undefined && example !== null) return stringifyDebugValue(example, field.type);
    if (field.isJson) return '{}';
  }
  if (field.enum && field.enum.length > 0) return String(field.enum[0]);
  if (field.type === 'boolean') return 'true';
  if (field.type === 'integer' || field.type === 'number') return '0';
  return '';
}

function initialFormFieldsFor(bodyContent: BodyContent, doc: SwaggerDoc | JsonRecord): Record<string, string> {
  if (bodyContent.category !== 'urlencoded' && bodyContent.category !== 'multipart') return {};
  const initial: Record<string, string> = {};
  for (const field of extractSchemaFields(bodyContent)) {
    initial[field.name] = initialFieldValue(field, doc);
  }
  return initial;
}

export function mergeCachedFormFields(
  bodyContent: BodyContent | undefined,
  cached: Record<string, string>,
  defaults: BodyContentDefaults,
): Record<string, string> {
  const next = initialFormFieldsForContent(bodyContent, defaults);
  const allowedFields = new Set(Object.keys(next));
  for (const [key, value] of Object.entries(cached)) {
    if (allowedFields.has(key)) {
      next[key] = value;
    }
  }
  return next;
}
