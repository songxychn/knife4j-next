import { describe, expect, it } from 'vitest';
import { buildOperationDebugModel, type BodyContent, type OperationDebugModel } from 'knife4j-core';
import { parseMenuTags } from '../../api/knife4jClient';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import {
  buildBodyContentDefaults,
  buildInitialParamValues,
  extractSchemaFields,
  initialBodyValueForContent,
  initialFormFieldsForContent,
  initialFormPartHeadersForContent,
  mergeCachedFormFields,
  mergeCachedFormPartHeaders,
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

  it('uses examples from parameters inherited through an OAS 3.1 Path Item reference', () => {
    const doc = {
      openapi: '3.1.2',
      info: { title: 'Referenced defaults', version: '1.0.0' },
      paths: {
        '/pets': {
          $ref: '#/components/pathItems/Pets',
          post: { tags: ['pets'], responses: { 204: { description: 'Updated' } } },
        },
      },
      components: {
        parameters: {
          Locale: {
            name: 'locale',
            in: 'query',
            schema: { type: 'string' },
            examples: { preferred: { value: 'zh-CN' } },
          },
        },
        pathItems: {
          Pets: {
            parameters: [{ $ref: '#/components/parameters/Locale' }],
            get: { tags: ['pets'], responses: { 200: { description: 'OK' } } },
          },
        },
      },
    } as unknown as SwaggerDoc;
    const operation = parseMenuTags(doc)[0].operations.find(({ method }) => method === 'post')!;
    const debugModel = buildOperationDebugModel({ doc, path: operation.path, method: operation.method });

    expect(buildInitialParamValues(debugModel, doc, operation)).toMatchObject({ 'query:locale': 'zh-CN' });
  });

  it('keeps OAS 3.1 JSON content strings and null examples as logical JSON editor values', () => {
    const doc: SwaggerDoc = {
      openapi: '3.1.1',
      info: { title: 'parameter examples', version: '1.0.0' },
      paths: {
        '/search': {
          get: {
            parameters: [
              {
                name: 'literal',
                in: 'query',
                content: {
                  'application/json': {
                    schema: { type: 'string' },
                    example: 'json-string',
                  },
                },
              } as never,
              {
                name: 'nullable',
                in: 'query',
                schema: { type: ['string', 'null'] },
                example: null,
              } as never,
              {
                name: 'literal-null',
                in: 'query',
                schema: { type: ['string', 'null'] },
                example: 'null',
              } as never,
              {
                name: 'default-null',
                in: 'query',
                schema: { type: ['integer', 'null'], default: null },
              } as never,
            ],
            responses: {},
          },
        },
      },
    };
    const operation = operationFrom(doc, '/search', 'get');
    const debugModel = buildOperationDebugModel({
      doc: doc as unknown as Record<string, unknown>,
      path: '/search',
      method: 'get',
    });

    expect(buildInitialParamValues(debugModel, doc, operation)).toEqual({
      'query:literal': '"json-string"',
      'query:nullable': 'null',
      'query:literal-null': '"null"',
      'query:default-null': 'null',
    });
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
                      value: { name: '', age: 3 },
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
      name: '',
      age: 3,
    });
  });

  it('keeps a JSON-looking media example string as a string when the schema is omitted', () => {
    const literal = '{"kind":"literal"}';
    const bodyContent: BodyContent = {
      mediaType: 'application/json',
      category: 'json',
      exampleValue: literal,
    };
    const doc: SwaggerDoc = {
      openapi: '3.0.3',
      info: { title: 'demo', version: '1.0.0' },
      paths: {
        '/literal': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  example: literal,
                },
              },
            },
            responses: {},
          },
        },
      },
    };
    const debugModel = baseDebugModel({ bodyContents: [bodyContent], bodyRequired: true });

    const defaults = buildBodyContentDefaults(doc, operationFrom(doc, '/literal', 'post'), debugModel);

    expect(JSON.parse(initialBodyValueForContent(bodyContent, defaults))).toBe(literal);
  });

  it('merges requestBody media examples into form field defaults', () => {
    const schema = {
      type: 'object',
      properties: {
        username: { type: 'string', default: 'schema-user' },
        count: { type: 'integer', default: 1 },
        prefs: {
          type: 'object',
          properties: {
            theme: { type: 'string', default: 'light' },
          },
        },
        retained: { type: 'string', default: 'schema-retained' },
      },
    };
    const bodyContent: BodyContent = {
      mediaType: 'application/x-www-form-urlencoded',
      category: 'urlencoded',
      schema,
    };
    const doc: SwaggerDoc = {
      openapi: '3.0.3',
      info: { title: 'demo', version: '1.0.0' },
      paths: {
        '/login': {
          post: {
            requestBody: {
              content: {
                'application/x-www-form-urlencoded': {
                  schema,
                  examples: {
                    demo: {
                      value: {
                        username: 'alice',
                        count: 5,
                        prefs: { theme: 'dark' },
                        ignored: 'not-a-schema-field',
                      },
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

    const defaults = buildBodyContentDefaults(doc, operationFrom(doc, '/login', 'post'), debugModel);
    const fields = initialFormFieldsForContent(bodyContent, defaults);

    expect(fields.username).toBe('alice');
    expect(fields.count).toBe('5');
    expect(JSON.parse(fields.prefs)).toEqual({ theme: 'dark' });
    expect(fields.retained).toBe('schema-retained');
    expect(fields.ignored).toBeUndefined();
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

  it('renders normalized allOf fields with readOnly, file, and JSON semantics', () => {
    const doc = {
      openapi: '3.0.3',
      info: { title: 'T', version: '1' },
      paths: {
        '/upload': {
          post: {
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: { $ref: '#/components/schemas/UploadRequest' },
                  encoding: { metadata: { contentType: 'application/json' } },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
      components: {
        schemas: {
          UploadBase: {
            type: 'object',
            required: ['regularField'],
            properties: {
              regularField: { type: 'string' },
              readOnlyField: { type: 'string', readOnly: true },
              avatar: { type: 'string', format: 'binary' },
              attachments: { type: 'array', items: { type: 'string', format: 'binary' } },
              metadata: { type: 'object' },
            },
          },
          UploadRequest: {
            allOf: [
              { $ref: '#/components/schemas/UploadBase' },
              { type: 'object', properties: { ownField: { type: 'string' } } },
            ],
          },
        },
      },
    };
    const bodyContent = buildOperationDebugModel({ doc, path: '/upload', method: 'post' }).bodyContents[0];
    const fields = extractSchemaFields(bodyContent);
    const byName = Object.fromEntries(fields.map((field) => [field.name, field]));

    expect(fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['regularField', 'avatar', 'attachments', 'metadata', 'ownField']),
    );
    expect(fields.map((field) => field.name)).not.toContain('readOnlyField');
    expect(byName.regularField.required).toBe(true);
    expect(byName.avatar).toMatchObject({ isFile: true, isMultipleFile: false });
    expect(byName.attachments).toMatchObject({ isFile: true, isMultipleFile: true });
    expect(byName.metadata.isJson).toBe(true);
  });

  it('exposes OAS 3.1 logical editors and multipart Header Object defaults', () => {
    const doc = {
      openapi: '3.1.1',
      info: { title: 'T', version: '1' },
      paths: {
        '/upload': {
          post: {
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      metadata: { type: 'object' },
                      label: { type: 'string', default: 'hello' },
                      nullable: { type: ['string', 'null'], default: null },
                      avatar: { format: 'binary' },
                      ignored: { type: 'string', readOnly: true },
                    },
                  },
                  encoding: {
                    metadata: {
                      contentType: 'application/json',
                      headers: {
                        'X-Part-Trace': {
                          required: true,
                          schema: { type: 'string', default: 'trace-default' },
                        },
                      },
                    },
                    label: { contentType: 'application/json' },
                  },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    };
    const debugModel = buildOperationDebugModel({ doc, path: '/upload', method: 'post' });
    const bodyContent = debugModel.bodyContents[0];
    const byName = Object.fromEntries(extractSchemaFields(bodyContent).map((field) => [field.name, field]));

    expect(Object.keys(byName)).toEqual(['metadata', 'label', 'nullable', 'avatar']);
    expect(byName.metadata).toMatchObject({ isJson: true, structured: true, contentTypes: ['application/json'] });
    expect(byName.metadata.partHeaders).toEqual([
      expect.objectContaining({ name: 'X-Part-Trace', required: true, default: 'trace-default' }),
    ]);
    expect(byName.avatar).toMatchObject({ isFile: true, isMultipleFile: false });
    const defaults = buildBodyContentDefaults(doc, operationFrom(doc, '/upload', 'post'), debugModel);
    expect(initialFormFieldsForContent(bodyContent, defaults).label).toBe('"hello"');
    expect(initialFormFieldsForContent(bodyContent, defaults).nullable).toBe('null');
    expect(initialFormPartHeadersForContent(bodyContent)).toEqual({
      metadata: { 'X-Part-Trace': 'trace-default' },
    });
    expect(mergeCachedFormPartHeaders(bodyContent, { metadata: { 'X-Part-Trace': 'manual' } })).toEqual({
      metadata: { 'X-Part-Trace': 'manual' },
    });
  });
});
