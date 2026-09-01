import type {
  BodyContent,
  DebugParam,
  FormBodyDiagnostic,
  FormBodyEncodingPlan,
  FormFileMetadata,
  MultipartPart,
  Oas31FormBodyModel,
  Oas31FormField,
  Oas31FormPartHeader,
  ParameterInstance,
  SchemaValue,
  SerializeOas31FormBodyInput,
  UrlencodedFormEntry,
} from './types';
import { isJsonMediaType, parseOas31ParameterValue, serializeOas31Parameters } from './parameterSerialization';
import { dereferenceReferenceObject, normalizeAllOfSchema, resolveSchemaRef } from './resolveRef';

type JsonRecord = Record<string, unknown>;

export interface AnalyzeOas31FormBodyOptions {
  readonly mediaType: string;
  readonly schema: Record<string, unknown> | undefined;
  readonly encoding: Record<string, unknown> | undefined;
  readonly fileFields: readonly string[];
  readonly multipleFileFields: readonly string[];
  readonly document: Record<string, unknown>;
}

const DEFAULT_LIMITS = Object.freeze({
  maxFieldBytes: 256 * 1024,
  maxTotalBytes: 1024 * 1024,
  maxParts: 1_000,
});

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MEDIA_TYPE_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function schemaType(schema: SchemaValue): string {
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

function normalizedPropertySchema(value: unknown, document: Record<string, unknown>): SchemaValue {
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

function mediaTypeEssence(value: string): string {
  return value.split(';', 1)[0].trim().toLowerCase();
}

function splitMediaTypes(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result.filter(Boolean);
}

function splitMediaTypeParameters(value: string): string[] | null {
  const result: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ';') {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted || escaped) return null;
  result.push(value.slice(start).trim());
  return result;
}

function validQuotedMediaTypeValue(value: string): boolean {
  if (value.length < 2 || value[0] !== '"' || value[value.length - 1] !== '"') return false;
  let escaped = false;
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];
    const code = character.charCodeAt(0);
    if (escaped) {
      if ((code < 0x20 && character !== '\t') || code === 0x7f) return false;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"' || (code < 0x20 && character !== '\t') || code === 0x7f) {
      return false;
    }
  }
  return !escaped;
}

function validMediaType(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  const segments = splitMediaTypeParameters(value);
  if (!segments || segments.length === 0) return false;
  const [type = '', subtype = '', ...extra] = segments[0].split('/');
  if (extra.length > 0 || !MEDIA_TYPE_TOKEN.test(type) || !MEDIA_TYPE_TOKEN.test(subtype)) return false;
  return segments.slice(1).every((parameter) => {
    const equals = parameter.indexOf('=');
    if (equals <= 0) return false;
    const name = parameter.slice(0, equals).trim();
    const rawValue = parameter.slice(equals + 1).trim();
    return MEDIA_TYPE_TOKEN.test(name) && (MEDIA_TYPE_TOKEN.test(rawValue) || validQuotedMediaTypeValue(rawValue));
  });
}

function declaredTypes(schema: SchemaValue): string[] {
  if (typeof schema === 'boolean') return [];
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type)) {
    return schema.type.filter((value): value is string => typeof value === 'string');
  }
  return [];
}

function arrayItemSchema(schema: SchemaValue, index: number): SchemaValue {
  if (typeof schema === 'boolean') return true;
  const prefixItems: readonly unknown[] = Array.isArray(schema.prefixItems)
    ? (schema.prefixItems as readonly unknown[])
    : [];
  if (index < prefixItems.length) {
    const candidate: unknown = prefixItems[index];
    return typeof candidate === 'boolean' || isRecord(candidate) ? (candidate as SchemaValue) : true;
  }
  const items = schema.items;
  return typeof items === 'boolean' || isRecord(items) ? (items as SchemaValue) : true;
}

