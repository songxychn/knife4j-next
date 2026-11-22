import { act } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createReactTestRoot, stubLayoutApis } from '../../test/reactTestRoot';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import { copyToClipboard } from '../../utils/clipboard';
import { readDebugSessionState, removeDebugSessionState, writeDebugSessionState } from './debugSessionState';
import ResponsePanel, { ResponseSchemaDiagnosticAlert, type DebugResponsePayload } from './ResponsePanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  }),
}));
vi.mock('../../utils/clipboard', () => ({ copyToClipboard: vi.fn() }));

const response: DebugResponsePayload = {
  status: 200,
  statusText: 'OK',
  method: 'GET',
  duration: 12,
  contentType: 'application/json',
  size: 20,
  headers: { 'content-type': 'application/json', 'x-trace-id': 'trace-698' },
  rawText: '{"items":[{"id":1}]}',
  kind: 'json',
};
const curlSessionKey = 'response-curl-source';
let view: ReturnType<typeof createReactTestRoot>;

beforeEach(() => {
  view = createReactTestRoot();
  stubLayoutApis();
  vi.mocked(copyToClipboard).mockClear();
  // CodeMirror requests DOM range geometry when positioning schema descriptions.
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() =>
    Object.assign(createRange(), {
      getBoundingClientRect: () => new DOMRect(),
      getClientRects: () => [],
    }),
  );
});

