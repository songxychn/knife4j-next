import { describe, expect, it } from 'vitest';
import { resolveApiDebugParamSelection, setApiDebugParamsEnabled } from './apiDebugParamSelection';

describe('apiDebugParamSelection', () => {
  it('treats missing state entries as enabled for old caches and new parameters', () => {
    expect(resolveApiDebugParamSelection(['query:name', 'query:status'], {})).toEqual({
      checked: true,
      indeterminate: false,
    });
  });

  it('distinguishes empty, fully disabled, and partially enabled parameter tables', () => {
    expect(resolveApiDebugParamSelection([], {})).toEqual({ checked: false, indeterminate: false });
    expect(
      resolveApiDebugParamSelection(['query:name', 'query:status'], {
        'query:name': false,
        'query:status': false,
      }),
    ).toEqual({ checked: false, indeterminate: false });
    expect(
      resolveApiDebugParamSelection(['query:name', 'query:status'], {
        'query:name': true,
        'query:status': false,
      }),
    ).toEqual({ checked: false, indeterminate: true });
  });

  it('updates only the visible table keys and preserves values from other parameter groups', () => {
    const current = {
      'query:name': true,
      'query:status': true,
      'header:X-Trace-Id': false,
      'query:hidden': true,
    };

    expect(setApiDebugParamsEnabled(current, ['query:name', 'query:status'], false)).toEqual({
      'query:name': false,
      'query:status': false,
      'header:X-Trace-Id': false,
      'query:hidden': true,
    });
    expect(current['query:name']).toBe(true);
  });
});
