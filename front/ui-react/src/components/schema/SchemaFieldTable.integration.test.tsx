import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildSchemaFieldTree, type SchemaFieldNode } from 'knife4j-core';
import { createReactTestRoot, stubLayoutApis } from '../../test/reactTestRoot';
import SchemaFieldTable, { SchemaTypeLink } from './SchemaFieldTable';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../context/GroupContext', () => ({
  useGroup: () => ({ activeGroup: { value: 'default' }, schemas: doc.components.schemas, swaggerDoc: doc }),
}));

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

let view: ReturnType<typeof createReactTestRoot>;
beforeEach(() => {
  stubLayoutApis();
  view = createReactTestRoot();
});
afterEach(async () => {
  await view.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function showFields(fields: SchemaFieldNode[]) {
  await view.render(
    <MemoryRouter>
      <SchemaFieldTable fields={fields} />
    </MemoryRouter>,
  );
  return [
    ...view.container.querySelectorAll<HTMLTableCellElement>('tbody tr:not(.ant-table-measure-row) td:first-child'),
  ];
}

function fieldNames(cells: HTMLTableCellElement[]) {
  return cells.map((cell) => cell.querySelector('code')?.textContent);
}

describe('schema field names', () => {
  test('adds enum/default details to the description cell while preserving descriptions and flags', async () => {
    const schema = {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: '登录来源',
          enum: ['mch_web', 'mch_app', 'mch_h5'],
          default: 'mch_web',
          example: 'mch_app',
          deprecated: true,
        },
      },
    };
    const fields = buildSchemaFieldTree(schema, { doc });
    const original = structuredClone(fields);
    const [first] = await showFields(fields);
    const description = first.parentElement?.lastElementChild;
    expect(description?.textContent).toContain('登录来源');
    expect(description?.textContent).toContain('schema.values.enum');
    expect(description?.textContent).toContain('schema.values.default');
    expect(description?.textContent).toContain('schema.flag.deprecated');
    expect([...description!.querySelectorAll('code')].map((value) => value.textContent)).toEqual([
      '"mch_web"',
      '"mch_app"',
      '"mch_h5"',
      '"mch_web"',
    ]);
    expect(fields).toEqual(original);
  });

  test.each(['Download', 'Text'])('labels the %s response root without inventing an items field', async (name) => {
    const fields = buildSchemaFieldTree({ $ref: `#/components/schemas/${name}` }, { doc });
    const cells = await showFields(fields);
    expect(fieldNames(cells)).toEqual(['schema.rootNode']);
    expect(cells[0].querySelector('[title="schema.rootNode"]')).not.toBeNull();
    expect(fields[0].name).toBe('');
    if (name === 'Download') expect(fields[0]).toMatchObject({ format: 'binary', description: 'ZIP 文件流' });
  });

  test('keeps nested array items while distinguishing the array root', async () => {
    const fields = buildSchemaFieldTree({ $ref: '#/components/schemas/Array' }, { doc });
    expect(fieldNames(await showFields(fields))).toEqual(['schema.rootNode', 'items', 'items']);
  });

  test('preserves actual items and empty-string property names', async () => {
    const fields = buildSchemaFieldTree({ $ref: '#/components/schemas/Named' }, { doc });
    expect(fieldNames(await showFields(fields))).toEqual(['items', '""']);
  });

  test('uses the same root label in the referenced model preview', async () => {
    vi.useFakeTimers();
    await view.render(
      <MemoryRouter>
        <SchemaTypeLink node={{ name: 'file', type: 'string', required: false, refName: 'Download' }} />
      </MemoryRouter>,
    );
    const model = view.container.querySelector<HTMLAnchorElement>('a[href="/default/schema/Download"]');
    expect(model).not.toBeNull();
    await act(async () => {
      model!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(250);
    });
    const names = [...document.querySelectorAll('.ant-popover code')].map((value) => value.textContent);
    expect(names).toEqual(['schema.rootNode']);
  });

  test('surfaces Schema XML Object metadata on the type tag', async () => {
    await view.render(
      <SchemaTypeLink
        node={{
          name: 'id',
          type: 'integer',
          required: false,
          xml: { nodeType: 'attribute', name: 'id', namespace: 'urn:pets' },
        }}
      />,
    );
    expect(view.container.querySelector('.ant-tag')?.textContent).toBe('integer · xml:attribute');
  });
});
