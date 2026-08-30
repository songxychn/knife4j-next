/**
 * Format-neutral data model for the human-readable offline document exports.
 *
 * The builder deliberately supports only the narrow Schema semantics that the
 * existing HTML / DOC / DOCX exporters already expose: local schema refs,
 * object properties and array items. Other OpenAPI Reference Objects and
 * composition keywords remain outside this module's contract.
 */

import { selectRequestBodyExample, selectResponseExamples } from './debug/operationExamples';

export interface MdSchemaObject {
  type?: string | string[];
  format?: string;
  description?: string;
  example?: unknown;
  default?: unknown;
  properties?: Record<string, MdSchemaObject>;
  items?: MdSchemaObject;
  $ref?: string;
  required?: string[];
  enum?: unknown[];
}

export interface MdExampleObject {
  summary?: string;
  description?: string;
  value?: unknown;
  externalValue?: string;
  $ref?: string;
}

export interface MdMediaTypeObject {
  schema?: MdSchemaObject;
  example?: unknown;
  examples?: Record<string, MdExampleObject>;
}

export interface MdParameterObject {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: MdSchemaObject;
  type?: string;
  format?: string;
}

export interface MdRequestBodyObject {
  description?: string;
  required?: boolean;
  content?: Record<string, MdMediaTypeObject>;
}

export interface MdResponseObject {
  description?: string;
  content?: Record<string, MdMediaTypeObject>;
  schema?: MdSchemaObject;
}

export interface MdOperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: MdParameterObject[];
  requestBody?: MdRequestBodyObject;
  responses?: Record<string, MdResponseObject>;
  deprecated?: boolean;
}

export interface MdDocContext {
  components?: {
    schemas?: Record<string, MdSchemaObject>;
    examples?: Record<string, MdExampleObject>;
  };
  definitions?: Record<string, MdSchemaObject>;
}

export interface ExportSchemaField {
  fieldPath: string;
  typeDisplay: string;
  required: boolean;
  description: string;
  truncated: boolean;
  depth: number;
}

export type ExportSchemaKind = 'object' | 'array' | 'primitive' | 'unknown';

export interface ExportSchema {
  mediaType: string;
  typeDisplay: string;
  kind: ExportSchemaKind;
  /** One-level projection retained for compact renderers. */
  shallowFields: ExportSchemaField[];
  fields: ExportSchemaField[];
}

export interface ExportParameter {
  name: string;
  location: string;
  required: boolean;
  typeDisplay: string;
  compactTypeDisplay: string;
  description: string;
}

export interface ExportExample {
  mediaType: string;
  value: string;
}

export interface ExportRequestBody {
  description: string;
  required: boolean;
  schema?: ExportSchema;
  example?: ExportExample;
}

export interface ExportResponse {
  statusCode: string;
  description: string;
  schema?: ExportSchema;
  example?: ExportExample;
}

export interface ExportOperation {
  title: string;
  numberPath: readonly number[];
  method: string;
  path: string;
  summary: string;
  description: string;
  deprecated: boolean;
  parameters: ExportParameter[];
  requestBody?: ExportRequestBody;
  responses: ExportResponse[];
}

export interface ExportTag {
  name: string;
  description: string;
  numberPath: readonly number[];
  operations: ExportOperation[];
}

export interface ExportDocument {
  title: string;
  version: string;
  description: string;
  tags: ExportTag[];
}

export interface ExportOperationSource {
  method: string;
  path: string;
  operation: MdOperationObject;
  /** Explicit presentation title used by compatibility callers. */
  title?: string;
  numberPath?: readonly number[];
}

export interface ExportTagSource {
  tag: string;
  description?: string;
  operations: readonly ExportOperationSource[];
}

export interface ExportDocumentSource extends MdDocContext {
  info: {
    title?: string;
    version?: string;
    description?: string;
  };
}

export interface BuildExportDocumentOptions {
  fallbackTitle?: string;
}

const MAX_FLATTEN_DEPTH = 30;

function resolveRef(ref: string, doc: MdDocContext): MdSchemaObject | undefined {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/) ?? ref.match(/^#\/definitions\/(.+)$/);
  if (!match) return undefined;
  return (doc.components?.schemas ?? doc.definitions ?? {})[match[1]];
}

function declaredSchemaTypes(type: MdSchemaObject['type']): string[] {
  if (typeof type === 'string') return [type];
  return Array.isArray(type) ? type.filter((value): value is string => typeof value === 'string') : [];
}

function primarySchemaType(type: MdSchemaObject['type']): string | undefined {
  const types = declaredSchemaTypes(type);
  return types.find((value) => value !== 'null') ?? types[0];
}

