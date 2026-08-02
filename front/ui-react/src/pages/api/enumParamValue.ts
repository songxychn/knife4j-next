import type { DebugParam, QueryParamValue } from 'knife4j-core';

export type EnumParamSelection = string | string[] | undefined;

export function enumParamSelectMode(param: DebugParam): 'multiple' | undefined {
  return param.type === 'array' ? 'multiple' : undefined;
}

export function enumParamSelectValue(param: DebugParam, value: string): EnumParamSelection {
  if (!value) return undefined;
  if (param.type !== 'array') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // 兼容本修复之前已经缓存的逗号分隔值。
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializeEnumParamSelection(param: DebugParam, selection: EnumParamSelection): string {
  if (selection === undefined) return '';
  if (param.type === 'array') {
    return Array.isArray(selection) && selection.length > 0 ? JSON.stringify(selection) : '';
  }
  return Array.isArray(selection) ? (selection[0] ?? '') : selection;
}

export function queryParamRequestValue(param: DebugParam, value: string): QueryParamValue {
  if (param.type !== 'array') return value;
  if (param.enum && param.enum.length > 0) {
    const selection = enumParamSelectValue(param, value);
    return Array.isArray(selection) ? selection : value;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : value;
  } catch {
    return value;
  }
}

export function displayQueryParamValue(value: QueryParamValue): string {
  return Array.isArray(value) ? value.join(', ') : value;
}
