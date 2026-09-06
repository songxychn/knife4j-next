import { getOpenApiSpecificationFeatures, physicalJsonPointerTokens, resolvePhysicalJsonPointer } from 'knife4j-core';
import type { SchemaNode } from 'knife4j-schema-engine';
import { isUriReference, parseUri } from 'knife4j-schema-engine/uri';
import type { ResourceGraphObject, ResourceGraphSnapshot } from './externalResourceGraph';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import { stableSerializeJson } from '../utils/stableJson';

export type Oas32XmlNodeType = 'element' | 'attribute' | 'text' | 'cdata' | 'none';
export interface Oas32XmlSchemaLocation {
  readonly ownerRetrievalUri: string;
  /** C's physical JSON Pointer (not a URI fragment with percent-encoded tokens). */
  readonly pointer: string;
}
export interface Oas32XmlLimits {
  readonly maxDepth: number;
  /** Combined logical-data, Schema and emitted-node visits. */
  readonly maxNodes: number;
  readonly maxReferences: number;
  readonly maxOutputBytes: number;
}
/** Callers may lower these ceilings, but cannot remove the hard bounds. */
export const OAS32_XML_LIMITS: Readonly<Oas32XmlLimits> = Object.freeze({
  maxDepth: 32,
  maxNodes: 4096,
  maxReferences: 256,
  maxOutputBytes: 256 * 1024,
});
/** Old versions must keep their existing path before creating a 3.2 resource context. */
export function isOas32XmlVersion(version: unknown): boolean {
  return getOpenApiSpecificationFeatures(version)?.family === '3.2';
}
export interface Oas32XmlSerializationOptions {
  readonly snapshot: ResourceGraphSnapshot;
  readonly session: Pick<SchemaDocumentSession, 'resolve'>;
  readonly schemaLocation: Oas32XmlSchemaLocation;
  /** Deliberately separate from G's serialized text/externalValue. This function never parses either. */
  readonly data: { readonly kind: 'known'; readonly value: unknown; readonly source: 'author' | 'candidate' };
  /** Optional, explicit outermost-first Schema evaluation path, already registered in C/D. */
  readonly dynamicScope?: readonly Oas32XmlSchemaLocation[];
  readonly limits?: Partial<Oas32XmlLimits>;
  readonly signal?: AbortSignal;
}
export type Oas32XmlDiagnosticCode =
  | 'VERSION_NOT_APPLICABLE'
  | 'KNOWN_DATA_REQUIRED'
  | 'SCHEMA_UNAVAILABLE'
  | 'SCHEMA_CONTEXT_MISMATCH'
  | 'REFERENCE_UNAVAILABLE'
  | 'REFERENCE_CYCLE'
  | 'AMBIGUOUS_MAPPING'
  | 'UNSUPPORTED_MAPPING'
  | 'UNMAPPED_DATA'
  | 'INVALID_DATA'
  | 'INVALID_XML_DECLARATION'
  | 'UNKNOWN_XML_DECLARATION'
  | 'NAME_REQUIRED'
  | 'INVALID_XML_NAME'
  | 'INVALID_XML_CHARACTER'
  | 'INVALID_NAMESPACE_IRI'
  | 'RESERVED_NAMESPACE'
  | 'UNBOUND_PREFIX'
  | 'NAMESPACE_CONFLICT'
  | 'NAMESPACE_REBOUND'
  | 'ATTRIBUTE_NAMESPACE_REQUIRES_PREFIX'
  | 'DUPLICATE_ATTRIBUTE'
  | 'ATTRIBUTE_WITHOUT_ELEMENT'
  | 'COMPLEX_TEXT_VALUE'
  | 'ROUND_TRIP_AMBIGUOUS'
  | 'XML_FRAGMENT'
  | 'BUDGET_EXCEEDED'
  | 'CANCELLED';
export interface Oas32XmlDiagnostic {
  readonly code: Oas32XmlDiagnosticCode;
  readonly severity: 'error' | 'info';
  readonly message: string;
  readonly schemaLocation?: Oas32XmlSchemaLocation;
  readonly instanceLocation?: string;
}
export interface Oas32XmlProvenance {
  readonly schemaLocation: Oas32XmlSchemaLocation;
  readonly instanceLocation: string;
  readonly requestedUri: string;
  readonly canonicalUri: string;
  readonly resourceUri: string;
  /** The original registered object, including reference siblings; never a merged projection. */
  readonly rawSchema: SchemaNode['schema'];
  readonly nodeType: Oas32XmlNodeType;
  readonly nodeTypeSource: 'explicit' | 'legacy' | 'reference-default' | 'array-default' | 'element-default';
  readonly nameSource?: 'xml.name' | 'component' | 'property' | 'property-items';
  readonly nameLocation?: Oas32XmlSchemaLocation;
  readonly referenceTarget?: Oas32XmlSchemaLocation;
}
export interface Oas32XmlName {
  readonly localName: string;
  readonly prefix: string;
  readonly namespace: string;
  readonly qualifiedName: string;
}
export interface Oas32XmlAttribute {
  readonly name: Oas32XmlName;
  readonly value: string;
  readonly provenance: Oas32XmlProvenance;
}
export type Oas32XmlNode =
  | {
      readonly type: 'element';
      readonly name: Oas32XmlName;
      readonly attributes: readonly Oas32XmlAttribute[];
      readonly namespaces: Readonly<Record<string, string>>;
      readonly children: readonly Oas32XmlNode[];
      readonly provenance: Oas32XmlProvenance;
    }
  | { readonly type: 'text' | 'cdata'; readonly value: string; readonly provenance: Oas32XmlProvenance };
