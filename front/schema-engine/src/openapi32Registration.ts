import type { SchemaDocument } from '@hyperjump/json-schema/experimental';
import { SchemaEngineError } from './errors';
import { normalizeUri, parseUri, resolveUri, toAbsoluteUri } from './uri';
import { JSON_SCHEMA_2020_12, publicSchemaDialect, processingSchemaDialect } from './openapi32Dialect';
import type { JsonValue, SchemaDocumentRegistrationContext, SchemaLocationMetadata, SchemaNode } from './types';

export const isOpenApi32 = (value: unknown): boolean =>
  record(value) && typeof value.openapi === 'string' && /^3\.2\.\d+(?:-.+)?$/.test(value.openapi);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const pointerChild = (pointer: string, key: string | number): string =>
  `${pointer}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
const ANCHOR = /^[A-Za-z_][-A-Za-z0-9._]*$/;
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'];
const SINGLE = [
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
];
const ARRAYS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const MAPS = ['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions'];

export function schemaValueAt(document: unknown, pointer: string): unknown {
  let value = document;
  for (const token of pointer.slice(2).split('/')) {
    if (pointer === '#') return document;
    if (value === null || typeof value !== 'object') return undefined;
    const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!owns(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Only for complete 3.2 documents; fragment locations must come from the graph. */
export function collectOpenApi32SchemaLocations(document: unknown, baseUri: string): SchemaLocationMetadata[] {
  const locations: SchemaLocationMetadata[] = [];
  const defaultDialect = publicSchemaDialect(record(document) ? document.jsonSchemaDialect : undefined);
  const schema = (value: unknown, pointer: string, base: string, inherited = defaultDialect): void => {
    if (typeof value !== 'boolean' && !record(value))
      throw new SchemaEngineError('INVALID_DOCUMENT', `Expected a Schema Object at '${pointer}'.`);
    const dialect = publicSchemaDialect(record(value) ? value.$schema : undefined, inherited);
    locations.push({ pointer, evaluationBaseUri: base, schemaDialect: dialect });
    if (!record(value)) return;
    const local = typeof value.$id === 'string' ? resolveUri(value.$id, base) : base;
    SINGLE.forEach((key) => {
      if (owns(value, key)) schema(value[key], pointerChild(pointer, key), local, dialect);
    });
    ARRAYS.forEach((key) => {
      if (Array.isArray(value[key]))
        value[key].forEach((child, index) =>
          schema(child, pointerChild(pointerChild(pointer, key), index), local, dialect),
        );
    });
    MAPS.forEach((key) =>
      map(value[key], pointerChild(pointer, key), (child, path) => schema(child, path, local, dialect)),
    );
  };
  const map = (value: unknown, pointer: string, visitor: (value: unknown, pointer: string) => void): void => {
    if (record(value)) Object.entries(value).forEach(([key, child]) => visitor(child, pointerChild(pointer, key)));
  };
  const reference = (value: unknown): boolean => record(value) && owns(value, '$ref');
  const content = (value: unknown, pointer: string): void => map(value, pointer, media);
  const parameter = (value: unknown, pointer: string): void => {
    if (!record(value) || reference(value)) return;
    if (owns(value, 'schema')) schema(value.schema, pointerChild(pointer, 'schema'), baseUri);
    content(value.content, pointerChild(pointer, 'content'));
  };
  function encoding(value: unknown, pointer: string): void {
    if (!record(value)) return;
    map(value.headers, pointerChild(pointer, 'headers'), parameter);
    map(value.encoding, pointerChild(pointer, 'encoding'), encoding);
    if (Array.isArray(value.prefixEncoding))
      value.prefixEncoding.forEach((child, index) =>
        encoding(child, pointerChild(pointerChild(pointer, 'prefixEncoding'), index)),
      );
    if (owns(value, 'itemEncoding')) encoding(value.itemEncoding, pointerChild(pointer, 'itemEncoding'));
  }
  function media(value: unknown, pointer: string): void {
    if (!record(value) || reference(value)) return;
    for (const key of ['schema', 'itemSchema'])
      if (owns(value, key)) schema(value[key], pointerChild(pointer, key), baseUri);
    encoding(value, pointer);
  }
  const request = (value: unknown, pointer: string): void => {
    if (record(value) && !reference(value)) content(value.content, pointerChild(pointer, 'content'));
  };
  const response = (value: unknown, pointer: string): void => {
    if (!record(value) || reference(value)) return;
    map(value.headers, pointerChild(pointer, 'headers'), parameter);
    content(value.content, pointerChild(pointer, 'content'));
  };
  const parameters = (value: unknown, pointer: string): void => {
    if (Array.isArray(value)) value.forEach((child, index) => parameter(child, pointerChild(pointer, index)));
  };
  function operation(value: unknown, pointer: string): void {
    if (!record(value)) return;
    parameters(value.parameters, pointerChild(pointer, 'parameters'));
    request(value.requestBody, pointerChild(pointer, 'requestBody'));
    if (record(value.responses))
      Object.entries(value.responses).forEach(([key, child]) => {
        if (/^(?:default|[1-5](?:\d{2}|XX))$/.test(key))
          response(child, pointerChild(pointerChild(pointer, 'responses'), key));
      });
    map(value.callbacks, pointerChild(pointer, 'callbacks'), callback);
  }
  function pathItem(value: unknown, pointer: string): void {
    if (!record(value)) return;
    parameters(value.parameters, pointerChild(pointer, 'parameters'));
    METHODS.forEach((method) => operation(value[method], pointerChild(pointer, method)));
    if (record(value.additionalOperations))
      Object.entries(value.additionalOperations).forEach(([method, child]) => {
        if (/^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/.test(method) && !METHODS.includes(method.toLowerCase()))
          operation(child, pointerChild(pointerChild(pointer, 'additionalOperations'), method));
      });
  }
  function callback(value: unknown, pointer: string): void {
    if (!record(value) || reference(value)) return;
    Object.entries(value).forEach(([key, child]) => {
      if (!key.startsWith('x-')) pathItem(child, pointerChild(pointer, key));
    });
  }
  if (!record(document)) return locations;
  if (record(document.paths))
    Object.entries(document.paths).forEach(([key, child]) => {
      if (key.startsWith('/')) pathItem(child, pointerChild('#/paths', key));
    });
  map(document.webhooks, '#/webhooks', pathItem);
  if (record(document.components)) {
    const components = document.components;
    map(components.schemas, '#/components/schemas', (value, pointer) => schema(value, pointer, baseUri));
    for (const [key, visitor] of Object.entries({
      parameters: parameter,
      headers: parameter,
      requestBodies: request,
      responses: response,
      callbacks: callback,
      pathItems: pathItem,
      mediaTypes: media,
    }))
      map(components[key], `#/components/${key}`, visitor);
  }
  return locations;
}

