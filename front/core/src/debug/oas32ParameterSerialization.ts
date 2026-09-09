import { resolveLocalJsonPointer } from '../openapi31/document';
import { isExampleData } from './exampleRepresentation';
import {
  encodeParameterComponent,
  isJsonMediaType,
  isTextMediaType,
  parseJsonParameterValue,
  parseOas31ParameterValue,
} from './parameterSerialization';
import type { SerializedQueryParameter } from './parameterSerialization';
import { parameterOwn, parameterRecord } from './oas32ParameterModel';
import type {
  Oas32CookiePair,
  Oas32Parameter,
  Oas32ParameterCollection,
  Oas32ParameterDiagnostic,
  Oas32ParameterInput,
  Oas32ParameterPlan,
  Oas32ParameterResult,
} from './oas32ParameterTypes';
import type { DebugParam, ParameterInstance, SchemaValue } from './types';

const essence = (mediaType: string): string => mediaType.split(';', 1)[0].trim().toLowerCase();
const isForm = (mediaType: string): boolean => essence(mediaType) === 'application/x-www-form-urlencoded';
const scalarText = (value: ParameterInstance): string => (value === null ? '' : String(value));
const primitive = (value: ParameterInstance): boolean => value === null || typeof value !== 'object';
const formEncode = (value: string): string => encodeParameterComponent(value).replace(/%20/g, '+').replace(/~/g, '%7E');
const decodeForm = (value: string): string => decodeURIComponent(value.replace(/\+/g, ' '));

class CodecFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly unavailable = false,
  ) {
    super(message);
    Object.setPrototypeOf(this, CodecFailure.prototype);
  }
}
const unavailable = (message: string): never => {
  throw new CodecFailure('CODEC_UNAVAILABLE', message, true);
};
const invalid = (code: string, message: string): never => {
  throw new CodecFailure(code, message);
};

/** Destination-sensitive reserved expansion; never gives data permission to delimit URL components. */
export function encodeOas32ParameterValue(
  value: string,
  destination: 'path' | 'query' | 'cookie',
  allowReserved: boolean,
): string {
  if (!allowReserved) return encodeParameterComponent(value);
  // Query also follows WHATWG form rules (&=+) and special-URL quote handling.
  const permitted =
    destination === 'path' ? ":@!$&'()*+,;=" : destination === 'query' ? ':@!$()*,;/?' : ":/?#[]@!$&'()*+,;=";
  let result = '';
  for (let index = 0; index < value.length;) {
    const triple = value.slice(index, index + 3);
    if (/^%[0-9a-f]{2}$/i.test(triple)) {
      result += triple;
      index += 3;
      continue;
    }
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    result +=
      /^[A-Za-z0-9._~-]$/.test(character) || permitted.includes(character)
        ? character
        : encodeParameterComponent(character);
    index += character.length;
  }
  return result;
}