interface ResultDetails {
  readonly diagnostics: readonly Oas32XmlDiagnostic[];
  readonly provenance: readonly Oas32XmlProvenance[];
  readonly usage: Readonly<{ nodes: number; references: number; outputBytes: number }>;
  readonly limits: Readonly<Oas32XmlLimits>;
}
export type Oas32XmlSerializationResult = ResultDetails &
  (
    | {
        readonly status: 'document' | 'fragment';
        readonly xml: string;
        readonly nodes: readonly Oas32XmlNode[];
        readonly dataSource: 'author' | 'candidate';
        /** No decoder is promised. Known collisions are distinguished from an unverified inverse. */
        readonly roundTrip: 'unverified' | 'ambiguous';
        readonly objectOrder: 'lexicographic-property-name';
      }
    | { readonly status: 'unavailable' | 'not-applicable' }
  );

type RecordValue = Record<string, unknown>;
interface NamePlan {
  localName: string;
  prefix: string;
  namespace?: string;
}
interface PlannedAttribute {
  name: NamePlan;
  value: string;
  provenance: Oas32XmlProvenance;
}
type PlannedNode =
  | {
      type: 'element';
      name: NamePlan;
      attributes: PlannedAttribute[];
      children: PlannedNode[];
      provenance: Oas32XmlProvenance;
    }
  | { type: 'text' | 'cdata'; value: string; provenance: Oas32XmlProvenance };
interface Content {
  nodes: PlannedNode[];
  attributes: PlannedAttribute[];
}
interface Site {
  location: ResourceGraphObject;
  node: SchemaNode;
  schema: RecordValue;
}
interface Context {
  options: Oas32XmlSerializationOptions;
  limits: Oas32XmlLimits;
  usage: { nodes: number; references: number; outputBytes: number };
  diagnostics: Oas32XmlDiagnostic[];
  provenance: Oas32XmlProvenance[];
  sites: Map<string, Promise<Site>>;
  locations: Map<string, ResourceGraphObject>;
}
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
const has = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : undefined;
const locationKey = (location: Oas32XmlSchemaLocation): string =>
  JSON.stringify([location.ownerRetrievalUri, location.pointer]);
const pointerChild = (pointer: string, token: string): string =>
  `${pointer}/${token.replace(/~/g, '~0').replace(/\//g, '~1')}`;
const at = (site: Site, ...tokens: string[]): Oas32XmlSchemaLocation => ({
  ownerRetrievalUri: site.location.ownerRetrievalUri,
  pointer: tokens.reduce(pointerChild, site.location.pointer),
});
const physicalReference = (location: Oas32XmlSchemaLocation): string =>
  `${location.ownerRetrievalUri}#${location.pointer.slice(1).split('/').map(encodeURIComponent).join('/')}`;

class SerializationStopped extends Error {}
function fail(
  ctx: Context,
  code: Oas32XmlDiagnosticCode,
  message: string,
  location?: Oas32XmlSchemaLocation,
  instanceLocation?: string,
): never {
  ctx.diagnostics.push({ code, severity: 'error', message, schemaLocation: location, instanceLocation });
  throw new SerializationStopped(message);
}
function info(ctx: Context, code: Oas32XmlDiagnosticCode, message: string, source?: Oas32XmlProvenance): void {
  ctx.diagnostics.push({
    code,
    severity: 'info',
    message,
    schemaLocation: source?.schemaLocation,
    instanceLocation: source?.instanceLocation,
  });
}
function check(ctx: Context): void {
  if (ctx.options.signal?.aborted) fail(ctx, 'CANCELLED', 'XML serialization was cancelled.');
}
function visit(ctx: Context, depth: number): void {
  check(ctx);
  if (++ctx.usage.nodes > ctx.limits.maxNodes || depth > ctx.limits.maxDepth)
    fail(ctx, 'BUDGET_EXCEEDED', 'XML node or depth budget exceeded.');
}
function limitsFor(overrides?: Partial<Oas32XmlLimits>): Oas32XmlLimits {
  const limit = (key: keyof Oas32XmlLimits): number => {
    const value = overrides?.[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(OAS32_XML_LIMITS[key], Math.floor(value)))
      : OAS32_XML_LIMITS[key];
  };
  return {
    maxDepth: limit('maxDepth'),
    maxNodes: limit('maxNodes'),
    maxReferences: limit('maxReferences'),
    maxOutputBytes: limit('maxOutputBytes'),
  };
}
async function cancellable<T>(ctx: Context, promise: Promise<T>): Promise<T> {
  check(ctx);
  const signal = ctx.options.signal;
  if (!signal) return promise;
  let abort: () => void = () => undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () => reject(new SerializationStopped('cancelled'));
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
    check(ctx);
  }
}

