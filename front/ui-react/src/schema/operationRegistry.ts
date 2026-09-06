import { stableSerializeJson } from '../utils/stableJson';
import {
  enumerateOpenApiOperations,
  resolveLocalJsonPointer,
  type OpenApiObjectLocation,
  type OpenApiOperation,
  type OperationReferenceKind,
  type OperationSchemaDocuments,
} from 'knife4j-core';
import { ExternalResourceLoader, type ResourceGraphSnapshot } from './externalResourceGraph';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';

type RecordValue = Record<string, unknown>;

/** Reads an already resolved target from C's immutable graph. Never resolves aliases or fetches. */
export function resolveOperationReference(
  snapshot: ResourceGraphSnapshot,
  location: OpenApiObjectLocation,
  kind: OperationReferenceKind | 'operation',
): OpenApiObjectLocation | null {
  const member = kind === 'operation' ? 'operationRef' : '$ref';
  const edge = snapshot.edges.find(
    (candidate) =>
      candidate.sourceRetrievalUri === location.ownerRetrievalUri &&
      candidate.sourcePointer === `${location.pointer}/${member}` &&
      candidate.kind ===
        (kind === 'pathItem' ? 'path-item-ref' : kind === 'operation' ? 'link-operation-ref' : 'reference-object'),
  );
  const target = edge?.target;
  if (!target || (edge.state !== 'local' && edge.state !== 'loaded')) return null;
  const targetKind = kind === 'pathItem' ? 'path-item' : kind === 'requestBody' ? 'request-body' : kind;
  if (
    !snapshot.objectLocations.some(
      (object) =>
        object.ownerRetrievalUri === target.ownerRetrievalUri &&
        object.pointer === target.pointer &&
        object.kind === targetKind,
    )
  )
    return null;
  const document = snapshot.nodes.get(target.ownerRetrievalUri)?.document;
  const value = resolveLocalJsonPointer(document, target.pointer);
  return value.found ? { ...target, value: value.value } : null;
}

export function enumerateRegistryOperations(
  document: SwaggerDoc,
  retrievalUri = 'https://knife4j.invalid/openapi.json',
  snapshot?: ResourceGraphSnapshot,
): { operations: OpenApiOperation[]; snapshot: ResourceGraphSnapshot } {
  // Same graph as the asynchronous resource UI, with no grants and no network capability used here.
  const graph = snapshot ?? new ExternalResourceLoader(document, retrievalUri).currentSnapshot();
  const entry = graph.nodes.get(graph.entryRetrievalUri)?.document;
  if (!entry || stableSerializeJson(entry) !== stableSerializeJson(document))
    return { snapshot: graph, operations: [] };
  return {
    snapshot: graph,
    operations: enumerateOpenApiOperations(entry as RecordValue, {
      retrievalUri: graph.entryRetrievalUri,
      resolveReference: (location, kind) => resolveOperationReference(graph, location, kind),
    }),
  };
}

export function operationOwnerDocument(document: SwaggerDoc, operation: MenuOperation): SwaggerDoc {
  if (!operation.identity || !operation.resourceSnapshot) return document;
  return (operation.resourceSnapshot.nodes.get(operation.identity.ownerRetrievalUri)?.document ??
    document) as SwaggerDoc;
}

// Each projected member retains the physical owner resolved by C, including Reference Objects.
export function operationSchemaDocuments(document: SwaggerDoc, operation: MenuOperation): OperationSchemaDocuments {
  const owner = operationOwnerDocument(document, operation);
  const documentFor = (location?: OpenApiObjectLocation): RecordValue =>
    ((location && operation.resourceSnapshot?.nodes.get(location.ownerRetrievalUri)?.document) ?? owner) as RecordValue;
  return {
    operation: owner as unknown as RecordValue,
    parameters: new Map(
      Object.entries(operation.identity?.parameterLocations ?? {}).map(([key, location]) => [
        key,
        documentFor(location),
      ]),
    ),
    requestBody: documentFor(operation.identity?.requestBodyLocation),
    responses: new Map(
      Object.entries(operation.identity?.responseLocations ?? {}).map(([key, location]) => [
        key,
        documentFor(location),
      ]),
    ),
  };
}

