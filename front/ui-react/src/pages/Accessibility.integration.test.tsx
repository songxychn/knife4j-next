import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { i18n as I18n } from 'i18next';
import type { MenuOperation, SwaggerDoc } from '../types/swagger';
import { DEFAULT_SETTINGS } from '../types/settings';
import Home from './Home';
import ApiDebug from './api/ApiDebug';
import CodeEditor from '../components/CodeEditor';

const state = vi.hoisted(() => ({
  document: null as SwaggerDoc | null,
  operation: undefined as MenuOperation | undefined,
}));
vi.mock('./api/useCurrentOperation', () => ({
  useCurrentOperation: () => ({ loading: false, swaggerDoc: state.document, operation: state.operation }),
  OperationModeLayout: ({ children }: { children: import('react').ReactNode }) => children,
}));
vi.mock('../context/GroupContext', () => ({
  useGroup: () => ({
    activeSwaggerGroup: null,
    operationRetrievalUri: 'https://example.test/openapi.json',
    routeGroupReady: true,
    swaggerDoc: state.document,
    menuTags: [{ tag: 'Pets', operations: [state.operation] }],
    loading: false,
  }),
}));
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS }) }));
vi.mock('../context/GlobalParamContext', () => ({
  useGlobalParam: () => ({ effectiveParams: [], cookieSession: { credentials: 'same-origin' } }),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ schemes: {}, ready: true }) }));
vi.mock('../context/SchemaEngineContext', () => ({
  useSchemaEngine: () => ({ status: 'inactive', retrievalUri: null, session: null, error: null }),
  useExternalResources: () => ({ status: 'inactive', snapshot: null, documentScope: null, registrationError: null }),
}));

let i18n: I18n;
let root: Root;
let container: HTMLDivElement;

beforeAll(async () => {
  i18n = (await import('../i18n')).default;
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => i18n.on('initialized', () => resolve()));
  }
});
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() });
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
  const operation = {
    tags: ['Pets'],
    requestBody: { content: { 'application/json': { schema: { type: 'object' }, example: {} } } },
    responses: { '204': { description: 'Saved' } },
  };
  state.document = {
    openapi: '3.1.1',
    info: { title: 'Pet API', version: '1' },
    servers: [{ url: 'https://api.example.test' }],
    paths: { '/pets': { post: operation } },
  };
  state.operation = { key: 'pets', path: '/pets', method: 'post', summary: 'Save pets', source: 'path', operation };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function namedInput(role: string, key: string) {
  return container.querySelector(`[role="${role}"][aria-label="${i18n.t(key)}"]`);
}

describe.each(['zh-CN', 'en-US', 'ja-JP'] as const)('accessible home and request controls in %s', (language) => {
  test('exposes the document h1 and names every distribution progress bar', async () => {
    await act(async () => {
      await i18n.changeLanguage(language);
      root.render(<Home />);
    });
    expect.soft(container.querySelector('h1')?.textContent).toBe('Pet API');
    const bars = Array.from(container.querySelectorAll('[role="progressbar"]'));
    expect(bars).toHaveLength(2);
    expect
      .soft(bars.map((bar) => bar.getAttribute('aria-label')))
      .toEqual([`${i18n.t('home.methodDistribution')}: POST`, `${i18n.t('home.tagRanking')}: Pets`]);
  });

  test.each(['application/json', 'text/plain'])('names request controls and the %s body editor', async (mediaType) => {
    if (mediaType === 'text/plain') {
      const operation = {
        requestBody: { content: { 'text/plain': { schema: { type: 'string' }, example: 'hello' } } },
        responses: { '204': { description: 'Saved' } },
      };
      state.document!.paths = { '/pets': { post: operation } };
      state.operation = { ...state.operation!, operation };
    }
    await act(async () => {
      await i18n.changeLanguage(language);
      root.render(
        <MemoryRouter>
          <ApiDebug />
        </MemoryRouter>,
      );
    });
    expect(i18n.exists('apiDebug.requestMethod')).toBe(true);
    expect(i18n.exists('apiDebug.requestPath')).toBe(true);
    expect.soft(namedInput('combobox', 'apiDebug.requestMethod')).not.toBeNull();
    expect.soft(namedInput('combobox', 'oas32.server.request')).not.toBeNull();
    expect.soft(container.querySelector(`input[aria-label="${i18n.t('apiDebug.requestPath')}"]`)).not.toBeNull();
    const bodyTab = container.querySelector<HTMLButtonElement>('[role="tab"][id$="-tab-body"]');
    expect(bodyTab).not.toBeNull();
    await act(async () => bodyTab!.click());
    expect.soft(namedInput('combobox', 'apiDebug.body.contentType')).not.toBeNull();
    const body = container.querySelector(`[aria-label="${i18n.t('apiDoc.requestBody')}"]`);
    expect(body).not.toBeNull();
    expect(
      body?.matches(mediaType === 'application/json' ? '[contenteditable="true"][role="textbox"]' : 'textarea'),
    ).toBe(true);
  });
});

test('updates the CodeEditor accessible name without recreating its content element', async () => {
  await act(async () => root.render(<CodeEditor value="draft" onChange={() => {}} ariaLabel="Request body" />));
  const content = container.querySelector('[contenteditable="true"]');
  expect(content?.getAttribute('aria-label')).toBe('Request body');
  await act(async () => root.render(<CodeEditor value="draft" onChange={() => {}} ariaLabel="リクエストボディ" />));
  expect(container.querySelector('[contenteditable="true"]')).toBe(content);
  expect(content?.getAttribute('aria-label')).toBe('リクエストボディ');
  expect(content?.textContent).toBe('draft');
});
