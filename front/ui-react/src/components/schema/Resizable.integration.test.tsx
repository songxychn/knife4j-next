import React, { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Layout } from 'antd';
import { Resizable, type ResizeCallbackData } from 'react-resizable';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SchemaFieldTable from './SchemaFieldTable';
import i18n from '../../i18n';

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(async () => {
  // jsdom does not perform layout; browser verification covers actual geometry.
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
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  // jsdom has no pseudo-element layout; keep ordinary computed styles real.
  const computedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => computedStyle(element));
  await i18n.changeLanguage('zh-CN');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mouse(target: EventTarget, type: string, x: number) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0 }));
}

function drag(handle: Element, points: number[]) {
  act(() => mouse(handle, 'mousedown', 0));
  expect(document.body.classList.contains('react-draggable-transparent-selection')).toBe(false);
  for (const x of points) act(() => mouse(document, 'mousemove', x));
  act(() => mouse(document, 'mouseup', points.at(-1) ?? 0));
}

// Real React/Antd/Resizable with App's current sizing props and state flow.
// Full App navigation and collapse are also checked in the production browser.
function Sidebar({ report }: { report: (phase: string, data: ResizeCallbackData) => void }) {
  const [width, setWidth] = useState(320);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <button onClick={() => setCollapsed((value) => !value)}>toggle</button>
      <Resizable
        width={width}
        height={Infinity}
        handle={<div className="react-resizable-handle" />}
        resizeHandles={['e']}
        minConstraints={[260, Infinity]}
        maxConstraints={[520, Infinity]}
        draggableOpts={{ enableUserSelectHack: false }}
        onResize={(_event, data) => {
          setWidth(data.size.width);
          report('resize', data);
        }}
        onResizeStop={(_event, data) => report('stop', data)}
      >
        <Layout.Sider width={width} collapsed={collapsed} collapsedWidth={56} trigger={null} collapsible>
          sidebar
        </Layout.Sider>
      </Resizable>
    </>
  );
}

it('preserves sidebar bounds, boundary reversal, stop size and collapse/expand width', () => {
  const report = vi.fn();
  act(() => root?.render(<Sidebar report={report} />));
  const handle = container.querySelector('.react-resizable-handle')!;
  const sidebar = container.querySelector<HTMLElement>('.ant-layout-sider')!;
  drag(handle, [300]);
  expect(sidebar.style.width).toBe('520px');
  // The existing Infinity height constraints produce NaN in the unused height
  // after accumulated drag slack. App consumes width only; do not change this
  // legacy behavior as part of the dependency upgrade.
  expect(report.mock.calls.at(-1)).toMatchObject(['stop', { size: { width: 520, height: NaN }, handle: 'e' }]);
  drag(handle, [-400]);
  expect(sidebar.style.width).toBe('260px');
  drag(handle, [50, 80, 20]);
  expect(sidebar.style.width).toBe('280px');
  const toggle = container.querySelector('button')!;
  act(() => toggle.click());
  expect(sidebar.style.width).toBe('56px');
  act(() => toggle.click());
  expect(sidebar.style.width).toBe('280px');
  expect(document.body.classList.contains('react-draggable-transparent-selection')).toBe(false);
});

it('accumulates moves before React rerenders and reports the final size once stopped', () => {
  const report = vi.fn();
  act(() => root?.render(<Sidebar report={report} />));
  act(() => mouse(container.querySelector('.react-resizable-handle')!, 'mousedown', 0));
  act(() => {
    mouse(document, 'mousemove', 10);
    mouse(document, 'mousemove', 30);
    mouse(document, 'mousemove', 60);
    mouse(document, 'mousemove', 60);
    mouse(document, 'mouseup', 60);
  });
  expect(report.mock.calls.map(([phase, data]) => [phase, data.size.width])).toEqual([
    ['resize', 330],
    ['resize', 350],
    ['resize', 380],
    // The unused NaN height also means an equal-X move still invokes onResize.
    ['resize', 380],
    ['stop', 380],
  ]);
});

it('removes active document drag listeners on unmount across StrictMode remounts', () => {
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  for (let cycle = 0; cycle < 3; cycle++) {
    const report = vi.fn();
    act(() =>
      root?.render(
        <StrictMode>
          <Sidebar report={report} />
        </StrictMode>,
      ),
    );
    const addedAt = add.mock.calls.length;
    act(() => mouse(container.querySelector('.react-resizable-handle')!, 'mousedown', 0));
    act(() => mouse(document, 'mousemove', 10));
    const listeners = add.mock.calls.slice(addedAt).filter(([type]) => type === 'mousemove' || type === 'mouseup');
    expect(listeners.map(([type]) => type).sort()).toEqual(['mousemove', 'mouseup']);
    const removedAt = remove.mock.calls.length;
    act(() => root?.render(null));
    for (const [type, listener] of listeners) {
      expect(
        remove.mock.calls.slice(removedAt).some(([name, callback]) => name === type && callback === listener),
      ).toBe(true);
    }
    const count = report.mock.calls.length;
    act(() => {
      mouse(document, 'mousemove', 70);
      mouse(document, 'mouseup', 70);
    });
    expect(report).toHaveBeenCalledTimes(count);
  }
});

it.each([
  [0, 240, 160],
  [1, 160, 120],
  [2, 90, 80],
  [3, 360, 240],
])(
  'resizes real SchemaFieldTable column %i while preserving its minimum and other columns',
  (index, initial, minimum) => {
    act(() => root?.render(<SchemaFieldTable fields={[]} />));
    const handles = container.querySelectorAll('.knife4j-schema-resize-handle');
    expect(handles).toHaveLength(4);
    const widths = () =>
      [...container.querySelectorAll<HTMLElement>('thead th')].map((cell) => parseFloat(cell.style.width));
    const original = widths();
    expect(original[index]).toBe(initial);
    drag(handles[index], [40]);
    expect(widths()).toEqual(original.map((width, column) => (column === index ? initial + 40 : width)));
    drag(handles[index], [-1000]);
    expect(widths()[index]).toBe(minimum);
    drag(handles[index], [25]);
    expect(widths()[index]).toBe(minimum + 25);
  },
);

it('isolates real table resize-handle clicks without changing focus or selection policy', () => {
  const parentClick = vi.fn();
  act(() =>
    root?.render(
      <div onClick={parentClick}>
        <button>focus anchor</button>
        <SchemaFieldTable fields={[]} />
      </div>,
    ),
  );
  const anchor = container.querySelector('button')!;
  anchor.focus();
  // Synthetic jsdom mouse events do not perform native focus transfer. This
  // asserts no programmatic focus change; browser old/new checks cover the
  // native INPUT -> DIV focus transfer separately.
  const handle = container.querySelector('.knife4j-schema-resize-handle')!;
  act(() => mouse(handle, 'click', 0));
  expect(parentClick).not.toHaveBeenCalled();
  drag(handle, [20]);
  expect(document.activeElement).toBe(anchor);
  expect(document.body.classList.contains('react-draggable-transparent-selection')).toBe(false);
});