function defaultContentTypes(schema: SchemaValue, arrayIndex?: number): string[] {
  if (typeof schema === 'boolean') return ['application/octet-stream'];
  const types = declaredTypes(schema).filter((type) => type !== 'null');
  if (types.length === 0) return ['application/octet-stream'];
  const defaults = new Set<string>();
  for (const type of types) {
    if (type === 'string') {
      defaults.add(
        typeof schema.contentEncoding === 'string' || schema.format === 'binary' || schema.format === 'base64'
          ? 'application/octet-stream'
          : 'text/plain',
      );
    } else if (type === 'number' || type === 'integer' || type === 'boolean') {
      defaults.add('text/plain');
    } else if (type === 'object') {
      defaults.add('application/json');
    } else if (type === 'array') {
      if (arrayIndex !== undefined) {
        defaultContentTypes(arrayItemSchema(schema, arrayIndex)).forEach((value) => defaults.add(value));
      } else if (Array.isArray(schema.prefixItems) && schema.prefixItems.length > 0) {
        schema.prefixItems.forEach((_item, index) =>
          defaultContentTypes(arrayItemSchema(schema, index)).forEach((value) => defaults.add(value)),
        );
        if (schema.items !== false && schema.items !== undefined) {
          defaultContentTypes(arrayItemSchema(schema, schema.prefixItems.length)).forEach((value) =>
            defaults.add(value),
          );
        }
      } else {
        defaultContentTypes(arrayItemSchema(schema, 0)).forEach((value) => defaults.add(value));
      }
    } else {
      defaults.add('application/octet-stream');
    }
  }
  return defaults.size > 0 ? Array.from(defaults) : ['application/octet-stream'];
}

function contentTypeCategory(value: string): 'json' | 'text' | 'binary' {
  const essence = mediaTypeEssence(value);
  if (isJsonMediaType(essence)) return 'json';
  if (essence === 'text/plain') return 'text';
  return 'binary';
}

