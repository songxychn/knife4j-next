import {
  exampleHasOwn as owns,
  getOpenApiSpecificationFeatures,
  physicalJsonPointerTokens,
  resolvePhysicalJsonPointer,
  type ExampleRepresentation,
} from 'knife4j-core';
import type {
  ResourceDiagnostic,
  ResourceGraphEdge,
  ResourceGraphObject,
  ResourceGraphSnapshot,
  ResourceGraphTarget,
} from './externalResourceGraph';

type Location = Pick<ResourceGraphTarget, 'ownerRetrievalUri' | 'pointer'>;
type RecordValue = Record<string, unknown>;
type Truth = boolean | 'unknown';

export interface DiscriminatorSchemaLocation extends Location {
  /** Public physical reference accepted by SchemaDocumentSession, never an adapter URI. */
  readonly reference: string;
  /** Only an actual entry-document component may use the existing model-name route. */
  readonly componentName?: string;
}

export type SchemaDiscriminatorInput =
  | { readonly status: 'known'; readonly value: unknown; readonly source: string }
  | { readonly status: 'no-data'; readonly source: string };

/** G owns decoding. Serialized-only and unfetched external examples carry no logical instance. */
export function discriminatorExampleInput(representation: ExampleRepresentation): SchemaDiscriminatorInput {
  return owns(representation, 'data')
    ? { status: 'known', value: representation.data, source: representation.dataSource ?? 'data' }
    : { status: 'no-data', source: representation.external ? 'externalValue' : 'unavailable-logical-data' };
}

export type DiscriminatorTargetState =
  'resolved' | 'pending' | 'failed' | 'missing' | 'wrong-kind' | 'unsupported-dialect' | 'invalid';

export interface DiscriminatorTarget {
  readonly id: string;
  readonly source: 'explicit' | 'implicit' | 'default';
  readonly key?: string;
  readonly rawReference: unknown;
  readonly sourceLocation: Location;
  readonly state: DiscriminatorTargetState;
  readonly resolvedUri?: string;
  readonly graphState?: ResourceGraphEdge['state'];
  readonly location?: DiscriminatorSchemaLocation;
  readonly candidateIds: readonly string[];
  readonly graphDiagnostics: readonly ResourceDiagnostic[];
}

export interface DiscriminatorCandidate {
  readonly id: string;
  readonly composition: 'oneOf' | 'anyOf' | 'allOf';
  /** This complete branch retains its own assertion siblings. */
  readonly location: DiscriminatorSchemaLocation;
  /** The branch and every $ref target are distinct physical Schema locations. */
  readonly identities: readonly DiscriminatorSchemaLocation[];
  readonly state: DiscriminatorTargetState;
  readonly recursive: boolean;
  readonly via: readonly DiscriminatorSchemaLocation[];
}

export interface DiscriminatorDiagnostic {
  readonly code: string;
  readonly location: Location;
  readonly targetId?: string;
}

export type DiscriminatorRequirement = 'required' | 'proven-optional' | 'unknown';
export interface SchemaDiscriminatorMetadata {
  readonly snapshot: ResourceGraphSnapshot;
  readonly generation: number;
  readonly requested: DiscriminatorSchemaLocation;
  readonly declaration?: DiscriminatorSchemaLocation;
  readonly declarationPointer?: string;
  readonly propertyName?: string;
  readonly status:
    | 'ready'
    | 'no-discriminator'
    | 'unsupported-version'
    | 'unsupported-dialect'
    | 'unavailable'
    | 'budget-exceeded'
    | 'aborted';
  readonly configuration: 'oneOf' | 'anyOf' | 'allOf' | 'unsupported';
  readonly requirement: DiscriminatorRequirement;
  readonly targets: readonly DiscriminatorTarget[];
  readonly candidates: readonly DiscriminatorCandidate[];
  readonly diagnostics: readonly DiscriminatorDiagnostic[];
  readonly traversalSteps: number;
}

