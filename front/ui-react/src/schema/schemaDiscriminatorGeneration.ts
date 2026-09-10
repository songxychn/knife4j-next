import { exampleHasOwn, physicalJsonPointerTokens, resolvePhysicalJsonPointer } from 'knife4j-core';
import type { EvaluationResult, JsonValue } from 'knife4j-schema-engine';
import type { ResourceGraphEdge, ResourceGraphObject, ResourceGraphSnapshot } from './externalResourceGraph';
import {
  selectSchemaDiscriminator,
  type DiscriminatorCandidate,
  type DiscriminatorSchemaLocation,
  type DiscriminatorTarget,
  type SchemaDiscriminatorMetadata,
  type SchemaDiscriminatorSelection,
} from './schemaDiscriminator';
import {
  evaluateSchemaDocumentDirectionally,
  registeredSchemaDocument,
  type SchemaDocumentSession,
} from './schemaDocumentSession';
import {
  generateSchemaExample,
  type SchemaExampleDirection,
  type SchemaExampleResult,
  type SchemaExampleSearchLimits,
} from './schemaExampleGeneration';

type Location = Pick<DiscriminatorSchemaLocation, 'ownerRetrievalUri' | 'pointer'>;
type Check = 'target' | 'branch' | 'root';

export interface DiscriminatorGenerationLimits {
  readonly maxInspectionNodes: number;
  readonly maxInspectionDepth: number;
  readonly maxInspectionCharacters: number;
  readonly maxValidationCalls: number;
}
export const DEFAULT_DISCRIMINATOR_GENERATION_LIMITS: Readonly<DiscriminatorGenerationLimits> = Object.freeze({
  maxInspectionNodes: 600_000,
  maxInspectionDepth: 256,
  maxInspectionCharacters: 32 * 1024 * 1024,
  maxValidationCalls: 3,
});
/** Explicitly bound the one public G call, including authored-source traversal. */
const GENERATOR_LIMITS: Required<SchemaExampleSearchLimits> = Object.freeze({
  maxCandidates: 48,
  maxDepth: 8,
  maxNodes: 320,
  maxReferences: 64,
  maxEvaluations: 48,
  maxStringLength: 256,
  maxArrayLength: 16,
});

export interface GenerateDiscriminatorCandidateInput {
  readonly metadata: SchemaDiscriminatorMetadata;
  readonly snapshot: ResourceGraphSnapshot;
  readonly generation: number;
  readonly requested: DiscriminatorSchemaLocation;
  readonly session: SchemaDocumentSession;
  readonly direction: SchemaExampleDirection;
  readonly targetId: string;
  readonly candidateId?: string;
  /** Opaque caller tokens are returned unchanged; the UI must check its current edit/selection before committing. */
  readonly operationToken: string;
  readonly selectionToken: string;
}
export interface DiscriminatorGenerationProvenance extends GenerateDiscriminatorCandidateInput {
  readonly target?: DiscriminatorTarget;
  readonly branch?: DiscriminatorCandidate;
}
export interface DiscriminatorGenerationBudget {
  readonly generationCalls: number;
  readonly validationCalls: number;
  readonly inspectionNodes: number;
  readonly inspectionCharacters: number;
  readonly limits: Readonly<DiscriminatorGenerationLimits>;
  readonly generatorLimits: Readonly<Required<SchemaExampleSearchLimits>>;
}
export interface DiscriminatorGenerationDiagnostic {
  readonly code: string;
  readonly check?: Check;
  readonly errorCode?: string;
}
interface GenerationDetails {
  readonly provenance: DiscriminatorGenerationProvenance;
  readonly generationResult?: SchemaExampleResult;
  readonly validations: Readonly<Partial<Record<Check, EvaluationResult>>>;
  readonly hint?: SchemaDiscriminatorSelection;
  readonly diagnostics: readonly DiscriminatorGenerationDiagnostic[];
  readonly budget: DiscriminatorGenerationBudget;
}
export type DiscriminatorGenerationResult = GenerationDetails &
  (
    | { readonly status: 'value'; readonly value: JsonValue }
    | {
        readonly status: 'none';
        readonly reason:
          | 'unavailable'
          | 'ambiguous'
          | 'generation-failed'
          | 'seed-not-object'
          | 'direction-incompatible'
          | 'selection-conflict'
          | 'target-invalid'
          | 'branch-invalid'
          | 'root-invalid'
          | 'budget-exceeded'
          | 'aborted';
      }
  );

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const identity = (value: Location): string => JSON.stringify([value.ownerRetrievalUri, value.pointer]);
const sameLocation = (a: Location, b: Location): boolean =>
  a.ownerRetrievalUri === b.ownerRetrievalUri && a.pointer === b.pointer;
