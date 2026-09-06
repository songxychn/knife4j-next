import {
  analyzeOas31Parameter,
  exampleHasOwn,
  getOpenApiSpecificationFeatures,
  interpretExampleObject,
  isExampleData,
  isJsonMediaType,
  parameterKey,
  resolvePhysicalJsonPointer,
  type BodyContent,
  type DebugParam,
  type ExampleLayer,
  type ExampleRepresentation,
  type ExampleRepresentationContext,
  type OpenApiObjectLocation,
  type OperationDebugModel,
} from 'knife4j-core';
import type { JsonValue } from 'knife4j-schema-engine';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import type { ResourceGraphSnapshot } from './externalResourceGraph';
import { asOpenApiRecord as record } from './openApiDocumentPointer';
import { enumerateRegistryOperations } from './operationRegistry';
import {
  explicitSchemaExampleWithoutSchema,
  generateSchemaExample,
  type SchemaExampleDirection,
  type SchemaExampleResult,
  type SchemaExampleSearchLimits,
} from './schemaExampleGeneration';
import type { SchemaDocumentSession } from './schemaDocumentSession';

export interface OperationExampleTarget {
  readonly id: string;
  readonly group: string;
  readonly name: string;
  readonly summary?: string;
  readonly description?: string;
  readonly operationIdentity: string;
  readonly generation: number;
  readonly direction: SchemaExampleDirection;
  readonly layer: ExampleLayer;
  readonly mediaType?: string;
  readonly statusCode?: string;
  readonly parameterKey?: string;
  readonly sourceLocation: OpenApiObjectLocation;
  readonly containerLocation: OpenApiObjectLocation;
  readonly mediaLocation?: OpenApiObjectLocation;
  readonly schemaLocation?: OpenApiObjectLocation;
  readonly schemaReference?: string;
  readonly itemSchemaLocation?: OpenApiObjectLocation;
  readonly source?: Record<string, unknown>;
  readonly unavailable?: true;
  readonly context: ExampleRepresentationContext;
}
export interface OperationExampleCatalog {
  readonly targets: readonly OperationExampleTarget[];
  readonly parameters: ReadonlyMap<string, DebugParam>;
  readonly bodies: readonly BodyContent[];
  readonly generation: number;
}
export interface OperationExampleResult {
  readonly target: OperationExampleTarget;
  readonly representation: ExampleRepresentation;
  readonly schemaResult?: SchemaExampleResult;
  readonly serializedSchemaResult?: SchemaExampleResult;
  readonly session?: SchemaDocumentSession;
  readonly authored: boolean;
}

const child = (parent: OpenApiObjectLocation, name: string, value: unknown): OpenApiObjectLocation => ({
  ownerRetrievalUri: parent.ownerRetrievalUri,
  pointer: `${parent.pointer}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`,
  value,
});
const reference = (location: OpenApiObjectLocation): string =>
  `${location.ownerRetrievalUri}#${location.pointer.slice(1).split('/').map(encodeURIComponent).join('/')}`;

/** Follow only the exact typed edges C has already resolved, never reconstruct a URI from display text. */
function follow(
  snapshot: ResourceGraphSnapshot,
  initial: OpenApiObjectLocation,
  kind: string,
): OpenApiObjectLocation | undefined {
  let location = initial;
  const seen = new Set<string>();
  let summary: string | undefined;
  let description: string | undefined;
  for (let depth = 0; depth <= 20; depth++) {
    const value = record(location.value);
    if (!value) return undefined;
    if (typeof value.$ref !== 'string')
      return {
        ...location,
        value: {
          ...value,
          ...(summary === undefined ? {} : { summary }),
          ...(description === undefined ? {} : { description }),
        },
      };
    if (typeof value.summary === 'string' && kind === 'example') summary ??= value.summary;
    if (typeof value.description === 'string') description ??= value.description;
    const key = JSON.stringify([location.ownerRetrievalUri, location.pointer]);
    if (seen.has(key)) return undefined;
    seen.add(key);
    const edge = snapshot.edges.find(
      (edge) =>
        edge.kind === 'reference-object' &&
        edge.sourceRetrievalUri === location.ownerRetrievalUri &&
        edge.sourcePointer === `${location.pointer}/$ref`,
    );
    const target = edge?.target;
    if (
      !target ||
      !['local', 'loaded'].includes(edge.state) ||
      !snapshot.objectLocations.some(
        (object) =>
          object.kind === kind &&
          object.ownerRetrievalUri === target.ownerRetrievalUri &&
          object.pointer === target.pointer,
      )
    )
      return undefined;
    const resolved = resolvePhysicalJsonPointer(snapshot.nodes.get(target.ownerRetrievalUri)?.document, target.pointer);
    if (!resolved.found) return undefined;
    location = { ...target, value: resolved.value };
  }
  return undefined;
}

