import { describe, expect, test, vi } from 'vitest';

vi.mock('react', () => ({
  default: {},
  useEffect: () => undefined,
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(initial: T) => ({ current: initial }),
  useState: <T,>(initial: T) => [initial, vi.fn()],
}));

const { jsxFactory } = vi.hoisted(() => ({
  jsxFactory: (type: unknown, props: Record<string, unknown> | null, key?: unknown) => ({
    type,
    props: props ?? {},
    key,
  }),
}));

vi.mock('react/jsx-runtime', () => ({
  jsx: jsxFactory,
  jsxs: jsxFactory,
  jsxDEV: jsxFactory,
  Fragment: 'Fragment',
}));
vi.mock('react/jsx-dev-runtime', () => ({ jsxDEV: jsxFactory, Fragment: 'Fragment' }));

vi.mock('antd', () => ({
  Alert: 'Alert',
  Button: 'Button',
  Checkbox: 'Checkbox',
  Space: 'Space',
  Table: 'Table',
  Tabs: 'Tabs',
  Tag: 'Tag',
  Tooltip: 'Tooltip',
  Typography: { Text: 'Text' },
  message: { error: vi.fn(), success: vi.fn() },
}));
vi.mock('@ant-design/icons', () => ({
  CopyOutlined: 'CopyOutlined',
  DownloadOutlined: 'DownloadOutlined',
  StopOutlined: 'StopOutlined',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
  }),
}));
vi.mock('knife4j-core', () => ({ buildCurl: vi.fn(() => 'curl fixture') }));
vi.mock('./CodeBlock', () => ({ default: 'CodeBlock' }));
vi.mock('../../utils/clipboard', () => ({ copyToClipboard: vi.fn() }));

import ResponsePanel, { ResponseSchemaDiagnosticAlert } from './ResponsePanel';
import type { DebugResponsePayload } from './ResponsePanel';
import { copyToClipboard } from '../../utils/clipboard';
import { readDebugSessionState, removeDebugSessionState, writeDebugSessionState } from './debugSessionState';
import type { CookieParameterSource } from './cookieParameterSource';

interface TestElement {
  readonly type: unknown;
  readonly props: Record<string, unknown>;
}

function isElement(value: unknown): value is TestElement {
  return value !== null && typeof value === 'object' && 'type' in value && 'props' in value;
}

