import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectOas32DocumentDiagnostics, operationHttpMethod } from 'knife4j-core';
import { parseMenuTags } from '../api/knife4jClient';
import { apiOperationIdentity } from '../apiChange/apiChangeTracker';
import type { SwaggerDoc } from '../types/swagger';

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
  jsx: (type: unknown, props: Record<string, unknown> | null) => ({ type, props: props ?? {} }),
}));

vi.mock('react', () => ({
  useEffect: () => undefined,
  useState: <T,>(initial: T) => [typeof initial === 'function' ? (initial as () => T)() : initial, vi.fn()],
  useMemo: <T,>(factory: () => T) => factory(),
}));
vi.mock('react/jsx-runtime', () => ({ jsx: state.jsx, jsxs: state.jsx, jsxDEV: state.jsx, Fragment: 'Fragment' }));
vi.mock('react/jsx-dev-runtime', () => ({ jsxDEV: state.jsx, Fragment: 'Fragment' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('antd', () => ({
  Button: 'Button',
  Input: 'Input',
  Tooltip: 'Tooltip',
  Menu: 'Menu',
}));
vi.mock('@ant-design/icons', () => ({
  ApiOutlined: 'ApiOutlined',
  CheckOutlined: 'CheckOutlined',
  ControlOutlined: 'ControlOutlined',
  DatabaseOutlined: 'DatabaseOutlined',
  FileMarkdownOutlined: 'FileMarkdownOutlined',
  InfoCircleOutlined: 'InfoCircleOutlined',
  LoginOutlined: 'LoginOutlined',
  SearchOutlined: 'SearchOutlined',
  SafetyCertificateOutlined: 'SafetyCertificateOutlined',
}));
vi.mock('../components/Markdown', () => ({ default: 'Markdown' }));
vi.mock('../context/GroupContext', () => ({ useGroup: () => state.group }));
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ settings: state.settings }) }));
vi.mock('../context/GlobalParamContext', () => ({ useGlobalParam: () => ({ effectiveParams: [] }) }));
vi.mock('../context/ApiChangeContext', () => ({ useApiChanges: () => state.apiChanges }));

import SidebarSearchMenu from './SidebarSearchMenu';

interface Element {
  type: unknown;
  props: Record<string, unknown>;
}

function walk(value: unknown, visit: (element: Element) => void): void {
  if (!value || typeof value !== 'object') return;
  if ('type' in value && 'props' in value) visit(value as Element);
  Object.values(value as Record<string, unknown>).forEach((child) => walk(child, visit));
}

function texts(value: unknown): string[] {
  const found: string[] = [];
  walk(value, (element) => {
    const children = element.props.children;
    if (typeof children === 'string') found.push(children);
    if (Array.isArray(children)) {
      children.forEach((child) => {
        if (typeof child === 'string') found.push(child);
      });
    }
  });
  return found;
}

