import React, { act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResizableSeparator from './ResizableSeparator';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function key(handle: HTMLElement, key: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  act(() => handle.dispatchEvent(event));
  return event;
}

it('exposes a focusable named separator and keeps its pixel value in sync with keyboard changes', () => {
  function Harness() {
    const [value, setValue] = useState(320);
    return (
      <ResizableSeparator
        value={value}
        min={260}
        max={520}
        onValueChange={setValue}
        label="Sidebar width"
        controls="sidebar"
        className="sidebar-handle"
      />
    );
  }
  act(() => root.render(<Harness />));
  const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
  handle.focus();
  expect(document.activeElement).toBe(handle);
  expect(handle.tabIndex).toBe(0);
  expect(handle.classList.contains('knife4j-resizable-separator')).toBe(true);
  expect(handle.classList.contains('sidebar-handle')).toBe(true);
  expect(handle.getAttribute('aria-label')).toBe('Sidebar width');
  expect(handle.getAttribute('aria-orientation')).toBe('vertical');
  expect(handle.getAttribute('aria-controls')).toBe('sidebar');
  expect(handle.getAttribute('aria-valuemin')).toBe('260');
  expect(handle.getAttribute('aria-valuemax')).toBe('520');
  expect(key(handle, 'ArrowRight').defaultPrevented).toBe(true);
  expect(handle.getAttribute('aria-valuenow')).toBe('330');
  expect(handle.getAttribute('aria-valuetext')).toBe('330px');
  key(handle, 'ArrowLeft');
  expect(handle.getAttribute('aria-valuenow')).toBe('320');
  key(handle, 'Home');
  key(handle, 'ArrowLeft');
  expect(handle.getAttribute('aria-valuenow')).toBe('260');
  key(handle, 'End');
  key(handle, 'ArrowRight');
  expect(handle.getAttribute('aria-valuenow')).toBe('520');
  expect(document.activeElement).toBe(handle);
});

it('forwards the handle ref and mouse/touch props while isolating clicks', () => {
  const ref = createRef<HTMLSpanElement>();
  const mouse = vi.fn();
  const touch = vi.fn();
  const click = vi.fn();
  const parentClick = vi.fn();
  act(() =>
    root.render(
      <div onClick={parentClick}>
        <ResizableSeparator
          ref={ref}
          value={320}
          min={260}
          max={520}
          onValueChange={vi.fn()}
          label="Sidebar width"
          handleAxis="e"
          onMouseDown={mouse}
          onTouchStart={touch}
          onClick={click}
        />
      </div>,
    ),
  );
  const handle = ref.current!;
  expect(handle).toBe(container.querySelector('[role="separator"]'));
  expect(handle.hasAttribute('handleAxis')).toBe(false);
  act(() => {
    handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    handle.dispatchEvent(new Event('touchstart', { bubbles: true }));
    handle.click();
  });
  expect(mouse).toHaveBeenCalledOnce();
  expect(touch).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  expect(parentClick).not.toHaveBeenCalled();
});

it('leaves unrelated keys and browser shortcuts available and respects a cancelled key handler', () => {
  const change = vi.fn();
  const parentKey = vi.fn();
  const cancelled = vi.fn((event: React.KeyboardEvent) => event.preventDefault());
  const render = (onKeyDown?: React.KeyboardEventHandler<HTMLSpanElement>) =>
    act(() =>
      root.render(
        <div onKeyDown={parentKey}>
          <ResizableSeparator
            value={320}
            min={260}
            max={520}
            onValueChange={change}
            label="Sidebar width"
            onKeyDown={onKeyDown}
          />
        </div>,
      ),
    );
  render();
  const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
  expect(key(handle, 'Tab').defaultPrevented).toBe(false);
  expect(key(handle, 'ArrowDown').defaultPrevented).toBe(false);
  expect(key(handle, 'ArrowLeft', { altKey: true }).defaultPrevented).toBe(false);
  expect(key(handle, 'Home', { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(change).not.toHaveBeenCalled();
  expect(parentKey).toHaveBeenCalledTimes(4);
  key(handle, 'ArrowRight');
  expect(change).toHaveBeenCalledExactlyOnceWith(330);
  expect(parentKey).toHaveBeenCalledTimes(4);
  render(cancelled);
  key(handle, 'ArrowRight');
  expect(cancelled).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledTimes(1);
});
