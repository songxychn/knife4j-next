import { act, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ScopedGlobalParamItem } from '../../context/GlobalParamContext';
import { createReactTestRoot, stubLayoutApis } from '../../test/reactTestRoot';
import { DEFAULT_SETTINGS } from '../../types/settings';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import ApiDebug from './ApiDebug';

// Rendering full ApiDebug with Ant Design under parallel Linux CI load can exceed 5s.
vi.setConfig({ testTimeout: 60_000 });

const state = vi.hoisted(() => ({
  document: null as SwaggerDoc | null,
  operation: undefined as MenuOperation | undefined,
  engine: { status: 'inactive', retrievalUri: null, session: null, error: null },
  resources: { status: 'inactive', snapshot: null, documentScope: null, registrationError: null },
  globalParams: {
    effectiveParams: [] as ScopedGlobalParamItem[],
    cookieSession: { credentials: 'same-origin' as const },
  },
  auth: { schemes: {}, ready: true },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));
vi.mock('./useCurrentOperation', () => ({
  useCurrentOperation: () => ({ loading: false, swaggerDoc: state.document, operation: state.operation }),
  OperationModeLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../context/GroupContext', () => ({
  useGroup: () => ({
    activeSwaggerGroup: null,
    operationRetrievalUri: 'https://example.test/openapi.json',
    routeGroupReady: true,
  }),
}));
vi.mock('../../context/SettingsContext', () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS }) }));
vi.mock('../../context/GlobalParamContext', () => ({ useGlobalParam: () => state.globalParams }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('../../context/SchemaEngineContext', () => ({
  useSchemaEngine: () => state.engine,
  useExternalResources: () => state.resources,
}));

let view: ReturnType<typeof createReactTestRoot>;

function setOperation(operationDef: MenuOperation['operation'], path = '/ping', method = 'get') {
  const op: MenuOperation = {
    key: 'op-test',
    path,
    method,
    summary: operationDef.summary ?? 'Test Operation',
    operation: operationDef,
  };
  state.operation = op;
  state.document = {
    openapi: '3.0.3',
    info: { title: 'Demo', version: '1.0.0' },
    paths: { [path]: { [method]: operationDef } },
  };
}

async function selectTab(container: HTMLElement, tabKeyPrefix: string) {
  const tab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find((el) =>
    el.textContent?.includes(tabKeyPrefix),
  );
  expect(tab, `expected tab matching ${tabKeyPrefix}`).toBeDefined();
  await act(async () => tab!.click());
}

function activePanel(container: HTMLElement): HTMLElement {
  const activeTab = container.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  expect(activeTab).not.toBeNull();
  const panelId = activeTab!.getAttribute('aria-controls');
  expect(panelId).toBeTruthy();
  const panel = Array.from(container.querySelectorAll<HTMLElement>('[role="tabpanel"]')).find(
    (el) => el.id === panelId,
  );
  expect(panel).toBeDefined();
  return panel!;
}

beforeEach(() => {
  localStorage.clear();
  view = createReactTestRoot();
  stubLayoutApis();
  state.globalParams = {
    effectiveParams: [],
    cookieSession: { credentials: 'same-origin' },
  };
});

afterEach(async () => {
  await view.unmount();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ApiDebug parameter naming and empty-state presentation', () => {
  test('renders lightweight empty hints instead of stacked empty tables across Path, Query, Header, and Cookie tabs', async () => {
    setOperation({
      summary: 'Ping',
      responses: { 200: { description: 'OK' } },
    });

    await view.render(
      <MemoryRouter initialEntries={['/default/demo/op-test/debug']}>
        <ApiDebug />
      </MemoryRouter>,
    );

    // Path tab: no empty table, just lightweight hint
    await selectTab(view.container, 'apiDebug.tab.path');
    let panel = activePanel(view.container);
    expect(panel.querySelectorAll('table')).toHaveLength(0);
    expect(panel.textContent).toContain('apiDebug.noPathParams');

    // Query, Header, Cookie tabs: consistent empty hint + lightweight add button, zero empty tables
    for (const tabCase of [
      { tab: 'apiDebug.tab.query', hint: 'apiDebug.noQueryParams', add: 'apiDebug.customQuery.add' },
      { tab: 'apiDebug.tab.header', hint: 'apiDebug.noHeaderParams', add: 'apiDebug.customHeaders.add' },
      { tab: 'apiDebug.tab.cookie', hint: 'apiDebug.noCookieParams', add: 'apiDebug.customCookie.add' },
    ]) {
      await selectTab(view.container, tabCase.tab);
      panel = activePanel(view.container);
      expect(panel.querySelectorAll('table')).toHaveLength(0);
      expect(panel.textContent).toContain(tabCase.hint);
      const addButton = Array.from(panel.querySelectorAll('button')).find((b) => b.textContent?.includes(tabCase.add));
      expect(addButton, `expected add button ${tabCase.add}`).toBeDefined();
    }
  });

  test('expands custom parameter table on add and collapses back to lightweight button when cleared', async () => {
    setOperation({
      summary: 'Ping',
      responses: { 200: { description: 'OK' } },
    });

    await view.render(
      <MemoryRouter initialEntries={['/default/demo/op-test/debug']}>
        <ApiDebug />
      </MemoryRouter>,
    );

    for (const tabCase of [
      {
        tab: 'apiDebug.tab.query',
        hint: 'apiDebug.noQueryParams',
        add: 'apiDebug.customQuery.add',
        title: 'apiDebug.customQuery.title',
      },
      {
        tab: 'apiDebug.tab.header',
        hint: 'apiDebug.noHeaderParams',
        add: 'apiDebug.customHeaders.add',
        title: 'apiDebug.customHeaders.title',
      },
      {
        tab: 'apiDebug.tab.cookie',
        hint: 'apiDebug.noCookieParams',
        add: 'apiDebug.customCookie.add',
        title: 'apiDebug.customCookie.title',
      },
    ]) {
      await selectTab(view.container, tabCase.tab);
      let panel = activePanel(view.container);
      expect(panel.querySelectorAll('table')).toHaveLength(0);

      const addButton = Array.from(panel.querySelectorAll('button')).find((b) => b.textContent?.includes(tabCase.add))!;
      await act(async () => addButton.click());

      panel = activePanel(view.container);
      expect(panel.querySelectorAll('table')).toHaveLength(1);
      expect(panel.textContent).toContain(tabCase.title);
      expect(panel.textContent).not.toContain(tabCase.hint);

      const deleteButton = panel.querySelector<HTMLButtonElement>('button[aria-label="globalParam.btn.delete"]')!;
      expect(deleteButton).not.toBeNull();
      await act(async () => deleteButton.click());

      panel = activePanel(view.container);
      expect(panel.querySelectorAll('table')).toHaveLength(0);
      expect(panel.textContent).toContain(tabCase.hint);
      expect(panel.textContent).toContain(tabCase.add);
    }
  });

  test('renders inherited global parameters with updated section title and no empty doc/custom tables', async () => {
    state.globalParams = {
      effectiveParams: [
        {
          id: 'app-h1',
          name: 'X-Tenant-Id',
          value: 'acme',
          in: 'header',
          enabled: true,
          masked: false,
          valueSource: 'manual',
          scope: 'application',
        },
        {
          id: 'grp-q1',
          name: 'locale',
          value: 'zh-CN',
          in: 'query',
          enabled: true,
          masked: false,
          valueSource: 'manual',
          scope: 'group',
        },
      ],
      cookieSession: { credentials: 'same-origin' },
    };
    setOperation({
      summary: 'List',
      responses: { 200: { description: 'OK' } },
    });

    await view.render(
      <MemoryRouter initialEntries={['/default/demo/op-test/debug']}>
        <ApiDebug />
      </MemoryRouter>,
    );

    // Query tab: only inherited global params table + lightweight add button
    await selectTab(view.container, 'apiDebug.tab.query');
    let panel = activePanel(view.container);
    expect(panel.querySelectorAll('table')).toHaveLength(1);
    expect(panel.textContent).toContain('apiDebug.globalParams.title');
    expect(panel.textContent).toContain('apiDebug.globalParams.readOnly');
    expect(panel.textContent).toContain('locale');
    expect(panel.textContent).toContain('apiDebug.customQuery.add');
    expect(panel.textContent).not.toContain('apiDebug.noQueryParams');

    // Header tab: only inherited global params table + lightweight add button
    await selectTab(view.container, 'apiDebug.tab.header');
    panel = activePanel(view.container);
    expect(panel.querySelectorAll('table')).toHaveLength(1);
    expect(panel.textContent).toContain('apiDebug.globalParams.title');
    expect(panel.textContent).toContain('X-Tenant-Id');
    expect(panel.textContent).toContain('apiDebug.customHeaders.add');
    expect(panel.textContent).not.toContain('apiDebug.noHeaderParams');
  });

  test('shows Content-Type auto-inject hint in Header tab without an empty table when body exists', async () => {
    setOperation(
      {
        summary: 'Create',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: 'string' } } },
            },
          },
        },
        responses: { 200: { description: 'OK' } },
      },
      '/items',
      'post',
    );

    await view.render(
      <MemoryRouter initialEntries={['/default/demo/op-test/debug']}>
        <ApiDebug />
      </MemoryRouter>,
    );

    await selectTab(view.container, 'apiDebug.tab.header');
    const panel = activePanel(view.container);
    expect(panel.querySelectorAll('table')).toHaveLength(0);
    expect(panel.textContent).toContain('apiDebug.header.autoInject');
    expect(panel.textContent).toContain('apiDebug.customHeaders.add');
  });

  test('renders declared parameter table alongside lightweight add button without an empty custom table', async () => {
    setOperation({
      summary: 'Search',
      parameters: [{ name: 'keyword', in: 'query', schema: { type: 'string' } }],
      responses: { 200: { description: 'OK' } },
    });

    await view.render(
      <MemoryRouter initialEntries={['/default/demo/op-test/debug']}>
        <ApiDebug />
      </MemoryRouter>,
    );

    await selectTab(view.container, 'apiDebug.tab.query');
    const panel = activePanel(view.container);
    expect(panel.querySelectorAll('table')).toHaveLength(1);
    expect(panel.textContent).toContain('keyword');
    expect(panel.textContent).toContain('apiDebug.customQuery.add');
    expect(panel.textContent).not.toContain('apiDebug.noQueryParams');
  });

  test('renders lightweight cookie empty hint without table in OAS 3.1 browser-session mode', async () => {
    const opDef: MenuOperation['operation'] = {
      summary: 'Profile',
      responses: { 200: { description: 'OK' } },
    };
    state.operation = {
      key: 'op-oas31',
      path: '/profile',
      method: 'get',
      summary: 'Profile',
      operation: opDef,
    };
    state.document = {
      openapi: '3.1.0',
      info: { title: 'Demo', version: '1.0.0' },
      paths: { '/profile': { get: opDef } },
    };

    await view.render(
      <MemoryRouter initialEntries={['/default/demo/op-oas31/debug']}>
        <ApiDebug />
      </MemoryRouter>,
    );

    await selectTab(view.container, 'apiDebug.tab.cookie');
    const panel = activePanel(view.container);
    expect(panel.querySelectorAll('table')).toHaveLength(0);
    expect(panel.textContent).toContain('apiDebug.noCookieParams');
    expect(panel.textContent).not.toContain('apiDebug.customCookie.add');
  });
});
