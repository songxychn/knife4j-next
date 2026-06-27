export function resolveSchemaActiveKeys(selectedSchemaName?: string): string[] {
  return selectedSchemaName ? [selectedSchemaName] : [];
}