function flatArray(data: ParameterInstance[]): ParameterInstance[] {
  if (!data.every(primitive)) return unavailable('Nested parameter arrays have no defined OAS style serialization.');
  return data.filter((value) => value !== null);
}
function flatEntries(data: Record<string, ParameterInstance>): Array<[string, ParameterInstance]> {
  const entries = Object.entries(data);
  if (!entries.every(([, value]) => primitive(value)))
    return unavailable('Nested parameter object values have no defined OAS style serialization.');
  return entries.filter(([, value]) => value !== null);
}
function compositeEmpty(data: ParameterInstance): boolean {
  if (Array.isArray(data)) return flatArray(data).length === 0;
  const object = parameterRecord(data);
  return !!object && flatEntries(object as Record<string, ParameterInstance>).length === 0;
}
function simple(
  data: ParameterInstance,
  explode: boolean,
  separator: string,
  encode: (value: string) => string,
): string {
  if (Array.isArray(data))
    return flatArray(data)
      .map((value) => encode(scalarText(value)))
      .join(separator);
  const object = parameterRecord(data);
  if (object)
    return flatEntries(object as Record<string, ParameterInstance>)
      .map(([key, value]) => `${encode(key)}${explode ? '=' : separator}${encode(scalarText(value))}`)
      .join(separator);
  return encode(scalarText(data));
}
function styleText(parameter: Oas32Parameter, data: ParameterInstance): { text: string; present: boolean } {
  const codec = parameter.serialization;
  if (codec?.kind !== 'schema') return unavailable('A schema style codec is required.');
  const { style, explode, allowReserved } = codec;
  if (compositeEmpty(data)) return { text: '', present: false };
  const encode = (value: string) =>
    parameter.in === 'header' || (parameter.in === 'cookie' && style === 'cookie')
      ? value
      : encodeOas32ParameterValue(
          value,
          parameter.in === 'path' ? 'path' : parameter.in === 'cookie' ? 'cookie' : 'query',
          allowReserved,
        );
  const name =
    parameter.in === 'cookie' && style === 'cookie' ? parameter.name : encodeParameterComponent(parameter.name);
  const entries = parameterRecord(data) ? flatEntries(data as Record<string, ParameterInstance>) : undefined;
  const array = Array.isArray(data) ? flatArray(data) : undefined;
  if (style === 'simple') return { text: simple(data, explode, ',', encode), present: true };
  if (style === 'label') return { text: `.${simple(data, explode, explode ? '.' : ',', encode)}`, present: true };
  if (style === 'matrix') {
    const pairs =
      explode && array
        ? array.map((value) => `${name}=${encode(scalarText(value))}`)
        : explode && entries
          ? entries.map(([key, value]) => `${encode(key)}=${encode(scalarText(value))}`)
          : [data === null ? name : `${name}=${simple(data, false, ',', encode)}`];
    return { text: `;${pairs.join(';')}`, present: true };
  }
  if (style === 'form' || style === 'cookie') {
    const pairs =
      explode && array
        ? array.map((value) => `${name}=${encode(scalarText(value))}`)
        : explode && entries
          ? entries.map(([key, value]) => `${encode(key)}=${encode(scalarText(value))}`)
          : [`${name}=${simple(data, false, ',', encode)}`];
    return { text: pairs.join(style === 'cookie' ? '; ' : '&'), present: true };
  }
  if (style === 'deepObject') {
    if (!entries) return unavailable('deepObject requires an object with scalar properties.');
    return {
      text: entries
        .map(([key, value]) => `${name}%5B${encodeParameterComponent(key)}%5D=${encode(scalarText(value))}`)
        .join('&'),
      present: true,
    };
  }
  if (style === 'spaceDelimited' || style === 'pipeDelimited') {
    if (explode || (!array && !entries))
      return unavailable('This style/explode/instance combination has no defined OAS serialization.');
    const values = array ?? (entries ?? []).flatMap(([key, value]) => [key, value]);
    return {
      text: `${name}=${values.map((value) => encode(scalarText(value))).join(style === 'spaceDelimited' ? '%20' : '%7C')}`,
      present: true,
    };
  }
  return unavailable('Unsupported parameter style.');
}

