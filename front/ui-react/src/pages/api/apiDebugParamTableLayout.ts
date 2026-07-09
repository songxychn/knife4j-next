const PARAM_TABLE_MIN_SCROLL_WIDTH = 1024;

export type ApiDebugParamTableColumnKey = 'enabled' | 'paramName' | 'type' | 'value' | 'description';

export type ApiDebugParamTableColumnWidths = Record<ApiDebugParamTableColumnKey, number>;

export const API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS: ApiDebugParamTableColumnWidths = {
  enabled: 56,
  paramName: 220,
  type: 110,
  value: 320,
  description: 320,
};

export function apiDebugParamTableScrollX(widths = API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS): number {
  return Math.max(
    PARAM_TABLE_MIN_SCROLL_WIDTH,
    widths.enabled + widths.paramName + widths.type + widths.value + widths.description,
  );
}