export function isOas32ExampleDocument(document: SwaggerDoc | null): document is SwaggerDoc {
  return getOpenApiSpecificationFeatures(document?.openapi)?.family === '3.2';
}

/** Complete author catalog, synchronously available to docs/debug and later exports. No fetch capability. */
export function locateOperationExampleCatalog(document: SwaggerDoc, operation: MenuOperation): OperationExampleCatalog {
  const empty: OperationExampleCatalog = { targets: [], parameters: new Map(), bodies: [], generation: 0 };
  if (!isOas32ExampleDocument(document)) return empty;
  const enumerated = operation.identity && operation.resourceSnapshot ? null : enumerateRegistryOperations(document);
  const identity =
    operation.identity ??
    enumerated?.operations.find(
      (candidate) => candidate.path === operation.path && candidate.method === operation.method,
    );
  const snapshot = operation.resourceSnapshot ?? enumerated?.snapshot;
  if (!identity || !snapshot) return empty;
  const targets: OperationExampleTarget[] = [];
  const parameters = new Map<string, DebugParam>();
  const bodies: BodyContent[] = [];
  const operationIdentity = identity.identity;
  type TargetContext = Pick<
    OperationExampleTarget,
    | 'group'
    | 'direction'
    | 'layer'
    | 'mediaType'
    | 'statusCode'
    | 'parameterKey'
    | 'mediaLocation'
    | 'schemaLocation'
    | 'itemSchemaLocation'
    | 'context'
  >;

  const add = (container: OpenApiObjectLocation, details: TargetContext) => {
    const value = record(container.value);
    if (!value) return;
    const append = (name: string, site: OpenApiObjectLocation, source?: Record<string, unknown>, actual = site) => {
      targets.push({
        ...details,
        name,
        operationIdentity,
        generation: snapshot.generation,
        id: JSON.stringify([operationIdentity, details.group, details.layer, site.ownerRetrievalUri, site.pointer]),
        sourceLocation: actual,
        containerLocation: container,
        ...(typeof source?.summary === 'string' ? { summary: source.summary } : {}),
        ...(typeof source?.description === 'string' ? { description: source.description } : {}),
        ...(details.schemaLocation ? { schemaReference: reference(details.schemaLocation) } : {}),
        ...(source ? { source } : { unavailable: true as const }),
        context: {
          ...details.context,
          documentBaseUri: snapshot.nodes.get(actual.ownerRetrievalUri)?.documentBaseUri ?? actual.ownerRetrievalUri,
        },
      });
    };
    if (exampleHasOwn(value, 'example'))
      append('example', child(container, 'example', value.example), { value: value.example });
    for (const [name, raw] of Object.entries(record(value.examples) ?? {})) {
      const site = child(child(container, 'examples', value.examples), name, raw);
      const actual = follow(snapshot, site, 'example');
      append(name, site, actual ? (record(actual.value) ?? undefined) : undefined, actual);
    }
  };
  const schemaAt = (container: OpenApiObjectLocation) =>
    exampleHasOwn(container.value as object, 'schema')
      ? child(container, 'schema', (container.value as Record<string, unknown>).schema)
      : undefined;
  const mediaList = (container: OpenApiObjectLocation) =>
    Object.entries(record(record(container.value)?.content) ?? {}).map(([mediaType, value]) => {
      const site = child(child(container, 'content', record(container.value)?.content), mediaType, value);
      return { mediaType, site, media: follow(snapshot, site, 'media-type') };
    });
  const fallback = (container: OpenApiObjectLocation, details: TargetContext) => {
    targets.push({
      ...details,
      id: JSON.stringify([operationIdentity, details.group, 'candidate']),
      name: 'candidate',
      operationIdentity,
      generation: snapshot.generation,
      sourceLocation: container,
      containerLocation: container,
      ...(details.schemaLocation ? { schemaReference: reference(details.schemaLocation) } : {}),
    });
  };
  const parameter = (
    location: OpenApiObjectLocation,
    key: string,
    direction: SchemaExampleDirection,
    statusCode?: string,
  ) => {
    const value = record(location.value);
    if (!value) return;
    const header = direction === 'response';
    const inValue = header ? 'header' : value.in;
    if (!['path', 'query', 'header', 'cookie'].includes(String(inValue))) return;
    const name = header ? key : String(value.name ?? '');
    const media = mediaList(location)[0];
    const codecValue = media?.media
      ? { ...value, name, content: { [media.mediaType]: media.media.value } }
      : { ...value, name };
    const analysis = analyzeOas31Parameter(
      codecValue as Parameters<typeof analyzeOas31Parameter>[0],
      inValue as DebugParam['in'],
      snapshot.nodes.get(location.ownerRetrievalUri)?.document as Record<string, unknown>,
      8,
    );
    const schema = record(analysis.schema);
    const type = Array.isArray(schema?.type) ? schema.type.find((type) => type !== 'null') : schema?.type;
    const param: DebugParam = {
      name,
      in: inValue as DebugParam['in'],
      required: value.required === true,
      type: typeof type === 'string' ? type : 'string',
      schema: analysis.schema,
      parameterSerialization: analysis.serialization,
      description: typeof value.description === 'string' ? value.description : undefined,
    };
    if (!header) parameters.set(parameterKey(param), param);
    const group = header ? `response:${statusCode}:header:${name}` : `parameter:${parameterKey(param)}`;
    const schemaLocation = media?.media ? schemaAt(media.media) : schemaAt(location);
    const details: TargetContext = {
      group,
      direction,
      layer: header ? 'header' : 'parameter',
      parameterKey: header ? undefined : parameterKey(param),
      statusCode,
      mediaType: media?.mediaType,
      mediaLocation: media?.media,
      schemaLocation,
      context: { layer: header ? 'header' : 'parameter', parameter: param, mediaType: media?.mediaType },
    };
    add(location, details);
    if (media?.media) add(media.media, { ...details, layer: 'media', context: { ...details.context, layer: 'media' } });
    else if (media)
      targets.push({
        ...details,
        id: JSON.stringify([operationIdentity, group, 'unavailable']),
        name: 'unavailable',
        operationIdentity,
        generation: snapshot.generation,
        sourceLocation: media.site,
        containerLocation: location,
        unavailable: true,
      });
    if (schemaLocation) fallback(location, details);
  };
  for (const [key, location] of Object.entries(identity.parameterLocations)) parameter(location, key, 'request');
  const content = (location: OpenApiObjectLocation, direction: SchemaExampleDirection, statusCode?: string) => {
    for (const { mediaType, site, media } of mediaList(location)) {
      const value = record(media?.value);
      const schema = record(value?.schema) ?? undefined;
      const essence = mediaType.split(';', 1)[0].trim().toLowerCase();
      const bodyContent: BodyContent = {
        mediaType,
        category: isJsonMediaType(mediaType)
          ? 'json'
          : essence === 'application/x-www-form-urlencoded'
            ? 'urlencoded'
            : essence.startsWith('multipart/')
              ? 'multipart'
              : 'raw',
        schema,
        binary:
          essence === 'application/octet-stream' ||
          /^(image|audio|video)\//.test(essence) ||
          schema?.format === 'binary' ||
          undefined,
      };
      if (direction === 'request') bodies.push(bodyContent);
      const group = direction === 'request' ? `body:${mediaType}` : `response:${statusCode}:${mediaType}`;
      const details: TargetContext = {
        group,
        direction,
        statusCode,
        mediaType,
        layer: 'media',
        mediaLocation: media ?? site,
        schemaLocation: media ? schemaAt(media) : undefined,
        itemSchemaLocation:
          media && value && exampleHasOwn(value, 'itemSchema')
            ? child(media, 'itemSchema', value.itemSchema)
            : undefined,
        context: { layer: 'media', mediaType, bodyContent, encoding: record(value?.encoding) ?? undefined },
      };
      if (media) {
        add(media, details);
        if (details.schemaLocation) fallback(media, details);
      } else
        targets.push({
          ...details,
          id: JSON.stringify([operationIdentity, group, 'unavailable']),
          name: 'unavailable',
          operationIdentity,
          generation: snapshot.generation,
          sourceLocation: site,
          containerLocation: location,
          unavailable: true,
        });
    }
  };
  if (identity.requestBodyLocation) content(identity.requestBodyLocation, 'request');
  for (const [statusCode, response] of Object.entries(identity.responseLocations)) {
    content(response, 'response', statusCode);
    for (const [name, value] of Object.entries(record(record(response.value)?.headers) ?? {})) {
      const header = follow(
        snapshot,
        child(child(response, 'headers', record(response.value)?.headers), name, value),
        'header',
      );
      if (header) parameter(header, name, 'response', statusCode);
      else {
        const site = child(child(response, 'headers', record(response.value)?.headers), name, value);
        const group = `response:${statusCode}:header:${name}`;
        targets.push({
          id: JSON.stringify([operationIdentity, group, 'unavailable']),
          name,
          operationIdentity,
          generation: snapshot.generation,
          group,
          direction: 'response',
          layer: 'header',
          statusCode,
          sourceLocation: site,
          containerLocation: response,
          unavailable: true,
          context: { layer: 'header' },
        });
      }
    }
  }
  return { targets, parameters, bodies, generation: snapshot.generation };
}

