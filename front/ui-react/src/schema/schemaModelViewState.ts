import type { SchemaModelDisplay, SchemaModelsProjection } from './schemaModelProjection';

export type SchemaEngineViewStatus = 'inactive' | 'loading' | 'ready' | 'error';

export type SchemaModelsProjectionState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly retrievalUri: string }
  | { readonly status: 'ready'; readonly retrievalUri: string; readonly result: SchemaModelsProjection }
  | { readonly status: 'error'; readonly retrievalUri: string; readonly message: string };

export type SchemaModelViewNotice =
  | { readonly kind: 'loading' }
  | { readonly kind: 'fallback'; readonly reason: 'engine' | 'projection' }
  | {
      readonly kind: 'degraded';
      readonly issueCount: number;
      readonly modelCount: number;
      readonly models: string[];
      readonly keywords: string[];
    };

export interface SelectSchemaModelViewOptions {
  readonly isOas31: boolean;
  readonly engineStatus: SchemaEngineViewStatus;
  readonly retrievalUri: string | null;
  readonly projectionState: SchemaModelsProjectionState;
  readonly legacyModels: SchemaModelDisplay[];
}

export interface SchemaModelView {
  readonly models: SchemaModelDisplay[];
  readonly notice: SchemaModelViewNotice | null;
}

export function selectSchemaModelView(options: SelectSchemaModelViewOptions): SchemaModelView {
  const { isOas31, engineStatus, retrievalUri, projectionState, legacyModels } = options;
  if (!isOas31) return { models: legacyModels, notice: null };

  if (engineStatus === 'error') {
    return { models: legacyModels, notice: { kind: 'fallback', reason: 'engine' } };
  }
  if (engineStatus !== 'ready' || !retrievalUri) {
    return { models: legacyModels, notice: { kind: 'loading' } };
  }
  if (projectionState.status === 'error' && projectionState.retrievalUri === retrievalUri) {
    return { models: legacyModels, notice: { kind: 'fallback', reason: 'projection' } };
  }
  if (projectionState.status !== 'ready' || projectionState.retrievalUri !== retrievalUri) {
    return { models: legacyModels, notice: { kind: 'loading' } };
  }

  const warnings = projectionState.result.diagnostics.filter(({ severity }) => severity === 'warning');
  const issueCount = warnings.length + projectionState.result.failures.length;
  if (issueCount === 0) return { models: projectionState.result.models, notice: null };

  const models = Array.from(
    new Set([
      ...warnings.map(({ modelName }) => modelName),
      ...projectionState.result.failures.map(({ modelName }) => modelName),
    ]),
  );
  const keywords = Array.from(
    new Set([
      ...warnings.map(({ keyword, code }) => keyword ?? code),
      ...projectionState.result.failures.map(({ code }) => code ?? 'projection'),
    ]),
  );
  return {
    models: projectionState.result.models,
    notice: {
      kind: 'degraded',
      issueCount,
      modelCount: models.length,
      models,
      keywords,
    },
  };
}
