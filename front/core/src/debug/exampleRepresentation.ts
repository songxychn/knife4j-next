import type { BodyContent, DebugParam, ParameterInstance, SerializedExampleParameter } from './types';
import {
  isJsonMediaType,
  isTextMediaType,
  parameterKey,
  parseJsonParameterValue,
  parseOas31ParameterValue,
  serializeOas31Parameters,
} from './parameterSerialization';
import { analyzeOas31FormBody, serializeOas31FormBody } from './formBodyEncoding';

export type ExampleLayer = 'parameter' | 'header' | 'media';
export type ExampleCheck = 'valid' | 'invalid' | 'unavailable' | 'absent';
export interface ExampleDiagnostic {
  readonly phase: 'structure' | 'serialization' | 'pairing';
  readonly code: string;
}
export interface ExampleRepresentation {
  /** Own-property presence is independent of value, including null and empty strings. */
  readonly fields: Readonly<Record<'dataValue' | 'serializedValue' | 'externalValue' | 'value', boolean>>;
  readonly data?: ParameterInstance;
  readonly dataSource?: 'dataValue' | 'value' | 'decoded';
  readonly decodedData?: ParameterInstance;
  readonly serialized?: string;
  readonly external?: { readonly value: string; readonly resolvedUri?: string };
  readonly legacyValue?: unknown;
  /** A serialization in exactly the declared layer; never a URL fetched as content. */
  readonly text?: string;
  readonly serialization: ExampleCheck;
  readonly pairing: ExampleCheck;
  readonly diagnostics: readonly ExampleDiagnostic[];
}
export interface ExampleRepresentationContext {
  readonly layer: ExampleLayer;
  readonly mediaType?: string;
  readonly documentBaseUri?: string;
  readonly parameter?: DebugParam;
  readonly bodyContent?: BodyContent;
  readonly encoding?: Record<string, unknown>;
}

export const exampleHasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Check JSON data without interpreting any keys ($ref, $id, xml, etc. are ordinary payload). */
export function isExampleData(value: unknown): value is ParameterInstance {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > 20000 || depth > 64) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return true;
    if (typeof item === 'number')
      return Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item));
    if (Array.isArray(item)) return item.every((child) => visit(child, depth + 1));
    const object = record(item);
    return !!object && Object.values(object).every((child) => visit(child, depth + 1));
  };
  return visit(value, 0);
}

const dataEqual = (left: ParameterInstance, right: ParameterInstance): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((v, i) => dataEqual(v, right[i]))
    );
  const a = record(left);
  const b = record(right);
  return (
    !!a &&
    !!b &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(
      (key) => exampleHasOwn(b, key) && dataEqual(a[key] as ParameterInstance, b[key] as ParameterInstance),
    )
  );
};

function editorText(data: ParameterInstance, param?: DebugParam): string {
  if (typeof data !== 'string') return JSON.stringify(data);
  if (param?.parameterSerialization?.kind === 'content' && isJsonMediaType(param.parameterSerialization.mediaType))
    return JSON.stringify(data);
  // Ask the existing parser which editor spelling preserves this exact string. This also covers
  // unresolved Schema references and unions whose unquoted text would otherwise become JSON data.
  if (param) {
    const plain = parseOas31ParameterValue(param, data);
    if (plain.ok && plain.instance === data) return data;
    const quoted = JSON.stringify(data);
    const escaped = parseOas31ParameterValue(param, quoted);
    if (escaped.ok && escaped.instance === data) return quoted;
  }
  return data;
}

