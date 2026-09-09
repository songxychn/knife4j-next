import {
  exampleHasOwn,
  interpretExampleObject,
  parseJsonParameterValue,
  resolvePhysicalJsonPointer,
  serializeOas32Parameter,
  type ExampleRepresentation,
  type Oas32ParamIn,
  type Oas32Parameter,
  type Oas32ParameterCollection,
  type Oas32ParameterContext,
  type Oas32ParameterInput,
  type Oas32ParameterPlan,
  type Oas32ParameterProvenance,
  type Oas32ParameterResult,
  type ParameterInstance,
  type SchemaValue,
} from 'knife4j-core';
import type { MenuOperation } from '../types/swagger';
import { evaluateSchemaDocumentDirectionally, type SchemaDocumentSession } from './schemaDocumentSession';
import type { OperationExampleResult, OperationExampleTarget } from './operationExampleCatalog';
import { asOpenApiRecord as record } from './openApiDocumentPointer';
import { collectLeafSchemaIssues } from './schemaEvaluationIssues';

const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Reads C's physical, typed edges; neither URI guessing nor external loading belongs here. */
export function oas32ParameterContext(operation: MenuOperation): Oas32ParameterContext {
  const snapshot = operation.resourceSnapshot;
  return {
    documentFor: (location) => record(snapshot?.nodes.get(location.ownerRetrievalUri)?.document) ?? undefined,
    resolveReference: (location, kind) => {
      const edge = snapshot?.edges.find(
        (candidate) =>
          candidate.kind === 'reference-object' &&
          candidate.sourceRetrievalUri === location.ownerRetrievalUri &&
          candidate.sourcePointer === `${location.pointer}/$ref`,
      );
      const target = edge?.target;
      if (
        !snapshot ||
        !target ||
        !['loaded', 'local'].includes(edge.state) ||
        !snapshot.objectLocations.some(
          (candidate) =>
            candidate.kind === kind &&
            candidate.ownerRetrievalUri === target.ownerRetrievalUri &&
            candidate.pointer === target.pointer,
        )
      )
        return null;
      const value = resolvePhysicalJsonPointer(snapshot.nodes.get(target.ownerRetrievalUri)?.document, target.pointer);
      return value.found ? { ...target, value: value.value } : null;
    },
  };
}

const abort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Parameter evaluation was cancelled.', 'AbortError');
};

/** Only codec shape hints are projected. Schema evaluation always uses the original physical reference. */
export async function resolveOas32ParameterSchema(
  parameter: Oas32Parameter,
  session: SchemaDocumentSession,
  signal?: AbortSignal,
): Promise<Oas32Parameter> {
  if (!parameter.schemaReference) return parameter;
  let work = 0;
  const visit = async (
    schema: unknown,
    base: string,
    includesId: boolean,
    seen: ReadonlySet<string>,
    depth: number,
  ): Promise<SchemaValue | undefined> => {
    abort(signal);
    if (++work > 256 || depth > 12) return undefined;
    if (typeof schema === 'boolean') return schema;
    const value = record(schema);
    if (!value) return undefined;
    const localBase = !includesId && typeof value.$id === 'string' ? new URL(value.$id, base).href : base;
    if (typeof value.$dynamicRef === 'string') return value;
    let shape = value;
    if (typeof value.$ref === 'string') {
      const reference = new URL(value.$ref, localBase).href;
      if (seen.has(reference)) return value;
      const target = await session.resolve(reference);
      abort(signal);
      const resolved = await visit(target.schema, target.resourceUri, true, new Set([...seen, reference]), depth + 1);
      const resolvedObject = record(resolved);
      if (
        !resolvedObject ||
        ['type', 'properties', 'items', 'prefixItems', 'allOf', 'oneOf', 'anyOf'].some((key) =>
          exampleHasOwn(value, key),
        )
      )
        return value;
      shape = { ...resolvedObject, ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== '$ref')) };
    }
    const hints = { ...shape };
    // Traverse Schema positions only. Examples/defaults/extension payloads remain opaque.
    if (record(shape.properties))
      hints.properties = Object.fromEntries(
        await Promise.all(
          Object.entries(shape.properties as Record<string, unknown>).map(async ([key, child]) => [
            key,
            (await visit(child, localBase, false, seen, depth + 1)) ?? child,
          ]),
        ),
      );
    for (const key of ['items', 'additionalProperties'])
      if (exampleHasOwn(shape, key))
        hints[key] = (await visit(shape[key], localBase, false, seen, depth + 1)) ?? shape[key];
    return hints;
  };
  try {
    const root = await session.resolve(parameter.schemaReference);
    const schemaView = await visit(root.schema, root.resourceUri, true, new Set([root.canonicalUri]), 0);
    abort(signal);
    return { ...parameter, schemaView: schemaView ?? parameter.schemaView };
  } catch (error) {
    abort(signal);
    return parameter;
  }
}

