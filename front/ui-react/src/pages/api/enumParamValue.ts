import { parseOas31ParameterValue, type DebugParam, type QueryParamValue } from 'knife4j-core';

export type EnumParamSelection = string | string[] | undefined;

function isQueryArrayParam(param: DebugParam): boolean {
  return param.in === 'query' && param.type === 'array';
}

function isOas31Parameter(param: DebugParam): boolean {
  return param.parameterSerialization !== undefined;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonValuesEqual(item, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) && jsonValuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function jsonToken(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function oas31ScalarEditorValue(param: DebugParam, value: unknown): string {
  const plain =
    value === null ? 'null' : typeof value === 'object' ? (jsonToken(value) ?? String(value)) : String(value);
  const parsed = parseOas31ParameterValue(param, plain);
  if (parsed.ok && jsonValuesEqual(parsed.instance, value)) return plain;
  return jsonToken(value) ?? plain;
}

function enumOptionValue(param: DebugParam, value: unknown): string {
  if (!isOas31Parameter(param)) return String(value);
  if (isQueryArrayParam(param)) return jsonToken(value) ?? String(value);
  return oas31ScalarEditorValue(param, value);
}

export function enumParamSelectOptions(param: DebugParam): Array<{ value: string; label: string }> {
  return (param.enum ?? []).map((item) => ({
    value: enumOptionValue(param, item),
    label: isOas31Parameter(param) ? (jsonToken(item) ?? String(item)) : String(item),
  }));
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

function validOas31LogicalSelections(param: DebugParam, values: unknown[]): string[] {
  const options = (param.enum ?? []).map((item) => ({ item, token: enumOptionValue(param, item) }));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const option = options.find((candidate) => jsonValuesEqual(candidate.item, value));
    if (!option || seen.has(option.token)) continue;
    seen.add(option.token);
    result.push(option.token);
  }
  return result;
}

function validOas31SelectionTokens(param: DebugParam, values: readonly string[]): string[] {
  const allowed = new Set((param.enum ?? []).map((item) => enumOptionValue(param, item)));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!allowed.has(value) || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function enumParamSelectValue(param: DebugParam, value: string): EnumParamSelection {
  if (!value) return undefined;
  if (isOas31Parameter(param)) {
    if (isQueryArrayParam(param)) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) return validOas31LogicalSelections(param, parsed);
      } catch {
        // A pre-3.1 cache may contain one unquoted string enum value.
      }
      const legacy = param.enum?.find((item) => String(item) === value);
      return legacy === undefined ? undefined : [enumOptionValue(param, legacy)];
    }

    const options = (param.enum ?? []).map((item) => ({ item, token: enumOptionValue(param, item) }));
    if (options.some((option) => option.token === value)) return value;
    const parsed = parseOas31ParameterValue(param, value);
    if (!parsed.ok) return undefined;
    return options.find((option) => jsonValuesEqual(option.item, parsed.instance))?.token;
  }
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
  if (isOas31Parameter(param)) {
    if (isQueryArrayParam(param)) {
      if (!Array.isArray(selection)) return '';
      const tokens = validOas31SelectionTokens(param, selection);
      if (tokens.length === 0) return '';
      return `[${tokens.join(',')}]`;
    }
    return Array.isArray(selection) ? (selection[0] ?? '') : selection;
  }
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