/** The schema is used only to select an unambiguous representation, never to validate constraints. */
function directTypes(schema: unknown): string[] {
  const value = parameterRecord(schema);
  if (!value || typeof value.$ref === 'string') return [];
  if (typeof value.type === 'string') return [value.type];
  return Array.isArray(value.type) && value.type.every((type) => typeof type === 'string')
    ? (value.type as string[])
    : [];
}
function scalarData(text: string, schema: unknown, nullText = ''): ParameterInstance | undefined {
  const types = directTypes(schema);
  const values: ParameterInstance[] = [];
  if (types.includes('string')) values.push(text);
  if (types.includes('null') && text === nullText) values.push(null);
  if (types.includes('boolean') && ['true', 'false'].includes(text)) values.push(text === 'true');
  if (types.includes('number') || types.includes('integer')) {
    const parsed = parseJsonParameterValue(text);
    if (!parsed.ok && parsed.kind === 'unsafe-number')
      return unavailable('The numeric parameter cannot be represented safely.');
    if (
      parsed.ok &&
      typeof parsed.instance === 'number' &&
      (types.includes('number') || Number.isInteger(parsed.instance))
    )
      values.push(parsed.instance);
  }
  return values.length === 1 ? values[0] : undefined;
}
function ownSchemaProperty(schema: unknown, name: string): unknown {
  const properties = parameterRecord(parameterRecord(schema)?.properties);
  return properties && parameterOwn(properties, name) ? properties[name] : undefined;
}
function jsonText(data: ParameterInstance): string {
  if (!isExampleData(data)) return unavailable('The parameter data cannot be represented safely as JSON.');
  return JSON.stringify(data);
}
function formProperty(parameter: Oas32Parameter, name: string): Oas32Parameter {
  const schema = ownSchemaProperty(parameter.schemaView, name);
  const media = parameterRecord(parameter.mediaLocation?.value);
  const encodings = parameterRecord(media?.encoding);
  const encoding = encodings && parameterOwn(encodings, name) ? parameterRecord(encodings[name]) : undefined;
  const styleSelected =
    encoding && ['style', 'explode', 'allowReserved'].some((field) => parameterOwn(encoding, field));
  const style = typeof encoding?.style === 'string' ? encoding.style : 'form';
  const types = directTypes(schema).filter((type) => type !== 'null');
  const contentType =
    typeof encoding?.contentType === 'string'
      ? encoding.contentType
      : types.length === 1
        ? types[0] === 'object'
          ? 'application/json'
          : types[0] === 'array'
            ? undefined
            : 'text/plain'
        : undefined;
  if (!styleSelected && !contentType && types[0] !== 'array')
    return unavailable('A form property has no supported, unambiguous content type.');
  if (contentType?.includes(',') || contentType?.includes('*'))
    return unavailable('A form property requires one explicit supported media type.');
  return {
    ...parameter,
    name,
    in: 'query',
    schema: schema as SchemaValue | undefined,
    schemaView: schema as SchemaValue | undefined,
    serialization: styleSelected
      ? {
          kind: 'schema',
          style,
          explode: typeof encoding?.explode === 'boolean' ? encoding.explode : style === 'form',
          allowReserved: encoding?.allowReserved === true,
        }
      : { kind: 'content', mediaType: contentType ?? '' },
  };
}
function contentData(parameter: Oas32Parameter, data: ParameterInstance): string {
  const codec = parameter.serialization;
  if (codec?.kind !== 'content') return unavailable('A media codec is required.');
  const mediaType = codec.mediaType;
  if (isJsonMediaType(mediaType)) return jsonText(data);
  if (isTextMediaType(mediaType)) {
    if (!primitive(data)) return unavailable('text/plain does not define object or array serialization.');
    return data === null ? 'null' : String(data);
  }
  if (isForm(mediaType) && parameter.in === 'querystring') {
    const object = parameterRecord(data);
    if (!object) return unavailable('Form querystring data requires an object.');
    const properties = parameterRecord(parameterRecord(parameter.schemaView)?.properties);
    if (!properties)
      return unavailable(
        'Structured form encoding requires resolved property schemas. Raw form text remains available.',
      );
    return Object.entries(object)
      .map(([name, value]) => {
        if (!parameterOwn(properties, name))
          return unavailable('An additional form property has no supported encoding schema.');
        const field = formProperty(parameter, name);
        if (field.serialization?.kind === 'schema') return styleText(field, value as ParameterInstance).text;
        const types = directTypes(field.schemaView);
        if (Array.isArray(value) && types.length === 1 && types[0] === 'array') {
          const item = parameterRecord(field.schemaView)?.items;
          const itemTypes = directTypes(item);
          const declared = field.serialization?.kind === 'content' ? field.serialization.mediaType : '';
          const mediaType =
            declared ||
            (itemTypes.length === 1 && itemTypes[0] === 'object'
              ? 'application/json'
              : itemTypes.length === 1 && !['array', 'object'].includes(itemTypes[0])
                ? 'text/plain'
                : '');
          const itemParameter = {
            ...field,
            schemaView: item as SchemaValue,
            serialization: { kind: 'content' as const, mediaType },
          };
          return value
            .map((item) => `${formEncode(name)}=${formEncode(contentData(itemParameter, item as ParameterInstance))}`)
            .join('&');
        }
        return `${formEncode(name)}=${formEncode(contentData(field, value as ParameterInstance))}`;
      })
      .filter((text) => text !== '')
      .join('&');
  }
  return unavailable(`No logical codec is available for ${mediaType}. Author text can still be inspected.`);
}
function outerContent(parameter: Oas32Parameter, text: string): string {
  const codec = parameter.serialization;
  if (codec?.kind !== 'content') return unavailable('Media-layer text requires content-based serialization.');
  if (parameter.in === 'header') return text;
  if (parameter.in === 'querystring') return isForm(codec.mediaType) ? text : encodeParameterComponent(text);
  if (parameter.in === 'query') return `${formEncode(parameter.name)}=${formEncode(text)}`;
  if (parameter.in === 'path') return encodeParameterComponent(text);
  return `${parameter.name}=${text}`;
}

function validateUriText(text: string, inPath: boolean): void {
  const allowed = inPath ? /^[A-Za-z0-9._~!$&'()*+,;=:@%-]*$/ : /^[A-Za-z0-9._~!$&'()*+,;=:@/?%-]*$/;
  if (!allowed.test(text) || /%(?![0-9a-f]{2})/i.test(text))
    return invalid(
      'URI_SERIALIZATION_INVALID',
      'The author parameter text contains invalid URI characters or component separators.',
    );
  try {
    decodeURIComponent(text);
  } catch {
    return invalid('URI_PERCENT_DECODE_INVALID', 'The author parameter text cannot be percent-decoded.');
  }
}
export function validateOas32Header(name: string, value: string): void {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
    return invalid('HEADER_NAME_INVALID', 'The header name is not an HTTP field-name token.');
  if (
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9) || code === 127;
    })
  )
    return invalid('HEADER_CONTROL_CHARACTER', 'Header values cannot contain control characters.');
}
export function parseOas32QueryPairs(text: string): SerializedQueryParameter[] {
  if (text === '') return [];
  return text.split('&').map((part) => {
    const equal = part.indexOf('=');
    const encodedName = equal < 0 ? part : part.slice(0, equal);
    const encodedValue = equal < 0 ? '' : part.slice(equal + 1);
    return {
      name: decodeForm(encodedName),
      value: decodeForm(encodedValue),
      encodedName,
      encodedValue,
      hasEquals: equal >= 0,
    };
  });
}
export function oas32CookiePairs(text: string, key: string): { pairs: Oas32CookiePair[]; valid: boolean } {
  const pairs =
    text === ''
      ? []
      : text.split('; ').map((raw) => {
          const equal = raw.indexOf('=');
          return {
            parameterKey: key,
            name: equal < 0 ? raw : raw.slice(0, equal),
            value: equal < 0 ? '' : raw.slice(equal + 1),
            raw,
          };
        });
  const valid = pairs.every(
    ({ name, value, raw }) =>
      /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) &&
      raw.includes('=') &&
      /^(?:[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*|"[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*")$/.test(value),
  );
  return { pairs, valid };
}

