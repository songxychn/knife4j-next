import { describe, expect, test } from 'vitest';
import type { ParameterObject } from '../../types/swagger';
import { apiDocParameterValues } from './apiDocParameterValues';

describe('ApiDoc parameter Schema values', () => {
  test.each(['3.0.3', '3.1.0', '3.2.0'])('reads inline and local referenced values in OAS %s', (openapi) => {
    const schema = {
      type: 'string',
      title: '来源渠道',
      enum: ['mch_web', 'mch_app', 'mch_h5'],
      default: 'mch_web',
      example: 'mch_app',
    };
    const document = { openapi, components: { schemas: { Source: schema } } };
    for (const source of [schema, { $ref: '#/components/schemas/Source' }]) {
      for (const location of ['query', 'path', 'header', 'cookie'] as const) {
        const parameter = { name: 'from', in: location, schema: source } as ParameterObject;
        const original = structuredClone(parameter);
        expect(apiDocParameterValues(parameter, document)).toEqual({
          title: source === schema ? schema.title : undefined,
          enum: schema.enum,
          default: 'mch_web',
        });
        expect(parameter).toEqual(original);
      }
    }
  });

  test('keeps array-instance enum separate from items.enum', () => {
    const document = { openapi: '3.0.3' };
    const parameter: ParameterObject = {
      name: 'ids',
      in: 'query',
      schema: { type: 'array', enum: [[1, 2], [3]], default: [1, 2], items: { type: 'integer', enum: [1, 2, 3] } },
    };
    expect(apiDocParameterValues(parameter, document)).toEqual({ enum: [[1, 2], [3]], default: [1, 2] });
    parameter.schema = { type: 'array', items: { type: 'integer', enum: [1, 2, 3] } };
    expect(apiDocParameterValues(parameter, document)).toEqual({ enum: undefined, default: undefined });
  });

  test('reads a content parameter Schema without mistaking its example for a default', () => {
    const parameter: ParameterObject = {
      name: 'filter',
      in: 'query',
      content: {
        'application/json': {
          schema: { type: 'object', title: '筛选条件', default: { enabled: false } },
          example: { enabled: true },
        },
      },
    };
    expect(apiDocParameterValues(parameter, { openapi: '3.1.0' })).toEqual({
      title: '筛选条件',
      enum: undefined,
      default: { enabled: false },
    });
  });

  test('does not invent metadata for a boolean or unavailable Schema', () => {
    for (const schema of [true, false, undefined, { $ref: '#/components/schemas/Missing' }]) {
      expect(
        apiDocParameterValues({ name: 'value', in: 'query', schema }, { openapi: '3.1.0' }).default,
      ).toBeUndefined();
    }
    expect(
      apiDocParameterValues(
        { name: 'value', in: 'query', schema: { type: 'string', example: 'only-example' } },
        { openapi: '3.0.3' },
      ).default,
    ).toBeUndefined();
  });

  test('obeys the existing version-specific Schema ref sibling semantics', () => {
    const parameter: ParameterObject = {
      name: 'value',
      in: 'query',
      schema: { $ref: '#/components/schemas/Value', title: '参数标题', default: 0 },
    };
    const components = { schemas: { Value: { type: 'integer', enum: [0, 1], default: 1 } } };
    expect(apiDocParameterValues(parameter, { openapi: '3.0.3', components })).toMatchObject({
      title: undefined,
      default: 1,
    });
    expect(apiDocParameterValues(parameter, { openapi: '3.1.0', components })).toMatchObject({
      title: '参数标题',
      default: 0,
    });
  });
});
