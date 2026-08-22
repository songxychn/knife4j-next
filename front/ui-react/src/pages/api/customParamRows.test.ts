import { describe, expect, it } from 'vitest';
import { customRowsToRecord, mergeCustomBodyParams } from './customParamRows';

describe('customRowsToRecord', () => {
  it('trims complete rows and ignores incomplete rows', () => {
    expect(
      customRowsToRecord([
        { id: '1', name: ' traceId ', value: ' abc ' },
        { id: '2', name: '', value: 'ignored' },
        { id: '3', name: 'empty', value: '   ' },
      ]),
    ).toEqual({ traceId: 'abc' });
  });
});

describe('mergeCustomBodyParams', () => {
  const customRows = [
    { id: '1', name: 'dynamic', value: 'value' },
    { id: '2', name: 'declared', value: 'must-not-override' },
  ];

  it('adds enabled dynamic rows while preserving declared field precedence', () => {
    expect(mergeCustomBodyParams({ declared: 'schema-value' }, customRows, true)).toEqual({
      dynamic: 'value',
      declared: 'schema-value',
    });
  });

  it('does not send stored dynamic rows while the setting is disabled', () => {
    const formFields = { declared: 'schema-value' };
    expect(mergeCustomBodyParams(formFields, customRows, false)).toBe(formFields);
  });
});
