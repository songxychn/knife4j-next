import { escapeJsonPointerSegment, resolveLocalJsonPointer } from '../openapi31/document';
import type { OpenApiObjectLocation, OpenApiOperation } from '../openapiOperations';
import type {
  Oas32Parameter,
  Oas32ParameterCollection,
  Oas32ParameterContext,
  Oas32ParameterDiagnostic,
  Oas32ParamIn,
} from './oas32ParameterTypes';
import type { SchemaValue } from './types';

export const parameterOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
export const parameterRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
export const parameterChild = (parent: OpenApiObjectLocation, key: string, value: unknown): OpenApiObjectLocation => ({
  ownerRetrievalUri: parent.ownerRetrievalUri,
  pointer: `${parent.pointer}/${escapeJsonPointerSegment(key)}`,
  value,
});
export const parameterSchemaReference = (location: OpenApiObjectLocation): string =>
  `${location.ownerRetrievalUri}#${location.pointer.replace(/^#/, '').split('/').map(encodeURIComponent).join('/')}`;

/** Local component references are the standalone fallback. Other sites use the registry's typed edge resolver. */
function followParameterReference(
  site: OpenApiObjectLocation,
  kind: 'parameter' | 'media-type',
  document: Record<string, unknown>,
  operation: OpenApiOperation,
  context: Oas32ParameterContext,
): OpenApiObjectLocation | undefined {
  let current = site;
  const seen = new Set<string>();
  for (let depth = 0; depth < 32; depth++) {
    const raw = parameterRecord(current.value);
    if (!raw) return undefined;
    if (!parameterOwn(raw, '$ref')) return current;
    if (typeof raw.$ref !== 'string') return undefined;
    const id = JSON.stringify([current.ownerRetrievalUri, current.pointer]);
    if (seen.has(id)) return undefined;
    seen.add(id);
    if (context.resolveReference) {
      const target = context.resolveReference(current, kind);
      if (!target) return undefined;
      current = target;
    } else {
      const owner =
        context.documentFor?.(current) ?? (current.ownerRetrievalUri === operation.documentUri ? document : undefined);
      const target = owner ? resolveLocalJsonPointer(owner, raw.$ref) : undefined;
      const tokens = target?.tokens;
      if (
        !target?.found ||
        !tokens ||
        tokens.length !== 3 ||
        tokens[0] !== 'components' ||
        tokens[1] !== (kind === 'parameter' ? 'parameters' : 'mediaTypes')
      )
        return undefined;
      current = {
        value: target.value,
        ownerRetrievalUri: current.ownerRetrievalUri,
        pointer: `#/${tokens.map(escapeJsonPointerSegment).join('/')}`,
      };
    }
  }
  return undefined;
}

