import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';

export function createReactTestRoot() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  return {
    container,
    async render(element: ReactNode) {
      await act(async () => root.render(element));
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export function stubLayoutApis() {
  // jsdom has no viewport measurement or pseudo-element layout.
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
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
}
