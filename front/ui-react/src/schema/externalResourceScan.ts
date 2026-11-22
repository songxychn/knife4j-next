import {
  getOpenApiSpecificationFeatures,
  getOpenApiStandardHttpMethods,
  isRecord,
  hasOwn as owns,
  decodeJsonPointerToken,
  encodeJsonPointerToken as pointerToken,
} from 'knife4j-core';
import { sha256Hex } from '../utils/stableJson';
import { isRetryableResourceError, ResourceLoadError } from './externalResourcePolicy';
import {
  ANCHOR_NAME,
  fragmentOf,
  identityAliases,
  normalizedAnchorUri,
  pointerWithinResource,
  referenceRetrievalUri,
  resolveGraphUri,
  resolveJsonPointer,
  safeRawReferenceDisplay,
  safeResourceDisplay,
  uriWithoutFragment,
} from './externalResourceIdentity';
import type {
  ResourceReferenceKind,
  ResourceDiagnosticPhase,
  ResourceGraphNode,
  ResourceGraphEdge,
  ResourceDiagnostic,
  ExpectedTargetKind,
} from './externalResourceGraphTypes';

type JsonRecord = Record<string, unknown>;

export interface MutableEdge {
  readonly sourceRetrievalUri: string;
  readonly sourcePointer: string;
  readonly kind: ResourceReferenceKind;
  readonly resolvedUri: string;
  targetRetrievalUri: string;
  readonly fragment: string;
  readonly rawReference: string;
  readonly rawReferenceDisplay: string;
  readonly resolutionBase: string;
  readonly depth: number;
  readonly expectedTarget: ExpectedTargetKind;
  expanded: boolean;
  /** A strict target failure must not be promoted to loaded by refreshGraph. */
  invalidTarget?: boolean;
  state: ResourceGraphEdge['state'];
}

export interface ResourceTarget {
  readonly ownerRetrievalUri: string;
  readonly value: unknown;
  readonly pointer: string;
  readonly evaluationBaseUri: string;
}

export interface DocumentContext {
  readonly retrievalUri: string;
  readonly document: unknown;
  readonly kind: ResourceGraphNode['documentKind'];
  readonly family: '3.1' | '3.2';
  readonly openApiVersion?: string;
  readonly selfUri?: string;
  readonly baseUri: string;
  /** A Schema fragment supplied the only root-type hint; later explicit roots may replace it. */
  readonly provisionalSchema?: boolean;
}

export interface ObjectTarget {
  readonly operationPathItem?: { readonly value: JsonRecord; readonly pointer: string };
  readonly schemaDialect?: string;
  readonly kind: ExpectedTargetKind | 'openapi';
  readonly evaluationBaseUri: string;
}

export interface ScanCollector {
  readonly sourceRetrievalUri: string;
  readonly context: DocumentContext;
  readonly entry: DocumentContext;
  readonly objects: Map<string, ObjectTarget>;
  readonly documents: Map<string, ResourceTarget>;
  readonly resources: Map<string, ResourceTarget>;
  readonly anchors: Map<string, ResourceTarget>;
  readonly edges: MutableEdge[];
  readonly diagnostics: ResourceDiagnostic[];
}

export const PORTABLE_SCHEMA_RESOURCES_EXTENSION = 'x-knife4j-schema-resources';
export const PORTABLE_SCHEMA_RESOURCES_VERSION = 1;

export const OAS_31_VERSION = /^3\.1\.\d+(?:[-+].*)?$/;
const KNIFE4J_SCHEMA_RESOURCES_FIELD = /^x-knife4j-schema-resources(?:-(?:[2-9]|[1-9]\d+))?$/;
const KNIFE4J_OPERATION_TARGETS_FIELD = /^x-knife4j-operation-ref-targets(?:-(?:[2-9]|[1-9]\d+))?$/;
const OPERATION_TARGET_NAME = /^target-[1-9]\d*$/;
const PATH_ITEM_CONTEXT_FIELDS = new Set(['summary', 'description', 'servers', 'parameters']);
const SUPPORTED_SCHEMA_DIALECT =
  /^(?:https:\/\/spec\.openapis\.org\/oas\/3\.1\/dialect\/base|https:\/\/json-schema\.org\/draft\/2020-12\/schema)#?$/;
const SUPPORTED_SCHEMA_DIALECT_32 = /^(?:https:\/\/spec\.openapis\.org\/oas\/3\.2\/dialect\/2025-09-17)#?$/;
const supportedSchemaDialect = (dialect: string, family: DocumentContext['family']): boolean =>
  SUPPORTED_SCHEMA_DIALECT.test(dialect) || (family === '3.2' && SUPPORTED_SCHEMA_DIALECT_32.test(dialect));
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const METHOD_TOKEN = /^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/;
const OAS_32_METHODS = getOpenApiStandardHttpMethods('3.2.0')!;
const RESERVED_METHODS = new Set(OAS_32_METHODS.map((method) => method.toUpperCase()));
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
] as const;
const SCHEMA_ARRAY_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;
const SCHEMA_MAP_KEYWORDS = ['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions'] as const;
const COMPONENT_NAME = /^[A-Za-z0-9._-]+$/;

export const childPointer = (pointer: string, key: string | number): string =>
  `${pointer}/${pointerToken(String(key))}`;

