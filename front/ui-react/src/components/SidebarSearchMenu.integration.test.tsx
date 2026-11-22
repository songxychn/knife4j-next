import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectOas32DocumentDiagnostics, operationHttpMethod } from 'knife4j-core';
import { parseMenuTags } from '../api/knife4jClient';
import { apiOperationIdentity } from '../apiChange/apiChangeTracker';
import type { SwaggerDoc } from '../types/swagger';
import { createReactTestRoot } from '../test/reactTestRoot';

const state = vi.hoisted(() => ({
  group: {} as Record<string, unknown>,
  settings: { enableSearch: false, enableSwaggerModels: false, swaggerModelName: '' },
  apiChanges: {
    enabled: true,
    ready: true,
    scopeKey: 'oas32',
    statuses: {} as Record<string, 'added' | 'changed'>,
    summary: { added: 0, changed: 0, total: 0 },
    unavailableReason: null as string | null,
    acknowledgeOperation: vi.fn(),
    acknowledgeAll: vi.fn(),
  },
}));

interface MenuItem {
  key: string;
  title?: string;
  className?: string;
  label?: ReactNode;
  children?: MenuItem[];
}

// Expose the menu labels and hints supplied by Sidebar without involving Antd's
// submenu motion or tooltip delays. Every label still renders through React.
function MenuList({ items = [] }: { items?: MenuItem[] }) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={item.key ?? index} data-menu-key={item.key} className={item.className} title={item.title}>
          <div data-menu-label="">{item.label}</div>
          {item.children && <MenuList items={item.children} />}
        </li>
      ))}
    </ul>
  );
}

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<typeof import('antd')>()),
  Menu: (props: { items?: MenuItem[] }) => <MenuList items={props.items} />,
  Tooltip: ({ title, children }: { title: ReactNode; children: ReactNode }) => (
    <span>
      {children}
      <span hidden data-tooltip="">
        {title}
      </span>
    </span>
  ),
}));
vi.mock('./Markdown', () => ({ default: ({ source }: { source: string }) => <span data-markdown="">{source}</span> }));
vi.mock('../context/GroupContext', () => ({ useGroup: () => state.group }));
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ settings: state.settings }) }));
vi.mock('../context/GlobalParamContext', () => ({ useGlobalParam: () => ({ effectiveParams: [] }) }));
vi.mock('../context/ApiChangeContext', () => ({ useApiChanges: () => state.apiChanges }));

import SidebarSearchMenu from './SidebarSearchMenu';

let view: ReturnType<typeof createReactTestRoot>;
beforeEach(() => {
  view = createReactTestRoot();
  localStorage.clear();
});
afterEach(async () => {
  await view.unmount();
  vi.clearAllMocks();
});

async function renderSidebar() {
  await view.render(<SidebarSearchMenu selectedKey="" onMenuClick={() => undefined} />);
}

function labelOf(item: Element): HTMLElement {
  return item.querySelector<HTMLElement>(':scope > [data-menu-label]')!;
}

function visibleText(item: Element): string {
  const label = labelOf(item).cloneNode(true) as HTMLElement;
  label.querySelectorAll('[hidden]').forEach((element) => element.remove());
  return label.textContent ?? '';
}

function hintOf(item: Element): HTMLElement | null {
  return labelOf(item).querySelector('[data-tooltip]');
}

async function tagItems() {
  await renderSidebar();
  return [...view.container.querySelectorAll<HTMLElement>('.knife4j-sidebar-api-tag')];
}

function valid32(): SwaggerDoc {
  const document = {
    openapi: '3.2.0',
    info: { title: 'Sidebar identity', version: '1.0.0' },
    paths: {
      '/files': {
        additionalOperations: {
          COPY: { summary: 'Upper copy', responses: { 200: { description: 'upper' } } },
          Copy: { summary: 'Mixed copy', responses: { 200: { description: 'mixed' } } },
        },
      },
      '/items': {
        get: { summary: 'Get items', responses: { 200: { description: 'get' } } },
        query: { summary: 'Query items', responses: { 200: { description: 'query' } } },
      },
    },
  };
  expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
  return document as SwaggerDoc;
}

describe('SidebarSearchMenu OAS 3.2 change identity', () => {
  beforeEach(() => {
    const document = valid32();
    const menuTags = parseMenuTags(document, { retrievalUri: 'https://sidebar.knife4j.example/openapi.json' });
    const apis = menuTags.flatMap((tag) =>
      tag.operations.map((operation) => ({
        key: operation.key,
        method: operationHttpMethod(operation),
        path: operation.path,
        summary: operation.summary,
        tag: tag.tag,
      })),
    );
    state.group = {
      activeGroup: { value: 'events', label: 'events', apis },
      swaggerDoc: document,
      menuTags,
      markdownDocs: [],
      schemas: {},
    };
    state.apiChanges.ready = true;
    state.apiChanges.unavailableReason = null;
    state.apiChanges.statuses = {
      [apiOperationIdentity('COPY', '/files')]: 'added',
      [apiOperationIdentity('Copy', '/files')]: 'changed',
      [apiOperationIdentity('GET', '/items')]: 'added',
      [apiOperationIdentity('QUERY', '/items')]: 'changed',
    };
    state.apiChanges.summary = { added: 2, changed: 2, total: 4 };
  });

  it('maps COPY and Copy pills independently and does not collapse QUERY into GET', async () => {
    await renderSidebar();
    const byMethod = new Map<string, string>();
    for (const operation of view.container.querySelectorAll<HTMLElement>('li[title]')) {
      const method = operation.title.split(' ')[0];
      if (['COPY', 'Copy', 'GET', 'QUERY'].includes(method)) byMethod.set(method, visibleText(operation));
    }
    for (const [method, status] of [
      ['COPY', 'sidebar.apiChange.new'],
      ['Copy', 'sidebar.apiChange.changed'],
      ['GET', 'sidebar.apiChange.new'],
      ['QUERY', 'sidebar.apiChange.changed'],
    ]) {
      expect(byMethod.get(method)).toContain(method);
      expect(byMethod.get(method)).toContain(status);
    }
    expect(byMethod.get('COPY')).not.toEqual(byMethod.get('Copy'));
  });

  it('surfaces OAS 3.2 unavailable reasons without inventing unchanged status', async () => {
    state.apiChanges.ready = false;
    state.apiChanges.statuses = {};
    state.apiChanges.summary = { added: 0, changed: 0, total: 0 };
    state.apiChanges.unavailableReason = 'resource-pending';
    await renderSidebar();
    const status = view.container.querySelector('[data-api-change-state="resource-pending"]');
    expect(status?.textContent).toContain('sidebar.apiChange.unavailable.resourcePending');
  });
});

