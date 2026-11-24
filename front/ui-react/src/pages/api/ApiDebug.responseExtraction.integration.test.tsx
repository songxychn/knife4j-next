import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { i18n as I18n } from 'i18next';
import { GlobalParamProvider } from '../../context/GlobalParamContext';
import { DEFAULT_SETTINGS, type AppSettings } from '../../types/settings';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import ApiDebug from './ApiDebug';
import { clearDebugSessionStatesForTest } from './debugSessionState';
import { writeResponseExtractionRules, type ResponseExtractionStorage } from './responseExtractionStorage';
import { MASKED_VALUE_PREVIEW, type ResponseExtractionRule } from './responseExtraction';

vi.setConfig({ testTimeout: 30_000 });

const state = vi.hoisted(() => ({
  document: null as SwaggerDoc | null,
  operation: undefined as MenuOperation | undefined,
  settings: null as AppSettings | null,
  engine: { status: 'inactive', retrievalUri: null, session: null, error: null },
  resources: { status: 'inactive', snapshot: null, documentScope: null, registrationError: null },
  auth: { schemes: {}, ready: true },
}));

vi.mock('./useCurrentOperation', () => ({
  useCurrentOperation: () => ({ loading: false, swaggerDoc: state.document, operation: state.operation }),
  OperationModeLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../context/GroupContext', () => ({
  useGroup: () => ({
    activeSwaggerGroup: { name: 'default', url: '/v3/api-docs/default' },
    operationRetrievalUri: 'https://example.test/v3/api-docs/default',
    routeGroupReady: true,
  }),
}));
vi.mock('../../context/SettingsContext', () => ({
  useSettings: () => ({ settings: state.settings ?? DEFAULT_SETTINGS }),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('../../context/SchemaEngineContext', () => ({
  useSchemaEngine: () => state.engine,
  useExternalResources: () => state.resources,
}));

const LOGIN_DOC: SwaggerDoc = {
  openapi: '3.0.3',
  info: { title: 'Auth Demo', version: '1.0.0' },
  servers: [{ url: 'https://example.test' }],
  paths: {
    '/api/auth/login': {
      post: {
        summary: 'Login',
        operationId: 'login',
        responses: {
          '200': { description: 'OK' },
        },
      },
    },
  },
};

const LOGIN_OPERATION: MenuOperation = {
  key: 'POST:/api/auth/login',
  method: 'post',
  path: '/api/auth/login',
  summary: 'Login',
  source: 'path',
  operation: LOGIN_DOC.paths['/api/auth/login'].post!,
};

const OPERATION_CACHE_KEY = 'default|Auth|login|post|/api/auth/login';

let i18n: I18n;
let root: Root;
let container: HTMLDivElement;

beforeAll(async () => {
  i18n = (await import('../../i18n')).default;
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      const initialized = () => {
        i18n.off('initialized', initialized);
        resolve();
      };
      i18n.on('initialized', initialized);
    });
  }
  await i18n.changeLanguage('zh-CN');
});

beforeEach(() => {
  localStorage.clear();
  clearDebugSessionStatesForTest();
  state.document = LOGIN_DOC;
  state.operation = LOGIN_OPERATION;
  state.settings = { ...DEFAULT_SETTINGS, enableAfterScript: true };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false,
    media,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  clearDebugSessionStatesForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function renderDebug() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/default/Auth/login/debug']}>
        <GlobalParamProvider groupId="default">
          <Routes>
            <Route path="/:group/:tag/:operaterId/debug" element={<ApiDebug />} />
          </Routes>
        </GlobalParamProvider>
      </MemoryRouter>,
    );
  });
}

function findButtonByText(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((el) => el.textContent?.includes(text));
  if (!button) {
    throw new Error(`Button containing "${text}" not found`);
  }
  return button;
}

function findTabByText(text: string): HTMLElement {
  const tab = Array.from(container.querySelectorAll('[role="tab"]')).find((el) => el.textContent?.includes(text));
  if (!tab) {
    throw new Error(`Tab containing "${text}" not found`);
  }
  return tab as HTMLElement;
}

function seedRules(rules: ResponseExtractionRule[]) {
  writeResponseExtractionRules(OPERATION_CACHE_KEY, rules, localStorage as unknown as ResponseExtractionStorage);
}

