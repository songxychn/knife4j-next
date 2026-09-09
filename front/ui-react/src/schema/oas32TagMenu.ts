import {
  buildOas32TagNavigation,
  getOpenApiSpecificationFeatures,
  searchOas32TagNavigation,
  type Oas32TagObject,
} from 'knife4j-core';
import type { ApiItem } from '../context/GroupContext';
import type { MenuTag, SwaggerDoc } from '../types/swagger';

/** The sorted flat registry remains the source of operation identity and counts. */
export function oas32TagMenu(
  document: SwaggerDoc | null,
  menuTags: readonly MenuTag[],
  apis: readonly ApiItem[],
  query: string,
) {
  if (getOpenApiSpecificationFeatures(document?.openapi)?.family !== '3.2') return null;
  const byTag = new Map<string, ApiItem[]>();
  for (const api of apis) {
    const values = byTag.get(api.tag) ?? [];
    values.push(api);
    byTag.set(api.tag, values);
  }
  const groups = menuTags.map((group) => ({ tag: group.tag, operations: byTag.get(group.tag) ?? [] }));
  const declarations = (Array.isArray(document?.tags) ? document.tags : []).filter(
    (tag) => tag && typeof tag.name === 'string',
  ) as Oas32TagObject[];
  const navigation = buildOas32TagNavigation(groups, declarations, { ownerRetrievalUri: '', pointer: '#/tags' });
  return searchOas32TagNavigation(
    navigation,
    query,
    (api, q) => api.summary.toLowerCase().includes(q) || api.path.toLowerCase().includes(q),
  );
}

/** Bound Menu nesting, retaining every tag and its exact parent hint at the deepest visible level. */
export function oas32TagPresentationParents(
  navigation: NonNullable<ReturnType<typeof oas32TagMenu>>,
  maxDepth = 12,
): Map<string, string | undefined> {
  const parents = new Map<string, string | undefined>();
  const queue = navigation.roots.map((node) => ({ node, anchor: undefined as string | undefined }));
  for (let index = 0; index < queue.length; index++) {
    const { node, anchor } = queue[index];
    parents.set(node.name, node.depth <= maxDepth ? node.parentName : anchor);
    const nextAnchor = node.depth === maxDepth - 1 ? node.name : anchor;
    for (const child of node.children) queue.push({ node: child, anchor: nextAnchor });
  }
  return parents;
}
