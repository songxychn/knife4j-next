import type { Oas31DocumentDiagnostic } from './openapi31/diagnostics';
import type { Oas32DocumentDiagnostic } from './openapi32/diagnostics';
import {
  escapeJsonPointerSegment,
  inferDirectComponentReferenceTargetKind,
  resolveLocalJsonPointer,
  projectPathItemOperation,
} from './openapi31/document';
import { getOpenApiSpecificationFeatures, OPENAPI_HTTP_METHODS } from './openapiVersion';

export type OpenApiDocumentDiagnostic = Oas31DocumentDiagnostic | (Oas32DocumentDiagnostic & { value?: string });

type RecordValue = Record<string, unknown>;
export type OpenApiOperationSource = 'path' | 'webhook' | 'callback' | 'component';
export type OperationReferenceKind =
  'pathItem' | 'callback' | 'parameter' | 'requestBody' | 'response' | 'header' | 'link';

export interface OpenApiObjectLocation {
  readonly value: unknown;
  readonly pointer: string;
  readonly ownerRetrievalUri: string;
}

export interface OpenApiOperation {
  /** Includes the mount site as well as the physical owner; tags are not identity. */
  readonly identity: string;
  readonly documentUri: string;
  readonly source: OpenApiOperationSource;
  readonly path: string;
  /** The actual HTTP method: fixed fields are uppercased, additional keys are verbatim. */
  readonly method: string;
  readonly methodSource: 'fixed' | 'additional';
  readonly methodField: string;
  readonly operationPointer: string;
  readonly pathItemPointer: string;
  readonly ownerRetrievalUri: string;
  readonly mountPointer: string;
  readonly operation: RecordValue;
  readonly rawOperation: OpenApiObjectLocation;
  readonly pathItem: RecordValue;
  readonly pathItemMembers: Readonly<Record<string, OpenApiObjectLocation>>;
  readonly parameterLocations: Readonly<Record<string, OpenApiObjectLocation>>;
  readonly requestBodyLocation?: OpenApiObjectLocation;
  readonly responseLocations: Readonly<Record<string, OpenApiObjectLocation>>;
}

export interface OperationSchemaDocuments {
  readonly operation: RecordValue;
  readonly parameters: ReadonlyMap<string, RecordValue>;
  readonly requestBody: RecordValue;
  readonly responses: ReadonlyMap<string, RecordValue>;
}

export interface EnumerateOpenApiOperationsOptions {
  readonly retrievalUri?: string;
  /** A registry-only resolver. It receives the reference site, not a guessed URI. */
  readonly resolveReference?: (
    location: OpenApiObjectLocation,
    kind: OperationReferenceKind,
  ) => OpenApiObjectLocation | null;
}

export const HTTP_METHOD_TOKEN = /^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/;

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function child(location: OpenApiObjectLocation, key: string, value: unknown): OpenApiObjectLocation {
  return {
    value,
    ownerRetrievalUri: location.ownerRetrievalUri,
    pointer: `${location.pointer}/${escapeJsonPointerSegment(key)}`,
  };
}