function boundedString(ctx: Context, value: string): void {
  check(ctx);
  if (value.length > ctx.limits.maxOutputBytes) fail(ctx, 'BUDGET_EXCEEDED', 'XML string exceeds the output budget.');
}
// XML 1.0 Fifth Edition §2.2. Unpaired UTF-16 surrogates are rejected, never replaced.
function xmlCharacters(ctx: Context, value: string, source?: Oas32XmlProvenance): void {
  boundedString(ctx, value);
  for (const character of value) {
    const cp = character.codePointAt(0)!;
    if (!(
      cp === 9 ||
      cp === 10 ||
      cp === 13 ||
      (cp >= 0x20 && cp <= 0xd7ff) ||
      (cp >= 0xe000 && cp <= 0xfffd) ||
      (cp >= 0x10000 && cp <= 0x10ffff)
    ))
      fail(
        ctx,
        'INVALID_XML_CHARACTER',
        `Invalid XML 1.0 character U+${cp.toString(16).toUpperCase()}.`,
        source?.schemaLocation,
        source?.instanceLocation,
      );
  }
}
function inspectData(ctx: Context, value: unknown, depth = 0, active = new Set<object>()): void {
  visit(ctx, depth);
  if (typeof value === 'string') return boundedString(ctx, value);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return;
    fail(ctx, 'INVALID_DATA', 'XML numeric data must be finite and use safely representable JSON numbers.');
  }
  if (!value || typeof value !== 'object')
    fail(ctx, 'INVALID_DATA', 'XML input must be known JSON-compatible logical data.');
  if (active.has(value)) fail(ctx, 'INVALID_DATA', 'Cyclic logical data cannot be serialized.');
  const prototype = Object.getPrototypeOf(value);
  if (
    (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length
  )
    fail(ctx, 'INVALID_DATA', 'Non-JSON objects cannot be serialized.');
  active.add(value);
  if (Array.isArray(value)) {
    if (value.length > ctx.limits.maxNodes) fail(ctx, 'BUDGET_EXCEEDED', 'XML logical array exceeds the node budget.');
    if (Object.keys(value).length !== value.length)
      fail(ctx, 'INVALID_DATA', 'Sparse or annotated arrays are not JSON data.');
    for (let index = 0; index < value.length; index++) {
      const property = Object.getOwnPropertyDescriptor(value, String(index));
      if (!property || !has(property, 'value'))
        fail(ctx, 'INVALID_DATA', 'Sparse or accessor arrays are not JSON data.');
      inspectData(ctx, property.value, depth + 1, active);
    }
  } else {
    for (const key of Object.keys(value)) {
      boundedString(ctx, key);
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (!has(property, 'value')) fail(ctx, 'INVALID_DATA', 'Accessor properties are not logical JSON data.');
      inspectData(ctx, property.value, depth + 1, active);
    }
  }
  active.delete(value);
}

async function siteFor(ctx: Context, location: Oas32XmlSchemaLocation): Promise<Site> {
  const key = locationKey(location);
  const known = ctx.locations.get(key);
  if (!known) fail(ctx, 'SCHEMA_UNAVAILABLE', 'The location is not a registered Schema position.', location);
  let pending = ctx.sites.get(key);
  if (!pending) {
    pending = (async () => {
      let node: SchemaNode;
      try {
        node = await cancellable(ctx, ctx.options.session.resolve(physicalReference(known)));
      } catch (error) {
        if (error instanceof SerializationStopped) throw error;
        fail(ctx, 'SCHEMA_UNAVAILABLE', 'The registered Schema session cannot resolve this location.', known);
      }
      const raw = resolvePhysicalJsonPointer(
        ctx.options.snapshot.nodes.get(known.ownerRetrievalUri)?.document,
        known.pointer,
      );
      if (!raw.found || stableSerializeJson(raw.value) !== stableSerializeJson(node.schema))
        fail(
          ctx,
          'SCHEMA_CONTEXT_MISMATCH',
          'The Schema session and resource snapshot do not describe the same raw Schema.',
          known,
        );
      const schema = record(node.schema);
      if (!schema)
        fail(ctx, 'UNSUPPORTED_MAPPING', 'This phase does not implement XML node mapping for boolean Schemas.', known);
      return { location: known, node, schema };
    })();
    ctx.sites.set(key, pending);
  }
  return pending;
}

function inferredName(
  ctx: Context,
  site: Site,
): Pick<Oas32XmlProvenance, 'nameSource' | 'nameLocation'> & { name?: string } {
  const tokens = physicalJsonPointerTokens(site.location.pointer);
  if (!tokens) return {};
  const document = ctx.options.snapshot.nodes.get(site.location.ownerRetrievalUri);
  if (
    document?.documentKind === 'openapi' &&
    tokens.length === 3 &&
    tokens[0] === 'components' &&
    tokens[1] === 'schemas'
  )
    return { name: tokens[2], nameSource: 'component', nameLocation: site.location };
  const remaining = [...tokens];
  let item = false;
  while (remaining.length) {
    if (remaining[remaining.length - 1] === 'items') remaining.pop();
    else if (
      remaining[remaining.length - 2] === 'prefixItems' &&
      /^(0|[1-9]\d*)$/.test(remaining[remaining.length - 1])
    )
      remaining.splice(-2);
    else break;
    item = true;
    const parent = { ownerRetrievalUri: site.location.ownerRetrievalUri, pointer: remaining.reduce(pointerChild, '#') };
    if (!ctx.locations.has(locationKey(parent))) return {};
  }
  if (remaining.length >= 2 && remaining[remaining.length - 2] === 'properties') {
    const parent = {
      ownerRetrievalUri: site.location.ownerRetrievalUri,
      pointer: remaining.slice(0, -2).reduce(pointerChild, '#'),
    };
    if (ctx.locations.has(locationKey(parent)))
      return {
        name: remaining[remaining.length - 1],
        nameSource: item ? 'property-items' : 'property',
        nameLocation: { ...parent, pointer: remaining.reduce(pointerChild, '#') },
      };
  }
  return {};
}