export interface SchemaDiscriminatorLimits {
  readonly maxIndexEntries: number;
  readonly maxIndexSteps: number;
  readonly maxTraversalSteps: number;
  readonly maxDepth: number;
  readonly maxTargets: number;
  readonly maxCandidates: number;
}

export const DEFAULT_DISCRIMINATOR_LIMITS: Readonly<SchemaDiscriminatorLimits> = Object.freeze({
  maxIndexEntries: 50_000,
  maxIndexSteps: 100_000,
  maxTraversalSteps: 4_000,
  maxDepth: 32,
  maxTargets: 256,
  maxCandidates: 256,
});

export interface SchemaDiscriminatorIndex {
  readonly snapshot: ResourceGraphSnapshot;
  readonly status: 'ready' | 'unsupported-version' | 'budget-exceeded' | 'aborted';
  readonly declarations: readonly DiscriminatorSchemaLocation[];
  readonly indexSteps: number;
  /** Exact declaration or a $ref-reachable declaration; never shallow-merges multiple declarations. */
  describe(location: Location, options?: { readonly signal?: AbortSignal }): SchemaDiscriminatorMetadata;
}

export function isOas32DiscriminatorDocument(document: unknown): boolean {
  return getOpenApiSpecificationFeatures(record(document)?.openapi)?.family === '3.2';
}

class TraversalHalt extends Error {
  constructor(readonly status: 'budget-exceeded' | 'aborted') {
    super(status);
  }
}

class Budget {
  steps = 0;
  constructor(
    private readonly maximum: number,
    private readonly depth: number,
    private readonly signal?: AbortSignal,
  ) {}
  step(depth = 0): void {
    if (this.signal?.aborted) throw new TraversalHalt('aborted');
    if (++this.steps > this.maximum || depth > this.depth) throw new TraversalHalt('budget-exceeded');
  }
}

const record = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : undefined;
const keyOf = (location: Location): string => JSON.stringify([location.ownerRetrievalUri, location.pointer]);
const child = (location: Location, name: string | number): Location => ({
  ownerRetrievalUri: location.ownerRetrievalUri,
  pointer: `${location.pointer}/${String(name).replace(/~/g, '~0').replace(/\//g, '~1')}`,
});
const isSupportedDialect = (dialect: string | undefined): boolean =>
  /^(?:https:\/\/spec\.openapis\.org\/oas\/3\.1\/dialect\/base|https:\/\/json-schema\.org\/draft\/2020-12\/schema|https:\/\/spec\.openapis\.org\/oas\/3\.2\/dialect\/2025-09-17)#?$/.test(
    dialect ?? '',
  );

function publicLocation(location: Location, entry: string): DiscriminatorSchemaLocation {
  const tokens = physicalJsonPointerTokens(location.pointer);
  const componentName =
    location.ownerRetrievalUri === entry &&
    tokens?.length === 3 &&
    tokens[0] === 'components' &&
    tokens[1] === 'schemas'
      ? tokens[2]
      : undefined;
  return Object.freeze({
    ownerRetrievalUri: location.ownerRetrievalUri,
    pointer: location.pointer,
    reference: `${location.ownerRetrievalUri}#${location.pointer.slice(1).split('/').map(encodeURIComponent).join('/')}`,
    ...(componentName === undefined ? {} : { componentName }),
  });
}

/** Product consumers must use this identity; last-path-segment names are not locations. */
export function discriminatorSchemaLocation(
  location: Location,
  entryRetrievalUri: string,
): DiscriminatorSchemaLocation {
  return publicLocation(location, entryRetrievalUri);
}

interface Chain {
  readonly identities: readonly DiscriminatorSchemaLocation[];
  readonly state: DiscriminatorTargetState;
  readonly recursive: boolean;
}

/**
 * OAS 3.2.0 §§4.25, 4.1.2.3. Index only C's typed locations and edges once per
 * immutable snapshot. This helper has no loader, evaluator or generation capability.
 */
