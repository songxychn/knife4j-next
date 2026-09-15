import { beforeEach, describe, expect, test, vi } from 'vitest';
import { interpretExampleObject } from 'knife4j-core';
import type { OperationExampleResult, OperationExampleTarget } from '../../schema/operationExampleCatalog';

const hooks = vi.hoisted(() => ({
  calls: 0,
  result: undefined as OperationExampleResult | undefined,
  selected: undefined as string | undefined,
}));
const jsxFactory = vi.hoisted(() => (type: unknown, props: Record<string, unknown>) => ({ type, props }));
vi.mock('react/jsx-runtime', () => ({ jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory, Fragment: 'Fragment' }));
vi.mock('react/jsx-dev-runtime', () => ({ jsxDEV: jsxFactory, Fragment: 'Fragment' }));
vi.mock('react', () => ({
  useState: () => {
    const n = hooks.calls++;
    return n === 0
      ? [
          hooks.selected,
          (id: string) => {
            hooks.selected = id;
          },
        ]
      : [hooks.result && { target: hooks.result.target, result: hooks.result }, () => {}];
  },
  useEffect: () => {},
  useRef: (current: unknown) => ({ current }),
}));
vi.mock('antd', () => ({
  Alert: 'Alert',
  Button: 'Button',
  Select: 'Select',
  Space: 'Space',
  Tooltip: 'Tooltip',
  Typography: { Text: 'Text', Paragraph: 'Paragraph' },
}));
vi.mock('@ant-design/icons', () => ({ QuestionCircleOutlined: 'QuestionCircleOutlined' }));
vi.mock('../../pages/api/CodeBlock', () => ({ default: 'CodeBlock' }));
vi.mock('./SchemaExampleNotice', () => ({ default: 'SchemaExampleNotice' }));
vi.mock('./SchemaDiscriminatorPanel', () => ({ default: 'SchemaDiscriminatorPanel' }));
import OperationExamplePicker from './OperationExamplePicker';

type Element = { type: unknown; props: Record<string, unknown> };
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Element;
  return [node, ...elements(node.props.children)];
}
function target(source: Record<string, unknown>, mediaType = 'application/json'): OperationExampleTarget {
  const location = {
    ownerRetrievalUri: 'https://example.test/openapi.json',
    pointer: '/paths/~1examples/post/requestBody',
    value: source,
  };
  return {
    id: 'json',
    group: 'body:application/json',
    name: 'json',
    operationIdentity: 'post:/examples',
    generation: 1,
    direction: 'request',
    layer: 'media',
    mediaType,
    sourceLocation: location,
    containerLocation: location,
    source,
    context: { layer: 'media', mediaType },
  };
}
function render(entry: OperationExampleTarget, onApply = vi.fn(), targets = [entry]) {
  hooks.calls = 0;
  hooks.result = {
    target: entry,
    representation: interpretExampleObject(entry.source!, entry.context),
    authored: true,
  };
  return { nodes: elements(OperationExamplePicker({ targets, onApply })), onApply, result: hooks.result };
}
function expandedBlocks(nodes: Element[]) {
  const folded = new Set(
    nodes.filter((n) => n.type === 'details' && !n.props.open).flatMap((n) => elements(n.props.children)),
  );
  return nodes.filter((n) => n.type === 'CodeBlock' && !folded.has(n));
}
beforeEach(() => {
  hooks.selected = undefined;
});
describe('OperationExamplePicker JSON representations', () => {
  test.each([{ ids: ['one'] }, { ids: [] }, [], null, false, 0, ''].map((data) => [data]))(
    'collapses the same example raw text for %j',
    (data) => {
      const { nodes } = render(target({ value: data }));
      expect(expandedBlocks(nodes)).toHaveLength(1);
      expect(nodes.find((n) => n.type === 'details')?.props.open).toBeFalsy();
      expect(nodes.some((n) => n.type === 'summary')).toBe(true);
    },
  );
  test('keeps authored whitespace, escapes, number spelling and key order in the original text', () => {
    const raw = ' { "n": 1e0, "ids": ["\\u006fne"] }\n';
    const { nodes, result, onApply } = render(target({ dataValue: { ids: ['one'], n: 1 }, serializedValue: raw }));
    expect(expandedBlocks(nodes)).toHaveLength(1);
    expect(nodes.filter((n) => n.type === 'CodeBlock').map((n) => n.props.code)).toContain(raw);
    const details = nodes.find((n) => n.type === 'details')!;
    expect(details.props.onToggle).toBeUndefined();
    expect(onApply).not.toHaveBeenCalled();
    (nodes.find((n) => n.type === 'Button')!.props.onClick as () => void)();
    expect(onApply).toHaveBeenCalledWith(result, 0);
    expect(result.representation.text).toBe(raw);
  });
  test.each([
    [{ dataValue: { ids: [] }, serializedValue: '{"ids":["one"]}' }, 'application/json'],
    [{ dataValue: {}, serializedValue: '{bad' }, 'application/json'],
    [{ dataValue: 9007199254740991, serializedValue: '9007199254740993' }, 'application/json'],
    [{ dataValue: 'hello' }, 'text/plain'],
    [{ dataValue: { ids: [] }, serializedValue: '<ids/>' }, 'application/xml'],
    [{ dataValue: {}, serializedValue: '' }, 'application/x-www-form-urlencoded'],
    [{ dataValue: [], serializedValue: '\u001e[]\n' }, 'application/json-seq'],
    [{ dataValue: [], externalValue: 'https://example.test/data.json' }, 'application/json'],
  ])('does not collapse differing, unverified, external or non-JSON examples (%j, %s)', (source, media) => {
    const { nodes, result } = render(target(source as Record<string, unknown>, media as string));
    expect(nodes.some((n) => n.type === 'details')).toBe(false);
    if (result.representation.text !== undefined) expect(expandedBlocks(nodes)).toHaveLength(2);
    if (result.representation.diagnostics.length) expect(nodes.some((n) => n.type === 'Alert')).toBe(true);
  });
  test('keeps named examples selectable and renders the selected empty array', () => {
    const first = target({ value: { ids: ['one'] } });
    const second = { ...target({ value: { ids: [] } }), id: 'empty', name: 'empty' };
    const onApply = vi.fn();
    const before = render(first, onApply, [first, second]);
    const select = before.nodes.find((n) => n.type === 'Select')!;
    expect(select.props.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: 'json' }), expect.objectContaining({ value: 'empty' })]),
    );
    (select.props.onChange as (id: string) => void)('empty');
    const after = render(second, onApply, [first, second]);
    expect(after.nodes.find((n) => n.type === 'Select')!.props.value).toBe('empty');
    expect(expandedBlocks(after.nodes).map((n) => n.props.code)).toEqual([JSON.stringify({ ids: [] }, null, 2)]);
  });
  test('does not collapse sequential media with itemSchema', () => {
    const entry = { ...target({ value: [] }), itemSchemaLocation: target({}).sourceLocation };
    expect(render(entry).nodes.some((n) => n.type === 'details')).toBe(false);
  });
});