export async function resolveOas32ParameterSchemas(
  collection: Oas32ParameterCollection,
  session: SchemaDocumentSession,
  signal?: AbortSignal,
): Promise<Oas32ParameterCollection> {
  const parameters = await Promise.all(
    collection.parameters.map((parameter) => resolveOas32ParameterSchema(parameter, session, signal)),
  );
  abort(signal);
  return { ...collection, parameters };
}

export interface Oas32ParameterEntry {
  readonly kind: 'data' | 'media' | 'parameter' | 'editor';
  readonly text: string;
  readonly enabled: boolean;
  readonly data?: ParameterInstance;
  readonly provenance?: Oas32ParameterProvenance;
}
export type Oas32ParameterEntries = Readonly<Record<string, Oas32ParameterEntry>>;

export interface Oas32ParameterSchemaIssue {
  readonly key: string;
  readonly name: string;
  readonly in: Oas32ParamIn;
  readonly instanceLocation: string;
  readonly keyword: string;
  readonly absoluteKeywordLocation: string;
}

/** Cache/history carries editable values, never an old Schema session or a claimed current author identity. */
export function readOas32ParameterEntries(value: unknown): Oas32ParameterEntries {
  const result = emptyRecord<Oas32ParameterEntry>();
  for (const [key, input] of Object.entries(record(value) ?? {})) {
    const item = record(input);
    if (!item || !['data', 'media', 'parameter', 'editor'].includes(String(item.kind)) || typeof item.text !== 'string')
      continue;
    result[key] = { kind: item.kind as Oas32ParameterEntry['kind'], text: item.text, enabled: item.enabled === true };
  }
  return result;
}

export function collectOas32ParameterInputs(
  collection: Oas32ParameterCollection,
  entries: Oas32ParameterEntries,
  cookieSource: 'explicit' | 'browser-session',
  revision: number,
  session?: SchemaDocumentSession,
): Readonly<Record<string, Oas32ParameterInput>> {
  const inputs = emptyRecord<Oas32ParameterInput>();
  for (const parameter of collection.parameters) {
    if (parameter.in === 'cookie' && cookieSource === 'browser-session') {
      inputs[parameter.key] = { kind: 'browser-session' };
      continue;
    }
    const entry = own(entries, parameter.key) ? entries[parameter.key] : undefined;
    if (!entry?.enabled) {
      inputs[parameter.key] = { kind: 'absent' };
      continue;
    }
    const provenance = entry.provenance ?? {
      id: `editor:${parameter.key}`,
      layer: entry.kind === 'media' ? 'media' : 'parameter',
      sourceLocation: parameter.location,
      schemaLocation: parameter.schemaLocation,
      schemaReference: parameter.schemaReference,
      mediaLocation: parameter.mediaLocation,
      itemSchemaLocation: parameter.itemSchemaLocation,
      operationIdentity: collection.operation.identity,
    };
    const currentProvenance = { ...provenance, editRevision: revision, session };
    if (entry.kind === 'data') {
      const parsed = parseJsonParameterValue(entry.text);
      inputs[parameter.key] = parsed.ok
        ? { kind: 'data', value: parsed.instance, provenance: currentProvenance }
        : { kind: 'editor', text: entry.text, provenance: currentProvenance };
      continue;
    }
    inputs[parameter.key] = {
      kind: entry.kind,
      text: entry.text,
      ...(exampleHasOwn(entry, 'data') ? { data: entry.data } : {}),
      provenance: currentProvenance,
    };
  }
  return inputs;
}