describe('SidebarSearchMenu tag presentation', () => {
  function loadTags(
    tags: Array<{ name: string; summary?: string; description?: string; parent?: string; kind?: string }>,
    openapi = '3.2.0',
  ) {
    const document = {
      openapi,
      info: { title: 'Tag presentation', version: '1' },
      tags,
      paths: Object.fromEntries(
        tags.map((tag, index) => [
          `/example/${index}`,
          {
            get: { tags: [tag.name], responses: { '200': { description: 'OK' } } },
          },
        ]),
      ),
    } as SwaggerDoc;
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const menuTags = parseMenuTags(document);
    state.group = {
      activeGroup: {
        value: 'tags',
        label: 'tags',
        apis: menuTags.flatMap((tag) =>
          tag.operations.map((operation) => ({
            key: operation.key,
            method: operationHttpMethod(operation),
            path: operation.path,
            summary: operation.summary,
            tag: tag.tag,
          })),
        ),
      },
      swaggerDoc: document,
      menuTags,
      markdownDocs: [],
      schemas: {},
    };
    state.apiChanges.statuses = {};
    state.apiChanges.ready = true;
    state.apiChanges.unavailableReason = null;
  }

  it('shows an ordinary OAS 3.2 tag name only once', async () => {
    loadTags([{ name: '1.扩展项目API', description: 'ExtProjectAPI' }]);
    const [item] = await tagItems();
    expect(visibleText(item)).toBe('1.扩展项目API');
    expect(hintOf(item)?.querySelector('[data-markdown]')?.textContent).toBe('ExtProjectAPI');
    expect(hintOf(item)?.textContent).not.toContain('name: "1.扩展项目API"');
  });

  it.each([undefined, '', 'ordinary'])('omits an empty tooltip when summary is %s', async (summary) => {
    loadTags([{ name: 'ordinary', ...(summary === undefined ? {} : { summary }) }]);
    const [item] = await tagItems();
    expect(hintOf(item)).toBeNull();
  });

  it('uses summary for display and retains the exact name in a tooltip', async () => {
    loadTags([{ name: 'internal-name', summary: '展示标题' }]);
    const [item] = await tagItems();
    expect(item.dataset.menuKey).toBe('tag-internal-name');
    expect(visibleText(item)).toBe('展示标题');
    expect(hintOf(item)?.textContent).toContain('name: "internal-name"');
  });

  it('disambiguates equal displayed labels, including summary/name collisions', async () => {
    loadTags([{ name: 'first', summary: '共享标题' }, { name: '共享标题' }, { name: 'third', summary: '共享标题' }]);
    const items = await tagItems();
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(visibleText(item)).toBe(`共享标题name: ${JSON.stringify(item.dataset.menuKey?.slice(4))}`);
    }
  });

  it('keeps nesting and metadata without a permanent field list', async () => {
    loadTags([{ name: 'parent' }, { name: 'child', parent: 'parent', kind: 'audience' }]);
    const items = await tagItems();
    const parent = items.find((item) => item.dataset.menuKey === 'tag-parent')!;
    const child = items.find((item) => item.dataset.menuKey === 'tag-child')!;
    expect(parent.contains(child)).toBe(true);
    expect(visibleText(child)).toBe('child');
    expect(hintOf(child)?.textContent).toContain('kind: audience');
    expect(hintOf(child)?.textContent).toContain('parent: "parent"');
    expect(hintOf(child)?.textContent).not.toContain('name: "child"');
  });

  it('retains kind metadata without a description or parent', async () => {
    loadTags([{ name: 'audience', kind: 'audience' }]);
    const [item] = await tagItems();
    expect(hintOf(item)?.textContent).toBe('kind: audience');
  });

  it('retains parent metadata without a description or kind', async () => {
    loadTags([{ name: 'parent' }, { name: 'child', parent: 'parent' }]);
    const items = await tagItems();
    const item = items.find((entry) => entry.dataset.menuKey === 'tag-child')!;
    expect(hintOf(item)?.textContent).toBe('parent: "parent"');
  });

  it.each(['3.0.3', '3.1.0'])('preserves the OAS %s tag presentation', async (openapi) => {
    loadTags([{ name: 'Existing tag', description: 'Existing description' }], openapi);
    const [item] = await tagItems();
    expect(visibleText(item)).toBe('Existing tag');
    expect(hintOf(item)?.querySelector('[data-markdown]')?.textContent).toBe('Existing description');
    expect(hintOf(item)?.textContent).toBe('Existing description');
  });
});
