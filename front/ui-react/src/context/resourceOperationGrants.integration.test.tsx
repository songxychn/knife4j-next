import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { sha256Hex } from '../apiChange/apiChangeTracker';
import { createReactTestRoot } from '../test/reactTestRoot';
import { SchemaEngineProvider, useExternalResources, type ExternalResourceContextValue } from './SchemaEngineContext';

const providerHarness = vi.hoisted(() => ({
  group: vi.fn(),
  remember: vi.fn(),
  open: vi.fn(async () => ({ status: 'ready', session: {} })),
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

let view: ReturnType<typeof createReactTestRoot>;
let resources: ExternalResourceContextValue;

function Probe() {
  resources = useExternalResources();
  return null;
}

beforeEach(() => {
  view = createReactTestRoot();
});

afterEach(async () => {
  await view.unmount();
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
        setOperationResourceSnapshot: vi.fn(),
      });
      await view.render(
        <SchemaEngineProvider>
          <Probe />
        </SchemaEngineProvider>,
      );
      expect(providerHarness.open).toHaveBeenCalledOnce();
      let finishRemember: ((persisted: boolean) => void) | undefined;
      providerHarness.remember.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finishRemember = resolve;
          }),
      );
      let remembering!: Promise<boolean>;
      await act(async () => {
        remembering = resources.rememberAndLoad([sha256Hex(a)]);
      });
      expect(finishRemember).toBeTypeOf('function');
      let nextRemembering: Promise<boolean> | undefined;
      let finishNextRemember: ((persisted: boolean) => void) | undefined;
      await act(async () => {
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
      });
      await act(async () => {
        finishRemember!(true);
        await expect(remembering).resolves.toBe(true);
      });
      if (nextRemembering) {
        expect(requested).toEqual([]);
        await act(async () => {
          finishNextRemember!(true);
          await expect(nextRemembering).resolves.toBe(true);
        });
      }
      expect(requested).toEqual(action === 'cancel' ? [] : action === 'unchanged operation' ? [a] : [b]);
    },
  );
});