/** G owns Example fields/precedence; J supplies only the 3.2 parameter codec at that real target. */
export function interpretOas32ParameterExample(
  target: OperationExampleTarget,
  parameter: Oas32Parameter,
  source: Record<string, unknown>,
): { representation: ExampleRepresentation; parameterResult?: Oas32ParameterResult } {
  const original = interpretExampleObject(source, target.context);
  if (original.external || original.diagnostics.some((diagnostic) => diagnostic.phase === 'structure'))
    return { representation: original };
  const input: Oas32ParameterInput | undefined =
    original.serialized !== undefined
      ? {
          kind: target.layer === 'media' ? 'media' : 'parameter',
          text: original.serialized,
          ...(original.data !== undefined && original.dataSource !== 'decoded' ? { data: original.data } : {}),
        }
      : original.data !== undefined
        ? { kind: 'data', value: original.data }
        : undefined;
  if (!input) return { representation: original };
  const result = serializeOas32Parameter(parameter, input);
  const decoded = result.decodedData;
  const authored = result.data;
  return {
    parameterResult: result,
    representation: {
      ...original,
      ...(authored !== undefined
        ? { data: authored }
        : decoded !== undefined
          ? { data: decoded, dataSource: 'decoded' as const }
          : {}),
      decodedData: decoded,
      text: target.layer === 'media' ? result.mediaText : result.parameterText,
      serialization: result.serialization,
      pairing: result.pairing,
      diagnostics: [
        ...original.diagnostics.filter((diagnostic) => diagnostic.code === 'LEGACY_VALUE_IMPLEMENTATION_DEFINED'),
        ...result.diagnostics.map((diagnostic) => ({
          phase: diagnostic.phase === 'pairing' ? ('pairing' as const) : ('serialization' as const),
          code: diagnostic.code,
        })),
      ],
    },
  };
}

export function oas32ExampleParameterEntry(
  result: OperationExampleResult,
  revision: number,
): Oas32ParameterEntry | undefined {
  const parameter = result.parameterResult;
  const target = result.target;
  if (
    !parameter ||
    result.representation.external ||
    result.representation.diagnostics.some((diagnostic) => diagnostic.phase === 'structure')
  )
    return undefined;
  const input = parameter.input;
  if (input.kind === 'absent' || input.kind === 'browser-session') return undefined;
  const provenance = {
    id: target.id,
    layer: target.layer,
    sourceLocation: target.sourceLocation,
    containerLocation: target.containerLocation,
    mediaLocation: target.mediaLocation,
    schemaLocation: target.schemaLocation,
    schemaReference: target.schemaReference,
    itemSchemaLocation: target.itemSchemaLocation,
    operationIdentity: target.operationIdentity,
    generation: target.generation,
    editRevision: revision,
    session: result.session,
  };
  if (input.kind === 'data') {
    return { kind: 'data' as const, text: JSON.stringify(input.value, null, 2), enabled: true, provenance };
  }
  if (!('text' in input)) return undefined;
  return {
    kind: input.kind,
    text: input.text,
    enabled: true,
    ...(exampleHasOwn(input, 'data') ? { data: (input as { data: ParameterInstance }).data } : {}),
    provenance,
  };
}

/** Evaluate authored/decoded parameter data against the original physical Schema reference. */
export async function evaluateOas32ParameterPlan(
  plan: Oas32ParameterPlan,
  session: SchemaDocumentSession,
  signal?: AbortSignal,
): Promise<readonly Oas32ParameterSchemaIssue[]> {
  const issues: Oas32ParameterSchemaIssue[] = [];
  for (const result of plan.results) {
    abort(signal);
    if (result.input.kind === 'absent' || result.input.kind === 'browser-session') continue;
    const data = result.data ?? result.decodedData;
    const reference = result.parameter.schemaReference;
    if (data === undefined || !reference) continue;
    const evaluation = await evaluateSchemaDocumentDirectionally(session, reference, data, 'request', { signal });
    if (evaluation.valid) continue;
    const leafIssues = collectLeafSchemaIssues(evaluation.errors);
    const normalized =
      leafIssues.length > 0
        ? leafIssues
        : [
            {
              instanceLocation: '',
              keyword: 'schema',
              absoluteKeywordLocation: reference,
            },
          ];
    issues.push(
      ...normalized.map((issue) => ({
        ...issue,
        key: result.parameter.key,
        name: result.parameter.name,
        in: result.parameter.in,
      })),
    );
  }
  return issues;
}
