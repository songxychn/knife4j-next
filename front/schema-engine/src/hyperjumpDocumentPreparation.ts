import type { SchemaDocument } from '@hyperjump/json-schema/experimental';
import { isIriReference, normalizeIri, parseIri, resolveIri, toAbsoluteIri } from '@hyperjump/uri';
import { SchemaEngineError } from './errors';
import { appendJsonPointer as childPointer, isRecord, owns } from './guards';
import { JSON_SCHEMA_2020_12, OPENAPI_31_BASE_DIALECT } from './openapi32Dialect';

const OPENAPI_31_SCHEMA_BASE = 'https://spec.openapis.org/oas/3.1/schema-base';
const OPENAPI_31_SCHEMA_DRAFT_2020_12 = 'https://spec.openapis.org/oas/3.1/schema-draft-2020-12';
const OAS_31_VERSION = /^3\.1\.\d+(?:-.+)?$/;
const ANCHOR_NAME = /^[A-Za-z_][-A-Za-z0-9._]*$/;
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const RESPONSE_KEY = /^(?:default|[1-5](?:\d{2}|XX))$/;
const SCHEMA_SINGLE_KEYWORDS = [
  'not',
  'if',
  'then',
  'else',
  'contains',
  'propertyNames',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contentSchema',
  'items',
] as const;
const SCHEMA_ARRAY_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;
const SCHEMA_MAP_KEYWORDS = ['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions'] as const;
const KNIFE4J_SCHEMA_RESOURCES_FIELD = /^x-knife4j-schema-resources(?:-(?:[2-9]|[1-9]\d+))?$/;
const PORTABLE_SCHEMA_RESOURCES_VERSION = 1;
const SPARSE_OPENAPI_RESOURCE_KEYS = new Set(['$schema', '$id', 'paths', 'webhooks', 'components']);
const HYPERJUMP_SCHEMA_CONTROL_KEYS = new Set([
  '$id',
  '$schema',
  '$anchor',
  '$dynamicAnchor',
  '$vocabulary',
  '$ref',
  '$dynamicRef',
  '$recursiveAnchor',
  '$recursiveRef',
]);
const CONTROL_MASK_PREFIX = 'knife4jOpaqueControl';
const CONTROL_MASK_PREFIX_PATTERN = new RegExp(`^_*${CONTROL_MASK_PREFIX}`);

const SCHEMA_IDENTIFIER_KEYS = new Set(['$id', '$ref', '$dynamicRef', '$recursiveRef']);

/**
 * Decode UTF-8 percent-encoding in http(s) identifiers before Hyperjump IRI
 * normalization. This originally compensated for the pre-1.3.9 URI library
 * decoding UTF-8 octets as Latin-1. Keep the established HTTP identifier and
 * fragment handling when upgrading the underlying normalizer.
 * ASCII percent-encoding (`%24`, `%20`, `%2F`) is left intact so JSON Pointer
 * fragments are not double-encoded.
 */
function decodeUtf8PercentEncoding(value: string): string {
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/gi, (sequence) => {
    const bytes = new Uint8Array(sequence.length / 3);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(sequence.slice(index * 3 + 1, index * 3 + 3), 16);
    }
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      let offset = 0;
      let result = '';
      for (const char of decoded) {
        const code = char.codePointAt(0)!;
        const byteLength = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
        result += code < 0x80 ? sequence.slice(offset, offset + byteLength * 3).toUpperCase() : char;
        offset += byteLength * 3;
      }
      return result;
    } catch {
      return sequence.toUpperCase();
    }
  });
}

function canonicalizeHttpIri(uri: string): string {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return uri;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return uri;
  const hash = parsed.hash ? `#${decodeUtf8PercentEncoding(parsed.hash.slice(1))}` : '';
  return `${parsed.origin}${decodeUtf8PercentEncoding(parsed.pathname)}${parsed.search}${hash}`;
}