function operationRecords(value: unknown): Array<{ title?: unknown; label?: unknown }> {
  const found: Array<{ title?: unknown; label?: unknown }> = [];
  const visit = (candidate: unknown) => {
    if (!candidate || typeof candidate !== 'object') return;
    if ('title' in candidate && 'label' in candidate) found.push(candidate as { title?: unknown; label?: unknown });
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return found;
}

function renderSidebar(): Element {
  return SidebarSearchMenu({
    selectedKey: '',
    onMenuClick: () => undefined,
  }) as Element;
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

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('maps COPY and Copy pills independently and does not collapse QUERY into GET', () => {
    const tree = renderSidebar();
    const byMethod = new Map<string, string[]>();
    for (const operation of operationRecords(tree)) {
      const method = String(operation.title ?? '').split(' ')[0];
      if (['COPY', 'Copy', 'GET', 'QUERY'].includes(method)) {
        byMethod.set(method, texts(operation.label));
      }
    }
    expect(byMethod.get('COPY')).toEqual(expect.arrayContaining(['COPY', 'sidebar.apiChange.new']));
    expect(byMethod.get('Copy')).toEqual(expect.arrayContaining(['Copy', 'sidebar.apiChange.changed']));
    expect(byMethod.get('GET')).toEqual(expect.arrayContaining(['GET', 'sidebar.apiChange.new']));
    expect(byMethod.get('QUERY')).toEqual(expect.arrayContaining(['QUERY', 'sidebar.apiChange.changed']));
    expect(byMethod.get('COPY')).not.toEqual(byMethod.get('Copy'));
  });

  it('surfaces OAS 3.2 unavailable reasons without inventing unchanged status', () => {
    state.apiChanges.ready = false;
    state.apiChanges.statuses = {};
    state.apiChanges.summary = { added: 0, changed: 0, total: 0 };
    state.apiChanges.unavailableReason = 'resource-pending';
    const tree = renderSidebar();
    const status = (function find(value: unknown): Element | undefined {
      if (!value || typeof value !== 'object') return undefined;
      if (
        'props' in value &&
        (value as Element).props &&
        (value as Element).props['data-api-change-state'] === 'resource-pending'
      ) {
        return value as Element;
      }
      return Object.values(value)
        .map((child) => find(child))
        .find(Boolean);
    })(tree);
    expect(status?.props['data-api-change-state']).toBe('resource-pending');
    expect(texts(status)).toContain('sidebar.apiChange.unavailable.resourcePending');
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

  function tagItems(tree: Element): Array<{ key: string; label: unknown; children?: unknown[] }> {
    const found: Array<{ key: string; label: unknown; children?: unknown[] }> = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const item = value as { key?: string; className?: string; label: unknown };
      if (item.className === 'knife4j-sidebar-api-tag' && item.key) found.push(item as (typeof found)[number]);
      Object.values(value).forEach(visit);
    };
    visit(tree);
    return found;
  }

  function visibleTexts(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(visibleTexts);
    if (value && typeof value === 'object' && 'props' in value) return visibleTexts((value as Element).props.children);
    return [];
  }

  it('shows an ordinary OAS 3.2 tag name only once', () => {
    loadTags([{ name: '1.扩展项目API', description: 'ExtProjectAPI' }]);
    const item = tagItems(renderSidebar())[0];
    expect(visibleTexts(item.label)).toEqual(['1.扩展项目API']);
    const markdown: Element[] = [];
    walk(item.label, (element) => {
      if (element.type === 'Markdown') markdown.push(element);
    });
    expect(markdown[0].props.source).toBe('ExtProjectAPI');
  });

  it('uses summary for display and retains the exact name in a tooltip', () => {
    loadTags([{ name: 'internal-name', summary: '展示标题' }]);
    const item = tagItems(renderSidebar())[0];
    expect(item.key).toBe('tag-internal-name');
    expect(visibleTexts(item.label)).toEqual(['展示标题']);
    const hints: unknown[] = [];
    walk(item.label, (element) => {
      if (element.type === 'Tooltip') hints.push(element.props.title);
    });
    expect(hints.flatMap(texts)).toContain('name: "internal-name"');
  });

  it('disambiguates equal displayed labels, including summary/name collisions', () => {
    loadTags([{ name: 'first', summary: '共享标题' }, { name: '共享标题' }, { name: 'third', summary: '共享标题' }]);
    const items = tagItems(renderSidebar());
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(visibleTexts(item.label)).toEqual(['共享标题', `name: ${JSON.stringify(item.key.slice(4))}`]);
    }
  });

  it('keeps nesting and metadata without a permanent field list', () => {
    loadTags([{ name: 'parent' }, { name: 'child', parent: 'parent', kind: 'audience' }]);
    const items = tagItems(renderSidebar());
    const parent = items.find((item) => item.key === 'tag-parent')!;
    const child = items.find((item) => item.key === 'tag-child')!;
    expect(parent.children).toContain(child);
    expect(visibleTexts(child.label)).toEqual(['child']);
    const hints: unknown[] = [];
    walk(child.label, (element) => {
      if (element.type === 'Tooltip') hints.push(element.props.title);
    });
    expect(hints.flatMap(texts)).toEqual(
      expect.arrayContaining(['name: "child"', 'kind: audience', 'parent: "parent"']),
    );
  });

  it('preserves the OAS 3.1 tag presentation', () => {
    loadTags([{ name: 'Existing tag', description: 'Existing description' }], '3.1.0');
    expect(visibleTexts(tagItems(renderSidebar())[0].label)).toEqual(['Existing tag']);
  });
});
