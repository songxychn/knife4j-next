import type {
  BuiltParameterInstance,
  DebugParam,
  Oas31ParameterSerialization,
  ParameterInputDiagnostic,
  ParameterInstance,
  SchemaValue,
} from './types';

export interface SerializedQueryParameter {
  readonly name: string;
  readonly value: string;
  readonly encodedName: string;
  readonly encodedValue: string;
}

export interface SerializedCookieParameter {
  readonly name: string;
  readonly value: string;
}

export interface SerializedOas31Parameters {
  readonly path: Record<string, string>;
  readonly query: SerializedQueryParameter[];
  readonly headers: Record<string, string>;
  readonly cookies: SerializedCookieParameter[];
  readonly instances: BuiltParameterInstance[];
  readonly diagnostics: ParameterInputDiagnostic[];
  readonly consumedQueryNames: string[];
  readonly consumedHeaderNames: string[];
  readonly consumedCookieNames: string[];
}

type ParseResult =
  | { readonly ok: true; readonly instance: ParameterInstance }
  | {
      readonly ok: false;
      readonly kind: ParameterInputDiagnostic['kind'];
      readonly message: string;
    };

type SerializedParameter =
  | { readonly in: 'path'; readonly value: string }
  | { readonly in: 'query'; readonly pairs: SerializedQueryParameter[] }
  | { readonly in: 'header'; readonly value: string | undefined }
  | { readonly in: 'cookie'; readonly pairs: SerializedCookieParameter[] };

const UNRESERVED = /^[A-Za-z0-9._~-]$/;
const QUERY_RESERVED_PASSTHROUGH = new Set([':', '/', '?', '@', '!', '$', "'", '(', ')', '*', ',', ';']);

export function parameterKey(param: Pick<DebugParam, 'in' | 'name'>): string {
  return `${param.in}:${param.name}`;
}

/** RFC3986 encoding (encodeURIComponent leaves !'()* unescaped). */
export function encodeParameterComponent(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * RFC6570 reserved expansion for OAS query values.
 *
 * Query/form separators, illegal query characters, and bare percent signs still
 * need encoding. Existing percent-encoded triples pass through unchanged.
 */
export function encodeReservedQueryValue(value: string): string {
  let result = '';
  for (let index = 0; index < value.length;) {
    if (value[index] === '%' && /^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
      result += value.slice(index, index + 3);
      index += 3;
      continue;
    }

    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    if (UNRESERVED.test(character) || QUERY_RESERVED_PASSTHROUGH.has(character)) {
      result += character;
    } else {
      result += encodeParameterComponent(character);
    }
    index += character.length;
  }
  return result;
}

function encodeValue(value: string, allowReserved: boolean): string {
  return allowReserved ? encodeReservedQueryValue(value) : encodeParameterComponent(value);
}

/** WHATWG application/x-www-form-urlencoded encoding for content-based query parameters. */
function encodeFormComponent(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/[!'()~]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function isRecord(value: unknown): value is { [key: string]: ParameterInstance } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitive(value: ParameterInstance): value is null | string | number | boolean {
  return value === null || typeof value !== 'object';
}

function scalarText(value: null | string | number | boolean): string {
  return value === null ? '' : String(value);
}

function definedPrimitiveArray(value: ParameterInstance[]): Array<string | number | boolean> {
  if (!value.every(isPrimitive)) {
    throw new Error('Nested array or object parameter values do not have a defined OAS serialization.');
  }
  return value.filter((item): item is string | number | boolean => item !== null && isPrimitive(item));
}

function definedPrimitiveEntries(value: {
  [key: string]: ParameterInstance;
}): Array<readonly [string, string | number | boolean]> {
  const entries = Object.entries(value);
  if (!entries.every((entry): entry is [string, null | string | number | boolean] => isPrimitive(entry[1]))) {
    throw new Error('Nested array or object parameter values do not have a defined OAS serialization.');
  }
  return entries.filter(
    (entry): entry is [string, string | number | boolean] => entry[1] !== null && isPrimitive(entry[1]),
  );
}

/** RFC6570 treats an empty composite, or a map with only undefined members, as undefined. */
function isUndefinedComposite(value: ParameterInstance): boolean {
  if (Array.isArray(value)) return definedPrimitiveArray(value).length === 0;
  if (isRecord(value)) return definedPrimitiveEntries(value).length === 0;
  return false;
}

function jsonValueType(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (isRecord(value)) return 'object';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'string' || typeof value === 'boolean') return typeof value;
  return undefined;
}

function schemaTypes(schema: SchemaValue | undefined, depth = 0): string[] {
  if (!schema || typeof schema === 'boolean' || depth > 8) return [];
  const types = new Set<string>();
  if (typeof schema.type === 'string') types.add(schema.type);
  if (Array.isArray(schema.type)) {
    schema.type.forEach((value) => {
      if (typeof value === 'string') types.add(value);
    });
  }
  if (schema.properties !== undefined) types.add('object');
  if (schema.items !== undefined || schema.prefixItems !== undefined) types.add('array');

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    const type = jsonValueType(schema.const);
    if (type) types.add(type);
  }
  if (Array.isArray(schema.enum)) {
    schema.enum.forEach((value) => {
      const type = jsonValueType(value);
      if (type) types.add(type);
    });
  }

  for (const keyword of ['oneOf', 'anyOf', 'allOf'] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    branches.forEach((branch) => {
      if (typeof branch !== 'boolean' && !isRecord(branch)) return;
      schemaTypes(branch as SchemaValue, depth + 1).forEach((type) => types.add(type));
    });
  }
  return Array.from(types);
}

