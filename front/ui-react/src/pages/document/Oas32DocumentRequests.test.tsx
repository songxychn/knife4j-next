import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { GlobalParamItem } from '../../context/GlobalParamContext';
import type { SwaggerDoc } from '../../types/swagger';

const state = vi.hoisted(() => ({
  group: {} as Record<string, unknown>,
  settings: { enableHost: false, enableHostText: '' },
  cookieSession: {
    credentials: 'include',
    login: { method: 'POST', url: '/session', headers: '{}', body: 'synthetic' },
    logout: { method: 'POST', url: '/logout', headers: '{}', body: '' },
  },
  params: [] as unknown[],
  updateParam: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  memoIndex: 0,
  memos: [] as Array<{ deps: unknown[]; value: unknown }>,
  jsx: (type: unknown, props: Record<string, unknown> | null) => ({ type, props: props ?? {} }),
}));

vi.mock('react', () => ({
  useEffect: () => undefined,
  useState: <T,>(initial: T) => [initial, vi.fn()],
  useMemo: <T,>(factory: () => T, deps: unknown[]) => {
    const index = state.memoIndex++;
    const previous = state.memos[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      state.memos[index] = { deps, value: factory() };
    }
    return state.memos[index].value;
  },
}));
vi.mock('react/jsx-runtime', () => ({ jsx: state.jsx, jsxs: state.jsx, jsxDEV: state.jsx, Fragment: 'Fragment' }));
vi.mock('react/jsx-dev-runtime', () => ({ jsxDEV: state.jsx, Fragment: 'Fragment' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('antd', () => ({
  Alert: 'Alert',
  Button: 'Button',
  Card: 'Card',
  Collapse: 'Collapse',
  Modal: 'Modal',
  Popconfirm: 'Popconfirm',
  Select: 'Select',
  Spin: 'Spin',
  Switch: 'Switch',
  Table: 'Table',
  Tabs: 'Tabs',
  Tag: 'Tag',
  Typography: { Text: 'Text' },
  Space: { Compact: 'Compact' },
  Input: { Password: 'Password', TextArea: 'TextArea' },
  Form: {
    Item: 'FormItem',
    useWatch: () => undefined,
    useForm: () => [
      {
        validateFields: vi.fn().mockResolvedValue({}),
        getFieldsValue: () => state.cookieSession,
        setFieldsValue: vi.fn(),
      },
    ],
  },
  message: { success: state.success, error: state.error },
}));
vi.mock('@ant-design/icons', () => ({
  DeleteOutlined: 'DeleteOutlined',
  EditOutlined: 'EditOutlined',
  KeyOutlined: 'KeyOutlined',
  PlusOutlined: 'PlusOutlined',
  ReloadOutlined: 'ReloadOutlined',
  SendOutlined: 'SendOutlined',
}));
vi.mock('../../components/RevealableValue', () => ({ default: 'RevealableValue' }));
vi.mock('../../context/GroupContext', () => ({ useGroup: () => state.group }));
vi.mock('../../context/SettingsContext', () => ({ useSettings: () => ({ settings: state.settings }) }));
vi.mock('../../context/GlobalParamContext', () => ({
  useGlobalParam: () => ({
    groupId: 'fixture',
    cookieSession: state.cookieSession,
    setCookieSession: vi.fn(),
    applicationParams: [],
    groupParams: state.params,
    updateParam: state.updateParam,
    addParam: vi.fn(),
    removeParam: vi.fn(),
    clearParams: vi.fn(),
  }),
}));

import CookieSession from './CookieSession';
import GlobalParam from './GlobalParam';

interface Element {
  type: unknown;
  props: Record<string, unknown>;
}

function find(value: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if ('type' in value && 'props' in value && predicate(value as Element)) return value as Element;
  return Object.values(value)
    .map((child) => find(child, predicate))
    .find(Boolean);
}

function render(component: () => unknown): unknown {
  state.memoIndex = 0;
  const element = component() as Element;
  return (element.type as (props: Record<string, unknown>) => unknown)(element.props);
}

const param: GlobalParamItem = {
  id: 'dynamic',
  name: 'Authorization',
  in: 'header',
  enabled: true,
  masked: false,
  value: '',
  valueSource: 'request',
  request: { method: 'POST', url: '/token', headers: '{}', body: 'synthetic', jsonPath: '$.token', prefix: 'Bearer ' },
};
const fetcher = vi.fn<typeof fetch>();
const consumers = [
  { name: 'CookieSession login', component: CookieSession, suffix: 'session', action: 'login' },
  { name: 'CookieSession logout', component: CookieSession, suffix: 'logout', action: 'logout' },
  { name: 'GlobalParam fetch', component: GlobalParam, suffix: 'token', action: 'fetch' },
];

async function send(consumer: (typeof consumers)[number], expectedBase: string): Promise<void> {
  const tree = render(consumer.component);
  let actionTree = tree;
  if (consumer.action === 'fetch') {
    const table = find(tree, (element) => element.type === 'Table')!;
    const columns = table.props.columns as Array<{
      key: string;
      render?: (value: unknown, row: GlobalParamItem) => unknown;
    }>;
    actionTree = columns.find((column) => column.key === 'action')!.render!(undefined, param);
  }
  const button = find(
    actionTree,
    (element) =>
      element.type === 'Button' &&
      (consumer.action === 'fetch'
        ? element.props.title === 'globalParam.btn.fetch'
        : element.props.children === `globalParam.cookie.${consumer.action}`),
  )!;
  expect(button).toBeDefined();
  const completed = state.success.mock.calls.length + state.error.mock.calls.length;
  (button.props.onClick as () => void)();
  await vi.waitFor(() => expect(state.success.mock.calls.length + state.error.mock.calls.length).toBe(completed + 1));
  expect(state.error.mock.calls).toEqual([]);
  expect(fetcher).toHaveBeenLastCalledWith(
    `${expectedBase}/${consumer.suffix}`,
    expect.objectContaining({ method: 'POST', credentials: 'include' }),
  );
  if (consumer.action === 'fetch')
    expect(state.updateParam).toHaveBeenLastCalledWith('group', 'dynamic', { value: 'Bearer synthetic-token' });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.memos = [];
  state.settings = { enableHost: false, enableHostText: '' };
  state.params = [param];
  state.group = {
    activeGroup: { value: 'fixture', label: 'Fixture' },
    activeSwaggerGroup: {},
    operationRetrievalUri: 'http://retrieved.test/specs/root.json',
    loading: false,
    routeGroupReady: true,
  };
  vi.stubGlobal('window', { location: { origin: 'https://ui.test' } });
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ token: 'synthetic-token' }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

for (const consumer of consumers)
  describe(consumer.name, () => {
    test.each([
      {
        name: 'relative root Server',
        version: '3.2.99',
        servers: [{ url: './api' }],
        expected: 'http://retrieved.test/specs/api',
      },
      { name: 'default root Server', version: '3.2.0', expected: 'http://retrieved.test' },
      {
        name: 'host override',
        version: '3.2.0',
        host: 'https://override.test/custom',
        expected: 'https://override.test/custom',
      },
      { name: 'gateway override', version: '3.2.0', contextPath: '/gateway', expected: 'https://ui.test/gateway' },
      { name: 'OAS 3.0 behavior', version: '3.0.3', servers: [{ url: '/legacy' }], expected: 'https://ui.test/legacy' },
      { name: 'OAS 3.1 behavior', version: '3.1.2', servers: [{ url: '/legacy' }], expected: 'https://ui.test/legacy' },
    ])('sends using $name', async ({ version, servers, expected, host, contextPath }) => {
      state.group.swaggerDoc = {
        openapi: version,
        $self: 'https://logical.invalid/root',
        info: { title: 'Fixture', version: '1' },
        paths: {},
        servers,
      } as SwaggerDoc;
      state.group.activeSwaggerGroup = { contextPath };
      if (host) state.settings = { enableHost: true, enableHostText: host };
      await send(consumer, expected);
    });

    test('updates the request when only the physical retrieval URI changes', async () => {
      state.group.swaggerDoc = {
        openapi: '3.2.0',
        info: { title: 'Fixture', version: '1' },
        paths: {},
        servers: [{ url: './api' }],
      };
      await send(consumer, 'http://retrieved.test/specs/api');
      state.group.operationRetrievalUri = 'http://retrieved.test/another/root.json';
      await send(consumer, 'http://retrieved.test/another/api');
    });
  });