function diagnostic(
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

function analyzeHeader(
  fieldName: string,
  name: string,
  rawHeader: unknown,
  document: Record<string, unknown>,
  diagnostics: FormBodyDiagnostic[],
): Oas31FormPartHeader | null {
  if (name.toLowerCase() === 'content-type') return null;
  if (!HEADER_NAME.test(name) || name.toLowerCase() === 'content-disposition') {
    diagnostics.push(
      diagnostic(
        'HEADER_INVALID',
        `Multipart header ${name} cannot be safely generated for ${fieldName}.`,
        fieldName,
        name,
      ),
    );
    return null;
  }
  if (!isRecord(rawHeader)) {
    diagnostics.push(diagnostic('HEADER_INVALID', `Multipart header ${name} is not a Header Object.`, fieldName, name));
    return null;
  }
  const header = typeof rawHeader.$ref === 'string' ? dereferenceReferenceObject(rawHeader, document) : rawHeader;
  const hasSchema = hasOwn(header, 'schema');
  const hasContent = hasOwn(header, 'content');
  if (hasSchema === hasContent) {
    diagnostics.push(
      diagnostic(
        'HEADER_INVALID',
        `Multipart header ${name} must define exactly one of schema or content.`,
        fieldName,
        name,
      ),
    );
    return null;
  }

  let schema: SchemaValue | undefined;
  let serialization: Oas31FormPartHeader['serialization'];
  let example = header.example;
  if (hasContent) {
    const entries = isRecord(header.content) ? Object.entries(header.content) : [];
    if (entries.length !== 1) {
      diagnostics.push(
        diagnostic('HEADER_INVALID', `Multipart header ${name} content must contain one media type.`, fieldName, name),
      );
      return null;
    }
    const [mediaType, mediaObject] = entries[0];
    if (!isJsonMediaType(mediaType) && mediaTypeEssence(mediaType) !== 'text/plain') {
      diagnostics.push(
        diagnostic(
          'UNSUPPORTED_CONTENT_TYPE',
          `Multipart header ${name} uses unsupported content type ${mediaType}.`,
          fieldName,
          name,
        ),
      );
    }
    if (isRecord(mediaObject)) {
      schema = normalizedPropertySchema(mediaObject.schema, document);
      if (example === undefined) example = mediaObject.example;
    }
    serialization = { kind: 'content', mediaType };
  } else {
    schema = normalizedPropertySchema(header.schema, document);
    const style = typeof header.style === 'string' ? header.style : 'simple';
    const explode = typeof header.explode === 'boolean' ? header.explode : false;
    if (style !== 'simple') {
      diagnostics.push(
        diagnostic('HEADER_INVALID', `Multipart header ${name} only supports style=simple.`, fieldName, name),
      );
    }
    serialization = { kind: 'schema', style, explode, allowReserved: false };
  }

  const schemaRecord = isRecord(schema) ? schema : undefined;
  return {
    name,
    required: header.required === true,
    description: typeof header.description === 'string' ? header.description : undefined,
    type: schema ? schemaType(schema) : 'string',
    schema,
    serialization,
    default: schemaRecord?.default,
    example: example ?? schemaRecord?.example,
  };
}

function contentEncodingValue(schema: SchemaValue): string | undefined {
  return isRecord(schema) && typeof schema.contentEncoding === 'string' && schema.contentEncoding
    ? schema.contentEncoding
    : undefined;
}

function headerAllowsValue(header: Oas31FormPartHeader, value: string): boolean {
  if (!isRecord(header.schema)) return true;
  if (hasOwn(header.schema, 'const')) return header.schema.const === value;
  if (Array.isArray(header.schema.enum)) return header.schema.enum.includes(value);
  return true;
}

export function analyzeOas31FormBody(options: AnalyzeOas31FormBodyOptions): Oas31FormBodyModel {
  const { mediaType, schema, encoding, fileFields, multipleFileFields, document } = options;
  const diagnostics: FormBodyDiagnostic[] = [];
  if (!schema || !isRecord(schema.properties)) {
    diagnostics.push(
      diagnostic('FORM_SCHEMA_NOT_OBJECT', `OAS 3.1 form body ${mediaType} requires an object schema with properties.`),
    );
    return { fields: [], diagnostics };
  }

  const properties = schema.properties;
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((value): value is string => typeof value === 'string') : [],
  );
  const fileSet = new Set(fileFields);
  const multipleSet = new Set(multipleFileFields);
  const normalizedEncoding = isRecord(encoding) ? encoding : {};
  if (encoding !== undefined && !isRecord(encoding)) {
    diagnostics.push(diagnostic('ENCODING_INVALID', `Encoding for ${mediaType} must be an object.`));
  }
  for (const name of Object.keys(normalizedEncoding)) {
    if (!hasOwn(properties, name)) {
      diagnostics.push(
        diagnostic('ENCODING_PROPERTY_UNKNOWN', `Encoding key ${name} is not present in the request schema.`, name),
      );
    }
  }

  const fields: Oas31FormField[] = [];
  for (const [name, rawSchema] of Object.entries(properties)) {
    const propertySchema = normalizedPropertySchema(rawSchema, document);
    const rawEncoding = normalizedEncoding[name];
    const encodingObject = rawEncoding === undefined ? {} : isRecord(rawEncoding) ? rawEncoding : null;
    if (encodingObject === null) {
      diagnostics.push(diagnostic('ENCODING_INVALID', `Encoding for ${name} must be an object.`, name));
    }
    const currentEncoding = encodingObject ?? {};
    // OAS 3.1 allows RFC6570-style serialization for urlencoded and
    // multipart/form-data bodies. An explicit style/explode/allowReserved
    // value takes precedence over both implicit and explicit contentType.
    const mediaTypeName = mediaTypeEssence(mediaType);
    const styleApplies =
      mediaTypeName === 'application/x-www-form-urlencoded' || mediaTypeName === 'multipart/form-data';
    const hasStyleField =
      styleApplies &&
      (hasOwn(currentEncoding, 'style') ||
        hasOwn(currentEncoding, 'explode') ||
        hasOwn(currentEncoding, 'allowReserved'));
    const style = typeof currentEncoding.style === 'string' ? currentEncoding.style : 'form';
    const explode = typeof currentEncoding.explode === 'boolean' ? currentEncoding.explode : style === 'form';
    const allowReserved = currentEncoding.allowReserved === true;
    if (hasStyleField && !['form', 'spaceDelimited', 'pipeDelimited', 'deepObject'].includes(style)) {
      diagnostics.push(diagnostic('UNSUPPORTED_STYLE', `Encoding for ${name} uses unsupported style ${style}.`, name));
    }
    if (
      hasStyleField &&
      (((style === 'spaceDelimited' || style === 'pipeDelimited') && explode) || (style === 'deepObject' && !explode))
    ) {
      diagnostics.push(
        diagnostic(
          'UNDEFINED_STYLE_COMBINATION',
          `Encoding for ${name} uses an undefined ${style}/explode=${String(explode)} combination.`,
          name,
        ),
      );
    }

    let contentTypes: string[] = [];
    const contentTypeExplicit = !hasStyleField && typeof currentEncoding.contentType === 'string';
    if (!hasStyleField) {
      contentTypes = contentTypeExplicit
        ? splitMediaTypes(currentEncoding.contentType as string)
        : defaultContentTypes(propertySchema);
      if (contentTypes.length === 0 || contentTypes.some((value) => !validMediaType(value))) {
        diagnostics.push(diagnostic('CONTENT_TYPE_INVALID', `Encoding for ${name} has an invalid contentType.`, name));
        contentTypes = ['application/octet-stream'];
      }
      const categories = new Set(contentTypes.map(contentTypeCategory));
      if (contentTypeExplicit && !fileSet.has(name) && categories.size > 1) {
        diagnostics.push(
          diagnostic(
            'CONTENT_TYPE_AMBIGUOUS',
            `Encoding for ${name} lists media types with different serialization rules.`,
            name,
          ),
        );
      }
      const nonNullTypes = declaredTypes(propertySchema).filter((type) => type !== 'null');
      if (nonNullTypes.length > 1 && new Set(defaultContentTypes(propertySchema)).size > 1) {
        diagnostics.push(
          diagnostic('CONTENT_TYPE_AMBIGUOUS', `Schema for ${name} has no single default Encoding content type.`, name),
        );
      }
    }

    const headers: Oas31FormPartHeader[] = [];
    if (mediaTypeEssence(mediaType).startsWith('multipart/') && hasOwn(currentEncoding, 'headers')) {
      if (!isRecord(currentEncoding.headers)) {
        diagnostics.push(diagnostic('HEADER_INVALID', `Multipart headers for ${name} must be an object.`, name));
      } else {
        for (const [headerName, rawHeader] of Object.entries(currentEncoding.headers)) {
          const analyzed = analyzeHeader(name, headerName, rawHeader, document, diagnostics);
          if (analyzed) headers.push(analyzed);
        }
      }
    }
    const contentEncoding = contentEncodingValue(propertySchema);
    const transferHeader = headers.find((header) => header.name.toLowerCase() === 'content-transfer-encoding');
    if (contentEncoding && transferHeader && !headerAllowsValue(transferHeader, contentEncoding)) {
      diagnostics.push(
        diagnostic(
          'CONTENT_ENCODING_HEADER_CONFLICT',
          `Encoding header Content-Transfer-Encoding for ${name} rejects schema contentEncoding ${contentEncoding}.`,
          name,
          transferHeader.name,
        ),
      );
    }

    const record = isRecord(propertySchema) ? propertySchema : undefined;
    const multiple = multipleSet.has(name);
    fields.push({
      name,
      schema: propertySchema,
      type: schemaType(propertySchema),
      format: record && typeof record.format === 'string' ? record.format : undefined,
      required: required.has(name),
      readOnly: record?.readOnly === true,
      file: fileSet.has(name),
      multiple,
      minFiles: multiple && typeof record?.minItems === 'number' ? record.minItems : undefined,
      maxFiles: multiple && typeof record?.maxItems === 'number' ? record.maxItems : multiple ? undefined : 1,
      encoding: {
        kind: hasStyleField ? 'style' : 'content',
        contentTypes,
        contentTypeExplicit,
        ...(hasStyleField ? { style, explode, allowReserved } : {}),
        headers,
      },
    });
  }

  return { fields, diagnostics };
}