function acceptsUntypedJsonSyntax(schema: SchemaValue | undefined): boolean {
  if (typeof schema === 'boolean') return true;
  if (!schema || typeof schema !== 'object') return false;
  return (
    Object.keys(schema).length === 0 ||
    typeof schema.$ref === 'string' ||
    Array.isArray(schema.oneOf) ||
    Array.isArray(schema.anyOf) ||
    Array.isArray(schema.allOf)
  );
}

function matchesDeclaredType(value: unknown, type: string): boolean {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isRecord(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

const JSON_NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** Find a JSON number that the JavaScript runtime would silently round outside its safe integer range. */
function unsafeJsonNumber(rawValue: string): string | undefined {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < rawValue.length; index += 1) {
    const character = rawValue[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== '-' && !/[0-9]/.test(character)) continue;
    JSON_NUMBER.lastIndex = index;
    const match = JSON_NUMBER.exec(rawValue);
    if (!match || match.index !== index) continue;
    const numericValue = Number(match[0]);
    if (!Number.isFinite(numericValue) || (Number.isInteger(numericValue) && !Number.isSafeInteger(numericValue))) {
      return match[0];
    }
    index = JSON_NUMBER.lastIndex - 1;
  }
  return undefined;
}

function invalidJson(message: string): ParseResult {
  return { ok: false, kind: 'invalid-json', message };
}

function parseJson(rawValue: string): ParseResult {
  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (unsafeJsonNumber(rawValue) !== undefined) {
      return {
        ok: false,
        kind: 'unsafe-number',
        message: 'The parameter value contains a JSON number that JavaScript cannot represent safely.',
      };
    }
    if (
      parsed === null ||
      typeof parsed === 'string' ||
      typeof parsed === 'number' ||
      typeof parsed === 'boolean' ||
      Array.isArray(parsed) ||
      isRecord(parsed)
    ) {
      return { ok: true, instance: parsed as ParameterInstance };
    }
  } catch {
    // Returned below as a stable input diagnostic.
  }
  return invalidJson('The parameter value is not valid JSON.');
}

