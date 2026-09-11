import type {
  BodyContent,
  DebugParam,
  FormBodyDiagnostic,
  FormBodyEncodingPlan,
  FormFileMetadata,
  MultipartFilePart,
  MultipartNestedPart,
  MultipartPart,
  MultipartTextPart,
  Oas31FormField,
  Oas31FormPartHeader,
  Oas32FormBodyModel,
  Oas32FormField,
  ParameterInstance,
  SchemaValue,
  SerializeOas31FormBodyInput,
} from './types';
import { isJsonMediaType, parseOas31ParameterValue, serializeOas31Parameters } from './parameterSerialization';
import { analyzeOas31FormBody, serializeOas31FormBody } from './formBodyEncoding';
import { dereferenceReferenceObject, normalizeAllOfSchema, resolveSchemaRef } from './resolveRef';

type JsonRecord = Record<string, unknown>;

export interface AnalyzeOas32FormBodyOptions {
  readonly mediaType: string;
  readonly schema: Record<string, unknown> | undefined;
  readonly itemSchema: SchemaValue | undefined;
  readonly encoding: unknown;
  readonly prefixEncoding: unknown;
  readonly itemEncoding: unknown;
  readonly fileFields: readonly string[];
  readonly multipleFileFields: readonly string[];
  readonly document: Record<string, unknown>;
}

const DEFAULT_LIMITS = Object.freeze({
  maxFieldBytes: 256 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxParts: 100,
  maxDepth: 1,
  maxMaterializationMs: 2_000,
});

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MEDIA_TYPE_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORM_DATA_HEADERS = new Set(['content-disposition', 'content-transfer-encoding']);
const MULTIPART_CONTENT_HEADERS = new Set([
  'content-disposition',
  'content-transfer-encoding',
  'content-id',
  'content-description',
  'content-location',
  'content-range',
]);

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function mediaTypeEssence(value: string): string {
  return value.split(';', 1)[0].trim().toLowerCase();
}

function isMultipartMedia(value: string): boolean {
  return mediaTypeEssence(value).startsWith('multipart/');
}

function isFormDataMedia(value: string): boolean {
  return mediaTypeEssence(value) === 'multipart/form-data';
}

function isUrlencodedMedia(value: string): boolean {
  return mediaTypeEssence(value) === 'application/x-www-form-urlencoded';
}

function namedEncodingApplies(mediaType: string): boolean {
  return isUrlencodedMedia(mediaType) || isFormDataMedia(mediaType);
}

function positionalEncodingApplies(mediaType: string): boolean {
  return isMultipartMedia(mediaType);
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

function declaredTypes(schema: SchemaValue): string[] {
  if (typeof schema === 'boolean') return [];
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type)) return schema.type.filter((value): value is string => typeof value === 'string');
  return [];
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

export function mediaTypeBoundary(value: string): string | undefined {
  const segments = splitMediaTypeParameters(value);
  if (!segments) return undefined;
  for (const segment of segments.slice(1)) {
    const equals = segment.indexOf('=');
    if (equals <= 0) continue;
    if (segment.slice(0, equals).trim().toLowerCase() !== 'boundary') continue;
    let raw = segment.slice(equals + 1).trim();
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) raw = raw.slice(1, -1).replace(/\\"/g, '"');
    return raw || undefined;
  }
  return undefined;
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
      } else {
        defaults.add('application/json');
      }
    } else {
      defaults.add('application/octet-stream');
    }
  }
  return defaults.size > 0 ? Array.from(defaults) : ['application/octet-stream'];
}

function contentTypeRequiresChoice(contentTypes: readonly string[]): boolean {
  return contentTypes.length > 1 || contentTypes.some((value) => mediaTypeEssence(value).includes('*'));
}

function isBinarySchema(schema: SchemaValue): boolean {
  if (typeof schema !== 'object') return schema === true;
  return (
    schema.format === 'binary' ||
    schema.format === 'base64' ||
    typeof schema.contentEncoding === 'string' ||
    (declaredTypes(schema).length === 0 &&
      schema.properties === undefined &&
      schema.items === undefined &&
      schema.prefixItems === undefined)
  );
}

function headerAllowed(mediaType: string, headerName: string): boolean {
  const lower = headerName.toLowerCase();
  if (lower === 'content-type') return false;
  if (isFormDataMedia(mediaType)) return FORM_DATA_HEADERS.has(lower);
  return lower.startsWith('content-') && MULTIPART_CONTENT_HEADERS.has(lower);
}

