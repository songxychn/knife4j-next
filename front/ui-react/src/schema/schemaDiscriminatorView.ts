import type { ExampleRepresentation, SchemaFieldNode } from 'knife4j-core';
import type { ResourceGraphSnapshot } from './externalResourceGraph';
import {
  createSchemaDiscriminatorIndex,
  discriminatorExampleInput,
  discriminatorSchemaLocation,
  selectSchemaDiscriminator,
  type DiscriminatorCandidate,
  type DiscriminatorSchemaLocation,
  type DiscriminatorTarget,
  type SchemaDiscriminatorIndex,
  type SchemaDiscriminatorMetadata,
  type SchemaDiscriminatorSelection,
} from './schemaDiscriminator';

function componentPointer(name: string): string {
  return `#/components/schemas/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

const indexes = new WeakMap<ResourceGraphSnapshot, SchemaDiscriminatorIndex>();

export function schemaDiscriminatorIndexFor(snapshot: ResourceGraphSnapshot): SchemaDiscriminatorIndex {
  const existing = indexes.get(snapshot);
  if (existing) return existing;
  const created = createSchemaDiscriminatorIndex(snapshot);
  indexes.set(snapshot, created);
  return created;
}

export function componentDiscriminatorLocation(entryRetrievalUri: string, name: string): DiscriminatorSchemaLocation {
  return discriminatorSchemaLocation(
    { ownerRetrievalUri: entryRetrievalUri, pointer: componentPointer(name) },
    entryRetrievalUri,
  );
}

export function describeSchemaDiscriminator(
  snapshot: ResourceGraphSnapshot,
  location: DiscriminatorSchemaLocation,
  options?: { readonly signal?: AbortSignal },
): SchemaDiscriminatorMetadata {
  return schemaDiscriminatorIndexFor(snapshot).describe(location, options);
}

export function schemaDiscriminatorAllowsModelRoute(
  location: DiscriminatorSchemaLocation | undefined,
): location is DiscriminatorSchemaLocation & { readonly componentName: string } {
  return typeof location?.componentName === 'string';
}

export function schemaDiscriminatorTargetLabel(target: DiscriminatorTarget): string {
  if (schemaDiscriminatorAllowsModelRoute(target.location)) return target.location.componentName;
  if (target.location?.reference) return target.location.reference;
  return typeof target.rawReference === 'string' ? target.rawReference : JSON.stringify(target.rawReference);
}

export function schemaDiscriminatorFieldName(target: DiscriminatorTarget): string {
  if (target.source === 'default') return 'defaultMapping';
  if (target.source === 'implicit') return `implicit[${String(target.key)}]`;
  return `mapping[${String(target.key)}]`;
}

export function attachDiscriminatorMappingFields(
  fields: readonly SchemaFieldNode[],
  metadata: SchemaDiscriminatorMetadata,
): SchemaFieldNode[] {
  if (metadata.status !== 'ready' || metadata.propertyName === undefined) return [...fields];
  return [
    ...fields,
    ...metadata.targets.map((target) => {
      const resolved = target.state === 'resolved';
      return {
        name: schemaDiscriminatorFieldName(target),
        type: 'object',
        required: false,
        ...(schemaDiscriminatorAllowsModelRoute(target.location) ? { refName: target.location.componentName } : {}),
        description: schemaDiscriminatorTargetLabel(target),
        ...(!resolved ? { truncated: true as const, truncationReason: 'reference-unavailable' as const } : {}),
      };
    }),
  ];
}

export function selectDiscriminatorExampleHint(
  metadata: SchemaDiscriminatorMetadata,
  representation: ExampleRepresentation | undefined,
  options: { readonly missingPropertyValidated?: boolean; readonly signal?: AbortSignal } = {},
): SchemaDiscriminatorSelection {
  const input = representation
    ? discriminatorExampleInput(representation)
    : { status: 'no-data' as const, source: 'unavailable-logical-data' };
  return selectSchemaDiscriminator(metadata, input, options);
}

export function discriminatorMetadataVisible(metadata: SchemaDiscriminatorMetadata | undefined): boolean {
  return Boolean(metadata && metadata.status !== 'no-discriminator' && metadata.status !== 'unsupported-version');
}

export function discriminatorCandidateChoices(
  metadata: SchemaDiscriminatorMetadata,
  target: DiscriminatorTarget,
): readonly DiscriminatorCandidate[] {
  return metadata.candidates.filter((candidate) => target.candidateIds.includes(candidate.id));
}

export function selectedDiscriminatorCandidateId(
  selectedId: string | undefined,
  choices: readonly Pick<DiscriminatorCandidate, 'id'>[],
): string | undefined {
  if (selectedId !== undefined && choices.some((candidate) => candidate.id === selectedId)) return selectedId;
  return choices.length === 1 ? choices[0]?.id : undefined;
}

export function preferredDiscriminatorSchemaLocation<
  T extends {
    readonly schemaLocation?: { readonly ownerRetrievalUri: string; readonly pointer: string };
    readonly mediaType?: string;
    readonly layer?: string;
    readonly group?: string;
    readonly statusCode?: string;
  },
>(
  targets: readonly T[],
  match: { readonly role: 'body' | 'response'; readonly mediaType?: string; readonly statusCode?: string },
): T['schemaLocation'] {
  if (match.mediaType === undefined) return undefined;
  return targets.find((item) => {
    if (!item.schemaLocation || item.layer !== 'media' || item.mediaType !== match.mediaType) return false;
    if (match.role === 'body') return item.group?.startsWith('body:');
    return item.statusCode === match.statusCode && Boolean(item.group?.startsWith('response:'));
  })?.schemaLocation;
}

export function isDynamicScopeGenerationUnavailable(code: string | undefined): boolean {
  return code === 'DYNAMIC_SCHEMA_DEPENDENCY_UNAVAILABLE';
}

export function discriminatorLocationFromOpenApi(
  snapshot: ResourceGraphSnapshot,
  location: { readonly ownerRetrievalUri: string; readonly pointer: string } | undefined,
): DiscriminatorSchemaLocation | undefined {
  if (!location) return undefined;
  return discriminatorSchemaLocation(location, snapshot.entryRetrievalUri);
}
