import { describe, expect, test } from 'vitest';
import type { SchemaFieldNode } from 'knife4j-core';
import type { ApiDocSchemaProjection } from './apiDocSchemaProjection';
import { selectApiDocSchemaView, type ApiDocSchemaProjectionState } from './apiDocSchemaViewState';

const currentIdentity = {};
const staleIdentity = {};
const legacyFields: ReadonlyArray<{ key: string; fields: SchemaFieldNode[] }> = [
  { key: 'requestBody', fields: [{ name: 'legacyRequest', type: 'string', required: false }] },
  { key: 'response:200', fields: [{ name: 'legacyResponse', type: 'string', required: false }] },
  { key: 'response:400', fields: [{ name: 'legacyError', type: 'string', required: false }] },
];
const projection: ApiDocSchemaProjection = {
  regions: [
    { key: 'requestBody', fields: [{ name: 'engineRequest', type: 'string', required: false }] },
    { key: 'response:200', fields: [{ name: 'engineResponse', type: 'string', required: false }] },
  ],
  diagnostics: [],
  failures: [],
};

function readyState(result: ApiDocSchemaProjection = projection): ApiDocSchemaProjectionState {
  return { status: 'ready', identity: currentIdentity, result };
}

describe('selectApiDocSchemaView', () => {
  test('keeps OAS 3.0 synchronous and skips SchemaEngine when no schema regions exist', () => {
    expect(
      selectApiDocSchemaView({
        isOas31: false,
        hasTargets: true,
        engineStatus: 'loading',
        currentIdentity: null,
        projectionState: { status: 'idle' },
        legacyFields,
      }),
    ).toEqual({
      fieldsByRegion: {
        requestBody: legacyFields[0].fields,
        'response:200': legacyFields[1].fields,
        'response:400': legacyFields[2].fields,
      },
      notice: null,
    });

    expect(
      selectApiDocSchemaView({
        isOas31: true,
        hasTargets: false,
        engineStatus: 'error',
        currentIdentity: null,
        projectionState: { status: 'idle' },
        legacyFields: [],
      }),
    ).toEqual({ fieldsByRegion: {}, notice: null });
  });

  test('shows legacy fields while loading and rejects stale projection identities', () => {
    const loading = selectApiDocSchemaView({
      isOas31: true,
      hasTargets: true,
      engineStatus: 'ready',
      currentIdentity,
      projectionState: { status: 'loading', identity: currentIdentity },
      legacyFields,
    });
    const stale = selectApiDocSchemaView({
      isOas31: true,
      hasTargets: true,
      engineStatus: 'ready',
      currentIdentity,
      projectionState: { status: 'ready', identity: staleIdentity, result: projection },
      legacyFields,
    });

    expect(loading.fieldsByRegion.requestBody[0].name).toBe('legacyRequest');
    expect(loading.notice).toEqual({ kind: 'loading' });
    expect(stale.notice).toEqual({ kind: 'loading' });
  });

  test('distinguishes engine and whole-projection fallback', () => {
    expect(
      selectApiDocSchemaView({
        isOas31: true,
        hasTargets: true,
        engineStatus: 'error',
        currentIdentity: null,
        projectionState: { status: 'idle' },
        legacyFields,
      }).notice,
    ).toEqual({ kind: 'fallback', reason: 'engine' });

    expect(
      selectApiDocSchemaView({
        isOas31: true,
        hasTargets: true,
        engineStatus: 'ready',
        currentIdentity,
        projectionState: { status: 'error', identity: currentIdentity, message: 'Projection failed' },
        legacyFields,
      }).notice,
    ).toEqual({ kind: 'fallback', reason: 'projection' });
  });

  test('uses successful projected regions and falls back only failed regions with a warning summary', () => {
    const result: ApiDocSchemaProjection = {
      ...projection,
      diagnostics: [
        {
          regionKey: 'requestBody',
          code: 'CIRCULAR_REFERENCE',
          severity: 'info',
          schemaUri: 'https://docs.knife4j.example/v3/api-docs',
          path: '$.properties.parent',
          keyword: '$ref',
        },
        {
          regionKey: 'requestBody',
          code: 'UNREPRESENTABLE_KEYWORD',
          severity: 'warning',
          schemaUri: 'https://docs.knife4j.example/v3/api-docs',
          path: '$.if',
          keyword: 'if',
        },
      ],
      failures: [{ regionKey: 'response:400', code: 'RESOURCE_NOT_FOUND', message: 'Missing resource' }],
    };
    const view = selectApiDocSchemaView({
      isOas31: true,
      hasTargets: true,
      engineStatus: 'ready',
      currentIdentity,
      projectionState: readyState(result),
      legacyFields,
    });

    expect(view.fieldsByRegion.requestBody[0].name).toBe('engineRequest');
    expect(view.fieldsByRegion['response:200'][0].name).toBe('engineResponse');
    expect(view.fieldsByRegion['response:400'][0].name).toBe('legacyError');
    expect(view.notice).toEqual({
      kind: 'degraded',
      issueCount: 2,
      regionCount: 2,
      regions: ['requestBody', 'response:400'],
      keywords: ['if', 'RESOURCE_NOT_FOUND'],
    });
  });
});