describe('ApiDebug post-response variable extraction', () => {
  test('extracts JSON body and header values on 2xx response, masks secrets in log, and injects into next request', async () => {
    seedRules([
      {
        id: 'rule-token',
        enabled: true,
        source: 'json-body',
        expression: '$.data.token',
        prefix: 'Bearer ',
        targetScope: 'group',
        targetIn: 'header',
        targetName: 'Authorization',
        masked: true,
      },
      {
        id: 'rule-refresh',
        enabled: true,
        source: 'header',
        expression: 'X-Refresh-Token',
        prefix: '',
        targetScope: 'application',
        targetIn: 'header',
        targetName: 'X-Refresh-Token',
        masked: true,
      },
    ]);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, data: { token: 'secret-token-1' } }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Refresh-Token': 'refresh-secret-1',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 200, data: { token: 'secret-token-2' } }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Refresh-Token': 'refresh-secret-2',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await renderDebug();

    // First send triggers automatic extraction.
    await act(async () => {
      findButtonByText('发送').click();
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain('已更新 2 项请求参数');
    });

    // Switch to the extraction tab and verify redacted previews in the execution log.
    await act(async () => {
      findTabByText('响应提取').click();
    });
    expect(container.textContent).toContain(MASKED_VALUE_PREVIEW);
    expect(container.textContent).toContain('Authorization');
    expect(container.textContent).toContain('X-Refresh-Token');

    // Second send automatically includes the extracted Authorization and X-Refresh-Token headers.
    await act(async () => {
      findButtonByText('发送').click();
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const secondCallInit = fetchMock.mock.calls[1][1] as RequestInit;
    const secondHeaders = secondCallInit.headers as Record<string, string>;
    expect(secondHeaders.Authorization).toBe('Bearer secret-token-1');
    expect(secondHeaders['X-Refresh-Token']).toBe('refresh-secret-1');
  });

  test('live preview in modal matches current response without mutating until save-and-apply', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { token: 'dry-run-tok' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await renderDebug();

    // Send first without any extraction rules.
    await act(async () => {
      findButtonByText('发送').click();
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // Open extraction tab and click the Bearer Token quick template.
    await act(async () => {
      findTabByText('响应提取').click();
    });
    await act(async () => {
      findButtonByText('快速添加：Bearer Token').click();
    });

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('当前响应实时预览：已命中');
      expect(document.body.textContent).toContain(MASKED_VALUE_PREVIEW);
    });

    // Live preview must not mutate global parameters before saving.
    expect(localStorage.getItem('knife4j:global-params:default')).toBeNull();

    const saveAndApplyBtn = Array.from(document.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('保存并应用到当前响应'),
    );
    expect(saveAndApplyBtn).toBeDefined();
    await act(async () => {
      saveAndApplyBtn!.click();
    });

    const savedGroup = JSON.parse(localStorage.getItem('knife4j:global-params:default') ?? '{}') as {
      params?: Array<{ name: string; value: string; masked: boolean }>;
    };
    expect(savedGroup.params).toHaveLength(1);
    expect(savedGroup.params?.[0]).toMatchObject({
      name: 'Authorization',
      value: 'Bearer dry-run-tok',
      masked: true,
    });
  });

  test('does not overwrite existing global parameters on non-2xx or failed extraction and preserves response', async () => {
    localStorage.setItem(
      'knife4j:global-params:default',
      JSON.stringify({
        params: [
          {
            id: 'existing-auth',
            name: 'Authorization',
            value: 'Bearer keep-me',
            in: 'header',
            enabled: true,
            masked: true,
            valueSource: 'manual',
          },
        ],
        cookieSession: { credentials: 'same-origin' },
      }),
    );
    seedRules([
      {
        id: 'rule-token',
        enabled: true,
        source: 'json-body',
        expression: '$.data.token',
        prefix: 'Bearer ',
        targetScope: 'group',
        targetIn: 'header',
        targetName: 'Authorization',
        masked: true,
      },
    ]);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 500, data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await renderDebug();

    // Non-2xx skips extraction and keeps old value intact.
    await act(async () => {
      findButtonByText('发送').click();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain('HTTP 401 非 2xx 响应不执行提取');
    });

    // 200 with missing token fails rule without overwriting existing value.
    await act(async () => {
      findButtonByText('发送').click();
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain('更新 0 项，失败 1 项');
    });

    const savedGroup = JSON.parse(localStorage.getItem('knife4j:global-params:default') ?? '{}') as {
      params?: Array<{ name: string; value: string }>;
    };
    expect(savedGroup.params?.[0].value).toBe('Bearer keep-me');
  });

  test('hides extraction tab and skips execution when enableAfterScript is false', async () => {
    state.settings = { ...DEFAULT_SETTINGS, enableAfterScript: false };
    seedRules([
      {
        id: 'rule-token',
        enabled: true,
        source: 'json-body',
        expression: '$.data.token',
        prefix: 'Bearer ',
        targetScope: 'group',
        targetIn: 'header',
        targetName: 'Authorization',
        masked: true,
      },
    ]);

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { token: 'ignored-tok' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await renderDebug();

    const tabLabels = Array.from(container.querySelectorAll('[role="tab"]')).map((el) => el.textContent ?? '');
    expect(tabLabels.some((label) => label.includes('响应提取'))).toBe(false);

    await act(async () => {
      findButtonByText('发送').click();
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    expect(localStorage.getItem('knife4j:global-params:default')).toBeNull();
  });
});
