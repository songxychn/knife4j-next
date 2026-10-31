import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { collectOas31DocumentDiagnostics } from 'knife4j-core';
import { createSchemaEngine } from 'knife4j-schema-engine';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import type { i18n as I18n } from 'i18next';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import { DEFAULT_SETTINGS } from '../../types/settings';
import ApiDebug from './ApiDebug';

const state = vi.hoisted(() => ({
  document: null as SwaggerDoc | null,
  operation: undefined as MenuOperation | undefined,
  engine: { status: 'inactive', retrievalUri: null, session: null, error: null },
  resources: { status: 'inactive', snapshot: null, documentScope: null, registrationError: null },
  globalParams: { effectiveParams: [], cookieSession: { credentials: 'same-origin' } },
  auth: { schemes: {}, ready: true },
}));
vi.mock('./useCurrentOperation', () => ({
  useCurrentOperation: () => ({ loading: false, swaggerDoc: state.document, operation: state.operation }),
  OperationModeLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../context/GroupContext', () => ({
  useGroup: () => ({
    activeSwaggerGroup: null,
    operationRetrievalUri: 'https://example.test/multipart.json',
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

let i18n: I18n;
let root: Root;
let container: HTMLDivElement;

beforeAll(async () => {
  i18n = (await import('../../i18n')).default;
  if (!i18n.isInitialized) {
    await new Promise<void>((resolve) => {
      const initialized = () => {
        i18n.off('initialized', initialized);
        resolve();
      };
      i18n.on('initialized', initialized);
    });
  }
});

beforeEach(() => {
  localStorage.clear();
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
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => getComputedStyle(element));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe.each(['zh-CN', 'en-US', 'ja-JP'] as const)('real multipart header labels in %s', (language) => {
  test.each(['{{header}}', 'metadata'])('keeps the literal property name %s', async (property) => {
    // OAS 3.1 property names and matching Encoding Object keys are unrestricted
    // strings; X-Part-Trace is a valid, ordinary HTTP field name.
    const operation = {
      requestBody: {
        content: {
          'multipart/form-data': {
            schema: { type: 'object', properties: { [property]: { type: 'string' } } },
            encoding: { [property]: { headers: { 'X-Part-Trace': { schema: { type: 'string' } } } } },
          },
        },
      },
      responses: { '204': { description: 'Uploaded' } },
    };
    state.document = {
      openapi: '3.1.1',
      info: { title: 'Multipart literal field name', version: '1' },
      paths: { '/upload': { post: operation } },
    };
    expect(collectOas31DocumentDiagnostics(state.document)).toEqual([]);
    const checker = createSchemaEngine();
    try {
      await expect(checker.evaluate('https://spec.openapis.org/oas/3.1/schema', state.document)).resolves.toMatchObject(
        { valid: true },
      );
    } finally {
      checker.dispose();
    }
    state.operation = {
      key: 'upload',
      path: '/upload',
      method: 'post',
      summary: 'Upload',
      source: 'path',
      operation,
    };
    await act(async () => {
      await i18n.changeLanguage(language);
      root.render(
        <MemoryRouter>
          <ApiDebug />
        </MemoryRouter>,
      );
    });
    const expected =
      language === 'zh-CN'
        ? `${property} 字段的 X-Part-Trace part Header`
        : language === 'ja-JP'
          ? `${property} の X-Part-Trace part Header`
          : `X-Part-Trace part header for ${property}`;
    const labels = Array.from(container.querySelectorAll('input'), (input) => input.getAttribute('aria-label'));
    expect(labels, labels.filter(Boolean).join('\n')).toContain(expected);
  });
});
