import { buildOas32TagNavigation, searchOas32TagNavigation } from '../openapi32/tagNavigation';
import type { Oas32TagObject } from '../openapi32/types';
import { enumerateOpenApiOperations } from '../openapiOperations';

const location = { ownerRetrievalUri: 'https://docs.test/openapi.json', pointer: '#/tags' };
const operation = (key: string) => Object.freeze({ key, summary: key, path: `/${key}` });
const group = (tag: string, ...operations: ReturnType<typeof operation>[]) =>
  Object.freeze({ tag, operations: Object.freeze(operations) });
const names = (nodes: readonly { name: string }[]) => nodes.map((node) => node.name);

describe('OAS 3.2 tag navigation derived from the final flat menu order', () => {
  test.each(['3.2.0', '3.2.99'])(
    'preserves E identities for QUERY and case-sensitive custom methods in %s',
    (openapi) => {
      // Hand-written normative minimal fixture, including a valid optional-description Response.
      const declared = [{ name: 'parent' }, { name: 'child', parent: 'parent' }, { name: 'other' }];
      const subject = { tags: ['child', 'other'], responses: { '204': {} } };
      const operations = enumerateOpenApiOperations(
        {
          openapi,
          info: { title: 'Tag identity contract', version: '1' },
          tags: declared,
          paths: { '/items': { query: subject, additionalOperations: { COPY: subject, Copy: subject } } },
        },
        { retrievalUri: location.ownerRetrievalUri },
      );
      const result = buildOas32TagNavigation(
        [
          { tag: 'parent', operations: [] },
          { tag: 'child', operations },
          { tag: 'other', operations },
        ],
        declared,
        location,
      );
      expect(operations.map((op) => op.method)).toEqual(['QUERY', 'COPY', 'Copy']);
      expect(new Set(operations.map((op) => op.identity)).size).toBe(3);
      expect(result.roots[0].operations).toEqual([]);
      expect(result.roots[0].children[0].operations).toBe(operations);
      expect(new Set(result.nodes.flatMap((node) => node.operations))).toEqual(new Set(operations));
      const filtered = searchOas32TagNavigation(result, 'Copy', (op, query) => op.method.toLowerCase().includes(query));
      expect(filtered.nodes.flatMap((node) => node.operations).every((op) => operations.includes(op))).toBe(true);
    },
  );

  test('preserves source group and operation identities, direct membership and pure parents', () => {
    const shared = operation('QUERY');
    const local = operation('Copy');
    const groups = [group('child', shared), group('other', shared), group('root', local), group('pure')];
    const declarations: Oas32TagObject[] = [
      { name: 'child', summary: '显示', parent: 'root', kind: 'unregistered-kind' },
      { name: 'other', summary: '显示', parent: 'pure' },
      { name: 'root', summary: '根标签' },
      { name: 'pure' },
    ];
    const before = JSON.stringify({ groups, declarations });
    const result = buildOas32TagNavigation(groups, declarations, location);
    expect(result.diagnostics).toEqual([]);
    expect(names(result.roots)).toEqual(['root', 'pure']);
    expect(names(result.roots[0].children)).toEqual(['child']);
    expect(result.roots[0].operations).toBe(groups[2].operations);
    expect(result.roots[0].operations).toEqual([local]);
    expect(result.roots[0].children[0]).toMatchObject({ name: 'child', label: '显示', kind: 'unregistered-kind' });
    expect(result.roots[0].children[0].groups[0]).toBe(groups[0]);
    expect(result.roots[0].children[0].operations[0]).toBe(shared);
    expect(result.roots[1].operations).toEqual([]);
    expect(JSON.stringify({ groups, declarations })).toBe(before);
  });

  test('uses already applied x-order/sorter order for siblings without sorting by summary', () => {
    const declarations = [
      { name: 'z', summary: 'A', parent: 'root', 'x-order': 1 },
      { name: 'a', summary: 'Z', parent: 'root', 'x-order': 2 },
      { name: 'root' },
    ];
    expect(
      names(buildOas32TagNavigation([group('z'), group('root'), group('a')], declarations, location).roots[0].children),
    ).toEqual(['z', 'a']);
    expect(
      names(buildOas32TagNavigation([group('a'), group('z'), group('root')], declarations, location).roots[0].children),
    ).toEqual(['a', 'z']);
  });

  test('does not decode, trim, rename or coalesce legal names and identical summaries', () => {
    const declarations = [
      { name: '', summary: '空名称' },
      { name: '%2F', summary: 'same', parent: '' },
      { name: '/', summary: 'same', parent: '' },
      { name: '中文 🧭', summary: '', parent: '%2F', kind: '' },
      { name: ' leading ' },
    ];
    const result = buildOas32TagNavigation(
      declarations.map(({ name }) => group(name)),
      declarations,
      location,
    );
    expect(names(result.nodes)).toEqual(['', '%2F', '/', '中文 🧭', ' leading ']);
    expect(names(result.roots)).toEqual(['', ' leading ']);
    expect(result.nodes[3]).toMatchObject({ label: '中文 🧭', kind: '', parentName: '%2F' });
    expect(result.nodes[1].parentName).toBe('');
    expect(result.diagnostics).toEqual([]);
  });

  test('adds declaration-only nodes and keeps undeclared and ungrouped menu operations reachable', () => {
    const unknown = operation('unknown');
    const ungrouped = operation('default');
    const result = buildOas32TagNavigation(
      [group('unlisted', unknown), group('default', ungrouped)],
      [{ name: 'pure' }],
      location,
    );
    expect(names(result.roots)).toEqual(['unlisted', 'default', 'pure']);
    expect(result.nodes.flatMap((node) => node.operations)).toEqual([unknown, ungrouped]);
  });

  test('rejects ambiguous duplicate declarations without choosing either metadata definition', () => {
    const op = operation('still-reachable');
    const result = buildOas32TagNavigation(
      [group('dup', op), group('child')],
      [
        { name: 'dup', summary: 'first', parent: 'root' },
        { name: 'dup', summary: 'second', parent: 'elsewhere' },
        { name: 'child', parent: 'dup' },
        { name: 'root' },
      ],
      location,
    );
    expect(result.nodes[0]).toMatchObject({ name: 'dup', label: 'dup', operations: [op] });
    expect(result.nodes[0].declaration).toBeUndefined();
    expect(result.nodes[0].declarations).toHaveLength(2);
    expect(result.nodes[1].parentName).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'duplicate-tag',
          pointer: '#/tags/1/name',
          ownerRetrievalUri: location.ownerRetrievalUri,
        }),
        expect.objectContaining({ code: 'ambiguous-parent-tag', pointer: '#/tags/2/parent' }),
      ]),
    );
  });

  test('cuts only missing and cyclic connections while keeping descendants and operations', () => {
    const declarations = [
      { name: 'child', parent: 'a' },
      { name: 'a', parent: 'b' },
      { name: 'b', parent: 'a' },
      { name: 'self', parent: 'self' },
      { name: 'missing', parent: 'absent' },
      { name: 'healthy', parent: 'child' },
    ];
    const groups = declarations.map(({ name }) => group(name, operation(name)));
    const result = buildOas32TagNavigation(groups, declarations, location);
    expect(names(result.roots)).toEqual(['a', 'b', 'self', 'missing']);
    expect(names(result.roots[0].children)).toEqual(['child']);
    expect(names(result.roots[0].children[0].children)).toEqual(['healthy']);
    expect(result.nodes.flatMap((node) => node.operations)).toEqual(groups.flatMap((item) => item.operations));
    expect(result.diagnostics.filter((item) => item.code === 'tag-parent-cycle')).toHaveLength(3);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unknown-parent-tag', pointer: '#/tags/4/parent' }),
    );
  });

  test('searches parent name/summary with descendants and keeps ancestors for operation matches', () => {
    const one = operation('needle');
    const two = operation('unrelated');
    const result = buildOas32TagNavigation(
      [group('root'), group('branch'), group('leaf', one, two), group('other', two)],
      [
        { name: 'root', summary: '目录' },
        { name: 'branch', parent: 'root', summary: 'Folder' },
        { name: 'leaf', parent: 'branch' },
        { name: 'other' },
      ],
      location,
    );
    for (const query of ['branch', 'folder', '目录']) {
      const view = searchOas32TagNavigation(result, query);
      expect(names(view.nodes)).toEqual(['root', 'branch', 'leaf']);
      expect(view.nodes[2].operations).toBe(result.nodes[2].operations);
    }
    const filtered = searchOas32TagNavigation(result, 'needle', (op, query) => op.summary.includes(query));
    expect(names(filtered.nodes)).toEqual(['root', 'branch', 'leaf']);
    expect(filtered.nodes[2].operations).toEqual([one]);
    expect(filtered.nodes[2].operations[0]).toBe(one);
    expect(filtered.nodes[0].operations).toEqual([]);
    expect(searchOas32TagNavigation(result, 'not found').roots).toEqual([]);
    expect(searchOas32TagNavigation(result, '  ')).toBe(result);
  });

  test('builds and searches a long chain iteratively without losing the last API', () => {
    const count = 12000;
    const declarations = Array.from({ length: count }, (_, i) => ({
      name: `tag-${i}`,
      ...(i ? { parent: `tag-${i - 1}` } : {}),
    }));
    const last = operation('last');
    const groups = declarations.map(({ name }, i) => group(name, ...(i === count - 1 ? [last] : [])));
    const result = buildOas32TagNavigation(groups, declarations, location);
    expect(result.nodes[count - 1].depth).toBe(count - 1);
    const found = searchOas32TagNavigation(result, 'last', (op) => op === last);
    expect(found.nodes).toHaveLength(count);
    expect(found.nodes[count - 1].operations[0]).toBe(last);
  });
});