function decodeMedia(parameter: Oas32Parameter, text: string): ParameterInstance | undefined {
  const codec = parameter.serialization;
  if (codec?.kind !== 'content') return undefined;
  if (isJsonMediaType(codec.mediaType)) {
    const parsed = parseJsonParameterValue(text);
    if (!parsed.ok)
      return parsed.kind === 'unsafe-number'
        ? unavailable(parsed.message)
        : invalid('INVALID_JSON_SERIALIZATION', parsed.message);
    return parsed.instance;
  }
  if (isTextMediaType(codec.mediaType)) return scalarData(text, parameter.schemaView, 'null');
  if (isForm(codec.mediaType) && parameter.in === 'querystring') {
    const properties = parameterRecord(parameterRecord(parameter.schemaView)?.properties);
    if (!properties) return undefined;
    const pairs = parseOas32QueryPairs(text);
    const result: Record<string, ParameterInstance> = Object.create(null) as Record<string, ParameterInstance>;
    for (const name of Array.from(new Set(pairs.map((pair) => pair.name)))) {
      if (!parameterOwn(properties, name)) return undefined;
      const field = formProperty(parameter, name);
      if (field.serialization?.kind !== 'content') return undefined;
      const group = pairs.filter((pair) => pair.name === name);
      const type = directTypes(field.schemaView);
      if (type.length === 1 && type[0] === 'array') {
        const items = parameterRecord(field.schemaView)?.items;
        const itemType = directTypes(items);
        const mediaType =
          field.serialization.mediaType ||
          (itemType.length === 1 && itemType[0] === 'object'
            ? 'application/json'
            : itemType.length === 1 && itemType[0] !== 'array'
              ? 'text/plain'
              : '');
        const values = group.map((pair) =>
          decodeMedia(
            { ...field, schemaView: items as SchemaValue, serialization: { kind: 'content', mediaType } },
            pair.value,
          ),
        );
        if (values.some((value) => value === undefined)) return undefined;
        result[name] = values as ParameterInstance[];
      } else {
        if (group.length !== 1) return undefined;
        const value = decodeMedia(field, group[0].value);
        if (value === undefined) return undefined;
        result[name] = value;
      }
    }
    return result;
  }
  return undefined;
}

