import type {
  DebugParam,
  FormBodyDiagnostic,
  FormFileMetadata,
  Oas31FormField,
  ParameterInstance,
  SchemaValue,
} from './types';
import { isJsonMediaType } from './parameterSerialization';
import { normalizeAllOfSchema, resolveSchemaRef } from './resolveRef';
import { isRecord } from '../utils/guards';

export const DEFAULT_MAX_FORM_FIELD_BYTES = 256 * 1024;

export function schemaType(schema: SchemaValue): string {
  if (typeof schema === 'boolean') return 'unknown';
  const declared = schema.type;
  const types = Array.isArray(declared)
    ? declared.filter((value): value is string => typeof value === 'string' && value !== 'null')
    : typeof declared === 'string' && declared !== 'null'
      ? [declared]
      : [];
  if (types.length === 1) return types[0];
  if (schema.properties !== undefined) return 'object';
  if (schema.items !== undefined || schema.prefixItems !== undefined) return 'array';
  return types[0] ?? 'unknown';
}

export function normalizedPropertySchema(value: unknown, document: Record<string, unknown>): SchemaValue {
  if (typeof value === 'boolean') return value;
  if (!isRecord(value)) return true;
  if (typeof value.$ref === 'string') {
    const resolved = resolveSchemaRef(value.$ref, document);
    if (typeof resolved === 'boolean') {
      if (resolved === false) return false;
      const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$ref'));
      return Object.keys(siblings).length > 0 ? normalizeAllOfSchema(siblings, document) : true;
    }
  }
  return normalizeAllOfSchema(value, document);
}

export function declaredTypes(schema: SchemaValue): string[] {
  if (typeof schema === 'boolean') return [];
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type)) {
    return schema.type.filter((value): value is string => typeof value === 'string');
  }
  return [];
}

export function arrayItemSchema(schema: SchemaValue, index: number): SchemaValue {
  if (typeof schema === 'boolean') return true;
  const prefixItems: readonly unknown[] = Array.isArray(schema.prefixItems)
    ? (schema.prefixItems as readonly unknown[])
    : [];
  if (index < prefixItems.length) {
    const candidate: unknown = prefixItems[index];
    return typeof candidate === 'boolean' || isRecord(candidate) ? candidate : true;
  }
  const items = schema.items;
  return typeof items === 'boolean' || isRecord(items) ? items : true;
}

export function diagnostic(
  code: FormBodyDiagnostic['code'],
  message: string,
  fieldName?: string,
  headerName?: string,
): FormBodyDiagnostic {
  return {
    code,
    message,
    ...(fieldName === undefined ? {} : { fieldName }),
    ...(headerName === undefined ? {} : { headerName }),
  };
}

export function contentEncodingValue(schema: SchemaValue): string | undefined {
  return isRecord(schema) && typeof schema.contentEncoding === 'string' && schema.contentEncoding
    ? schema.contentEncoding
    : undefined;
}

export function utf8Bytes(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

export function formFieldParameter(field: Oas31FormField): DebugParam {
  const serialization = field.encoding;
  return {
    name: field.name,
    in: 'query',
    required: field.required,
    type: field.type,
    format: field.format,
    schema: field.schema,
    parameterSerialization:
      serialization.kind === 'style'
        ? {
            kind: 'schema',
            style: serialization.style ?? 'form',
            explode: serialization.explode ?? true,
            allowReserved: serialization.allowReserved ?? false,
          }
        : { kind: 'schema', style: 'form', explode: true, allowReserved: false },
  };
}

export function representation(
  field: Oas31FormField,
  instance: ParameterInstance,
  contentType: string,
  diagnostics: FormBodyDiagnostic[],
): string | null {
  if (isJsonMediaType(contentType)) return JSON.stringify(instance);
  if (instance === null) return 'null';
  if (typeof instance === 'string' || typeof instance === 'number' || typeof instance === 'boolean') {
    return String(instance);
  }
  diagnostics.push(
    diagnostic(
      'UNSUPPORTED_CONTENT_TYPE',
      `Field ${field.name} cannot serialize a structured value as ${contentType}.`,
      field.name,
    ),
  );
  return null;
}

export function rawFileMetadata(value: unknown): FormFileMetadata | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null;
  return {
    name: value.name,
    type: typeof value.type === 'string' ? value.type : undefined,
    size: typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : undefined,
  };
}
