import type { DebugCacheCustomParamRow } from './debugCache';

export function customRowsToRecord(rows: DebugCacheCustomParamRow[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    const value = row.value.trim();
    if (name && value) {
      values[name] = value;
    }
  }
  return values;
}

/**
 * Merge ad hoc text parts into schema-declared form fields. Declared fields win
 * name collisions so this feature cannot override the OpenAPI contract.
 */
export function mergeCustomBodyParams(
  formFields: Record<string, string>,
  customBodyParams: DebugCacheCustomParamRow[],
  enabled: boolean,
): Record<string, string> {
  if (!enabled) return formFields;
  return { ...customRowsToRecord(customBodyParams), ...formFields };
}