export function serializeExampleData(data: ParameterInstance, context: ExampleRepresentationContext): string {
  if (context.layer !== 'media') {
    const param = context.parameter;
    if (!param?.parameterSerialization || param.in === 'cookie') throw new Error('PARAMETER_CODEC_UNAVAILABLE');
    const model = { pathParams: [param], queryParams: [], headerParams: [], cookieParams: [] };
    const output = serializeOas31Parameters(model, { [parameterKey(param)]: editorText(data, param) });
    if (output.diagnostics.length || !output.instances.some((item) => dataEqual(item.instance, data)))
      throw new Error('PARAMETER_DATA_UNREPRESENTABLE');
    if (param.in === 'path') return output.path[param.name] ?? '';
    if (param.in === 'header') return output.headers[param.name] ?? '';
    return output.query.map((pair) => `${pair.encodedName}=${pair.encodedValue}`).join('&');
  }
  const mediaType = context.mediaType ?? '';
  if (isJsonMediaType(mediaType)) return JSON.stringify(data, null, 2);
  if (isTextMediaType(mediaType)) {
    if (typeof data === 'object' && data !== null) throw new Error('TEXT_DATA_UNREPRESENTABLE');
    return data === null ? 'null' : String(data);
  }
  if (mediaType.split(';', 1)[0].trim().toLowerCase() === 'application/x-www-form-urlencoded') {
    const object = record(data);
    if (!object) throw new Error('FORM_DATA_UNREPRESENTABLE');
    const content = context.bodyContent;
    if (!content) throw new Error('FORM_CODEC_UNAVAILABLE');
    const oas31Form =
      content.oas31Form ??
      analyzeOas31FormBody({
        mediaType,
        schema: content.schema,
        encoding: context.encoding,
        fileFields: [],
        multipleFileFields: [],
        document: {},
      });
    const plan = serializeOas31FormBody(
      { ...content, oas31Form },
      {
        formFields: Object.fromEntries(
          Object.entries(object).map(([name, value]) => {
            const field = oas31Form.fields.find((field) => field.name === name);
            const parameter: DebugParam | undefined = field
              ? {
                  name,
                  in: 'query',
                  required: field.required,
                  type: field.type,
                  schema: field.schema,
                  parameterSerialization:
                    field.encoding.kind === 'content' && field.encoding.contentTypes.some(isJsonMediaType)
                      ? { kind: 'content', mediaType: field.encoding.contentTypes.find(isJsonMediaType)! }
                      : {
                          kind: 'schema',
                          style: field.encoding.style ?? 'form',
                          explode: field.encoding.explode ?? true,
                          allowReserved: field.encoding.allowReserved ?? false,
                        },
                }
              : undefined;
            return [name, editorText(value as ParameterInstance, parameter)];
          }),
        ),
        formFieldNamesToIncludeWhenEmpty: Object.keys(object),
      },
    );
    if (plan.kind !== 'urlencoded' || plan.diagnostics.length) throw new Error('FORM_DATA_UNREPRESENTABLE');
    return plan.body;
  }
  throw new Error('MEDIA_CODEC_UNAVAILABLE');
}

function scalar(value: string, schema: unknown): ParameterInstance | undefined {
  const object = record(schema);
  if (!object) return undefined;
  const types = Array.isArray(object.type) ? object.type : [object.type];
  if (!types.some((type) => ['string', 'number', 'integer', 'boolean', 'null'].includes(String(type))))
    return undefined;
  const parsed = parseOas31ParameterValue(
    {
      name: '',
      in: 'query',
      required: false,
      type: String(types[0]),
      schema: object,
      parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
    },
    value,
  );
  if (parsed.ok && types.includes('string') && types.length > 1 && typeof parsed.instance !== 'string')
    return undefined;
  return parsed.ok ? parsed.instance : undefined;
}

const decode = (value: string, form = false): string => decodeURIComponent(form ? value.replace(/\+/g, ' ') : value);
function pairs(text: string): Array<[string, string]> {
  if (text === '') return [];
  return text.split('&').map((pair) => {
    const index = pair.indexOf('=');
    return [
      decode(index < 0 ? pair : pair.slice(0, index), true),
      decode(index < 0 ? '' : pair.slice(index + 1), true),
    ];
  });
}