// XML 1.0 §2.3 NameStartChar/NameChar minus ':' (Namespaces §4 NCName).
const NCNAME =
  // eslint-disable-next-line no-misleading-character-class -- Exact XML 1.0 NameChar production includes combining marks.
  /^[A-Z_a-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}][A-Z_a-z\-.0-9\u00b7\u0300-\u036f\u203f-\u2040\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}]*$/u;
function ncname(value: string): boolean {
  return !value.includes('\n') && NCNAME.test(value);
}
// RFC 3987 §2.2: map only ucschar (and query-only iprivate) for syntax checking.
// Keep the original IRI as the namespace identity; no URL base/normalization/fetch.
function namespaceIri(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;
  let query = false;
  let fragment = false;
  let ascii = '';
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    if (cp <= 0x20 || (cp >= 0x7f && cp <= 0x9f)) return false;
    if (char === '#') {
      fragment = true;
      query = false;
    }
    if (char === '?' && !fragment) query = true;
    if (cp < 0x80) {
      ascii += char;
      continue;
    }
    const ucs =
      (cp >= 0xa0 && cp <= 0xd7ff) ||
      (cp >= 0xf900 && cp <= 0xfdcf) ||
      (cp >= 0xfdf0 && cp <= 0xffef) ||
      (cp >= 0x10000 && cp <= 0xdfffd && (cp & 0xffff) <= 0xfffd) ||
      (cp >= 0xe1000 && cp <= 0xefffd);
    const privateCharacter =
      (cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0xffffd) || (cp >= 0x100000 && cp <= 0x10fffd);
    if (!ucs && !(query && privateCharacter)) return false;
    ascii += encodeURIComponent(char);
  }
  return isUriReference(ascii);
}
function declaration(ctx: Context, site: Site, path: string): { provenance: Oas32XmlProvenance; name?: NamePlan } {
  const xml = has(site.schema, 'xml') ? record(site.schema.xml) : {};
  if (!xml) fail(ctx, 'INVALID_XML_DECLARATION', 'xml must be an XML Object.', site.location, path);
  const allowed = ['nodeType', 'name', 'namespace', 'prefix', 'attribute', 'wrapped'];
  for (const key of Object.keys(xml)) {
    if (!allowed.includes(key) && !key.startsWith('x-'))
      fail(ctx, 'UNKNOWN_XML_DECLARATION', 'Unknown XML Object field.', site.location, path);
    if (key.startsWith('x-')) continue;
    const type = key === 'attribute' || key === 'wrapped' ? 'boolean' : 'string';
    if (typeof xml[key] !== type)
      fail(ctx, 'INVALID_XML_DECLARATION', `xml.${key} must be ${type}.`, site.location, path);
  }
  if (has(xml, 'nodeType') && (has(xml, 'attribute') || has(xml, 'wrapped')))
    fail(
      ctx,
      'INVALID_XML_DECLARATION',
      'nodeType is mutually exclusive with attribute and wrapped, even when false.',
      site.location,
      path,
    );
  if (has(xml, 'wrapped') && site.schema.type !== 'array')
    fail(ctx, 'INVALID_XML_DECLARATION', 'wrapped is only defined alongside type: array.', site.location, path);
  if (xml.attribute === true && xml.wrapped === true)
    fail(ctx, 'AMBIGUOUS_MAPPING', 'An array cannot be both an attribute and a wrapping element.', site.location, path);
  const referenced = has(site.schema, '$ref') || has(site.schema, '$dynamicRef');
  const array = site.schema.type === 'array';
  const nodeType = (xml.nodeType ??
    (xml.attribute === true
      ? 'attribute'
      : xml.wrapped === true
        ? 'element'
        : referenced || array
          ? 'none'
          : 'element')) as Oas32XmlNodeType;
  if (!['element', 'attribute', 'text', 'cdata', 'none'].includes(nodeType))
    fail(ctx, 'INVALID_XML_DECLARATION', 'Unknown XML nodeType.', site.location, path);
  const provenance: Oas32XmlProvenance = {
    schemaLocation: { ownerRetrievalUri: site.location.ownerRetrievalUri, pointer: site.location.pointer },
    instanceLocation: path,
    requestedUri: site.node.requestedUri,
    canonicalUri: site.node.canonicalUri,
    resourceUri: site.node.resourceUri,
    rawSchema: site.node.schema,
    nodeType,
    nodeTypeSource: has(xml, 'nodeType')
      ? 'explicit'
      : xml.attribute === true || xml.wrapped === true
        ? 'legacy'
        : referenced
          ? 'reference-default'
          : array
            ? 'array-default'
            : 'element-default',
  };
  if (typeof xml.namespace === 'string') {
    xmlCharacters(ctx, xml.namespace, provenance);
    if (!namespaceIri(xml.namespace))
      fail(ctx, 'INVALID_NAMESPACE_IRI', 'namespace must be a non-relative IRI.', site.location, path);
  }
  if (typeof xml.prefix === 'string' && !ncname(xml.prefix))
    fail(ctx, 'INVALID_XML_NAME', 'prefix must be an XML NCName.', site.location, path);
  // OAS 3.2 §4.26.1 requires name to be ignored for these node types.
  if (nodeType !== 'element' && nodeType !== 'attribute') return { provenance };
  const inferred = inferredName(ctx, site);
  const name = has(xml, 'name') ? (xml.name as string) : inferred.name;
  if (name === undefined)
    fail(ctx, 'NAME_REQUIRED', 'No XML name can be inferred at this Schema location.', site.location, path);
  xmlCharacters(ctx, name, provenance);
  const parts = name.split(':');
  if (parts.length > 2 || parts.some((part) => !ncname(part)))
    fail(ctx, 'INVALID_XML_NAME', 'name must be an XML QName with valid NCName parts.', site.location, path);
  const embeddedPrefix = parts.length === 2 ? parts[0] : undefined;
  if (embeddedPrefix && has(xml, 'prefix') && embeddedPrefix !== xml.prefix)
    fail(ctx, 'INVALID_XML_NAME', 'The QName prefix and xml.prefix disagree.', site.location, path);
  return {
    provenance: {
      ...provenance,
      nameSource: has(xml, 'name') ? 'xml.name' : inferred.nameSource,
      nameLocation: has(xml, 'name') ? site.location : inferred.nameLocation,
    },
    name: {
      localName: parts[parts.length - 1],
      prefix: (xml.prefix as string | undefined) ?? embeddedPrefix ?? '',
      namespace: xml.namespace as string | undefined,
    },
  };
}

