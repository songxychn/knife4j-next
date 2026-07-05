import type { SchemaFieldNode } from 'knife4j-core';
import type { OperationObject } from '../../types/swagger';

export function validationGroupRequiredFields(operation: OperationObject): Set<string> | undefined {
  const groups = operation['x-validation-groups'];
  if (!groups) return undefined;

  const fields = new Set<string>();
  for (const names of Object.values(groups)) {
    if (!Array.isArray(names)) continue;
    for (const name of names) {
      fields.add(name);
    }
  }
  return fields;
}

export function applyValidationGroupRequiredFields(
  fields: SchemaFieldNode[],
  operation: OperationObject,
): SchemaFieldNode[] {
  const requiredFields = validationGroupRequiredFields(operation);
  if (!requiredFields) return fields;
  return fields.map((field) => ({ ...field, required: requiredFields.has(field.name) }));
}