export function normalizeAbsoluteUri(uri: string, allowFragment: boolean): string {
  if (typeof uri !== 'string' || uri.length === 0) {
    throw new SchemaEngineError('INVALID_URI', 'Schema URI must be a non-empty absolute URI.', { uri });
  }
  if (!allowFragment && uri.includes('#')) {
    throw new SchemaEngineError('INVALID_URI', 'A retrieval URI must not contain a fragment.', { uri });
  }
  try {
    const canonical = canonicalizeHttpIri(uri);
    parseIri(canonical);
    return normalizeIri(canonical);
  } catch (error) {
    throw new SchemaEngineError('INVALID_URI', `Schema URI '${uri}' is not absolute.`, { uri }, error);
  }
}

export function withoutFragment(uri: string): string {
  return toAbsoluteIri(uri);
}

const normalizeDialect = (dialect: string): string => (dialect.endsWith('#') ? dialect.slice(0, -1) : dialect);

interface PreparedDocument {
  readonly value: unknown;
  readonly unmaskSchemaObject: (value: Record<string, unknown>) => void;
  readonly hasMaskedControl: (value: Record<string, unknown>, key: string) => boolean;
  readonly restoreRegisteredDocument: (document: SchemaDocument) => void;
}

/**
 * In Hyperjump 1.18.0, buildSchemaDocument walks every JSON object, including
 * annotation data. Its vocabularies choose the names of control keywords but
 * cannot restrict that walk to Schema Objects. Mask control names on the
 * private copy, expose them at typed Schema positions, then restore the
 * opaque data and affected cursors once the resource index has been built.
 */
export function prepareDocumentForHyperjump(document: unknown): PreparedDocument {
  const usedPrefixes = new Set<string>();
  const collectPrefixes = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collectPrefixes);
      return;
    }
    if (!isRecord(value)) return;
    for (const key of Object.keys(value)) {
      const prefix = CONTROL_MASK_PREFIX_PATTERN.exec(key)?.[0];
      if (prefix !== undefined) usedPrefixes.add(prefix);
      collectPrefixes(value[key]);
    }
  };
  collectPrefixes(document);

  let maskPrefix = CONTROL_MASK_PREFIX;
  while (usedPrefixes.has(maskPrefix)) maskPrefix = `_${maskPrefix}`;
  const maskedKey = (key: string): string => `${maskPrefix}${key}`;
  let maskedControls = 0;
  const maskControls = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(maskControls);
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        if (HYPERJUMP_SCHEMA_CONTROL_KEYS.has(key)) {
          maskedControls++;
          key = maskedKey(key);
        }
        return [key, maskControls(child)];
      }),
    );
  };

  const unmaskSchemaObject = (value: Record<string, unknown>): void => {
    for (const key of HYPERJUMP_SCHEMA_CONTROL_KEYS) {
      const masked = maskedKey(key);
      if (!owns(value, masked)) continue;
      const restored = value[masked];
      value[key] =
        SCHEMA_IDENTIFIER_KEYS.has(key) && typeof restored === 'string' ? canonicalizeHttpIri(restored) : restored;
      delete value[masked];
      maskedControls--;
    }
  };

  const restoreControls = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(restoreControls);
      return;
    }
    if (!isRecord(value)) return;
    Object.entries(value).forEach(([key, child]) => {
      restoreControls(child);
      if (!key.startsWith(maskPrefix)) return;
      value[key.slice(maskPrefix.length)] = child;
      delete value[key];
    });
  };
  const restorePointer = (pointer: string): string =>
    pointer
      .split('/')
      .map((token) => (token.startsWith(maskPrefix) ? token.slice(maskPrefix.length) : token))
      .join('/');
  const restoreDynamicAnchorUri = (uri: string): string => {
    const fragmentIndex = uri.indexOf('#');
    if (fragmentIndex < 0) return uri;
    const pointer = decodeURI(uri.slice(fragmentIndex + 1));
    return `${uri.slice(0, fragmentIndex + 1)}${encodeURI(restorePointer(pointer))}`;
  };

  return {
    value: maskControls(document),
    unmaskSchemaObject,
    hasMaskedControl: (value, key) => owns(value, maskedKey(key)),
    restoreRegisteredDocument: (registered) => {
      // If all controls were at typed Schema positions, no opaque keys or
      // pointers were renamed in the document that Hyperjump received.
      if (maskedControls === 0) return;
      const documents = new Set<SchemaDocument>([
        registered,
        ...Object.values(registered.embedded ?? {}).map((entry) => entry as SchemaDocument),
      ]);
      documents.forEach((entry) => {
        restoreControls(entry.root);
        Object.entries(entry.anchors).forEach(([anchor, pointer]) => {
          entry.anchors[anchor] = restorePointer(pointer);
        });
        Object.entries(entry.dynamicAnchors).forEach(([anchor, uri]) => {
          entry.dynamicAnchors[anchor] = restoreDynamicAnchorUri(uri);
        });
      });
    },
  };
}