export function genericDiagnostic(
  error: ResourceLoadError,
  phase: ResourceDiagnosticPhase,
  generation: number,
  sourceRetrievalUri: string,
  edge?: MutableEdge,
): ResourceDiagnostic {
  const target =
    edge?.targetRetrievalUri || (typeof error.details.retrievalUri === 'string' ? error.details.retrievalUri : '');
  const limit = typeof error.details.limit === 'number' ? error.details.limit : undefined;
  const actual = typeof error.details.actual === 'number' ? error.details.actual : undefined;
  return Object.freeze({
    code: error.code,
    phase,
    sourceRetrievalUriHash: sha256Hex(sourceRetrievalUri),
    sourcePointer: edge?.sourcePointer ?? '#',
    referenceKind: edge?.kind ?? 'reference-object',
    rawReferenceDisplay: edge?.rawReferenceDisplay ?? '',
    resolutionBaseDisplay: safeResourceDisplay(edge?.resolutionBase ?? sourceRetrievalUri),
    ...(target ? { targetRetrievalUriHash: sha256Hex(target), resourceDisplay: safeResourceDisplay(target) } : {}),
    ...(limit === undefined ? {} : { limit }),
    ...(actual === undefined ? {} : { actual }),
    generation,
    retryable: isRetryableResourceError(error),
  });
}

export function objectKey(ownerRetrievalUri: string, pointer: string): string {
  return `${ownerRetrievalUri}\n${pointer}`;
}

function indexObject(
  collector: ScanCollector,
  pointer: string,
  kind: ObjectTarget['kind'],
  evaluationBaseUri: string,
  schemaDialect?: string,
  operationPathItem?: ObjectTarget['operationPathItem'],
): void {
  if (collector.context.family !== '3.2') return;
  const key = objectKey(collector.sourceRetrievalUri, pointer);
  const existing = collector.objects.get(key);
  if (existing && existing.kind !== kind) {
    throw new ResourceLoadError(
      'DOCUMENT_KIND_MISMATCH',
      'A reference conflicts with the indexed OpenAPI object type.',
    );
  }
  collector.objects.set(key, { kind, evaluationBaseUri, schemaDialect, operationPathItem });
}

export function documentContext(
  retrievalUri: string,
  document: unknown,
  kind: ResourceGraphNode['documentKind'],
  family: DocumentContext['family'],
  rootTarget?: ExpectedTargetKind,
): DocumentContext {
  const openApiVersion = kind === 'openapi' && isRecord(document) ? String(document.openapi) : undefined;
  let selfUri: string | undefined;
  if (family === '3.2' && kind === 'openapi' && isRecord(document) && owns(document, '$self')) {
    if (typeof document.$self !== 'string') {
      throw new ResourceLoadError('RESOURCE_URI_INVALID', 'OpenAPI $self must be a URI reference.');
    }
    try {
      selfUri = resolveGraphUri(document.$self, retrievalUri, family);
    } catch (error) {
      throw new ResourceLoadError(
        'RESOURCE_URI_INVALID',
        'OpenAPI $self must be a resolvable URI reference.',
        {},
        error,
      );
    }
  }
  return Object.freeze({
    retrievalUri,
    document,
    kind,
    family,
    openApiVersion,
    selfUri,
    baseUri: uriWithoutFragment(selfUri ?? retrievalUri, family),
    provisionalSchema:
      family === '3.2' && kind === 'json-schema' && rootTarget === undefined && !declaresSchemaRoot(document),
  });
}

export function indexDocument(collector: ScanCollector): void {
  const { context } = collector;
  addResourceTarget(collector, context.retrievalUri, context.document, '#', context.baseUri);
  if (context.family !== '3.2') return;
  // Physical cache/grant keys keep their original spelling alongside logical aliases.
  collector.resources.set(context.retrievalUri, {
    ownerRetrievalUri: context.retrievalUri,
    value: context.document,
    pointer: '#',
    evaluationBaseUri: context.baseUri,
  });
  if (context.kind === 'openapi') indexObject(collector, '#', 'openapi', context.baseUri);
  if (context.selfUri !== undefined) {
    const fragment = fragmentOf(context.selfUri, context.family);
    const identity = fragment ? context.selfUri : uriWithoutFragment(context.selfUri, context.family);
    for (const alias of identityAliases(identity, context.family))
      collector.documents.set(alias, {
        ownerRetrievalUri: context.retrievalUri,
        value: context.document,
        pointer: '#',
        evaluationBaseUri: context.baseUri,
      });
    // A fragment-bearing $self is a full identity, not ownership of its entire base URI.
    if (!fragment) addResourceTarget(collector, identity, context.document, '#', context.baseUri);
  }
}

function addResourceTarget(
  collector: ScanCollector,
  uri: string,
  value: unknown,
  pointer: string,
  evaluationBaseUri = uri,
): void {
  for (const identity of identityAliases(uriWithoutFragment(uri, collector.context.family), collector.context.family)) {
    const existing = collector.resources.get(identity);
    if (existing && existing.pointer !== pointer) {
      throw new ResourceLoadError('RESOURCE_URI_CONFLICT', 'A Schema resource URI is declared more than once.', {
        retrievalUri: identity,
      });
    }
    collector.resources.set(identity, {
      ownerRetrievalUri: collector.sourceRetrievalUri,
      value,
      pointer,
      evaluationBaseUri,
    });
  }
}

