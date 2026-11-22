import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { collectOas32DocumentDiagnostics, type SchemaFieldNode } from 'knife4j-core';
import { parseMenuTags } from '../../api/knife4jClient';
import { ExternalResourceLoader } from '../../schema/externalResourceGraph';
import { createSchemaDocumentSession } from '../../schema/schemaDocumentSession';
import { createReactTestRoot } from '../../test/reactTestRoot';
import type { MenuOperation, MenuTag, SwaggerDoc } from '../../types/swagger';
import { schemaNodeTypeLabel } from '../../components/schema/schemaUtils';
import ApiDoc from './ApiDoc';

const state = vi.hoisted(() => ({
  document: null as unknown,
  operation: null as unknown,
  tags: [] as unknown[],
  engine: { status: 'inactive' } as Record<string, unknown>,
}));
// This suite exercises ApiDoc's projection effects and cell content.
vi.mock('antd', async (importOriginal) => {
  const { FixtureButton, FixtureTable, FixtureTabs } = await import('../../test/antdContentFixtures');
  return {
    ...(await importOriginal<typeof import('antd')>()),
    Alert: ({ title, description }: { title?: ReactNode; description?: ReactNode }) => (
      <div role="alert">
        {title}
        {description}
      </div>
    ),
    Badge: ({ text }: { text?: ReactNode }) => <span>{text}</span>,
    Button: FixtureButton,
    Space: ({ children }: { children?: ReactNode }) => <div data-space="">{children}</div>,
    Table: FixtureTable,
    Tabs: FixtureTabs,
    Tag: ({ children }: { children?: ReactNode }) => <span data-response-tag="">{children}</span>,
    Typography: {
      Title: ({ children }: { children?: ReactNode }) => <h4>{children}</h4>,
      Text: ({ children, strong, code }: { children?: ReactNode; strong?: boolean; code?: boolean }) =>
        strong ? <strong>{children}</strong> : code ? <code>{children}</code> : <span>{children}</span>,
      Paragraph: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    },
  };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../context/GroupContext', () => ({
  useGroup: () => ({ activeGroup: { value: 'fixture' }, menuTags: state.tags }),
}));
vi.mock('../../context/SettingsContext', () => ({ useSettings: () => ({ settings: { enableResponseCode: true } }) }));
vi.mock('../../context/SchemaEngineContext', () => ({ useSchemaEngine: () => state.engine }));
vi.mock('./CopyOperationMarkdown', () => ({ default: () => null }));
vi.mock('./useCurrentOperation', () => ({
  useCurrentOperation: () => ({ loading: false, swaggerDoc: state.document, operation: state.operation }),
  OperationModeLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('../../components/schema/SchemaFieldTable', () => ({
  default: ({ fields }: { fields: SchemaFieldNode[] }) => (
    <div data-schema-fields="">
      {fields.map((field) => (
        <span key={field.name} data-projected-field="">
          {schemaNodeTypeLabel(field)}
        </span>
      ))}
    </div>
  ),
  SchemaTypeLink: ({ node }: { node: SchemaFieldNode }) => (
    <span data-overview-type="">{schemaNodeTypeLabel(node)}</span>
  ),
}));

let view: ReturnType<typeof createReactTestRoot>;
beforeEach(() => {
  view = createReactTestRoot();
});
afterEach(async () => {
  await view.unmount();
  state.engine = { status: 'inactive' };
});

async function render(document: SwaggerDoc, tags?: MenuTag[]) {
  state.document = document;
  state.tags = tags ?? parseMenuTags(document, { retrievalUri: 'http://retrieved.test/specs/root.json' });
  state.operation = (state.tags as MenuTag[]).flatMap((tag) => tag.operations)[0] as MenuOperation;
  await view.render(
    <MemoryRouter>
      <ApiDoc />
    </MemoryRouter>,
  );
}

function responseSection(statusCode: string) {
  const tag = [...view.container.querySelectorAll('[data-response-tag]')].find(
    (node) => node.textContent === statusCode,
  );
  return tag?.closest('[data-space]')?.parentElement;
}

function responseSummary(statusCode: string) {
  return responseSection(statusCode)?.querySelector('strong')?.textContent;
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
    state.engine = { status: 'ready', document, retrievalUri, session };
    try {
      await render(document);
      expect(responseSection('200')?.querySelector('[data-projected-field]')?.textContent).toBe('string');
      expect(view.container.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await view.render(null);
      session.dispose();
    }
  });

  test.each(['3.0.3', '3.1.0', '3.2.0'])(
    'shows source response types in the overview instead of an internal reference name in OAS %s',
    async (openapi) => {
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
      await render(document);
      const labels = ['200', '201', '202', '203'].map(
        (status) => responseSection(status)?.querySelector('[data-overview-type]')?.textContent,
      );
      expect(labels).toEqual(['string', 'integer / int64', 'string[]', 'schema']);
    },
  );

  test.each(['3.0.3', '3.1.0', '3.2.0'])(
    'passes parameter Schema values into the description cell in OAS %s',
    async (openapi) => {
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
      await render(document);
      const description = view.container.querySelector('tbody tr[data-row-key] td:last-child');
      expect(description?.textContent).toContain('登录来源');
      expect(description?.textContent).toContain('schema.values.enum');
      expect(description?.textContent).toContain('schema.values.default');
      expect([...description!.querySelectorAll('code')].map((node) => node.textContent)).toEqual([
        '"mch_web"',
        '"mch_app"',
        '"mch_h5"',
        '"mch_web"',
      ]);
      expect(document).toEqual(original);
    },
  );

  test.each([
    ['object', { bad: true }],
    ['array', ['not a summary']],
    ['number', 42],
    ['boolean', true],
    ['null', null],
  ])('omits invalid %s summary without mutating its diagnostic or hiding valid responses', async (_name, summary) => {
    const document = fixture(summary);
    const original = structuredClone(document);
    const diagnostics = collectOas32DocumentDiagnostics(document);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-field-type', path: '#/paths/~1responses/get/responses/200/summary' }),
      ]),
    );
    await render(document);
    const summaries = ['200', '201', '202', '204'].map(responseSummary).filter(Boolean);
    expect(summaries).toEqual(['Valid summary']);
    expect(view.container.querySelector('h3, h4')?.textContent).toBe('Response metadata regression');
    expect(responseSection('201')?.textContent).toContain('Valid description');
    expect(view.container.textContent).not.toContain('Hidden target description');
    const emptyResponse = responseSection('204');
    expect(emptyResponse?.querySelector('[data-schema-fields]')).not.toBeNull();
    expect(emptyResponse?.querySelector('[role="alert"]')).toBeNull();
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
      await render(document, parseMenuTags(document, { retrievalUri: entryUri, resourceSnapshot: snapshot }));
      const summaries = ['200', '202', '204'].map(responseSummary).filter(Boolean);
      expect(summaries).toEqual(['Outer summary']);
      expect(view.container.textContent).not.toContain('Hidden external description');
      expect(view.container.querySelector('[role="alert"]')).toBeNull();
    } finally {
      loader.dispose();
    }
  });
});
