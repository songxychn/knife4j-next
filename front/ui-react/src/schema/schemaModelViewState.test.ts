import { describe, expect, test } from 'vitest';
import type { SchemaModelDisplay, SchemaModelsProjection } from './schemaModelProjection';
import { selectSchemaModelView, type SchemaModelsProjectionState } from './schemaModelViewState';

const legacyModels: SchemaModelDisplay[] = [
  { name: 'Pet', fields: [{ name: 'legacy', type: 'string', required: false }], source: 'legacy' },
];

const projection: SchemaModelsProjection = {
  models: [{ name: 'Pet', fields: [{ name: 'engine', type: 'string', required: false }], source: 'schema-engine' }],
  diagnostics: [],
  failures: [],
};

const readyState = (result: SchemaModelsProjection = projection): SchemaModelsProjectionState => ({
  status: 'ready',
  retrievalUri: 'https://docs.knife4j.example/v3/api-docs',
  result,
});

describe('selectSchemaModelView', () => {
  test('keeps OAS 3.0 synchronous and independent from SchemaEngine state', () => {
    expect(
      selectSchemaModelView({
        isOas31: false,
        engineStatus: 'loading',
        retrievalUri: 'https://docs.knife4j.example/v3/api-docs',
        projectionState: { status: 'loading', retrievalUri: 'https://docs.knife4j.example/v3/api-docs' },
        legacyModels,
      }),
    ).toEqual({ models: legacyModels, notice: null });
  });

  test('shows the legacy tree with an explicit loading notice until the matching projection is ready', () => {
    const view = selectSchemaModelView({
      isOas31: true,
      engineStatus: 'ready',
      retrievalUri: 'https://docs.knife4j.example/v3/api-docs',
      projectionState: { status: 'loading', retrievalUri: 'https://docs.knife4j.example/v3/api-docs' },
      legacyModels,
    });

    expect(view).toEqual({ models: legacyModels, notice: { kind: 'loading' } });
  });

  test('uses only a projection produced for the active retrieval URI', () => {
    const stale = selectSchemaModelView({
      isOas31: true,
      engineStatus: 'ready',
      retrievalUri: 'https://docs.knife4j.example/next',
      projectionState: readyState(),
      legacyModels,
    });
    const current = selectSchemaModelView({
      isOas31: true,
      engineStatus: 'ready',
      retrievalUri: 'https://docs.knife4j.example/v3/api-docs',
      projectionState: readyState(),
      legacyModels,
    });

    expect(stale).toEqual({ models: legacyModels, notice: { kind: 'loading' } });
    expect(current).toEqual({ models: projection.models, notice: null });
  });

  test('keeps legacy fields and distinguishes session and projection failures', () => {
    expect(
      selectSchemaModelView({
        isOas31: true,
        engineStatus: 'error',
        retrievalUri: 'https://docs.knife4j.example/v3/api-docs',
        projectionState: { status: 'idle' },
        legacyModels,
      }).notice,
    ).toEqual({ kind: 'fallback', reason: 'engine' });

    expect(
      selectSchemaModelView({
        isOas31: true,
        engineStatus: 'ready',
        retrievalUri: 'https://docs.knife4j.example/v3/api-docs',
        projectionState: {
          status: 'error',
          retrievalUri: 'https://docs.knife4j.example/v3/api-docs',
          message: 'Projection failed',
        },
        legacyModels,
      }).notice,
    ).toEqual({ kind: 'fallback', reason: 'projection' });
  });

  test('summarizes warning diagnostics and per-model fallbacks without treating cycle info as degradation', () => {
    const result: SchemaModelsProjection = {
      ...projection,
      diagnostics: [
        {
          modelName: 'Pet',
          code: 'CIRCULAR_REFERENCE',
          severity: 'info',
          schemaUri: 'https://docs.knife4j.example/pet',
          path: '$.properties.parent',
          keyword: '$ref',
        },
        {
          modelName: 'Pet',
          code: 'UNREPRESENTABLE_KEYWORD',
          severity: 'warning',
          schemaUri: 'https://docs.knife4j.example/pet',
          path: '$.if',
          keyword: 'if',
        },
      ],
      failures: [{ modelName: 'Order', code: 'RESOURCE_NOT_FOUND', message: 'Missing resource' }],
    };

    const view = selectSchemaModelView({
      isOas31: true,
      engineStatus: 'ready',
      retrievalUri: 'https://docs.knife4j.example/v3/api-docs',
      projectionState: readyState(result),
      legacyModels,
    });

    expect(view.notice).toEqual({
      kind: 'degraded',
      issueCount: 2,
      modelCount: 2,
      models: ['Pet', 'Order'],
      keywords: ['if', 'RESOURCE_NOT_FOUND'],
    });
  });
});
