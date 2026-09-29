import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OperationDebugModel } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import {
  Oas31DebugDefaultHydrator,
  Oas31DebugExampleLoader,
  type Oas31DebugExampleLoaderProps,
} from './Oas31DebugExampleEffects';
import type { Oas31DebugBodyExamples, Oas31DebugExampleIdentity, Oas31DebugExampleState } from './oas31DebugExamples';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const apiDocument: SwaggerDoc = {
  openapi: '3.1.1',
  info: { title: 'Lifecycle', version: '1.0.0' },
  paths: {},
};
const operation: MenuOperation = {
  key: 'Pets/post',
  path: '/pets',
  method: 'post',
  summary: 'Create pet',
  operation: { responses: { 204: { description: 'Created' } } },
  source: 'path',
};
const debugModel: OperationDebugModel = {
  pathParams: [],
  queryParams: [],
  headerParams: [],
  cookieParams: [],
  bodyContents: [{ mediaType: 'application/json', category: 'json', schema: { type: 'object' } }],
  bodyRequired: true,
};
const session = {
  retrievalUri: 'https://examples.knife4j.example/openapi.json',
  resolve: vi.fn(),
  evaluate: vi.fn(),
  dispose: vi.fn(),
} as unknown as SchemaDocumentSession;
const identity: Oas31DebugExampleIdentity = {
  document: apiDocument,
  session,
  retrievalUri: session.retrievalUri,
  operationKey: operation.key,
};
const examples: Oas31DebugBodyExamples = {
  defaults: {
    bodyByMediaType: { 'application/json': '{"name":"generated"}' },
    formFieldsByMediaType: { 'application/json': {} },
  },
  resultByMediaType: {},
};
const loaderProps = {
  enabled: true,
  document: apiDocument,
  operation,
  debugModel,
  session,
  identity,
};

// This host supplies the same state/ref contract as ApiDebug. The production
// effect components run through React's renderer, dependency tracking and cleanup.
function DebugDefaults({
  generateExamples,
  cacheReady,
}: {
  generateExamples: Oas31DebugExampleLoaderProps['generateExamples'];
  cacheReady: boolean;
}) {
  const [state, setState] = useState<Oas31DebugExampleState>({ status: 'idle' });
  const [body, setBody] = useState('');
  const [, setFormFields] = useState<Record<string, string>>({});
  const editRevisionRef = useRef(0);
  const appliedIdentityRef = useRef<Oas31DebugExampleIdentity | null>(null);
  return (
    <>
      <Oas31DebugExampleLoader {...loaderProps} setState={setState} generateExamples={generateExamples} />
      <Oas31DebugDefaultHydrator
        activeExamples={state.status === 'ready' ? state.examples : null}
        state={state}
        identity={identity}
        editRevisionRef={editRevisionRef}
        appliedIdentityRef={appliedIdentityRef}
        hydratedDebugCacheKey={cacheReady ? 'pets' : null}
        currentDebugCacheKey="pets"
        selectedBody={debugModel.bodyContents[0]}
        setBody={setBody}
        setFormFields={setFormFields}
      />
      <textarea
        aria-label="Request body"
        value={body}
        onInput={(event) => {
          editRevisionRef.current += 1;
          setBody(event.currentTarget.value);
        }}
      />
      <output>{state.status}</output>
    </>
  );
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('real React debug example lifecycle', () => {
  test('operation changes and unmount abort work and discard late results', async () => {
    const previous = deferred<Oas31DebugBodyExamples>();
    const current = deferred<Oas31DebugBodyExamples>();
    const signals: AbortSignal[] = [];
    const generateExamples = vi.fn<NonNullable<Oas31DebugExampleLoaderProps['generateExamples']>>(
      (_document, _operation, _model, _session, options) => {
        signals.push(options.signal!);
        return signals.length === 1 ? previous.promise : current.promise;
      },
    );
    const setState = vi.fn();
    await act(async () => {
      root.render(<Oas31DebugExampleLoader {...loaderProps} setState={setState} generateExamples={generateExamples} />);
    });
    expect(signals[0].aborted).toBe(false);
    const nextOperation = { ...operation, key: 'Pets/put', method: 'put' };
    const nextIdentity = { ...identity, operationKey: nextOperation.key };
    await act(async () => {
      root.render(
        <Oas31DebugExampleLoader
          {...loaderProps}
          operation={nextOperation}
          identity={nextIdentity}
          setState={setState}
          generateExamples={generateExamples}
        />,
      );
    });
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await act(async () => previous.resolve(examples));
    expect(setState.mock.calls.map(([value]) => value.status)).toEqual(['loading', 'loading']);

    await act(async () => root.render(null));
    expect(signals[1].aborted).toBe(true);
    await act(async () => current.resolve(examples));
    expect(setState.mock.calls.map(([value]) => value.status)).toEqual(['loading', 'loading']);
  });

  test('hydrates after cache restoration and keeps subsequent edits across rerenders', async () => {
    const pending = deferred<Oas31DebugBodyExamples>();
    const generateExamples = vi.fn(() => pending.promise);
    await act(async () => root.render(<DebugDefaults generateExamples={generateExamples} cacheReady={false} />));
    await act(async () => pending.resolve(examples));
    const editor = container.querySelector('textarea')!;
    expect(container.querySelector('output')?.textContent).toBe('ready');
    expect(editor.value).toBe('');

    await act(async () => root.render(<DebugDefaults generateExamples={generateExamples} cacheReady />));
    expect(editor.value).toBe('{"name":"generated"}');
    await act(async () => {
      editor.value = '{"name":"user edit"}';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => root.render(<DebugDefaults generateExamples={generateExamples} cacheReady />));
    expect(editor.value).toBe('{"name":"user edit"}');
    expect(generateExamples).toHaveBeenCalledTimes(1);
  });

  test('does not overwrite edits made before async defaults and cache restoration finish', async () => {
    const pending = deferred<Oas31DebugBodyExamples>();
    const generateExamples = vi.fn(() => pending.promise);
    await act(async () => root.render(<DebugDefaults generateExamples={generateExamples} cacheReady={false} />));
    const editor = container.querySelector('textarea')!;
    await act(async () => {
      editor.value = '{"name":"typed while loading"}';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => pending.resolve(examples));
    await act(async () => root.render(<DebugDefaults generateExamples={generateExamples} cacheReady />));
    expect(container.querySelector('output')?.textContent).toBe('ready');
    expect(editor.value).toBe('{"name":"typed while loading"}');
  });
});