export function parseOas31ParameterValue(param: DebugParam, rawValue: string): ParseResult {
  const serialization = param.parameterSerialization;
  if (!serialization) return { ok: true, instance: rawValue };

  const types = schemaTypes(param.schema);
  if (serialization.kind === 'content' && isJsonMediaType(serialization.mediaType)) {
    return parseJson(rawValue);
  }

  if (types.includes('null') && rawValue === 'null') return { ok: true, instance: null };

  const nonNullTypes = types.filter((type) => type !== 'null');
  // A nullable string needs one JSON-string escape hatch so the editor can
  // distinguish the string "null" from the null instance. Ordinary strings
  // remain plain text; only a valid quoted JSON string takes this path.
  if (types.includes('null') && nonNullTypes.length === 1 && nonNullTypes[0] === 'string') {
    const parsed = parseJson(rawValue);
    if (parsed.ok && typeof parsed.instance === 'string') return parsed;
  }
  if (nonNullTypes.length === 0 && acceptsUntypedJsonSyntax(param.schema)) {
    const parsed = parseJson(rawValue);
    return parsed.ok || parsed.kind === 'unsafe-number' ? parsed : { ok: true, instance: rawValue };
  }
  if (nonNullTypes.length > 1) {
    const parsed = parseJson(rawValue);
    if (parsed.ok && nonNullTypes.some((type) => matchesDeclaredType(parsed.instance, type))) return parsed;
    if (!parsed.ok && parsed.kind === 'unsafe-number') return parsed;
    if (nonNullTypes.includes('string')) return { ok: true, instance: rawValue };
    return invalidJson('The parameter value does not match any declared JSON type.');
  }

  const expectedType = nonNullTypes[0] ?? param.type;
  if (expectedType === 'array' || expectedType === 'object') {
    const parsed = parseJson(rawValue);
    if (!parsed.ok) return parsed;
    if (!matchesDeclaredType(parsed.instance, expectedType)) {
      return invalidJson(`The parameter value must be a JSON ${expectedType}.`);
    }
    return parsed;
  }
  if (expectedType === 'boolean') {
    if (rawValue === 'true') return { ok: true, instance: true };
    if (rawValue === 'false') return { ok: true, instance: false };
    return invalidJson('The parameter value must be true or false.');
  }
  if (expectedType === 'integer' || expectedType === 'number') {
    const parsed = parseJson(rawValue);
    if (!parsed.ok) return parsed;
    if (!matchesDeclaredType(parsed.instance, expectedType)) {
      return invalidJson(`The parameter value must be a JSON ${expectedType}.`);
    }
    return parsed;
  }

  return { ok: true, instance: rawValue };
}

export function isJsonMediaType(mediaType: string): boolean {
  const essence = mediaType.split(';', 1)[0].trim().toLowerCase();
  return essence === 'application/json' || essence.endsWith('+json');
}

export function isTextMediaType(mediaType: string): boolean {
  return mediaType.split(';', 1)[0].trim().toLowerCase() === 'text/plain';
}

export function isSupportedParameterContentType(mediaType: string): boolean {
  return isJsonMediaType(mediaType) || isTextMediaType(mediaType);
}

function queryPair(name: string, value: string, allowReserved: boolean): SerializedQueryParameter {
  return {
    name,
    value,
    encodedName: encodeParameterComponent(name),
    encodedValue: encodeValue(value, allowReserved),
  };
}

function contentQueryPair(name: string, value: string): SerializedQueryParameter {
  return {
    name,
    value,
    encodedName: encodeFormComponent(name),
    encodedValue: encodeFormComponent(value),
  };
}

function encodedQueryPair(
  name: string,
  value: string,
  encodedName: string,
  encodedValue: string,
): SerializedQueryParameter {
  return { name, value, encodedName, encodedValue };
}

