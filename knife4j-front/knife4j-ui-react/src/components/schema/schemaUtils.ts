import type { SchemaFieldNode } from 'knife4j-core';

export function schemaNameFromRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const idx = ref.lastIndexOf('/');
  return decodeURIComponent(idx >= 0 ? ref.slice(idx + 1) : ref);
}

export function schemaNodeRefName(node: SchemaFieldNode): string | undefined {
  if (node.refName) return node.refName;
  if (node.type === 'array') return node.children?.[0]?.refName;
  return undefined;
}

export function schemaNodeTypeLabel(node: SchemaFieldNode): string {
  const refName = schemaNodeRefName(node);
  if (node.type === 'array') {
    const item = node.children?.[0];
    if (refName) return `${refName}[]`;
    if (item?.type) return `${schemaNodeTypeLabel(item)}[]`;
    return 'array';
  }
  if (refName) return refName;
  return [node.type, node.format].filter(Boolean).join(' / ') || 'unknown';
}