/** Builds the effective collection from E's *raw* owner locations, including refs E cannot project. */
export function buildOas32ParameterCollection(
  document: Record<string, unknown>,
  operation: OpenApiOperation,
  context: Oas32ParameterContext = {},
): Oas32ParameterCollection {
  const diagnostics: Oas32ParameterDiagnostic[] = [];
  const declarations: Array<{
    site: OpenApiObjectLocation;
    target?: OpenApiObjectLocation;
    scope: 'path' | 'operation';
  }> = [];
  let complete = true;
  const add = (code: string, message: string, location: OpenApiObjectLocation, key?: string) => {
    if (
      !diagnostics.some(
        (diagnostic) =>
          diagnostic.code === code &&
          diagnostic.key === key &&
          diagnostic.location?.pointer === location.pointer &&
          diagnostic.location.ownerRetrievalUri === location.ownerRetrievalUri,
      )
    )
      diagnostics.push({ phase: 'declaration', code, message, location, key, blocks: 'all' });
  };
  const effective = new Map<string, { site: OpenApiObjectLocation; target: OpenApiObjectLocation }>();
  const rawOperation = parameterRecord(operation.rawOperation.value);
  const arrays: Array<{ scope: 'path' | 'operation'; location?: OpenApiObjectLocation }> = [
    { scope: 'path', location: operation.pathItemMembers.parameters },
    {
      scope: 'operation',
      location:
        rawOperation && parameterOwn(rawOperation, 'parameters')
          ? parameterChild(operation.rawOperation, 'parameters', rawOperation.parameters)
          : undefined,
    },
  ];
  for (const { scope, location } of arrays) {
    if (!location) continue;
    if (!Array.isArray(location.value)) {
      add('PARAMETERS_NOT_ARRAY', 'The parameter collection must be an array.', location);
      complete = false;
      continue;
    }
    const seen = new Set<string>();
    location.value.forEach((value: unknown, index: number) => {
      const site = parameterChild(location, String(index), value);
      const target = followParameterReference(site, 'parameter', document, operation, context);
      declarations.push({ site, target, scope });
      if (!target) {
        complete = false;
        add(
          'PARAMETER_REFERENCE_UNAVAILABLE',
          'The effective parameter collection is incomplete: a parameter reference is unavailable.',
          site,
        );
        return;
      }
      const raw = parameterRecord(target.value);
      if (!raw) return;
      if (
        !parameterOwn(raw, 'name') ||
        typeof raw.name !== 'string' ||
        !parameterOwn(raw, 'in') ||
        !['path', 'query', 'querystring', 'header', 'cookie'].includes(String(raw.in))
      ) {
        add('PARAMETER_IDENTITY_INVALID', 'A parameter requires a string name and a valid in location.', target);
        return;
      }
      const key = `${String(raw.in)}:${raw.name}`;
      // Invalid declarations do not become valid by being overridden or unchecked.
      const hasSchema = parameterOwn(raw, 'schema');
      const hasContent = parameterOwn(raw, 'content');
      if (hasSchema === hasContent)
        add(
          'SCHEMA_CONTENT_EXCLUSIVE',
          'Every parameter declaration must contain exactly one of schema and content.',
          target,
          key,
        );
      if (hasContent && Object.keys(parameterRecord(raw.content) ?? {}).length !== 1)
        add('CONTENT_CARDINALITY', 'Every parameter content map must contain exactly one media type.', target, key);
      if (
        raw.in === 'querystring' &&
        ['schema', 'style', 'explode', 'allowReserved'].some((field) => parameterOwn(raw, field))
      )
        add('QUERYSTRING_ENCODING', 'A querystring declaration requires content without style fields.', target, key);
      if (hasContent && ['style', 'explode', 'allowReserved'].some((field) => parameterOwn(raw, field)))
        add('CONTENT_STYLE_CONFLICT', 'Content-based serialization cannot also declare style fields.', target, key);
      if (hasSchema && typeof raw.schema !== 'boolean' && !parameterRecord(raw.schema))
        add('SCHEMA_INVALID', 'Parameter schema must be an object or boolean.', target, key);
      for (const field of ['required', 'explode', 'allowReserved', 'allowEmptyValue', 'deprecated'])
        if (parameterOwn(raw, field) && typeof raw[field] !== 'boolean')
          add('PARAMETER_FIELD_TYPE', `Parameter ${field} must be boolean.`, target, key);
      if (parameterOwn(raw, 'allowEmptyValue') && raw.in !== 'query')
        add('ALLOW_EMPTY_LOCATION', 'allowEmptyValue is only applicable to query parameters.', target, key);
      if (seen.has(key))
        add('DUPLICATE_PARAMETER', 'Duplicate parameter name and location within one declaration list.', site, key);
      seen.add(key);
      effective.set(key, { site, target });
    });
  }
  const parameters: Oas32Parameter[] = [];
  for (const [key, { site, target }] of Array.from(effective.entries())) {
    const raw = parameterRecord(target.value);
    if (!raw) continue;
    const name = raw.name as string;
    const in_ = raw.in as Oas32ParamIn;
    if (in_ === 'header' && ['accept', 'content-type', 'authorization'].includes(name.toLowerCase())) continue;
    const report = (code: string, message: string) => add(code, message, target, key);
    const hasSchema = parameterOwn(raw, 'schema');
    const hasContent = parameterOwn(raw, 'content');
    if (hasSchema === hasContent)
      report('SCHEMA_CONTENT_EXCLUSIVE', 'A Parameter Object must have exactly one of schema and content.');
    if (in_ === 'path' && raw.required !== true)
      report('PATH_REQUIRED', 'A path parameter must declare required: true.');
    if (in_ === 'path' && !operation.path.includes(`{${name}}`))
      report('PATH_NAME_MISMATCH', 'The path parameter name must match a path template expression.');
    if (parameterOwn(raw, 'required') && typeof raw.required !== 'boolean')
      report('REQUIRED_INVALID', 'Parameter required must be boolean.');
    if (parameterOwn(raw, 'example') && parameterOwn(raw, 'examples'))
      report('EXAMPLE_CONFLICT', 'Parameter example and examples are mutually exclusive.');
    if (
      in_ === 'querystring' &&
      ['schema', 'style', 'explode', 'allowReserved'].some((field) => parameterOwn(raw, field))
    )
      report(
        'QUERYSTRING_ENCODING',
        'A querystring parameter requires content and cannot use schema, style, explode or allowReserved.',
      );
    let serialization: Oas32Parameter['serialization'];
    let mediaLocation: OpenApiObjectLocation | undefined;
    let schemaLocation: OpenApiObjectLocation | undefined;
    let itemSchemaLocation: OpenApiObjectLocation | undefined;
    if (hasContent) {
      if (['style', 'explode', 'allowReserved'].some((field) => parameterOwn(raw, field)))
        report(
          'CONTENT_STYLE_CONFLICT',
          'Content-based parameter serialization cannot also declare style, explode or allowReserved.',
        );
      const content = parameterRecord(raw.content);
      const entries = content ? Object.entries(content) : [];
      if (entries.length !== 1) report('CONTENT_CARDINALITY', 'Parameter content must have exactly one media type.');
      else {
        const [mediaType, media] = entries[0];
        serialization = { kind: 'content', mediaType };
        const mediaSite = parameterChild(parameterChild(target, 'content', content), mediaType, media);
        mediaLocation = followParameterReference(mediaSite, 'media-type', document, operation, context);
        if (!mediaLocation) {
          complete = false;
          add('MEDIA_REFERENCE_UNAVAILABLE', 'The parameter Media Type reference is unavailable.', mediaSite, key);
        } else {
          const mediaObject = parameterRecord(mediaLocation.value);
          if (!mediaObject) continue;
          if (parameterOwn(mediaObject, 'schema'))
            schemaLocation = parameterChild(mediaLocation, 'schema', mediaObject.schema);
          if (parameterOwn(mediaObject, 'itemSchema'))
            itemSchemaLocation = parameterChild(mediaLocation, 'itemSchema', mediaObject.itemSchema);
          if (
            itemSchemaLocation &&
            typeof itemSchemaLocation.value !== 'boolean' &&
            !parameterRecord(itemSchemaLocation.value)
          )
            report('ITEM_SCHEMA_INVALID', 'Media Type itemSchema must be an object or boolean.');
          if (parameterOwn(mediaObject, 'encoding')) {
            const encodings = parameterRecord(mediaObject.encoding);
            if (!encodings) report('ENCODING_INVALID', 'Media Type encoding must be a map of Encoding Objects.');
            for (const [name, encoding] of Object.entries(encodings ?? {})) {
              const object = parameterRecord(encoding);
              if (!object) {
                report('ENCODING_INVALID', `Encoding for ${name} must be an object.`);
                continue;
              }
              for (const field of ['style', 'contentType'])
                if (parameterOwn(object, field) && typeof object[field] !== 'string')
                  report('ENCODING_INVALID', `Encoding ${field} for ${name} must be a string.`);
              for (const field of ['explode', 'allowReserved'])
                if (parameterOwn(object, field) && typeof object[field] !== 'boolean')
                  report('ENCODING_INVALID', `Encoding ${field} for ${name} must be boolean.`);
            }
          }
          if (
            parameterOwn(mediaObject, 'encoding') &&
            (parameterOwn(mediaObject, 'prefixEncoding') || parameterOwn(mediaObject, 'itemEncoding'))
          )
            report('ENCODING_CONFLICT', 'Media Type encoding is mutually exclusive with positional encoding.');
        }
      }
    } else if (hasSchema) {
      schemaLocation = parameterChild(target, 'schema', raw.schema);
      const style = raw.style ?? (in_ === 'path' || in_ === 'header' ? 'simple' : 'form');
      const allowed =
        in_ === 'path'
          ? ['simple', 'label', 'matrix']
          : in_ === 'query'
            ? ['form', 'spaceDelimited', 'pipeDelimited', 'deepObject']
            : in_ === 'header'
              ? ['simple']
              : in_ === 'cookie'
                ? ['form', 'cookie']
                : [];
      if (typeof style !== 'string' || !allowed.includes(style))
        report('UNSUPPORTED_STYLE', 'This style is not permitted at the declared parameter location.');
      if (parameterOwn(raw, 'explode') && typeof raw.explode !== 'boolean')
        report('EXPLODE_INVALID', 'Parameter explode must be boolean.');
      if (parameterOwn(raw, 'allowReserved') && typeof raw.allowReserved !== 'boolean')
        report('ALLOW_RESERVED_INVALID', 'Parameter allowReserved must be boolean.');
      if (typeof style === 'string')
        serialization = {
          kind: 'schema',
          style,
          explode: typeof raw.explode === 'boolean' ? raw.explode : style === 'form' || style === 'cookie',
          allowReserved: raw.allowReserved === true,
        };
    }
    const schema = schemaLocation?.value;
    if (schemaLocation && typeof schema !== 'boolean' && !parameterRecord(schema))
      report('SCHEMA_INVALID', 'Parameter schema must be an object or boolean.');
    const schemaValue = typeof schema === 'boolean' || parameterRecord(schema) ? (schema as SchemaValue) : undefined;
    parameters.push({
      key,
      name,
      in: in_,
      required: raw.required === true,
      raw,
      declarationLocation: site,
      location: target,
      serialization,
      mediaLocation,
      schemaLocation,
      schema: schemaValue,
      schemaView: schemaLocation ? (context.schemaView?.(schemaLocation) ?? schemaValue) : undefined,
      ...(schemaLocation ? { schemaReference: parameterSchemaReference(schemaLocation) } : {}),
      itemSchemaLocation,
      ...(itemSchemaLocation ? { itemSchemaReference: parameterSchemaReference(itemSchemaLocation) } : {}),
    });
  }
  const whole = parameters.filter((parameter) => parameter.in === 'querystring');
  if (whole.length > 1)
    add(
      'MULTIPLE_QUERYSTRING',
      'The effective parameter collection permits only one querystring parameter.',
      whole[1].location,
      whole[1].key,
    );
  if (whole.length && parameters.some((parameter) => parameter.in === 'query'))
    add(
      'QUERY_QUERYSTRING_CONFLICT',
      'The effective parameter collection cannot combine query and querystring parameters.',
      whole[0].location,
      whole[0].key,
    );
  for (const match of Array.from(operation.path.matchAll(/\{([^}]+)\}/g))) {
    if (!parameters.some((parameter) => parameter.in === 'path' && parameter.name === match[1]))
      add(
        'PATH_PARAMETER_MISSING',
        'A path template expression has no declared path parameter.',
        operation.rawOperation,
      );
  }
  return { version: '3.2', operation, parameters, declarations, complete, diagnostics };
}