function hex(value: string): string {
  return [...new TextEncoder().encode(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
const PHYSICAL_PREFIX = 'urn:knife4j-internal:oas32:resource:';
export const physicalResourceUri = (uri: string): string => `${PHYSICAL_PREFIX}${hex(toAbsoluteUri(uri))}`;
export function publicResourceUri(uri: string): string {
  if (!uri.startsWith(PHYSICAL_PREFIX)) return uri;
  const encoded = uri.slice(PHYSICAL_PREFIX.length).split('#')[0];
  if (!/^(?:[0-9a-f]{2})+$/.test(encoded)) return uri;
  return new TextDecoder().decode(Uint8Array.from(encoded.match(/../g)!, (pair) => Number.parseInt(pair, 16)));
}
const physicalAnchor = (name: string): string => `a${hex(name)}`;
const physicalPointer = (pointer: string): string => `p${hex(pointer)}`;
const encodedPointer = (pointer: string): string => encodeURIComponent(pointer).replace(/%2F/g, '/');

export function normalizePublicUri(uri: string, fragment = true): string {
  try {
    const normalized = normalizeUri(uri);
    if (!parseUri(normalized).scheme || (!fragment && parseUri(normalized).fragment !== undefined))
      throw new Error('Expected an absolute URI.');
    return normalized;
  } catch (cause) {
    throw new SchemaEngineError('INVALID_URI', `Invalid Schema URI '${uri}'.`, { uri }, cause);
  }
}

export interface OpenApi32SchemaLocation {
  readonly pointer: string;
  readonly value: JsonValue;
  readonly dialect: string;
  readonly baseUri: string;
  readonly resourceUri: string;
  readonly resourcePointer: string;
  readonly schemaRootPointer: string;
  readonly physicalResource: string;
  readonly relativePointer: string;
}
export interface OpenApi32Reference {
  readonly source: OpenApi32SchemaLocation;
  readonly uri: string;
  readonly keyword: '$ref' | '$dynamicRef';
}

/** Per-registration public identity index. Hyperjump never normalizes public URIs. */
export class OpenApi32Registration {
  readonly document: unknown;
  readonly retrievalUri: string;
  readonly physicalRetrievalUri: string;
  readonly documentBaseUri: string;
  readonly selfUri?: string;
  readonly physicalRootUri: string;
  readonly locations = new Map<string, OpenApi32SchemaLocation>();
  readonly resourceAliases = new Map<string, string>();
  readonly exactAliases = new Map<string, string>();
  readonly physicalResources = new Map<string, string>();
  readonly resourcePointers = new Map<string, string>();
  readonly references: OpenApi32Reference[] = [];
  readonly metaRoots: JsonValue[] = [];
  private readonly roots: string[] = [];

  constructor(document: unknown, retrievalUri: string, context?: SchemaDocumentRegistrationContext) {
    this.document = structuredClone(document);
    document = this.document;
    this.retrievalUri = normalizePublicUri(retrievalUri, false);
    this.physicalRetrievalUri = physicalResourceUri(this.retrievalUri);
    this.selfUri =
      context?.selfUri ??
      (isOpenApi32(document) && record(document) && typeof document.$self === 'string'
        ? resolveUri(document.$self, this.retrievalUri)
        : undefined);
    this.documentBaseUri = toAbsoluteUri(context?.documentBaseUri ?? this.selfUri ?? this.retrievalUri);
    const rootIdentity = this.selfUri && !parseUri(this.selfUri).fragment ? this.documentBaseUri : this.retrievalUri;
    this.physicalRootUri = physicalResourceUri(rootIdentity);
    this.resourceAliases.set(this.retrievalUri, '#');
    if (!this.selfUri || !parseUri(this.selfUri).fragment) this.resourceAliases.set(this.documentBaseUri, '#');
    if (this.selfUri) this.exactAliases.set(normalizePublicUri(this.selfUri), '#');
    this.physicalResources.set(this.physicalRootUri, rootIdentity);
    this.resourcePointers.set(this.physicalRootUri, '#');
    const metadata = context?.schemaLocations ?? collectOpenApi32SchemaLocations(document, this.documentBaseUri);
    const ordered = [...metadata].sort((left, right) => left.pointer.length - right.pointer.length);
    for (const entry of ordered) {
      const value = schemaValueAt(document, entry.pointer);
      if (typeof value !== 'boolean' && !record(value))
        throw new SchemaEngineError('INVALID_DOCUMENT', `Expected a Schema at '${entry.pointer}'.`);
      let parent: OpenApi32SchemaLocation | undefined;
      for (let pointer = entry.pointer; pointer.includes('/');) {
        pointer = pointer.slice(0, pointer.lastIndexOf('/'));
        parent = this.locations.get(pointer);
        if (parent) break;
      }
      if (!parent) this.roots.push(entry.pointer);
      const dialect = publicSchemaDialect(
        record(value) ? value.$schema : undefined,
        publicSchemaDialect(
          entry.schemaDialect,
          parent?.dialect ??
            (isOpenApi32(document) && record(document)
              ? publicSchemaDialect(document.jsonSchemaDialect)
              : JSON_SCHEMA_2020_12),
        ),
      );
      const ownId = record(value) && owns(value, '$id');
      if (ownId && typeof value.$id !== 'string')
        throw new SchemaEngineError('INVALID_DOCUMENT', 'Schema $id must be a URI reference.');
      const inheritedBase = entry.evaluationBaseUri;
      const resourceUri = ownId
        ? resolveUri(value.$id as string, inheritedBase)
        : (parent?.resourceUri ?? this.documentBaseUri);
      if (ownId && parseUri(resourceUri).fragment)
        throw new SchemaEngineError('INVALID_DOCUMENT', 'Schema $id must not contain a non-empty fragment.', {
          uri: resourceUri,
        });
      const resourcePointer = ownId ? entry.pointer : (parent?.resourcePointer ?? '#');
      const physicalResource = ownId
        ? physicalResourceUri(resourceUri)
        : (parent?.physicalResource ?? this.physicalRootUri);
      const node: OpenApi32SchemaLocation = {
        pointer: entry.pointer,
        value: value as JsonValue,
        dialect,
        baseUri: ownId ? toAbsoluteUri(resourceUri) : inheritedBase,
        resourceUri: toAbsoluteUri(resourceUri),
        resourcePointer,
        physicalResource,
        schemaRootPointer: parent?.schemaRootPointer ?? entry.pointer,
        relativePointer: entry.pointer.slice(resourcePointer.length),
      };
      if (ownId) {
        const previous = this.resourceAliases.get(node.resourceUri);
        if (previous !== undefined && previous !== entry.pointer && !(entry.pointer === '#' && previous === '#'))
          throw new SchemaEngineError('RESOURCE_URI_CONFLICT', `Duplicate Schema resource '${node.resourceUri}'.`, {
            resourceUri: node.resourceUri,
          });
        this.resourceAliases.set(node.resourceUri, entry.pointer);
        this.physicalResources.set(physicalResource, node.resourceUri);
        this.resourcePointers.set(physicalResource, entry.pointer);
      }
      this.locations.set(entry.pointer, node);
      if (record(value)) {
        if (owns(value, '$vocabulary'))
          throw new SchemaEngineError('UNSUPPORTED_DIALECT', 'Custom Schema vocabularies are not supported.', {
            uri: node.resourceUri,
          });
        for (const key of ['$anchor', '$dynamicAnchor'])
          if (owns(value, key)) {
            const anchor = value[key];
            if (typeof anchor !== 'string' || !ANCHOR.test(anchor))
              throw new SchemaEngineError('INVALID_DOCUMENT', `Invalid Schema ${key}.`, { uri: node.resourceUri });
            const uri = `${node.resourceUri}#${anchor}`;
            const previous = this.exactAliases.get(uri);
            if (previous && previous !== entry.pointer)
              throw new SchemaEngineError('RESOURCE_URI_CONFLICT', `Duplicate Schema anchor '${uri}'.`, { uri });
            this.exactAliases.set(uri, entry.pointer);
          }
        for (const keyword of ['$ref', '$dynamicRef'] as const)
          if (typeof value[keyword] === 'string') {
            this.references.push({ source: node, keyword, uri: resolveUri(value[keyword], node.baseUri) });
          }
      }
    }
    for (const alias of context?.aliases ?? []) {
      const uri = normalizePublicUri(alias.uri);
      if (parseUri(uri).fragment) this.exactAliases.set(uri, alias.pointer);
      else this.resourceAliases.set(toAbsoluteUri(uri), alias.pointer);
    }
  }

  lookup(uri: string, source?: OpenApi32SchemaLocation): OpenApi32SchemaLocation | undefined {
    const normalized = normalizePublicUri(uri);
    const exact = this.exactAliases.get(normalized);
    if (exact !== undefined) return this.locations.get(exact);
    const parsed = parseUri(normalized);
    const resource = toAbsoluteUri(normalized);
    let pointer = this.resourceAliases.get(resource);
    if (source?.physicalResource === this.physicalRootUri && resource === this.documentBaseUri) pointer ??= '#';
    if (pointer === undefined) return undefined;
    const fragment = decodeURIComponent(parsed.fragment ?? '');
    if (!fragment) return this.locations.get(pointer);
    if (fragment.startsWith('/')) return this.locations.get(`${pointer}${fragment}`);
    const anchor = this.exactAliases.get(`${resource}#${fragment}`);
    return anchor === undefined ? undefined : this.locations.get(anchor);
  }

  physicalReference(
    reference: OpenApi32Reference,
    isBuiltIn: (uri: string) => boolean,
    target?: OpenApi32SchemaLocation,
  ): string {
    const resource = toAbsoluteUri(reference.uri);
    if (isBuiltIn(resource)) return reference.uri;
    if (target) {
      const fragment = decodeURIComponent(parseUri(reference.uri).fragment ?? '');
      return reference.keyword === '$dynamicRef' &&
        fragment &&
        !fragment.startsWith('/') &&
        record(target.value) &&
        target.value.$dynamicAnchor === fragment
        ? `${target.physicalResource}#${physicalAnchor(fragment)}`
        : this.physicalLocation(target);
    }
    const scoped = reference.source.physicalResource === this.physicalRootUri && resource === this.documentBaseUri;
    const base = scoped ? this.physicalRootUri : physicalResourceUri(resource);
    const fragment = decodeURIComponent(parseUri(reference.uri).fragment ?? '');
    return `${base}${!fragment ? '' : `#${fragment.startsWith('/') ? physicalPointer(fragment) : physicalAnchor(fragment)}`}`;
  }

  prepare(value: unknown, unmask: (value: Record<string, unknown>) => void, isBuiltIn: (uri: string) => boolean): void {
    for (const node of this.locations.values()) {
      const schema = schemaValueAt(value, node.pointer);
      if (!record(schema)) continue;
      unmask(schema);
      schema.$schema = processingSchemaDialect(node.dialect);
      if (owns(schema, '$id')) schema.$id = node.physicalResource;
      for (const keyword of ['$anchor', '$dynamicAnchor'])
        if (typeof schema[keyword] === 'string') schema[keyword] = physicalAnchor(schema[keyword]);
    }
    for (const reference of this.references) {
      const schema = schemaValueAt(value, reference.source.pointer) as Record<string, unknown>;
      schema[reference.keyword] = this.physicalReference(reference, isBuiltIn);
    }
    this.metaRoots.push(...this.roots.map((pointer) => structuredClone(schemaValueAt(value, pointer)) as JsonValue));
    if (record(value)) {
      value.$id = this.locations.get('#')?.physicalResource ?? this.physicalRootUri;
      // Complete OAS documents and OAS fragments are containers, not Schema Objects.
      if (!this.locations.has('#')) delete value.$schema;
    }
  }

  decorate(document: SchemaDocument): void {
    const resources = document.embedded ?? { [document.baseUri]: document };
    for (const node of this.locations.values()) {
      const resource = resources[node.physicalResource] as SchemaDocument | undefined;
      if (resource) resource.anchors[physicalPointer(node.relativePointer)] = node.relativePointer;
    }
  }

  physicalLocation(node: OpenApi32SchemaLocation): string {
    return `${node.physicalResource}#${physicalPointer(node.relativePointer)}`;
  }

  publicNode(node: OpenApi32SchemaLocation, requestedUri: string): SchemaNode {
    const canonicalResource = this.resourceAliases.has(node.resourceUri) ? node.resourceUri : this.retrievalUri;
    return {
      requestedUri,
      canonicalUri: `${canonicalResource}#${encodedPointer(node.relativePointer)}`,
      resourceUri: node.resourceUri,
      dialectId: node.dialect,
      schema: structuredClone(node.value),
      anchors: Object.freeze(
        Object.fromEntries(
          [...this.exactAliases]
            .filter(([uri]) => toAbsoluteUri(uri) === node.resourceUri)
            .map(([uri, pointer]) => [
              decodeURIComponent(parseUri(uri).fragment ?? ''),
              pointer.slice(node.resourcePointer.length),
            ]),
        ),
      ),
      dynamicAnchors: Object.freeze(
        Object.fromEntries(
          [...this.locations.values()]
            .filter(
              (entry) =>
                entry.resourceUri === node.resourceUri &&
                record(entry.value) &&
                typeof entry.value.$dynamicAnchor === 'string',
            )
            .map((entry) => [
              (entry.value as Record<string, string>).$dynamicAnchor,
              `${canonicalResource}#${encodedPointer(entry.relativePointer)}`,
            ]),
        ),
      ),
    };
  }

  publicLocation(uri: string): string {
    const hash = uri.indexOf('#');
    const base = hash < 0 ? uri : uri.slice(0, hash);
    const publicBase = this.physicalResources.get(base);
    return publicBase ? `${publicBase}${hash < 0 ? '' : uri.slice(hash)}` : uri;
  }
}

/** Explicitly typed generated Schema documents (e.g. a directional projection). */
export function openApi32SchemaRegistrationContext(
  document: unknown,
  retrievalUri: string,
): SchemaDocumentRegistrationContext {
  const prefix = '#/components/schemas/root';
  const wrapper = {
    openapi: '3.2.0',
    jsonSchemaDialect: record(document)
      ? publicSchemaDialect(document.$schema, JSON_SCHEMA_2020_12)
      : JSON_SCHEMA_2020_12,
    components: { schemas: { root: document } },
  };
  return {
    openapi32: true,
    schemaLocations: collectOpenApi32SchemaLocations(wrapper, retrievalUri).map((location) => ({
      ...location,
      pointer: `#${location.pointer.slice(prefix.length)}`,
    })),
  };
}

export interface OpenApi32ProjectionSource {
  readonly document: JsonValue;
  readonly retrievalUri: string;
  referenceFor(reference: string): string;
}

/**
 * Build an analysis-only Schema bundle from typed roots. Public identities are
 * first resolved in their original graph; direction projection then works on
 * collision-free resource names without interpreting opaque document payloads.
 * This helper is called only after the engine's lazy import, never by the UI bundle.
 */
export function createOpenApi32ProjectionSource(
  documents: readonly {
    readonly document: unknown;
    readonly retrievalUri: string;
    readonly context?: SchemaDocumentRegistrationContext;
  }[],
  entryRetrievalUri: string,
): OpenApi32ProjectionSource {
  const contexts = documents.map(
    (entry) => new OpenApi32Registration(entry.document, entry.retrievalUri, entry.context),
  );
  const locations = new Map<OpenApi32SchemaLocation, { resource: string; pointer: string }>();
  const clones = new Map<OpenApi32SchemaLocation, Record<string, unknown>>();
  const schemas: Record<string, JsonValue> = Object.create(null);
  const referenceForNode = (node: OpenApi32SchemaLocation): string => {
    const location = locations.get(node)!;
    return `${location.resource}${location.pointer ? `#${encodedPointer(location.pointer)}` : ''}`;
  };
  for (const [index, context] of contexts.entries()) {
    const groups = new Map<string, OpenApi32SchemaLocation[]>();
    for (const node of context.locations.values()) {
      const group = groups.get(node.schemaRootPointer) ?? [];
      group.push(node);
      groups.set(node.schemaRootPointer, group);
    }
    const roots = [...groups.keys()].map((pointer) => context.locations.get(pointer)!);
    const directRoot = context.locations.get('#');
    const container: Record<string, JsonValue> = {
      $id: context.physicalRootUri,
      $schema: JSON_SCHEMA_2020_12,
      $defs: {},
    };
    for (const [rootIndex, root] of roots.entries()) {
      const clone = structuredClone(root.value);
      const direct = root === directRoot && record(clone);
      const prefix = direct ? '' : `/$defs/root${rootIndex}`;
      if (direct) schemas[`document${index}`] = clone;
      else (container.$defs as Record<string, JsonValue>)[`root${rootIndex}`] = clone;
      for (const node of groups.get(root.pointer)!) {
        const pointer =
          node.resourcePointer === '#' ? `${prefix}${node.pointer.slice(root.pointer.length)}` : node.relativePointer;
        locations.set(node, { resource: node.physicalResource, pointer });
        const value = schemaValueAt(clone, `#${node.pointer.slice(root.pointer.length)}`);
        if (!record(value)) continue;
        clones.set(node, value);
        value.$schema = node.dialect;
        if (owns(value, '$id') || (direct && node === root)) value.$id = node.physicalResource;
        for (const keyword of ['$anchor', '$dynamicAnchor'])
          if (typeof value[keyword] === 'string') value[keyword] = physicalAnchor(value[keyword]);
      }
    }
    if (!directRoot || !record(directRoot.value)) schemas[`document${index}`] = container;
  }
  const lookup = (
    uri: string,
    source?: OpenApi32Registration,
    node?: OpenApi32SchemaLocation,
  ): OpenApi32SchemaLocation | undefined =>
    source?.lookup(uri, node) ?? contexts.map((context) => context.lookup(uri)).find((value) => value !== undefined);
  for (const context of contexts)
    for (const reference of context.references) {
      const target = lookup(reference.uri, context, reference.source);
      const fragment = decodeURIComponent(parseUri(reference.uri).fragment ?? '');
      const dynamic =
        reference.keyword === '$dynamicRef' &&
        fragment &&
        !fragment.startsWith('/') &&
        target &&
        record(target.value) &&
        target.value.$dynamicAnchor === fragment;
      clones.get(reference.source)![reference.keyword] = target
        ? dynamic
          ? `${locations.get(target)!.resource}#${physicalAnchor(fragment)}`
          : referenceForNode(target)
        : context.physicalReference(reference, () => false);
    }
  return {
    document: {
      openapi: '3.2.0',
      info: { title: 'Directional Schema source', version: '1' },
      jsonSchemaDialect: JSON_SCHEMA_2020_12,
      components: { schemas },
    },
    retrievalUri: 'urn:knife4j-internal:oas32:projection-source',
    referenceFor: (reference: string): string => {
      const uri = resolveUri(reference, entryRetrievalUri);
      const target = lookup(uri);
      if (!target)
        throw new SchemaEngineError('RESOURCE_NOT_REGISTERED', `Schema '${uri}' is not registered.`, { uri });
      return referenceForNode(target);
    },
  };
}
