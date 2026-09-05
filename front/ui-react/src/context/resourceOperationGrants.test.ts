import type { ReactElement } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { sha256Hex } from '../apiChange/apiChangeTracker';
import { ExternalResourceLoader } from '../schema/externalResourceGraph';
import { resourceGrantsForOperation } from './resourceOperationGrants';
import { SchemaEngineProvider, type ExternalResourceContextValue } from './SchemaEngineContext';

const providerHarness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  cleanups: [] as Array<() => void>,
  group: vi.fn(),
  remember: vi.fn(),
  open: vi.fn(async () => ({ status: 'ready', session: {} })),
  jsx: (type: unknown, props: unknown) => ({ type, props }),
}));

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
  useRef: <T>(initial: T) => ({ current: initial }),
  useState: <T>(initial: T) => [initial, vi.fn()],
  useEffect: (effect: () => void | (() => void)) => providerHarness.effects.push(effect),
}));
vi.mock('react/jsx-runtime', () => ({
  jsx: providerHarness.jsx,
  jsxs: providerHarness.jsx,
  jsxDEV: providerHarness.jsx,
}));
vi.mock('react/jsx-dev-runtime', () => ({
  jsx: providerHarness.jsx,
  jsxs: providerHarness.jsx,
  jsxDEV: providerHarness.jsx,
}));

vi.mock('./GroupContext', () => ({ useGroup: providerHarness.group }));
vi.mock('../schema/resourceGrantStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../schema/resourceGrantStorage')>()),
  readRememberedResourceGrants: () => [],
  rememberResourceGrants: providerHarness.remember,
}));
vi.mock('../schema/schemaDocumentSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../schema/schemaDocumentSession')>()),
  SchemaDocumentSessionManager: class {
    open = providerHarness.open;
    clear = vi.fn();
  },
}));

afterEach(() => {
  providerHarness.cleanups.splice(0).forEach((cleanup) => cleanup());
  providerHarness.effects.length = 0;
  providerHarness.remember.mockReset();
  providerHarness.open.mockClear();
  vi.unstubAllGlobals();
});

