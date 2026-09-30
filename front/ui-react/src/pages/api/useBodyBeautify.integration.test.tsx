import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DebugCacheRawMode } from './debugCache';
import { formatBodyByRawMode } from './rawBodyFormatting';
import { useBodyBeautify } from './useBodyBeautify';

vi.mock('./rawBodyFormatting', () => ({ formatBodyByRawMode: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const initialIdentity = {};
const onFailure = vi.fn();
const onFormatted = vi.fn();
function Editor({
  identity = initialIdentity,
  rawMode = 'javascript',
  contentType = 'application/javascript',
}: {
  identity?: unknown;
  rawMode?: DebugCacheRawMode;
  contentType?: string;
}) {
  const [body, setBody] = useState('const x=1');
  const beautify = useBodyBeautify({
    body,
    rawMode,
    identity,
    contentType,
    onFormatted: (next) => {
      onFormatted(next);
      setBody(next);
    },
    onFailure,
  });
  return (
    <>
      <textarea aria-label="Request body" value={body} onInput={(event) => setBody(event.currentTarget.value)} />
      <button onClick={() => void beautify()}>Format</button>
    </>
  );
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function clickFormat() {
  await act(async () => container.querySelector('button')!.click());
}
async function editBody(value: string) {
  await act(async () => {
    const editor = container.querySelector('textarea')!;
    editor.value = value;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('real React async body formatting lifecycle', () => {
  test('applies a completed format to the current editor', async () => {
    const pending = deferred<string | undefined>();
    vi.mocked(formatBodyByRawMode).mockReturnValue(pending.promise);
    await act(async () => root.render(<Editor />));
    await clickFormat();
    expect(formatBodyByRawMode).toHaveBeenCalledWith('const x=1', 'javascript');
    await act(async () => pending.resolve('const x = 1;'));
    expect(container.querySelector('textarea')!.value).toBe('const x = 1;');
    expect(onFailure).not.toHaveBeenCalled();
  });

  test('does not overwrite edits even when the user returns to the original text', async () => {
    const pending = deferred<string | undefined>();
    vi.mocked(formatBodyByRawMode).mockReturnValue(pending.promise);
    await act(async () => root.render(<Editor />));
    await clickFormat();
    await editBody('const x=2');
    await editBody('const x=1');
    await act(async () => pending.resolve('const x = 1;'));
    expect(container.querySelector('textarea')!.value).toBe('const x=1');
    expect(onFormatted).not.toHaveBeenCalled();
  });

  test.each([
    ['operation', { identity: {} }],
    ['raw mode', { rawMode: 'json' as const }],
    ['content type', { contentType: 'text/javascript' }],
  ])('discards formatting after changing %s', async (_name, props) => {
    const pending = deferred<string | undefined>();
    vi.mocked(formatBodyByRawMode).mockReturnValue(pending.promise);
    await act(async () => root.render(<Editor />));
    await clickFormat();
    await act(async () => root.render(<Editor {...props} />));
    await act(async () => pending.resolve('const x = 1;'));
    expect(container.querySelector('textarea')!.value).toBe('const x=1');
    expect(onFormatted).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  test('discards pending work after the editor unmounts', async () => {
    const pending = deferred<string | undefined>();
    vi.mocked(formatBodyByRawMode).mockReturnValue(pending.promise);
    await act(async () => root.render(<Editor />));
    await clickFormat();
    await act(async () => root.render(null));
    await act(async () => pending.resolve('const x = 1;'));
    expect(onFormatted).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });

  test('the latest format wins and a stale failure does not show a warning', async () => {
    const first = deferred<string | undefined>();
    const second = deferred<string | undefined>();
    vi.mocked(formatBodyByRawMode).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await act(async () => root.render(<Editor />));
    await clickFormat();
    await clickFormat();
    await act(async () => second.resolve('const x = 1;'));
    await act(async () => first.resolve(undefined));
    expect(container.querySelector('textarea')!.value).toBe('const x = 1;');
    expect(onFormatted).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  test('reports a current failure without changing the body', async () => {
    vi.mocked(formatBodyByRawMode).mockResolvedValue(undefined);
    await act(async () => root.render(<Editor />));
    await clickFormat();
    expect(container.querySelector('textarea')!.value).toBe('const x=1');
    expect(onFormatted).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
