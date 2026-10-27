import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { parseMenuTags } from '../api/knife4jClient';
import * as localSession from '../schema/schemaDocumentSession';
import { createWorkerSchemaDocumentSession } from '../schema/schemaDocumentWorkerClient';
import { unavailableOperationSchemaExamples } from '../schema/operationSchemaExamples';
import type { SwaggerDoc } from '../types/swagger';
import { SchemaEngineProvider, useSchemaEngine, type SchemaEngineContextValue } from './SchemaEngineContext';

const state = vi.hoisted(() => ({ group: {} as Record<string, unknown> }));
vi.mock('./GroupContext', () => ({ useGroup: () => state.group }));
vi.mock('../schema/schemaDocumentWorkerClient', () => ({ createWorkerSchemaDocumentSession: vi.fn() }));

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let current: SchemaEngineContextValue | undefined;

function Probe() {
  current = useSchemaEngine();
  return null;
}

const retrievalUri = 'https://docs.knife4j.test/service/v3/api-docs';
function fixture(): SwaggerDoc {
  const media = { schema: { $ref: '#/components/schemas/Value' }, example: { id: 'authored' } };
  return {
    openapi: '3.2.0',
    info: { title: 'Worker provider', version: '1' },
    paths: {
      '/value': {
        post: {
          requestBody: { content: { 'application/json': media } },
          responses: { '200': { description: 'ok', content: { 'application/json': media } } },
        },
      },
    },
    components: { schemas: { Value: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  };
}

async function mount(document: SwaggerDoc) {
  state.group = {
    swaggerDoc: document,
    loading: false,
    routeGroupReady: true,
    activeSwaggerGroup: { name: 'worker', url: retrievalUri },
    setOperationResourceSnapshot: vi.fn(),
  };
  host = globalThis.document.createElement('div');
  globalThis.document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <SchemaEngineProvider>
        <Probe />
      </SchemaEngineProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  current = undefined;
  vi.restoreAllMocks();
  vi.mocked(createWorkerSchemaDocumentSession).mockReset();
});

test('uses the Worker factory with the original retrieval URI and typed resource registration', async () => {
  const session = { retrievalUri, resolve: vi.fn(), evaluate: vi.fn(), dispose: vi.fn() };
  vi.mocked(createWorkerSchemaDocumentSession).mockResolvedValue(session);
  const document = fixture();
  await mount(document);
  expect(current).toMatchObject({ status: 'ready', retrievalUri, document, session });
  expect(createWorkerSchemaDocumentSession).toHaveBeenCalledWith(
    document,
    retrievalUri,
    expect.objectContaining({
      signal: expect.any(AbortSignal),
      resourceDocuments: [],
      registrationContext: expect.objectContaining({ openapi32: true, documentBaseUri: retrievalUri }),
    }),
  );
});

test('CSP/start failure stays diagnostic and retains authored media examples without a synchronous engine fallback', async () => {
  const error = Object.assign(new Error("Schema Worker could not start: CSP worker-src 'self' is required."), {
    name: 'SchemaExampleWorkerUnavailableError',
  });
  vi.mocked(createWorkerSchemaDocumentSession).mockRejectedValue(error);
  const local = vi.spyOn(localSession, 'createSchemaDocumentSession');
  const document = fixture();
  await mount(document);
  expect(current).toMatchObject({ status: 'error', error: { message: error.message } });
  expect(local).not.toHaveBeenCalled();
  const operation = parseMenuTags(document, { retrievalUri })[0].operations[0];
  const fallback = unavailableOperationSchemaExamples(document, operation, error.message);
  for (const result of [fallback.request?.result, fallback.responses[0].result]) {
    expect(result).toMatchObject({
      status: 'value',
      value: { id: 'authored' },
      authored: true,
      validation: 'unavailable',
      diagnostics: [{ code: 'EVALUATION_UNAVAILABLE', message: error.message }],
    });
  }
});