function utf8Bytes(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

function fakeParameter(field: Oas31FormField, serialization = field.encoding): DebugParam {
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

function encodeFormComponent(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/[!'()~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function parsedFieldValue(field: Oas31FormField, rawValue: string, contentType?: string) {
  const parameter = fakeParameter(field);
  if (contentType && isJsonMediaType(contentType)) {
    parameter.parameterSerialization = { kind: 'content', mediaType: contentType };
  }
  return parseOas31ParameterValue(parameter, rawValue);
}

function parseDiagnostic(field: Oas31FormField, kind: 'invalid-json' | 'unsafe-number', message: string) {
  return diagnostic(kind === 'unsafe-number' ? 'FORM_UNSAFE_NUMBER' : 'FORM_INPUT_INVALID_JSON', message, field.name);
}

function representation(
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

function contentTypeForValue(field: Oas31FormField, index?: number): string {
  if (field.encoding.contentTypeExplicit) return field.encoding.contentTypes[0] ?? 'application/octet-stream';
  const defaults = defaultContentTypes(field.schema, index);
  return defaults.length === 1 ? defaults[0] : 'application/octet-stream';
}

function rawFileMetadata(value: unknown): FormFileMetadata | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null;
  return {
    name: value.name,
    type: typeof value.type === 'string' ? value.type : undefined,
    size: typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : undefined,
  };
}

function mediaTypeMatches(actual: string, expected: string): boolean {
  const actualEssence = mediaTypeEssence(actual);
  const expectedEssence = mediaTypeEssence(expected);
  if (expectedEssence === '*/*') return true;
  if (expectedEssence.endsWith('/*')) return actualEssence.startsWith(`${expectedEssence.slice(0, -1)}`);
  return actualEssence === expectedEssence;
}

function serializePartHeaders(
  field: Oas31FormField,
  rawValues: Readonly<Record<string, string>>,
  diagnostics: FormBodyDiagnostic[],
): Readonly<Record<string, string>> {
  const values = Object.create(null) as Record<string, string>;
  for (const header of field.encoding.headers) {
    let rawValue = rawValues[header.name];
    const implicitTransfer =
      header.name.toLowerCase() === 'content-transfer-encoding' ? contentEncodingValue(field.schema) : undefined;
    if (rawValue === undefined && implicitTransfer !== undefined) rawValue = implicitTransfer;
    if (rawValue === undefined || rawValue === '') {
      if (header.required) {
        diagnostics.push(
          diagnostic(
            'HEADER_REQUIRED',
            `Multipart header ${header.name} is required for ${field.name}.`,
            field.name,
            header.name,
          ),
        );
      }
      continue;
    }
    const parameter: DebugParam = {
      name: header.name,
      in: 'header',
      required: header.required,
      type: header.type,
      schema: header.schema,
      parameterSerialization: header.serialization,
    };
    try {
      const serialized = serializeOas31Parameters(
        { pathParams: [], queryParams: [], headerParams: [parameter], cookieParams: [] },
        { [`header:${header.name}`]: rawValue },
      );
      const inputDiagnostic = serialized.diagnostics[0];
      if (inputDiagnostic) {
        diagnostics.push(diagnostic('HEADER_INPUT_INVALID', inputDiagnostic.message, field.name, header.name));
      }
      const result = serialized.headers[header.name];
      if (result !== undefined) {
        if (/\r|\n/.test(result)) {
          diagnostics.push(
            diagnostic(
              'HEADER_INPUT_INVALID',
              `Multipart header ${header.name} contains a forbidden line break.`,
              field.name,
              header.name,
            ),
          );
          continue;
        }
        values[header.name] = result;
        if (implicitTransfer !== undefined && result.trim().toLowerCase() !== implicitTransfer.trim().toLowerCase()) {
          diagnostics.push(
            diagnostic(
              'CONTENT_ENCODING_HEADER_CONFLICT',
              `Multipart header ${header.name} conflicts with schema contentEncoding ${implicitTransfer}.`,
              field.name,
              header.name,
            ),
          );
        }
      }
    } catch (reason) {
      diagnostics.push(
        diagnostic(
          'HEADER_INPUT_INVALID',
          reason instanceof Error ? reason.message : String(reason),
          field.name,
          header.name,
        ),
      );
    }
  }
  const contentEncoding = contentEncodingValue(field.schema);
  if (
    contentEncoding &&
    !field.encoding.headers.some((header) => header.name.toLowerCase() === 'content-transfer-encoding')
  ) {
    values['Content-Transfer-Encoding'] = contentEncoding;
  }
  return values;
}

function styleEntries(
  field: Oas31FormField,
  rawValue: string,
  diagnostics: FormBodyDiagnostic[],
): { entries: UrlencodedFormEntry[]; instance?: ParameterInstance } {
  const parameter = fakeParameter(field);
  try {
    const serialized = serializeOas31Parameters(
      { pathParams: [], queryParams: [parameter], headerParams: [], cookieParams: [] },
      { [`query:${field.name}`]: rawValue },
    );
    diagnostics.push(...serialized.diagnostics.map((item) => parseDiagnostic(field, item.kind, item.message)));
    return {
      entries: serialized.query.map((entry) => ({ sourceField: field.name, ...entry })),
      instance: serialized.instances[0]?.instance,
    };
  } catch (reason) {
    diagnostics.push(
      diagnostic('ENCODING_INVALID', reason instanceof Error ? reason.message : String(reason), field.name),
    );
    return {
      entries: [
        {
          sourceField: field.name,
          name: field.name,
          value: rawValue,
          encodedName: encodeFormComponent(field.name),
          encodedValue: encodeFormComponent(rawValue),
        },
      ],
    };
  }
}

function contentEntries(
  field: Oas31FormField,
  rawValue: string,
  diagnostics: FormBodyDiagnostic[],
): {
  entries: UrlencodedFormEntry[];
  instance?: ParameterInstance;
  representations: Array<{ value: string; contentType: string }>;
} {
  const initialContentType = contentTypeForValue(field);
  const parsed = parsedFieldValue(field, rawValue, initialContentType);
  if (!parsed.ok) {
    diagnostics.push(parseDiagnostic(field, parsed.kind, parsed.message));
    const fallback = {
      sourceField: field.name,
      name: field.name,
      value: rawValue,
      encodedName: encodeFormComponent(field.name),
      encodedValue: encodeFormComponent(rawValue),
    };
    return { entries: [fallback], representations: [{ value: rawValue, contentType: initialContentType }] };
  }

  const values = Array.isArray(parsed.instance) ? parsed.instance : [parsed.instance];
  const entries: UrlencodedFormEntry[] = [];
  const representations: Array<{ value: string; contentType: string }> = [];
  values.forEach((value, index) => {
    const contentType = contentTypeForValue(field, Array.isArray(parsed.instance) ? index : undefined);
    const serialized = representation(field, value, contentType, diagnostics);
    if (serialized === null) return;
    representations.push({ value: serialized, contentType });
    entries.push({
      sourceField: field.name,
      name: field.name,
      value: serialized,
      encodedName: encodeFormComponent(field.name),
      encodedValue: encodeFormComponent(serialized),
    });
  });
  if (entries.length === 0 && values.length > 0) {
    entries.push({
      sourceField: field.name,
      name: field.name,
      value: rawValue,
      encodedName: encodeFormComponent(field.name),
      encodedValue: encodeFormComponent(rawValue),
    });
    representations.push({ value: rawValue, contentType: initialContentType });
  }
  return { entries, instance: parsed.instance, representations };
}

export function serializeOas31FormBody(
  bodyContent: BodyContent,
  input: SerializeOas31FormBodyInput,
): FormBodyEncodingPlan {
  if (!bodyContent.oas31Form || (bodyContent.category !== 'urlencoded' && bodyContent.category !== 'multipart')) {
    throw new Error('The selected body does not use the OAS 3.1 form encoding path.');
  }
  const limits = { ...DEFAULT_LIMITS, ...(input.limits ?? {}) };
  const rawFields = input.formFields ?? {};
  const includeEmpty = new Set(input.formFieldNamesToIncludeWhenEmpty ?? []);
  const diagnostics: FormBodyDiagnostic[] = [...bodyContent.oas31Form.diagnostics];
  const instance = Object.create(null) as Record<string, ParameterInstance>;
  const ignoredProperties: string[] = [];
  const urlencodedEntries: UrlencodedFormEntry[] = [];
  const multipartParts: MultipartPart[] = [];
  const modeledNames = new Set(bodyContent.oas31Form.fields.map((field) => field.name));
  const fileNames = new Set(bodyContent.oas31Form.fields.filter((field) => field.file).map((field) => field.name));
  const readOnlyNames = new Set(
    bodyContent.oas31Form.fields.filter((field) => field.readOnly).map((field) => field.name),
  );
  let totalBytes = 0;

  for (const field of bodyContent.oas31Form.fields) {
    if (field.readOnly) {
      ignoredProperties.push(field.name);
      continue;
    }
    if (field.file) {
      ignoredProperties.push(field.name);
      const rawFiles = input.fileFields?.[field.name] ?? [];
      const files = rawFiles.map(rawFileMetadata).filter((value): value is FormFileMetadata => value !== null);
      if (files.length === 0) {
        if (field.required) {
          diagnostics.push(diagnostic('FILE_REQUIRED', `File field ${field.name} is required.`, field.name));
        }
        continue;
      }
      const rawHeaderValues = input.partHeaders?.[field.name] ?? {};
      const headers = serializePartHeaders(field, rawHeaderValues, diagnostics);
      const minimum = field.minFiles ?? (field.required && field.multiple ? 1 : 0);
      const maximum = field.maxFiles ?? (field.multiple ? Number.POSITIVE_INFINITY : 1);
      if (files.length < minimum || files.length > maximum) {
        diagnostics.push(
          diagnostic(
            'FILE_CARDINALITY',
            `File field ${field.name} requires ${minimum}..${Number.isFinite(maximum) ? maximum : 'many'} files.`,
            field.name,
          ),
        );
      }
      const selectedFiles = field.multiple ? files : files.slice(0, 1);
      selectedFiles.forEach((file, index) => {
        const expected = field.encoding.contentTypeExplicit
          ? field.encoding.contentTypes
          : defaultContentTypes(arrayItemSchema(field.schema, field.multiple ? index : 0));
        const rawActual = file.type?.trim() ?? '';
        const actual = rawActual && validMediaType(rawActual) ? rawActual : '';
        let contentType = expected[0] ?? 'application/octet-stream';
        if (rawActual && !actual) {
          diagnostics.push(
            diagnostic(
              'FILE_MEDIA_TYPE',
              `File ${file.name} has an invalid media type and will use ${contentType}.`,
              field.name,
            ),
          );
        }
        if (field.encoding.contentTypeExplicit) {
          const matching = actual ? expected.find((candidate) => mediaTypeMatches(actual, candidate)) : undefined;
          if (matching) contentType = mediaTypeEssence(matching).includes('*') ? actual : matching;
          else {
            diagnostics.push(
              diagnostic(
                'FILE_MEDIA_TYPE',
                `File ${file.name} has media type ${actual || '(unknown)'}, expected ${expected.join(', ')}.`,
                field.name,
              ),
            );
            if (actual) contentType = actual;
          }
        }
        multipartParts.push({
          kind: 'file',
          sourceField: field.name,
          name: field.name,
          fileIndex: index,
          fileName: file.name,
          ...(file.size === undefined ? {} : { fileSize: file.size }),
          contentType,
          headers,
        });
      });
      continue;
    }

    if (!hasOwn(rawFields, field.name)) continue;
    const rawValue = rawFields[field.name];
    if (rawValue === '' && !includeEmpty.has(field.name)) continue;
    const rawHeaderValues = input.partHeaders?.[field.name] ?? {};
    const headers = serializePartHeaders(field, rawHeaderValues, diagnostics);
    const bytes = utf8Bytes(rawValue);
    totalBytes += bytes;
    if (bytes > limits.maxFieldBytes || totalBytes > limits.maxTotalBytes) {
      diagnostics.push(
        diagnostic('FORM_BUDGET_EXCEEDED', `Form field ${field.name} exceeds the configured input budget.`, field.name),
      );
    }

    if (field.encoding.kind === 'style') {
      const serialized = styleEntries(field, rawValue, diagnostics);
      if (serialized.instance !== undefined) instance[field.name] = serialized.instance;
      if (bodyContent.category === 'urlencoded') urlencodedEntries.push(...serialized.entries);
      else {
        serialized.entries.forEach((entry) =>
          multipartParts.push({
            kind: 'text',
            sourceField: field.name,
            name: entry.name,
            value: entry.value,
            contentType: 'text/plain',
            headers,
          }),
        );
      }
      continue;
    }

    const serialized = contentEntries(field, rawValue, diagnostics);
    if (serialized.instance !== undefined) instance[field.name] = serialized.instance;
    if (bodyContent.category === 'urlencoded') urlencodedEntries.push(...serialized.entries);
    else {
      serialized.representations.forEach((item) =>
        multipartParts.push({
          kind: 'text',
          sourceField: field.name,
          name: field.name,
          value: item.value,
          contentType: item.contentType,
          headers,
        }),
      );
    }
  }

  for (const [name, rawValue] of Object.entries(rawFields)) {
    if (modeledNames.has(name) || (rawValue === '' && !includeEmpty.has(name))) continue;
    instance[name] = rawValue;
    if (bodyContent.category === 'urlencoded') {
      urlencodedEntries.push({
        sourceField: name,
        name,
        value: rawValue,
        encodedName: encodeFormComponent(name),
        encodedValue: encodeFormComponent(rawValue),
      });
    } else {
      multipartParts.push({
        kind: 'text',
        sourceField: name,
        name,
        value: rawValue,
        contentType: 'text/plain',
        headers: {},
      });
    }
  }

  const bodySchema = bodyContent.schema;
  const dependentRequired =
    bodySchema && isRecord(bodySchema.dependentRequired) ? bodySchema.dependentRequired : undefined;
  if (dependentRequired) {
    // Presence follows the wire plan: an empty composite can exist in the
    // logical instance without emitting any entry or part.
    const presentNames = new Set(
      (bodyContent.category === 'urlencoded' ? urlencodedEntries : multipartParts).map((item) => item.sourceField),
    );
    for (const [trigger, rawDependencies] of Object.entries(dependentRequired)) {
      if (!presentNames.has(trigger) || !Array.isArray(rawDependencies)) continue;
      for (const dependency of rawDependencies) {
        if (
          typeof dependency !== 'string' ||
          presentNames.has(dependency) ||
          readOnlyNames.has(dependency) ||
          (!fileNames.has(trigger) && !fileNames.has(dependency))
        ) {
          continue;
        }
        diagnostics.push(
          diagnostic(
            'FORM_DEPENDENT_REQUIRED',
            `Form field ${trigger} requires ${dependency} to be present.`,
            dependency,
          ),
        );
      }
    }
  }

  const partCount = bodyContent.category === 'urlencoded' ? urlencodedEntries.length : multipartParts.length;
  if (input.bodyRequired && partCount === 0) {
    diagnostics.push(diagnostic('FORM_BODY_REQUIRED', 'The request body is required but has no encoded values.'));
  }
  if (partCount > limits.maxParts) {
    diagnostics.push(diagnostic('FORM_BUDGET_EXCEEDED', `Form body contains ${partCount} encoded values.`));
  }

  if (bodyContent.category === 'urlencoded') {
    return {
      kind: 'urlencoded',
      body: urlencodedEntries.map((entry) => `${entry.encodedName}=${entry.encodedValue}`).join('&'),
      entries: urlencodedEntries,
      instance,
      ignoredProperties,
      diagnostics,
    };
  }
  return {
    kind: 'multipart',
    mediaType: bodyContent.mediaType,
    parts: multipartParts,
    instance,
    ignoredProperties,
    diagnostics,
  };
}