async function referenceTarget(ctx: Context, site: Site, scope: readonly Site[]): Promise<Site | undefined> {
  const keys = ['$ref', '$dynamicRef'].filter((key) => has(site.schema, key));
  if (keys.length === 0) return undefined;
  if (keys.length !== 1)
    fail(ctx, 'AMBIGUOUS_MAPPING', 'Multiple reference mappings need an explicit XML composition.', site.location);
  if (++ctx.usage.references > ctx.limits.maxReferences)
    fail(ctx, 'BUDGET_EXCEEDED', 'XML reference budget exceeded.', site.location);
  const keyword = keys[0];
  if (typeof site.schema[keyword] !== 'string')
    fail(ctx, 'REFERENCE_UNAVAILABLE', 'The reference is not a string.', site.location);
  const edges = ctx.options.snapshot.edges.filter(
    (edge) =>
      edge.sourceRetrievalUri === site.location.ownerRetrievalUri &&
      edge.sourcePointer === `${site.location.pointer}/${keyword}` &&
      edge.kind === (keyword === '$ref' ? 'schema-ref' : 'schema-dynamic-ref'),
  );
  if (edges.length !== 1 || !edges[0].target || !['local', 'loaded'].includes(edges[0].state))
    fail(ctx, 'REFERENCE_UNAVAILABLE', 'No unique, already resolved C reference target is available.', site.location);
  const edge = edges[0];
  let target = await siteFor(ctx, edge.target!);
  if (keyword === '$dynamicRef') {
    let anchor: string;
    try {
      anchor = decodeURIComponent(parseUri(edge.resolvedUri).fragment ?? '');
    } catch {
      fail(ctx, 'REFERENCE_UNAVAILABLE', 'The registered dynamic reference has no usable fragment.', site.location);
    }
    // The static target must declare the dynamic anchor. A same-named anchor elsewhere is not enough.
    if (anchor && !anchor.startsWith('/') && target.schema.$dynamicAnchor === anchor) {
      for (const outer of scope) {
        if (!has(outer.node.dynamicAnchors, anchor)) continue;
        // C carries the exact physical anchor target; D proves it belongs to this scope resource.
        const registered = ctx.options.snapshot.anchorTargets.get(
          `${outer.node.resourceUri}#${encodeURIComponent(anchor)}`,
        );
        if (!registered)
          fail(ctx, 'REFERENCE_UNAVAILABLE', 'The dynamic scope anchor is not registered in C.', outer.location);
        target = await siteFor(ctx, registered);
        if (target.node.resourceUri !== outer.node.resourceUri || target.schema.$dynamicAnchor !== anchor)
          fail(ctx, 'SCHEMA_CONTEXT_MISMATCH', 'C and D disagree on the dynamic scope anchor.', registered);
        break;
      }
    }
  }
  return target;
}
function scalar(ctx: Context, value: unknown, provenance: Oas32XmlProvenance): string {
  if (typeof value === 'object' && value !== null)
    fail(
      ctx,
      'COMPLEX_TEXT_VALUE',
      'Objects and arrays cannot be implicitly converted to XML text.',
      provenance.schemaLocation,
      provenance.instanceLocation,
    );
  const text = value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined)
    fail(
      ctx,
      'INVALID_DATA',
      'The value has no JSON scalar text.',
      provenance.schemaLocation,
      provenance.instanceLocation,
    );
  xmlCharacters(ctx, text, provenance);
  if (value === null || Object.is(value, -0))
    info(ctx, 'ROUND_TRIP_AMBIGUOUS', 'This scalar text does not preserve a unique logical value.', provenance);
  return text;
}

