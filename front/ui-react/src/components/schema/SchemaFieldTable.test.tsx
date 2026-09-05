import { describe, expect, test, vi } from 'vitest';
import { buildSchemaFieldTree, type SchemaFieldNode } from 'knife4j-core';

const { jsxFactory } = vi.hoisted(() => ({
  jsxFactory: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
}));
vi.mock('react/jsx-runtime', () => ({ jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory }));
vi.mock('react/jsx-dev-runtime', () => ({ jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory }));
vi.mock('antd', () => ({
  Badge: 'Badge',
  Popover: 'Popover',
  Space: 'Space',
  Table: 'Table',
  Tag: 'Tag',
  Tooltip: 'Tooltip',
  Typography: { Text: 'Text' },
}));
vi.mock('react-router-dom', () => ({ Link: 'Link' }));
vi.mock('react-resizable', () => ({ Resizable: 'Resizable' }));
vi.mock('../DescriptionText', () => ({ default: 'DescriptionText' }));
vi.mock('../../context/GroupContext', () => ({
  useGroup: () => ({ activeGroup: { value: 'default' }, schemas: doc.components.schemas, swaggerDoc: doc }),
}));

import SchemaFieldTable, { SchemaTypeLink } from './SchemaFieldTable';

const doc = {
  openapi: '3.0.3',
  info: { title: 'Anonymous schema root regression', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      Download: { type: 'string', format: 'binary', description: 'ZIP 文件流' },
      Text: { type: 'string' },
      Array: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
      Named: { type: 'object', properties: { items: { type: 'string' }, '': { type: 'integer' } } },
    },
  },
};

interface Element {
  type: unknown;
  props: Record<string, unknown>;
}

function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (value === null || typeof value !== 'object' || !('type' in value) || !('props' in value)) return [];
  const element = value as Element;
  return [element, ...Object.values(element.props).flatMap(elements)];
}

function nameCells(fields: SchemaFieldNode[]) {
  const table = SchemaFieldTable({ fields });
  const column = table.props.columns.find((value: { dataIndex?: string }) => value.dataIndex === 'name');
  const visit = (rows: SchemaFieldNode[]): Element[] =>
    rows.flatMap((row) => [column.render(row.name, row), ...visit(row.children ?? [])]);
  return visit(table.props.dataSource);
}

describe('schema field names', () => {
  test.each(['Download', 'Text'])('labels the %s response root without inventing an items field', (name) => {
    const fields = buildSchemaFieldTree({ $ref: `#/components/schemas/${name}` }, { doc });
    const [cell] = nameCells(fields);
    expect(cell.props.children).toBe('schema.rootNode');
    expect(cell.props.title).toBe('schema.rootNode');
    expect(fields[0].name).toBe('');
    if (name === 'Download') expect(fields[0]).toMatchObject({ format: 'binary', description: 'ZIP 文件流' });
  });

  test('keeps nested array items while distinguishing the array root', () => {
    const fields = buildSchemaFieldTree({ $ref: '#/components/schemas/Array' }, { doc });
    expect(nameCells(fields).map((cell) => cell.props.children)).toEqual(['schema.rootNode', 'items', 'items']);
  });

  test('preserves actual items and empty-string property names', () => {
    const fields = buildSchemaFieldTree({ $ref: '#/components/schemas/Named' }, { doc });
    expect(nameCells(fields).map((cell) => cell.props.children)).toEqual(['items', '""']);
  });

  test('uses the same root label in the referenced model preview', () => {
    const tree = SchemaTypeLink({ node: { name: 'file', type: 'string', required: false, refName: 'Download' } });
    const previewNames = elements(tree)
      .filter((element) => element.type === 'Text' && element.props.code)
      .map((element) => element.props.children);
    expect(previewNames).toEqual(['schema.rootNode']);
  });
});