export function createSchemaDiscriminatorIndex(
  snapshot: ResourceGraphSnapshot,
  options: { readonly limits?: Partial<SchemaDiscriminatorLimits>; readonly signal?: AbortSignal } = {},
): SchemaDiscriminatorIndex {
  const limits = { ...DEFAULT_DISCRIMINATOR_LIMITS, ...options.limits };
  for (const [name, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer.`);
  const budget = new Budget(limits.maxIndexSteps, limits.maxDepth, options.signal);
  const objects = new Map<string, ResourceGraphObject>();
  const values = new Map<string, unknown>();
  const edges = new Map<string, ResourceGraphEdge>();
  const graphDiagnostics = new Map<string, ResourceDiagnostic[]>();
  const entryComponents = new Map<string, DiscriminatorSchemaLocation>();
  const declarations: DiscriminatorSchemaLocation[] = [];
  const reverseAllOf = new Map<string, Map<string, { location: Location; via: DiscriminatorSchemaLocation[] }>>();
  let status: SchemaDiscriminatorIndex['status'] = 'ready';
  const located = (location: Location) => publicLocation(location, snapshot.entryRetrievalUri);

  function stateAt(location: Location): DiscriminatorTargetState {
    const object = objects.get(keyOf(location));
    if (!object) return 'missing';
    if (object.kind !== 'schema') return 'wrong-kind';
    if (!isSupportedDialect(object.schemaDialect)) return 'unsupported-dialect';
    return values.has(keyOf(location)) ? 'resolved' : 'missing';
  }

  function chain(initial: Location, traversal: Budget): Chain {
    const identities: DiscriminatorSchemaLocation[] = [];
    const seen = new Set<string>();
    let location = initial;
    for (let depth = 0; ; depth++) {
      traversal.step(depth);
      const key = keyOf(location);
      if (seen.has(key)) return { identities, state: 'resolved', recursive: true };
      seen.add(key);
      const state = stateAt(location);
      if (state !== 'resolved') return { identities, state, recursive: false };
      identities.push(located(location));
      const schema = record(values.get(key));
      if (typeof schema?.$ref !== 'string') return { identities, state: 'resolved', recursive: false };
      const edge = edges.get(keyOf(child(location, '$ref')));
      if (!edge || edge.kind !== 'schema-ref') return { identities, state: 'missing', recursive: false };
      if (edge.state === 'pending' || edge.state === 'failed')
        return { identities, state: edge.state, recursive: false };
      if (!edge.target) return { identities, state: 'missing', recursive: false };
      location = edge.target;
    }
  }

  try {
    budget.step();
    const entry = snapshot.nodes.get(snapshot.entryRetrievalUri);
    if (!isOas32DiscriminatorDocument(entry?.document)) {
      status = 'unsupported-version';
    } else {
      if (
        snapshot.objectLocations.length + snapshot.edges.length + snapshot.diagnostics.length >
        limits.maxIndexEntries
      )
        throw new TraversalHalt('budget-exceeded');
      for (const object of snapshot.objectLocations) {
        budget.step();
        objects.set(keyOf(object), object);
        if (object.kind !== 'schema') continue;
        const resolved = resolvePhysicalJsonPointer(
          snapshot.nodes.get(object.ownerRetrievalUri)?.document,
          object.pointer,
        );
        if (resolved.found) values.set(keyOf(object), resolved.value);
        const location = located(object);
        if (location.componentName !== undefined) entryComponents.set(location.componentName, location);
        if (record(resolved.value) && owns(resolved.value as object, 'discriminator')) declarations.push(location);
      }
      for (const edge of snapshot.edges) {
        budget.step();
        if (edge.kind === 'schema-ref' || edge.kind === 'discriminator-mapping')
          edges.set(keyOf({ ownerRetrievalUri: edge.sourceRetrievalUri, pointer: edge.sourcePointer }), edge);
      }
      const owners = new Map([...snapshot.nodes.values()].map((node) => [node.retrievalUriHash, node.retrievalUri]));
      for (const diagnostic of snapshot.diagnostics) {
        budget.step();
        const ownerRetrievalUri = owners.get(diagnostic.sourceRetrievalUriHash);
        if (!ownerRetrievalUri) continue;
        const key = keyOf({ ownerRetrievalUri, pointer: diagnostic.sourcePointer });
        const list = graphDiagnostics.get(key) ?? [];
        list.push(diagnostic);
        graphDiagnostics.set(key, list);
      }
      for (const object of snapshot.objectLocations) {
        budget.step();
        if (object.kind !== 'schema' || stateAt(object) !== 'resolved') continue;
        const allOf = record(values.get(keyOf(object)))?.allOf;
        if (!Array.isArray(allOf)) continue;
        for (let i = 0; i < allOf.length; i++) {
          const branch = child(child(object, 'allOf'), i);
          const related = chain(branch, budget);
          for (const parent of related.identities) {
            budget.step();
            const children = reverseAllOf.get(keyOf(parent)) ?? new Map();
            const relationship = children.get(keyOf(object)) ?? { location: object, via: [] };
            relationship.via.push(located(branch));
            children.set(keyOf(object), relationship);
            reverseAllOf.set(keyOf(parent), children);
          }
        }
      }
    }
  } catch (error) {
    if (!(error instanceof TraversalHalt)) throw error;
    status = error.status;
  }

  function describe(
    initial: Location,
    readOptions: { readonly signal?: AbortSignal } = {},
  ): SchemaDiscriminatorMetadata {
    const traversal = new Budget(limits.maxTraversalSteps, limits.maxDepth, readOptions.signal ?? options.signal);
    const diagnostics: DiscriminatorDiagnostic[] = [];
    const targets: DiscriminatorTarget[] = [];
    const candidates: DiscriminatorCandidate[] = [];
    let declaration: DiscriminatorSchemaLocation | undefined;
    let propertyName: string | undefined;
    let configuration: SchemaDiscriminatorMetadata['configuration'] = 'unsupported';
    let requirement: DiscriminatorRequirement = 'unknown';
    const diagnostic = (code: string, location: Location, targetId?: string) =>
      diagnostics.push(Object.freeze({ code, location: located(location), ...(targetId ? { targetId } : {}) }));
    const finish = (resultStatus: SchemaDiscriminatorMetadata['status']): SchemaDiscriminatorMetadata =>
      Object.freeze({
        snapshot,
        generation: snapshot.generation,
        requested: located(initial),
        declaration,
        declarationPointer: declaration ? `${declaration.pointer}/discriminator` : undefined,
        propertyName,
        status: resultStatus,
        configuration,
        requirement,
        targets: Object.freeze(targets),
        candidates: Object.freeze(candidates),
        diagnostics: Object.freeze(diagnostics),
        traversalSteps: traversal.steps,
      });
    if (status !== 'ready') {
      diagnostic(status.toUpperCase().replace(/-/g, '_'), initial);
      return finish(status);
    }
    try {
      let location = initial;
      const seen = new Set<string>();
      let schema: RecordValue | undefined;
      for (let depth = 0; ; depth++) {
        traversal.step(depth);
        const state = stateAt(location);
        if (state !== 'resolved') {
          diagnostic(`SCHEMA_${state.toUpperCase().replace(/-/g, '_')}`, location);
          return finish(state === 'unsupported-dialect' ? state : 'unavailable');
        }
        if (seen.has(keyOf(location))) {
          diagnostic('RECURSIVE_SCHEMA_REFERENCE', location);
          return finish('no-discriminator');
        }
        seen.add(keyOf(location));
        schema = record(values.get(keyOf(location)));
        if (!schema) return finish('no-discriminator');
        if (owns(schema, 'discriminator')) break;
        if (typeof schema.$ref !== 'string') return finish('no-discriminator');
        const edge = edges.get(keyOf(child(location, '$ref')));
        if (!edge?.target || !['local', 'loaded'].includes(edge.state)) {
          diagnostic('DECLARATION_REFERENCE_UNAVAILABLE', location);
          return finish('unavailable');
        }
        location = edge.target;
      }
      declaration = located(location);
      const discriminator = record(schema.discriminator);
      if (!discriminator || typeof discriminator.propertyName !== 'string') {
        diagnostic('INVALID_DISCRIMINATOR', location);
        return finish('ready');
      }
      propertyName = discriminator.propertyName;
      const composites = ['oneOf', 'anyOf', 'allOf'].filter((keyword) => owns(schema!, keyword));
      if (composites.length <= 1) {
        if (composites[0] === 'oneOf' || composites[0] === 'anyOf') configuration = composites[0];
        else configuration = 'allOf';
      }

      const addCandidate = (candidate: DiscriminatorCandidate) => {
        traversal.step();
        if (candidates.length >= limits.maxCandidates) throw new TraversalHalt('budget-exceeded');
        candidates.push(Object.freeze(candidate));
      };
      if (configuration === 'oneOf' || configuration === 'anyOf') {
        const branches = schema[configuration];
        if (!Array.isArray(branches) || branches.length === 0) configuration = 'unsupported';
        else
          for (let i = 0; i < branches.length; i++) {
            const branch = child(child(location, configuration), i);
            const related = chain(branch, traversal);
            addCandidate({
              id: keyOf(branch),
              composition: configuration,
              location: located(branch),
              identities: Object.freeze([...related.identities]),
              state: related.state,
              recursive: related.recursive,
              via: Object.freeze([]),
            });
          }
      } else if (configuration === 'allOf') {
        const queue: { location: Location; depth: number }[] = [{ location, depth: 0 }];
        const visited = new Set([keyOf(location)]);
        for (let cursor = 0; cursor < queue.length; cursor++) {
          const current = queue[cursor];
          traversal.step(current.depth);
          for (const descendant of reverseAllOf.get(keyOf(current.location))?.values() ?? []) {
            traversal.step(current.depth);
            const id = keyOf(descendant.location);
            if (visited.has(id)) continue;
            visited.add(id);
            queue.push({ location: descendant.location, depth: current.depth + 1 });
            addCandidate({
              id,
              composition: 'allOf',
              location: located(descendant.location),
              identities: Object.freeze([located(descendant.location)]),
              state: stateAt(descendant.location),
              recursive: false,
              via: Object.freeze([...descendant.via]),
            });
          }
        }
        if (candidates.length === 0) configuration = 'unsupported';
      }
      if (configuration === 'unsupported') diagnostic('UNSUPPORTED_CONFIGURATION', location);

      const matching = (target: Location): readonly string[] =>
        Object.freeze(
          candidates
            .filter((candidate) => candidate.identities.some((identity) => keyOf(identity) === keyOf(target)))
            .map((candidate) => candidate.id),
        );
      const addTarget = (
        source: DiscriminatorTarget['source'],
        rawReference: unknown,
        site: Location,
        key?: string,
      ) => {
        traversal.step();
        if (targets.length >= limits.maxTargets) throw new TraversalHalt('budget-exceeded');
        const edge = edges.get(keyOf(site));
        const implicit = source === 'implicit' && key !== undefined ? entryComponents.get(key) : undefined;
        const targetLocation = implicit ?? (edge?.kind === 'discriminator-mapping' ? edge.target : undefined);
        const inheritedDiagnostics = Object.freeze([...(graphDiagnostics.get(keyOf(site)) ?? [])]);
        let state: DiscriminatorTargetState =
          typeof rawReference !== 'string'
            ? 'invalid'
            : targetLocation
              ? stateAt(targetLocation)
              : edge?.state === 'pending'
                ? 'pending'
                : edge?.state === 'failed'
                  ? 'failed'
                  : 'missing';
        if (inheritedDiagnostics.some((item) => item.code === 'FRAGMENT_NOT_FOUND')) state = 'missing';
        if (inheritedDiagnostics.some((item) => item.code === 'DOCUMENT_KIND_MISMATCH')) state = 'wrong-kind';
        if (inheritedDiagnostics.some((item) => item.code === 'DIALECT_UNSUPPORTED')) state = 'unsupported-dialect';
        const candidateIds = targetLocation ? matching(targetLocation) : Object.freeze([]);
        const target: DiscriminatorTarget = Object.freeze({
          id: JSON.stringify([source, key, keyOf(site)]),
          source,
          key,
          rawReference,
          sourceLocation: located(site),
          state,
          ...(edge ? { graphState: edge.state, resolvedUri: edge.resolvedUri } : {}),
          ...(targetLocation ? { location: located(targetLocation) } : {}),
          candidateIds,
          graphDiagnostics: inheritedDiagnostics,
        });
        targets.push(target);
        if (state !== 'resolved') diagnostic(`TARGET_${state.toUpperCase().replace(/-/g, '_')}`, site, target.id);
        else if (!candidateIds.length) diagnostic('TARGET_NOT_LISTED', site, target.id);
        else if (candidateIds.length > 1) diagnostic('AMBIGUOUS_BRANCH', site, target.id);
      };
      if (owns(discriminator, 'mapping')) {
        const mapping = record(discriminator.mapping);
        if (!mapping) {
          configuration = 'unsupported';
          diagnostic('INVALID_MAPPING', child(location, 'discriminator'));
        } else
          for (const name of Object.keys(mapping))
            addTarget('explicit', mapping[name], child(child(child(location, 'discriminator'), 'mapping'), name), name);
      }
      for (const candidate of candidates)
        for (const identity of candidate.identities) {
          traversal.step();
          const name = identity.componentName;
          if (
            name !== undefined &&
            /^[A-Za-z0-9._-]+$/.test(name) &&
            !targets.some((target) => target.source === 'implicit' && target.key === name)
          )
            addTarget('implicit', name, identity, name);
        }
      if (owns(discriminator, 'defaultMapping'))
        addTarget('default', discriminator.defaultMapping, child(child(location, 'discriminator'), 'defaultMapping'));

      const analysis = analyzeRequirement(location, propertyName, traversal);
      requirement = analysis.required ? 'required' : analysis.empty === true ? 'proven-optional' : 'unknown';
      if (requirement === 'proven-optional' && !owns(discriminator, 'defaultMapping'))
        diagnostic('OPTIONAL_PROPERTY_WITHOUT_DEFAULT', location);
      for (const candidate of candidates)
        if (candidate.state !== 'resolved') diagnostic('CANDIDATE_UNAVAILABLE', candidate.location);
      return finish('ready');
    } catch (error) {
      if (!(error instanceof TraversalHalt)) throw error;
      diagnostic(error.status === 'aborted' ? 'ABORTED' : 'BUDGET_EXCEEDED', declaration ?? initial);
      return finish(error.status);
    }
  }

  /** Sound, deliberately incomplete: prove required or that {} is a missing-property witness. */
  function analyzeRequirement(initial: Location, propertyName: string, traversal: Budget) {
    type Analysis = { required: boolean; empty: Truth };
    const cache = new Map<string, Analysis>();
    const active = new Set<string>();
    const and = (values: Truth[]): Truth =>
      values.includes(false) ? false : values.includes('unknown') ? 'unknown' : true;
    const ignored = new Set([
      '$schema',
      '$id',
      '$anchor',
      '$dynamicAnchor',
      '$defs',
      'definitions',
      'title',
      'description',
      'default',
      'examples',
      'example',
      'discriminator',
      'xml',
      'externalDocs',
      'deprecated',
      'readOnly',
      'writeOnly',
      '$comment',
      'properties',
      'patternProperties',
      'additionalProperties',
      'unevaluatedProperties',
      'propertyNames',
      'dependentRequired',
      'dependentSchemas',
      'format',
      'contentEncoding',
      'contentMediaType',
      'contentSchema',
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'multipleOf',
      'minLength',
      'maxLength',
      'pattern',
      'items',
      'prefixItems',
      'contains',
      'minContains',
      'maxContains',
      'unevaluatedItems',
      'minItems',
      'maxItems',
      'uniqueItems',
    ]);
    const visit = (location: Location, depth: number): Analysis => {
      traversal.step(depth);
      const key = keyOf(location);
      const previous = cache.get(key);
      if (previous) return previous;
      if (active.has(key) || stateAt(location) !== 'resolved') return { required: false, empty: 'unknown' };
      const value = values.get(key);
      if (typeof value === 'boolean') return { required: false, empty: value };
      const schema = record(value);
      if (!schema) return { required: false, empty: 'unknown' };
      active.add(key);
      let required = false;
      const empty: Truth[] = [];
      for (const keyword of Object.keys(schema)) {
        traversal.step(depth);
        const value = schema[keyword];
        if (keyword === 'required') {
          if (!Array.isArray(value)) empty.push('unknown');
          else {
            required ||= value.includes(propertyName);
            empty.push(value.length === 0);
          }
        } else if (keyword === 'type')
          empty.push(value === 'object' || (Array.isArray(value) && value.includes('object')));
        else if (keyword === 'minProperties' || keyword === 'maxProperties')
          empty.push(typeof value === 'number' ? (keyword === 'minProperties' ? value <= 0 : value >= 0) : 'unknown');
        else if (keyword === 'const') empty.push(!!record(value) && Object.keys(value as object).length === 0);
        else if (keyword === 'enum') {
          if (!Array.isArray(value)) empty.push('unknown');
          else {
            let found = false;
            for (const item of value) {
              traversal.step(depth);
              if (record(item) && Object.keys(item).length === 0) found = true;
            }
            empty.push(found);
          }
        } else if (keyword === '$ref') {
          const edge = edges.get(keyOf(child(location, '$ref')));
          const result =
            edge?.target && ['local', 'loaded'].includes(edge.state) ? visit(edge.target, depth + 1) : undefined;
          required ||= result?.required ?? false;
          empty.push(result?.empty ?? 'unknown');
        } else if (keyword === 'allOf' || keyword === 'oneOf' || keyword === 'anyOf') {
          if (!Array.isArray(value) || value.length === 0) empty.push('unknown');
          else {
            const branches = value.map((_, i) => visit(child(child(location, keyword), i), depth + 1));
            required ||=
              keyword === 'allOf'
                ? branches.some((branch) => branch.required)
                : branches.every((branch) => branch.required);
            const results = branches.map((branch) => branch.empty);
            empty.push(
              keyword === 'allOf'
                ? and(results)
                : keyword === 'anyOf'
                  ? results.includes(true)
                    ? true
                    : results.includes('unknown')
                      ? 'unknown'
                      : false
                  : results.includes('unknown')
                    ? 'unknown'
                    : results.filter(Boolean).length === 1,
            );
          }
        } else if (!ignored.has(keyword)) empty.push('unknown');
      }
      active.delete(key);
      const result = { required, empty: and(empty) };
      cache.set(key, result);
      return result;
    };
    return visit(initial, 0);
  }

  return Object.freeze({
    snapshot,
    status,
    declarations: Object.freeze(declarations),
    indexSteps: budget.steps,
    describe,
  });
}

export type DiscriminatorObservation =
  | { readonly status: 'no-data' | 'not-object' | 'missing'; readonly source: string }
  | { readonly status: 'present'; readonly source: string; readonly value: unknown };

export interface SchemaDiscriminatorSelection {
  readonly status:
    'selected' | 'ambiguous' | 'unavailable' | 'unsupported-configuration' | 'unmapped' | 'no-data' | 'not-applicable';
  readonly reason?: 'explicit' | 'implicit' | 'default-missing' | 'default-unmapped';
  readonly observation: DiscriminatorObservation;
  readonly target?: DiscriminatorTarget;
  readonly candidates: readonly DiscriminatorCandidate[];
  readonly requirement: DiscriminatorRequirement;
  readonly diagnostics: readonly DiscriminatorDiagnostic[];
}

/**
 * Hint only. No schema/data mutations and no valid/errors field. If supplied,
 * missingPropertyValidated must describe this exact requested Schema, snapshot
 * and logical input after complete root evaluation; a branch's valid is insufficient.
 */
export function selectSchemaDiscriminator(
  metadata: SchemaDiscriminatorMetadata,
  input: SchemaDiscriminatorInput,
  options: { readonly missingPropertyValidated?: boolean; readonly signal?: AbortSignal } = {},
): SchemaDiscriminatorSelection {
  const object = input.status === 'known' ? record(input.value) : undefined;
  const observation: DiscriminatorObservation = Object.freeze(
    input.status === 'no-data'
      ? { status: 'no-data', source: input.source }
      : !object
        ? { status: 'not-object', source: input.source }
        : metadata.propertyName !== undefined && owns(object, metadata.propertyName)
          ? { status: 'present', source: input.source, value: object[metadata.propertyName] }
          : { status: 'missing', source: input.source },
  );
  let requirement = metadata.requirement;
  const diagnostics = [...metadata.diagnostics];
  const finish = (
    status: SchemaDiscriminatorSelection['status'],
    target?: DiscriminatorTarget,
    reason?: SchemaDiscriminatorSelection['reason'],
  ): SchemaDiscriminatorSelection =>
    Object.freeze({
      status,
      reason,
      observation,
      target,
      candidates: Object.freeze(
        target ? metadata.candidates.filter((candidate) => target.candidateIds.includes(candidate.id)) : [],
      ),
      requirement,
      diagnostics: Object.freeze(diagnostics),
    });
  if (options.signal?.aborted) {
    diagnostics.push({ code: 'ABORTED', location: metadata.requested });
    return finish('unavailable');
  }
  if (metadata.status === 'no-discriminator' || metadata.status === 'unsupported-version')
    return finish('not-applicable');
  if (metadata.status !== 'ready') return finish('unavailable');
  if (observation.status === 'no-data') return finish('no-data');
  if (observation.status === 'not-object') return finish('not-applicable');
  if (observation.status === 'missing' && options.missingPropertyValidated) {
    requirement = 'proven-optional';
    if (
      !metadata.targets.some((target) => target.source === 'default') &&
      !diagnostics.some((item) => item.code === 'OPTIONAL_PROPERTY_WITHOUT_DEFAULT')
    )
      diagnostics.push({
        code: 'OPTIONAL_PROPERTY_WITHOUT_DEFAULT',
        location: metadata.declaration ?? metadata.requested,
      });
  }
  let target: DiscriminatorTarget | undefined;
  let reason: SchemaDiscriminatorSelection['reason'];
  if (observation.status === 'present' && typeof observation.value === 'string') {
    target = metadata.targets.find((target) => target.source === 'explicit' && target.key === observation.value);
    if (target) reason = 'explicit';
    else {
      target = metadata.targets.find((target) => target.source === 'implicit' && target.key === observation.value);
      if (target) reason = 'implicit';
    }
  }
  if (!target) {
    target = metadata.targets.find((target) => target.source === 'default');
    if (target) reason = observation.status === 'missing' ? 'default-missing' : 'default-unmapped';
  }
  if (metadata.configuration === 'unsupported') return finish('unsupported-configuration', target, reason);
  if (!target) return finish('unmapped');
  if (target.state !== 'resolved') return finish('unavailable', target, reason);
  if (!target.candidateIds.length) return finish('unsupported-configuration', target, reason);
  if (
    metadata.candidates.some(
      (candidate) => target!.candidateIds.includes(candidate.id) && candidate.state !== 'resolved',
    )
  )
    return finish('unavailable', target, reason);
  if (target.candidateIds.length > 1) return finish('ambiguous', target, reason);
  return finish('selected', target, reason);
}