function addAnchorTarget(
  collector: ScanCollector,
  uri: string,
  value: unknown,
  pointer: string,
  evaluationBaseUri: string,
): void {
  for (const identity of identityAliases(uri, collector.context.family)) {
    const existing = collector.anchors.get(identity);
    if (existing && existing.pointer !== pointer) {
      throw new ResourceLoadError('RESOURCE_URI_CONFLICT', 'A Schema anchor URI is declared more than once.', {
        retrievalUri: identity,
      });
    }
    collector.anchors.set(identity, {
      ownerRetrievalUri: collector.sourceRetrievalUri,
      value,
      pointer,
      evaluationBaseUri,
    });
  }
}

export function edgeIdentity(
  edge: Pick<MutableEdge, 'sourceRetrievalUri' | 'sourcePointer' | 'kind' | 'resolvedUri' | 'expectedTarget'>,
): string {
  return `${edge.sourceRetrievalUri}\n${edge.sourcePointer}\n${edge.kind}\n${edge.resolvedUri}\n${edge.expectedTarget}`;
}

function addReference(
  collector: ScanCollector,
  rawReference: string,
  baseUri: string,
  sourcePointer: string,
  kind: ResourceReferenceKind,
  expectedTarget: ExpectedTargetKind,
  depth: number,
  generation: number,
  targetUri?: string,
): void {
  let resolvedUri: string;
  let targetRetrievalUri: string;
  try {
    resolvedUri = resolveGraphUri(targetUri ?? rawReference, baseUri, collector.context.family);
    targetRetrievalUri = referenceRetrievalUri(
      targetUri ?? rawReference,
      baseUri,
      resolvedUri,
      collector.context.family,
    );
  } catch (error) {
    const failed: MutableEdge = {
      sourceRetrievalUri: collector.sourceRetrievalUri,
      sourcePointer,
      kind,
      resolvedUri: '',
      targetRetrievalUri: '',
      fragment: '',
      state: 'failed',
      rawReference,
      rawReferenceDisplay: safeRawReferenceDisplay(rawReference),
      resolutionBase: baseUri,
      depth,
      expectedTarget,
      expanded: true,
      invalidTarget: true,
    };
    collector.diagnostics.push(
      genericDiagnostic(
        new ResourceLoadError('RESOURCE_URI_INVALID', 'A resource reference cannot be resolved.', {}, error),
        'discover',
        generation,
        collector.sourceRetrievalUri,
        failed,
      ),
    );
    if (
      collector.context.family === '3.2' &&
      !collector.edges.some((edge) => edgeIdentity(edge) === edgeIdentity(failed))
    )
      collector.edges.push(failed);
    return;
  }

  const edge: MutableEdge = {
    sourceRetrievalUri: collector.sourceRetrievalUri,
    sourcePointer,
    kind,
    resolvedUri,
    targetRetrievalUri,
    fragment: fragmentOf(resolvedUri, collector.context.family),
    state: 'pending',
    rawReference,
    rawReferenceDisplay: safeRawReferenceDisplay(rawReference),
    resolutionBase: baseUri,
    depth,
    expectedTarget,
    expanded: false,
  };
  if (!collector.edges.some((existing) => edgeIdentity(existing) === edgeIdentity(edge))) collector.edges.push(edge);
}

