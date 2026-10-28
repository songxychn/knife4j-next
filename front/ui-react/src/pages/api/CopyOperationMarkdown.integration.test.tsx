import { act, useEffect, useMemo } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildExportDocument, renderExportOperationMarkdown } from 'knife4j-core';
import * as oas31Snapshot from '../document/oas31ExportSnapshot';
import { createOfflineDocumentSnapshot, type OfflineDocumentSnapshot } from '../document/offlineDocumentSnapshot';
import type { ExternalResourceContextValue, SchemaEngineContextValue } from '../../context/SchemaEngineContext';
import { parseMenuTags } from '../../api/knife4jClient';
import { createSchemaDocumentSession, type SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import {
  ExternalResourceLoader,
  schemaDocumentsFromResourceGraph,
  schemaRegistrationContextFromResourceGraph,
} from '../../schema/externalResourceGraph';
import type { SwaggerDoc } from '../../types/swagger';
import { useDocumentExport } from '../document/useDocumentExport';
import CopyOperationMarkdown from './CopyOperationMarkdown';

const state = vi.hoisted(() => ({
  engine: { status: 'inactive', retrievalUri: null, session: null, error: null } as SchemaEngineContextValue,
  resources: {
    status: 'inactive',
    snapshot: null,
    documentScope: null,
    registrationError: null,
  } as ExternalResourceContextValue,
  confirm: vi.fn(),
  write: vi.fn<(text: string) => Promise<void>>(async () => undefined),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('../../context/SchemaEngineContext', () => ({
  useSchemaEngine: () => state.engine,
  useExternalResources: () => state.resources,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ja-JP' } }) }));
vi.mock('@ant-design/icons', () => ({ CopyOutlined: () => null }));
vi.mock('antd', () => ({
  Button: ({ children, onClick, loading }: { children: React.ReactNode; onClick: () => void; loading: boolean }) => (
    <button disabled={loading} onClick={onClick}>
      {children}
    </button>
  ),
  Typography: { Paragraph: 'p' },
  Modal: { confirm: state.confirm },
  message: { success: state.success, error: state.error },
}));

const URI = 'https://docs.example.test/openapi.json';
let container: HTMLDivElement;
let root: Root;
const sessions: SchemaDocumentSession[] = [];
const loaders: ExternalResourceLoader[] = [];
let expected = '';

function fixture(openapi: string): SwaggerDoc {
  return {
    openapi,
    info: { title: 'DOCUMENT_COVER', version: '1' },
    servers: [{ url: 'https://api.example.test' }],
    security: [{ Token: [] }],
    components: {
      schemas: {
        Node: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'generated-name' },
            children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
          },
        },
      },
      securitySchemes: { Token: { type: 'http', scheme: 'bearer' } },
    },
    paths: {
      '/nodes': {
        post: {
          summary: 'Create node',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Node' },
                example: { name: 'explicit-request' },
              },
            },
          },
          responses: {
            200: {
              description: 'Result',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Node' },
                  example: { name: 'explicit-response' },
                },
              },
            },
            400: {
              description: 'Generated error',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { reason: { type: 'string', example: 'generated-reason' } } },
                },
              },
            },
            204: { description: 'No body' },
          },
        },
      },
      '/other': { get: { summary: 'OTHER_OPERATION', responses: { 204: { description: 'No body' } } } },
    },
  };
}

function menu(document: SwaggerDoc) {
  return parseMenuTags(document, { retrievalUri: URI, resourceSnapshot: state.resources.snapshot ?? undefined });
}

// Build all operations through OfficeDoc's shared entry point. The clipboard
// must equal the selected operation rendered from this complete snapshot.
function FullExportExpectation({ document }: { document: SwaggerDoc }) {
  const tags = useMemo(() => menu(document), [document]);
  const { exportIdentity, labels, snapshotForDownload } = useDocumentExport(document, tags);
  useEffect(() => {
    const controller = new AbortController();
    void snapshotForDownload(controller.signal)
      .then((snapshot) => {
        if (!controller.signal.aborted)
          expected = renderExportOperationMarkdown(snapshot.document.tags[0].operations[0], {
            labels: labels.markdown,
            headingLevel: 1,
          });
      })
      .catch((error) => {
        if (!controller.signal.aborted) throw error;
      });
    return () => controller.abort();
  }, [exportIdentity, snapshotForDownload, labels.markdown]);
  return null;
}

