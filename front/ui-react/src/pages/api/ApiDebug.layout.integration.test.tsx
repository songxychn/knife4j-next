import { act, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createReactTestRoot, stubLayoutApis } from '../../test/reactTestRoot';
import { DEFAULT_SETTINGS } from '../../types/settings';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import { readDebugPanelLayout } from './debugPanelLayout';
import ApiDebug from './ApiDebug';

// Rendering full ApiDebug with Ant Design and CodeMirror under parallel Linux CI load can exceed 5s.
vi.setConfig({ testTimeout: 60_000 });

const state = vi.hoisted(() => ({
  document: null as SwaggerDoc | null,
  operation: undefined as MenuOperation | undefined,
  engine: { status: 'inactive', retrievalUri: null, session: null, error: null },
  resources: { status: 'inactive', snapshot: null, documentScope: null, registrationError: null },
  globalParams: { effectiveParams: [], cookieSession: { credentials: 'same-origin' } },
  auth: { schemes: {}, ready: true },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));
vi.mock('./useCurrentOperation', () => ({
  useCurrentOperation: () => ({ loading: false, swaggerDoc: state.document, operation: state.operation }),
  OperationModeLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../context/GroupContext', () => ({
  useGroup: () => ({
    activeSwaggerGroup: null,
    operationRetrievalUri: 'https://example.test/openapi.json',
    routeGroupReady: true,
  }),
}));
vi.mock('../../context/SettingsContext', () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS }) }));
vi.mock('../../context/GlobalParamContext', () => ({ useGlobalParam: () => state.globalParams }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => state.auth }));
vi.mock('../../context/SchemaEngineContext', () => ({
  useSchemaEngine: () => state.engine,
  useExternalResources: () => state.resources,
}));

let view: ReturnType<typeof createReactTestRoot>;

beforeEach(() => {
  localStorage.clear();
  view = createReactTestRoot();
  stubLayoutApis();
  const operation: MenuOperation = {
    key: 'create-item',
    path: '/items',
    method: 'post',
    summary: 'Create Item',
    operation: {
      summary: 'Create Item',
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
            },
          },
        },
      },
      responses: { 200: { description: 'OK' } },
    },
  };
  state.operation = operation;
  state.document = {
    openapi: '3.0.3',
    info: { title: 'Demo', version: '1.0.0' },
    paths: { '/items': { post: operation.operation } },
  };
});

afterEach(async () => {
  await view.unmount();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ApiDebug collapsible and resizable layout', () => {
  test('collapses and expands the request section and persists resized request body height', async () => {
    await view.render(
      <MemoryRouter initialEntries={['/default/items/create-item/debug']}>
        <ApiDebug />
      </MemoryRouter>,
    );

    expect(view.container.querySelector('[data-request-section]')).not.toBeNull();
    const handle = view.container.querySelector<HTMLElement>('[data-resize-handle="vertical"]')!;
    await act(async () => {
      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(readDebugPanelLayout().requestBodyHeight).toBe(496);

    const collapseBtn = view.container.querySelector<HTMLButtonElement>('[data-request-collapse-toggle]')!;
    expect(collapseBtn.getAttribute('aria-expanded')).toBe('true');
    await act(async () => collapseBtn.click());

    expect(view.container.querySelector('[data-request-section]')).toBeNull();
    const collapsedBar = view.container.querySelector('[data-request-collapsed-bar]');
    expect(collapsedBar).not.toBeNull();
    expect(collapsedBar?.textContent).toContain('apiDebug.request.collapsedSummary');

    const expandBtn = view.container.querySelector<HTMLButtonElement>('[data-request-collapse-toggle]')!;
    expect(expandBtn.getAttribute('aria-expanded')).toBe('false');
    await act(async () => expandBtn.click());

    expect(view.container.querySelector('[data-request-section]')).not.toBeNull();
    expect(view.container.querySelector<HTMLElement>('.knife4j-resizable-box-content')?.style.height).toBe('496px');
  });
});