export function walkSchema(
  value: unknown,
  pointer: string,
  inheritedBase: string,
  collector: ScanCollector,
  emitReferences: boolean,
  depth: number,
  generation: number,
  inheritedDialect?: string,
): void {
  indexObject(collector, pointer, 'schema', inheritedBase);
  if (typeof value !== 'boolean' && !isRecord(value)) return;
  if (
    isRecord(value) &&
    typeof value.$schema === 'string' &&
    !supportedSchemaDialect(value.$schema, collector.context.family)
  ) {
    throw new ResourceLoadError(
      'DIALECT_UNSUPPORTED',
      'The Schema declares a dialect outside the supported OAS 3.1 base and Draft 2020-12 dialects.',
    );
  }
  const dialect =
    isRecord(value) && typeof value.$schema === 'string'
      ? value.$schema
      : (inheritedDialect ??
        (isRecord(collector.context.document) && typeof collector.context.document.jsonSchemaDialect === 'string'
          ? collector.context.document.jsonSchemaDialect
          : collector.context.kind === 'json-schema'
            ? 'https://json-schema.org/draft/2020-12/schema'
            : 'https://spec.openapis.org/oas/3.1/dialect/base'));
  indexObject(collector, pointer, 'schema', inheritedBase, dialect);
  if (!isRecord(value)) return;
  const evaluationBaseUri = inheritedBase;
  let baseUri = inheritedBase;
  if (typeof value.$id === 'string') {
    try {
      const identifier = resolveGraphUri(value.$id, inheritedBase, collector.context.family);
      if (fragmentOf(identifier, collector.context.family)) {
        throw new ResourceLoadError('RESOURCE_URI_INVALID', 'Schema $id values must not contain a non-empty fragment.');
      }
      baseUri = identifier;
      addResourceTarget(collector, baseUri, value, pointer, evaluationBaseUri);
    } catch (error) {
      if (error instanceof ResourceLoadError) throw error;
      throw new ResourceLoadError('RESOURCE_URI_INVALID', 'Schema $id cannot be resolved.', {}, error);
    }
  }
  for (const keyword of ['$anchor', '$dynamicAnchor'] as const) {
    const anchor = value[keyword];
    if (typeof anchor !== 'string') continue;
    if (!ANCHOR_NAME.test(anchor)) {
      throw new ResourceLoadError('RESOURCE_URI_INVALID', `Schema ${keyword} is invalid.`);
    }
    addAnchorTarget(
      collector,
      `${uriWithoutFragment(baseUri, collector.context.family)}#${anchor}`,
      value,
      pointer,
      evaluationBaseUri,
    );
  }

  if (emitReferences && typeof value.$ref === 'string') {
    addReference(
      collector,
      value.$ref,
      baseUri,
      childPointer(pointer, '$ref'),
      'schema-ref',
      'schema',
      depth + 1,
      generation,
    );
  }
  if (emitReferences && typeof value.$dynamicRef === 'string') {
    addReference(
      collector,
      value.$dynamicRef,
      baseUri,
      childPointer(pointer, '$dynamicRef'),
      'schema-dynamic-ref',
      'schema',
      depth + 1,
      generation,
    );
  }
  const mapping =
    isRecord(value.discriminator) && isRecord(value.discriminator.mapping) ? value.discriminator.mapping : null;
  if (collector.context.family === '3.2') {
    // Project OAS application semantics connect discriminator names/URIs at real Schema positions.
    // These connections do not change validation under the Schema's selected dialect.
    if (emitReferences && isRecord(value.discriminator)) {
      const addMapping = (target: unknown, targetPointer: string): void => {
        if (typeof target !== 'string') return;
        addReference(
          collector,
          target,
          collector.context.baseUri,
          targetPointer,
          'discriminator-mapping',
          'schema',
          depth + 1,
          generation,
          COMPONENT_NAME.test(target) ? componentTargetUri(collector, 'schemas', target) : undefined,
        );
      };
      if (mapping)
        Object.entries(mapping).forEach(([name, target]) =>
          addMapping(target, childPointer(childPointer(childPointer(pointer, 'discriminator'), 'mapping'), name)),
        );
      addMapping(
        value.discriminator.defaultMapping,
        childPointer(childPointer(pointer, 'discriminator'), 'defaultMapping'),
      );
    }
  } else if (emitReferences && mapping) {
    Object.entries(mapping).forEach(([name, target]) => {
      if (typeof target !== 'string') return;
      // Preserve the existing 3.1 shorthand and document-relative mapping behavior.
      if (COMPONENT_NAME.test(target)) return;
      addReference(
        collector,
        target,
        collector.sourceRetrievalUri,
        childPointer(childPointer(childPointer(pointer, 'discriminator'), 'mapping'), name),
        'discriminator-mapping',
        'schema',
        depth + 1,
        generation,
      );
    });
  }

  SCHEMA_SINGLE_KEYWORDS.forEach((keyword) => {
    if (owns(value, keyword)) {
      walkSchema(
        value[keyword],
        childPointer(pointer, keyword),
        baseUri,
        collector,
        emitReferences,
        depth,
        generation,
        dialect,
      );
    }
  });
  SCHEMA_ARRAY_KEYWORDS.forEach((keyword) => {
    const schemas = value[keyword];
    if (!Array.isArray(schemas)) return;
    schemas.forEach((schema, index) =>
      walkSchema(
        schema,
        childPointer(childPointer(pointer, keyword), index),
        baseUri,
        collector,
        emitReferences,
        depth,
        generation,
        dialect,
      ),
    );
  });
  if (Array.isArray(value.items)) {
    value.items.forEach((schema, index) =>
      walkSchema(
        schema,
        childPointer(childPointer(pointer, 'items'), index),
        baseUri,
        collector,
        emitReferences,
        depth,
        generation,
        dialect,
      ),
    );
  } else if (owns(value, 'items')) {
    walkSchema(
      value.items,
      childPointer(pointer, 'items'),
      baseUri,
      collector,
      emitReferences,
      depth,
      generation,
      dialect,
    );
  }
  SCHEMA_MAP_KEYWORDS.forEach((keyword) => {
    const schemas = value[keyword];
    if (!isRecord(schemas)) return;
    Object.entries(schemas).forEach(([name, schema]) =>
      walkSchema(
        schema,
        childPointer(childPointer(pointer, keyword), name),
        baseUri,
        collector,
        emitReferences,
        depth,
        generation,
        dialect,
      ),
    );
  });
}

function walkReferenceOr(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emitReferences: boolean,
  depth: number,
  generation: number,
  expectedTarget: ExpectedTargetKind,
  walkValue: (value: unknown, pointer: string, emit: boolean) => void,
  kind: ResourceReferenceKind = 'reference-object',
): void {
  indexObject(collector, pointer, expectedTarget, baseUri);
  if (!isRecord(value)) return;
  if (
    collector.context.family === '3.2' &&
    !emitReferences &&
    typeof value.$ref === 'string' &&
    kind === 'reference-object'
  )
    return;
  if (emitReferences && typeof value.$ref === 'string') {
    addReference(
      collector,
      value.$ref,
      baseUri,
      childPointer(pointer, '$ref'),
      kind,
      expectedTarget,
      depth + 1,
      generation,
    );
    if (kind === 'reference-object') return;
  }
  walkValue(value, pointer, emitReferences);
}

