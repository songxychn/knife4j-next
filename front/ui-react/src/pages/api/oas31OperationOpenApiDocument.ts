import {
  OPENAPI_HTTP_METHODS,
  escapeJsonPointerSegment,
  isOpenApi31Version,
  parseLocalJsonPointer,
  resolveJsonPointerTokens,
} from 'knife4j-core';
import {
  PORTABLE_SCHEMA_RESOURCES_EXTENSION,
  PORTABLE_SCHEMA_RESOURCES_VERSION,
  safeResourceDisplay,
  type ResourceGraphEdge,
  type ResourceGraphSnapshot,
  type ResourceGraphTarget,
  type ResourceReferenceKind,
} from '../../schema/externalResourceGraph';
import { sha256Hex, stableSerializeJson } from '../../apiChange/apiChangeTracker';
import type { SwaggerDoc } from '../../types/swagger';

type JsonRecord = Record<string, unknown>;
type SourceKind = 'path' | 'webhook';

type CopyKind =
  | 'opaque'
  | 'schema'
  | 'pathItem'
  | 'operation'
  | 'parameters'
  | 'parameter'
  | 'requestBody'
  | 'responses'
  | 'response'
  | 'headers'
  | 'header'
  | 'content'
  | 'mediaType'
  | 'examples'
  | 'example'
  | 'links'
  | 'link'
  | 'callbacks'
  | 'callback'
  | 'encodingMap'
  | 'encoding'
  | 'securityScheme';

type ReferenceTargetKind =
  | 'pathItem'
  | 'operation'
  | 'parameter'
  | 'requestBody'
  | 'response'
  | 'header'
  | 'example'
  | 'link'
  | 'callback'
  | 'securityScheme';

export type Oas31OperationExportBlockerCode =
  | 'GRAPH_STALE'
  | 'OPERATION_NOT_FOUND'
  | 'REFERENCE_NOT_INDEXED'
  | 'RESOURCE_PENDING'
  | 'RESOURCE_FAILED'
  | 'REFERENCE_TARGET_MISSING'
  | 'REFERENCE_TARGET_INVALID'
  | 'PATH_ITEM_REF_CONFLICT'
  | 'SECURITY_SCHEME_MISSING';

export interface Oas31OperationExportBlocker {
  readonly code: Oas31OperationExportBlockerCode;
  readonly sourcePointer: string;
  readonly referenceKind?: ResourceReferenceKind;
  readonly resourceDisplay?: string;
}

export type Oas31OperationExportResult =
  | { readonly status: 'ready'; readonly document: JsonRecord }
  | { readonly status: 'unavailable'; readonly blockers: readonly Oas31OperationExportBlocker[] };

export interface Oas31OperationExportContext {
  readonly retrievalUri: string;
  readonly snapshot: ResourceGraphSnapshot;
}

interface LocatedValue {
  readonly ownerRetrievalUri: string;
  readonly pointer: string;
  readonly value: unknown;
}

interface LocatedPathItem {
  readonly fields: ReadonlyMap<string, LocatedValue>;
}

interface LocatedResource {
  readonly uri: string;
  readonly target: ResourceGraphTarget;
  readonly location: LocatedValue;
}