function serializeQuerySchema(
  name: string,
  instance: ParameterInstance,
  serialization: Extract<Oas31ParameterSerialization, { kind: 'schema' }>,
): SerializedQueryParameter[] {
  const { style, explode, allowReserved } = serialization;
  if (style === 'form') {
    if (Array.isArray(instance)) {
      const values = definedPrimitiveArray(instance).map(scalarText);
      return explode
        ? values.map((value) => queryPair(name, value, allowReserved))
        : [
            encodedQueryPair(
              name,
              values.join(','),
              encodeParameterComponent(name),
              values.map((value) => encodeValue(value, allowReserved)).join(','),
            ),
          ];
    }
    if (isRecord(instance)) {
      const entries = definedPrimitiveEntries(instance);
      if (explode) {
        return entries.map(([key, value]) => queryPair(key, scalarText(value), allowReserved));
      }
      const values = entries.flatMap(([key, value]) => [key, scalarText(value)]);
      return [
        encodedQueryPair(
          name,
          values.join(','),
          encodeParameterComponent(name),
          values.map((value) => encodeValue(value, allowReserved)).join(','),
        ),
      ];
    }
    return [queryPair(name, scalarText(instance), allowReserved)];
  }

  if (style === 'spaceDelimited' || style === 'pipeDelimited') {
    if (explode) throw new Error(`The OAS query style ${style} is undefined with explode=true.`);
    const delimiter = style === 'spaceDelimited' ? ' ' : '|';
    const encodedDelimiter = style === 'spaceDelimited' ? '%20' : '%7C';
    const values = Array.isArray(instance)
      ? definedPrimitiveArray(instance).map(scalarText)
      : isRecord(instance)
        ? definedPrimitiveEntries(instance).flatMap(([key, value]) => [key, scalarText(value)])
        : null;
    if (!values) throw new Error(`The OAS query style ${style} requires an array or object instance.`);
    return [
      encodedQueryPair(
        name,
        values.join(delimiter),
        encodeParameterComponent(name),
        values.map((value) => encodeValue(value, allowReserved)).join(encodedDelimiter),
      ),
    ];
  }

  if (style === 'deepObject') {
    if (!explode || !isRecord(instance)) {
      throw new Error('The OAS query style deepObject requires an object instance and explode=true.');
    }
    return definedPrimitiveEntries(instance).map(([key, value]) => {
      const pairName = `${name}[${key}]`;
      return encodedQueryPair(
        pairName,
        scalarText(value),
        `${encodeParameterComponent(name)}%5B${encodeParameterComponent(key)}%5D`,
        encodeValue(scalarText(value), allowReserved),
      );
    });
  }

  throw new Error(`Unsupported OAS query parameter style: ${style}.`);
}

function encodeScalars(values: Array<null | string | number | boolean>, delimiter: string): string {
  return values.map((value) => encodeParameterComponent(scalarText(value))).join(delimiter);
}

function serializeSimpleValue(instance: ParameterInstance, explode: boolean, delimiter: string): string {
  if (Array.isArray(instance)) return encodeScalars(definedPrimitiveArray(instance), delimiter);
  if (isRecord(instance)) {
    const entries = definedPrimitiveEntries(instance);
    if (explode) {
      return entries
        .map(([key, value]) => `${encodeParameterComponent(key)}=${encodeParameterComponent(scalarText(value))}`)
        .join(delimiter);
    }
    return entries
      .flatMap(([key, value]) => [encodeParameterComponent(key), encodeParameterComponent(scalarText(value))])
      .join(delimiter);
  }
  return encodeParameterComponent(scalarText(instance));
}

function serializePathSchema(
  name: string,
  instance: ParameterInstance,
  serialization: Extract<Oas31ParameterSerialization, { kind: 'schema' }>,
): string {
  const { style, explode } = serialization;
  if (style === 'simple') return serializeSimpleValue(instance, explode, ',');
  if (style === 'label') {
    return `.${serializeSimpleValue(instance, explode, explode ? '.' : ',')}`;
  }
  if (style === 'matrix') {
    const encodedName = encodeParameterComponent(name);
    if (Array.isArray(instance)) {
      const values = definedPrimitiveArray(instance);
      if (explode) {
        return values.map((value) => `;${encodedName}=${encodeParameterComponent(scalarText(value))}`).join('');
      }
      return `;${encodedName}=${encodeScalars(values, ',')}`;
    }
    if (isRecord(instance)) {
      const entries = definedPrimitiveEntries(instance);
      if (explode) {
        return entries
          .map(([key, value]) => `;${encodeParameterComponent(key)}=${encodeParameterComponent(scalarText(value))}`)
          .join('');
      }
      const flattened = entries
        .flatMap(([key, value]) => [encodeParameterComponent(key), encodeParameterComponent(scalarText(value))])
        .join(',');
      return `;${encodedName}=${flattened}`;
    }
    if (instance === null) return `;${encodedName}`;
    return `;${encodedName}=${encodeParameterComponent(scalarText(instance))}`;
  }
  throw new Error(`Unsupported OAS path parameter style: ${style}.`);
}