describe('external resource operation grants', () => {
  test.each(['unchanged operation', 'cancel', 'new selection', 'new remembered selection'] as const)(
    'applies remembered loading only to the current operation (%s)',
    async (action) => {
      const entryUri = 'https://docs.knife4j.example/v3/api-docs';
      const a = 'https://schemas.example.test/a.json';
      const b = 'https://schemas.example.test/b.json';
      const requested: string[] = [];
      vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        requested.push(String(input));
        return new Response('{"type":"string"}', { headers: { 'content-type': 'application/schema+json' } });
      });
      providerHarness.group.mockReturnValue({
        activeSwaggerGroup: { name: 'resources', url: entryUri },
        swaggerDoc: {
          openapi: '3.1.1',
          info: { title: 'Remembered loading', version: '1' },
          components: { schemas: { A: { $ref: a }, B: { $ref: b } } },
        },
        loading: false,
        routeGroupReady: true,
      });
      const tree = SchemaEngineProvider({ children: null }) as ReactElement<{
        children: ReactElement<{ value: ExternalResourceContextValue }>;
      }>;
      providerHarness.effects.splice(0).forEach((effect) => {
        const cleanup = effect();
        if (cleanup) providerHarness.cleanups.push(cleanup);
      });
      await vi.waitFor(() => expect(providerHarness.open).toHaveBeenCalledOnce());
      const resources = tree.props.children.props.value;
      let finishRemember: ((persisted: boolean) => void) | undefined;
      providerHarness.remember.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finishRemember = resolve;
          }),
      );
      const remembering = resources.rememberAndLoad([sha256Hex(a)]);
      expect(finishRemember).toBeTypeOf('function');
      let nextRemembering: Promise<boolean> | undefined;
      let finishNextRemember: ((persisted: boolean) => void) | undefined;
      if (action === 'cancel') resources.cancel();
      else if (action === 'new selection') await resources.loadOnce([sha256Hex(b)]);
      else if (action === 'new remembered selection') {
        providerHarness.remember.mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              finishNextRemember = resolve;
            }),
        );
        nextRemembering = resources.rememberAndLoad([sha256Hex(b)]);
      }
      finishRemember!(true);
      await expect(remembering).resolves.toBe(true);
      if (nextRemembering) {
        expect(requested).toEqual([]);
        finishNextRemember!(true);
        await expect(nextRemembering).resolves.toBe(true);
      }
      expect(requested).toEqual(action === 'cancel' ? [] : action === 'unchanged operation' ? [a] : [b]);
    },
  );

  test('continues an explicitly authorized nested chain without renewing the previous network grant', async () => {
    const entryUri = 'https://docs.knife4j.example/v3/api-docs';
    const a = 'https://schemas.example.test/a.json';
    const b = 'https://schemas.example.test/b.json';
    const requested: string[] = [];
    const loader = new ExternalResourceLoader(
      {
        openapi: '3.1.1',
        info: { title: 'Progressive grants', version: '1' },
        components: { schemas: { Value: { $ref: a } } },
      },
      entryUri,
      {
        pageUri: entryUri,
        fetchImpl: async (input) => {
          requested.push(String(input));
          return new Response(JSON.stringify(String(input) === a ? { $ref: b } : { type: 'string' }), {
            headers: { 'content-type': 'application/schema+json' },
          });
        },
      },
    );
    const selectedGrants = () =>
      resourceGrantsForOperation(
        loader.documentScope,
        new Set(),
        loader.currentDiscovery().candidates.map((candidate) => candidate.retrievalUriHash),
      );
    const first = await loader.continueLoad(selectedGrants());
    expect(first.complete).toBe(false);
    expect(loader.currentDiscovery().candidates.map((candidate) => candidate.retrievalUri)).toEqual([b]);
    const second = await loader.continueLoad(selectedGrants());
    expect(requested).toEqual([a, b]);
    expect(second.complete).toBe(true);
    expect(second.generation).toBe(first.generation);
    expect(second.nodes.get(a)).toBe(first.nodes.get(a));
  });

  test('does not carry a load-once grant into the next operation', () => {
    const scope = 'document-scope';
    const remembered = new Set<string>();

    expect(resourceGrantsForOperation(scope, remembered, ['resource-a'])).toEqual([
      { documentScope: scope, resourceKey: 'resource-a', scope: 'generation' },
    ]);
    expect(resourceGrantsForOperation(scope, remembered, ['resource-b'])).toEqual([
      { documentScope: scope, resourceKey: 'resource-b', scope: 'generation' },
    ]);
  });

  test('keeps remembered grants separate and gives them document scope', () => {
    const scope = 'document-scope';

    expect(resourceGrantsForOperation(scope, new Set(['resource-a']), ['resource-a', 'resource-b'])).toEqual([
      { documentScope: scope, resourceKey: 'resource-a', scope: 'document' },
      { documentScope: scope, resourceKey: 'resource-b', scope: 'generation' },
    ]);
  });

  test('requests only the resource selected by each load-once operation', async () => {
    const entryUri = 'https://docs.knife4j.example/v3/api-docs';
    const a = 'https://schemas.example.test/a.json';
    const b = 'https://schemas.example.test/b.json';
    const requested: string[] = [];
    const loader = new ExternalResourceLoader(
      {
        openapi: '3.1.1',
        info: { title: 'Grant fixture', version: '1' },
        paths: {},
        components: { schemas: { A: { $ref: a }, B: { $ref: b } } },
      },
      entryUri,
      {
        pageUri: 'https://docs.knife4j.example/doc.html',
        fetchImpl: async (input) => {
          requested.push(String(input));
          return new Response('{"type":"string"}', {
            headers: { 'content-type': 'application/schema+json' },
          });
        },
      },
    );
    const remembered = new Set<string>();

    await loader.load(resourceGrantsForOperation(loader.documentScope, remembered, [sha256Hex(a)]));
    await loader.load(resourceGrantsForOperation(loader.documentScope, remembered, [sha256Hex(b)]));

    expect(requested).toEqual([a, b]);
  });
});
