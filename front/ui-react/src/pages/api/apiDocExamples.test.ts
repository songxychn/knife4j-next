import { describe, expect, it } from 'vitest';
import type { ResponseObject, SwaggerDoc } from '../../types/swagger';
import { requestBodyExample, responseExamples } from './apiDocExamples';

describe('API document examples', () => {
  it('keeps a JSON-looking request example string as a string', () => {
    const literal = '{"kind":"literal"}';
    const schema = { type: 'string' } as const;
    const requestBody = {
      content: {
        'application/json': {
          schema,
          example: literal,
        },
      },
    };
    const doc = {
      openapi: '3.0.1',
      info: { title: 'String request example', version: '1.0.0' },
      paths: {},
    } as SwaggerDoc;

    const rendered = requestBodyExample(requestBody, schema, doc);

    expect(JSON.parse(rendered!)).toBe(literal);
  });

  it('preserves a native request example object and its empty string property', () => {
    const schema = {
      type: 'object',
      properties: {
        pictureUrl: { type: 'string', default: 'schema-picture' },
        title: { type: 'string' },
      },
    } as const;
    const requestBody = {
      content: {
        'application/json': {
          schema,
          examples: {
            cover: {
              value: { pictureUrl: '', title: 'cover' },
            },
          },
        },
      },
    };
    const doc = {
      openapi: '3.0.1',
      info: { title: 'Object request example', version: '1.0.0' },
      paths: {},
    } as SwaggerDoc;

    expect(JSON.parse(requestBodyExample(requestBody, schema, doc)!)).toEqual({
      pictureUrl: '',
      title: 'cover',
    });
  });

  it('keeps the request schema fallback when no media example is declared', () => {
    const schema = {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    } as const;
    const requestBody = {
      content: {
        'application/json': { schema },
      },
    };
    const doc = {
      openapi: '3.0.1',
      info: { title: 'Request schema fallback', version: '1.0.0' },
      paths: {},
    } as SwaggerDoc;

    expect(JSON.parse(requestBodyExample(requestBody, schema, doc)!)).toEqual({ message: 'string' });
  });

  it('keeps a JSON-looking response example string as a string', () => {
    const literal = '{"kind":"literal"}';
    const responses = {
      '200': {
        description: 'OK',
        content: {
          'application/json': {
            schema: { type: 'string' },
            example: literal,
          },
        },
      },
    } satisfies Record<string, ResponseObject>;
    const doc = {
      openapi: '3.0.1',
      info: { title: 'String example', version: '1.0.0' },
      paths: {},
    } as SwaggerDoc;

    const [response] = responseExamples(responses, doc);

    expect(JSON.parse(response.example)).toBe(literal);
  });

  it('uses an OAS3 response examples.value object before the schema example', () => {
    const value = {
      success: true,
      status: '200',
      message: '',
      data: 'SUCCESS',
      timestamp: '',
    };
    const responses = {
      '200': {
        description: 'OK',
        content: {
          '*/*': {
            schema: { $ref: '#/components/schemas/ResponseResultHttpCodeEnum' },
            examples: {
              json: {
                summary: 'test data',
                value,
              },
            },
          },
        },
      },
    } satisfies Record<string, ResponseObject>;
    const doc = {
      openapi: '3.0.1',
      info: { title: 'Issue 550', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          ResponseResultHttpCodeEnum: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              status: { type: 'string' },
              message: { type: 'string' },
              data: { type: 'string' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    } as SwaggerDoc;

    expect(responseExamples(responses, doc)).toEqual([{ statusCode: '200', example: JSON.stringify(value, null, 2) }]);
  });

  it('keeps an explicitly empty response example', () => {
    const responses = {
      '204': {
        description: 'No content',
        content: {
          '*/*': {
            example: '',
          },
        },
      },
    } satisfies Record<string, ResponseObject>;
    const doc = {
      openapi: '3.0.1',
      info: { title: 'Empty example', version: '1.0.0' },
      paths: {},
    } as SwaggerDoc;

    expect(responseExamples(responses, doc)).toEqual([{ statusCode: '204', example: '' }]);
  });

  it('does not invent a text example for a binary response', () => {
    const responses = {
      '200': {
        description: '文件流',
        content: {
          'application/octet-stream': {
            schema: { type: 'string', format: 'binary' },
          },
        },
      },
    } satisfies Record<string, ResponseObject>;
    const doc = {
      openapi: '3.1.0',
      info: { title: 'Issue 579', version: '1.0.0' },
      paths: {},
    } as SwaggerDoc;

    expect(responseExamples(responses, doc)).toEqual([]);
  });

  it('keeps binary schema examples and resolves binary schema refs', () => {
    const responses = {
      '200': {
        description: 'Explicit binary example',
        content: {
          'application/octet-stream': {
            schema: { type: 'string', format: 'binary', example: 'PDF bytes' },
          },
        },
      },
      '206': {
        description: 'Referenced binary without example',
        content: {
          'application/octet-stream': {
            schema: { $ref: '#/components/schemas/BinaryFile' },
          },
        },
      },
    } satisfies Record<string, ResponseObject>;
    const doc = {
      openapi: '3.1.0',
      info: { title: 'Binary examples', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          BinaryFile: { type: 'string', format: 'binary' },
        },
      },
    } as SwaggerDoc;

    expect(responseExamples(responses, doc)).toEqual([
      { statusCode: '200', example: JSON.stringify('PDF bytes', null, 2) },
    ]);
  });

  it('keeps the schema fallback when no media example is declared', () => {
    const responses = {
      '200': {
        description: 'OK',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
            },
          },
        },
      },
      '500': {
        description: 'Unknown schema',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Missing' },
          },
        },
      },
    } satisfies Record<string, ResponseObject>;
    const doc = {
      openapi: '3.0.1',
      info: { title: 'Schema fallback', version: '1.0.0' },
      paths: {},
    } as SwaggerDoc;

    expect(responseExamples(responses, doc)).toEqual([
      {
        statusCode: '200',
        example: JSON.stringify({ message: 'string' }, null, 2),
      },
    ]);
  });

  it('preserves the legacy response schema fallback priority', () => {
    const responses = {
      '206': {
        description: 'Other media schema',
        content: {
          'text/plain': {
            schema: { type: 'string' },
          },
          'application/json': {},
        },
      },
      '207': {
        description: 'OAS2 schema before media schema',
        schema: { type: 'integer' },
        content: {
          'text/plain': {
            schema: { type: 'string' },
          },
        },
      },
    } satisfies Record<string, ResponseObject>;
    const doc = {
      openapi: '3.0.1',
      info: { title: 'Schema priority', version: '1.0.0' },
      paths: {},
    } as SwaggerDoc;

    expect(responseExamples(responses, doc)).toEqual([
      { statusCode: '206', example: JSON.stringify('string', null, 2) },
      { statusCode: '207', example: JSON.stringify(0, null, 2) },
    ]);
  });
});