function serializeHeaderSchema(
  instance: ParameterInstance,
  serialization: Extract<Oas31ParameterSerialization, { kind: 'schema' }>,
): string {
  if (serialization.style !== 'simple') {
    throw new Error(`Unsupported OAS header parameter style: ${serialization.style}.`);
  }
  return serializeSimpleValue(instance, serialization.explode, ',');
}

function serializeCookieSchema(
  name: string,
  instance: ParameterInstance,
  serialization: Extract<Oas31ParameterSerialization, { kind: 'schema' }>,
): SerializedCookieParameter[] {
  if (serialization.style !== 'form') {
    throw new Error(`Unsupported OAS cookie parameter style: ${serialization.style}.`);
  }
  const encodedName = encodeParameterComponent(name);
  if (Array.isArray(instance)) {
    const values = definedPrimitiveArray(instance).map((value) => encodeParameterComponent(scalarText(value)));
    return serialization.explode
      ? values.map((value) => ({ name: encodedName, value }))
      : [{ name: encodedName, value: values.join(',') }];
  }
  if (isRecord(instance)) {
    const entries = definedPrimitiveEntries(instance);
    if (serialization.explode) {
      return entries.map(([key, value]) => ({
        name: encodeParameterComponent(key),
        value: encodeParameterComponent(scalarText(value)),
      }));
    }
    return [
      {
        name: encodedName,
        value: entries
          .flatMap(([key, value]) => [encodeParameterComponent(key), encodeParameterComponent(scalarText(value))])
          .join(','),
      },
    ];
  }
  return [{ name: encodedName, value: encodeParameterComponent(scalarText(instance)) }];
}

function contentRepresentation(mediaType: string, instance: ParameterInstance): string {
  if (isJsonMediaType(mediaType)) return JSON.stringify(instance);
  if (isTextMediaType(mediaType)) {
    if (!isPrimitive(instance)) {
      throw new Error('text/plain parameter content cannot safely serialize an array or object instance.');
    }
    return instance === null ? 'null' : String(instance);
  }
  throw new Error(`Unsupported OAS parameter content media type: ${mediaType}.`);
}

function rejectHeaderControls(value: string): string {
  if (
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9) || code === 127;
    })
  ) {
    throw new Error('The serialized header parameter contains a forbidden control character.');
  }
  return value;
}

function serializeContentParameter(param: DebugParam, instance: ParameterInstance): SerializedParameter {
  const serialization = param.parameterSerialization;
  if (!serialization || serialization.kind !== 'content') throw new Error('Expected content parameter serialization.');
  const representation = contentRepresentation(serialization.mediaType, instance);
  if (param.in === 'path') return { in: 'path', value: encodeParameterComponent(representation) };
  if (param.in === 'query') return { in: 'query', pairs: [contentQueryPair(param.name, representation)] };
  if (param.in === 'header') return { in: 'header', value: rejectHeaderControls(representation) };
  return {
    in: 'cookie',
    pairs: [{ name: encodeParameterComponent(param.name), value: encodeParameterComponent(representation) }],
  };
}

function serializeSchemaParameter(param: DebugParam, instance: ParameterInstance): SerializedParameter {
  const serialization = param.parameterSerialization;
  if (!serialization || serialization.kind !== 'schema') throw new Error('Expected schema parameter serialization.');
  if (isUndefinedComposite(instance)) {
    if (param.in === 'path') return { in: 'path', value: '' };
    if (param.in === 'query') return { in: 'query', pairs: [] };
    if (param.in === 'header') return { in: 'header', value: undefined };
    return { in: 'cookie', pairs: [] };
  }
  if (param.in === 'path') return { in: 'path', value: serializePathSchema(param.name, instance, serialization) };
  if (param.in === 'query') return { in: 'query', pairs: serializeQuerySchema(param.name, instance, serialization) };
  if (param.in === 'header') {
    return { in: 'header', value: rejectHeaderControls(serializeHeaderSchema(instance, serialization)) };
  }
  return { in: 'cookie', pairs: serializeCookieSchema(param.name, instance, serialization) };
}