export function inspectResourceDeclarations(
  document: unknown,
  retrievalUri: string,
  prepared: Pick<PreparedDocument, 'unmaskSchemaObject' | 'hasMaskedControl'>,
): ReadonlyMap<string, string> {
  const resourcePointers = new Map<string, string>([[withoutFragment(retrievalUri), '#']]);
  const declared = new Map<string, string>([[withoutFragment(retrievalUri), '# (retrieval URI)']]);
  const anchors = new Map<string, Map<string, string>>();
  const defaultSchemaDialect =
    isRecord(document) && typeof document.openapi === 'string'
      ? typeof document.jsonSchemaDialect === 'string'
        ? normalizeDialect(document.jsonSchemaDialect)
        : OPENAPI_31_BASE_DIALECT
      : JSON_SCHEMA_2020_12;

  const addAnchor = (resourceUri: string, name: string, path: string): void => {
    if (!ANCHOR_NAME.test(name)) {
      throw new SchemaEngineError(
        'INVALID_DOCUMENT',
        `Schema anchor '${name}' at '${path}' is not a valid anchor name.`,
        {
          resourceUri,
        },
      );
    }
    const resourceAnchors = anchors.get(resourceUri) ?? new Map<string, string>();
    const previousPath = resourceAnchors.get(name);
    if (previousPath !== undefined) {
      throw new SchemaEngineError(
        'RESOURCE_URI_CONFLICT',
        `Schema anchor '${name}' in '${resourceUri}' is declared by both '${previousPath}' and '${path}'.`,
        { resourceUri },
      );
    }
    resourceAnchors.set(name, path);
    anchors.set(resourceUri, resourceAnchors);
  };

  const visitSchema = (
    value: unknown,
    baseUri: string,
    path: string,
    resourceRoot = false,
    inheritedDialect = defaultSchemaDialect,
  ): string => {
    if (!isRecord(value)) return baseUri;
    prepared.unmaskSchemaObject(value);

    let resourceBase = baseUri;
    const declaresResource = resourceRoot || typeof value.$id === 'string';
    const schemaDialect = typeof value.$schema === 'string' ? normalizeDialect(value.$schema) : inheritedDialect;
    if (typeof value.$id === 'string') {
      let resolved: string;
      try {
        if (!isIriReference(value.$id)) throw new Error('Value is not an IRI reference.');
        resolved = resolveIri(value.$id, baseUri);
      } catch (error) {
        throw new SchemaEngineError(
          'INVALID_DOCUMENT',
          `Schema resource identifier '${value.$id}' at '${path}/$id' is not a valid URI reference.`,
          { uri: value.$id },
          error,
        );
      }
      const fragment = parseIri(resolved).fragment;
      if (fragment !== undefined && fragment !== '') {
        throw new SchemaEngineError(
          'INVALID_DOCUMENT',
          `Schema resource identifier '${value.$id}' at '${path}/$id' must not contain a non-empty fragment.`,
          { uri: resolved },
        );
      }
      resourceBase = withoutFragment(resolved);
      const previousPath = declared.get(resourceBase);
      const rootIdentifierMatchesRetrieval = resourceRoot && resourceBase === withoutFragment(retrievalUri);
      if (previousPath !== undefined && !rootIdentifierMatchesRetrieval) {
        throw new SchemaEngineError(
          'RESOURCE_URI_CONFLICT',
          `Schema resource URI '${resourceBase}' is declared by both '${previousPath}' and '${path}/$id'.`,
          { resourceUri: resourceBase },
        );
      }
      declared.set(resourceBase, `${path}/$id`);
    }

    if (declaresResource) {
      resourcePointers.set(resourceBase, path);
      if (value.$vocabulary !== undefined) {
        throw new SchemaEngineError(
          'UNSUPPORTED_DIALECT',
          `Custom dialect declarations are not supported at schema resource '${resourceBase}'.`,
          { uri: resourceBase },
        );
      }
      if (typeof value.$schema === 'string') {
        const dialect = normalizeDialect(value.$schema);
        if (dialect !== JSON_SCHEMA_2020_12 && dialect !== OPENAPI_31_BASE_DIALECT) {
          throw new SchemaEngineError('UNSUPPORTED_DIALECT', `Unsupported JSON Schema dialect '${value.$schema}'.`, {
            uri: value.$schema,
          });
        }
      } else {
        // Hyperjump otherwise inherits the OAS document meta-schema when an
        // embedded $id creates a resource. Materialize the Schema dialect on
        // this private registration copy, including document-level overrides.
        value.$schema = schemaDialect;
      }
    }
    if (typeof value.$anchor === 'string') addAnchor(resourceBase, value.$anchor, `${path}/$anchor`);
    if (typeof value.$dynamicAnchor === 'string') {
      addAnchor(resourceBase, value.$dynamicAnchor, `${path}/$dynamicAnchor`);
    }

    for (const keyword of SCHEMA_SINGLE_KEYWORDS) {
      if (owns(value, keyword))
        visitSchema(value[keyword], resourceBase, childPointer(path, keyword), false, schemaDialect);
    }
    for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
      const schemas = value[keyword];
      if (!Array.isArray(schemas)) continue;
      schemas.forEach((schema, index) =>
        visitSchema(schema, resourceBase, childPointer(childPointer(path, keyword), index), false, schemaDialect),
      );
    }
    for (const keyword of SCHEMA_MAP_KEYWORDS) {
      const schemas = value[keyword];
      if (!isRecord(schemas)) continue;
      Object.entries(schemas).forEach(([name, schema]) =>
        visitSchema(schema, resourceBase, childPointer(childPointer(path, keyword), name), false, schemaDialect),
      );
    }
    return resourceBase;
  };

  const visitMediaType = (value: unknown, path: string, baseUri: string): void => {
    if (!isRecord(value)) return;
    if (owns(value, 'schema')) visitSchema(value.schema, baseUri, childPointer(path, 'schema'));
    if (!isRecord(value.encoding)) return;
    Object.entries(value.encoding).forEach(([name, encoding]) => {
      if (!isRecord(encoding) || !isRecord(encoding.headers)) return;
      Object.entries(encoding.headers).forEach(([headerName, header]) =>
        visitHeader(
          header,
          childPointer(childPointer(childPointer(childPointer(path, 'encoding'), name), 'headers'), headerName),
          baseUri,
        ),
      );
    });
  };

  const visitContent = (value: unknown, path: string, baseUri: string): void => {
    if (!isRecord(value)) return;
    Object.entries(value).forEach(([mediaType, media]) =>
      visitMediaType(media, childPointer(path, mediaType), baseUri),
    );
  };

  const visitParameter = (value: unknown, path: string, baseUri: string): void => {
    if (!isRecord(value) || typeof value.$ref === 'string' || prepared.hasMaskedControl(value, '$ref')) return;
    if (owns(value, 'schema')) visitSchema(value.schema, baseUri, childPointer(path, 'schema'));
    if (owns(value, 'content')) visitContent(value.content, childPointer(path, 'content'), baseUri);
  };

  function visitHeader(value: unknown, path: string, baseUri: string): void {
    if (!isRecord(value) || typeof value.$ref === 'string' || prepared.hasMaskedControl(value, '$ref')) return;
    if (owns(value, 'schema')) visitSchema(value.schema, baseUri, childPointer(path, 'schema'));
    if (owns(value, 'content')) visitContent(value.content, childPointer(path, 'content'), baseUri);
  }

  const visitRequestBody = (value: unknown, path: string, baseUri: string): void => {
    if (!isRecord(value) || typeof value.$ref === 'string' || prepared.hasMaskedControl(value, '$ref')) return;
    if (owns(value, 'content')) visitContent(value.content, childPointer(path, 'content'), baseUri);
  };

  const visitResponse = (value: unknown, path: string, baseUri: string): void => {
    if (!isRecord(value) || typeof value.$ref === 'string' || prepared.hasMaskedControl(value, '$ref')) return;
    if (isRecord(value.headers)) {
      Object.entries(value.headers).forEach(([name, header]) =>
        visitHeader(header, childPointer(childPointer(path, 'headers'), name), baseUri),
      );
    }
    if (owns(value, 'content')) visitContent(value.content, childPointer(path, 'content'), baseUri);
  };

  const visitCallback = (value: unknown, path: string, baseUri: string): void => {
    if (!isRecord(value) || typeof value.$ref === 'string' || prepared.hasMaskedControl(value, '$ref')) return;
    Object.entries(value).forEach(([expression, pathItem]) => {
      if (expression.startsWith('x-')) return;
      visitPathItem(pathItem, childPointer(path, expression), baseUri);
    });
  };

  const visitOperation = (value: unknown, path: string, baseUri: string): void => {
    if (!isRecord(value)) return;
    if (Array.isArray(value.parameters)) {
      value.parameters.forEach((parameter, index) =>
        visitParameter(parameter, childPointer(childPointer(path, 'parameters'), index), baseUri),
      );
    }
    if (owns(value, 'requestBody')) visitRequestBody(value.requestBody, childPointer(path, 'requestBody'), baseUri);
    if (isRecord(value.responses)) {
      Object.entries(value.responses).forEach(([status, response]) => {
        if (!RESPONSE_KEY.test(status)) return;
        visitResponse(response, childPointer(childPointer(path, 'responses'), status), baseUri);
      });
    }
    if (isRecord(value.callbacks)) {
      Object.entries(value.callbacks).forEach(([name, callback]) =>
        visitCallback(callback, childPointer(childPointer(path, 'callbacks'), name), baseUri),
      );
    }
  };

  function visitPathItem(value: unknown, path: string, baseUri: string): void {
    if (!isRecord(value)) return;
    if (Array.isArray(value.parameters)) {
      value.parameters.forEach((parameter, index) =>
        visitParameter(parameter, childPointer(childPointer(path, 'parameters'), index), baseUri),
      );
    }
    for (const method of HTTP_METHODS) {
      if (owns(value, method)) visitOperation(value[method], childPointer(path, method), baseUri);
    }
  }

  const visitComponentMap = (
    components: Record<string, unknown>,
    key: string,
    path: string,
    baseUri: string,
    visitor: (value: unknown, path: string, baseUri: string) => void,
  ): void => {
    const entries = components[key];
    if (!isRecord(entries)) return;
    Object.entries(entries).forEach(([name, value]) =>
      visitor(value, childPointer(childPointer(path, key), name), baseUri),
    );
  };

  const visitOpenApiStructure = (value: Record<string, unknown>, rootPath: string, baseUri: string): void => {
    if (isRecord(value.paths)) {
      Object.entries(value.paths).forEach(([path, pathItem]) => {
        if (!path.startsWith('/')) return;
        visitPathItem(pathItem, childPointer(childPointer(rootPath, 'paths'), path), baseUri);
      });
    }
    if (isRecord(value.webhooks)) {
      Object.entries(value.webhooks).forEach(([name, pathItem]) =>
        visitPathItem(pathItem, childPointer(childPointer(rootPath, 'webhooks'), name), baseUri),
      );
    }
    if (!isRecord(value.components)) return;
    const components = value.components;
    const path = childPointer(rootPath, 'components');
    visitComponentMap(components, 'schemas', path, baseUri, (schema, schemaPath, schemaBaseUri) =>
      visitSchema(schema, schemaBaseUri, schemaPath),
    );
    visitComponentMap(components, 'parameters', path, baseUri, visitParameter);
    visitComponentMap(components, 'headers', path, baseUri, visitHeader);
    visitComponentMap(components, 'requestBodies', path, baseUri, visitRequestBody);
    visitComponentMap(components, 'responses', path, baseUri, visitResponse);
    visitComponentMap(components, 'callbacks', path, baseUri, visitCallback);
    visitComponentMap(components, 'pathItems', path, baseUri, visitPathItem);
  };

  const isSparsePortableOpenApiResource = (value: Record<string, unknown>): boolean =>
    typeof value.$schema === 'string' &&
    normalizeDialect(value.$schema) === OPENAPI_31_BASE_DIALECT &&
    typeof value.$id === 'string' &&
    (owns(value, 'paths') || owns(value, 'webhooks') || owns(value, 'components')) &&
    Object.keys(value).every((key) => SPARSE_OPENAPI_RESOURCE_KEYS.has(key));

  const visitOpenApiDocument = (value: Record<string, unknown>): void => {
    for (const [key, container] of Object.entries(value)) {
      if (
        !KNIFE4J_SCHEMA_RESOURCES_FIELD.test(key) ||
        !isRecord(container) ||
        container.version !== PORTABLE_SCHEMA_RESOURCES_VERSION ||
        !isRecord(container.resources)
      ) {
        continue;
      }
      Object.entries(container.resources).forEach(([name, schema]) => {
        const resourcePath = childPointer(childPointer(childPointer('#', key), 'resources'), name);
        const resourceBase = visitSchema(schema, retrievalUri, resourcePath);
        // Portable exports use sparse, OAS-shaped Schema resources to preserve
        // original JSON Pointer identities without making opaque values schemas.
        if (isRecord(schema) && isSparsePortableOpenApiResource(schema)) {
          visitOpenApiStructure(schema, resourcePath, resourceBase);
        }
      });
    }
    visitOpenApiStructure(value, '#', retrievalUri);
  };

  if (isRecord(document) && typeof document.openapi === 'string') visitOpenApiDocument(document);
  else visitSchema(document, retrievalUri, '#', true);
  return resourcePointers;
}

