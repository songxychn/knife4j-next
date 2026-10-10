import { message, Modal, notification } from 'antd';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

beforeEach(() => {
  // jsdom does not implement media queries or pseudo-element computed styles.
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
});

afterEach(async () => {
  await act(async () => {
    message.destroy();
    notification.destroy();
    Modal.destroyAll();
  });
  await vi.waitFor(() => expect(document.querySelector('.ant-modal-root')).toBeNull());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function clickDialogButton(text: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.ant-modal button')).find(
    (item) => item.textContent === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

describe('Ant Design 6 static methods with native React 19 support', () => {
  test('renders and destroys a static message', async () => {
    await act(async () => {
      void message.success({ content: 'Saved for React 19', duration: 0 });
    });
    await vi.waitFor(() => expect(document.querySelector('.ant-message-notice')?.textContent).toContain('Saved'));
    await act(async () => message.destroy());
    await vi.waitFor(() => expect(document.querySelector('.ant-message-notice')).toBeNull());
  });

  test('renders and destroys a static notification', async () => {
    await act(async () => {
      notification.open({ title: 'Request complete', description: 'Response received', duration: 0 });
    });
    await vi.waitFor(() =>
      expect(document.querySelector('.ant-notification-notice')?.textContent).toContain('Response received'),
    );
    await act(async () => notification.destroy());
    await vi.waitFor(() => expect(document.querySelector('.ant-notification-notice')).toBeNull());
  });

  test('cancels a confirmation once and cleans up its portal', async () => {
    const onCancel = vi.fn();
    const afterClose = vi.fn();
    await act(async () => {
      Modal.confirm({ title: 'Keep local data?', cancelText: 'Keep', onCancel, afterClose });
    });
    await vi.waitFor(() => expect(document.querySelector('.ant-modal')?.textContent).toContain('Keep local data?'));
    await clickDialogButton('Keep');
    await vi.waitFor(() => expect(afterClose).toHaveBeenCalledTimes(1));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ant-modal-root')).toBeNull();
  });

  test('waits for asynchronous confirmation before closing and cleans up its portal', async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const onOk = vi.fn(() => pending);
    const afterClose = vi.fn();
    await act(async () => {
      Modal.confirm({ title: 'Export snapshot?', okText: 'Export', onOk, afterClose });
    });
    await vi.waitFor(() => expect(document.querySelector('.ant-modal')?.textContent).toContain('Export snapshot?'));
    await clickDialogButton('Export');
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.ant-modal .ant-btn-loading')).not.toBeNull();
    expect(afterClose).not.toHaveBeenCalled();
    await act(async () => complete());
    await vi.waitFor(() => expect(afterClose).toHaveBeenCalledTimes(1));
    expect(document.querySelector('.ant-modal-root')).toBeNull();
  });
});
