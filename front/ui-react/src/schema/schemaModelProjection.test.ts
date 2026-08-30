import { describe, expect, test, vi } from 'vitest';
import type { SwaggerDoc } from '../types/swagger';
import type { SchemaDisplayProjector } from './schemaDisplayProjection';
import { buildLegacySchemaModels, projectSchemaModels } from './schemaModelProjection';

const document: SwaggerDoc = {
  openapi: '3.1.1',
  info: { title: 'Model projection fixture', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      Good: {
        title: 'Good title',
        description: 'Good description',
        type: 'object',
        properties: { legacy: { type: 'string' } },
      },
      'Folder/Broken~v1': {
        type: 'object',
        properties: { fallback: { type: 'integer' } },
      },
    },
  },
};

const schemas = document.components!.schemas!;

describe('schema model projection orchestration', () => {
  test('builds the unchanged synchronous field tree used by legacy and fallback paths', () => {
    const models = buildLegacySchemaModels(schemas, document);

    expect(models).toEqual([
      expect.objectContaining({
        name: 'Good',
        title: 'Good title',
        description: 'Good description',
        source: 'legacy',
        fields: [expect.objectContaining({ name: 'legacy', type: 'string' })],
      }),
      expect.objectContaining({
        name: 'Folder/Broken~v1',
        source: 'legacy',
        fields: [expect.objectContaining({ name: 'fallback', type: 'integer' })],
      }),
    ]);
  });

  test('keeps model order, attaches diagnostics, and falls back only for the failed model', async () => {
    const projector: SchemaDisplayProjector = {
      project: vi.fn(async (reference) => {
        if (reference.includes('Broken'))
          throw Object.assign(new Error('Unavailable model'), { code: 'RESOURCE_NOT_FOUND' });
        return {
          fields: [{ name: 'engine', type: 'string', required: true }],
          diagnostics: [
            {
              code: 'UNREPRESENTABLE_KEYWORD',
              severity: 'warning',
              schemaUri: 'https://docs.knife4j.example/v3/api-docs#/components/schemas/Good',
              path: '$.if',
              keyword: 'if',
            },
          ],
        };
      }),
    };

    const result = await projectSchemaModels(schemas, document, projector);

    expect(projector.project).toHaveBeenNthCalledWith(1, '#/components/schemas/Good', expect.any(Object));
    expect(projector.project).toHaveBeenNthCalledWith(2, '#/components/schemas/Folder~1Broken~0v1', expect.any(Object));
    expect(result.models).toEqual([
      expect.objectContaining({
        name: 'Good',
        source: 'schema-engine',
        fields: [expect.objectContaining({ name: 'engine' })],
      }),
      expect.objectContaining({
        name: 'Folder/Broken~v1',
        source: 'legacy-fallback',
        fields: [expect.objectContaining({ name: 'fallback' })],
      }),
    ]);
    expect(result.diagnostics).toEqual([expect.objectContaining({ modelName: 'Good', keyword: 'if' })]);
    expect(result.failures).toEqual([
      { modelName: 'Folder/Broken~v1', code: 'RESOURCE_NOT_FOUND', message: 'Unavailable model' },
    ]);
  });

  test('propagates cancellation instead of converting it into a model fallback', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const projector: SchemaDisplayProjector = {
      project: vi.fn().mockRejectedValue(abortError),
    };

    await expect(projectSchemaModels(schemas, document, projector)).rejects.toBe(abortError);
  });
});
