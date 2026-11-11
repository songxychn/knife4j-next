import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from './i18n';

const state = vi.hoisted(() => ({
  group: {
    groups: [{ value: 'audit', label: 'Audit' }],
    activeGroup: { value: 'audit', label: 'Audit', apis: [] },
    markdownDocs: [],
    documentDiagnostics: [],
    setActiveGroupValue: () => {},
    swaggerDoc: { openapi: '3.0.3', info: { title: 'Audit', version: '1' } },
  },
  settings: {
    language: 'zh-CN',
    enableGroup: true,
    enableSwaggerModels: true,
    enableDebug: true,
    enableOpenApi: true,
    enableFooter: false,
  },
}));
vi.mock('./context/GroupContext', () => ({
  GroupProvider: ({ children }: { children: React.ReactNode }) => children,
  useGroup: () => state.group,
}));
vi.mock('./context/SettingsContext', () => ({
  SettingsProvider: ({ children }: { children: React.ReactNode }) => children,
  useSettings: () => ({
    settings: state.settings,
    setSetting: () => {},
    storageResetSnapshot: { generation: 'initial', active: false },
  }),
}));
vi.mock('./context/AuthContext', () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./context/GlobalParamContext', () => ({
  GlobalParamProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./context/ApiChangeContext', () => ({
  ApiChangeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./context/SchemaEngineContext', () => ({
  SchemaEngineProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./components/schema/ExternalResourcePanel', () => ({ default: () => null }));
vi.mock('./compoents/SettingsDrawer', () => ({ default: () => null }));
vi.mock('./compoents/SidebarSearchMenu', () => ({
  default: ({ onMenuClick }: { onMenuClick: (info: { key: string }) => void }) => (
    <button onClick={() => onMenuClick({ key: '/audit/schema' })}>Open models</button>
  ),
}));
import App from './App';

let root: Root;
let container: HTMLDivElement;
let width = 390;
const queries = new Set<{ query: string; listener: () => void }>();
function matches(query: string) {
  const max = /max-width:\s*(\d+)px/.exec(query);
  const min = /min-width:\s*(\d+)px/.exec(query);
  return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]));
}
async function mount() {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/audit/home']}>
        <Routes>
          <Route path="/" element={<App />}>
            <Route path="*" element={<p>Document workspace</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    ),
  );
}
async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
}
beforeEach(async () => {
  width = 390;
  queries.clear();
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => computedStyle(element));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches(query);
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: () => void) => queries.add({ query, listener }),
    removeEventListener: (_: string, listener: () => void) => {
      for (const item of queries) if (item.listener === listener) queries.delete(item);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  }));
  sessionStorage.clear();
  localStorage.clear();
  await i18n.changeLanguage('zh-CN');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('keeps compact navigation outside the workspace and closes it after navigation', async () => {
  await mount();
  expect(container.querySelector('aside')).toBeNull();
  expect(document.querySelector('.ant-drawer-open')).toBeNull();
  await click('展开导航');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(container.querySelector('.knife4j-app-layout')?.hasAttribute('inert')).toBe(true);
  expect(document.querySelector('[role="dialog"]')?.closest('[inert]')).toBeNull();
  expect(document.querySelectorAll('#knife4j-navigation')).toHaveLength(1);
  const link = [...document.querySelectorAll('button')].find((button) => button.textContent === 'Open models')!;
  await act(async () => link.click());
  expect(document.querySelector('.ant-drawer-open')).toBeNull();
  expect(container.querySelector('.knife4j-app-layout')?.hasAttribute('inert')).toBe(false);
});
it('preserves desktop width, exposes keyboard resizing and hides the handle when collapsed', async () => {
  width = 1280;
  await mount();
  const handle = container.querySelector<HTMLElement>('.react-resizable-handle')!;
  expect(handle.getAttribute('aria-valuenow')).toBe('320');
  await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(handle.getAttribute('aria-valuenow')).toBe('330');
  await click('收起导航');
  expect(handle.hidden).toBe(true);
  expect(handle.tabIndex).toBe(-1);
  await click('展开导航');
  expect(handle.getAttribute('aria-valuenow')).toBe('330');
});
it('switches responsive mode without leaving a modal or duplicate navigation behind', async () => {
  await mount();
  await click('展开导航');
  await act(async () => {
    width = 1280;
    for (const item of [...queries]) item.listener();
  });
  expect(container.querySelector('aside')).not.toBeNull();
  expect(document.querySelector('.ant-drawer-open')).toBeNull();
  expect(document.querySelectorAll('#knife4j-navigation')).toHaveLength(1);
});
