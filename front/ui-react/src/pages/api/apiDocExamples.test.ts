import { describe, expect, it } from 'vitest';
import type { ResponseObject, SwaggerDoc } from '../../types/swagger';
import { responseExamples } from './apiDocExamples';

describe('API document examples', () => {
  it('uses an OAS3 response examples.value JSON string before the schema example', () => {
    const value = JSON.stringify(
      {
        success: true,
        status: '200',
        message: '',
        data: 'SUCCESS',
        timestamp: '',
      },
      null,
      2,
    );
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

    expect(responseExamples(responses, doc)).toEqual([{ statusCode: '200', example: value }]);
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