export function contextDialectFor(document: unknown): string {
  if (!isRecord(document) || typeof document.openapi !== 'string') {
    if (isRecord(document) && typeof document.$schema === 'string') {
      const dialect = normalizeDialect(document.$schema);
      if (dialect !== JSON_SCHEMA_2020_12 && dialect !== OPENAPI_31_BASE_DIALECT) {
        throw new SchemaEngineError('UNSUPPORTED_DIALECT', `Unsupported JSON Schema dialect '${document.$schema}'.`, {
          uri: document.$schema,
        });
      }
    }
    return JSON_SCHEMA_2020_12;
  }

  if (!OAS_31_VERSION.test(document.openapi)) {
    throw new SchemaEngineError(
      'UNSUPPORTED_DIALECT',
      `SchemaEngine accepts OpenAPI 3.1.x documents; received '${document.openapi}'.`,
    );
  }

  if (document.jsonSchemaDialect === undefined) return OPENAPI_31_SCHEMA_BASE;
  if (typeof document.jsonSchemaDialect !== 'string') {
    throw new SchemaEngineError('INVALID_DOCUMENT', 'OpenAPI jsonSchemaDialect must be a URI string.');
  }
  const dialect = normalizeDialect(document.jsonSchemaDialect);
  if (dialect === OPENAPI_31_BASE_DIALECT) return OPENAPI_31_SCHEMA_BASE;
  if (dialect === JSON_SCHEMA_2020_12) return OPENAPI_31_SCHEMA_DRAFT_2020_12;
  throw new SchemaEngineError(
    'UNSUPPORTED_DIALECT',
    `Unsupported OpenAPI Schema dialect '${document.jsonSchemaDialect}'.`,
    {
      uri: document.jsonSchemaDialect,
    },
  );
}
