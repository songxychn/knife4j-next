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

  const applyToModelFields = (modelFields: SchemaFieldNode[]) =>
    modelFields.map((field) => ({ ...field, required: requiredFields.has(field.name) }));

  const applyToArrayItem = (item: SchemaFieldNode): SchemaFieldNode => {
    if (!item.children) return item;
    if (item.type === 'array') {
      return { ...item, children: item.children.map(applyToArrayItem) };
    }
    return { ...item, children: applyToModelFields(item.children) };
  };

  if (fields.length === 1 && fields[0].type === 'array') {
    const arrayField = fields[0];
    return [
      {
        ...arrayField,
        children: arrayField.children?.map(applyToArrayItem),
      },
    ];
  }

  return applyToModelFields(fields);
}