function walkMediaType(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  if (collector.context.family === '3.2') {
    walkReferenceOr(
      value,
      pointer,
      baseUri,
      collector,
      emit,
      depth,
      generation,
      'media-type',
      (media, mediaPointer, nestedEmit) => {
        if (!isRecord(media)) return;
        for (const keyword of ['schema', 'itemSchema']) {
          if (owns(media, keyword))
            walkSchema(
              media[keyword],
              childPointer(mediaPointer, keyword),
              baseUri,
              collector,
              nestedEmit,
              depth,
              generation,
            );
        }
        walkExamples(
          media.examples,
          childPointer(mediaPointer, 'examples'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
        walkEncodings(media, mediaPointer, baseUri, collector, nestedEmit, depth, generation);
      },
    );
    return;
  }
  if (!isRecord(value)) return;
  if (owns(value, 'schema'))
    walkSchema(value.schema, childPointer(pointer, 'schema'), baseUri, collector, emit, depth, generation);
  walkExamples(value.examples, childPointer(pointer, 'examples'), baseUri, collector, emit, depth, generation);
  if (!isRecord(value.encoding)) return;
  Object.entries(value.encoding).forEach(([name, encoding]) => {
    if (!isRecord(encoding) || !isRecord(encoding.headers)) return;
    Object.entries(encoding.headers).forEach(([headerName, header]) =>
      walkHeader(
        header,
        childPointer(childPointer(childPointer(childPointer(pointer, 'encoding'), name), 'headers'), headerName),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      ),
    );
  });
}

function walkEncodings(
  value: JsonRecord,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  const walkEncoding = (encoding: unknown, encodingPointer: string): void => {
    if (!isRecord(encoding)) return;
    if (isRecord(encoding.headers)) {
      Object.entries(encoding.headers).forEach(([name, header]) => {
        // Content-Type is explicitly ignored by the Encoding Object contract.
        if (name.toLowerCase() !== 'content-type')
          walkHeader(
            header,
            childPointer(childPointer(encodingPointer, 'headers'), name),
            baseUri,
            collector,
            emit,
            depth,
            generation,
          );
      });
    }
    walkEncodings(encoding, encodingPointer, baseUri, collector, emit, depth, generation);
  };
  if (isRecord(value.encoding))
    Object.entries(value.encoding).forEach(([name, encoding]) =>
      walkEncoding(encoding, childPointer(childPointer(pointer, 'encoding'), name)),
    );
  if (Array.isArray(value.prefixEncoding))
    value.prefixEncoding.forEach((encoding, index) =>
      walkEncoding(encoding, childPointer(childPointer(pointer, 'prefixEncoding'), index)),
    );
  if (owns(value, 'itemEncoding')) walkEncoding(value.itemEncoding, childPointer(pointer, 'itemEncoding'));
}

function componentTargetUri(collector: ScanCollector, kind: 'schemas' | 'securitySchemes', name: string): string {
  // Entry retrieval is already registered and remains unambiguous even when $self has a fragment.
  return `${collector.entry.retrievalUri}#/components/${kind}/${pointerToken(name)}`;
}

function walkSecurityRequirements(
  value: unknown,
  pointer: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  if (!emit || collector.context.family !== '3.2' || !Array.isArray(value)) return;
  const entry = collector.entry.document;
  const schemes =
    isRecord(entry) && isRecord(entry.components) && isRecord(entry.components.securitySchemes)
      ? entry.components.securitySchemes
      : undefined;
  value.forEach((requirement, index) => {
    if (!isRecord(requirement)) return;
    Object.keys(requirement).forEach((name) =>
      addReference(
        collector,
        name,
        collector.context.baseUri,
        childPointer(childPointer(pointer, index), name),
        'security-requirement',
        'security-scheme',
        depth + 1,
        generation,
        schemes && owns(schemes, name) ? componentTargetUri(collector, 'securitySchemes', name) : undefined,
      ),
    );
  });
}

function walkContent(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([mediaType, media]) =>
    walkMediaType(media, childPointer(pointer, mediaType), baseUri, collector, emit, depth, generation),
  );
}

function walkParameter(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'parameter',
    (parameter, parameterPointer, nestedEmit) => {
      if (!isRecord(parameter)) return;
      if (owns(parameter, 'schema')) {
        walkSchema(
          parameter.schema,
          childPointer(parameterPointer, 'schema'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
      if (owns(parameter, 'content')) {
        walkContent(
          parameter.content,
          childPointer(parameterPointer, 'content'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
      walkExamples(
        parameter.examples,
        childPointer(parameterPointer, 'examples'),
        baseUri,
        collector,
        nestedEmit,
        depth,
        generation,
      );
    },
  );
}

function walkHeader(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'header',
    (header, headerPointer, nestedEmit) => {
      if (!isRecord(header)) return;
      if (owns(header, 'schema')) {
        walkSchema(
          header.schema,
          childPointer(headerPointer, 'schema'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
      if (owns(header, 'content')) {
        walkContent(
          header.content,
          childPointer(headerPointer, 'content'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
      walkExamples(
        header.examples,
        childPointer(headerPointer, 'examples'),
        baseUri,
        collector,
        nestedEmit,
        depth,
        generation,
      );
    },
  );
}

function walkRequestBody(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'request-body',
    (body, bodyPointer, nestedEmit) => {
      if (isRecord(body) && owns(body, 'content')) {
        walkContent(
          body.content,
          childPointer(bodyPointer, 'content'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
    },
  );
}

function walkLink(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'link',
    (link, linkPointer, nestedEmit) => {
      if (nestedEmit && isRecord(link) && typeof link.operationRef === 'string') {
        addReference(
          collector,
          link.operationRef,
          baseUri,
          childPointer(linkPointer, 'operationRef'),
          'link-operation-ref',
          'operation',
          depth + 1,
          generation,
        );
      }
    },
  );
}

function walkResponse(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'response',
    (response, responsePointer, nestedEmit) => {
      if (!isRecord(response)) return;
      if (isRecord(response.headers)) {
        Object.entries(response.headers).forEach(([name, header]) =>
          walkHeader(
            header,
            childPointer(childPointer(responsePointer, 'headers'), name),
            baseUri,
            collector,
            nestedEmit,
            depth,
            generation,
          ),
        );
      }
      if (owns(response, 'content')) {
        walkContent(
          response.content,
          childPointer(responsePointer, 'content'),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      }
      if (isRecord(response.links)) {
        Object.entries(response.links).forEach(([name, link]) =>
          walkLink(
            link,
            childPointer(childPointer(responsePointer, 'links'), name),
            baseUri,
            collector,
            nestedEmit,
            depth,
            generation,
          ),
        );
      }
    },
  );
}

function walkCallback(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'callback',
    (callback, callbackPointer, nestedEmit) => {
      if (!isRecord(callback)) return;
      Object.entries(callback).forEach(([expression, pathItem]) => {
        if (
          expression.startsWith('x-') ||
          expression === '$ref' ||
          expression === 'summary' ||
          expression === 'description'
        )
          return;
        walkPathItem(
          pathItem,
          childPointer(callbackPointer, expression),
          baseUri,
          collector,
          nestedEmit,
          depth,
          generation,
        );
      });
    },
  );
}

function walkOperation(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
  operationPathItem?: ObjectTarget['operationPathItem'],
): void {
  indexObject(collector, pointer, 'operation', baseUri, undefined, operationPathItem);
  if (!isRecord(value)) return;
  walkSecurityRequirements(value.security, childPointer(pointer, 'security'), collector, emit, depth, generation);
  if (Array.isArray(value.parameters)) {
    value.parameters.forEach((parameter, index) =>
      walkParameter(
        parameter,
        childPointer(childPointer(pointer, 'parameters'), index),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      ),
    );
  }
  if (owns(value, 'requestBody')) {
    walkRequestBody(
      value.requestBody,
      childPointer(pointer, 'requestBody'),
      baseUri,
      collector,
      emit,
      depth,
      generation,
    );
  }
  if (isRecord(value.responses)) {
    Object.entries(value.responses).forEach(([status, response]) => {
      if (!RESPONSE_KEY.test(status)) return;
      walkResponse(
        response,
        childPointer(childPointer(pointer, 'responses'), status),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      );
    });
  }
  if (isRecord(value.callbacks)) {
    Object.entries(value.callbacks).forEach(([name, callback]) =>
      walkCallback(
        callback,
        childPointer(childPointer(pointer, 'callbacks'), name),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      ),
    );
  }
}

function walkPathItem(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(
    value,
    pointer,
    baseUri,
    collector,
    emit,
    depth,
    generation,
    'path-item',
    (pathItem, pathPointer, nestedEmit) => {
      if (!isRecord(pathItem)) return;
      if (Array.isArray(pathItem.parameters)) {
        pathItem.parameters.forEach((parameter, index) =>
          walkParameter(
            parameter,
            childPointer(childPointer(pathPointer, 'parameters'), index),
            baseUri,
            collector,
            nestedEmit,
            depth,
            generation,
          ),
        );
      }
      const methods = collector.context.family === '3.2' ? OAS_32_METHODS : HTTP_METHODS;
      methods.forEach((method) => {
        if (owns(pathItem, method)) {
          walkOperation(
            pathItem[method],
            childPointer(pathPointer, method),
            baseUri,
            collector,
            nestedEmit,
            depth,
            generation,
            { value: pathItem, pointer: pathPointer },
          );
        }
      });
      if (collector.context.family === '3.2' && isRecord(pathItem.additionalOperations)) {
        Object.entries(pathItem.additionalOperations).forEach(([method, operation]) => {
          if (!METHOD_TOKEN.test(method) || RESERVED_METHODS.has(method.toUpperCase())) return;
          walkOperation(
            operation,
            childPointer(childPointer(pathPointer, 'additionalOperations'), method),
            baseUri,
            collector,
            nestedEmit,
            depth,
            generation,
            { value: pathItem, pointer: pathPointer },
          );
        });
      }
    },
    'path-item-ref',
  );
}

function walkExample(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(value, pointer, baseUri, collector, emit, depth, generation, 'example', () => {});
}

function walkExamples(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  if (!isRecord(value)) return;
  Object.entries(value).forEach(([name, example]) =>
    walkExample(example, childPointer(pointer, name), baseUri, collector, emit, depth, generation),
  );
}

function walkSecurityScheme(
  value: unknown,
  pointer: string,
  baseUri: string,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  walkReferenceOr(value, pointer, baseUri, collector, emit, depth, generation, 'security-scheme', () => {});
}

function walkComponentMap(
  components: JsonRecord,
  key: string,
  walk: (value: unknown, pointer: string) => void,
  pointer: string,
): void {
  const values = components[key];
  if (!isRecord(values)) return;
  Object.entries(values).forEach(([name, value]) => walk(value, childPointer(childPointer(pointer, key), name)));
}

export function walkOpenApiDocument(
  document: unknown,
  collector: ScanCollector,
  emit: boolean,
  depth: number,
  generation: number,
): void {
  if (!isRecord(document)) return;
  if (
    typeof document.jsonSchemaDialect === 'string' &&
    !supportedSchemaDialect(document.jsonSchemaDialect, collector.context.family)
  ) {
    throw new ResourceLoadError(
      'DIALECT_UNSUPPORTED',
      'The OpenAPI document declares an unsupported JSON Schema dialect.',
    );
  }
  const baseUri = collector.context.baseUri;
  walkSecurityRequirements(document.security, '#/security', collector, emit, depth, generation);
  Object.entries(document).forEach(([key, container]) => {
    if (
      !KNIFE4J_SCHEMA_RESOURCES_FIELD.test(key) ||
      !isRecord(container) ||
      container.version !== PORTABLE_SCHEMA_RESOURCES_VERSION ||
      !isRecord(container.resources)
    ) {
      return;
    }
    Object.entries(container.resources).forEach(([name, schema]) =>
      walkSchema(
        schema,
        childPointer(childPointer(childPointer('#', key), 'resources'), name),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      ),
    );
  });
  if (isRecord(document.paths)) {
    Object.entries(document.paths).forEach(([path, item]) => {
      if (!path.startsWith('/')) return;
      walkPathItem(item, childPointer(childPointer('#', 'paths'), path), baseUri, collector, emit, depth, generation);
    });
  }
  if (isRecord(document.webhooks)) {
    Object.entries(document.webhooks).forEach(([name, item]) =>
      walkPathItem(
        item,
        childPointer(childPointer('#', 'webhooks'), name),
        baseUri,
        collector,
        emit,
        depth,
        generation,
      ),
    );
  }
  if (!isRecord(document.components)) return;
  const components = document.components;
  const pointer = childPointer('#', 'components');
  walkComponentMap(
    components,
    'schemas',
    (schema, schemaPointer) => walkSchema(schema, schemaPointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'parameters',
    (value, valuePointer) => walkParameter(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'headers',
    (value, valuePointer) => walkHeader(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'requestBodies',
    (value, valuePointer) => walkRequestBody(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'responses',
    (value, valuePointer) => walkResponse(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'callbacks',
    (value, valuePointer) => walkCallback(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'links',
    (value, valuePointer) => walkLink(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'examples',
    (value, valuePointer) => walkExample(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'securitySchemes',
    (value, valuePointer) => walkSecurityScheme(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  walkComponentMap(
    components,
    'pathItems',
    (value, valuePointer) => walkPathItem(value, valuePointer, baseUri, collector, emit, depth, generation),
    pointer,
  );
  if (collector.context.family === '3.2') {
    walkComponentMap(
      components,
      'mediaTypes',
      (value, valuePointer) => walkMediaType(value, valuePointer, baseUri, collector, emit, depth, generation),
      pointer,
    );
  }
}

export interface IndexedTargetValue {
  readonly schemaDialect?: string;
  readonly value: unknown;
  readonly pointer: string;
  readonly baseUri: string;
  readonly ownerRetrievalUri: string;
  readonly operationPathItem?: { readonly value: JsonRecord; readonly pointer: string };
}

export function portableOperationPathItem(document: unknown, pointer: string): IndexedTargetValue['operationPathItem'] {
  if (!isRecord(document) || typeof document.openapi !== 'string' || !pointer.startsWith('#/')) return undefined;
  // Indexed pointers are already URI-decoded. Only decode their JSON Pointer
  // tokens here, so a literal percent escape in a path is not decoded twice.
  const tokens = pointer.slice(2).split('/').map(decodeJsonPointerToken);
  if (tokens.length !== 5) return undefined;
  const [field, name, section, path, method] = tokens;
  if (
    !KNIFE4J_OPERATION_TARGETS_FIELD.test(field) ||
    !OPERATION_TARGET_NAME.test(name) ||
    !['paths', 'webhooks'].includes(section) ||
    (section === 'paths' && !path.startsWith('/')) ||
    !HTTP_METHODS.some((candidate) => candidate === method)
  )
    return undefined;
  const targets = document[field];
  const container = isRecord(targets) ? targets[name] : undefined;
  if (!isRecord(container) || Object.keys(container).length !== 1) return undefined;
  const paths = container[section];
  if (!isRecord(paths) || Object.keys(paths).length !== 1) return undefined;
  const pathItem = paths[path];
  if (
    !isRecord(pathItem) ||
    !isRecord(pathItem[method]) ||
    Object.keys(pathItem).some((key) => key !== method && !PATH_ITEM_CONTEXT_FIELDS.has(key) && !key.startsWith('x-'))
  )
    return undefined;
  return { value: pathItem, pointer: pointer.slice(0, pointer.lastIndexOf('/')) };
}

export function expectedTargetValue(
  edge: MutableEdge,
  resourceTarget: (uri: string) => ResourceTarget | undefined,
  anchorTarget: (uri: string) => ResourceTarget | undefined,
  containingBase: (ownerRetrievalUri: string, pointer: string, fallback: string) => string,
): IndexedTargetValue | undefined {
  const directAnchor = anchorTarget(normalizedAnchorUri(edge.resolvedUri));
  if (directAnchor)
    return {
      value: directAnchor.value,
      pointer: directAnchor.pointer,
      baseUri: directAnchor.evaluationBaseUri,
      ownerRetrievalUri: directAnchor.ownerRetrievalUri,
    };
  const resource = resourceTarget(edge.targetRetrievalUri);
  if (resource) {
    const value = resolveJsonPointer(resource.value, edge.fragment);
    if (value !== undefined) {
      const pointer = pointerWithinResource(resource.pointer, edge.fragment);
      return {
        value,
        pointer,
        baseUri: containingBase(resource.ownerRetrievalUri, pointer, resource.evaluationBaseUri),
        ownerRetrievalUri: resource.ownerRetrievalUri,
      };
    }
    throw new ResourceLoadError(
      'FRAGMENT_NOT_FOUND',
      'The complete external document does not contain the referenced fragment.',
    );
  }
  return undefined;
}

export function walkExpectedTarget(
  target: IndexedTargetValue,
  edge: MutableEdge,
  collector: ScanCollector,
  generation: number,
  emit = true,
): void {
  const { value, pointer, baseUri } = target;
  if (edge.expectedTarget === 'schema') {
    if (typeof value !== 'boolean' && !isRecord(value)) {
      throw new ResourceLoadError('DOCUMENT_KIND_MISMATCH', 'The referenced target is not a Schema Object.');
    }
    if (!edge.fragment && isRecord(value) && typeof value.openapi === 'string') {
      throw new ResourceLoadError('DOCUMENT_KIND_MISMATCH', 'An OpenAPI document root is not a Schema Object.');
    }
    walkSchema(value, pointer, baseUri, collector, emit, edge.depth, generation, target.schemaDialect);
    return;
  }
  if (!isRecord(value)) {
    throw new ResourceLoadError('DOCUMENT_KIND_MISMATCH', 'The referenced OpenAPI target is not an object.');
  }
  switch (edge.expectedTarget) {
    case 'path-item':
      walkPathItem(value, pointer, baseUri, collector, emit, edge.depth, generation);
      break;
    case 'operation':
      if (target.operationPathItem && collector.context.family === '3.2') {
        const parent = target.operationPathItem;
        if (Array.isArray(parent.value.parameters))
          parent.value.parameters.forEach((parameter, index) =>
            walkParameter(
              parameter,
              childPointer(childPointer(parent.pointer, 'parameters'), index),
              baseUri,
              collector,
              emit,
              edge.depth,
              generation,
            ),
          );
        // An operationRef reaches its inherited parameters, not sibling operations.
        walkOperation(value, pointer, baseUri, collector, emit, edge.depth, generation, parent);
      } else if (target.operationPathItem) {
        walkPathItem(
          target.operationPathItem.value,
          target.operationPathItem.pointer,
          baseUri,
          collector,
          emit,
          edge.depth,
          generation,
        );
      } else {
        walkOperation(value, pointer, baseUri, collector, emit, edge.depth, generation);
      }
      break;
    case 'parameter':
      walkParameter(value, pointer, baseUri, collector, emit, edge.depth, generation);
      break;
    case 'request-body':
      walkRequestBody(value, pointer, baseUri, collector, emit, edge.depth, generation);
      break;
    case 'response':
      walkResponse(value, pointer, baseUri, collector, emit, edge.depth, generation);
      break;
    case 'header':
      walkHeader(value, pointer, baseUri, collector, emit, edge.depth, generation);
      break;
    case 'callback':
      walkCallback(value, pointer, baseUri, collector, emit, edge.depth, generation);
      break;
    case 'link':
      walkLink(value, pointer, baseUri, collector, emit, edge.depth, generation);
      break;
    case 'example':
      walkExample(value, pointer, baseUri, collector, emit, edge.depth, generation);
      break;
    case 'security-scheme':
      walkSecurityScheme(value, pointer, baseUri, collector, emit, edge.depth, generation);
      break;
    case 'media-type':
      walkMediaType(value, pointer, baseUri, collector, emit, edge.depth, generation);
      break;
  }
}

function declaresSchemaRoot(document: unknown): boolean {
  return (
    typeof document === 'boolean' ||
    (isRecord(document) && ['$schema', '$id', '$anchor', '$dynamicAnchor'].some((keyword) => owns(document, keyword)))
  );
}

export function documentKind(
  document: unknown,
  incoming: readonly MutableEdge[],
  family: DocumentContext['family'],
): ResourceGraphNode['documentKind'] {
  if (isRecord(document) && typeof document.openapi === 'string') {
    if (
      family === '3.1'
        ? !OAS_31_VERSION.test(document.openapi)
        : getOpenApiSpecificationFeatures(document.openapi)?.family !== '3.2'
    ) {
      throw new ResourceLoadError(
        family === '3.1' ? 'DOCUMENT_KIND_MISMATCH' : 'OPENAPI_VERSION_UNSUPPORTED',
        family === '3.1'
          ? `External OpenAPI document '${document.openapi}' is outside the supported 3.1.x range.`
          : `This project does not support an OpenAPI ${family}.x graph referencing document version '${document.openapi}'.`,
      );
    }
    return 'openapi';
  }
  if (family === '3.2') {
    const roots = new Set(incoming.filter((edge) => !edge.fragment).map((edge) => edge.expectedTarget));
    if (roots.size > 1 || (declaresSchemaRoot(document) && [...roots].some((kind) => kind !== 'schema'))) {
      throw new ResourceLoadError(
        'DOCUMENT_KIND_MISMATCH',
        'An unversioned root cannot be inferred as conflicting object types.',
      );
    }
    const root = roots.values().next().value;
    if (root !== undefined) return root === 'schema' ? 'json-schema' : 'referenceable-object';
    if (declaresSchemaRoot(document)) return 'json-schema';
  }
  if (typeof document === 'boolean' || incoming.some((edge) => edge.expectedTarget === 'schema')) return 'json-schema';
  return 'referenceable-object';
}

export function createCollector(context: DocumentContext, entry: DocumentContext): ScanCollector {
  return {
    sourceRetrievalUri: context.retrievalUri,
    context,
    entry,
    objects: new Map(),
    documents: new Map(),
    resources: new Map(),
    anchors: new Map(),
    edges: [],
    diagnostics: [],
  };
}