function schemaDisplayType(schema?: MdSchemaObject): string {
  if (!schema) return '';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? '$ref';
  const type = primarySchemaType(schema.type);
  if (type === 'array') {
    const inner = schemaDisplayType(schema.items);
    return `${inner || 'object'}[]`;
  }
  const typeDisplay = declaredSchemaTypes(schema.type).join(' | ');
  const parts = [typeDisplay, schema.format].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'object';
}

function compactSchemaDisplayType(schema?: MdSchemaObject): string {
  if (!schema) return '';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? '$ref';
  const type = primarySchemaType(schema.type);
  if (type === 'array') return `${compactSchemaDisplayType(schema.items) || 'object'}[]`;
  if (type === 'string' && schema.format === 'byte') return 'byte';
  return [declaredSchemaTypes(schema.type).join('|'), schema.format].filter(Boolean).join('/') || 'object';
}

function schemaKind(schema: MdSchemaObject, doc: MdDocContext, seenRefs: Set<string> = new Set()): ExportSchemaKind {
  if (schema.$ref) {
    if (seenRefs.has(schema.$ref)) return 'unknown';
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) return 'unknown';
    const nextSeen = new Set(seenRefs);
    nextSeen.add(schema.$ref);
    return schemaKind(resolved, doc, nextSeen);
  }
  const type = primarySchemaType(schema.type);
  if (type === 'array') return 'array';
  if (type === 'object' || schema.properties) return 'object';
  if (schema.type) return 'primitive';
  return 'unknown';
}

function pickContentSchema(
  content: Record<string, MdMediaTypeObject> | undefined,
  fallback?: MdSchemaObject,
): { mediaType: string; schema: MdSchemaObject } | undefined {
  if (content) {
    const json = content['application/json'];
    if (json?.schema) return { mediaType: 'application/json', schema: json.schema };
    for (const [mediaType, entry] of Object.entries(content)) {
      if (entry?.schema) return { mediaType, schema: entry.schema };
    }
  }
  if (fallback) return { mediaType: 'application/json', schema: fallback };
  return undefined;
}

function truncatedField(prefix: string, schema: MdSchemaObject, depth: number): ExportSchemaField {
  const typeDisplay = schemaDisplayType(schema);
  return {
    fieldPath: prefix || typeDisplay || '$ref',
    typeDisplay,
    required: false,
    description: schema.description ?? '',
    truncated: true,
    depth,
  };
}

function flattenSchemaFields(
  schema: MdSchemaObject,
  doc: MdDocContext,
  prefix = '',
  requiredSet: Set<string> = new Set(),
  depth = 0,
  seenRefs: Set<string> = new Set(),
): ExportSchemaField[] {
  if (depth > MAX_FLATTEN_DEPTH) return [truncatedField(prefix, schema, depth)];

  if (schema.$ref) {
    if (seenRefs.has(schema.$ref)) return [truncatedField(prefix, schema, depth)];
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) return [];
    const nextSeen = new Set(seenRefs);
    nextSeen.add(schema.$ref);
    return flattenSchemaFields(resolved, doc, prefix, new Set(resolved.required ?? []), depth, nextSeen);
  }

  if (primarySchemaType(schema.type) === 'array' && schema.items) {
    return flattenSchemaFields(schema.items, doc, prefix, new Set(schema.items.required ?? []), depth, seenRefs);
  }

  if (!schema.properties) return [];

  const rows: ExportSchemaField[] = [];
  for (const [name, property] of Object.entries(schema.properties)) {
    const fieldPath = prefix ? `${prefix}.${name}` : name;
    const row: ExportSchemaField = {
      fieldPath,
      typeDisplay: schemaDisplayType(property),
      required: requiredSet.has(name),
      description: property.description ?? '',
      truncated: false,
      depth,
    };
    rows.push(row);

    const nextSeen = new Set(seenRefs);
    let resolvedProperty = property;
    if (property.$ref) {
      if (seenRefs.has(property.$ref)) {
        row.truncated = true;
        continue;
      }
      const resolved = resolveRef(property.$ref, doc);
      if (!resolved) continue;
      nextSeen.add(property.$ref);
      resolvedProperty = resolved;
    }

    if (resolvedProperty.properties) {
      if (depth >= MAX_FLATTEN_DEPTH) {
        row.truncated = true;
        continue;
      }
      rows.push(
        ...flattenSchemaFields(
          resolvedProperty,
          doc,
          fieldPath,
          new Set(resolvedProperty.required ?? []),
          depth + 1,
          nextSeen,
        ),
      );
      continue;
    }

    if (resolvedProperty.type !== 'array' || !resolvedProperty.items) continue;

    let itemSchema = resolvedProperty.items;
    const itemSeen = new Set(nextSeen);
    if (itemSchema.$ref) {
      if (nextSeen.has(itemSchema.$ref)) {
        row.truncated = true;
        continue;
      }
      const resolved = resolveRef(itemSchema.$ref, doc);
      if (!resolved) continue;
      itemSeen.add(itemSchema.$ref);
      itemSchema = resolved;
    }
    if (!itemSchema.properties) continue;
    if (depth >= MAX_FLATTEN_DEPTH) {
      row.truncated = true;
      continue;
    }
    rows.push(
      ...flattenSchemaFields(
        itemSchema,
        doc,
        `${fieldPath}[]`,
        new Set(itemSchema.required ?? []),
        depth + 1,
        itemSeen,
      ),
    );
  }
  return rows;
}

