import { act, createRef, StrictMode, useState, type ComponentRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AccessibleTabs from './AccessibleTabs';

let container: HTMLDivElement;
let root: Root;
let slotLeft = 160;
const observers = new Set<(entries: unknown[]) => void>();
beforeEach(() => {
  slotLeft = 160;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private elements = new Set<Element>();
      constructor(private callback: (entries: unknown[]) => void) {}
      observe(element: Element) {
        this.elements.add(element);
        observers.add(this.callback);
      }
      unobserve(element: Element) {
        this.elements.delete(element);
        if (!this.elements.size) observers.delete(this.callback);
      }
      disconnect() {
        this.elements.clear();
        observers.delete(this.callback);
      }
    },
  );
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false,
    media,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.tagName === 'BUTTON' && this.getAttribute('aria-hidden') === 'true'
      ? new DOMRect(slotLeft, 8, 16, 16)
      : new DOMRect(0, 0, 200, 40);
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  observers.clear();
});
function Harness({ label = 'Workspace', rtl = false }: { label?: string; rtl?: boolean }) {
  const [keys, setKeys] = useState(['home', 'api']);
  const [active, setActive] = useState('api');
  return (
    <ConfigProvider direction={rtl ? 'rtl' : 'ltr'}>
      <AccessibleTabs
        id="workspace"
        tabListLabel={label}
        type="editable-card"
        hideAdd
        activeKey={active}
        onChange={setActive}
        onEdit={(key, action) => {
          if (action === 'remove') {
            setKeys((keys) => keys.filter((item) => item !== key));
            setActive('home');
          }
        }}
        items={keys.map((key) => ({ key, label: key, closable: key !== 'home', children: <p>{key} content</p> }))}
      />
    </ConfigProvider>
  );
}
async function key(element: HTMLElement, value: string) {
  await act(async () => {
    element.focus();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: value, code: value, bubbles: true, cancelable: true }));
  });
}
function tab(name: string) {
  return document.getElementById(`workspace-tab-${name}`)!;
}

it('groups real tabs separately from close and overflow buttons without aria-owns', async () => {
  await act(async () => root.render(<Harness />));
  const group = container.querySelector('[role=tablist]')!;
  expect(group.getAttribute('aria-label')).toBe('Workspace');
  expect(group.querySelectorAll('[role=tab]')).toHaveLength(2);
  expect(group.querySelector('button:not([aria-hidden=true])')).toBeNull();
  expect(group.querySelector<HTMLButtonElement>('button[aria-hidden=true]')?.disabled).toBe(true);
  expect(group.querySelector<HTMLButtonElement>('button[aria-hidden=true]')?.tabIndex).toBe(-1);
  expect(container.querySelector('[aria-owns]')).toBeNull();
  const close = container.querySelector<HTMLButtonElement>('.knife4j-tab-controls button.ant-tabs-tab-remove')!;
  expect(close.closest('[role=tablist]')).toBeNull();
  expect(container.querySelector('.ant-tabs-nav-more')?.closest('[role=tablist]')).toBeNull();
  expect(tab('api').getAttribute('aria-controls')).toBe('workspace-panel-api');
  expect(container.querySelector('#workspace-panel-api')?.getAttribute('aria-labelledby')).toBe('workspace-tab-api');
  await act(async () => close.click());
  expect(tab('api')).toBeNull();
  expect(tab('home').getAttribute('aria-selected')).toBe('true');
});
it('retains tab refs and manual arrow/Enter activation plus Delete closing', async () => {
  await act(async () => root.render(<Harness />));
  await key(tab('api'), 'ArrowLeft');
  expect(document.activeElement).toBe(tab('home'));
  expect(tab('api').getAttribute('aria-selected')).toBe('true');
  await key(tab('home'), 'Enter');
  expect(tab('home').getAttribute('aria-selected')).toBe('true');
  await key(tab('home'), 'ArrowRight');
  await key(tab('api'), 'Delete');
  expect(tab('api')).toBeNull();
});
it('tracks the close placeholder and hides the real button when the tab is clipped', async () => {
  await act(async () => root.render(<Harness rtl />));
  const control = container.querySelector<HTMLElement>('.knife4j-tab-close-control')!;
  expect(control.style.left).toBe('160px');
  await act(async () => {
    slotLeft = 220;
    observers.forEach((notify) => notify([]));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(control.style.display).toBe('none');
  await act(async () => {
    slotLeft = 140;
    observers.forEach((notify) => notify([]));
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  expect(control.style.display).not.toBe('none');
  expect(control.style.left).toBe('140px');
});
it('updates the group label and safely remounts/unmounts all portal controls in StrictMode', async () => {
  const ref = createRef<ComponentRef<typeof AccessibleTabs>>();
  await act(async () =>
    root.render(
      <StrictMode>
        <AccessibleTabs
          ref={ref}
          type="editable-card"
          hideAdd
          tabListLabel="Request"
          items={[{ key: 'one', label: 'One', children: 'Body' }]}
        />
      </StrictMode>,
    ),
  );
  expect(ref.current?.nativeElement).not.toBeNull();
  await act(async () =>
    root.render(
      <StrictMode>
        <AccessibleTabs
          type="editable-card"
          hideAdd
          tabListLabel="リクエスト"
          items={[{ key: 'one', label: 'One', children: 'Body' }]}
        />
      </StrictMode>,
    ),
  );
  expect(container.querySelectorAll('[role=tablist]')).toHaveLength(1);
  expect(container.querySelectorAll('.knife4j-tab-controls button')).toHaveLength(1);
  expect(container.querySelector('[role=tablist]')?.getAttribute('aria-label')).toBe('リクエスト');
  await act(async () => root.render(null));
  expect(container.querySelector('.knife4j-tab-controls')).toBeNull();
  expect(observers.size).toBe(0);
});