function decodeParameter(parameter: Oas32Parameter, text: string): ParameterInstance | undefined {
  const codec = parameter.serialization;
  if (!codec) return undefined;
  if (codec.kind === 'content') {
    if (parameter.in === 'header') return decodeMedia(parameter, text);
    if (parameter.in === 'querystring')
      return decodeMedia(parameter, isForm(codec.mediaType) ? text : decodeURIComponent(text));
    if (parameter.in === 'path') return decodeMedia(parameter, decodeURIComponent(text));
    if (parameter.in === 'cookie') {
      const parsed = oas32CookiePairs(text, parameter.key);
      return parsed.valid && parsed.pairs.length === 1 && parsed.pairs[0].name === parameter.name
        ? decodeMedia(parameter, parsed.pairs[0].value)
        : undefined;
    }
    const pairs = parseOas32QueryPairs(text);
    return pairs.length === 1 && pairs[0].name === parameter.name ? decodeMedia(parameter, pairs[0].value) : undefined;
  }
  if (
    codec.allowReserved &&
    parameter.in !== 'header' &&
    !(parameter.in === 'cookie' && codec.style === 'cookie') &&
    /%[0-9a-f]{2}/i.test(text)
  )
    return undefined;
  const schema = parameter.schemaView;
  const types = directTypes(schema);
  if (!types.length) return undefined;
  if (types.length > 1 && types.some((type) => type === 'array' || type === 'object')) return undefined;
  const decode =
    parameter.in === 'header' || (parameter.in === 'cookie' && codec.style === 'cookie')
      ? (value: string) => value
      : parameter.in === 'query'
        ? decodeForm
        : decodeURIComponent;
  let values: string[];
  let entries: Array<[string, string]> | undefined;
  const object = types.length === 1 && types[0] === 'object';
  const array = types.length === 1 && types[0] === 'array';
  if (codec.style === 'form' || codec.style === 'cookie' || parameter.in === 'query') {
    const pairs =
      codec.style === 'cookie'
        ? oas32CookiePairs(text, parameter.key).pairs.map((pair) => ({
            encodedName: pair.name,
            encodedValue: pair.value,
          }))
        : text.split('&').map((part) => {
            const i = part.indexOf('=');
            return { encodedName: i < 0 ? part : part.slice(0, i), encodedValue: i < 0 ? '' : part.slice(i + 1) };
          });
    if (codec.style === 'deepObject') {
      if (!object) return undefined;
      entries = [];
      for (const pair of pairs) {
        const name = decode(pair.encodedName);
        if (!name.startsWith(`${parameter.name}[`) || !name.endsWith(']')) return undefined;
        entries.push([name.slice(parameter.name.length + 1, -1), decode(pair.encodedValue)]);
      }
      values = [];
    } else if (object && codec.explode) {
      entries = pairs.map((pair) => [decode(pair.encodedName), decode(pair.encodedValue)]);
      values = [];
    } else {
      if (pairs.some((pair) => decode(pair.encodedName) !== parameter.name)) return undefined;
      if (array && codec.explode) values = pairs.map((pair) => decode(pair.encodedValue));
      else {
        if (pairs.length !== 1) return undefined;
        const separator = codec.style === 'spaceDelimited' ? /%20|\+/i : codec.style === 'pipeDelimited' ? /%7c/i : /,/;
        values = (array || object ? pairs[0].encodedValue.split(separator) : [pairs[0].encodedValue]).map(decode);
      }
    }
  } else {
    let raw = text;
    if (codec.style === 'label') {
      if (!raw.startsWith('.')) return undefined;
      raw = raw.slice(1);
    }
    if (codec.style === 'matrix') {
      if (!raw.startsWith(';')) return undefined;
      const pairs = raw
        .slice(1)
        .split(';')
        .map((part) => {
          const i = part.indexOf('=');
          return [i < 0 ? part : part.slice(0, i), i < 0 ? '' : part.slice(i + 1)];
        });
      if (object && codec.explode) {
        entries = pairs.map(([key, value]) => [decode(key), decode(value)]);
        values = [];
      } else {
        if (pairs.some(([name]) => decode(name) !== parameter.name) || (!array && pairs.length !== 1)) return undefined;
        values =
          array && codec.explode
            ? pairs.map(([, value]) => decode(value))
            : (array || object ? pairs[0][1].split(',') : [pairs[0][1]]).map(decode);
      }
    } else {
      const separator = codec.style === 'label' && codec.explode ? '.' : ',';
      if (object && codec.explode) {
        entries = [];
        for (const part of raw.split(separator)) {
          const i = part.indexOf('=');
          if (i < 0) return undefined;
          entries.push([decode(part.slice(0, i)), decode(part.slice(i + 1))]);
        }
        values = [];
      } else values = (array || object ? raw.split(separator) : [raw]).map(decode);
    }
  }
  if (object) {
    if (!entries) {
      if (values.length % 2) return undefined;
      entries = [];
      for (let i = 0; i < values.length; i += 2) entries.push([values[i], values[i + 1]]);
    }
    const result: Record<string, ParameterInstance> = Object.create(null) as Record<string, ParameterInstance>;
    for (const [key, text] of entries) {
      if (parameterOwn(result, key)) return undefined;
      const value = scalarData(text, ownSchemaProperty(schema, key));
      if (value === undefined) return undefined;
      result[key] = value;
    }
    return result;
  }
  if (array) {
    const data = values.map((value) => scalarData(value, parameterRecord(schema)?.items));
    return data.some((value) => value === undefined) ? undefined : (data as ParameterInstance[]);
  }
  return values.length === 1 ? scalarData(values[0], schema) : undefined;
}

/** Names that are part of the serialization cannot be replaced by arbitrary author names. */
function validateAuthorBoundary(parameter: Oas32Parameter, text: string): void {
  const codec = parameter.serialization;
  if (!codec || text === '') return;
  const types = directTypes(parameter.schemaView);
  const objectExpansion = codec.kind === 'schema' && codec.explode && (types.length === 0 || types.includes('object'));
  if (parameter.in === 'query') {
    const pairs = parseOas32QueryPairs(text);
    if (codec.kind === 'schema' && codec.style === 'deepObject') {
      if (pairs.some((pair) => !pair.name.startsWith(`${parameter.name}[`) || !pair.name.endsWith(']')))
        invalid('PARAMETER_NAME_MISMATCH', 'The deepObject author names must use the declared parameter name.');
    } else if (!objectExpansion && pairs.some((pair) => pair.name !== parameter.name))
      invalid('PARAMETER_NAME_MISMATCH', 'The author query name does not match its Parameter declaration.');
  }
  if (parameter.in === 'cookie' && !objectExpansion) {
    const names =
      codec.kind === 'schema' && codec.style === 'form'
        ? text.split('&').map((pair) => decodeURIComponent(pair.split('=', 1)[0]))
        : oas32CookiePairs(text, parameter.key).pairs.map((pair) => pair.name);
    if (names.some((name) => name !== parameter.name))
      invalid('PARAMETER_NAME_MISMATCH', 'The author Cookie name does not match its Parameter declaration.');
  }
  if (parameter.in === 'path' && codec.kind === 'schema') {
    if (codec.style === 'label' && !text.startsWith('.'))
      invalid('PATH_STYLE_PREFIX', 'A label author example must include its leading dot.');
    if (codec.style === 'matrix' && !text.startsWith(';'))
      invalid('PATH_STYLE_PREFIX', 'A matrix author example must include its leading semicolon.');
  }
}

