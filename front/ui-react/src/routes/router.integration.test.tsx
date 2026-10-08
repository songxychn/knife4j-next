import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Use the production route tree with lightweight pages so this suite exercises
// browser history and parameter decoding without API or UI fixtures. Node-based
// tests use the core RouterProvider; the browser entry uses react-router/dom.
const { pageModule } = vi.hoisted(() => ({
  pageModule: async () => {
    const { useParams } = await import('react-router');
    const { createElement } = await import('react');
    return {
      default: function RouteProbe() {
        return createElement('output', null, JSON.stringify(useParams()));
      },
    };
  },
}));
vi.mock('../App.tsx', async () => ({ default: (await import('react-router')).Outlet }));
vi.mock('../pages/Home.tsx', pageModule);
vi.mock('../pages/Schema.tsx', pageModule);
vi.mock('../pages/Authorize.tsx', pageModule);
vi.mock('../pages/document/CookieSession.tsx', pageModule);
vi.mock('../pages/document/GlobalParam.tsx', pageModule);
vi.mock('../pages/document/OfficeDoc.tsx', pageModule);
vi.mock('../pages/document/Settings.tsx', pageModule);
vi.mock('../pages/document/MarkdownDocument.tsx', pageModule);
vi.mock('../pages/api/ApiHome.tsx', pageModule);
vi.mock('../pages/api/ApiDoc.tsx', pageModule);
vi.mock('../pages/api/ApiDebug.tsx', pageModule);
vi.mock('../pages/api/OpenApiView.tsx', pageModule);
vi.mock('../pages/api/ScriptView.tsx', pageModule);
import applicationRouter from './router';

applicationRouter.dispose();
let container: HTMLDivElement;
let root: Root;
let router: ReturnType<typeof createHashRouter>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  router.dispose();
  container.remove();
  window.history.replaceState(null, '', '/');
});

async function mount(pathname: string) {
  window.history.replaceState(null, '', `/doc.html#${pathname}`);
  router = createHashRouter(applicationRouter.routes);
  await act(async () => root.render(<RouterProvider router={router} />));
}
function params() {
  return JSON.parse(container.querySelector('output')!.textContent!);
}
async function traverse(delta: number) {
  await act(async () => {
    const completed = new Promise<void>((resolve) => {
      const unsubscribe = router.subscribe((state) => {
        if (state.historyAction === 'POP' && state.navigation.state === 'idle') {
          unsubscribe();
          resolve();
        }
      });
    });
    await router.navigate(delta);
    await completed;
  });
}

describe('production Hash route compatibility', () => {
  test.each([
    ['/default/events/webhook%3ApetChanged/doc', 'default', 'events', 'webhook:petChanged'],
    ['/default/upload/%2Fattachments/debug', 'default', 'upload', '/attachments'],
    ['/default/diagnostics/trace%3A%2Fdiagnostics/doc', 'default', 'diagnostics', 'trace:/diagnostics'],
    ['/%E8%AE%A2%E5%8D%95/%E7%94%A8%E6%88%B7/list/doc', '订单', '用户', 'list'],
    ['/default/literal%2541/percent%2541/doc', 'default', 'literal%41', 'percent%41'],
    ['/default/slash%2Ftag/id%25value/script', 'default', 'slash/tag', 'id%value'],
    ['/default/oas32%3A253246/oas32%3A252F/doc', 'default', 'oas32:253246', 'oas32:252F'],
  ])('opens the existing bookmark %s and preserves decoded params', async (pathname, group, tag, operaterId) => {
    await mount(pathname);
    expect(params()).toEqual({ group, tag, operaterId });
    expect(window.location.pathname).toBe('/doc.html');
    expect(window.location.hash).toBe(`#${pathname}`);
  });

  test.each(['home', 'schema', 'authorize', 'globalParam', 'cookieSession', 'Officdoc', 'Settings'])(
    'preserves the document tool URL /:group/%s',
    async (tool) => {
      await mount(`/orders/${tool}`);
      expect(params()).toEqual({ group: 'orders' });
      expect(router.state.errors).toBeNull();
    },
  );

  test('restores a schema or markdown deep link on fresh router initialization', async () => {
    await mount('/orders/schema/%E5%AE%A0%E7%89%A9%2541');
    expect(params()).toEqual({ group: 'orders', schemaName: '宠物%41' });
    await act(async () => router.navigate('/orders/markdown/2/3'));
    expect(params()).toEqual({ group: 'orders', groupIndex: '2', itemIndex: '3' });
    router.dispose();
    router = createHashRouter(applicationRouter.routes);
    await act(async () => root.render(<RouterProvider router={router} />));
    expect(params()).toEqual({ group: 'orders', groupIndex: '2', itemIndex: '3' });
    expect(window.location.hash).toBe('#/orders/markdown/2/3');
  });

  test('keeps group/tab navigation, replace and browser back/forward on Hash URLs', async () => {
    await mount('/orders/Pet/list/doc');
    await act(async () => router.navigate('/orders/Pet/list/debug'));
    await act(async () => router.navigate('/users/home'));
    expect(params()).toEqual({ group: 'users' });
    await traverse(-1);
    expect(window.location.hash).toBe('#/orders/Pet/list/debug');
    expect(params()).toEqual({ group: 'orders', tag: 'Pet', operaterId: 'list' });
    await traverse(1);
    expect(window.location.hash).toBe('#/users/home');
    await act(async () => router.navigate('/users/Settings', { replace: true }));
    await traverse(-1);
    expect(window.location.hash).toBe('#/orders/Pet/list/debug');
    await traverse(1);
    expect(window.location.hash).toBe('#/users/Settings');
    expect(window.location.pathname).toBe('/doc.html');
  });
});