/** Semantic positions only: never scans examples, extensions, or unknown payloads. */
export function enumerateOpenApiOperations(
  document: RecordValue,
  options: EnumerateOpenApiOperationsOptions = {},
): OpenApiOperation[] {
  const features = getOpenApiSpecificationFeatures(document.openapi);
  const methods = features?.standardHttpMethods ?? OPENAPI_HTTP_METHODS;
  const uses32 = features?.family === '3.2';
  const reserved = new Set(methods.map((method) => method.toUpperCase()));
  const documentUri = options.retrievalUri ?? '';
  const root: OpenApiObjectLocation = { value: document, pointer: '#', ownerRetrievalUri: documentUri };
  const result: OpenApiOperation[] = [];
  const resolve =
    options.resolveReference ??
    ((location, kind) => {
      if (!record(location.value) || typeof location.value.$ref !== 'string') return null;
      const ref = location.value.$ref;
      const targetKind = inferDirectComponentReferenceTargetKind(ref);
      if (targetKind && targetKind !== kind) return null;
      const target = resolveLocalJsonPointer(document, ref);
      return target.found
        ? {
            value: target.value,
            pointer: target.tokens?.length ? `#/${target.tokens.map(escapeJsonPointerSegment).join('/')}` : '#',
            ownerRetrievalUri: documentUri,
          }
        : null;
    });
  const dereference = (location: OpenApiObjectLocation, kind: OperationReferenceKind): OpenApiObjectLocation | null => {
    const seen = new Set<string>();
    let current = location;
    for (let depth = 0; depth <= 20; depth++) {
      if (!record(current.value)) return null;
      if (typeof current.value.$ref !== 'string') return current;
      const key = JSON.stringify([current.ownerRetrievalUri, current.pointer]);
      if (seen.has(key)) return null;
      seen.add(key);
      const next = resolve(current, kind);
      if (!next) return null;
      current = next;
    }
    return null;
  };
  const fieldsForPathItem = (
    location: OpenApiObjectLocation,
    seen = new Set<string>(),
  ): Record<string, OpenApiObjectLocation> | null => {
    if (!record(location.value) || seen.size > 20) return null;
    const key = JSON.stringify([location.ownerRetrievalUri, location.pointer]);
    if (seen.has(key)) return null;
    const own = Object.fromEntries(
      Object.entries(location.value)
        .filter(([name]) => name !== '$ref')
        .map(([name, value]) => [name, child(location, name, value)]),
    );
    if (typeof location.value.$ref !== 'string') return own;
    const target = resolve(location, 'pathItem');
    if (!target) return null;
    const inherited = fieldsForPathItem(target, new Set([...Array.from(seen), key]));
    // OAS leaves overlapping Path Item fields undefined. Never invent a merge policy.
    if (!inherited || Object.keys(own).some((name) => Object.prototype.hasOwnProperty.call(inherited, name)))
      return null;
    return { ...inherited, ...own };
  };
  const projectReference = (location: OpenApiObjectLocation, kind: OperationReferenceKind): unknown => {
    const resolved = dereference(location, kind);
    if (!resolved || !record(resolved.value)) return undefined;
    const value = { ...resolved.value };
    if (record(location.value) && typeof location.value.$ref === 'string') {
      for (const name of ['summary', 'description']) {
        if (typeof location.value[name] === 'string') value[name] = location.value[name];
      }
    }
    if (kind === 'response') {
      for (const [name, targetKind] of [
        ['headers', 'header'],
        ['links', 'link'],
      ] as const) {
        if (record(value[name]))
          value[name] = Object.fromEntries(
            Object.entries(value[name] as RecordValue).map(([key, entry]) => [
              key,
              projectReference(child(child(resolved, name, value[name]), key, entry), targetKind) ?? {},
            ]),
          );
      }
    }
    return value;
  };
  const visitPathItem = (
    location: OpenApiObjectLocation,
    path: string,
    source: OpenApiOperationSource,
    mountPointer: string,
    ancestry: ReadonlySet<string>,
  ): void => {
    const visitKey = JSON.stringify([location.ownerRetrievalUri, location.pointer]);
    if (ancestry.has(visitKey) || ancestry.size > 32) return;
    const fields = fieldsForPathItem(location);
    if (!fields) return;
    const pathItem = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value]));
    const entries: Array<{ field: string; source: 'fixed' | 'additional'; location: OpenApiObjectLocation }> = [];
    for (const method of methods)
      if (fields[method]) entries.push({ field: method, source: 'fixed', location: fields[method] });
    const additional = fields.additionalOperations;
    if (uses32 && additional && record(additional.value)) {
      for (const [method, value] of Object.entries(additional.value)) {
        if (HTTP_METHOD_TOKEN.test(method) && !reserved.has(method))
          entries.push({ field: method, source: 'additional', location: child(additional, method, value) });
      }
    }
    for (const entry of entries) {
      if (!record(entry.location.value)) continue;
      const raw = entry.location.value;
      const projectedRaw = { ...raw };
      const parameterLocations: Record<string, OpenApiObjectLocation> = {};
      const responseLocations: Record<string, OpenApiObjectLocation> = {};
      const projectParameters = (parameterLocation: OpenApiObjectLocation | undefined): unknown[] =>
        parameterLocation && Array.isArray(parameterLocation.value)
          ? parameterLocation.value.flatMap((value, index) => {
              const site = child(parameterLocation, String(index), value);
              const projected = projectReference(site, 'parameter');
              const target = dereference(site, 'parameter');
              if (record(projected) && typeof projected.in === 'string' && typeof projected.name === 'string' && target)
                parameterLocations[`${projected.in}:${projected.name}`] = target;
              return projected ? [projected] : [];
            })
          : [];
      const projectedPathItem = { ...pathItem, parameters: projectParameters(fields.parameters) };
      if (Array.isArray(raw.parameters))
        projectedRaw.parameters = projectParameters(child(entry.location, 'parameters', raw.parameters));
      const requestBodyLocation = record(raw.requestBody)
        ? (dereference(child(entry.location, 'requestBody', raw.requestBody), 'requestBody') ?? undefined)
        : undefined;
      if (record(raw.requestBody))
        projectedRaw.requestBody = projectReference(
          child(entry.location, 'requestBody', raw.requestBody),
          'requestBody',
        );
      if (record(raw.responses))
        projectedRaw.responses = Object.fromEntries(
          Object.entries(raw.responses)
            .filter(([key]) => !key.startsWith('x-'))
            .map(([key, value]) => {
              const site = child(child(entry.location, 'responses', raw.responses), key, value);
              const target = dereference(site, 'response');
              if (target) responseLocations[key] = target;
              return [key, projectReference(site, 'response') ?? {}];
            }),
        );
      const operation = projectPathItemOperation(projectedPathItem, projectedRaw, document).operation;
      const method = entry.source === 'fixed' ? entry.field.toUpperCase() : entry.field;
      const descriptor: OpenApiOperation = {
        identity: JSON.stringify([
          documentUri,
          source,
          mountPointer,
          entry.source,
          entry.field,
          entry.location.ownerRetrievalUri,
          entry.location.pointer,
        ]),
        documentUri,
        source,
        path,
        method,
        methodSource: entry.source,
        methodField: entry.field,
        operationPointer: entry.location.pointer,
        pathItemPointer: entry.location.pointer.slice(
          0,
          entry.location.pointer.lastIndexOf(entry.source === 'additional' ? '/additionalOperations/' : '/'),
        ),
        ownerRetrievalUri: entry.location.ownerRetrievalUri,
        mountPointer,
        operation,
        rawOperation: entry.location,
        pathItem,
        pathItemMembers: fields,
        parameterLocations,
        requestBodyLocation,
        responseLocations,
      };
      result.push(descriptor);
      if (record(raw.callbacks))
        for (const [name, callback] of Object.entries(raw.callbacks)) {
          const callbackLocation = child(child(entry.location, 'callbacks', raw.callbacks), name, callback);
          visitCallback(
            callbackLocation,
            `${mountPointer}/${entry.source === 'additional' ? 'additionalOperations/' : ''}${escapeJsonPointerSegment(entry.field)}/callbacks/${escapeJsonPointerSegment(name)}`,
            new Set([...Array.from(ancestry), visitKey]),
          );
        }
    }
  };
  const visitCallback = (
    location: OpenApiObjectLocation,
    mountPointer: string,
    ancestry: ReadonlySet<string>,
    source: OpenApiOperationSource = 'callback',
  ): void => {
    const resolved = dereference(location, 'callback');
    if (!resolved || !record(resolved.value)) return;
    for (const [expression, pathItem] of Object.entries(resolved.value)) {
      if (!expression.startsWith('x-'))
        visitPathItem(
          child(resolved, expression, pathItem),
          expression,
          source,
          `${mountPointer}/${escapeJsonPointerSegment(expression)}`,
          ancestry,
        );
    }
  };
  for (const [collection, source] of [
    ['paths', 'path'],
    ['webhooks', 'webhook'],
  ] as const) {
    if (!record(document[collection])) continue;
    for (const [path, pathItem] of Object.entries(document[collection] as RecordValue)) {
      if (collection === 'paths' && !path.startsWith('/')) continue;
      const location = child(child(root, collection, document[collection]), path, pathItem);
      visitPathItem(location, path, source, location.pointer, new Set());
    }
  }
  if (record(document.components)) {
    const components = child(root, 'components', document.components);
    if (record(document.components.pathItems))
      for (const [name, pathItem] of Object.entries(document.components.pathItems)) {
        const location = child(child(components, 'pathItems', document.components.pathItems), name, pathItem);
        visitPathItem(location, name, 'component', location.pointer, new Set());
      }
    if (record(document.components.callbacks))
      for (const [name, callback] of Object.entries(document.components.callbacks)) {
        const location = child(child(components, 'callbacks', document.components.callbacks), name, callback);
        visitCallback(location, location.pointer, new Set(), 'component');
      }
  }
  return result;
}

/** Preserve custom spelling while keeping the historic fixed-field display convention. */
export function operationHttpMethod(operation: { method: string; identity?: OpenApiOperation }): string {
  return operation.identity?.method ?? operation.method.toUpperCase();
}