/** Display/codec hints only. Physical Schema evaluation still uses the original reference. */
function editorSchemaRecord(
  parameter: Oas32Parameter,
  ownerDocument?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const schema = parameterRecord(parameter.schemaView) ?? parameterRecord(parameter.schema);
  if (!schema) return undefined;
  const ref = typeof schema.$ref === 'string' ? schema.$ref : undefined;
  if (!ref || !ownerDocument) return schema;
  const resolved = parameterRecord(resolveLocalJsonPointer(ownerDocument, ref).value);
  if (!resolved) return schema;
  const siblings = { ...schema };
  delete siblings.$ref;
  return { ...resolved, ...siblings };
}

export function oas32EditorParameter(parameter: Oas32Parameter, ownerDocument?: Record<string, unknown>): DebugParam {
  const schema = editorSchemaRecord(parameter, ownerDocument);
  const types = directTypes(schema);
  const serialization = parameter.serialization;
  const rawExample = parameterOwn(parameter.raw, 'example') ? parameter.raw.example : undefined;
  return {
    name: parameter.name,
    in: parameter.in === 'querystring' ? 'query' : parameter.in,
    required: parameter.required,
    type: types.find((type) => type !== 'null') ?? 'string',
    schema: parameter.schemaView,
    parameterSerialization: parameter.serialization,
    ...(typeof schema?.format === 'string' ? { format: schema.format } : {}),
    ...(schema && parameterOwn(schema, 'default') ? { default: schema.default } : {}),
    ...(rawExample !== undefined
      ? { example: rawExample }
      : schema && parameterOwn(schema, 'example')
        ? { example: schema.example }
        : {}),
    ...(typeof parameter.raw.description === 'string' ? { description: parameter.raw.description } : {}),
    ...(parameter.raw.deprecated === true ? { deprecated: true } : {}),
    ...(schema?.readOnly === true ? { readOnly: true } : {}),
    ...(serialization?.kind === 'schema'
      ? {
          style: serialization.style,
          explode: serialization.explode,
          allowReserved: serialization.allowReserved === true ? true : undefined,
        }
      : {}),
  };
}
const equalData = (a: ParameterInstance, b: ParameterInstance): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equalData(v, b[i]));
  const x = parameterRecord(a);
  const y = parameterRecord(b);
  return (
    !!x &&
    !!y &&
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every(
      (key) => parameterOwn(y, key) && equalData(x[key] as ParameterInstance, y[key] as ParameterInstance),
    )
  );
};

