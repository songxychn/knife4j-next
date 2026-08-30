import { describe, expect, test, vi } from 'vitest';
import type { SchemaFieldNode } from 'knife4j-core';
import type { SchemaDisplayProjector } from '../../schema/schemaDisplayProjection';
import {
  filterApiDocSchemaFields,
  projectApiDocSchemaRegions,
  REQUEST_BODY_REGION_KEY,
  responseSchemaRegionKey,
} from './apiDocSchemaProjection';

function field(name: string, options: Partial<SchemaFieldNode> = {}): SchemaFieldNode {
  return { name, type: 'string', required: false, ...options };
}

describe('filterApiDocSchemaFields', () => {
  test('removes readOnly request fields and writeOnly response fields recursively', () => {
    const fields = [
      field('visible'),
      field('readOnly', { readOnly: true }),
      field('writeOnly', { writeOnly: true }),
      field('nested', {
        type: 'object',
        children: [field('nestedReadOnly', { readOnly: true }), field('nestedWriteOnly', { writeOnly: true })],
      }),
    ];

    expect(filterApiDocSchemaFields(fields, 'request')).toEqual([
      field('visible'),
      field('writeOnly', { writeOnly: true }),
      field('nested', { type: 'object', children: [field('nestedWriteOnly', { writeOnly: true })] }),
    ]);
    expect(filterApiDocSchemaFields(fields, 'response')).toEqual([
      field('visible'),
      field('readOnly', { readOnly: true }),
      field('nested', { type: 'object', children: [field('nestedReadOnly', { readOnly: true })] }),
    ]);
  });
});

describe('projectApiDocSchemaRegions', () => {
  test('keeps region order, filters access modes, attaches diagnostics, and isolates failures', async () => {
    const projector: SchemaDisplayProjector = {
      project: vi.fn(),
      projectValue: vi.fn(async (schema) => {
        const marker = (schema as { marker?: string }).marker;
        if (marker === 'broken') throw Object.assign(new Error('Unavailable response'), { code: 'RESOURCE_NOT_FOUND' });
        return {
          fields: [
            field(marker ?? 'unknown'),
            field('readOnly', { readOnly: true }),
            field('writeOnly', { writeOnly: true }),
          ],
          diagnostics:
            marker === 'request'
              ? [
                  {
                    code: 'UNREPRESENTABLE_KEYWORD' as const,
                    severity: 'warning' as const,
                    schemaUri: 'https://docs.knife4j.example/v3/api-docs',
                    path: '$.if',
                    keyword: 'if',
                  },
                ]
              : [],
        };
      }),
    };
    const targets = [
      {
        key: REQUEST_BODY_REGION_KEY,
        schema: { marker: 'request' },
        mode: 'request' as const,
        operation: {
          responses: {},
          'x-validation-groups': { Create: ['writeOnly'] },
        },
      },
      { key: responseSchemaRegionKey('200'), schema: { marker: 'response' }, mode: 'response' as const },
      { key: responseSchemaRegionKey('400'), schema: { marker: 'broken' }, mode: 'response' as const },
    ];

    const result = await projectApiDocSchemaRegions(targets, projector);

    expect(result.regions.map(({ key }) => key)).toEqual([REQUEST_BODY_REGION_KEY, responseSchemaRegionKey('200')]);
    expect(result.regions[0].fields).toEqual([
      field('request'),
      field('writeOnly', { writeOnly: true, required: true }),
    ]);
    expect(result.regions[1].fields.map(({ name }) => name)).toEqual(['response', 'readOnly']);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ regionKey: REQUEST_BODY_REGION_KEY, keyword: 'if' }),
    ]);
    expect(result.failures).toEqual([
      {
        regionKey: responseSchemaRegionKey('400'),
        code: 'RESOURCE_NOT_FOUND',
        message: 'Unavailable response',
      },
    ]);
  });

  test('caps projection concurrency and propagates cancellation', async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const projector: SchemaDisplayProjector = {
      project: vi.fn(),
      projectValue: vi.fn(
        () =>
          new Promise((resolve) => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            releases.push(() => {
              active -= 1;
              resolve({ fields: [], diagnostics: [] });
            });
          }),
      ),
    };
    const targets = Array.from({ length: 6 }, (_, index) => ({
      key: responseSchemaRegionKey(String(200 + index)),
      schema: { type: 'string' },
      mode: 'response' as const,
    }));
    const pending = projectApiDocSchemaRegions(targets, projector);

    await vi.waitFor(() => expect(releases).toHaveLength(4));
    expect(maxActive).toBe(4);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());
    await expect(pending).resolves.toMatchObject({ failures: [] });

    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const abortingProjector: SchemaDisplayProjector = {
      project: vi.fn(),
      projectValue: vi.fn().mockRejectedValue(abortError),
    };
    await expect(projectApiDocSchemaRegions(targets, abortingProjector)).rejects.toBe(abortError);

    const controller = new AbortController();
    const ignoringProjector: SchemaDisplayProjector = {
      project: vi.fn(),
      projectValue: vi.fn(async () => {
        controller.abort();
        return { fields: [], diagnostics: [] };
      }),
    };
    await expect(
      projectApiDocSchemaRegions(targets.slice(0, 1), ignoringProjector, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
