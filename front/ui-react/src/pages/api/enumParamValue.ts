import type { DebugParam } from 'knife4j-core';

export type EnumParamSelection = string | string[] | undefined;

export function enumParamSelectMode(param: DebugParam): 'multiple' | undefined {
  return param.type === 'array' ? 'multiple' : undefined;
}

export function enumParamSelectValue(param: DebugParam, value: string): EnumParamSelection {
  if (!value) return undefined;
  if (param.type !== 'array') return value;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializeEnumParamSelection(param: DebugParam, selection: EnumParamSelection): string {
  if (selection === undefined) return '';
  if (param.type === 'array') {
    return Array.isArray(selection) ? selection.join(',') : selection;
  }
  return Array.isArray(selection) ? (selection[0] ?? '') : selection;
}
