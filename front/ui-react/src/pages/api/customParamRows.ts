import type { BodyContent } from 'knife4j-core';
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

export interface MergedCustomBodyParams {
  formFields: Record<string, string>;
  formFieldNamesToIncludeWhenEmpty: string[];
}

function customBodyRowsToRecord(rows: DebugCacheCustomParamRow[]): Record<string, string> {
  const values = new Map<string, string>();
  for (const row of rows) {
    const name = row.name.trim();
    if (name) {
      values.set(name, row.value);
    }
  }
  return Object.fromEntries(values);
}

/**
 * Names declared by the selected OpenAPI body schema are reserved even when
 * they are absent from the current values (for example readOnly fields or an
 * older history snapshot). File/JSON side tables are included defensively.
 */
export function reservedBodyFieldNames(bodyContent: BodyContent | undefined): Set<string> {
  const names = new Set<string>([...(bodyContent?.fileFields ?? []), ...(bodyContent?.jsonFields ?? [])]);
  const properties = bodyContent?.schema?.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const name of Object.keys(properties)) names.add(name);
  }
  return names;
}

/**
 * Merge ad hoc text parts into schema-declared form fields. Declared fields win
 * name collisions so this feature cannot override the OpenAPI contract.
 */
export function mergeCustomBodyParams(
  formFields: Record<string, string>,
  customBodyParams: DebugCacheCustomParamRow[],
  enabled: boolean,
  reservedFieldNames: ReadonlySet<string> = new Set(),
): MergedCustomBodyParams {
  if (!enabled) {
    return { formFields, formFieldNamesToIncludeWhenEmpty: [] };
  }

  const declaredFieldNames = new Set([...Object.keys(formFields), ...reservedFieldNames]);
  const customFields = Object.fromEntries(
    Object.entries(customBodyRowsToRecord(customBodyParams)).filter(([name]) => !declaredFieldNames.has(name)),
  );
  const formFieldNamesToIncludeWhenEmpty = Object.entries(customFields)
    .filter(([, value]) => value === '')
    .map(([name]) => name);

  return {
    formFields: { ...customFields, ...formFields },
    formFieldNamesToIncludeWhenEmpty,
  };
}
