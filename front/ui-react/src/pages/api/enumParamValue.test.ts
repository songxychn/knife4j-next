import { describe, expect, it } from 'vitest';
import type { DebugParam } from 'knife4j-core';
import {
  displayQueryParamValue,
  enumParamSelectMode,
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
});