export function serializeOas32Parameter(parameter: Oas32Parameter, input: Oas32ParameterInput): Oas32ParameterResult {
  // Snapshot mutable editor/author inputs; retain only the opaque session identity by reference.
  input = { ...input, ...(input.provenance ? { provenance: { ...input.provenance } } : {}) };
  if (input.kind === 'data' && isExampleData(input.value))
    input = { ...input, value: JSON.parse(JSON.stringify(input.value)) as ParameterInstance };
  if (
    (input.kind === 'media' || input.kind === 'parameter') &&
    parameterOwn(input, 'data') &&
    isExampleData(input.data)
  )
    input = { ...input, data: JSON.parse(JSON.stringify(input.data)) as ParameterInstance };
  const diagnostics: Oas32ParameterDiagnostic[] = [];
  const report = (
    phase: Oas32ParameterDiagnostic['phase'],
    code: string,
    message: string,
    blocks: Oas32ParameterDiagnostic['blocks'] = 'none',
  ) => diagnostics.push({ phase, code, message, blocks, key: parameter.key, location: parameter.location });
  if (input.kind === 'absent' || input.kind === 'browser-session') {
    if (input.kind === 'browser-session' && parameter.in !== 'cookie')
      report('input', 'BROWSER_SESSION_LOCATION', 'Only Cookie parameters can use the browser session source.', 'all');
    if (input.kind === 'browser-session' && parameter.in === 'cookie')
      report(
        'input',
        'COOKIE_SESSION_UNVERIFIED',
        'The browser Cookie value and required/Schema result are unknown to the local debugger.',
      );
    return {
      parameter,
      input,
      present: input.kind === 'browser-session' ? 'unknown' : false,
      dataStatus: input.kind === 'browser-session' ? 'unavailable' : 'absent',
      serialization: input.kind === 'browser-session' ? 'unavailable' : 'absent',
      pairing: 'absent',
      diagnostics,
    };
  }
  let data: ParameterInstance | undefined;
  let decodedData: ParameterInstance | undefined;
  let mediaText: string | undefined;
  let parameterText: string | undefined;
  let present = true;
  let serialization: Oas32ParameterResult['serialization'] = 'unavailable';
  let pairing: Oas32ParameterResult['pairing'] = 'absent';
  try {
    if ('text' in input && input.text.length > 1024 * 1024)
      invalid('PARAMETER_TEXT_LIMIT', 'Parameter text exceeds the one MiB codec input limit.');
    if (input.kind === 'data') data = input.value;
    else if (input.kind === 'editor') {
      const parsed =
        parameter.serialization?.kind === 'content' && isForm(parameter.serialization.mediaType)
          ? parseJsonParameterValue(input.text)
          : parseOas31ParameterValue(oas32EditorParameter(parameter), input.text);
      if (!parsed.ok)
        return {
          parameter,
          input,
          present: false,
          dataStatus: 'unavailable',
          serialization: 'unavailable',
          pairing: 'absent',
          diagnostics: [
            {
              phase: 'input',
              code: parsed.kind === 'unsafe-number' ? 'UNSAFE_NUMBER' : 'INVALID_EDITOR_VALUE',
              message: parsed.message,
              blocks: 'all',
              key: parameter.key,
            },
          ],
        };
      data = parsed.instance;
    } else if ((input.kind === 'media' || input.kind === 'parameter') && parameterOwn(input, 'data')) data = input.data;
    if ((data !== undefined || input.kind === 'data') && !isExampleData(data))
      return unavailable('The parameter data exceeds the supported JSON value or numeric limits.');
    if (input.kind === 'parameter') parameterText = input.text;
    else if (input.kind === 'media') {
      mediaText = input.text;
      parameterText = outerContent(parameter, mediaText);
    } else if (data !== undefined) {
      if (parameter.serialization?.kind === 'content') {
        mediaText = contentData(parameter, data);
        parameterText = outerContent(parameter, mediaText);
      } else {
        const styled = styleText(parameter, data);
        parameterText = styled.text;
        present = styled.present;
      }
    }
    if (parameterText !== undefined) {
      if ((parameter.in === 'query' || parameter.in === 'cookie') && parameterText === '') present = false;
      if (parameter.in === 'header') {
        validateOas32Header(parameter.name, parameterText);
        if (input.kind === 'parameter' && parameterText.toLowerCase().startsWith(`${parameter.name.toLowerCase()}:`))
          invalid('HEADER_NAME_IN_VALUE', 'An author Header example must not include the field name.');
      } else if (parameter.in === 'cookie') {
        validateOas32Header('Cookie', parameterText);
        if (
          (input.kind === 'data' || input.kind === 'editor') &&
          data !== undefined &&
          parameter.serialization?.kind === 'schema' &&
          parameter.serialization.style === 'cookie'
        ) {
          const cells: Array<[string, ParameterInstance]> = Array.isArray(data)
            ? flatArray(data).map((value) => [parameter.name, value])
            : parameterRecord(data)
              ? flatEntries(data as Record<string, ParameterInstance>)
              : [[parameter.name, data]];
          if (
            cells.some(
              ([name, value]) =>
                !oas32CookiePairs(`${name}=${scalarText(value)}`, parameter.key).valid ||
                /;/.test(name) ||
                /;/.test(scalarText(value)),
            )
          )
            report(
              'serialization',
              'COOKIE_DATA_UNESCAPED',
              'Cookie data requires author escaping before style expansion.',
              'all',
            );
        }
        const cookies = oas32CookiePairs(parameterText, parameter.key);
        if (!cookies.valid)
          report(
            'transport',
            'COOKIE_FIELD_SYNTAX',
            'The OAS style preview is not a valid RFC6265 Cookie field; author text is preserved.',
            'browser',
          );
        if (
          parameter.serialization?.kind === 'schema' &&
          parameter.serialization.style === 'form' &&
          parameter.serialization.explode &&
          parameterText.includes('&')
        )
          report(
            'transport',
            'COOKIE_FORM_DELIMITER',
            'Exploded form uses & rather than the Cookie pair separator; the preview is preserved.',
            'browser',
          );
        if (present)
          report(
            'browser',
            'EXPLICIT_COOKIE_UNAVAILABLE',
            'Handwritten Cookie values are preview/cURL only; browsers control the Cookie field.',
            'browser',
          );
      } else {
        validateUriText(parameterText, parameter.in === 'path');
        if (parameter.in !== 'path' && /^[?&]/.test(parameterText))
          invalid('QUERY_LEADING_DELIMITER', 'A query parameter example must not include a leading ? or & delimiter.');
        if (parameter.in !== 'path' && parameterText.includes("'"))
          report(
            'browser',
            'QUERY_BROWSER_NORMALIZATION',
            'Fetch would percent-encode this author query text; exact browser transmission is unavailable.',
            'browser',
          );
      }
      if (input.kind === 'parameter') validateAuthorBoundary(parameter, parameterText);
      if (input.kind === 'data' || input.kind === 'editor') serialization = 'valid';
      else {
        decodedData = decodeParameter(parameter, parameterText);
        serialization = decodedData === undefined ? 'unavailable' : 'valid';
        if (decodedData === undefined)
          report(
            'serialization',
            'SERIALIZATION_NOT_VERIFIED',
            'The wire value has no supported unambiguous logical decoding.',
          );
      }
      if ((input.kind === 'media' || input.kind === 'parameter') && parameterOwn(input, 'data') && data !== undefined) {
        pairing = 'unavailable';
        // Forward equality proves this pair even where wire decoding is non-injective.
        try {
          const expected =
            parameter.serialization?.kind === 'content'
              ? contentData(parameter, data)
              : styleText(parameter, data).text;
          const expectedText =
            input.kind === 'media'
              ? expected
              : parameter.serialization?.kind === 'content'
                ? outerContent(parameter, expected)
                : expected;
          if (expectedText === input.text || (decodedData !== undefined && equalData(data, decodedData)))
            pairing = 'valid';
          else if (decodedData !== undefined) pairing = 'invalid';
        } catch {
          /* Keep a separate unavailable pairing result. */
        }
        if (pairing !== 'valid')
          report(
            'pairing',
            pairing === 'invalid' ? 'EXAMPLE_PAIR_MISMATCH' : 'PAIRING_UNAVAILABLE',
            'Author data and serialization could not be established as the same logical value.',
          );
      }
    }
  } catch (error) {
    const failure =
      error instanceof CodecFailure
        ? error
        : new CodecFailure(
            'SERIALIZATION_INVALID',
            error instanceof Error ? error.message : 'Parameter serialization failed.',
          );
    serialization = failure.unavailable ? 'unavailable' : 'invalid';
    report(
      'serialization',
      failure.code,
      failure.message,
      failure.unavailable && parameterText !== undefined ? 'none' : 'all',
    );
  }
  return {
    parameter,
    input,
    present,
    ...(data === undefined ? {} : { data }),
    ...(decodedData === undefined ? {} : { decodedData }),
    dataStatus: data === undefined && decodedData === undefined ? 'unavailable' : 'available',
    mediaText,
    parameterText,
    serialization,
    pairing,
    diagnostics,
  };
}