async function plan(
  ctx: Context,
  location: Oas32XmlSchemaLocation,
  value: unknown,
  path: string,
  depth: number,
  scope: readonly Site[],
  active: ReadonlySet<string>,
): Promise<Content> {
  visit(ctx, depth);
  const site = await siteFor(ctx, location);
  const cycle = JSON.stringify([locationKey(site.location), path]);
  if (active.has(cycle))
    fail(ctx, 'REFERENCE_CYCLE', 'The Schema reference cycle does not descend into logical data.', location, path);
  const chain = new Set(active).add(cycle);
  const currentScope = scope.some((entry) => entry.node.resourceUri === site.node.resourceUri)
    ? scope
    : [...scope, site];
  const declared = declaration(ctx, site, path);
  const target = await referenceTarget(ctx, site, currentScope);
  const provenance: Oas32XmlProvenance = target
    ? { ...declared.provenance, referenceTarget: target.location }
    : declared.provenance;
  ctx.provenance.push(provenance);
  const type = provenance.nodeType;
  const composition = ['allOf', 'anyOf', 'oneOf', 'if', 'then', 'else', 'dependentSchemas'].filter((key) =>
    has(site.schema, key),
  );
  if (composition.length)
    fail(
      ctx,
      'UNSUPPORTED_MAPPING',
      'Composition/conditional XML traversal is not implemented by this isolated helper; this is not a Schema validity error.',
      location,
      path,
    );
  if (
    target &&
    ['properties', 'items', 'prefixItems', 'additionalProperties', 'patternProperties'].some((key) =>
      has(site.schema, key),
    )
  )
    fail(
      ctx,
      'AMBIGUOUS_MAPPING',
      'This phase cannot assign reference and local content mappings without potentially duplicating or omitting data.',
      location,
      path,
    );
  if (type === 'attribute' || type === 'text' || type === 'cdata') {
    if (target)
      fail(
        ctx,
        'UNSUPPORTED_MAPPING',
        'A text/attribute node cannot contain the node of a referenced Schema.',
        location,
        path,
      );
    if (type === 'attribute' && value === null) {
      info(
        ctx,
        'ROUND_TRIP_AMBIGUOUS',
        'An omitted null attribute and an absent property have the same XML form.',
        provenance,
      );
      return { nodes: [], attributes: [] };
    }
    const text = scalar(ctx, value, provenance);
    visit(ctx, depth);
    return type === 'attribute'
      ? { nodes: [], attributes: [{ name: declared.name!, value: text, provenance }] }
      : { nodes: [{ type, value: text, provenance }], attributes: [] };
  }
  const content: Content = { nodes: [], attributes: [] };
  const append = (child: Content) => {
    content.nodes.push(...child.nodes);
    content.attributes.push(...child.attributes);
  };
  if (target) {
    append(await plan(ctx, target.location, value, path, depth + 1, currentScope, chain));
  } else if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const prefix = Array.isArray(site.schema.prefixItems) && index < site.schema.prefixItems.length;
      const child = prefix ? at(site, 'prefixItems', String(index)) : at(site, 'items');
      if (!ctx.locations.has(locationKey(child)))
        fail(
          ctx,
          'UNMAPPED_DATA',
          'An array item has no registered XML Schema mapping.',
          location,
          pointerChild(path, String(index)),
        );
      append(await plan(ctx, child, value[index], pointerChild(path, String(index)), depth + 1, currentScope, chain));
    }
    if (type === 'none' && value.length === 0)
      info(ctx, 'ROUND_TRIP_AMBIGUOUS', 'An empty unwrapped array has no XML node.', provenance);
    if (type === 'none' && value.some(Array.isArray))
      info(
        ctx,
        'ROUND_TRIP_AMBIGUOUS',
        'Transparent nested arrays do not preserve array group boundaries.',
        provenance,
      );
  } else if (record(value)) {
    // Deliberate stable implementation order. OAS does not specify object content order.
    for (const key of Object.keys(value as RecordValue).sort()) {
      let child = at(site, 'properties', key);
      if (!ctx.locations.has(locationKey(child))) child = at(site, 'additionalProperties');
      if (!ctx.locations.has(locationKey(child)))
        fail(
          ctx,
          'UNMAPPED_DATA',
          'A logical property has no registered XML Schema mapping.',
          location,
          pointerChild(path, key),
        );
      if (has(site.schema, 'patternProperties'))
        fail(
          ctx,
          'UNSUPPORTED_MAPPING',
          'Overlapping pattern-property XML mappings are not inferred.',
          location,
          pointerChild(path, key),
        );
      append(
        await plan(ctx, child, (value as RecordValue)[key], pointerChild(path, key), depth + 1, currentScope, chain),
      );
    }
    if (type === 'none' && Object.keys(value as RecordValue).length === 0)
      info(ctx, 'ROUND_TRIP_AMBIGUOUS', 'An empty transparent object has no XML node.', provenance);
  } else if (type === 'none') {
    fail(
      ctx,
      'UNMAPPED_DATA',
      'A none node needs a real child Schema mapping; its scalar data cannot be discarded.',
      location,
      path,
    );
  } else if (value !== null) {
    visit(ctx, depth + 1);
    content.nodes.push({ type: 'text', value: scalar(ctx, value, provenance), provenance });
  }
  if (type === 'none') return content;
  if (value === null) {
    if (content.nodes.length || content.attributes.length)
      fail(ctx, 'AMBIGUOUS_MAPPING', 'A nil element cannot also contain referenced XML content.', location, path);
    visit(ctx, depth + 1);
    content.attributes.push({
      name: { localName: 'nil', prefix: 'xsi', namespace: XSI_NS },
      value: 'true',
      provenance,
    });
  }
  visit(ctx, depth);
  return {
    nodes: [
      { type: 'element', name: declared.name!, attributes: content.attributes, children: content.nodes, provenance },
    ],
    attributes: [],
  };
}