const publicReference = (value: Location): string =>
  `${value.ownerRetrievalUri}#${value.pointer.slice(1).split('/').map(encodeURIComponent).join('/')}`;
const child = (value: Location, name: string | number): Location => ({
  ownerRetrievalUri: value.ownerRetrievalUri,
  pointer: `${value.pointer}/${String(name).replace(/~/g, '~0').replace(/\//g, '~1')}`,
});

class GenerationStopped extends Error {
  constructor(readonly reason: 'aborted' | 'budget-exceeded') {
    super(reason);
  }
}

/**
 * Explicit H action only: one G call on the complete chosen branch, then an
 * own-safe seed on a new value and independent directional target/branch/root
 * evaluations. Never changes the ordinary generator or its default ordering.
 */
export async function generateDiscriminatorCandidate(
  input: GenerateDiscriminatorCandidateInput,
  options: {
    readonly signal?: AbortSignal;
    readonly limits?: Partial<DiscriminatorGenerationLimits>;
    readonly generatorLimits?: SchemaExampleSearchLimits;
  } = {},
): Promise<DiscriminatorGenerationResult> {
  // Capture caller identities before the first asynchronous boundary.
  const { metadata, snapshot, generation, session, direction, targetId, candidateId, operationToken, selectionToken } =
    input;
  const requested = Object.freeze({ ...input.requested });
  const limits = Object.freeze({ ...DEFAULT_DISCRIMINATOR_GENERATION_LIMITS, ...options.limits });
  const generatorLimits = Object.freeze({ ...GENERATOR_LIMITS, ...options.generatorLimits });
  for (const [name, value] of Object.entries({ ...limits, ...generatorLimits }))
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer.`);
  const signal = options.signal;
  let inspectionNodes = 0;
  let inspectionCharacters = 0;
  let generationCalls = 0;
  let validationCalls = 0;
  let target: DiscriminatorTarget | undefined;
  let branch: DiscriminatorCandidate | undefined;
  let generationResult: SchemaExampleResult | undefined;
  let hint: SchemaDiscriminatorSelection | undefined;
  const diagnostics: DiscriminatorGenerationDiagnostic[] = [];
  const validations: Partial<Record<Check, EvaluationResult>> = {};
  const assertActive = () => {
    if (signal?.aborted) throw new GenerationStopped('aborted');
  };
  const inspect = (depth = 0, characters = 0) => {
    assertActive();
    inspectionCharacters += characters;
    if (
      ++inspectionNodes > limits.maxInspectionNodes ||
      depth > limits.maxInspectionDepth ||
      inspectionCharacters > limits.maxInspectionCharacters
    )
      throw new GenerationStopped('budget-exceeded');
  };
  const finish = (
    outcome:
      | { status: 'value'; value: JsonValue }
      | { status: 'none'; reason: Extract<DiscriminatorGenerationResult, { status: 'none' }>['reason'] },
  ): DiscriminatorGenerationResult =>
    Object.freeze({
      ...outcome,
      provenance: Object.freeze({
        metadata,
        snapshot,
        generation,
        requested,
        session,
        direction,
        targetId,
        candidateId,
        operationToken,
        selectionToken,
        target,
        branch,
      }),
      generationResult,
      validations: Object.freeze({ ...validations }),
      hint,
      diagnostics: Object.freeze([...diagnostics]),
      budget: Object.freeze({
        generationCalls,
        validationCalls,
        inspectionNodes,
        inspectionCharacters,
        limits,
        generatorLimits,
      }),
    });
  const none = (
    code: string,
    reason: Extract<DiscriminatorGenerationResult, { status: 'none' }>['reason'] = 'unavailable',
  ) => {
    diagnostics.push({ code });
    return finish({ status: 'none', reason });
  };

  function equalContent(left: unknown, right: unknown, depth = 0): boolean {
    inspect(depth, typeof left === 'string' ? left.length : 0);
    if (left === null || typeof left !== 'object') return left === right;
    if (right === null || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    if (Array.isArray(left) && left.length !== (right as unknown[]).length) return false;
    for (const key of keys) {
      inspect(depth, key.length);
      if (!exampleHasOwn(b, key) || !equalContent(a[key], b[key], depth + 1)) return false;
    }
    return true;
  }
  function copyValue(value: JsonValue, depth = 0): JsonValue {
    inspect(depth, typeof value === 'string' ? value.length : 0);
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => copyValue(item, depth + 1));
    const result: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value)) {
      inspect(depth, key.length);
      Object.defineProperty(result, key, {
        value: copyValue(value[key], depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  }

  try {
    assertActive();
    if (
      snapshot !== metadata.snapshot ||
      generation !== snapshot.generation ||
      generation !== metadata.generation ||
      !sameLocation(requested, metadata.requested) ||
      requested.reference !== metadata.requested.reference ||
      requested.reference !== publicReference(requested) ||
      session.retrievalUri !== snapshot.entryRetrievalUri ||
      !operationToken ||
      !selectionToken ||
      !['request', 'response'].includes(direction)
    )
      return none('CONTEXT_MISMATCH');
    if (
      metadata.status !== 'ready' ||
      metadata.configuration === 'unsupported' ||
      !metadata.declaration ||
      metadata.propertyName === undefined
    )
      return none('METADATA_UNAVAILABLE');
    target = metadata.targets.find((value) => value.id === targetId);
    if (!target || target.state !== 'resolved' || !target.location) return none('TARGET_UNAVAILABLE');
    if (candidateId === undefined && target.candidateIds.length > 1)
      return none('BRANCH_SELECTION_REQUIRED', 'ambiguous');
    const chosenId = candidateId ?? (target.candidateIds.length === 1 ? target.candidateIds[0] : undefined);
    branch = metadata.candidates.find((value) => value.id === chosenId);
    if (!branch || branch.state !== 'resolved' || !target.candidateIds.includes(branch.id))
      return none('BRANCH_UNAVAILABLE');

    const objects = new Map<string, ResourceGraphObject>();
    for (const object of snapshot.objectLocations) {
      inspect();
      objects.set(identity(object), object);
    }
    const edges = new Map<string, ResourceGraphEdge>();
    for (const edge of snapshot.edges) {
      inspect();
      if (['schema-ref', 'schema-dynamic-ref', 'discriminator-mapping'].includes(edge.kind))
        edges.set(identity({ ownerRetrievalUri: edge.sourceRetrievalUri, pointer: edge.sourcePointer }), edge);
    }
    const raw = (site: Location) =>
      resolvePhysicalJsonPointer(snapshot.nodes.get(site.ownerRetrievalUri)?.document, site.pointer);
    const actualSchema = (site: DiscriminatorSchemaLocation): boolean =>
      objects.get(identity(site))?.kind === 'schema' && site.reference === publicReference(site) && raw(site).found;
    if (![requested, metadata.declaration, target.location, branch.location].every(actualSchema))
      return none('SCHEMA_LOCATION_MISMATCH');
    const declarationValue = record(raw(metadata.declaration).value);
    const discriminator = record(declarationValue?.discriminator);
    if (discriminator?.propertyName !== metadata.propertyName) return none('DECLARATION_MISMATCH');
    const follows = (start: Location, end: Location, allOf = false): boolean => {
      const queue = [{ site: start, depth: 0 }];
      const visited = new Set<string>();
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const { site, depth } = queue[cursor];
        inspect(depth);
        if (sameLocation(site, end)) return true;
        if (visited.has(identity(site))) continue;
        visited.add(identity(site));
        const ref = edges.get(identity(child(site, '$ref')));
        if (ref?.kind === 'schema-ref' && ref.target && ['local', 'loaded'].includes(ref.state))
          queue.push({ site: ref.target, depth: depth + 1 });
        const schema = record(raw(site).value);
        if (allOf && Array.isArray(schema?.allOf))
          for (let i = 0; i < schema.allOf.length; i++) {
            inspect(depth);
            const nested = child(child(site, 'allOf'), i);
            if (objects.get(identity(nested))?.kind === 'schema') queue.push({ site: nested, depth: depth + 1 });
          }
      }
      return false;
    };
    if (!follows(requested, metadata.declaration)) return none('DECLARATION_NOT_REACHABLE');
    if (branch.composition === 'allOf') {
      if (
        metadata.configuration !== 'allOf' ||
        !sameLocation(branch.location, target.location) ||
        !follows(branch.location, metadata.declaration, true)
      )
        return none('BRANCH_IDENTITY_MISMATCH');
    } else {
      const parent = `${metadata.declaration.pointer}/${branch.composition}/`;
      const position = branch.location.pointer.slice(parent.length);
      const alternatives = declarationValue?.[branch.composition];
      if (
        metadata.configuration !== branch.composition ||
        branch.location.ownerRetrievalUri !== metadata.declaration.ownerRetrievalUri ||
        !branch.location.pointer.startsWith(parent) ||
        !/^(0|[1-9]\d*)$/.test(position) ||
        !Array.isArray(alternatives) ||
        Number(position) >= alternatives.length ||
        !follows(branch.location, target.location)
      )
        return none('BRANCH_IDENTITY_MISMATCH');
    }
    if (branch.id !== identity(branch.location)) return none('BRANCH_IDENTITY_MISMATCH');
    if (target.id !== JSON.stringify([target.source, target.key, identity(target.sourceLocation)]))
      return none('TARGET_IDENTITY_MISMATCH');
    if (target.source === 'implicit') {
      const tokens = physicalJsonPointerTokens(target.location.pointer);
      if (
        target.location.ownerRetrievalUri !== snapshot.entryRetrievalUri ||
        tokens?.length !== 3 ||
        tokens[0] !== 'components' ||
        tokens[1] !== 'schemas' ||
        tokens[2] !== target.key ||
        target.rawReference !== target.key ||
        !sameLocation(target.sourceLocation, target.location)
      )
        return none('TARGET_IDENTITY_MISMATCH');
    } else {
      const declarationSite = child(metadata.declaration, 'discriminator');
      const site =
        target.source === 'default'
          ? child(declarationSite, 'defaultMapping')
          : child(child(declarationSite, 'mapping'), target.key ?? '');
      const edge = edges.get(identity(site));
      if (
        !sameLocation(site, target.sourceLocation) ||
        !edge?.target ||
        edge.kind !== 'discriminator-mapping' ||
        !['local', 'loaded'].includes(edge.state) ||
        !sameLocation(edge.target, target.location) ||
        raw(site).value !== target.rawReference
      )
        return none('TARGET_IDENTITY_MISMATCH');
    }

    // Only C-typed positions can be children. D compiles $defs too. Its
    // definitions/contentSchema annotations are only reached by actual references.
    const children = new Map<string, Location[]>();
    for (const object of objects.values()) {
      inspect();
      if (object.kind !== 'schema') continue;
      let pointer = object.pointer;
      while (pointer.includes('/')) {
        inspect();
        pointer = pointer.slice(0, pointer.lastIndexOf('/'));
        const parent = { ownerRetrievalUri: object.ownerRetrievalUri, pointer };
        const key = identity(parent);
        if (objects.get(key)?.kind !== 'schema') continue;
        const keyword = object.pointer.slice(pointer.length + 1).split('/')[0];
        if (!['definitions', 'contentSchema'].includes(keyword)) {
          const nested = children.get(key) ?? [];
          nested.push(object);
          children.set(key, nested);
        }
        break;
      }
    }
    const schemaOwners = new Set([snapshot.entryRetrievalUri]);
    const reachable = new Set<string>();
    const dependencies = [requested, branch.location, target.location].map((site) => ({
      site: site as Location,
      depth: 0,
    }));
    for (let cursor = 0; cursor < dependencies.length; cursor++) {
      const { site, depth } = dependencies[cursor];
      inspect(depth);
      const key = identity(site);
      if (reachable.has(key)) continue;
      if (objects.get(key)?.kind !== 'schema') return none('SNAPSHOT_SCHEMA_DEPENDENCY_UNAVAILABLE');
      reachable.add(key);
      schemaOwners.add(site.ownerRetrievalUri);
      for (const nested of children.get(key) ?? []) {
        inspect(depth);
        dependencies.push({ site: nested, depth: depth + 1 });
      }
      const schema = record(raw(site).value);
      for (const keyword of ['$ref', '$dynamicRef'] as const) {
        if (!schema || !exampleHasOwn(schema, keyword)) continue;
        inspect(depth);
        const edge = edges.get(identity(child(site, keyword)));
        if (
          typeof schema[keyword] !== 'string' ||
          edge?.kind !== (keyword === '$ref' ? 'schema-ref' : 'schema-dynamic-ref') ||
          !['local', 'loaded'].includes(edge.state) ||
          !edge.target ||
          objects.get(identity(edge.target))?.kind !== 'schema'
        )
          return none('SNAPSHOT_SCHEMA_DEPENDENCY_UNAVAILABLE');
        if (keyword === '$dynamicRef') {
          const fragment = decodeURIComponent(edge.fragment.slice(1));
          // C exposes the initial target, not the runtime dynamic-scope closure.
          // Non-dynamic fragments have the same dependency as $ref (Core 8.2.3.2).
          if (fragment && !fragment.startsWith('/') && record(raw(edge.target).value)?.$dynamicAnchor === fragment)
            return none('DYNAMIC_SCHEMA_DEPENDENCY_UNAVAILABLE');
        }
        dependencies.push({ site: edge.target, depth: depth + 1 });
      }
    }

    const registeredMatches = (): boolean => {
      for (const owner of schemaOwners) {
        inspect();
        const node = snapshot.nodes.get(owner);
        const registered = registeredSchemaDocument(session, owner);
        if (!node || registered === undefined || !equalContent(node.document, registered)) return false;
      }
      return true;
    };
    if (!registeredMatches()) return none('SESSION_SNAPSHOT_CONTENT_MISMATCH');
    generationCalls++;
    generationResult = await generateSchemaExample(session, branch.location.reference, {
      direction,
      signal,
      limits: generatorLimits,
    });
    assertActive();
    if (generationResult.status !== 'value' || generationResult.validation !== 'valid')
      return none('GENERATION_DID_NOT_PRODUCE_VALID_VALUE', 'generation-failed');
    const value = copyValue(generationResult.value);
    const object = record(value);
    if (!object) return none('DISCRIMINATOR_REQUIRES_OBJECT', 'seed-not-object');
    if (target.source !== 'default') {
      if (typeof target.key !== 'string') return none('MAPPING_KEY_UNAVAILABLE');
      inspect(0, metadata.propertyName.length + target.key.length);
      Object.defineProperty(object, metadata.propertyName, {
        value: target.key,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    for (const [check, reference] of [
      ['target', target.location.reference],
      ['branch', branch.location.reference],
      ['root', requested.reference],
    ] as const) {
      assertActive();
      if (validationCalls >= limits.maxValidationCalls) throw new GenerationStopped('budget-exceeded');
      validationCalls++;
      try {
        validations[check] = await evaluateSchemaDocumentDirectionally(session, reference, value, direction, {
          signal,
        });
      } catch (error) {
        assertActive();
        diagnostics.push({
          code: 'DIRECTIONAL_EVALUATION_UNAVAILABLE',
          check,
          errorCode: record(error)?.code as string | undefined,
        });
        return finish({ status: 'none', reason: 'unavailable' });
      }
      assertActive();
    }
    if (!registeredMatches()) return none('SESSION_SNAPSHOT_CONTENT_MISMATCH');
    hint = selectSchemaDiscriminator(
      metadata,
      { status: 'known', value, source: 'generated' },
      { signal, missingPropertyValidated: validations.root?.valid },
    );
    for (const check of ['target', 'branch', 'root'] as const)
      if (!validations[check]?.valid) return none(`${check.toUpperCase()}_INVALID_AFTER_SEED`, `${check}-invalid`);
    const propertyPointer = `/${metadata.propertyName.replace(/~/g, '~0').replace(/\//g, '~1')}`;
    const annotationId = `https://json-schema.org/keyword/${direction === 'request' ? 'readOnly' : 'writeOnly'}`;
    if (
      exampleHasOwn(object, metadata.propertyName) &&
      Object.values(validations).some((result) =>
        result.annotations.some(
          (annotation) =>
            annotation.instanceLocation === propertyPointer &&
            annotation.keywordId === annotationId &&
            annotation.values.includes(true),
        ),
      )
    )
      return none('DISCRIMINATOR_DIRECTION_INCOMPATIBLE', 'direction-incompatible');
    if (
      !hint.target?.location ||
      !sameLocation(hint.target.location, target.location) ||
      !hint.candidates.some((candidate) => candidate.id === branch!.id)
    )
      return none('GENERATED_VALUE_SELECTS_ANOTHER_TARGET', 'selection-conflict');
    assertActive();
    return finish({ status: 'value', value });
  } catch (error) {
    if (error instanceof GenerationStopped) return none(error.reason.toUpperCase().replace(/-/g, '_'), error.reason);
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return none('ABORTED', 'aborted');
    diagnostics.push({ code: 'GENERATION_UNAVAILABLE', errorCode: record(error)?.code as string | undefined });
    return finish({ status: 'none', reason: 'unavailable' });
  }
}
