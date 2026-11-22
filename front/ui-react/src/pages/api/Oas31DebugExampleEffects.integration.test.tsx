import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OperationDebugModel } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import {
  useOas31DebugDefaultHydrator,
  useOas31DebugExampleLoader,
  type Oas31DebugExampleLoaderProps,
} from './useOas31DebugExamples';
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

function LoaderHost(props: Oas31DebugExampleLoaderProps) {
  useOas31DebugExampleLoader(props);
  return null;
}

function HydratorHost(props: Parameters<typeof useOas31DebugDefaultHydrator>[0]) {
  useOas31DebugDefaultHydrator(props);
  return null;
}

// This host supplies the same state/ref contract as ApiDebug. The production
// effect hooks run through React's renderer, dependency tracking and cleanup.
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
  useOas31DebugExampleLoader({ ...loaderProps, setState, generateExamples });
  useOas31DebugDefaultHydrator({
    activeExamples: state.status === 'ready' ? state.examples : null,
    state,
    identity,
    editRevisionRef,
    appliedIdentityRef,
    hydratedDebugCacheKey: cacheReady ? 'pets' : null,
    currentDebugCacheKey: 'pets',
    selectedBody: debugModel.bodyContents[0],
    setBody,
    setFormFields,
  });
  return (
    <>
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
      root.render(<LoaderHost {...loaderProps} setState={setState} generateExamples={generateExamples} />);
    });
    expect(signals[0].aborted).toBe(false);
    const nextOperation = { ...operation, key: 'Pets/put', method: 'put' };
    const nextIdentity = { ...identity, operationKey: nextOperation.key };
    await act(async () => {
      root.render(
        <LoaderHost
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

  test.each(['another group', 'new document at the same address'] as const)(
    'accepts only results owned by the latest task (%s)',
    async (scenario) => {
      const previous = deferred<Oas31DebugBodyExamples>();
      const current = deferred<Oas31DebugBodyExamples>();
      const setState = vi.fn();
      const originalGenerator = vi.fn(() => previous.promise);
      const currentGenerator = vi.fn(() => current.promise);
      await act(async () =>
        root.render(<LoaderHost {...loaderProps} setState={setState} generateExamples={originalGenerator} />),
      );
      expect(setState).toHaveBeenLastCalledWith({ status: 'loading', identity });

      const nextDocument = { ...apiDocument };
      const nextSession = {
        ...session,
        retrievalUri:
          scenario === 'another group' ? 'https://examples.knife4j.example/other.json' : session.retrievalUri,
      };
      const nextOperation = scenario === 'another group' ? { ...operation, key: 'Pets/put' } : operation;
      const nextIdentity = {
        document: nextDocument,
        session: nextSession,
        retrievalUri: nextSession.retrievalUri,
        operationKey: nextOperation.key,
      };
      await act(async () =>
        root.render(
          <LoaderHost
            {...loaderProps}
            document={nextDocument}
            operation={nextOperation}
            session={nextSession}
            identity={nextIdentity}
            setState={setState}
            generateExamples={currentGenerator}
          />,
        ),
      );
      await act(async () => previous.resolve(examples));
      expect(setState).toHaveBeenLastCalledWith({ status: 'loading', identity: nextIdentity });
      await act(async () => current.resolve(examples));
      const ready = setState.mock.calls.filter(([value]) => value.status === 'ready');
      expect(ready).toEqual([[{ status: 'ready', identity: nextIdentity, examples }]]);
    },
  );

  test('applies a current result only once and ignores edits and stale identities', async () => {
    const state: Oas31DebugExampleState = { status: 'ready', identity, examples };
    const editRevisionRef = { current: 1 };
    const appliedIdentityRef: { current: Oas31DebugExampleIdentity | null } = { current: null };
    const setBody = vi.fn();
    const setFormFields = vi.fn();
    const props = {
      state,
      editRevisionRef,
      appliedIdentityRef,
      hydratedDebugCacheKey: 'pets',
      currentDebugCacheKey: 'pets',
      selectedBody: debugModel.bodyContents[0],
      setBody,
      setFormFields,
    };

    await act(async () => root.render(<HydratorHost {...props} identity={identity} activeExamples={examples} />));
    expect(setBody).not.toHaveBeenCalled();

    editRevisionRef.current = 0;
    const staleIdentity = { ...identity, document: { ...apiDocument }, session: { ...session } };
    await act(async () => root.render(<HydratorHost {...props} identity={staleIdentity} activeExamples={null} />));
    expect(setBody).not.toHaveBeenCalled();

    await act(async () => root.render(<HydratorHost {...props} identity={identity} activeExamples={examples} />));
    expect(setBody).toHaveBeenCalledWith(examples.defaults.bodyByMediaType['application/json']);
    expect(setFormFields).toHaveBeenCalledWith({});
    expect(appliedIdentityRef.current).toBe(identity);

    await act(async () =>
      root.render(<HydratorHost {...props} identity={identity} activeExamples={{ ...examples }} />),
    );
    expect(setBody).toHaveBeenCalledOnce();
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
