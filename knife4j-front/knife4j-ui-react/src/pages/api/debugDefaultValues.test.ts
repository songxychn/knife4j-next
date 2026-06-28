import { describe, expect, it } from 'vitest';
import type { BodyContent, OperationDebugModel } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import {
  buildBodyContentDefaults,
  buildInitialParamValues,
  initialBodyValueForContent,
  initialFormFieldsForContent,
  mergeCachedFormFields,
} from './debugDefaultValues';

function operationFrom(doc: SwaggerDoc, path: string, method: string): MenuOperation {
  const operation = (doc.paths[path] as Record<string, unknown>)[method] as MenuOperation['operation'];
  return {
    key: `Test/${method}`,
    path,
    method,
    summary: operation.summary ?? path,
    operationId: operation.operationId,
    operation,
  };
}

function baseDebugModel(partial: Partial<OperationDebugModel>): OperationDebugModel {
  return {
    pathParams: [],
    queryParams: [],
    headerParams: [],
    cookieParams: [],
    bodyContents: [],
    bodyRequired: false,
    ...partial,
  };
}

describe('debugDefaultValues', () => {
  it('initializes params from OpenAPI examples and nested schema examples', () => {
    const doc: SwaggerDoc = {
      openapi: '3.0.3',
      info: { title: 'demo', version: '1.0.0' },
      paths: {
        '/pets/{id}': {
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              examples: { demo: { value: 'pet-42' } },
            } as never,
          ],
          get: {
            parameters: [
              {
                name: 'trace',
                in: 'query',
                schema: { type: 'string' },
                examples: { demo: { value: 'trace-1' } },
              } as never,
            ],
            responses: {},
          },
        },
      },
    };
    const debugModel = baseDebugModel({
      pathParams: [
        {
          name: 'id',
          in: 'path',
          required: true,
          type: 'string',
          schema: { type: 'string' },
        },
      ],
      queryParams: [
        {
          name: 'trace',
          in: 'query',
          required: false,
          type: 'string',
          schema: { type: 'string' },
        },
        {
          name: 'filter',
          in: 'query',
          required: false,
          type: 'object',
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', example: 'available' },
              page: { type: 'integer', default: 1 },
            },
          },
        },
      ],
    });

    const values = buildInitialParamValues(debugModel, doc, operationFrom(doc, '/pets/{id}', 'get'));

    expect(values['path:id']).toBe('pet-42');
    expect(values['query:trace']).toBe('trace-1');
    expect(JSON.parse(values['query:filter'])).toEqual({ status: 'available', page: 1 });
  });

  it('uses requestBody media examples before schema-generated body examples', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string', default: 'schema-name' },
      },
    };
    const bodyContent: BodyContent = {
      mediaType: 'application/json',
      category: 'json',
      schema,
      exampleValue: JSON.stringify({ name: 'schema-name' }, null, 2),
    };
    const doc: SwaggerDoc = {
      openapi: '3.0.3',
      info: { title: 'demo', version: '1.0.0' },
      paths: {
        '/pets': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema,
                  examples: {
                    demo: {
                      value: { name: 'media-example', age: 3 },
                    },
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    };
    const debugModel = baseDebugModel({ bodyContents: [bodyContent], bodyRequired: true });

    const defaults = buildBodyContentDefaults(doc, operationFrom(doc, '/pets', 'post'), debugModel);

    expect(JSON.parse(initialBodyValueForContent(bodyContent, defaults))).toEqual({
      name: 'media-example',
      age: 3,
    });
  });

  it('generates form field defaults from nested schema examples and lets cached edits win', () => {
    const schema = {
      type: 'object',
      required: ['meta'],
      properties: {
        meta: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'demo' },
            count: { type: 'integer', default: 2 },
          },
        },
        ids: {
          type: 'array',
          items: { type: 'integer', default: 7 },
        },
        enabled: { type: 'boolean', default: false },
      },
    };
    const bodyContent: BodyContent = {
      mediaType: 'multipart/form-data',
      category: 'multipart',
      schema,
      jsonFields: ['meta'],
    };
    const doc: SwaggerDoc = {
      openapi: '3.0.3',
      info: { title: 'demo', version: '1.0.0' },
      paths: {
        '/upload': {
          post: {
            requestBody: {
              content: {
                'multipart/form-data': { schema },
              },
            },
            responses: {},
          },
        },
      },
    };
    const debugModel = baseDebugModel({ bodyContents: [bodyContent], bodyRequired: true });

    const defaults = buildBodyContentDefaults(doc, operationFrom(doc, '/upload', 'post'), debugModel);
    const fields = initialFormFieldsForContent(bodyContent, defaults);
    const merged = mergeCachedFormFields(bodyContent, { meta: '{"manual":true}', ids: '[9]' }, defaults);

    expect(JSON.parse(fields.meta)).toEqual({ name: 'demo', count: 2 });
    expect(JSON.parse(fields.ids)).toEqual([7]);
    expect(fields.enabled).toBe('false');
    expect(merged.meta).toBe('{"manual":true}');
    expect(merged.ids).toBe('[9]');
    expect(merged.enabled).toBe('false');
  });
});