const PATH_ITEM_FIELDS = ['summary', 'description', 'servers', 'parameters'] as const;
const HTTP_METHODS = OPENAPI_HTTP_METHODS as readonly string[];
const COMPONENT_NAME = /^[A-Za-z0-9._-]+$/;
const OAS_31_BASE_DIALECT = 'https://spec.openapis.org/oas/3.1/dialect/base';
const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';
const REF_TARGETS_FIELD = 'x-knife4j-operation-ref-targets';
const NO_REFERENCE_ANNOTATIONS: ReadonlySet<string> = new Set();
const DESCRIPTION_REFERENCE_ANNOTATION: ReadonlySet<string> = new Set(['description']);
const ALL_REFERENCE_ANNOTATIONS: ReadonlySet<string> = new Set(['summary', 'description']);

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function owns(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function record(): JsonRecord {
  return Object.create(null) as JsonRecord;
}

function appendPointer(base: string, ...tokens: Array<string | number>): string {
  return `${base}${tokens.map((token) => `/${escapeJsonPointerSegment(String(token))}`).join('')}`;
}

function pointerTokens(pointer: string): string[] | null {
  const parsed = parseLocalJsonPointer(pointer);
  return parsed.valid && parsed.tokens ? parsed.tokens : null;
}

function isPointerPrefix(prefix: string, pointer: string): boolean {
  const prefixTokens = pointerTokens(prefix);
  const valueTokens = pointerTokens(pointer);
  return (
    prefixTokens !== null &&
    valueTokens !== null &&
    prefixTokens.length <= valueTokens.length &&
    prefixTokens.every((token, index) => valueTokens[index] === token)
  );
}

function relativePointerTokens(prefix: string, pointer: string): string[] | null {
  if (!isPointerPrefix(prefix, pointer)) return null;
  return pointerTokens(pointer)!.slice(pointerTokens(prefix)!.length);
}

function uriWithoutFragment(uri: string): string {
  const parsed = new URL(uri);
  parsed.hash = '';
  return parsed.href;
}

function pointerUri(resourceUri: string, tokens: readonly string[]): string {
  if (tokens.length === 0) return resourceUri;
  const pointer = `#/${tokens.map(escapeJsonPointerSegment).join('/')}`;
  return new URL(pointer, resourceUri).href;
}

function uniqueExtensionField(source: JsonRecord, preferred: string): string {
  if (!owns(source, preferred)) return preferred;
  let suffix = 2;
  while (owns(source, `${preferred}-${suffix}`)) suffix += 1;
  return `${preferred}-${suffix}`;
}

function referenceTargetKind(kind: CopyKind): ReferenceTargetKind | null {
  switch (kind) {
    case 'pathItem':
    case 'operation':
    case 'parameter':
    case 'requestBody':
    case 'response':
    case 'header':
    case 'example':
    case 'link':
    case 'callback':
    case 'securityScheme':
      return kind;
    default:
      return null;
  }
}

function referenceAnnotationFields(kind: ReferenceTargetKind): ReadonlySet<string> {
  if (kind === 'example') return ALL_REFERENCE_ANNOTATIONS;
  if (
    kind === 'parameter' ||
    kind === 'requestBody' ||
    kind === 'response' ||
    kind === 'header' ||
    kind === 'link' ||
    kind === 'securityScheme'
  ) {
    return DESCRIPTION_REFERENCE_ANNOTATION;
  }
  return NO_REFERENCE_ANNOTATIONS;
}

function childKind(kind: CopyKind, key: string): CopyKind {
  switch (kind) {
    case 'pathItem':
      if (HTTP_METHODS.includes(key)) return 'operation';
      if (key === 'parameters') return 'parameters';
      return 'opaque';
    case 'operation':
      if (key === 'parameters') return 'parameters';
      if (key === 'requestBody') return 'requestBody';
      if (key === 'responses') return 'responses';
      if (key === 'callbacks') return 'callbacks';
      return 'opaque';
    case 'parameter':
    case 'header':
      if (key === 'schema') return 'schema';
      if (key === 'content') return 'content';
      if (key === 'examples') return 'examples';
      return 'opaque';
    case 'requestBody':
      return key === 'content' ? 'content' : 'opaque';
    case 'response':
      if (key === 'headers') return 'headers';
      if (key === 'content') return 'content';
      if (key === 'links') return 'links';
      return 'opaque';
    case 'mediaType':
      if (key === 'schema') return 'schema';
      if (key === 'examples') return 'examples';
      if (key === 'encoding') return 'encodingMap';
      return 'opaque';
    case 'encoding':
      return key === 'headers' ? 'headers' : 'opaque';
    default:
      return 'opaque';
  }
}

function mapValueKind(kind: CopyKind): CopyKind | null {
  switch (kind) {
    case 'responses':
      return 'response';
    case 'headers':
      return 'header';
    case 'content':
      return 'mediaType';
    case 'examples':
      return 'example';
    case 'links':
      return 'link';
    case 'callbacks':
      return 'callback';
    case 'encodingMap':
      return 'encoding';
    default:
      return null;
  }
}

class Oas31OperationBundler {
  private readonly source: JsonRecord;
  private readonly snapshot: ResourceGraphSnapshot;
  private readonly entryRetrievalUri: string;
  private readonly edgeIndex = new Map<string, ResourceGraphEdge[]>();
  private readonly blockers = new Map<string, Oas31OperationExportBlocker>();
  private readonly referenceTargets = record();
  private readonly schemaResources = record();
  private readonly securitySchemes = record();
  private readonly referenceNames = new Map<string, string>();
  private readonly schemaResourceNames = new Map<string, string>();
  private readonly schemaResourceValues = new Map<string, JsonRecord>();
  private readonly sparseResources = new Set<string>();
  private readonly includedSparsePointers = new Map<string, Set<string>>();
  private readonly securityNames = new Map<string, string>();
  private readonly usedSecurityNames = new Set<string>();
  private readonly refTargetsField: string;
  private readonly schemaResourcesField: string;
  private topOperationIdentity = '';

  public constructor(source: JsonRecord, context: Oas31OperationExportContext) {
    this.source = source;
    this.snapshot = context.snapshot;
    this.entryRetrievalUri = context.retrievalUri;
    this.refTargetsField = uniqueExtensionField(source, REF_TARGETS_FIELD);
    this.schemaResourcesField = uniqueExtensionField(source, PORTABLE_SCHEMA_RESOURCES_EXTENSION);
    context.snapshot.edges.forEach((edge) => {
      const key = this.edgeKey(edge.sourceRetrievalUri, edge.sourcePointer);
      const edges = this.edgeIndex.get(key) ?? [];
      edges.push(edge);
      this.edgeIndex.set(key, edges);
    });
  }

  public build(path: string, method: string, sourceKind: SourceKind): Oas31OperationExportResult {
    const entryNode = this.snapshot.nodes.get(this.entryRetrievalUri);
    if (
      this.snapshot.entryRetrievalUri !== this.entryRetrievalUri ||
      !entryNode ||
      entryNode.contentDigest !== sha256Hex(stableSerializeJson(this.source))
    ) {
      this.block('GRAPH_STALE', '#');
      return this.unavailable();
    }

    const collection = sourceKind === 'webhook' ? 'webhooks' : 'paths';
    const rawPathItem = this.location(this.entryRetrievalUri, appendPointer('#', collection, path));
    if (!rawPathItem || !asRecord(rawPathItem.value)) {
      this.block('OPERATION_NOT_FOUND', appendPointer('#', collection, path));
      return this.unavailable();
    }
    const resolvedPathItem = this.resolvePathItem(rawPathItem, new Set());
    const normalizedMethod = method.toLowerCase();
    const operation = resolvedPathItem?.fields.get(normalizedMethod);
    if (!resolvedPathItem || !operation || !asRecord(operation.value)) {
      this.block('OPERATION_NOT_FOUND', appendPointer(rawPathItem.pointer, normalizedMethod));
      return this.unavailable();
    }
    this.topOperationIdentity = this.locationKey(operation);

    const outputPathItem = record();
    PATH_ITEM_FIELDS.forEach((field) => {
      const located = resolvedPathItem.fields.get(field);
      if (located) outputPathItem[field] = this.copyValue(located, field === 'parameters' ? 'parameters' : 'opaque');
    });
    resolvedPathItem.fields.forEach((located, field) => {
      if (field.startsWith('x-')) outputPathItem[field] = this.copyValue(located, 'opaque');
    });
    outputPathItem[normalizedMethod] = this.copyValue(operation, 'operation');

    const output = record();
    output.openapi = this.source.openapi;
    output.info = this.copyValue(this.childLocation(this.entryLocation(), 'info', this.source.info), 'opaque');
    if (owns(this.source, 'jsonSchemaDialect')) output.jsonSchemaDialect = this.source.jsonSchemaDialect;
    if (owns(this.source, 'servers')) {
      output.servers = this.copyValue(
        this.childLocation(this.entryLocation(), 'servers', this.source.servers),
        'opaque',
      );
    }
    Object.entries(this.source).forEach(([key, value]) => {
      if (key.startsWith('x-'))
        output[key] = this.copyValue(this.childLocation(this.entryLocation(), key, value), 'opaque');
    });

    const items = record();
    items[path] = outputPathItem;
    output[collection] = items;

    const operationRecord = operation.value as JsonRecord;
    if (!owns(operationRecord, 'security') && owns(this.source, 'security')) {
      output.security = this.copySecurityRequirements(
        this.childLocation(this.entryLocation(), 'security', this.source.security),
      );
    }

    if (Object.keys(this.securitySchemes).length > 0) output.components = { securitySchemes: this.securitySchemes };
    if (Object.keys(this.referenceTargets).length > 0) output[this.refTargetsField] = this.referenceTargets;
    if (Object.keys(this.schemaResources).length > 0) {
      output[this.schemaResourcesField] = {
        version: PORTABLE_SCHEMA_RESOURCES_VERSION,
        resources: this.schemaResources,
      };
    }

    return this.blockers.size > 0 ? this.unavailable() : { status: 'ready', document: output };
  }

  private entryLocation(): LocatedValue {
    return { ownerRetrievalUri: this.entryRetrievalUri, pointer: '#', value: this.source };
  }

  private locationKey(location: Pick<LocatedValue, 'ownerRetrievalUri' | 'pointer'>): string {
    return `${location.ownerRetrievalUri}\n${location.pointer}`;
  }

  private edgeKey(ownerRetrievalUri: string, pointer: string): string {
    return `${ownerRetrievalUri}\n${pointer}`;
  }

  private childLocation(parent: LocatedValue, key: string | number, value: unknown): LocatedValue {
    return {
      ownerRetrievalUri: parent.ownerRetrievalUri,
      pointer: appendPointer(parent.pointer, key),
      value,
    };
  }

  private sourceDocument(ownerRetrievalUri: string): JsonRecord | null {
    if (ownerRetrievalUri === this.entryRetrievalUri) return this.source;
    return asRecord(this.snapshot.nodes.get(ownerRetrievalUri)?.document);
  }

  private location(ownerRetrievalUri: string, pointer: string): LocatedValue | null {
    const document = this.sourceDocument(ownerRetrievalUri);
    const tokens = pointerTokens(pointer);
    if (!document || !tokens) return null;
    const resolved = resolveJsonPointerTokens(document, tokens);
    if (!resolved.found) return null;
    return { ownerRetrievalUri, pointer, value: resolved.value };
  }

  private edgeAt(
    ownerRetrievalUri: string,
    pointer: string,
    kinds?: readonly ResourceReferenceKind[],
  ): ResourceGraphEdge | null {
    const edges = this.edgeIndex.get(this.edgeKey(ownerRetrievalUri, pointer)) ?? [];
    return edges.find((edge) => !kinds || kinds.includes(edge.kind)) ?? null;
  }

  private block(code: Oas31OperationExportBlockerCode, sourcePointer: string, edge?: ResourceGraphEdge): void {
    const resourceDisplay = edge?.targetRetrievalUri ? safeResourceDisplay(edge.targetRetrievalUri) : undefined;
    const blocker: Oas31OperationExportBlocker = Object.freeze({
      code,
      sourcePointer,
      ...(edge ? { referenceKind: edge.kind } : {}),
      ...(resourceDisplay ? { resourceDisplay } : {}),
    });
    this.blockers.set(`${code}\n${sourcePointer}\n${resourceDisplay ?? ''}`, blocker);
  }

  private unavailable(): Oas31OperationExportResult {
    return {
      status: 'unavailable',
      blockers: Object.freeze(
        [...this.blockers.values()].sort((left, right) =>
          `${left.sourcePointer}\n${left.code}`.localeCompare(`${right.sourcePointer}\n${right.code}`),
        ),
      ),
    };
  }

  private usableEdge(edge: ResourceGraphEdge | null, sourcePointer: string): edge is ResourceGraphEdge {
    if (!edge) {
      this.block('REFERENCE_NOT_INDEXED', sourcePointer);
      return false;
    }
    if (edge.state === 'pending') {
      this.block('RESOURCE_PENDING', sourcePointer, edge);
      return false;
    }
    if (edge.state === 'failed') {
      this.block('RESOURCE_FAILED', sourcePointer, edge);
      return false;
    }
    return true;
  }

  private targetLocation(edge: ResourceGraphEdge): LocatedValue | null {
    const anchor = this.snapshot.anchorTargets.get(edge.resolvedUri);
    if (anchor) return this.location(anchor.ownerRetrievalUri, anchor.pointer);

    let resourceUri: string;
    let fragment: string;
    try {
      resourceUri = uriWithoutFragment(edge.resolvedUri);
      fragment = new URL(edge.resolvedUri).hash;
    } catch {
      this.block('REFERENCE_TARGET_MISSING', edge.sourcePointer, edge);
      return null;
    }
    const target = this.snapshot.resourceTargets.get(resourceUri);
    if (!target) {
      this.block('REFERENCE_TARGET_MISSING', edge.sourcePointer, edge);
      return null;
    }
    const parsed = parseLocalJsonPointer(fragment || '#');
    if (!parsed.valid || !parsed.tokens) {
      this.block('REFERENCE_TARGET_MISSING', edge.sourcePointer, edge);
      return null;
    }
    const pointer = appendPointer(target.pointer, ...parsed.tokens);
    const location = this.location(target.ownerRetrievalUri, pointer);
    if (!location) this.block('REFERENCE_TARGET_MISSING', edge.sourcePointer, edge);
    return location;
  }

  private resolvePathItem(location: LocatedValue, seen: Set<string>): LocatedPathItem | null {
    const value = asRecord(location.value);
    if (!value) {
      this.block('REFERENCE_TARGET_INVALID', location.pointer);
      return null;
    }
    if (typeof value.$ref !== 'string') {
      return {
        fields: new Map(
          Object.entries(value).map(([key, nestedValue]) => [key, this.childLocation(location, key, nestedValue)]),
        ),
      };
    }

    const edgePointer = appendPointer(location.pointer, '$ref');
    const edge = this.edgeAt(location.ownerRetrievalUri, edgePointer, ['path-item-ref']);
    if (!this.usableEdge(edge, edgePointer)) return null;
    const identity = `${edge.sourceRetrievalUri}\n${edge.resolvedUri}`;
    if (seen.has(identity)) {
      this.block('REFERENCE_TARGET_INVALID', edgePointer, edge);
      return null;
    }
    const target = this.targetLocation(edge);
    if (!target || !asRecord(target.value)) {
      this.block('REFERENCE_TARGET_INVALID', edgePointer, edge);
      return null;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(identity);
    const resolved = this.resolvePathItem(target, nextSeen);
    if (!resolved) return null;

    const fields = new Map(resolved.fields);
    Object.entries(value).forEach(([key, nestedValue]) => {
      if (key === '$ref') return;
      if (fields.has(key)) this.block('PATH_ITEM_REF_CONFLICT', appendPointer(location.pointer, key), edge);
      else fields.set(key, this.childLocation(location, key, nestedValue));
    });
    return { fields };
  }

  private copyValue(location: LocatedValue, kind: CopyKind): unknown {
    if (kind === 'schema') return this.schemaProxy(location);
    if (kind === 'pathItem') return this.copyPathItem(location);
    const value = location.value;
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      const itemKind: CopyKind = kind === 'parameters' ? 'parameter' : kind;
      return value.map((item, index) => this.copyValue(this.childLocation(location, index, item), itemKind));
    }

    const source = value as JsonRecord;
    const output = record();
    const targetKind = referenceTargetKind(kind);
    if (targetKind && typeof source.$ref === 'string') {
      const pointer = appendPointer(location.pointer, '$ref');
      output.$ref = this.copyReference(location.ownerRetrievalUri, pointer, targetKind, ['reference-object']);
      const annotations = referenceAnnotationFields(targetKind);
      Object.entries(source).forEach(([key, nestedValue]) => {
        if (annotations.has(key)) {
          output[key] = this.copyValue(this.childLocation(location, key, nestedValue), 'opaque');
        }
      });
      return output;
    }

    const mappedKind = mapValueKind(kind);
    if (mappedKind) {
      Object.entries(source).forEach(([key, nestedValue]) => {
        const extension = kind === 'responses' && key.startsWith('x-');
        output[key] = this.copyValue(this.childLocation(location, key, nestedValue), extension ? 'opaque' : mappedKind);
      });
      return output;
    }

    if (kind === 'callback') {
      Object.entries(source).forEach(([key, nestedValue]) => {
        output[key] = this.copyValue(
          this.childLocation(location, key, nestedValue),
          key.startsWith('x-') ? 'opaque' : 'pathItem',
        );
      });
      return output;
    }

    Object.entries(source).forEach(([key, nestedValue]) => {
      const nested = this.childLocation(location, key, nestedValue);
      if (kind === 'link' && key === 'operationRef' && typeof nestedValue === 'string') {
        output[key] = this.copyReference(location.ownerRetrievalUri, nested.pointer, 'operation', [
          'link-operation-ref',
        ]);
      } else if (kind === 'operation' && key === 'security') {
        output[key] = this.copySecurityRequirements(nested);
      } else {
        output[key] = this.copyValue(nested, key.startsWith('x-') ? 'opaque' : childKind(kind, key));
      }
    });

    if (kind === 'operation' && !owns(source, 'security') && this.locationKey(location) !== this.topOperationIdentity) {
      const document = this.sourceDocument(location.ownerRetrievalUri);
      if (document && owns(document, 'security')) {
        output.security = this.copySecurityRequirements(
          this.childLocation(
            { ownerRetrievalUri: location.ownerRetrievalUri, pointer: '#', value: document },
            'security',
            document.security,
          ),
        );
      }
    }
    return output;
  }

  private copyPathItem(location: LocatedValue): JsonRecord {
    const resolved = this.resolvePathItem(location, new Set());
    const output = record();
    resolved?.fields.forEach((located, key) => {
      output[key] = this.copyValue(located, key.startsWith('x-') ? 'opaque' : childKind('pathItem', key));
    });
    return output;
  }

  private copyReference(
    ownerRetrievalUri: string,
    pointer: string,
    targetKind: ReferenceTargetKind,
    edgeKinds: readonly ResourceReferenceKind[],
  ): string {
    const edge = this.edgeAt(ownerRetrievalUri, pointer, edgeKinds);
    if (!this.usableEdge(edge, pointer)) return '#';
    const key = `${targetKind}\n${edge.resolvedUri}`;
    let name = this.referenceNames.get(key);
    if (name) return `#/${escapeJsonPointerSegment(this.refTargetsField)}/${escapeJsonPointerSegment(name)}`;

    const target = this.targetLocation(edge);
    if (!target || !asRecord(target.value)) {
      this.block('REFERENCE_TARGET_INVALID', pointer, edge);
      return '#';
    }
    name = `target-${this.referenceNames.size + 1}`;
    this.referenceNames.set(key, name);
    const placeholder = record();
    this.referenceTargets[name] = placeholder;
    const copied = this.copyValue(target, targetKind);
    const copiedRecord = asRecord(copied);
    if (!copiedRecord) this.block('REFERENCE_TARGET_INVALID', pointer, edge);
    else Object.assign(placeholder, copiedRecord);
    return `#/${escapeJsonPointerSegment(this.refTargetsField)}/${escapeJsonPointerSegment(name)}`;
  }

  private copySecurityRequirements(location: LocatedValue): unknown {
    if (!Array.isArray(location.value)) return this.copyValue(location, 'opaque');
    return location.value.map((requirement, index) => {
      const requirementLocation = this.childLocation(location, index, requirement);
      const requirementRecord = asRecord(requirement);
      if (!requirementRecord) return this.copyValue(requirementLocation, 'opaque');
      const output = record();
      Object.entries(requirementRecord).forEach(([name, scopes]) => {
        const outputName = this.ensureSecurityScheme(location.ownerRetrievalUri, name, requirementLocation.pointer);
        output[outputName] = this.copyValue(this.childLocation(requirementLocation, name, scopes), 'opaque');
      });
      return output;
    });
  }

  private ensureSecurityScheme(ownerRetrievalUri: string, name: string, sourcePointer: string): string {
    const identity = `${ownerRetrievalUri}\n${name}`;
    const existing = this.securityNames.get(identity);
    if (existing) return existing;

    let outputName = name;
    let suffix = 2;
    while (this.usedSecurityNames.has(outputName)) outputName = `${name}-${suffix++}`;
    this.usedSecurityNames.add(outputName);
    this.securityNames.set(identity, outputName);

    const location = this.location(ownerRetrievalUri, appendPointer('#', 'components', 'securitySchemes', name));
    if (!location || !asRecord(location.value)) {
      this.block('SECURITY_SCHEME_MISSING', sourcePointer);
      return outputName;
    }
    this.securitySchemes[outputName] = this.copyValue(location, 'securityScheme');
    return outputName;
  }

  private schemaProxy(location: LocatedValue): JsonRecord {
    const uri = this.ensureSchemaLocation(location);
    return { $ref: uri ?? '#' };
  }

  private containingResource(location: LocatedValue): LocatedResource | null {
    let selected: LocatedResource | null = null;
    this.snapshot.resourceTargets.forEach((target, uri) => {
      if (
        target.ownerRetrievalUri !== location.ownerRetrievalUri ||
        !isPointerPrefix(target.pointer, location.pointer)
      ) {
        return;
      }
      if (!selected || pointerTokens(target.pointer)!.length > pointerTokens(selected.target.pointer)!.length) {
        const targetLocation = this.location(target.ownerRetrievalUri, target.pointer);
        if (targetLocation) selected = { uri, target, location: targetLocation };
      }
    });
    return selected;
  }

  private ensureSchemaLocation(location: LocatedValue): string | null {
    const resource = this.containingResource(location);
    if (!resource) {
      this.block('REFERENCE_TARGET_MISSING', location.pointer);
      return null;
    }
    const root = this.ensureSchemaResource(resource);
    const relative = relativePointerTokens(resource.target.pointer, location.pointer);
    if (!root || !relative) {
      this.block('REFERENCE_TARGET_MISSING', location.pointer);
      return null;
    }
    if (this.sparseResources.has(resource.uri)) this.includeSparseSchema(resource, location);
    return pointerUri(resource.uri, relative);
  }

  private ensureSchemaResource(resource: LocatedResource): JsonRecord | null {
    const existing = this.schemaResourceValues.get(resource.uri);
    if (existing) return existing;

    const name = `resource-${this.schemaResourceNames.size + 1}`;
    this.schemaResourceNames.set(resource.uri, name);
    const placeholder = record();
    this.schemaResourceValues.set(resource.uri, placeholder);
    this.schemaResources[name] = placeholder;

    const node = this.snapshot.nodes.get(resource.target.ownerRetrievalUri);
    const sparse = node?.documentKind === 'openapi' && resource.target.pointer === '#';
    const dialect = this.effectiveDialect(resource);
    if (sparse) {
      placeholder.$schema = dialect;
      placeholder.$id = resource.uri;
      this.sparseResources.add(resource.uri);
      this.includedSparsePointers.set(resource.uri, new Set());
    } else if (typeof resource.location.value === 'boolean') {
      placeholder.$schema = dialect;
      placeholder.$id = resource.uri;
      if (!resource.location.value) placeholder.not = {};
    } else {
      const source = asRecord(resource.location.value);
      if (!source) {
        this.block('REFERENCE_TARGET_INVALID', resource.location.pointer);
        return null;
      }
      const copied = this.copySchemaTree(resource.location);
      const copiedRecord = asRecord(copied);
      if (!copiedRecord) {
        this.block('REFERENCE_TARGET_INVALID', resource.location.pointer);
        return null;
      }
      Object.assign(placeholder, copiedRecord);
      placeholder.$schema = dialect;
      placeholder.$id = resource.uri;
    }
    return placeholder;
  }

  private effectiveDialect(resource: LocatedResource): string {
    let selectedPointer = '';
    let selectedDialect: string | null = null;
    this.snapshot.resourceTargets.forEach((target) => {
      if (
        target.ownerRetrievalUri !== resource.target.ownerRetrievalUri ||
        !isPointerPrefix(target.pointer, resource.target.pointer)
      ) {
        return;
      }
      const value = asRecord(this.location(target.ownerRetrievalUri, target.pointer)?.value);
      if (
        typeof value?.$schema === 'string' &&
        pointerTokens(target.pointer)!.length >= pointerTokens(selectedPointer || '#')!.length
      ) {
        selectedPointer = target.pointer;
        selectedDialect = value.$schema;
      }
    });
    if (selectedDialect) return selectedDialect;
    const document = this.sourceDocument(resource.target.ownerRetrievalUri);
    if (typeof document?.jsonSchemaDialect === 'string') return document.jsonSchemaDialect;
    if (typeof document?.openapi === 'string') return OAS_31_BASE_DIALECT;
    if (typeof asRecord(resource.location.value)?.$schema === 'string') {
      return asRecord(resource.location.value)!.$schema as string;
    }
    return JSON_SCHEMA_2020_12;
  }

  private includeSparseSchema(resource: LocatedResource, location: LocatedValue): void {
    const included = this.includedSparsePointers.get(resource.uri)!;
    if ([...included].some((pointer) => isPointerPrefix(pointer, location.pointer))) return;
    const root = this.schemaResourceValues.get(resource.uri)!;
    const relative = relativePointerTokens(resource.target.pointer, location.pointer);
    if (!relative) return;
    [...included].forEach((pointer) => {
      if (isPointerPrefix(location.pointer, pointer)) included.delete(pointer);
    });
    included.add(location.pointer);
    const copied = this.copySchemaTree(location);
    this.assignAt(root, relative, copied);
  }

  private assignAt(root: JsonRecord, tokens: readonly string[], value: unknown): void {
    if (tokens.length === 0) return;
    let current = root;
    tokens.slice(0, -1).forEach((token) => {
      const nested = asRecord(current[token]);
      if (nested) current = nested;
      else {
        const created = record();
        current[token] = created;
        current = created;
      }
    });
    current[tokens[tokens.length - 1]] = value;
  }

  private copySchemaTree(location: LocatedValue): unknown {
    const value = location.value;
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string') {
        const edge = this.edgeAt(location.ownerRetrievalUri, location.pointer, [
          'schema-ref',
          'schema-dynamic-ref',
          'discriminator-mapping',
        ]);
        if (edge) {
          if (this.usableEdge(edge, location.pointer)) {
            const target = this.targetLocation(edge);
            if (target) this.ensureSchemaLocation(target);
            return edge.resolvedUri;
          }
        }
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => this.copySchemaTree(this.childLocation(location, index, item)));
    }
    const source = value as JsonRecord;
    const output = record();
    Object.entries(source).forEach(([key, nestedValue]) => {
      output[key] = this.copySchemaTree(this.childLocation(location, key, nestedValue));
    });

    const discriminator = asRecord(source.discriminator);
    const mapping = asRecord(discriminator?.mapping);
    const outputDiscriminator = asRecord(output.discriminator);
    const outputMapping = asRecord(outputDiscriminator?.mapping);
    if (mapping && outputMapping) {
      Object.entries(mapping).forEach(([name, target]) => {
        if (typeof target !== 'string' || !COMPONENT_NAME.test(target)) return;
        const targetLocation = this.location(
          location.ownerRetrievalUri,
          appendPointer('#', 'components', 'schemas', target),
        );
        if (targetLocation) outputMapping[name] = this.ensureSchemaLocation(targetLocation) ?? target;
      });
    }
    return output;
  }
}

/**
 * Build a portable OAS 3.1 single-operation document from one immutable graph
 * generation. The builder is synchronous and never owns a loader or fetch path.
 */
export function buildOas31OperationOpenApiDocument(
  swaggerDoc: SwaggerDoc,
  path: string,
  method: string,
  sourceKind: SourceKind,
  context: Oas31OperationExportContext,
): Oas31OperationExportResult | null {
  const source = asRecord(swaggerDoc);
  if (!source || !isOpenApi31Version(source.openapi) || !asRecord(source.info)) return null;
  return new Oas31OperationBundler(source, context).build(path, method, sourceKind);
}