function shallowSchemaFields(schema: MdSchemaObject, doc: MdDocContext): ExportSchemaField[] {
  const resolved = schema.$ref ? resolveRef(schema.$ref, doc) : schema;
  if (!resolved?.properties) return [];
  const required = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties).map(([name, property]) => ({
    fieldPath: name,
    typeDisplay: schemaDisplayType(property),
    required: required.has(name),
    description: property.description ?? '',
    truncated: false,
    depth: 0,
  }));
}

function buildExportSchema(
  picked: { mediaType: string; schema: MdSchemaObject },
  docContext: MdDocContext,
): ExportSchema {
  return {
    mediaType: picked.mediaType,
    typeDisplay: schemaDisplayType(picked.schema),
    kind: schemaKind(picked.schema, docContext),
    shallowFields: shallowSchemaFields(picked.schema, docContext),
    fields: flattenSchemaFields(picked.schema, docContext, '', new Set(picked.schema.required ?? [])),
  };
}

function parameterType(parameter: MdParameterObject): string {
  return schemaDisplayType(parameter.schema) || parameter.type || '';
}

function compactParameterType(parameter: MdParameterObject): string {
  return (
    compactSchemaDisplayType(parameter.schema) || [parameter.type, parameter.format].filter(Boolean).join('/') || '-'
  );
}

export function buildExportOperation(source: ExportOperationSource, docContext: MdDocContext): ExportOperation {
  const operation = source.operation;
  const method = source.method.toUpperCase();
  const exampleContext = { doc: docContext as unknown as Record<string, unknown> };
  const selectedRequestExample = selectRequestBodyExample(operation.requestBody, undefined, exampleContext);
  const selectedResponseExamples = new Map(
    selectResponseExamples(operation.responses, exampleContext).map((example) => [example.statusCode, example]),
  );
  const requestBody = operation.requestBody
    ? (() => {
        const picked = pickContentSchema(operation.requestBody?.content);
        return {
          description: operation.requestBody?.description ?? '',
          required: Boolean(operation.requestBody?.required),
          schema: picked ? buildExportSchema(picked, docContext) : undefined,
          example: selectedRequestExample,
        };
      })()
    : undefined;

  return {
    title: source.title ?? (operation.summary?.trim() || `${method} ${source.path}`),
    numberPath: source.numberPath ?? [],
    method,
    path: source.path,
    summary: operation.summary ?? '',
    description: operation.description ?? '',
    deprecated: Boolean(operation.deprecated),
    parameters: (operation.parameters ?? []).map((parameter) => ({
      name: parameter.name,
      location: parameter.in,
      required: Boolean(parameter.required),
      typeDisplay: parameterType(parameter),
      compactTypeDisplay: compactParameterType(parameter),
      description: parameter.description ?? '',
    })),
    requestBody,
    responses: Object.entries(operation.responses ?? {}).map(([statusCode, response]) => {
      const picked = pickContentSchema(response.content, response.schema);
      const selectedExample = selectedResponseExamples.get(statusCode);
      return {
        statusCode,
        description: response.description ?? '',
        schema: picked ? buildExportSchema(picked, docContext) : undefined,
        example: selectedExample ? { mediaType: selectedExample.mediaType, value: selectedExample.value } : undefined,
      };
    }),
  };
}

export function buildExportDocument(
  doc: ExportDocumentSource,
  tags: readonly ExportTagSource[],
  options: BuildExportDocumentOptions = {},
): ExportDocument {
  return {
    title: doc.info.title || options.fallbackTitle || 'API Documentation',
    version: doc.info.version ?? '',
    description: doc.info.description ?? '',
    tags: tags.map((tag, tagIndex) => ({
      name: tag.tag,
      description: tag.description ?? '',
      numberPath: [tagIndex + 1],
      operations: tag.operations.map((operation, operationIndex) =>
        buildExportOperation(
          {
            ...operation,
            numberPath: [tagIndex + 1, operationIndex + 1],
          },
          doc,
        ),
      ),
    })),
  };
}