function analyzeHeader(
  fieldName: string,
  name: string,
  rawHeader: unknown,
  mediaType: string,
  document: Record<string, unknown>,
  diagnostics: FormBodyDiagnostic[],
): Oas31FormPartHeader | null {
  if (name.toLowerCase() === 'content-type') return null;
  if (!HEADER_NAME.test(name)) {
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
  if (!headerAllowed(mediaType, name)) {
    diagnostics.push(
      diagnostic(
        'HEADER_NOT_ALLOWED',
        `Multipart header ${name} is not a legal ${mediaTypeEssence(mediaType)} part header.`,
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
    const [contentMediaType, mediaObject] = entries[0];
    if (!isJsonMediaType(contentMediaType) && mediaTypeEssence(contentMediaType) !== 'text/plain') {
      diagnostics.push(
        diagnostic(
          'UNSUPPORTED_CONTENT_TYPE',
          `Multipart header ${name} uses unsupported content type ${contentMediaType}.`,
          fieldName,
          name,
        ),
      );
    }
    if (isRecord(mediaObject)) {
      schema = normalizedPropertySchema(mediaObject.schema, document);
      if (example === undefined) example = mediaObject.example;
    }
    serialization = { kind: 'content', mediaType: contentMediaType };
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

function encodingHeaders(
  encodingObject: JsonRecord,
  fieldName: string,
  mediaType: string,
  document: Record<string, unknown>,
  diagnostics: FormBodyDiagnostic[],
): Oas31FormPartHeader[] {
  if (!hasOwn(encodingObject, 'headers')) return [];
  if (!isRecord(encodingObject.headers)) {
    diagnostics.push(diagnostic('HEADER_INVALID', `Multipart headers for ${fieldName} must be an object.`, fieldName));
    return [];
  }
  const headers: Oas31FormPartHeader[] = [];
  for (const [headerName, rawHeader] of Object.entries(encodingObject.headers)) {
    const analyzed = analyzeHeader(fieldName, headerName, rawHeader, mediaType, document, diagnostics);
    if (analyzed) headers.push(analyzed);
  }
  return headers;
}

function encodingContentTypes(
  encodingObject: JsonRecord,
  schema: SchemaValue,
  diagnostics: FormBodyDiagnostic[],
  fieldName: string,
  mediaType: string,
): {
  contentTypes: string[];
  contentTypeExplicit: boolean;
  kind: 'content' | 'style';
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
} {
  const styleApplies = namedEncodingApplies(mediaType);
  const hasStyleField =
    styleApplies &&
    (hasOwn(encodingObject, 'style') || hasOwn(encodingObject, 'explode') || hasOwn(encodingObject, 'allowReserved'));
  const style = typeof encodingObject.style === 'string' ? encodingObject.style : 'form';
  const explode = typeof encodingObject.explode === 'boolean' ? encodingObject.explode : style === 'form';
  const allowReserved = encodingObject.allowReserved === true;
  if (hasStyleField && !['form', 'spaceDelimited', 'pipeDelimited', 'deepObject'].includes(style)) {
    diagnostics.push(
      diagnostic('UNSUPPORTED_STYLE', `Encoding for ${fieldName} uses unsupported style ${style}.`, fieldName),
    );
  }
  if (
    hasStyleField &&
    (((style === 'spaceDelimited' || style === 'pipeDelimited') && explode) || (style === 'deepObject' && !explode))
  ) {
    diagnostics.push(
      diagnostic(
        'UNDEFINED_STYLE_COMBINATION',
        `Encoding for ${fieldName} uses an undefined ${style}/explode=${String(explode)} combination.`,
        fieldName,
      ),
    );
  }
  if (hasStyleField) {
    return { contentTypes: [], contentTypeExplicit: false, kind: 'style', style, explode, allowReserved };
  }
  const contentTypeExplicit = typeof encodingObject.contentType === 'string';
  let contentTypes = contentTypeExplicit
    ? splitMediaTypes(encodingObject.contentType as string)
    : defaultContentTypes(schema);
  if (contentTypes.length === 0 || contentTypes.some((value) => !validMediaType(value))) {
    diagnostics.push(
      diagnostic('CONTENT_TYPE_INVALID', `Encoding for ${fieldName} has an invalid contentType.`, fieldName),
    );
    contentTypes = ['application/octet-stream'];
  }
  return { contentTypes, contentTypeExplicit, kind: 'content' };
}

function nestedEncodingPresent(encodingObject: JsonRecord): boolean {
  return (
    hasOwn(encodingObject, 'encoding') ||
    hasOwn(encodingObject, 'prefixEncoding') ||
    hasOwn(encodingObject, 'itemEncoding')
  );
}

function encodingConflict(encodingObject: JsonRecord): boolean {
  return (
    hasOwn(encodingObject, 'encoding') &&
    (hasOwn(encodingObject, 'prefixEncoding') || hasOwn(encodingObject, 'itemEncoding'))
  );
}

function toOas32Field(
  field: Oas31FormField,
  extras: Pick<Oas32FormField, 'partId' | 'layout' | 'depth'> & Partial<Oas32FormField>,
): Oas32FormField {
  return {
    ...field,
    ...extras,
    partId: extras.partId,
    layout: extras.layout,
    depth: extras.depth,
  };
}

function namedFieldsFromOas31(
  mediaType: string,
  model: { fields: readonly Oas31FormField[]; diagnostics: readonly FormBodyDiagnostic[] },
  diagnostics: FormBodyDiagnostic[],
  document: Record<string, unknown>,
  rawEncoding: unknown,
  depth: number,
): Oas32FormField[] {
  diagnostics.push(...model.diagnostics);
  const encodingMap = isRecord(rawEncoding) ? rawEncoding : {};
  return model.fields.map((field) => {
    const rawFieldEncoding = encodingMap[field.name];
    const encodingObject: JsonRecord = isRecord(rawFieldEncoding) ? rawFieldEncoding : {};
    const allowedHeaders = field.encoding.headers.filter((header) => {
      if (headerAllowed(mediaType, header.name)) return true;
      diagnostics.push(
        diagnostic(
          'HEADER_NOT_ALLOWED',
          `Multipart header ${header.name} is not a legal ${mediaTypeEssence(mediaType)} part header.`,
          field.name,
          header.name,
        ),
      );
      return false;
    });
    const nestedMedia =
      field.encoding.contentTypes.find((value) => isMultipartMedia(value)) ??
      (typeof encodingObject.contentType === 'string' && isMultipartMedia(encodingObject.contentType)
        ? encodingObject.contentType
        : undefined);
    let nestedFields: Oas32FormField[] | undefined;
    if (nestedMedia && nestedEncodingPresent(encodingObject)) {
      if (depth >= DEFAULT_LIMITS.maxDepth) {
        diagnostics.push(
          diagnostic(
            'NESTING_UNSUPPORTED',
            `Nested multipart encoding for ${field.name} exceeds one supported level.`,
            field.name,
          ),
        );
      } else if (encodingConflict(encodingObject)) {
        diagnostics.push(
          diagnostic(
            'ENCODING_CONFLICT',
            `Nested encoding for ${field.name} cannot mix named and positional encoding.`,
            field.name,
          ),
        );
      } else {
        nestedFields = analyzeEncodingLevel({
          mediaType: nestedMedia,
          schema: field.schema,
          itemSchema: undefined,
          encoding: encodingObject.encoding,
          prefixEncoding: encodingObject.prefixEncoding,
          itemEncoding: encodingObject.itemEncoding,
          fileFields: [],
          multipleFileFields: [],
          document,
          diagnostics,
          depth: depth + 1,
          parentId: field.name,
        });
      }
    }
    return toOas32Field(
      { ...field, encoding: { ...field.encoding, headers: allowedHeaders } },
      {
        partId: field.name,
        layout: 'named',
        depth,
        nestedFields,
        nestedMediaType: nestedFields ? nestedMedia : undefined,
        contentTypeRequiresChoice: contentTypeRequiresChoice(field.encoding.contentTypes),
      },
    );
  });
}

function positionalField(options: {
  readonly index: number;
  readonly parentId: string | undefined;
  readonly mediaType: string;
  readonly schema: SchemaValue;
  readonly itemSchema: SchemaValue | undefined;
  readonly encodingObject: JsonRecord;
  readonly document: Record<string, unknown>;
  readonly diagnostics: FormBodyDiagnostic[];
  readonly depth: number;
  readonly extraItem?: boolean;
}): Oas32FormField {
  const partId = options.parentId ? `${options.parentId}.${options.index}` : String(options.index);
  const schema = options.schema;
  const record = isRecord(schema) ? schema : undefined;
  const encoding = encodingContentTypes(options.encodingObject, schema, options.diagnostics, partId, options.mediaType);
  const headers = isMultipartMedia(options.mediaType)
    ? encodingHeaders(options.encodingObject, partId, options.mediaType, options.document, options.diagnostics)
    : [];
  if (
    isFormDataMedia(options.mediaType) &&
    !headers.some((header) => header.name.toLowerCase() === 'content-disposition')
  ) {
    options.diagnostics.push(
      diagnostic(
        'HEADER_REQUIRED',
        `Positional multipart/form-data part ${partId} must describe Content-Disposition and a part name.`,
        partId,
        'Content-Disposition',
      ),
    );
  }
  const nestedMedia =
    encoding.contentTypes.find((value) => isMultipartMedia(value)) ??
    (typeof options.encodingObject.contentType === 'string' && isMultipartMedia(options.encodingObject.contentType)
      ? options.encodingObject.contentType
      : undefined);
  let nestedFields: Oas32FormField[] | undefined;
  if (nestedMedia && nestedEncodingPresent(options.encodingObject)) {
    if (options.depth >= DEFAULT_LIMITS.maxDepth) {
      options.diagnostics.push(
        diagnostic(
          'NESTING_UNSUPPORTED',
          `Nested multipart encoding for ${partId} exceeds one supported level.`,
          partId,
        ),
      );
    } else if (encodingConflict(options.encodingObject)) {
      options.diagnostics.push(
        diagnostic(
          'ENCODING_CONFLICT',
          `Nested encoding for ${partId} cannot mix named and positional encoding.`,
          partId,
        ),
      );
    } else {
      nestedFields = analyzeEncodingLevel({
        mediaType: nestedMedia,
        schema,
        itemSchema: options.itemSchema,
        encoding: options.encodingObject.encoding,
        prefixEncoding: options.encodingObject.prefixEncoding,
        itemEncoding: options.encodingObject.itemEncoding,
        fileFields: [],
        multipleFileFields: [],
        document: options.document,
        diagnostics: options.diagnostics,
        depth: options.depth + 1,
        parentId: partId,
      });
    }
  }
  const file = !nestedFields && isBinarySchema(schema);
  return {
    name: partId,
    partId,
    layout: 'positional',
    depth: options.depth,
    schema,
    itemSchema: options.itemSchema,
    type: file ? 'file' : schemaType(schema),
    format: record && typeof record.format === 'string' ? record.format : undefined,
    required: false,
    readOnly: record?.readOnly === true,
    file,
    multiple: false,
    encoding: {
      kind: encoding.kind,
      contentTypes: encoding.contentTypes,
      contentTypeExplicit: encoding.contentTypeExplicit,
      ...(encoding.kind === 'style'
        ? { style: encoding.style, explode: encoding.explode, allowReserved: encoding.allowReserved }
        : {}),
      headers,
    },
    nestedFields,
    nestedMediaType: nestedFields ? nestedMedia : undefined,
    contentTypeRequiresChoice: contentTypeRequiresChoice(encoding.contentTypes),
    extraItem: options.extraItem,
  };
}

function analyzeEncodingLevel(options: {
  readonly mediaType: string;
  readonly schema: SchemaValue | undefined;
  readonly itemSchema: SchemaValue | undefined;
  readonly encoding: unknown;
  readonly prefixEncoding: unknown;
  readonly itemEncoding: unknown;
  readonly fileFields: readonly string[];
  readonly multipleFileFields: readonly string[];
  readonly document: Record<string, unknown>;
  readonly diagnostics: FormBodyDiagnostic[];
  readonly depth: number;
  readonly parentId?: string;
}): Oas32FormField[] {
  const hasNamed = options.encoding !== undefined;
  const hasPositional = options.prefixEncoding !== undefined || options.itemEncoding !== undefined;
  if (hasNamed && hasPositional) {
    options.diagnostics.push(
      diagnostic('ENCODING_CONFLICT', 'encoding cannot be used together with prefixEncoding or itemEncoding.'),
    );
  }
  if (hasNamed && !namedEncodingApplies(options.mediaType)) {
    options.diagnostics.push(
      diagnostic('ENCODING_IGNORED', `Named encoding does not apply to ${mediaTypeEssence(options.mediaType)}.`),
    );
  }
  if (hasPositional && !positionalEncodingApplies(options.mediaType)) {
    options.diagnostics.push(
      diagnostic('ENCODING_IGNORED', `Positional encoding does not apply to ${mediaTypeEssence(options.mediaType)}.`),
    );
  }

  const schemaRecord = isRecord(options.schema) ? options.schema : undefined;
  const arraySchema = Boolean(
    schemaRecord && (schemaType(schemaRecord) === 'array' || Array.isArray(schemaRecord.prefixItems)),
  );
  const objectSchema = Boolean(schemaRecord && isRecord(schemaRecord.properties));
  const conflict = hasNamed && hasPositional;
  const useNamed = !conflict && namedEncodingApplies(options.mediaType) && objectSchema && !hasPositional;
  const usePositional =
    !conflict &&
    positionalEncodingApplies(options.mediaType) &&
    !hasNamed &&
    (hasPositional || arraySchema || options.itemSchema !== undefined);

  if (hasPositional && !arraySchema && options.itemSchema === undefined) {
    options.diagnostics.push(
      diagnostic(
        'POSITIONAL_SCHEMA_REQUIRED',
        'prefixEncoding and itemEncoding require an array schema or itemSchema.',
      ),
    );
  }

  if (useNamed && schemaRecord) {
    const analyzed = analyzeOas31FormBody({
      mediaType: options.mediaType,
      schema: schemaRecord,
      encoding: isRecord(options.encoding) ? options.encoding : undefined,
      fileFields: options.fileFields,
      multipleFileFields: options.multipleFileFields,
      document: options.document,
    });
    return namedFieldsFromOas31(
      options.mediaType,
      analyzed,
      options.diagnostics,
      options.document,
      options.encoding,
      options.depth,
    );
  }

  if (!usePositional) return [];

  const prefixEncodings = Array.isArray(options.prefixEncoding)
    ? options.prefixEncoding.map((item) => (isRecord(item) ? item : {}))
    : [];
  if (options.prefixEncoding !== undefined && !Array.isArray(options.prefixEncoding)) {
    options.diagnostics.push(diagnostic('ENCODING_INVALID', 'prefixEncoding must be an array of Encoding Objects.'));
  }
  const itemEncodingObject =
    options.itemEncoding === undefined ? undefined : isRecord(options.itemEncoding) ? options.itemEncoding : null;
  if (options.itemEncoding !== undefined && itemEncodingObject === null) {
    options.diagnostics.push(diagnostic('ENCODING_INVALID', 'itemEncoding must be an Encoding Object.'));
  }
  const prefixItems = schemaRecord && Array.isArray(schemaRecord.prefixItems) ? schemaRecord.prefixItems : [];
  const slotCount = Math.max(prefixEncodings.length, prefixItems.length);
  const fields: Oas32FormField[] = [];
  for (let index = 0; index < slotCount; index += 1) {
    const encodingObject = index < prefixEncodings.length ? prefixEncodings[index] : {};
    const completeItem = schemaRecord ? arrayItemSchema(schemaRecord, index) : true;
    const schema = options.itemSchema !== undefined && schemaRecord === undefined ? options.itemSchema : completeItem;
    fields.push(
      positionalField({
        index,
        parentId: options.parentId,
        mediaType: options.mediaType,
        schema,
        itemSchema: options.itemSchema,
        encodingObject,
        document: options.document,
        diagnostics: options.diagnostics,
        depth: options.depth,
      }),
    );
  }
  if (itemEncodingObject) {
    const nextIndex = slotCount;
    const completeItem = schemaRecord ? arrayItemSchema(schemaRecord, nextIndex) : true;
    const schema = options.itemSchema !== undefined && schemaRecord === undefined ? options.itemSchema : completeItem;
    fields.push(
      positionalField({
        index: nextIndex,
        parentId: options.parentId,
        mediaType: options.mediaType,
        schema,
        itemSchema: options.itemSchema,
        encodingObject: itemEncodingObject,
        document: options.document,
        diagnostics: options.diagnostics,
        depth: options.depth,
        extraItem: true,
      }),
    );
  }
  return fields;
}

export function analyzeOas32FormBody(options: AnalyzeOas32FormBodyOptions): Oas32FormBodyModel {
  const diagnostics: FormBodyDiagnostic[] = [];
  const schemaAppliesTo =
    options.schema && options.itemSchema !== undefined
      ? 'both'
      : options.itemSchema !== undefined
        ? 'items'
        : 'complete';
  const streaming = options.itemSchema !== undefined && options.schema === undefined;
  if (streaming) {
    diagnostics.push(
      diagnostic(
        'STREAMING_UNSUPPORTED',
        'Streaming multipart itemSchema is not consumed as an infinite request; only a finite editor list is materialized.',
      ),
    );
  }
  const fields = analyzeEncodingLevel({ ...options, diagnostics, depth: 0 });
  if (fields.length === 0 && options.itemSchema === undefined) {
    const schemaRecord = isRecord(options.schema) ? options.schema : undefined;
    if (!schemaRecord || (!isRecord(schemaRecord.properties) && schemaType(schemaRecord) !== 'array')) {
      diagnostics.push(
        diagnostic(
          'FORM_SCHEMA_NOT_OBJECT',
          `OAS 3.2 form body ${options.mediaType} requires an object schema, an array schema, or itemSchema.`,
        ),
      );
    }
  }
  const extraItemTemplate = fields.find((field) => field.extraItem);
  const prefixFields = fields.filter((field) => !field.extraItem);
  const hasNamed = prefixFields.some((field) => field.layout === 'named');
  return {
    layout: hasNamed ? 'named' : 'positional',
    mediaType: options.mediaType,
    fields: prefixFields,
    extraItemTemplate,
    streaming,
    schemaAppliesTo,
    diagnostics,
  };
}

function utf8Bytes(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

function contentEncodingValue(schema: SchemaValue): string | undefined {
  return isRecord(schema) && typeof schema.contentEncoding === 'string' && schema.contentEncoding
    ? schema.contentEncoding
    : undefined;
}

function fakeParameter(field: Oas31FormField): DebugParam {
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

function serializePartHeaders(
  field: Oas31FormField,
  rawValues: Readonly<Record<string, string>>,
  diagnostics: FormBodyDiagnostic[],
): Record<string, string> {
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

function rawFileMetadata(value: unknown): FormFileMetadata | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null;
  return {
    name: value.name,
    type: typeof value.type === 'string' ? value.type : undefined,
    size: typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : undefined,
  };
}

function representation(
  field: Oas31FormField,
  instance: ParameterInstance,
  contentType: string,
  diagnostics: FormBodyDiagnostic[],
): string | null {
  if (isJsonMediaType(contentType)) return JSON.stringify(instance);
  if (instance === null) return 'null';
  if (typeof instance === 'string' || typeof instance === 'number' || typeof instance === 'boolean')
    return String(instance);
  diagnostics.push(
    diagnostic(
      'UNSUPPORTED_CONTENT_TYPE',
      `Field ${field.name} cannot serialize a structured value as ${contentType}.`,
      field.name,
    ),
  );
  return null;
}

function chosenContentType(
  field: Oas32FormField,
  input: SerializeOas31FormBodyInput,
  diagnostics: FormBodyDiagnostic[],
  fallbackIndex?: number,
): string | undefined {
  const selected = input.partContentTypes?.[field.partId] ?? input.partContentTypes?.[field.name];
  if (selected && validMediaType(selected)) {
    if (field.encoding.contentTypeExplicit) {
      const matches = field.encoding.contentTypes.some((candidate) => {
        const expected = mediaTypeEssence(candidate);
        const actual = mediaTypeEssence(selected);
        if (expected === '*/*') return true;
        if (expected.endsWith('/*')) return actual.startsWith(expected.slice(0, -1));
        return actual === expected;
      });
      if (!matches) {
        diagnostics.push(
          diagnostic(
            'FILE_MEDIA_TYPE',
            `Part ${field.name} has media type ${selected}, expected ${field.encoding.contentTypes.join(', ')}.`,
            field.name,
          ),
        );
      }
    }
    return selected;
  }
  if (field.contentTypeRequiresChoice) {
    diagnostics.push(
      diagnostic(
        'CONTENT_TYPE_CHOICE_REQUIRED',
        `Part ${field.name} lists multiple or wildcard content types; choose one explicitly.`,
        field.name,
      ),
    );
    return undefined;
  }
  if (field.encoding.contentTypeExplicit) return field.encoding.contentTypes[0] ?? 'application/octet-stream';
  const defaults = defaultContentTypes(field.schema, fallbackIndex);
  return defaults.length === 1 ? defaults[0] : 'application/octet-stream';
}

function parsedTextValue(
  field: Oas32FormField,
  rawValue: string,
  contentType: string,
  diagnostics: FormBodyDiagnostic[],
) {
  const parameter = fakeParameter(field);
  if (isJsonMediaType(contentType)) parameter.parameterSerialization = { kind: 'content', mediaType: contentType };
  const parsed = parseOas31ParameterValue(parameter, rawValue);
  if (!parsed.ok) {
    diagnostics.push(
      diagnostic(
        parsed.kind === 'unsafe-number' ? 'FORM_UNSAFE_NUMBER' : 'FORM_INPUT_INVALID_JSON',
        parsed.message,
        field.name,
      ),
    );
    return { instance: rawValue as ParameterInstance, text: rawValue };
  }
  const serialized = representation(field, parsed.instance, contentType, diagnostics);
  return { instance: parsed.instance, text: serialized ?? rawValue };
}

function collectActiveFields(model: Oas32FormBodyModel, input: SerializeOas31FormBodyInput): Oas32FormField[] {
  const fields = [...model.fields];
  if (model.extraItemTemplate && model.layout === 'positional') {
    const present = new Set([...Object.keys(input.formFields ?? {}), ...Object.keys(input.fileFields ?? {})]);
    const extraIndexes = Array.from(present)
      .map((name) => Number(name))
      .filter((index) => Number.isInteger(index) && index >= model.fields.length)
      .sort((left, right) => left - right);
    for (const index of extraIndexes) {
      fields.push({
        ...model.extraItemTemplate,
        name: String(index),
        partId: String(index),
        extraItem: true,
      });
    }
  }
  return fields;
}

function countParts(parts: readonly MultipartPart[]): number {
  return parts.reduce((total, part) => total + 1 + (part.kind === 'nested' ? countParts(part.parts) : 0), 0);
}

function estimatePartBytes(part: MultipartPart): number {
  const headerBytes = Object.entries(part.headers).reduce(
    (total, [name, value]) => total + utf8Bytes(name) + utf8Bytes(value) + 4,
    80,
  );
  if (part.kind === 'text') return headerBytes + utf8Bytes(part.value);
  if (part.kind === 'file') return headerBytes + (part.fileSize ?? 0);
  return headerBytes + part.parts.reduce((total, nested) => total + estimatePartBytes(nested), 0);
}

function serializeField(
  field: Oas32FormField,
  input: SerializeOas31FormBodyInput,
  diagnostics: FormBodyDiagnostic[],
  instance: Record<string, ParameterInstance>,
  ignoredProperties: string[],
  mediaType: string,
): MultipartPart[] {
  if (field.readOnly) {
    ignoredProperties.push(field.name);
    return [];
  }
  if (field.nestedFields && field.nestedFields.length > 0) {
    const nestedParts: MultipartPart[] = [];
    for (const child of field.nestedFields.filter((item) => !item.extraItem)) {
      nestedParts.push(
        ...serializeField(child, input, diagnostics, instance, ignoredProperties, field.nestedMediaType ?? mediaType),
      );
    }
    const template = field.nestedFields.find((item) => item.extraItem);
    if (template) {
      const prefixCount = field.nestedFields.filter((item) => !item.extraItem).length;
      const present = Object.keys(input.formFields ?? {})
        .concat(Object.keys(input.fileFields ?? {}))
        .filter((name) => name.startsWith(`${field.partId}.`))
        .map((name) => Number(name.slice(field.partId.length + 1).split('.')[0]))
        .filter((index) => Number.isInteger(index) && index >= prefixCount);
      for (const index of Array.from(new Set(present)).sort((left, right) => left - right)) {
        nestedParts.push(
          ...serializeField(
            { ...template, name: `${field.partId}.${index}`, partId: `${field.partId}.${index}` },
            input,
            diagnostics,
            instance,
            ignoredProperties,
            field.nestedMediaType ?? mediaType,
          ),
        );
      }
    }
    if (nestedParts.length === 0) return [];
    const headers = serializePartHeaders(
      field,
      input.partHeaders?.[field.partId] ?? input.partHeaders?.[field.name] ?? {},
      diagnostics,
    );
    const nested: MultipartNestedPart = {
      kind: 'nested',
      sourceField: field.name,
      name: field.layout === 'named' ? field.name : '',
      contentType: field.nestedMediaType ?? 'multipart/mixed',
      headers,
      parts: nestedParts,
    };
    return [nested];
  }

  if (field.file) {
    ignoredProperties.push(field.name);
    const files = (input.fileFields?.[field.partId] ?? input.fileFields?.[field.name] ?? [])
      .map(rawFileMetadata)
      .filter((value): value is FormFileMetadata => value !== null);
    if (files.length === 0) {
      if (field.required)
        diagnostics.push(diagnostic('FILE_REQUIRED', `File field ${field.name} is required.`, field.name));
      return [];
    }
    const headers = serializePartHeaders(
      field,
      input.partHeaders?.[field.partId] ?? input.partHeaders?.[field.name] ?? {},
      diagnostics,
    );
    const selected = field.multiple ? files : files.slice(0, 1);
    if (!field.multiple && files.length > 1) {
      diagnostics.push(diagnostic('FILE_CARDINALITY', `File field ${field.name} requires 0..1 files.`, field.name));
    }
    const parts: MultipartFilePart[] = [];
    for (const [index, file] of Array.from(selected.entries())) {
      const contentType = chosenContentType(field, input, diagnostics, index);
      if (!contentType) continue;
      parts.push({
        kind: 'file',
        sourceField: field.name,
        name: field.layout === 'named' ? field.name : '',
        fileIndex: index,
        fileName: file.name,
        ...(file.size === undefined ? {} : { fileSize: file.size }),
        contentType,
        headers,
      });
    }
    return parts;
  }

  const rawValue = input.formFields?.[field.partId] ?? input.formFields?.[field.name];
  if (rawValue === undefined) return [];
  const includeEmpty = new Set(input.formFieldNamesToIncludeWhenEmpty ?? []);
  if (rawValue === '' && !includeEmpty.has(field.name) && !includeEmpty.has(field.partId)) return [];
  const headers = serializePartHeaders(
    field,
    input.partHeaders?.[field.partId] ?? input.partHeaders?.[field.name] ?? {},
    diagnostics,
  );
  const contentType = chosenContentType(field, input, diagnostics);
  if (!contentType) return [];
  if (field.encoding.kind === 'style') {
    const parameter = fakeParameter(field);
    try {
      const serialized = serializeOas31Parameters(
        { pathParams: [], queryParams: [parameter], headerParams: [], cookieParams: [] },
        { [`query:${field.name}`]: rawValue },
      );
      diagnostics.push(
        ...serialized.diagnostics.map((item) =>
          diagnostic(
            item.kind === 'unsafe-number' ? 'FORM_UNSAFE_NUMBER' : 'FORM_INPUT_INVALID_JSON',
            item.message,
            field.name,
          ),
        ),
      );
      if (serialized.instances[0]) instance[field.name] = serialized.instances[0].instance;
      return serialized.query.map((entry) => {
        const part: MultipartTextPart = {
          kind: 'text',
          sourceField: field.name,
          name: field.layout === 'named' ? entry.name : '',
          value: entry.value,
          contentType: 'text/plain',
          headers,
        };
        return part;
      });
    } catch (reason) {
      diagnostics.push(
        diagnostic('ENCODING_INVALID', reason instanceof Error ? reason.message : String(reason), field.name),
      );
    }
  }
  const parsed = parsedTextValue(field, rawValue, contentType, diagnostics);
  instance[field.name] = parsed.instance;
  const part: MultipartTextPart = {
    kind: 'text',
    sourceField: field.name,
    name: field.layout === 'named' ? field.name : '',
    value: parsed.text,
    contentType,
    headers,
  };
  return [part];
}

function inferAuthoredBoundary(body: string): string | undefined {
  const firstLine = body.split(/\r\n|\n/, 1)[0] ?? '';
  if (!firstLine.startsWith('--')) return undefined;
  let token = firstLine.slice(2);
  if (token.endsWith('--')) token = token.slice(0, -2);
  token = token.trim();
  if (!token || /[\r\n"]/u.test(token)) return undefined;
  return token;
}

function pairAuthoredContentType(mediaType: string, body: string): string {
  if (mediaTypeBoundary(mediaType)) return mediaType;
  const inferred = inferAuthoredBoundary(body);
  if (!inferred) return mediaType;
  const trimmed = mediaType.trim();
  return trimmed ? `${trimmed}; boundary=${inferred}` : `multipart/mixed; boundary=${inferred}`;
}

function authoredDiagnostics(mediaType: string, body: string): FormBodyDiagnostic[] {
  const diagnostics: FormBodyDiagnostic[] = [];
  const boundary = mediaTypeBoundary(mediaType);
  if (!boundary) {
    diagnostics.push(
      diagnostic(
        'AUTHORED_BOUNDARY_MISMATCH',
        'Authored multipart text must be paired with the media type boundary parameter; Knife4j will not regenerate it.',
      ),
    );
  } else if (body.length > 0 && !body.includes(`--${boundary}`)) {
    diagnostics.push(
      diagnostic(
        'AUTHORED_BOUNDARY_MISMATCH',
        'Authored multipart text does not contain the media type boundary parameter.',
      ),
    );
  }
  return diagnostics;
}

export function serializeOas32FormBody(
  bodyContent: BodyContent,
  input: SerializeOas31FormBodyInput,
): FormBodyEncodingPlan {
  if (!bodyContent.oas32Form || (bodyContent.category !== 'urlencoded' && bodyContent.category !== 'multipart')) {
    throw new Error('The selected body does not use the OAS 3.2 form encoding path.');
  }
  const started = (input.now ?? Date.now)();
  const limits = { ...DEFAULT_LIMITS, ...(input.limits ?? {}) };
  const diagnostics: FormBodyDiagnostic[] = [...bodyContent.oas32Form.diagnostics];
  if (input.signal?.aborted) {
    diagnostics.push(diagnostic('FORM_MATERIALIZATION_TIMEOUT', 'Multipart materialization was cancelled.'));
  }

  if (bodyContent.category === 'urlencoded') {
    if (!bodyContent.oas31Form) {
      return { kind: 'urlencoded', body: '', entries: [], instance: {}, ignoredProperties: [], diagnostics };
    }
    return serializeOas32Urlencoded(bodyContent, input, diagnostics);
  }

  const instance = Object.create(null) as Record<string, ParameterInstance>;
  const ignoredProperties: string[] = [];
  const fields = collectActiveFields(bodyContent.oas32Form, input);
  const parts: MultipartPart[] = [];
  for (const field of fields) {
    if (input.signal?.aborted || (input.now ?? Date.now)() - started > limits.maxMaterializationMs) {
      diagnostics.push(
        diagnostic('FORM_MATERIALIZATION_TIMEOUT', 'Multipart materialization exceeded the time budget.'),
      );
      break;
    }
    if (field.depth > limits.maxDepth) {
      diagnostics.push(
        diagnostic(
          'FORM_DEPTH_EXCEEDED',
          `Multipart nesting for ${field.name} exceeds the supported depth.`,
          field.name,
        ),
      );
      continue;
    }
    parts.push(...serializeField(field, input, diagnostics, instance, ignoredProperties, bodyContent.mediaType));
  }

  const partCount = countParts(parts);
  if (input.bodyRequired && partCount === 0) {
    diagnostics.push(diagnostic('FORM_BODY_REQUIRED', 'The request body is required but has no encoded values.'));
  }
  if (partCount > limits.maxParts) {
    diagnostics.push(diagnostic('FORM_BUDGET_EXCEEDED', `Form body contains ${partCount} encoded values.`));
  }
  const totalBytes = parts.reduce((total, part) => total + estimatePartBytes(part), 0);
  if (totalBytes > limits.maxTotalBytes) {
    diagnostics.push(
      diagnostic(
        'FORM_BUDGET_EXCEEDED',
        'Form body exceeds the configured upload budget including files and MIME framing.',
      ),
    );
  }
  for (const part of parts) {
    if (part.kind === 'text' && utf8Bytes(part.value) > limits.maxFieldBytes) {
      diagnostics.push(
        diagnostic(
          'FORM_BUDGET_EXCEEDED',
          `Form field ${part.sourceField} exceeds the configured input budget.`,
          part.sourceField,
        ),
      );
    }
  }

  const logicalInstance =
    bodyContent.oas32Form.layout === 'positional'
      ? (fields.map((field) => instance[field.name]).filter((value) => value !== undefined) as unknown as Record<
          string,
          ParameterInstance
        >)
      : instance;

  return {
    kind: 'multipart',
    mediaType: bodyContent.mediaType,
    parts,
    instance: logicalInstance,
    ignoredProperties,
    diagnostics,
    specFamily: '3.2',
    wire: 'parts',
  };
}

function serializeOas32Urlencoded(
  bodyContent: BodyContent,
  input: SerializeOas31FormBodyInput,
  diagnostics: FormBodyDiagnostic[],
): FormBodyEncodingPlan {
  const plan = serializeOas31FormBody({ ...bodyContent, oas31Form: bodyContent.oas31Form }, input);
  if (plan.kind !== 'urlencoded') return plan;
  return {
    ...plan,
    diagnostics: [...diagnostics.filter((item) => !plan.diagnostics.includes(item)), ...plan.diagnostics],
  };
}

export function authoredMultipartPlan(
  mediaType: string,
  body: string,
): Extract<FormBodyEncodingPlan, { kind: 'multipart' }> {
  const authoredContentType = pairAuthoredContentType(mediaType, body);
  return {
    kind: 'multipart',
    mediaType,
    parts: [],
    instance: {},
    ignoredProperties: [],
    diagnostics: authoredDiagnostics(authoredContentType, body),
    specFamily: '3.2',
    wire: 'authored',
    authoredBody: body,
    authoredContentType,
  };
}

export function oas32FormFieldsFromInstance(
  model: Oas32FormBodyModel,
  data: ParameterInstance,
): Record<string, string> {
  const fields = Object.create(null) as Record<string, string>;
  const stringify = (item: unknown): string =>
    typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null
      ? String(item)
      : JSON.stringify(item);
  const fill = (field: Oas32FormField, value: unknown): void => {
    if (field.file || value === undefined) return;
    const nestedPrefix = field.nestedFields?.filter((item) => !item.extraItem) ?? [];
    const nestedTemplate = field.nestedFields?.find((item) => item.extraItem);
    if (nestedPrefix.length > 0 || nestedTemplate) {
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          const child =
            nestedPrefix[index] ??
            (nestedTemplate
              ? { ...nestedTemplate, name: `${field.partId}.${index}`, partId: `${field.partId}.${index}` }
              : undefined);
          if (child) fill(child, item);
        });
        return;
      }
      if (isRecord(value)) {
        for (const child of nestedPrefix) {
          if (hasOwn(value, child.name)) fill(child, value[child.name]);
        }
      }
      return;
    }
    fields[field.name] = stringify(value);
  };
  if (model.layout === 'positional' && Array.isArray(data)) {
    data.forEach((item, index) => {
      const field =
        model.fields[index] ??
        (model.extraItemTemplate
          ? { ...model.extraItemTemplate, name: String(index), partId: String(index) }
          : undefined);
      if (field) fill(field, item);
    });
    return fields;
  }
  if (isRecord(data)) {
    for (const field of model.fields) {
      if (hasOwn(data, field.name)) fill(field, data[field.name]);
    }
  }
  return fields;
}
