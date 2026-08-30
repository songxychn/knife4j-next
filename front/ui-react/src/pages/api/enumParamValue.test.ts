import { describe, expect, it } from 'vitest';
import type { DebugParam } from 'knife4j-core';
import {
  displayQueryParamValue,
  enumParamSelectMode,
  enumParamSelectOptions,
  enumParamSelectValue,
  isEnumParamSelectSupported,
  queryParamRequestValue,
  serializeEnumParamSelection,
} from './enumParamValue';

const batchEnumParam: DebugParam = {
  name: 'httpCode',
  in: 'query',
  required: true,
  type: 'array',
  format: 'enum',
  enum: ['SUCCESS', 'BAD_REQUEST', 'UNAUTHORIZED'],
};

describe('enumParamValue', () => {
  it('keeps every selected enum value for an array parameter', () => {
    expect(enumParamSelectMode(batchEnumParam)).toBe('multiple');
    expect(isEnumParamSelectSupported(batchEnumParam)).toBe(true);
    expect(serializeEnumParamSelection(batchEnumParam, ['SUCCESS', 'BAD_REQUEST'])).toBe('["SUCCESS","BAD_REQUEST"]');
    expect(enumParamSelectValue(batchEnumParam, '["SUCCESS","BAD_REQUEST"]')).toEqual(['SUCCESS', 'BAD_REQUEST']);
    expect(enumParamSelectValue(batchEnumParam, 'SUCCESS')).toEqual(['SUCCESS']);
    expect(enumParamSelectValue(batchEnumParam, 'SUCCESS,BAD_REQUEST')).toBeUndefined();
    expect(queryParamRequestValue(batchEnumParam, 'SUCCESS,BAD_REQUEST')).toEqual([]);
    expect(queryParamRequestValue(batchEnumParam, '["SUCCESS","BAD_REQUEST"]')).toEqual(['SUCCESS', 'BAD_REQUEST']);
    expect(displayQueryParamValue(['SUCCESS', 'BAD_REQUEST'])).toBe('SUCCESS, BAD_REQUEST');
    expect(serializeEnumParamSelection(batchEnumParam, [])).toBe('');
  });

  it('drops stale cached values that no longer satisfy items.enum', () => {
    expect(enumParamSelectValue(batchEnumParam, '["SUCCESS","REMOVED"]')).toEqual(['SUCCESS']);
    expect(queryParamRequestValue(batchEnumParam, '["SUCCESS","REMOVED"]')).toEqual(['SUCCESS']);
    expect(serializeEnumParamSelection(batchEnumParam, ['SUCCESS', 'REMOVED', 'SUCCESS'])).toBe('["SUCCESS"]');
  });

  it('keeps scalar enum parameters single-valued', () => {
    const scalarParam = { ...batchEnumParam, type: 'string' };

    expect(enumParamSelectMode(scalarParam)).toBeUndefined();
    expect(isEnumParamSelectSupported(scalarParam)).toBe(true);
    expect(serializeEnumParamSelection(scalarParam, 'SUCCESS')).toBe('SUCCESS');
    expect(enumParamSelectValue(scalarParam, 'SUCCESS')).toBe('SUCCESS');
  });

  it('does not enable an array enum select outside query parameters', () => {
    const headerParam = { ...batchEnumParam, in: 'header' as const };

    expect(isEnumParamSelectSupported(headerParam)).toBe(false);
    expect(enumParamSelectMode(headerParam)).toBeUndefined();
    expect(serializeEnumParamSelection(headerParam, ['SUCCESS', 'BAD_REQUEST'])).toBe('SUCCESS');
  });

  it('preserves a comma inside one enum value without guessing a delimiter', () => {
    const commaParam = { ...batchEnumParam, enum: ['A,B', 'C'] };

    expect(enumParamSelectValue(commaParam, 'A,B')).toEqual(['A,B']);
    expect(queryParamRequestValue(commaParam, 'A,B')).toEqual(['A,B']);
  });

  it('keeps OAS 3.1 scalar enum JSON types distinct in the editor', () => {
    const scalarParam: DebugParam = {
      name: 'choice',
      in: 'query',
      required: false,
      type: 'integer',
      schema: { type: ['integer', 'string', 'null'] },
      enum: [1, '1', null],
      parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
    };

    expect(enumParamSelectOptions(scalarParam)).toEqual([
      { value: '1', label: '1' },
      { value: '"1"', label: '"1"' },
      { value: 'null', label: 'null' },
    ]);
    expect(enumParamSelectValue(scalarParam, '1')).toBe('1');
    expect(enumParamSelectValue(scalarParam, '"1"')).toBe('"1"');
    expect(serializeEnumParamSelection(scalarParam, '"1"')).toBe('"1"');
  });

  it('serializes OAS 3.1 array item enum selections as typed JSON values', () => {
    const arrayParam: DebugParam = {
      ...batchEnumParam,
      schema: { type: 'array', items: { type: 'integer', enum: [1, 2] } },
      enum: [1, 2],
      parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
    };

    expect(enumParamSelectOptions(arrayParam)).toEqual([
      { value: '1', label: '1' },
      { value: '2', label: '2' },
    ]);
    expect(enumParamSelectValue(arrayParam, '[1,2]')).toEqual(['1', '2']);
    expect(serializeEnumParamSelection(arrayParam, ['1', '2'])).toBe('[1,2]');
  });
});
