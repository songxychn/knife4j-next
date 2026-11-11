import { describe, expect, test, vi } from 'vitest';
import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import type { MenuOperation, MenuTag, SwaggerDoc } from '../../types/swagger';

const state = vi.hoisted(() => ({
  document: null as unknown,
  operation: null as unknown,
  tags: [] as unknown[],
  engine: null as unknown,
  effects: null as Array<() => void | (() => void)> | null,
  updates: [] as unknown[],
  jsx: (type: unknown, props: Record<string, unknown> | null, key?: unknown) => ({ type, props: props ?? {}, key }),
}));
vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => state.effects?.push(effect),
  useMemo: <T,>(factory: () => T) => factory(),
  useState: <T,>(initial: T) => [initial, (value: T) => state.updates.push(value)],
}));
vi.mock('react/jsx-runtime', () => ({ jsx: state.jsx, jsxs: state.jsx, jsxDEV: state.jsx, Fragment: 'Fragment' }));
vi.mock('react/jsx-dev-runtime', () => ({ jsxDEV: state.jsx, Fragment: 'Fragment' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('antd', () => ({
  Alert: 'Alert',
  Badge: 'Badge',
  Button: 'Button',
  Space: 'Space',
  Spin: 'Spin',
  Table: 'Table',
  Tabs: 'Tabs',
  Tag: 'Tag',
  Typography: { Title: 'Title', Text: 'Text' },
  message: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@ant-design/icons', () => ({ CopyOutlined: 'CopyOutlined' }));
vi.mock('../../context/GroupContext', () => ({
  useGroup: () => ({ activeGroup: { value: 'fixture' }, menuTags: state.tags }),
}));
vi.mock('../../context/SettingsContext', () => ({ useSettings: () => ({ settings: { enableResponseCode: true } }) }));
vi.mock('../../context/SchemaEngineContext', () => ({ useSchemaEngine: () => state.engine ?? { status: 'inactive' } }));
vi.mock('./useCurrentOperation', () => ({
  useCurrentOperation: () => ({ loading: false, swaggerDoc: state.document, operation: state.operation }),
  OperationModeLayout: 'OperationModeLayout',
}));
vi.mock('../../components/DescriptionText', () => ({ default: 'DescriptionText' }));
vi.mock('../../components/Markdown', () => ({ default: 'Markdown' }));
vi.mock('../../components/schema/SchemaFieldTable', () => ({
  default: 'SchemaFieldTable',
  SchemaTypeLink: 'SchemaTypeLink',
}));
vi.mock('../../components/schema/SchemaExampleNotice', () => ({ default: 'SchemaExampleNotice' }));
vi.mock('../../components/schema/OperationExamplePicker', () => ({ default: 'OperationExamplePicker' }));
vi.mock('../../components/schema/SchemaDiscriminatorPanel', () => ({ default: 'SchemaDiscriminatorPanel' }));
vi.mock('./CodeBlock', () => ({ default: 'CodeBlock' }));

import ApiDoc from './ApiDoc';
import { parseMenuTags } from '../../api/knife4jClient';
import { ExternalResourceLoader } from '../../schema/externalResourceGraph';
import SchemaValueDetails from '../../components/schema/SchemaValueDetails';
import { schemaNodeTypeLabel } from '../../components/schema/schemaUtils';
import { createSchemaDocumentSession } from '../../schema/schemaDocumentSession';
import type { ApiDocSchemaProjectionState } from './apiDocSchemaViewState';

interface Element {
  type: unknown;
  props: Record<string, unknown>;
  key?: unknown;
}

function elements(value: unknown): Element[] {
  if (!value || typeof value !== 'object') return [];
  return [
    ...('type' in value && 'props' in value ? [value as Element] : []),
    ...Object.values(value).flatMap(elements),
  ];
}

function render(document: SwaggerDoc, tags?: MenuTag[]): Element[] {
  state.document = document;
  state.tags = tags ?? parseMenuTags(document, { retrievalUri: 'http://retrieved.test/specs/root.json' });
  state.operation = (state.tags as MenuTag[]).flatMap((tag) => tag.operations)[0] as MenuOperation;
  const wrapper = ApiDoc() as unknown as Element;
  return elements((wrapper.type as (props: Record<string, unknown>) => unknown)(wrapper.props));
}

function fixture(summary: unknown): SwaggerDoc {
  return {
    openapi: '3.2.99',
    info: { title: 'Invalid metadata fixture', version: '1' },
    paths: {
      '/responses': {
        get: {
          summary: 'Response metadata regression',
          responses: {
            '200': { summary },
            '201': { summary: 'Valid summary', description: 'Valid description' },
            '202': { $ref: '#/components/responses/Target', summary: '', description: '' },
            '204': {},
          },
        },
      },
    },
    components: {
      responses: { Target: { summary: 'Hidden target summary', description: 'Hidden target description' } },
    },
  } as unknown as SwaggerDoc;
}

describe('ApiDoc Response metadata rendering', () => {
  test('uses physical response locations in the actual ApiDoc projection effect', async () => {
    const document: SwaggerDoc = {
      openapi: '3.1.0',
      info: { title: 'String response', version: '1' },
      paths: {
        '/responses': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: { '*/*': { schema: { type: 'string', example: '0' } } },
              },
            },
          },
        },
      },
    };
    const retrievalUri = 'http://retrieved.test/specs/root.json';
    const session = await createSchemaDocumentSession(document, retrievalUri);
    const cleanups: Array<void | (() => void)> = [];
    state.engine = { status: 'ready', document, retrievalUri, session };
    state.effects = [];
    state.updates = [];
    try {
      render(document);
      state.effects.forEach((effect) => cleanups.push(effect()));
      await vi.waitFor(() => {
        const result = (state.updates as ApiDocSchemaProjectionState[]).find(
          (update) => update.status === 'ready' && 'result' in update,
        );
        expect(result?.status).toBe('ready');
        if (result?.status !== 'ready') return;
        expect(result.result.failures).toEqual([]);
        expect(result.result.regions[0].fields.map(schemaNodeTypeLabel)).toEqual(['string']);
      });
    } finally {
      cleanups.forEach((cleanup) => cleanup?.());
      state.effects = null;
      state.engine = null;
      state.updates = [];
      session.dispose();
    }
  });

  test.each(['3.0.3', '3.1.0', '3.2.0'])(
    'shows source response types in the overview instead of an internal reference name in OAS %s',
    (openapi) => {
      const document: SwaggerDoc = {
        openapi,
        info: { title: 'Response types', version: '1' },
        paths: {
          '/responses': {
            get: {
              responses: {
                '200': { description: 'String', content: { '*/*': { schema: { type: 'string', example: '0' } } } },
                '201': {
                  description: 'Integer',
                  content: { 'application/json': { schema: { type: 'integer', format: 'int64' } } },
                },
                '202': {
                  description: 'Array',
                  content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
                },
                '203': {
                  description: 'Model named schema',
                  content: { 'application/json': { schema: { $ref: '#/components/schemas/schema' } } },
                },
              },
            },
          },
        },
        components: { schemas: { schema: { type: 'object', properties: { id: { type: 'integer' } } } } },
      };
      const tree = render(document);
      const labels = ['200', '201', '202', '203'].flatMap((status) =>
        elements(tree.find((element) => element.type === 'div' && element.key === status))
          .filter((element) => element.type === 'SchemaTypeLink')
          .map((element) => schemaNodeTypeLabel(element.props.node as never)),
      );
      expect(labels).toEqual(['string', 'integer / int64', 'string[]', 'schema']);
    },
  );

  test.each(['3.0.3', '3.1.0', '3.2.0'])(
    'passes parameter Schema values into the description cell in OAS %s',
    (openapi) => {
      const document: SwaggerDoc = {
        openapi,
        info: { title: 'Parameter values', version: '1' },
        paths: {
          '/login': {
            get: {
              parameters: [
                {
                  name: 'from',
                  in: 'query',
                  description: '登录来源',
                  schema: {
                    type: 'string',
                    enum: ['mch_web', 'mch_app', 'mch_h5'],
                    default: 'mch_web',
                    example: 'mch_app',
                  },
                },
              ],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
      };
      const original = structuredClone(document);
      const table = render(document).find((element) => element.type === 'Table')!;
      const row = (table.props.dataSource as { description: string }[])[0];
      const column = (
        table.props.columns as { dataIndex?: string; render: (value: string, row: unknown) => unknown }[]
      ).find((item) => item.dataIndex === 'description')!;
      const cell = elements(column.render(row.description, row));
      expect(cell.find((element) => element.type === 'DescriptionText')?.props.children).toBe('登录来源');
      expect(cell.find((element) => element.type === SchemaValueDetails)?.props).toEqual({
        enum: ['mch_web', 'mch_app', 'mch_h5'],
        default: 'mch_web',
      });
      expect(document).toEqual(original);
    },
  );

  test.each([
    ['object', { bad: true }],
    ['array', ['not a summary']],
    ['number', 42],
    ['boolean', true],
    ['null', null],
  ])('omits invalid %s summary without mutating its diagnostic or hiding valid responses', (_name, summary) => {
    const document = fixture(summary);
    const original = structuredClone(document);
    const diagnostics = collectOas32DocumentDiagnostics(document);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-field-type', path: '#/paths/~1responses/get/responses/200/summary' }),
      ]),
    );
    const tree = render(document);
    const strongChildren = tree
      .filter((element) => element.type === 'Text' && element.props.strong)
      .map((element) => element.props.children);
    expect(strongChildren).toEqual(['Valid summary']);
    expect(
      tree.some((element) => element.type === 'Title' && element.props.children === 'Response metadata regression'),
    ).toBe(true);
    expect(
      tree.some((element) => element.type === 'DescriptionText' && element.props.children === 'Valid description'),
    ).toBe(true);
    expect(
      tree.some(
        (element) => element.type === 'DescriptionText' && element.props.children === 'Hidden target description',
      ),
    ).toBe(false);
    const emptyResponse = tree.find((element) => element.type === 'div' && element.key === '204');
    expect(elements(emptyResponse).some((element) => element.type === 'SchemaFieldTable')).toBe(true);
    expect(elements(emptyResponse).some((element) => element.type === 'Alert')).toBe(false);
    expect(document).toEqual(original);
    expect(collectOas32DocumentDiagnostics(document)).toEqual(diagnostics);
  });

  test('retains external string metadata and an outer empty summary override in the actual response pane', async () => {
    const entryUri = 'http://retrieved.test/specs/root.json';
    const ownerUri = 'http://retrieved.test/owners/responses.json';
    const document: SwaggerDoc = {
      openapi: '3.2.0',
      info: { title: 'External response', version: '1' },
      paths: {
        '/responses': {
          get: {
            responses: {
              '200': { $ref: `${ownerUri}#/components/responses/Target`, summary: 'Outer summary', description: '' },
              '202': { $ref: `${ownerUri}#/components/responses/Target`, summary: '', description: '' },
              '204': {},
            },
          },
        },
      },
    };
    const library = {
      openapi: '3.2.0',
      info: { title: 'Owner', version: '1' },
      components: {
        responses: {
          Target: { summary: 'Hidden external summary', description: 'Hidden external description' },
        },
      },
    };
    const loader = new ExternalResourceLoader(document, entryUri, {
      fetchImpl: vi.fn(
        async () => new Response(JSON.stringify(library), { headers: { 'Content-Type': 'application/json' } }),
      ),
    });
    try {
      const snapshot = await loader.load(
        loader.discover().candidates.map((candidate) => ({
          documentScope: loader.documentScope,
          resourceKey: candidate.retrievalUriHash,
          scope: 'generation',
        })),
      );
      const tree = render(document, parseMenuTags(document, { retrievalUri: entryUri, resourceSnapshot: snapshot }));
      expect(
        tree
          .filter((element) => element.type === 'Text' && element.props.strong)
          .map((element) => element.props.children),
      ).toEqual(['Outer summary']);
      expect(tree.some((element) => element.type === 'DescriptionText')).toBe(false);
      expect(tree.some((element) => element.type === 'Alert')).toBe(false);
    } finally {
      loader.dispose();
    }
  });
});