function bindNodes(
  ctx: Context,
  planned: readonly PlannedNode[],
  inherited: ReadonlyMap<string, string>,
  depth = 0,
): Oas32XmlNode[] {
  const output: Oas32XmlNode[] = [];
  let previousText = false;
  const names = new Map<string, string>();
  for (const item of planned) {
    check(ctx);
    if (item.type !== 'element') {
      if (previousText)
        info(
          ctx,
          'ROUND_TRIP_AMBIGUOUS',
          'Adjacent text/CDATA boundaries cannot be uniquely reconstructed from XML character content.',
          item.provenance,
        );
      previousText = true;
      output.push(item);
      continue;
    }
    previousText = false;
    const scope = new Map(inherited);
    const declarations = new Map<string, string>();
    const used = new Map<string, string>();
    const bind = (name: NamePlan, attribute: boolean, source: Oas32XmlProvenance): Oas32XmlName => {
      const { localName, prefix } = name;
      if (
        prefix === 'xmlns' ||
        (attribute && !prefix && localName === 'xmlns') ||
        name.namespace === XMLNS_NS ||
        (prefix === 'xml' && name.namespace !== undefined && name.namespace !== XML_NS) ||
        (name.namespace === XML_NS && prefix !== 'xml')
      )
        fail(
          ctx,
          'RESERVED_NAMESPACE',
          'The xml/xmlns namespace binding is reserved.',
          source.schemaLocation,
          source.instanceLocation,
        );
      if (attribute && !prefix && name.namespace !== undefined)
        fail(
          ctx,
          'ATTRIBUTE_NAMESPACE_REQUIRES_PREFIX',
          'A default namespace cannot qualify an unprefixed attribute.',
          source.schemaLocation,
          source.instanceLocation,
        );
      let namespace = attribute && !prefix ? '' : (name.namespace ?? scope.get(prefix) ?? '');
      if (prefix === 'xml') namespace = XML_NS;
      if (prefix && !namespace)
        fail(
          ctx,
          'UNBOUND_PREFIX',
          'The XML prefix has no in-scope namespace binding.',
          source.schemaLocation,
          source.instanceLocation,
        );
      if (!(attribute && !prefix)) {
        if (used.has(prefix) && used.get(prefix) !== namespace)
          fail(
            ctx,
            'NAMESPACE_CONFLICT',
            'One element requires conflicting bindings for the same prefix.',
            source.schemaLocation,
            source.instanceLocation,
          );
        used.set(prefix, namespace);
        if ((scope.get(prefix) ?? '') !== namespace) {
          if (scope.has(prefix))
            info(ctx, 'NAMESPACE_REBOUND', 'The namespace prefix is rebound on this descendant element.', source);
          declarations.set(prefix, namespace);
          scope.set(prefix, namespace);
        }
      }
      return { localName, prefix, namespace, qualifiedName: prefix ? `${prefix}:${localName}` : localName };
    };
    const name = bind(item.name, false, item.provenance);
    // Explicit declarations precede prefix-only attributes, independently of property ordering.
    const bound = new Map<PlannedAttribute, Oas32XmlName>();
    for (const attribute of item.attributes.filter((attribute) => attribute.name.namespace !== undefined))
      bound.set(attribute, bind(attribute.name, true, attribute.provenance));
    const expanded = new Set<string>();
    const attributes = item.attributes.map((attribute): Oas32XmlAttribute => {
      const name = bound.get(attribute) ?? bind(attribute.name, true, attribute.provenance);
      const key = JSON.stringify([name.namespace, name.localName]);
      if (expanded.has(key))
        fail(
          ctx,
          'DUPLICATE_ATTRIBUTE',
          'Two attributes have the same expanded XML name.',
          attribute.provenance.schemaLocation,
          attribute.provenance.instanceLocation,
        );
      expanded.add(key);
      return { ...attribute, name };
    });
    const key = JSON.stringify([name.namespace, name.localName]);
    const owner =
      item.provenance.nameSource === 'property-items'
        ? item.provenance.instanceLocation.replace(/\/\d+$/, '')
        : item.provenance.instanceLocation;
    if (names.has(key) && names.get(key) !== owner)
      info(
        ctx,
        'ROUND_TRIP_AMBIGUOUS',
        'Different logical properties produce the same expanded element name.',
        item.provenance,
      );
    names.set(key, owner);
    declarations.forEach(() => visit(ctx, depth));
    output.push({
      type: 'element',
      name,
      attributes,
      namespaces: Object.fromEntries(declarations),
      children: bindNodes(ctx, item.children, scope, depth + 1),
      provenance: item.provenance,
    });
  }
  return output;
}
const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
const escapeAttribute = (value: string): string =>
  escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\n/g, '&#xA;').replace(/\t/g, '&#x9;');
