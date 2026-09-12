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