async function open(document: SwaggerDoc) {
  const loader = new ExternalResourceLoader(document, URI, {
    pageUri: 'https://docs.example.test/doc.html',
    fetchImpl: vi.fn(async () => {
      throw new Error('No network allowed');
    }),
  });
  loaders.push(loader);
  const snapshot = loader.currentSnapshot();
  const session = await createSchemaDocumentSession(document, URI, {
    registrationContext: schemaRegistrationContextFromResourceGraph(snapshot, URI),
    resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
  });
  sessions.push(session);
  state.engine = { status: 'ready', retrievalUri: URI, document, session, error: null };
  state.resources = { ...state.resources, status: 'ready', snapshot, documentScope: snapshot.documentScope };
}
async function render(document: SwaggerDoc, operation = menu(document)[0].operations[0]) {
  await act(async () => {
    root.render(
      <>
        <CopyOperationMarkdown document={document} operation={operation} />
        <FullExportExpectation document={document} />
      </>,
    );
  });
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('button')?.disabled).toBe(false);
  });
}
async function click() {
  await act(async () => container.querySelector('button')!.click());
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  expected = '';
  state.engine = { status: 'inactive', retrievalUri: null, session: null, error: null };
  state.resources = {
    ...state.resources,
    status: 'inactive',
    snapshot: null,
    documentScope: null,
    registrationError: null,
  };
  state.confirm.mockReturnValue({ destroy: vi.fn() });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: state.write } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  sessions.splice(0).forEach((s) => s.dispose());
  loaders.splice(0).forEach((l) => l.dispose());
});

describe('single-operation Markdown copy', () => {
  test.each(['3.0.3', '3.1.1', '3.2.0'])(
    '%s matches the complete export operation including structure, examples and metadata',
    async (version) => {
      const doc = fixture(version);
      if (version !== '3.0.3') await open(doc);
      await render(doc);
      await click();
      expect(state.confirm).not.toHaveBeenCalled();
      expect(state.write).toHaveBeenCalledWith(expected);
      const text = state.write.mock.calls[0][0];
      for (const marker of [
        'children',
        'explicit-request',
        'explicit-response',
        'generated-reason',
        '204',
        'apiDoc.tab.requestExample',
        'apiDoc.tab.responseExample',
      ])
        expect(text).toContain(marker);
      if (version === '3.2.0') {
        expect(text).toContain('api.example.test');
        expect(text).toContain('Token');
      }
      expect(text).not.toContain('DOCUMENT_COVER');
      expect(text).not.toContain('OTHER_OPERATION');
      expect(text).not.toContain('apiDoc.tab.responseExample `204`');
      expect(text.startsWith('# Create node')).toBe(true);
    },
  );

  test('writes a prepared complete snapshot during the click without an asynchronous activation gap', async () => {
    await render(fixture('3.0.3'));
    await act(() => {
      container.querySelector('button')!.click();
      expect(state.write).toHaveBeenCalledOnce();
    });
  });

  test('late projection results cannot replace a newer operation', async () => {
    const doc = fixture('3.1.1');
    await open(doc);
    let resolve!: (snapshot: OfflineDocumentSnapshot) => void;
    const pending = new Promise<OfflineDocumentSnapshot>((done) => {
      resolve = done;
    });
    const build = vi.spyOn(oas31Snapshot, 'buildOas31ExportSnapshot').mockReturnValueOnce(pending);
    const operations = menu(doc).flatMap((tag) => tag.operations);
    await act(async () => root.render(<CopyOperationMarkdown document={doc} operation={operations[0]} />));
    expect(container.querySelector('button')!.disabled).toBe(true);
    const signal = build.mock.calls[0][3]!.signal!;
    await render(
      doc,
      operations.find((operation) => operation.path === '/other')!,
    );
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(createOfflineDocumentSnapshot(buildExportDocument(doc, menu(doc)))));
    await click();
    expect(state.write.mock.calls[0][0]).toContain('OTHER_OPERATION');
    expect(state.write.mock.calls[0][0]).not.toContain('explicit-response');
  });

  test('incomplete snapshots require confirmation, carry a warning and allow cancellation', async () => {
    const doc = fixture('3.1.1');
    await render(doc);
    await click();
    expect(state.write).not.toHaveBeenCalled();
    const modal = state.confirm.mock.calls[0][0];
    await act(async () => modal.onCancel());
    expect(state.write).not.toHaveBeenCalled();
    await click();
    await act(async () => state.confirm.mock.calls[1][0].onOk());
    expect(state.write.mock.calls[0][0]).toContain('SCHEMA_SESSION_UNAVAILABLE');
    expect(state.write.mock.calls[0][0]).toContain('officeDoc.snapshot.incomplete.documentTitle');
  });

  test('switching operations cancels a pending confirmation and never copies the previous operation', async () => {
    const doc = fixture('3.1.1');
    const tags = menu(doc);
    await render(doc, tags[0].operations[0]);
    await click();
    const oldModal = state.confirm.mock.calls[0][0];
    const destroy = state.confirm.mock.results[0].value.destroy;
    await render(
      doc,
      tags.flatMap((t) => t.operations).find((o) => o.path === '/other')!,
    );
    expect(destroy).toHaveBeenCalled();
    await act(async () => oldModal.onOk());
    expect(state.write).not.toHaveBeenCalled();
    await click();
    await act(async () => state.confirm.mock.calls[1][0].onOk());
    expect(state.write.mock.calls[0][0]).toContain('OTHER_OPERATION');
    expect(state.write.mock.calls[0][0]).not.toContain('explicit-response');
  });
});