function writeXml(ctx: Context, nodes: readonly Oas32XmlNode[]): string {
  const chunks: string[] = [];
  const encoder = new TextEncoder();
  const append = (text: string) => {
    check(ctx);
    ctx.usage.outputBytes += encoder.encode(text).byteLength;
    if (ctx.usage.outputBytes > ctx.limits.maxOutputBytes)
      fail(ctx, 'BUDGET_EXCEEDED', 'XML UTF-8 output byte budget exceeded.');
    chunks.push(text);
  };
  const write = (node: Oas32XmlNode) => {
    if (node.type !== 'element') {
      if (node.type === 'text') return append(escapeText(node.value));
      return append(`<![CDATA[${node.value.replace(/]]>/g, ']]]]><![CDATA[>').replace(/\r/g, ']]>&#xD;<![CDATA[')}]]>`);
    }
    append(`<${node.name.qualifiedName}`);
    for (const [prefix, namespace] of Object.entries(node.namespaces))
      append(` xmlns${prefix ? `:${prefix}` : ''}="${escapeAttribute(namespace)}"`);
    for (const attribute of node.attributes)
      append(` ${attribute.name.qualifiedName}="${escapeAttribute(attribute.value)}"`);
    if (node.children.length === 0) return append('/>');
    append('>');
    node.children.forEach(write);
    append(`</${node.name.qualifiedName}>`);
  };
  nodes.forEach(write);
  return chunks.join('');
}

/**
 * OAS 3.2 §4.26, XML 1.0 Fifth Edition, Namespaces in XML 1.0.
 * Explicit opt-in serializer of known data; no Schema validation/branch guessing,
 * decoder, loader, DTD/entity processing, author-text formatting or shared UI changes.
 */
export async function serializeOas32Xml(options: Oas32XmlSerializationOptions): Promise<Oas32XmlSerializationResult> {
  const ctx: Context = {
    options,
    limits: limitsFor(options.limits),
    usage: { nodes: 0, references: 0, outputBytes: 0 },
    diagnostics: [],
    provenance: [],
    sites: new Map(),
    locations: new Map(),
  };
  const details = (): ResultDetails => ({
    diagnostics: ctx.diagnostics,
    provenance: ctx.provenance,
    usage: { ...ctx.usage },
    limits: ctx.limits,
  });
  const entry = options.snapshot.nodes.get(options.snapshot.entryRetrievalUri);
  if (!isOas32XmlVersion(entry?.openApiVersion ?? record(entry?.document)?.openapi)) {
    info(ctx, 'VERSION_NOT_APPLICABLE', 'This XML helper applies only to OpenAPI 3.2.x.');
    return { status: 'not-applicable', ...details() };
  }
  if (options.data?.kind !== 'known' || !has(options.data, 'value')) {
    info(
      ctx,
      'KNOWN_DATA_REQUIRED',
      'Explicit known logical data is required; serialized XML and external examples stay with their existing consumer.',
    );
    return { status: 'not-applicable', ...details() };
  }
  try {
    check(ctx);
    for (const location of options.snapshot.objectLocations) {
      if (location.kind !== 'schema') continue;
      const key = locationKey(location);
      if (ctx.locations.has(key))
        fail(ctx, 'SCHEMA_CONTEXT_MISMATCH', 'The Schema location is multiply registered.', location);
      ctx.locations.set(key, location);
    }
    inspectData(ctx, options.data.value);
    const scope: Site[] = [];
    for (const location of options.dynamicScope ?? []) {
      visit(ctx, scope.length);
      const site = await siteFor(ctx, location);
      if (!scope.some((entry) => entry.node.resourceUri === site.node.resourceUri)) scope.push(site);
    }
    const planned = await plan(ctx, options.schemaLocation, options.data.value, '#', 0, scope, new Set());
    if (planned.attributes.length)
      fail(
        ctx,
        'ATTRIBUTE_WITHOUT_ELEMENT',
        'An XML attribute requires an actual parent element; no wrapper is invented.',
        planned.attributes[0].provenance.schemaLocation,
      );
    const nodes = bindNodes(ctx, planned.nodes, new Map([['xml', XML_NS]]));
    const xml = writeXml(ctx, nodes);
    const document = nodes.length === 1 && nodes[0].type === 'element';
    if (!document) info(ctx, 'XML_FRAGMENT', 'The result is an XML fragment, not a complete XML media document.');
    return {
      status: document ? 'document' : 'fragment',
      xml,
      nodes,
      dataSource: options.data.source,
      objectOrder: 'lexicographic-property-name',
      roundTrip: ctx.diagnostics.some((diagnostic) => diagnostic.code === 'ROUND_TRIP_AMBIGUOUS')
        ? 'ambiguous'
        : 'unverified',
      ...details(),
    };
  } catch (error) {
    if (!(error instanceof SerializationStopped))
      ctx.diagnostics.push({
        code: 'SCHEMA_UNAVAILABLE',
        severity: 'error',
        message: 'XML serialization could not read its registered context.',
      });
    return { status: 'unavailable', ...details() };
  }
}
