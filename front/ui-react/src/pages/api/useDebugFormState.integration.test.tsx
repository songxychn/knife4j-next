import { act, createRef, forwardRef, useEffect, useImperativeHandle } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useDebugFormState, type DebugFormState } from './useDebugFormState';
import type { InitialDebugState } from './debugFormState';

type DebugForm = ReturnType<typeof useDebugFormState>;
const onActionsChanged = vi.fn();
const onCommit = vi.fn();
const Form = forwardRef<DebugForm>(function Form(_props, ref) {
  const result = useDebugFormState('https://api.example');
  useImperativeHandle(ref, () => result, [result]);
  useEffect(() => {
    onActionsChanged(result.actions);
  }, [result.actions]);
  useEffect(() => {
    onCommit(result.form);
  }, [result.form]);
  return <output>{JSON.stringify(result.form)}</output>;
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('real React debug form state', () => {
  test('batched functional edits preserve each other and keep action dependencies stable', async () => {
    const ref = createRef<DebugForm>();
    await act(async () => root.render(<Form ref={ref} />));
    const initialActions = ref.current!.actions;
    await act(async () => {
      initialActions.setBody((previous) => previous + 'first');
      initialActions.setParamValues((previous) => ({ ...previous, 'query:search': 'pet' }));
      initialActions.setBody((previous) => previous + '-second');
      initialActions.setParamValues((previous) => ({ ...previous, 'path:id': '42' }));
      initialActions.setMethod('POST');
    });
    expect(ref.current!.form).toMatchObject({
      baseUrl: 'https://api.example',
      method: 'POST',
      body: 'first-second',
      paramValues: { 'query:search': 'pet', 'path:id': '42' },
    });
    expect(ref.current!.actions).toBe(initialActions);
    expect(onActionsChanged).toHaveBeenCalledTimes(1);
    expect(container.querySelector('output')!.textContent).toContain('first-second');
  });

  test('replaces the form atomically and clears metadata left by the previous operation', async () => {
    const ref = createRef<DebugForm>();
    await act(async () => root.render(<Form ref={ref} />));
    const initial: InitialDebugState = { ...ref.current!.form };
    const oldEntries = { 'query:old': { kind: 'editor' as const, text: 'old value', enabled: true } };
    await act(async () => {
      ref.current!.actions.replaceForm(
        { ...initial, path: '/previous', body: 'previous body', formPartHeaders: { upload: { 'X-Part': 'old' } } },
        oldEntries,
        'application/json',
      );
    });
    expect(ref.current!.form.oas32ParameterEntries).toEqual(oldEntries);
    expect(ref.current!.form.serializedBodyMedia32).toBe('application/json');

    const next: InitialDebugState = { ...initial, method: 'PUT', path: '/next', body: 'next body' };
    onCommit.mockClear();
    await act(async () => ref.current!.actions.replaceForm(next));
    const expected: DebugFormState = { ...next, oas32ParameterEntries: {}, serializedBodyMedia32: undefined };
    expect(ref.current!.form).toEqual(expected);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenLastCalledWith(expected);
    expect(onActionsChanged).toHaveBeenCalledTimes(1);
  });
});