function findElement(value: unknown, predicate: (element: TestElement) => boolean): TestElement | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return null;
  }
  if (!isElement(value)) return null;
  if (predicate(value)) return value;
  for (const child of Object.values(value.props)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function findElements(value: unknown, predicate: (element: TestElement) => boolean): TestElement[] {
  if (Array.isArray(value)) return value.flatMap((child) => findElements(child, predicate));
  if (!isElement(value)) return [];
  return [
    ...(predicate(value) ? [value] : []),
    ...Object.values(value.props).flatMap((child) => findElements(child, predicate)),
  ];
}

describe('ResponseSchemaDiagnosticAlert', () => {
  test('renders bounded instance paths and marks schema mismatches as non-blocking warnings', () => {
    const tree = ResponseSchemaDiagnosticAlert({
      diagnostic: {
        status: 'invalid',
        issues: [
          {
            instanceLocation: '/profile/name',
            keyword: 'type',
            absoluteKeywordLocation: 'https://schemas.example.test/profile#/properties/name/type',
          },
        ],
        totalIssues: 3,
      },
    }) as unknown as TestElement;

    expect(tree.props.id).toBe('knife4j-response-schema-diagnostics');
    expect(tree.props['data-diagnostic-status']).toBe('invalid-schema');
    const alert = findElement(tree, (element) => element.type === 'Alert');
    expect(alert?.props.type).toBe('warning');
    expect(
      findElement(tree, (element) => element.type === 'Text' && element.props.children === '$/profile/name'),
    ).not.toBeNull();
    expect(
      findElement(
        tree,
        (element) =>
          element.type === 'Text' &&
          element.props.children === 'apiDebug.responseSchemaValidation.moreIssues:{"count":2}',
      ),
    ).not.toBeNull();
  });

  test('surfaces inactive engines without turning diagnostics into a response error', () => {
    const tree = ResponseSchemaDiagnosticAlert({
      diagnostic: { status: 'unavailable', reason: 'engine-inactive' },
    }) as unknown as TestElement;

    expect(tree.props['data-diagnostic-status']).toBe('unavailable');
    const alert = findElement(tree, (element) => element.type === 'Alert');
    expect(alert?.props.type).toBe('info');
    expect(alert?.props.message).toBe('apiDebug.responseSchemaValidation.unavailableTitle');
  });
});

describe('ResponsePanel diagnostic integration', () => {
  test.each([
    ['browser-session', '# apiDebug.cookie.sessionCurl\ncurl fixture'],
    ['explicit', 'curl fixture'],
    [undefined, 'curl fixture'],
  ] as const)('copies cURL using the restored response source %s', (source, expectedCurl) => {
    vi.mocked(copyToClipboard).mockClear();
    const key = 'response-curl-source';
    const builtRequestCookieSource: CookieParameterSource | undefined = source;
    writeDebugSessionState(key, {
      response: {
        status: 200,
        statusText: 'OK',
        method: 'GET',
        duration: 12,
        contentType: 'application/json',
        size: 2,
        headers: {},
        rawText: '{}',
        kind: 'json',
      },
      error: null,
      builtRequest: {
        url: 'https://fixture.test/protected',
        method: 'GET',
        headers: {},
        query: {},
        contentType: '',
      },
      builtRequestCookieSource,
      sseEvents: null,
    });
    const restored = readDebugSessionState(key)!;
    const tree = ResponsePanel(restored) as unknown as TestElement;
    const copyButton = findElement(
      tree,
      (element) => element.type === 'Button' && element.props.children === 'apiDebug.response.copyCurl',
    );
    expect(copyButton).not.toBeNull();
    (copyButton!.props.onClick as () => void)();
    expect(copyToClipboard).toHaveBeenCalledWith(expectedCurl, expect.any(Function), expect.any(Function));
    removeDebugSessionState(key);
  });

  test('keeps a successful response body, raw content, headers, and actions accessible beside diagnostics', () => {
    const response: DebugResponsePayload = {
      status: 200,
      statusText: 'OK',
      method: 'GET',
      duration: 12,
      contentType: 'application/json',
      size: 21,
      headers: { 'content-type': 'application/json', 'x-trace-id': 'trace-698' },
      rawText: '{"profile":{"name":1}}',
      kind: 'json',
    };
    const diagnostic = {
      status: 'invalid' as const,
      issues: [
        {
          instanceLocation: '/profile/name',
          keyword: 'type',
          absoluteKeywordLocation: '#/properties/profile/properties/name/type',
        },
      ],
      totalIssues: 1,
    };
    const tree = ResponsePanel({
      response,
      error: null,
      builtRequest: null,
      schemaDiagnostic: diagnostic,
    }) as unknown as TestElement;

    const diagnosticElement = findElement(tree, (element) => element.type === ResponseSchemaDiagnosticAlert);
    expect(diagnosticElement?.props.diagnostic).toBe(diagnostic);

    const statusTag = findElement(
      tree,
      (element) =>
        element.type === 'Tag' && Array.isArray(element.props.children) && element.props.children.includes(200),
    );
    expect(statusTag?.props.children).toEqual([200, ' ', 'OK']);

    const actionLabels = findElements(tree, (element) => element.type === 'Button').map(
      (element) => element.props.children,
    );
    expect(actionLabels).toEqual(
      expect.arrayContaining(['apiDebug.response.copyRaw', 'apiDebug.response.copyCurl', 'apiDebug.response.download']),
    );

    const tabs = findElement(tree, (element) => element.type === 'Tabs');
    const items = tabs?.props.items as Array<{ key: string; children: unknown }>;
    expect(items.map((item) => item.key)).toEqual(['content', 'raw', 'headers']);
    expect((items[0].children as TestElement).props.response).toBe(response);
    expect((items[1].children as TestElement).props.children).toBe(response.rawText);

    const headersTable = findElement(items[2].children, (element) => element.type === 'Table');
    expect(headersTable?.props.dataSource).toEqual([
      { key: 'content-type', name: 'content-type', value: 'application/json' },
      { key: 'x-trace-id', name: 'x-trace-id', value: 'trace-698' },
    ]);
    expect(response).toMatchObject({ status: 200, statusText: 'OK', rawText: '{"profile":{"name":1}}' });
  });
});
