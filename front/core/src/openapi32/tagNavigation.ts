import type { OpenApiObjectLocation } from '../openapiOperations';
import type { Oas32TagObject } from './types';

type TagLocation = Pick<OpenApiObjectLocation, 'ownerRetrievalUri' | 'pointer'>;

export interface Oas32TagGroup {
  readonly tag: string;
  readonly operations: readonly unknown[];
}

export interface Oas32TagNavigationDiagnostic extends TagLocation {
  readonly code: 'duplicate-tag' | 'unknown-parent-tag' | 'ambiguous-parent-tag' | 'tag-parent-cycle';
  readonly name: string;
  readonly reason: string;
}

export interface Oas32TagNavigationNode<TGroup extends Oas32TagGroup> {
  /** Exact OAS name, also suitable for the view's key and visible identity hint. */
  readonly name: string;
  readonly label: string;
  readonly kind?: string;
  /** Absent for an undeclared or ambiguously declared name. Raw declarations remain available. */
  readonly declaration?: Oas32TagObject;
  readonly declarations: readonly Oas32TagObject[];
  readonly groups: readonly TGroup[];
  /** Direct membership only; no descendant operations are copied to an ancestor. */
  readonly operations: readonly TGroup['operations'][number][];
  readonly parentName?: string;
  readonly children: readonly Oas32TagNavigationNode<TGroup>[];
  readonly depth: number;
}

export interface Oas32TagNavigation<TGroup extends Oas32TagGroup> {
  /** Flat order remains available to consumers; the hierarchy never replaces the operation registry. */
  readonly nodes: readonly Oas32TagNavigationNode<TGroup>[];
  readonly roots: readonly Oas32TagNavigationNode<TGroup>[];
  readonly diagnostics: readonly Oas32TagNavigationDiagnostic[];
}

type MutableNode<TGroup extends Oas32TagGroup> = Omit<
  {
    -readonly [Key in keyof Oas32TagNavigationNode<TGroup>]: Oas32TagNavigationNode<TGroup>[Key];
  },
  'children' | 'groups' | 'declarations'
> & { children: MutableNode<TGroup>[]; groups: TGroup[]; declarations: Oas32TagObject[] };

/**
 * The caller supplies the final flat menu order (declaration order, x-order and
 * sorter already applied). Only sibling placement changes. Missing menu entries
 * for declared pure parents are appended in declaration order so they remain visible.
 * Names are never URI-decoded, trimmed or replaced with their summary.
 */
