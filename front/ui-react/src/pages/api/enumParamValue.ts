import type { DebugParam, QueryParamValue } from 'knife4j-core';

export type EnumParamSelection = string | string[] | undefined;

function isQueryArrayParam(param: DebugParam): boolean {
  return param.in === 'query' && param.type === 'array';
}

export function isEnumParamSelectSupported(param: DebugParam): boolean {
  return param.type !== 'array' || isQueryArrayParam(param);
}

export function enumParamSelectMode(param: DebugParam): 'multiple' | undefined {
  return isQueryArrayParam(param) ? 'multiple' : undefined;
}

function validEnumSelections(param: DebugParam, values: unknown[]): string[] {
  const allowed = param.enum?.map(String);
  const allowedSet = allowed ? new Set(allowed) : undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    const value = String(item);
    if ((allowedSet && !allowedSet.has(value)) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function enumParamSelectValue(param: DebugParam, value: string): EnumParamSelection {
  if (!value) return undefined;
  if (!isQueryArrayParam(param)) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return validEnumSelections(param, parsed);
  } catch {
    // 规范修复前，数组输入可能以单个字符串缓存；仅保留完整枚举值，不猜测分隔符。
  }
  return param.enum?.some((item) => String(item) === value) ? [value] : undefined;
}

export function serializeEnumParamSelection(param: DebugParam, selection: EnumParamSelection): string {
  if (selection === undefined) return '';
  if (isQueryArrayParam(param)) {
    if (!Array.isArray(selection)) return '';
    const validSelection = validEnumSelections(param, selection);
    return validSelection.length > 0 ? JSON.stringify(validSelection) : '';
  }
  return Array.isArray(selection) ? (selection[0] ?? '') : selection;
}

export function queryParamRequestValue(param: DebugParam, value: string): QueryParamValue {
  if (!isQueryArrayParam(param)) return value;
  if (param.enum && param.enum.length > 0) {
    const selection = enumParamSelectValue(param, value);
    return Array.isArray(selection) ? selection : [];
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