export type OperationLinkResolution =
  { status: 'resolved'; operation: MenuOperation } | { status: 'missing' | 'ambiguous' | 'unavailable' };

/** Links use the same mounted operation identities as menus. Repeated tag membership is not ambiguity. */
export function resolveOperationLink(
  operations: readonly MenuOperation[],
  link: OpenApiObjectLocation,
  snapshot?: ResourceGraphSnapshot,
): OperationLinkResolution {
  const value = link.value as { operationId?: unknown; operationRef?: unknown } | null;
  if (!value || typeof value !== 'object') return { status: 'missing' };
  const distinct = [
    ...new Map(operations.map((operation) => [operation.identity?.identity ?? operation.key, operation])).values(),
  ];
  let matches: MenuOperation[];
  if (typeof value.operationRef === 'string') {
    if (!snapshot) return { status: 'unavailable' };
    const target = resolveOperationReference(snapshot, link, 'operation');
    if (!target) return { status: 'unavailable' };
    matches = distinct.filter(
      (operation) =>
        operation.identity?.ownerRetrievalUri === target.ownerRetrievalUri &&
        operation.identity.operationPointer === target.pointer,
    );
  } else if (typeof value.operationId === 'string') {
    matches = distinct.filter((operation) => operation.operationId === value.operationId);
  } else return { status: 'missing' };
  // A component definition and its one executable mount describe the same target.
  const mounted = matches.filter((operation) => operation.source !== 'component');
  if (mounted.length) matches = mounted;
  return matches.length === 1
    ? { status: 'resolved', operation: matches[0] }
    : { status: matches.length ? 'ambiguous' : 'missing' };
}

export function operationResponseLinks(
  operation: MenuOperation,
): Array<{ name: string; location: OpenApiObjectLocation }> {
  if (!operation.identity || !operation.resourceSnapshot) return [];
  const snapshot = operation.resourceSnapshot;
  const follow = (initial: OpenApiObjectLocation, kind: 'response' | 'link'): OpenApiObjectLocation | null => {
    let location = initial;
    const seen = new Set<string>();
    for (let depth = 0; depth <= 20; depth++) {
      if (!location.value || typeof location.value !== 'object' || Array.isArray(location.value)) return null;
      if (typeof (location.value as RecordValue).$ref !== 'string') return location;
      const key = JSON.stringify([location.ownerRetrievalUri, location.pointer]);
      if (seen.has(key)) return null;
      seen.add(key);
      const target = resolveOperationReference(snapshot, location, kind);
      if (!target) return null;
      location = target;
    }
    return null;
  };
  const raw = operation.identity.rawOperation;
  const responses = (raw.value as RecordValue).responses;
  if (!responses || typeof responses !== 'object' || Array.isArray(responses)) return [];
  const result: Array<{ name: string; location: OpenApiObjectLocation }> = [];
  const child = (location: OpenApiObjectLocation, key: string, value: unknown): OpenApiObjectLocation => ({
    value,
    ownerRetrievalUri: location.ownerRetrievalUri,
    pointer: `${location.pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
  });
  for (const [status, value] of Object.entries(responses)) {
    if (status.startsWith('x-')) continue;
    const response = follow(child(child(raw, 'responses', responses), status, value), 'response');
    const links = response && (response.value as RecordValue).links;
    if (!response || !links || typeof links !== 'object' || Array.isArray(links)) continue;
    for (const [name, value] of Object.entries(links)) {
      const site = child(child(response, 'links', links), name, value);
      result.push({ name: `${status} / ${name}`, location: follow(site, 'link') ?? site });
    }
  }
  return result;
}