export function buildOas32TagNavigation<TGroup extends Oas32TagGroup>(
  groups: readonly TGroup[],
  declarations: readonly Oas32TagObject[],
  tagsLocation: TagLocation,
): Oas32TagNavigation<TGroup> {
  const nodes: MutableNode<TGroup>[] = [];
  const byName = new Map<string, MutableNode<TGroup>>();
  const declarationIndexes = new Map<string, number[]>();
  const diagnostics: Oas32TagNavigationDiagnostic[] = [];
  const nodeFor = (name: string): MutableNode<TGroup> => {
    const existing = byName.get(name);
    if (existing) return existing;
    const node: MutableNode<TGroup> = {
      name,
      label: name,
      declarations: [],
      groups: [],
      operations: [],
      children: [],
      depth: 0,
    };
    nodes.push(node);
    byName.set(name, node);
    return node;
  };
  groups.forEach((group) => {
    const node = nodeFor(group.tag);
    // Even an unexpected repeated flat group cannot make one of its APIs disappear.
    node.operations = node.groups.length ? [...node.operations, ...group.operations] : group.operations;
    node.groups.push(group);
  });
  declarations.forEach((declaration, index) => {
    nodeFor(declaration.name).declarations.push(declaration);
    const indexes = declarationIndexes.get(declaration.name) ?? [];
    indexes.push(index);
    declarationIndexes.set(declaration.name, indexes);
  });
  const diagnose = (
    code: Oas32TagNavigationDiagnostic['code'],
    name: string,
    index: number,
    field: 'name' | 'parent',
    reason: string,
  ) => diagnostics.push({ ...tagsLocation, pointer: `${tagsLocation.pointer}/${index}/${field}`, code, name, reason });

  nodes.forEach((node) => {
    const indexes = declarationIndexes.get(node.name) ?? [];
    if (node.declarations.length > 1) {
      indexes
        .slice(1)
        .forEach((index) =>
          diagnose('duplicate-tag', node.name, index, 'name', 'Tag 名称必须唯一；不选择冲突定义的层级或显示元数据'),
        );
      return;
    }
    const declaration = node.declarations[0];
    if (!declaration) return;
    node.declaration = declaration;
    node.label =
      typeof declaration.summary === 'string' && declaration.summary.length > 0 ? declaration.summary : node.name;
    node.kind = typeof declaration.kind === 'string' ? declaration.kind : undefined;
    if (typeof declaration.parent !== 'string') return;
    const parent = byName.get(declaration.parent);
    if (!parent?.declarations.length) {
      diagnose('unknown-parent-tag', node.name, indexes[0], 'parent', 'parent 指向的 Tag 声明必须存在；已拒绝该连接');
    } else if (parent.declarations.length > 1) {
      diagnose('ambiguous-parent-tag', node.name, indexes[0], 'parent', 'parent 指向重复的 Tag 名称；已拒绝该连接');
    } else {
      node.parentName = declaration.parent;
    }
  });

  // Functional-graph traversal is linear and iterative. Cut every edge inside a
  // cycle, retaining valid descendants, instead of arbitrarily choosing a root.
  const completed = new Set<string>();
  nodes.forEach((node) => {
    const chain: MutableNode<TGroup>[] = [];
    const positions = new Map<string, number>();
    let current: MutableNode<TGroup> | undefined = node;
    while (current && !completed.has(current.name)) {
      const cycleStart = positions.get(current.name);
      if (cycleStart !== undefined) {
        chain.slice(cycleStart).forEach((member) => {
          member.parentName = undefined;
          declarationIndexes
            .get(member.name)
            ?.forEach((index) =>
              diagnose('tag-parent-cycle', member.name, index, 'parent', 'Tag parent 不能形成循环；已拒绝环内连接'),
            );
        });
        break;
      }
      positions.set(current.name, chain.length);
      chain.push(current);
      current = current.parentName === undefined ? undefined : byName.get(current.parentName);
    }
    chain.forEach((member) => completed.add(member.name));
  });

  const roots: MutableNode<TGroup>[] = [];
  nodes.forEach((node) => {
    const parent = node.parentName === undefined ? undefined : byName.get(node.parentName);
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  const queue = roots.slice();
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    node.children.forEach((child) => {
      child.depth = node.depth + 1;
      queue.push(child);
    });
  }
  return { nodes, roots, diagnostics };
}

/**
 * A tag name/summary match includes its entire subtree. An operation match keeps
 * only matching direct operations plus their ancestor path. All operation and
 * source group objects retain identity, including operations with multiple tags.
 */
export function searchOas32TagNavigation<TGroup extends Oas32TagGroup>(
  navigation: Oas32TagNavigation<TGroup>,
  query: string,
  matchesOperation: (operation: TGroup['operations'][number], normalizedQuery: string) => boolean = () => false,
): Oas32TagNavigation<TGroup> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return navigation;
  const traversal: Array<{ node: Oas32TagNavigationNode<TGroup>; inherited: boolean }> = navigation.roots.map(
    (node) => ({ node, inherited: false }),
  );
  const views = new Map<string, MutableNode<TGroup>>();
  const included = new Set<string>();
  for (let index = 0; index < traversal.length; index += 1) {
    const { node, inherited } = traversal[index];
    const matches =
      inherited || node.name.toLowerCase().includes(normalized) || node.label.toLowerCase().includes(normalized);
    const operations = matches
      ? node.operations
      : node.operations.filter((operation) => matchesOperation(operation, normalized));
    views.set(node.name, {
      ...node,
      groups: node.groups.slice(),
      declarations: node.declarations.slice(),
      operations,
      children: [],
    });
    if (matches || operations.length) included.add(node.name);
    node.children.forEach((child) => traversal.push({ node: child, inherited: matches }));
  }
  // Reverse breadth-first order closes ancestry without a recursion depth limit
  // or walking every leaf-to-root chain again (which would be quadratic).
  for (let index = traversal.length - 1; index >= 0; index -= 1) {
    const node = traversal[index].node;
    if (included.has(node.name) && node.parentName !== undefined) included.add(node.parentName);
  }
  const nodes: MutableNode<TGroup>[] = [];
  const roots: MutableNode<TGroup>[] = [];
  navigation.nodes.forEach((node) => {
    if (!included.has(node.name)) return;
    const view = views.get(node.name);
    if (!view) throw new Error('Tag navigation must be the complete result of buildOas32TagNavigation.');
    nodes.push(view);
    const parent = node.parentName === undefined ? undefined : views.get(node.parentName);
    if (parent) parent.children.push(view);
    else roots.push(view);
  });
  return { nodes, roots, diagnostics: navigation.diagnostics };
}