/** Best-effort decoding stays within existing scalar/array/object styles; ambiguous input is no-data. */
function decodeParameter(text: string, param: DebugParam): ParameterInstance | undefined {
  const config = param.parameterSerialization;
  if (!config || param.in === 'cookie') return undefined;
  if (config.kind === 'content') {
    let mediaText = text;
    if (param.in === 'query') {
      const entries = pairs(text);
      if (entries.length !== 1 || entries[0][0] !== param.name) return undefined;
      mediaText = entries[0][1];
    } else if (param.in === 'path') mediaText = decode(text);
    return decodeMedia(mediaText, { layer: 'media', mediaType: config.mediaType, parameter: param });
  }
  const schema = record(param.schema);
  if (!schema) return undefined;
  const type = schema.type;
  const style = config.style;
  const isObject = type === 'object';
  const isArray = type === 'array';
  // Header values and exploded labels do not escape their structural separators in strings.
  // Without author data their inverse is ambiguous; a forward codec can still prove pairing below.
  const itemType = record(schema.items)?.type;
  const stringItems =
    itemType === undefined || itemType === 'string' || (Array.isArray(itemType) && itemType.includes('string'));
  if ((param.in === 'header' || (style === 'label' && config.explode)) && (isObject || (isArray && stringItems)))
    return undefined;
  if (param.in === 'query' && config.allowReserved && (isObject || isArray)) return undefined;
  let values: string[];
  let entries: Array<[string, string]> | undefined;
  if (param.in === 'query') {
    const rawQuery =
      text === ''
        ? []
        : text.split('&').map((pair): [string, string] => {
            const index = pair.indexOf('=');
            return [index < 0 ? pair : pair.slice(0, index), index < 0 ? '' : pair.slice(index + 1)];
          });
    const query = rawQuery.map(([name, value]): [string, string] => [decode(name, true), decode(value, true)]);
    if (style === 'deepObject') {
      if (query.some(([name]) => !name.startsWith(`${param.name}[`) || !name.endsWith(']'))) return undefined;
      entries = query.map(([name, value]) => [name.slice(param.name.length + 1, -1), value]);
    } else if (isObject && config.explode) entries = query;
    else {
      if (query.some(([name]) => name !== param.name)) return undefined;
      if (isArray && config.explode) values = query.map(([, value]) => value);
      else if (query.length !== 1) return undefined;
      else if ((isArray || isObject) && (style === 'spaceDelimited' || style === 'pipeDelimited')) return undefined;
      else values = isArray || isObject ? rawQuery[0][1].split(',').map((part) => decode(part, true)) : [query[0][1]];
    }
  } else {
    let raw = text;
    const decoder = param.in === 'header' ? (value: string) => value : (value: string) => decode(value);
    if (style === 'matrix') {
      if (!raw.startsWith(';')) return undefined;
      const matrix = raw
        .slice(1)
        .split(';')
        .map((part): [string, string] => {
          const index = part.indexOf('=');
          return [decoder(index < 0 ? part : part.slice(0, index)), index < 0 ? '' : part.slice(index + 1)];
        });
      if (isObject && config.explode) entries = matrix.map(([key, value]) => [key, decoder(value)]);
      else {
        if (matrix.some(([name]) => name !== param.name)) return undefined;
        if (isArray && config.explode) values = matrix.map(([, value]) => decoder(value));
        else if (matrix.length !== 1) return undefined;
        else values = (isArray || isObject ? matrix[0][1].split(',') : [matrix[0][1]]).map(decoder);
      }
    } else {
      if (style === 'label') raw = raw.slice(1);
      const delimiter = style === 'label' && config.explode ? '.' : ',';
      if (isObject && config.explode) {
        entries = raw.split(delimiter).map((part): [string, string] => {
          const index = part.indexOf('=');
          return [decoder(part.slice(0, index)), decoder(part.slice(index + 1))];
        });
      } else values = (isArray || isObject ? raw.split(delimiter) : [raw]).map(decoder);
    }
  }
  if (isObject) {
    if (!entries) {
      if (!values! || values!.length % 2) return undefined;
      entries = Array.from({ length: values!.length / 2 }, (_, i) => [values![i * 2], values![i * 2 + 1]]);
    }
    const result: Array<[string, ParameterInstance]> = [];
    const properties = record(schema.properties) ?? {};
    for (const [name, value] of entries) {
      const parsed = scalar(value, properties[name] ?? schema.additionalProperties);
      if (parsed === undefined || result.some(([key]) => key === name)) return undefined;
      result.push([name, parsed]);
    }
    return Object.fromEntries(result);
  }
  if (isArray) {
    const result = values!.map((value) => scalar(value, schema.items));
    return result.every((value) => value !== undefined) ? (result as ParameterInstance[]) : undefined;
  }
  return values!.length === 1 ? scalar(values![0], schema) : undefined;
}