afterEach(async () => {
  await view.unmount();
  removeDebugSessionState(curlSessionKey);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const element = Array.from(view.container.querySelectorAll('button')).find((item) => item.textContent === label);
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}

async function selectTab(key: 'content' | 'raw' | 'headers') {
  const label = `apiDebug.response.tab.${key}`;
  const tab = Array.from(view.container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
    (item) => item.textContent === label,
  );
  if (!tab) throw new Error(`Missing tab: ${label}`);
  await act(async () => tab.click());
  expect(tab.getAttribute('aria-selected')).toBe('true');
}

describe('ResponseSchemaDiagnosticAlert', () => {
  test('renders bounded instance paths and marks schema mismatches as non-blocking warnings', async () => {
    await view.render(
      <ResponseSchemaDiagnosticAlert
        diagnostic={{
          status: 'invalid',
          issues: [
            {
              instanceLocation: '/profile/name',
              keyword: 'type',
              absoluteKeywordLocation: 'https://schemas.example.test/profile#/properties/name/type',
            },
          ],
          totalIssues: 3,
        }}
      />,
    );

    const diagnostic = view.container.querySelector('#knife4j-response-schema-diagnostics');
    expect(diagnostic?.getAttribute('data-diagnostic-status')).toBe('invalid-schema');
    expect(diagnostic?.querySelector('.ant-alert-warning[role="alert"]')).not.toBeNull();
    expect(diagnostic?.textContent).toContain('$/profile/name');
    expect(diagnostic?.textContent).toContain('apiDebug.responseSchemaValidation.moreIssues:{"count":2}');
  });

  test('surfaces inactive engines without turning diagnostics into a response error', async () => {
    await view.render(
      <ResponseSchemaDiagnosticAlert diagnostic={{ status: 'unavailable', reason: 'engine-inactive' }} />,
    );
    const diagnostic = view.container.querySelector('#knife4j-response-schema-diagnostics');
    expect(diagnostic?.getAttribute('data-diagnostic-status')).toBe('unavailable');
    expect(diagnostic?.querySelector('.ant-alert-info[role="alert"]')).not.toBeNull();
    expect(diagnostic?.textContent).toContain('apiDebug.responseSchemaValidation.unavailableTitle');
  });
});

describe('ResponsePanel diagnostic integration', () => {
  test('toggles descriptions in the foldable JSON viewer and preserves raw copy', async () => {
    const operation: MenuOperation = {
      key: 'items',
      path: '/items',
      method: 'get',
      summary: 'Items',
      operation: {
        responses: {
          200: {
            description: 'OK',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', description: '资源列表', items: { type: 'object' } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const swaggerDoc: SwaggerDoc = {
      openapi: '3.1.1',
      info: { title: 'Example', version: '1' },
      paths: { '/items': { get: operation.operation } },
    };
    await view.render(
      <ResponsePanel
        response={response}
        error={null}
        builtRequest={null}
        operation={operation}
        swaggerDoc={swaggerDoc}
      />,
    );

    const viewer = () => view.container.querySelector('[data-response-json-viewer]');
    const annotation = () => viewer()?.querySelector('.response-json-description');
    const toggle = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!toggle) throw new Error('Missing schema description toggle');
    expect(toggle.checked).toBe(true);
    expect(viewer()?.querySelector('.cm-foldGutter')).not.toBeNull();
    expect(annotation()?.textContent).toBe('资源列表');

    await act(async () => toggle.click());
    expect(toggle.checked).toBe(false);
    expect(viewer()).not.toBeNull();
    expect(annotation()).toBeNull();

    await selectTab('raw');
    expect(view.container.querySelector('[role="tabpanel"]:not([hidden]) pre')?.textContent).toBe(response.rawText);
    await act(async () => button('apiDebug.response.copyRaw').click());
    expect(copyToClipboard).toHaveBeenLastCalledWith(response.rawText, expect.any(Function), expect.any(Function));
  });

  test.each([
    ['browser-session', '# apiDebug.cookie.sessionCurl\n'],
    ['explicit', ''],
    [undefined, ''],
  ] as const)('copies cURL using the restored response source %s', async (source, note) => {
    writeDebugSessionState(curlSessionKey, {
      response,
      error: null,
      builtRequest: {
        url: 'https://fixture.test/items',
        method: 'GET',
        headers: {},
        query: {},
        contentType: '',
      },
      builtRequestCookieSource: source,
      sseEvents: null,
    });
    const restored = readDebugSessionState(curlSessionKey);
    if (!restored) throw new Error('Missing restored debug response');

    await view.render(<ResponsePanel {...restored} />);
    await act(async () => button('apiDebug.response.copyCurl').click());
    expect(copyToClipboard).toHaveBeenCalledWith(
      `${note}curl -X GET \\\n  'https://fixture.test/items'`,
      expect.any(Function),
      expect.any(Function),
    );
  });

  test('keeps a successful response body, raw content, headers, and actions accessible beside diagnostics', async () => {
    await view.render(
      <ResponsePanel
        response={response}
        error={null}
        builtRequest={null}
        schemaDiagnostic={{
          status: 'invalid',
          issues: [
            {
              instanceLocation: '/items/0/id',
              keyword: 'type',
              absoluteKeywordLocation: '#/properties/items/items/properties/id/type',
            },
          ],
          totalIssues: 1,
        }}
      />,
    );

    const diagnostic = view.container.querySelector('[data-diagnostic-status="invalid-schema"]');
    expect(diagnostic?.textContent).toContain('$/items/0/id');
    expect(view.container.textContent).toContain('200 OK');
    expect(button('apiDebug.response.copyRaw').disabled).toBe(false);
    expect(button('apiDebug.response.copyCurl').disabled).toBe(true);
    expect(button('apiDebug.response.download').disabled).toBe(false);
    expect(Array.from(view.container.querySelectorAll('[role="tab"]'), (tab) => tab.textContent)).toEqual([
      'apiDebug.response.tab.content',
      'apiDebug.response.tab.raw',
      'apiDebug.response.tab.headers',
    ]);
    expect(view.container.querySelector('[data-response-json-viewer] .cm-content')?.textContent).toContain('"items"');
    await selectTab('raw');
    expect(view.container.querySelector('[role="tabpanel"]:not([hidden]) pre')?.textContent).toBe(response.rawText);
    await selectTab('headers');
    expect(
      Array.from(view.container.querySelectorAll('[role="tabpanel"]:not([hidden]) tbody tr'), (row) =>
        Array.from(row.querySelectorAll('td'), (cell) => cell.textContent),
      ),
    ).toEqual([
      ['content-type', 'application/json'],
      ['x-trace-id', 'trace-698'],
    ]);
  });

  test('renders OAS 3.2 sequential items with per-item and complete schema status', async () => {
    await view.render(
      <ResponsePanel
        response={{ ...response, contentType: 'application/jsonl', kind: 'text', rawText: '{"id":1}' }}
        error={null}
        builtRequest={null}
        sequentialStream={{
          kind: 'jsonl',
          streaming: false,
          termination: 'eof',
          truncated: false,
          receivedBytes: 20,
          droppedItems: 0,
          completeSchema: { status: 'valid' },
          items: [
            {
              index: 0,
              timestamp: 1,
              complete: true,
              preview: '{"id":1}',
              itemSchema: { status: 'valid' },
              diagnostics: [],
            },
            {
              index: 1,
              timestamp: 2,
              complete: true,
              preview: 'not-json',
              itemSchema: { status: 'skipped', reason: 'unavailable' },
              diagnostics: ['INVALID_JSON'],
            },
          ],
        }}
      />,
    );

    const panel = view.container.querySelector('[data-sequential-kind="jsonl"]');
    expect(panel?.getAttribute('data-sequential-termination')).toBe('eof');
    expect(panel?.textContent).toContain('apiDebug.sequential.complete.valid');
    expect(panel?.querySelector('[data-sequential-item="0"][data-item-schema="valid"]')).not.toBeNull();
    expect(panel?.querySelector('[data-sequential-item="1"][data-item-schema="skipped"]')?.textContent).toContain(
      'apiDebug.sequential.item.skipped',
    );
  });
});
