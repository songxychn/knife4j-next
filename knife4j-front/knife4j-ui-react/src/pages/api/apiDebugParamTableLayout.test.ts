import { describe, expect, it } from 'vitest';
import { API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS, apiDebugParamTableScrollX } from './apiDebugParamTableLayout';

describe('apiDebugParamTableLayout', () => {
  it('keeps value and description columns wide enough after enum selects are cleared', () => {
    expect(API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS).toEqual({
      enabled: 56,
      paramName: 220,
      type: 110,
      value: 320,
      description: 320,
    });
    expect(apiDebugParamTableScrollX()).toBe(1026);
  });

  it('uses the current column widths for horizontal scrolling', () => {
    expect(
      apiDebugParamTableScrollX({
        enabled: 56,
        paramName: 240,
        type: 120,
        value: 360,
        description: 360,
      }),
    ).toBe(1136);
  });
});
