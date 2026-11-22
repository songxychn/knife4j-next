import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createReactTestRoot } from '../../test/reactTestRoot';
import { evaluateOperationExample, type OperationExampleTarget } from '../../schema/operationExampleCatalog';
import OperationExamplePicker from './OperationExamplePicker';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../pages/api/CodeBlock', () => ({
  default: ({ code }: { code: string }) => <pre data-example-code="">{code}</pre>,
}));
vi.mock('antd', async (importOriginal) => ({
  ...(await importOriginal<typeof import('antd')>()),
  Select: (props: {
    'aria-label': string;
    value: string;
    options: Array<{ label: string; value: string }>;
    onChange: (value: string) => void;
  }) => (
    <select
      aria-label={props['aria-label']}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.options.map(({ label, value }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  ),
}));

let view: ReturnType<typeof createReactTestRoot>;
beforeEach(() => {
  view = createReactTestRoot();
});
afterEach(async () => {
  await view.unmount();
});

function target(source: Record<string, unknown>, mediaType = 'application/json'): OperationExampleTarget {
  const location = {
    ownerRetrievalUri: 'https://example.test/openapi.json',
    pointer: '/paths/~1examples/post/requestBody',
    value: source,
  };
  return {
    id: 'json',
    group: 'body:application/json',
    name: 'json',
    operationIdentity: 'post:/examples',
    generation: 1,
    direction: 'request',
    layer: 'media',
    mediaType,
    sourceLocation: location,
    containerLocation: location,
    source,
    context: { layer: 'media', mediaType },
  };
}
function codeBlocks() {
  return [...view.container.querySelectorAll('[data-example-code]')];
}

function initialBlocks() {
  return codeBlocks().filter((node) => !node.closest('details:not([open])'));
}

async function render(entry: OperationExampleTarget, onApply = vi.fn(), targets = [entry]) {
  await view.render(<OperationExamplePicker targets={targets} onApply={onApply} />);
  return { onApply, result: await evaluateOperationExample(entry) };
}

describe('OperationExamplePicker JSON representations', () => {
  test.each([{ ids: ['one'] }, { ids: [] }, [], null, false, 0, ''].map((data) => [data]))(
    'collapses the same example raw text for %j',
    async (data) => {
      await render(target({ value: data }));
      expect(initialBlocks()).toHaveLength(1);
      const details = view.container.querySelector('details');
      expect(details?.open).toBe(false);
      expect(details?.querySelector('summary')).not.toBeNull();
    },
  );

  test('keeps authored whitespace, escapes, number spelling and key order in the original text', async () => {
    const raw = ' { "n": 1e0, "ids": ["\\u006fne"] }\n';
    const { result, onApply } = await render(target({ dataValue: { ids: ['one'], n: 1 }, serializedValue: raw }));
    expect(initialBlocks()).toHaveLength(1);
    expect(codeBlocks().map((node) => node.textContent)).toContain(raw);
    const summary = view.container.querySelector('summary')!;
    await act(async () => summary.click());
    expect(summary.parentElement?.hasAttribute('open')).toBe(true);
    expect(onApply).not.toHaveBeenCalled();
    const button = [...view.container.querySelectorAll('button')].find(
      (node) => node.textContent === 'schema.example32.apply',
    );
    expect(button?.disabled).toBe(false);
    await act(async () => button!.click());
    expect(onApply).toHaveBeenCalledWith(result, 0);
    expect(result.representation.text).toBe(raw);
  });

  test.each([
    [{ dataValue: { ids: [] }, serializedValue: '{"ids":["one"]}' }, 'application/json'],
    [{ dataValue: {}, serializedValue: '{bad' }, 'application/json'],
    [{ dataValue: 9007199254740991, serializedValue: '9007199254740993' }, 'application/json'],
    [{ dataValue: 'hello' }, 'text/plain'],
    [{ dataValue: { ids: [] }, serializedValue: '<ids/>' }, 'application/xml'],
    [{ dataValue: {}, serializedValue: '' }, 'application/x-www-form-urlencoded'],
    [{ dataValue: [], serializedValue: '\u001e[]\n' }, 'application/json-seq'],
    [{ dataValue: [], externalValue: 'https://example.test/data.json' }, 'application/json'],
  ])('does not collapse differing, unverified, external or non-JSON examples (%j, %s)', async (source, media) => {
    const { result } = await render(target(source as Record<string, unknown>, media as string));
    expect(view.container.querySelector('details')).toBeNull();
    if (result.representation.text !== undefined) expect(initialBlocks()).toHaveLength(2);
    if (result.representation.diagnostics.length) expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
  });

  test('keeps named examples selectable and renders the selected empty array', async () => {
    const first = target({ value: { ids: ['one'] } });
    const second = { ...target({ value: { ids: [] } }), id: 'empty', name: 'empty' };
    await render(first, vi.fn(), [first, second]);
    const select = view.container.querySelector('select')!;
    expect([...select.options].map((option) => option.value)).toEqual(['json', 'empty']);
    await act(async () => {
      select.value = 'empty';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(select.value).toBe('empty');
    expect(initialBlocks().map((node) => node.textContent)).toEqual([JSON.stringify({ ids: [] }, null, 2)]);
  });

  test('does not collapse sequential media with itemSchema', async () => {
    const entry = { ...target({ value: [] }), itemSchemaLocation: target({}).sourceLocation };
    await render(entry);
    expect(view.container.querySelector('details')).toBeNull();
  });
});