function rawFallback(param: DebugParam, rawValue: string): SerializedParameter {
  if (param.in === 'path') return { in: 'path', value: encodeParameterComponent(rawValue) };
  if (param.in === 'query') {
    if (param.parameterSerialization?.kind === 'content') {
      return { in: 'query', pairs: [contentQueryPair(param.name, rawValue)] };
    }
    const allowReserved = param.parameterSerialization?.kind === 'schema' && param.parameterSerialization.allowReserved;
    return { in: 'query', pairs: [queryPair(param.name, rawValue, allowReserved)] };
  }
  if (param.in === 'header') return { in: 'header', value: rejectHeaderControls(rawValue) };
  return {
    in: 'cookie',
    pairs: [{ name: encodeParameterComponent(param.name), value: encodeParameterComponent(rawValue) }],
  };
}

function allParams(params: {
  pathParams: readonly DebugParam[];
  queryParams: readonly DebugParam[];
  headerParams: readonly DebugParam[];
  cookieParams: readonly DebugParam[];
}): DebugParam[] {
  return [...params.pathParams, ...params.queryParams, ...params.headerParams, ...params.cookieParams];
}

export function serializeOas31Parameters(
  params: {
    pathParams: readonly DebugParam[];
    queryParams: readonly DebugParam[];
    headerParams: readonly DebugParam[];
    cookieParams: readonly DebugParam[];
  },
  rawValues: Readonly<Record<string, string>> = {},
): SerializedOas31Parameters {
  const path: Record<string, string> = {};
  const query: SerializedQueryParameter[] = [];
  const headers: Record<string, string> = {};
  const cookies: SerializedCookieParameter[] = [];
  const instances: BuiltParameterInstance[] = [];
  const diagnostics: ParameterInputDiagnostic[] = [];
  const consumedQueryNames: string[] = [];
  const consumedHeaderNames: string[] = [];
  const consumedCookieNames: string[] = [];

  for (const param of allParams(params)) {
    if (!param.parameterSerialization) continue;
    const key = parameterKey(param);
    if (!Object.prototype.hasOwnProperty.call(rawValues, key)) continue;
    const rawValue = rawValues[key];
    const parsed = parseOas31ParameterValue(param, rawValue);
    const serialized = parsed.ok
      ? param.parameterSerialization.kind === 'content'
        ? serializeContentParameter(param, parsed.instance)
        : serializeSchemaParameter(param, parsed.instance)
      : rawFallback(param, rawValue);

    if (parsed.ok) {
      instances.push({ key, name: param.name, in: param.in, instance: parsed.instance });
    } else {
      diagnostics.push({ key, name: param.name, in: param.in, kind: parsed.kind, message: parsed.message });
    }

    if (serialized.in === 'path') path[param.name] = serialized.value;
    else if (serialized.in === 'query') {
      query.push(...serialized.pairs);
      consumedQueryNames.push(param.name, ...serialized.pairs.map((pair) => pair.name));
    } else if (serialized.in === 'header') {
      consumedHeaderNames.push(param.name);
      if (serialized.value !== undefined) headers[param.name] = serialized.value;
    } else {
      cookies.push(...serialized.pairs);
      consumedCookieNames.push(param.name, ...serialized.pairs.map((pair) => decodeURIComponent(pair.name)));
    }
  }

  return {
    path,
    query,
    headers,
    cookies,
    instances,
    diagnostics,
    consumedQueryNames,
    consumedHeaderNames,
    consumedCookieNames,
  };
}

export function replaceSerializedPathParams(path: string, values: Readonly<Record<string, string>>): string {
  let result = path;
  for (const [name, value] of Object.entries(values)) {
    if (!name) continue;
    result = result.replace(new RegExp(`\\{${escapeRegExp(name)}\\}`, 'g'), value);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
