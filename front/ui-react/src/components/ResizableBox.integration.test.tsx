import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createReactTestRoot, stubLayoutApis } from '../test/reactTestRoot';
import ResizableBox from './ResizableBox';

let view: ReturnType<typeof createReactTestRoot>;

beforeEach(() => {
  view = createReactTestRoot();
  stubLayoutApis();
});

afterEach(async () => {
  await view.unmount();
});

function key(element: HTMLElement, keyName: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init });
  act(() => element.dispatchEvent(event));
  return event;
}

describe('ResizableBox', () => {
  it('supports vertical keyboard resizing, clamping, and double-click reset', async () => {
    function Harness() {
      const [height, setHeight] = useState<number | undefined>(undefined);
      return (
        <ResizableBox
          height={height}
          defaultMaxHeight={400}
          minHeight={120}
          maxHeight={1000}
          onHeightChange={setHeight}
          handleLabel="Resize panel"
          resetTitle="Double click to reset"
        >
          <div data-content>content</div>
        </ResizableBox>
      );
    }

    await view.render(<Harness />);
    const content = view.container.querySelector<HTMLElement>('.knife4j-resizable-box-content')!;
    const handle = view.container.querySelector<HTMLElement>('[role="separator"]')!;

    expect(content.dataset.resized).toBe('false');
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle.getAttribute('aria-label')).toBe('Resize panel');
    expect(handle.getAttribute('aria-valuemin')).toBe('120');
    expect(handle.getAttribute('aria-valuemax')).toBe('1000');
    expect(handle.getAttribute('aria-controls')).toBe(content.id);

    expect(key(handle, 'ArrowDown').defaultPrevented).toBe(true);
    expect(content.dataset.resized).toBe('true');
    expect(content.style.height).toBe('424px');
    expect(handle.getAttribute('aria-valuenow')).toBe('424');

    key(handle, 'ArrowDown', { shiftKey: true });
    expect(content.style.height).toBe('520px');

    key(handle, 'ArrowUp');
    expect(content.style.height).toBe('496px');

    key(handle, 'End');
    expect(content.style.height).toBe('1000px');

    key(handle, 'Home');
    expect(content.style.height).toBe('120px');

    await act(async () => {
      handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(content.dataset.resized).toBe('false');
    expect(content.style.height).toBe('');
  });

  it('resizes smoothly on drag and restores body styles on release', async () => {
    function Harness() {
      const [height, setHeight] = useState<number | undefined>(300);
      return (
        <ResizableBox
          height={height}
          minHeight={120}
          maxHeight={800}
          onHeightChange={setHeight}
          handleLabel="Resize panel"
        >
          <div>body</div>
        </ResizableBox>
      );
    }

    await view.render(<Harness />);
    const content = view.container.querySelector<HTMLElement>('.knife4j-resizable-box-content')!;
    const handle = view.container.querySelector<HTMLElement>('[role="separator"]')!;

    const usePointer = typeof PointerEvent !== 'undefined';
    const downEvent = usePointer
      ? new PointerEvent('pointerdown', { button: 0, clientY: 100, bubbles: true, cancelable: true })
      : new MouseEvent('mousedown', { button: 0, clientY: 100, bubbles: true, cancelable: true });
    const moveEvent = usePointer
      ? new PointerEvent('pointermove', { clientY: 360, bubbles: true })
      : new MouseEvent('mousemove', { clientY: 360, bubbles: true });
    const upEvent = usePointer
      ? new PointerEvent('pointerup', { clientY: 360, bubbles: true })
      : new MouseEvent('mouseup', { clientY: 360, bubbles: true });

    await act(async () => {
      handle.dispatchEvent(downEvent);
    });
    expect(handle.dataset.dragging).toBe('true');
    expect(document.body.style.cursor).toBe('ns-resize');

    await act(async () => {
      window.dispatchEvent(moveEvent);
    });
    expect(content.style.height).toBe('560px');

    await act(async () => {
      window.dispatchEvent(upEvent);
    });
    expect(handle.dataset.dragging).toBe('false');
    expect(document.body.style.cursor).toBe('');
  });
});