function decodeMedia(text: string, context: ExampleRepresentationContext): ParameterInstance | undefined {
  const type = context.mediaType ?? '';
  if (isJsonMediaType(type)) {
    const parsed = parseJsonParameterValue(text);
    if (!parsed.ok)
      throw new Error(parsed.kind === 'unsafe-number' ? 'UNSAFE_EXAMPLE_NUMBER' : 'INVALID_JSON_SERIALIZATION');
    return isExampleData(parsed.instance) ? parsed.instance : undefined;
  }
  if (isTextMediaType(type)) {
    const schema = context.parameter?.schema ?? context.bodyContent?.schema;
    const types = record(schema)?.type;
    if (Array.isArray(types) && types.includes('string') && types.length > 1) return undefined;
    return scalar(text, schema) ?? text;
  }
  if (type.split(';', 1)[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') return undefined;
  const schema = context.bodyContent?.schema;
  const properties = record(schema?.properties);
  if (!properties) return undefined;
  const entries = pairs(text);
  const result: Array<[string, ParameterInstance]> = [];
  for (const [name, property] of Object.entries(properties)) {
    const encoding = record(context.encoding?.[name]);
    const keyEntries = entries.filter(([key]) => key === name || key.startsWith(`${name}[`));
    if (!keyEntries.length) continue;
    const param: DebugParam = {
      name,
      in: 'query',
      required: false,
      type: String(record(property)?.type ?? 'string'),
      schema: property as DebugParam['schema'],
      parameterSerialization:
        typeof encoding?.contentType === 'string' && isJsonMediaType(encoding.contentType)
          ? { kind: 'content', mediaType: encoding.contentType }
          : {
              kind: 'schema',
              style: typeof encoding?.style === 'string' ? encoding.style : 'form',
              explode: typeof encoding?.explode === 'boolean' ? encoding.explode : true,
              allowReserved: false,
            },
    };
    const raw = text
      .split('&')
      .filter((pair) => {
        const index = pair.indexOf('=');
        const key = decode(index < 0 ? pair : pair.slice(0, index), true);
        return key === name || key.startsWith(`${name}[`);
      })
      .join('&');
    const parsed = decodeParameter(raw, param);
    if (parsed === undefined) return undefined;
    result.push([name, parsed]);
  }
  // Never silently erase extra fields while claiming that the whole example was decoded.
  if (entries.some(([key]) => !Object.keys(properties).some((name) => key === name || key.startsWith(`${name}[`))))
    return undefined;
  return Object.fromEntries(result);
}

function serializedProblem(text: string, context: ExampleRepresentationContext): string | undefined {
  if (text.length > 1024 * 1024) return 'EXAMPLE_SIZE_LIMIT';
  if (context.layer === 'media') {
    if (isJsonMediaType(context.mediaType ?? '')) {
      try {
        JSON.parse(text);
      } catch {
        return 'INVALID_JSON_SERIALIZATION';
      }
    }
    return undefined;
  }
  const param = context.parameter;
  if (!param || param.in === 'cookie') return 'PARAMETER_CODEC_UNAVAILABLE';
  if (param.in === 'header') {
    if (
      text.split('').some((character) => {
        const code = character.charCodeAt(0);
        return (code < 32 && code !== 9) || code === 127;
      })
    )
      return 'INVALID_HEADER_SERIALIZATION';
    if (text.toLowerCase().startsWith(`${param.name.toLowerCase()}:`)) return 'HEADER_NAME_IN_SERIALIZATION';
  } else {
    if (/[^\x21-\x7e]/.test(text) || /%(?![0-9a-f]{2})/i.test(text) || text.includes('#'))
      return 'INVALID_URI_SERIALIZATION';
    try {
      decode(text, param.in === 'query');
    } catch {
      return 'INVALID_URI_SERIALIZATION';
    }
    if (param.in === 'path' && /[/?]/.test(text)) return 'INVALID_PATH_SERIALIZATION';
    if (param.in === 'query' && /^[?&]/.test(text)) return 'QUERY_LEADING_DELIMITER';
    const config = param.parameterSerialization;
    if (config?.kind === 'schema' && config.style === 'matrix' && !text.startsWith(';'))
      return 'MATRIX_LEADING_DELIMITER';
    if (config?.kind === 'schema' && config.style === 'label' && !text.startsWith('.'))
      return 'LABEL_LEADING_DELIMITER';
  }
  return undefined;
}

/** OAS 3.2 §4.19.1 and §4.12.5. Call only at a known Example Object / shorthand position. */
export function interpretExampleObject(
  source: Record<string, unknown>,
  context: ExampleRepresentationContext,
): ExampleRepresentation {
  const fields = Object.fromEntries(
    ['dataValue', 'serializedValue', 'externalValue', 'value'].map((key) => [key, exampleHasOwn(source, key)]),
  ) as ExampleRepresentation['fields'];
  const diagnostics: ExampleDiagnostic[] = [];
  const add = (phase: ExampleDiagnostic['phase'], code: string) => diagnostics.push({ phase, code });
  const conflict =
    (fields.value && (fields.dataValue || fields.serializedValue || fields.externalValue)) ||
    (fields.serializedValue && fields.externalValue);
  if (conflict) add('structure', 'EXAMPLE_FIELDS_CONFLICT');
  if (fields.serializedValue && typeof source.serializedValue !== 'string')
    add('structure', 'SERIALIZED_VALUE_NOT_STRING');
  if (fields.externalValue && typeof source.externalValue !== 'string') add('structure', 'EXTERNAL_VALUE_NOT_STRING');
  let data: ParameterInstance | undefined;
  let dataSource: ExampleRepresentation['dataSource'];
  if (fields.dataValue || fields.value) {
    const value = fields.dataValue ? source.dataValue : source.value;
    if (isExampleData(value)) {
      data = value;
      dataSource = fields.dataValue ? 'dataValue' : 'value';
    } else add('structure', 'EXAMPLE_DATA_UNREPRESENTABLE');
  }
  const serialized =
    typeof source.serializedValue === 'string' && fields.serializedValue ? source.serializedValue : undefined;
  let external: ExampleRepresentation['external'];
  if (fields.externalValue && typeof source.externalValue === 'string') {
    try {
      external = {
        value: source.externalValue,
        resolvedUri: new URL(source.externalValue, context.documentBaseUri).href,
      };
    } catch {
      external = { value: source.externalValue };
      add('serialization', 'EXTERNAL_URI_UNAVAILABLE');
    }
  }
  let text = serialized;
  let decodedData: ParameterInstance | undefined;
  let serialization: ExampleCheck = 'absent';
  let pairing: ExampleCheck = 'absent';
  const unknownLegacyText =
    fields.value &&
    !fields.dataValue &&
    !fields.serializedValue &&
    !fields.externalValue &&
    context.layer === 'media' &&
    !isJsonMediaType(context.mediaType ?? '') &&
    !isTextMediaType(context.mediaType ?? '') &&
    typeof source.value === 'string';
  if (unknownLegacyText) {
    text = source.value as string;
    data = undefined;
    dataSource = undefined;
  }
  const legacyAmbiguous =
    fields.value &&
    !(
      context.layer === 'media' &&
      (isJsonMediaType(context.mediaType ?? '') ||
        (isTextMediaType(context.mediaType ?? '') && typeof source.value === 'string'))
    );
  if (legacyAmbiguous) add('serialization', 'LEGACY_VALUE_IMPLEMENTATION_DEFINED');
  if (!conflict && diagnostics.every((item) => item.phase !== 'structure')) {
    if (external) {
      serialization = 'unavailable';
      if (data !== undefined) pairing = 'unavailable';
      add('serialization', 'EXTERNAL_EXAMPLE_NOT_LOADED');
    } else {
      if (text === undefined && data !== undefined) {
        try {
          text = serializeExampleData(data, context);
        } catch {
          add('serialization', 'CODEC_UNAVAILABLE');
          serialization = 'unavailable';
        }
      }
      if (text !== undefined) {
        const problem = serializedProblem(text, context);
        if (problem) {
          serialization = 'invalid';
          add('serialization', problem);
        } else {
          let decoded: ParameterInstance | undefined;
          let invalidJson = false;
          try {
            decoded =
              context.layer === 'media'
                ? decodeMedia(text, context)
                : context.parameter
                  ? decodeParameter(text, context.parameter)
                  : undefined;
          } catch (error) {
            invalidJson = error instanceof Error && error.message === 'INVALID_JSON_SERIALIZATION';
            add(
              'serialization',
              error instanceof Error && error.message === 'UNSAFE_EXAMPLE_NUMBER'
                ? 'UNSAFE_EXAMPLE_NUMBER'
                : invalidJson
                  ? 'INVALID_JSON_SERIALIZATION'
                  : 'SERIALIZATION_DECODE_FAILED',
            );
          }
          let matchesForward = false;
          if (data !== undefined && serialized !== undefined) {
            try {
              matchesForward = serializeExampleData(data, context) === serialized;
            } catch {
              /* Unavailable codec. */
            }
            if (matchesForward && decoded !== undefined && !dataEqual(data, decoded)) decoded = undefined;
          }
          serialization = invalidJson ? 'invalid' : decoded === undefined ? 'unavailable' : 'valid';
          decodedData = decoded;
          if (decoded !== undefined) {
            if (data !== undefined && serialized !== undefined) {
              pairing = matchesForward || dataEqual(data, decoded) ? 'valid' : 'invalid';
              if (pairing === 'invalid') add('pairing', 'EXAMPLE_PAIR_MISMATCH');
            } else if (data === undefined) {
              data = decoded;
              dataSource = 'decoded';
            }
          } else {
            if (data !== undefined && serialized !== undefined) {
              pairing = matchesForward ? 'valid' : 'unavailable';
            }
            add('serialization', 'SERIALIZATION_NOT_VERIFIED');
          }
        }
      }
    }
  } else {
    text = undefined;
    serialization = 'invalid';
  }
  return {
    fields,
    ...(data === undefined ? {} : { data, dataSource }),
    ...(decodedData === undefined ? {} : { decodedData }),
    ...(serialized === undefined ? {} : { serialized }),
    ...(external ? { external } : {}),
    ...(fields.value ? { legacyValue: source.value } : {}),
    ...(text === undefined ? {} : { text }),
    serialization,
    pairing,
    diagnostics,
  };
}

export function exampleParameterInput(
  example: ExampleRepresentation,
  layer: ExampleLayer,
): SerializedExampleParameter | undefined {
  if (example.text === undefined || example.external || example.serialization === 'invalid') return undefined;
  const instance =
    example.decodedData !== undefined
      ? example.decodedData
      : example.serialized === undefined || example.pairing === 'valid'
        ? example.data
        : undefined;
  return {
    text: example.text,
    layer: layer === 'media' ? 'media' : 'parameter',
    ...(instance === undefined ? {} : { instance }),
  };
}
