import type { SchemaFieldNode } from 'knife4j-core';

export function schemaNameFromRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const idx = ref.lastIndexOf('/');
  return decodeURIComponent(idx >= 0 ? ref.slice(idx + 1) : ref);
}

/**
 * Normalize a schema title coming from springdoc/springfox.
 * springdoc encodes generic parameters with guillemets: Result«UserVO» → Result<UserVO>
 */
export function normalizeGenericTitle(title: string | undefined): string | undefined {
  if (title === undefined) return undefined;
  return title.replace(/«/g, '<').replace(/»/g, '>');
}

export function schemaNodeRefName(node: SchemaFieldNode): string | undefined {
  if (node.refName) return node.refName;
  if (node.type === 'array') return node.children?.[0]?.refName;
  return undefined;
}

export function schemaNodeTypeLabel(node: SchemaFieldNode): string {
  if (node.booleanSchema === true) return 'any';
  if (node.booleanSchema === false) return 'never';
  const refName = schemaNodeRefName(node);
  const nullable = node.types?.includes('null') ?? false;
  let label: string;
  if (node.type === 'array') {
    const item = node.children?.[0];
    const tupleItems = node.children?.filter((child) => /^\[\d+\]$/.test(child.name));
    if (tupleItems && tupleItems.length > 0) label = `[${tupleItems.map(schemaNodeTypeLabel).join(', ')}]`;
    else if (refName) label = `${refName}[]`;
    else if (item?.type) label = `${schemaNodeTypeLabel(item)}[]`;
    else label = 'array';
    return nullable ? `${label} | null` : label;
  }
  if (refName) label = refName;
  // string+byte is the OAS representation of Java Byte — display as 'byte' for clarity
  else if (node.type === 'string' && node.format === 'byte') label = 'byte';
  else if (node.types && node.types.length > 0) label = node.types.join(' | ');
  else label = [node.type, node.format].filter(Boolean).join(' / ') || 'unknown';
  return nullable && !label.split(' | ').includes('null') ? `${label} | null` : label;
}