export function serializeOas32Parameters(
  collection: Oas32ParameterCollection,
  inputs: Readonly<Record<string, Oas32ParameterInput>> = {},
): Oas32ParameterPlan {
  const results = collection.parameters.map((parameter) =>
    serializeOas32Parameter(
      parameter,
      parameterOwn(inputs, parameter.key) ? inputs[parameter.key] : { kind: 'absent' },
    ),
  );
  const diagnostics = [...collection.diagnostics, ...results.flatMap((result) => result.diagnostics)];
  const path: Record<string, string> = Object.create(null) as Record<string, string>;
  const query: SerializedQueryParameter[] = [];
  const headers: Array<{ name: string; value: string; parameterKey: string }> = [];
  const cookies: Oas32CookiePair[] = [];
  const cookieChunks: string[] = [];
  const presence: Record<string, boolean | 'unknown'> = Object.create(null) as Record<string, boolean | 'unknown'>;
  let wholeQuery: Oas32ParameterPlan['wholeQuery'];
  for (const result of results) {
    const { parameter, parameterText, present } = result;
    presence[parameter.key] = present;
    if (parameter.in === 'querystring' && parameter.serialization?.kind === 'content')
      wholeQuery = {
        key: parameter.key,
        present: present === true,
        component: parameterText,
        mediaType: parameter.serialization.mediaType,
      };
    if (
      present !== true ||
      parameterText === undefined ||
      result.diagnostics.some((diagnostic) => diagnostic.blocks === 'all')
    )
      continue;
    if (parameter.in === 'path') path[parameter.name] = parameterText;
    if (parameter.in === 'query') query.push(...parseOas32QueryPairs(parameterText));
    if (parameter.in === 'header')
      headers.push({ name: parameter.name, value: parameterText, parameterKey: parameter.key });
    if (parameter.in === 'cookie') {
      cookies.push(...oas32CookiePairs(parameterText, parameter.key).pairs);
      cookieChunks.push(parameterText);
    }
  }
  const seen = new Map<string, string>();
  for (const header of headers) {
    const lower = header.name.toLowerCase();
    if (seen.has(lower))
      diagnostics.push({
        phase: 'transport',
        code: 'HEADER_FIELD_CONFLICT',
        message: 'Distinct case-sensitive Header declarations produce the same case-insensitive HTTP field.',
        key: header.parameterKey,
        name: header.name,
        blocks: 'all',
      });
    seen.set(lower, header.name);
  }
  return {
    results,
    path,
    query,
    headers,
    cookies,
    cookieText: cookieChunks.join('; '),
    wholeQuery,
    presence,
    diagnostics,
  };
}
