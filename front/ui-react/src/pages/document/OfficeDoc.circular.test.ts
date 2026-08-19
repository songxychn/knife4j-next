import { buildExportDocument, type ExportSchemaField } from 'knife4j-core';
import { describe, expect, test } from 'vitest';
import type { MenuTag, SchemaObject, SwaggerDoc } from '../../types/swagger';

function responseFields(
  schema: SchemaObject,
  schemas: Record<string, SchemaObject> = {},
): readonly ExportSchemaField[] {
  const doc: SwaggerDoc = {
    openapi: '3.0.3',
    info: { title: 'Circular schema', version: '1.0.0' },
    paths: {},
    components: { schemas },
  };
  const tags: MenuTag[] = [
    {
      tag: 'Test',
      operations: [
        {
          key: 'test/get',
          path: '/test',
          method: 'get',
          summary: 'Test schema',
          operation: {
            responses: {
              200: {
                description: 'ok',
                content: { 'application/json': { schema } },
              },
            },
          },
        },
      ],
    },
  ];

  return buildExportDocument(doc, tags).tags[0].operations[0].responses[0].schema?.fields ?? [];
}

describe('ExportDocument schema recursion guard', () => {
  test('marks a direct self reference as truncated without overflowing', () => {
    const fields = responseFields(
      { $ref: '#/components/schemas/Node' },
      {
        Node: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            child: { $ref: '#/components/schemas/Node' },
          },
        },
      },
    );

    expect(fields.map((field) => field.fieldPath)).toContain('name');
    expect(fields.some((field) => field.fieldPath === 'child' && field.truncated)).toBe(true);
  });

  test('marks an indirect reference cycle as truncated', () => {
    const fields = responseFields(
      { $ref: '#/components/schemas/A' },
      {
        A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
        B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
      },
    );

    expect(fields.some((field) => field.fieldPath === 'b.a' && field.truncated)).toBe(true);
  });

  test('marks an over-deep object chain as truncated', () => {
    let schema: SchemaObject = { type: 'string' };
    for (let index = 0; index < 32; index += 1) {
      schema = { type: 'object', properties: { child: schema } };
    }

    expect(responseFields(schema).some((field) => field.truncated)).toBe(true);
  });

  test('keeps required flags and nested paths for a normal schema', () => {
    const fields = responseFields({
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'integer', format: 'int64' },
        profile: {
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string', format: 'email' } },
        },
      },
    });

    expect(fields.find((field) => field.fieldPath === 'id')).toMatchObject({
      required: true,
      typeDisplay: 'integer / int64',
      truncated: false,
    });
    expect(fields.find((field) => field.fieldPath === 'profile.email')?.required).toBe(true);
  });
});
