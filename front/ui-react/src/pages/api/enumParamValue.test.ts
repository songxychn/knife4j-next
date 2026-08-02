import { describe, expect, it } from 'vitest';
import type { DebugParam } from 'knife4j-core';
import {
  displayQueryParamValue,
  enumParamSelectMode,
  enumParamSelectValue,
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
    expect(serializeEnumParamSelection(batchEnumParam, ['SUCCESS', 'BAD_REQUEST'])).toBe('["SUCCESS","BAD_REQUEST"]');
    expect(enumParamSelectValue(batchEnumParam, '["SUCCESS","BAD_REQUEST"]')).toEqual(['SUCCESS', 'BAD_REQUEST']);
    expect(enumParamSelectValue(batchEnumParam, 'SUCCESS,BAD_REQUEST')).toEqual(['SUCCESS', 'BAD_REQUEST']);
    expect(queryParamRequestValue(batchEnumParam, '["SUCCESS","BAD_REQUEST"]')).toEqual(['SUCCESS', 'BAD_REQUEST']);
    expect(displayQueryParamValue(['SUCCESS', 'BAD_REQUEST'])).toBe('SUCCESS, BAD_REQUEST');
    expect(serializeEnumParamSelection(batchEnumParam, [])).toBe('');
  });

  it('keeps scalar enum parameters single-valued', () => {
    const scalarParam = { ...batchEnumParam, type: 'string' };

    expect(enumParamSelectMode(scalarParam)).toBeUndefined();
    expect(serializeEnumParamSelection(scalarParam, 'SUCCESS')).toBe('SUCCESS');
    expect(enumParamSelectValue(scalarParam, 'SUCCESS')).toBe('SUCCESS');
  });
});
