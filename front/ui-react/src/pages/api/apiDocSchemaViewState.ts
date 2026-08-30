import type { SchemaFieldNode } from 'knife4j-core';
import type { ApiDocSchemaProjection } from './apiDocSchemaProjection';

export type ApiDocSchemaEngineViewStatus = 'inactive' | 'loading' | 'ready' | 'error';

export type ApiDocSchemaProjectionIdentity = object;

export type ApiDocSchemaProjectionState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly identity: ApiDocSchemaProjectionIdentity }
  | {
      readonly status: 'ready';
      readonly identity: ApiDocSchemaProjectionIdentity;
      readonly result: ApiDocSchemaProjection;
    }
  | {
      readonly status: 'error';
      readonly identity: ApiDocSchemaProjectionIdentity;
      readonly message: string;
    };

export type ApiDocSchemaViewNotice =
  | { readonly kind: 'loading' }
  | { readonly kind: 'fallback'; readonly reason: 'engine' | 'projection' }
  | {
      readonly kind: 'degraded';
      readonly issueCount: number;
      readonly regionCount: number;
      readonly regions: string[];
      readonly keywords: string[];
    };

export interface ApiDocSchemaLegacyRegion {
  readonly key: string;
  readonly fields: SchemaFieldNode[];
}

export interface SelectApiDocSchemaViewOptions {
  readonly isOas31: boolean;
  readonly hasTargets: boolean;
  readonly engineStatus: ApiDocSchemaEngineViewStatus;
  readonly currentIdentity: ApiDocSchemaProjectionIdentity | null;
  readonly projectionState: ApiDocSchemaProjectionState;
  readonly legacyFields: ReadonlyArray<ApiDocSchemaLegacyRegion>;
}

export interface ApiDocSchemaView {
  readonly fieldsByRegion: Record<string, SchemaFieldNode[]>;
  readonly notice: ApiDocSchemaViewNotice | null;
}

function fieldsByRegion(regions: ReadonlyArray<ApiDocSchemaLegacyRegion>): Record<string, SchemaFieldNode[]> {
  return Object.fromEntries(regions.map(({ key, fields }) => [key, fields]));
}

export function selectApiDocSchemaView(options: SelectApiDocSchemaViewOptions): ApiDocSchemaView {
  const { isOas31, hasTargets, engineStatus, currentIdentity, projectionState, legacyFields } = options;
  const fallbackFields = fieldsByRegion(legacyFields);
  if (!isOas31 || !hasTargets) return { fieldsByRegion: fallbackFields, notice: null };

  if (engineStatus === 'error') {
    return { fieldsByRegion: fallbackFields, notice: { kind: 'fallback', reason: 'engine' } };
  }
  if (engineStatus !== 'ready' || !currentIdentity) {
    return { fieldsByRegion: fallbackFields, notice: { kind: 'loading' } };
  }
  if (projectionState.status === 'error' && projectionState.identity === currentIdentity) {
    return { fieldsByRegion: fallbackFields, notice: { kind: 'fallback', reason: 'projection' } };
  }
  if (
    (projectionState.status !== 'ready' && projectionState.status !== 'loading') ||
    projectionState.identity !== currentIdentity
  ) {
    return { fieldsByRegion: fallbackFields, notice: { kind: 'loading' } };
  }
  if (projectionState.status === 'loading') {
    return { fieldsByRegion: fallbackFields, notice: { kind: 'loading' } };
  }

  const projectedFields = { ...fallbackFields };
  for (const region of projectionState.result.regions) projectedFields[region.key] = region.fields;

  const warnings = projectionState.result.diagnostics.filter(({ severity }) => severity === 'warning');
  const issueCount = warnings.length + projectionState.result.failures.length;
  if (issueCount === 0) return { fieldsByRegion: projectedFields, notice: null };

  const regions = Array.from(
    new Set([
      ...warnings.map(({ regionKey }) => regionKey),
      ...projectionState.result.failures.map(({ regionKey }) => regionKey),
    ]),
  );
  const keywords = Array.from(
    new Set([
      ...warnings.map(({ keyword, code }) => keyword ?? code),
      ...projectionState.result.failures.map(({ code }) => code ?? 'projection'),
    ]),
  );
  return {
    fieldsByRegion: projectedFields,
    notice: {
      kind: 'degraded',
      issueCount,
      regionCount: regions.length,
      regions,
      keywords,
    },
  };
}