export function exampleDefaultTarget(targets: readonly OperationExampleTarget[]): OperationExampleTarget | undefined {
  for (const layer of ['parameter', 'header', 'media']) {
    const entries = targets.filter((target) => target.layer === layer);
    const author =
      entries.find(
        (target) =>
          target.source &&
          ['dataValue', 'serializedValue', 'value'].some((field) => exampleHasOwn(target.source!, field)),
      ) ??
      entries.find((target) => target.source && exampleHasOwn(target.source, 'externalValue')) ??
      entries.find((target) => target.unavailable);
    if (author) return author;
  }
  return targets.find((target) => !target.source) ?? targets[0];
}

export function exampleDebugModel(model: OperationDebugModel, catalog: OperationExampleCatalog): OperationDebugModel {
  const update = (params: readonly DebugParam[]) =>
    params.map((param) => {
      const located = catalog.parameters.get(parameterKey(param));
      return located ? { ...param, ...located, example: undefined, default: undefined } : param;
    });
  return {
    ...model,
    pathParams: update(model.pathParams),
    queryParams: update(model.queryParams),
    headerParams: update(model.headerParams),
    cookieParams: update(model.cookieParams),
    bodyContents: [...catalog.bodies],
  };
}

const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Example selection was cancelled.', 'AbortError');
};
export async function evaluateOperationExample(
  target: OperationExampleTarget,
  session?: SchemaDocumentSession,
  options: { signal?: AbortSignal; limits?: SchemaExampleSearchLimits } = {},
): Promise<OperationExampleResult> {
  abort(options.signal);
  let context = target.context;
  if (session && target.schemaReference) {
    try {
      const schema = (await session.resolve(target.schemaReference)).schema;
      const resolved = record(schema);
      if (resolved)
        context = {
          ...context,
          ...(context.parameter ? { parameter: { ...context.parameter, schema: resolved } } : {}),
          ...(context.bodyContent ? { bodyContent: { ...context.bodyContent, schema: resolved } } : {}),
        };
    } catch {
      /* Author text remains visible when a Schema resource is unavailable. */
    }
  }
  abort(options.signal);
  let schemaResult: SchemaExampleResult | undefined;
  let representation = interpretExampleObject(target.source ?? {}, context);
  if (target.unavailable)
    representation = {
      ...representation,
      serialization: 'unavailable',
      diagnostics: [{ phase: 'structure', code: 'EXAMPLE_REFERENCE_UNAVAILABLE' }],
    };
  const data = representation.data;
  if (data !== undefined || (!target.source && !target.unavailable)) {
    const explicit = data === undefined ? [] : [{ source: 'example-object' as const, value: data as JsonValue }];
    if (session && target.schemaReference) {
      schemaResult = await generateSchemaExample(session, target.schemaReference, {
        direction: target.direction,
        explicit,
        signal: options.signal,
        limits: options.limits,
      });
    } else if (explicit[0]) schemaResult = explicitSchemaExampleWithoutSchema(explicit[0]);
    else schemaResult = { status: 'none', reason: 'schema-unavailable', diagnostics: [{ code: 'SCHEMA_UNAVAILABLE' }] };
    if (!target.source && schemaResult.status === 'value' && isExampleData(schemaResult.value))
      representation = interpretExampleObject({ dataValue: schemaResult.value }, context);
  }
  abort(options.signal);
  let serializedSchemaResult: SchemaExampleResult | undefined;
  if (
    representation.serialized !== undefined &&
    representation.decodedData !== undefined &&
    session &&
    target.schemaReference
  ) {
    serializedSchemaResult = await generateSchemaExample(session, target.schemaReference, {
      direction: target.direction,
      explicit: [{ source: 'example-object', value: representation.decodedData }],
      signal: options.signal,
      limits: options.limits,
    });
  }
  abort(options.signal);
  return {
    target,
    representation,
    ...(serializedSchemaResult ? { serializedSchemaResult } : {}),
    ...(schemaResult ? { schemaResult } : {}),
    ...(session ? { session } : {}),
    authored: target.source !== undefined || target.unavailable === true,
  };
}
