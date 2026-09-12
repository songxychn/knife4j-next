import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  buildOperationDebugModel,
  buildRequest,
  collectOas31DocumentDiagnostics,
  collectOas32DocumentDiagnostics,
  getOpenApiSpecificationFeatures,
  getOpenApiStandardHttpMethods,
  isOpenApi31Version,
} from 'knife4j-core';
import { OPENAPI_31_BASE_DIALECT, OPENAPI_32_DIALECT } from 'knife4j-schema-engine';
import { isOpenApi3Document, parseMenuTags } from '../api/knife4jClient';
import {
  OAS31_API_CHANGE_SNAPSHOT_VERSION,
  OAS32_API_CHANGE_SNAPSHOT_VERSION,
  apiOperationIdentity,
  buildApiChangeBaselineStorageKey,
  buildApiChangeFingerprintSnapshot,
  type ApiDocumentIdentity,
  type Oas31ApiChangeEnvironment,
} from '../apiChange/apiChangeTracker';
import { inspectUnsentBrowserSendFailure } from '../pages/api/apiDebugBrowserSend';
import { browserRequestConstraint } from '../pages/api/browserRequestConstraints';
import { collectResolvedOas32ParameterInputs } from '../pages/api/oas32ParameterForm';
import { visibleOperationModeKeys } from '../pages/api/operationRouting';
import { buildOas32ExportSnapshot } from '../pages/document/oas32ExportSnapshot';
import type { SwaggerDoc } from '../types/swagger';
import { ExternalResourceLoader } from './externalResourceGraph';
import {
  classifyOas32SequentialMedia,
  decodeOas32SequentialBytes,
  isOas32SequentialVersion,
} from './oas32SequentialMedia';
import { oas32TagMenu } from './oas32TagMenu';
import {
  createSchemaDocumentSession,
  isSchemaEngineDocument,
  type SchemaDocumentSession,
} from './schemaDocumentSession';
import hostAcceptanceDocument from '../test-fixtures/oas32-normative/host-acceptance-3.2.0.json';
import boot3MvcSpringdocDocument from '../test-fixtures/springdoc-oas31/boot3-mvc-springdoc-2.8.9.json';
import boot4MvcSpringdocDocument from '../test-fixtures/springdoc-oas31/boot4-mvc-springdoc-3.0.3.json';

const ENTRY_URI = 'https://docs.knife4j.example/v3/api-docs?matrix=oas32-host';
const DENIED_SCHEMA = 'https://unapproved.knife4j.example/schema.json';
const sessions: SchemaDocumentSession[] = [];
const hostDocument = hostAcceptanceDocument as unknown as SwaggerDoc;
const springdocDocument = boot3MvcSpringdocDocument as unknown as SwaggerDoc;
const boot4SpringdocDocument = boot4MvcSpringdocDocument as unknown as SwaggerDoc;
const trackingIdentity: ApiDocumentIdentity = {
  origin: 'https://docs.example.test',
  applicationPath: '/doc.html',
  group: 'default',
  apiDocsUrl: '/v3/api-docs',
};

const emptyForm = () => ({ pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} });

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
});

describe('OAS 3.2 host acceptance matrix', () => {
  test('keeps 3.0/3.1/3.2 feature families distinct and rejects unknown or malformed versions', () => {
    expect(getOpenApiSpecificationFeatures('3.0.4')?.family).toBe('3.0');
    expect(getOpenApiSpecificationFeatures('3.1.2')?.family).toBe('3.1');
    expect(getOpenApiSpecificationFeatures('3.2.0')?.family).toBe('3.2');
    expect(getOpenApiSpecificationFeatures('3.2.99')).toBe(getOpenApiSpecificationFeatures('3.2.0'));
    expect(isOpenApi31Version('3.2.0')).toBe(false);
    expect(isSchemaEngineDocument(hostDocument)).toBe(true);
    expect(isSchemaEngineDocument(springdocDocument)).toBe(true);
    expect(isSchemaEngineDocument({ openapi: '3.0.3', info: { title: 'legacy', version: '1' }, paths: {} })).toBe(
      false,
    );
    expect(getOpenApiSpecificationFeatures('3.3.0')).toBeNull();
    expect(getOpenApiSpecificationFeatures('3.2')).toBeNull();
    expect(collectOas32DocumentDiagnostics({ ...hostDocument, openapi: '3.2' })).toContainEqual(
      expect.objectContaining({ code: 'invalid-field-value', path: '#/openapi' }),
    );
  });

  test('does not treat a rewritten springdoc 3.1 snapshot as real 3.2 generation evidence', () => {
    expect(springdocDocument.openapi).toBe('3.1.0');
    expect(hostDocument.openapi).toBe('3.2.0');
    expect(hostDocument.info?.summary).toMatch(/not springdoc/i);
    expect(JSON.stringify(hostDocument)).not.toContain('Oas31MatrixRequest');
    expect(JSON.stringify(springdocDocument)).toContain('Oas31MatrixRequest');
    const disguised = { ...springdocDocument, openapi: '3.2.0' };
    expect(disguised.openapi).toBe('3.2.0');
    expect(disguised).not.toEqual(hostDocument);
    expect(JSON.stringify(disguised)).toContain('/oas31/json');
    expect(JSON.stringify(disguised)).not.toContain('Host QUERY events');
  });

  test('loads the normative 3.2 fixture for navigation, dialect, display, debug, codecs, export and tracking', async () => {
    expect(collectOas32DocumentDiagnostics(hostDocument)).toEqual([]);
    expect(collectOas31DocumentDiagnostics(hostDocument)).toEqual([]);
    expect(hostDocument.jsonSchemaDialect).toBe(OPENAPI_32_DIALECT);
    expect(OPENAPI_32_DIALECT).not.toBe(OPENAPI_31_BASE_DIALECT);
    expect(isOpenApi3Document(hostDocument)).toBe(true);

    const tags = parseMenuTags(hostDocument, { retrievalUri: ENTRY_URI });
    const operations = tags.flatMap((tag) => tag.operations);
    expect(operations.map(({ method, path, source }) => ({ method, path, source }))).toEqual(
      expect.arrayContaining([
        { method: 'GET', path: '/health', source: 'path' },
        { method: 'QUERY', path: '/events', source: 'path' },
        { method: 'COPY', path: '/items/{id}', source: 'path' },
        { method: 'TRACE', path: '/trace', source: 'path' },
        { method: 'POST', path: 'itemChanged', source: 'webhook' },
      ]),
    );
    const webhook = operations.find(({ source }) => source === 'webhook');
    expect(visibleOperationModeKeys(webhook?.source, true, true)).toEqual(['doc', 'openapi']);
    const navigation = oas32TagMenu(
      hostDocument,
      tags,
      tags.flatMap((tag) =>
        tag.operations.map((operation) => ({
          key: operation.key,
          method: operation.method,
          path: operation.path,
          summary: operation.summary,
          tag: tag.tag,
        })),
      ),
      '',
    );
    expect(navigation?.roots.map((node) => node.name)).toEqual(expect.arrayContaining(['health']));
    expect(navigation?.roots.find((node) => node.name === 'health')?.children.map((node) => node.name)).toEqual([
      'events',
    ]);

    const fetchImpl = vi.fn(async () => {
      throw new Error('ungranted resources must not be fetched');
    });
    const loader = new ExternalResourceLoader(hostDocument, ENTRY_URI, {
      pageUri: 'https://docs.knife4j.example/doc.html',
      fetchImpl,
    });
    expect(loader.discover().candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ retrievalUri: DENIED_SCHEMA, sameOrigin: false })]),
    );
    const snapshot = await loader.load([]);
    expect(snapshot.complete).toBe(false);
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ targetRetrievalUri: DENIED_SCHEMA, state: 'pending' })]),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    loader.dispose();

    const query = operations.find(({ path, method }) => path === '/events' && method === 'QUERY');
    const cookie = operations.find(({ path, method }) => path === '/session' && method === 'GET');
    const trace = operations.find(({ path, method }) => path === '/trace' && method === 'TRACE');
    if (!query || !cookie || !trace) throw new Error('expected QUERY, cookie and TRACE host operations');

    const queryDebug = buildOperationDebugModel({
      doc: hostDocument as Parameters<typeof buildOperationDebugModel>[0]['doc'],
      path: '/events',
      method: 'QUERY',
    });
    expect(queryDebug.oas32Parameters?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'filter', in: 'querystring' })]),
    );
    expect(browserRequestConstraint('QUERY', true)).toBeNull();
    expect(browserRequestConstraint('TRACE', false)).toBe('unsupported-method');
    expect(browserRequestConstraint('GET', false, true)).toBe('unsupported-cookie');

    const cookieDebug = buildOperationDebugModel({
      doc: hostDocument as Parameters<typeof buildOperationDebugModel>[0]['doc'],
      path: '/session',
      method: 'GET',
    });
    const cookieBuilt = buildRequest({
      baseUrl: 'https://docs.knife4j.example',
      path: '/session',
      method: 'GET',
      debugModel: cookieDebug,
      formValues: {
        ...emptyForm(),
        oas32ParameterInputs: collectResolvedOas32ParameterInputs(
          cookieDebug.oas32Parameters!,
          { 'cookie:SID': { kind: 'parameter', text: 'SID=demo', enabled: true } },
          {},
          { 'cookie:SID': true },
          'explicit',
          1,
        ),
      },
    });
    expect(
      inspectUnsentBrowserSendFailure({
        built: cookieBuilt,
        hasBodyInput: false,
        cookieSessionCapable: true,
        isOas32: true,
      }),
    ).toEqual({ kind: 'unsupported-cookie', method: 'GET' });
    expect(
      inspectUnsentBrowserSendFailure({
        built: { ...cookieBuilt, method: 'TRACE', headers: {} },
        hasBodyInput: false,
        cookieSessionCapable: false,
        isOas32: true,
      })?.kind,
    ).toBe('unsupported-method');

    expect(classifyOas32SequentialMedia('text/event-stream')).toBe('sse');
    expect(classifyOas32SequentialMedia('application/cbor')).toBe('unknown');
    expect(isOas32SequentialVersion('3.2.0')).toBe(true);
    expect(isOas32SequentialVersion('3.1.2')).toBe(false);
    const sse = decodeOas32SequentialBytes(
      [new TextEncoder().encode('event: ping\ndata: {"n":1}\n\n')],
      'text/event-stream',
    );
    expect(sse[0]?.value).toMatchObject({ kind: 'sse', event: { event: 'ping', data: '{"n":1}' } });
    const unknownCodec = decodeOas32SequentialBytes([new TextEncoder().encode('not-a-codec')], 'application/cbor');
    expect(unknownCodec[0]?.diagnostics.map((item) => item.code)).toContain('CODEC_UNAVAILABLE');
    expect(unknownCodec[0]?.value.kind).toBe('raw');

    const session = await createSchemaDocumentSession(hostDocument, ENTRY_URI);
    await expect(session.evaluate('#/components/schemas/Health', { status: 'ok', note: null })).resolves.toMatchObject({
      valid: true,
    });
    await expect(session.evaluate('#/components/schemas/Health', { status: 'down' })).resolves.toMatchObject({
      valid: false,
    });
    session.dispose();
    await expect(
      createSchemaDocumentSession(
        { ...hostDocument, jsonSchemaDialect: 'https://example.test/custom-dialect' },
        `${ENTRY_URI}&dialect=custom`,
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_DIALECT' });
    const exportSession = await createSchemaDocumentSession(hostDocument, ENTRY_URI);
    sessions.push(exportSession);
    const exported = await buildOas32ExportSnapshot(hostDocument, tags, exportSession, { retrievalUri: ENTRY_URI });
    const methods = exported.document.tags.flatMap((tag) => tag.operations.map((operation) => operation.method));
    expect(methods).toEqual(expect.arrayContaining(['QUERY', 'COPY', 'TRACE', 'GET']));
    const queryExport = exported.document.tags
      .flatMap((tag) => tag.operations)
      .find((operation) => operation.method === 'QUERY');
    expect(queryExport?.notes).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'BROWSER_EXECUTION_UNSUPPORTED', detail: 'QUERY' })]),
    );
    await expect(buildOas32ExportSnapshot(springdocDocument, tags, exportSession)).rejects.toThrow(/OpenAPI 3.2.x/);

    const environment: Oas31ApiChangeEnvironment = {
      status: 'ready',
      retrievalUri: ENTRY_URI,
      snapshot,
      documentDiagnostics: [],
    };
    const tracking = buildApiChangeFingerprintSnapshot(hostDocument, environment);
    expect(tracking).toMatchObject({ status: 'unavailable', snapshotVersion: OAS32_API_CHANGE_SNAPSHOT_VERSION });
    if (tracking.status !== 'unavailable') throw new Error('expected pending external resource to pause tracking');
    expect(tracking.reason).toBe('resource-pending');
    expect(apiOperationIdentity('QUERY', '/events')).toBe(JSON.stringify(['QUERY', '/events']));
    expect(OAS32_API_CHANGE_SNAPSHOT_VERSION).not.toBe(OAS31_API_CHANGE_SNAPSHOT_VERSION);
  });

  test('keeps 3.1 springdoc consumption on the 3.1 family and rejects OAS2 in the OpenAPI 3 gate', () => {
    expect(collectOas31DocumentDiagnostics(springdocDocument)).toEqual([]);
    expect(isOpenApi31Version(springdocDocument.openapi)).toBe(true);
    expect(getOpenApiSpecificationFeatures(springdocDocument.openapi)?.family).toBe('3.1');
    const operations = parseMenuTags(springdocDocument).flatMap((tag) => tag.operations);
    expect(operations.map(({ path, method }) => `${method.toUpperCase()} ${path}`)).toEqual(
      expect.arrayContaining(['GET /oas31/search', 'POST /oas31/json']),
    );
    expect(operations.some(({ method }) => method.toUpperCase() === 'QUERY')).toBe(false);
    expect(isOpenApi3Document({ swagger: '2.0', info: { title: 'demo', version: '1' }, paths: {} })).toBe(false);
    expect(isOpenApi3Document({ openapi: '3.2.0', info: { title: 'demo', version: '1' }, paths: {} })).toBe(true);
  });

  test('does not invent QUERY from a 3.1 document that happens to contain a query field', () => {
    const document31 = {
      openapi: '3.1.0',
      info: { title: 'Legacy query field', version: '1' },
      paths: {
        '/health': {
          get: { responses: { '200': { description: 'ok' } } },
          query: { responses: { '200': { description: 'should stay hidden' } } },
          additionalOperations: { COPY: { responses: { '200': { description: 'hidden' } } } },
        },
      },
    } as SwaggerDoc;
    const methods = parseMenuTags(document31).flatMap((tag) => tag.operations.map((operation) => operation.method));
    expect(methods).toEqual(['get']);
  });

  test('diagnoses mixing querystring with query instead of rewriting the document', () => {
    const invalid = {
      openapi: '3.2.0',
      info: { title: 'Invalid mix', version: '1' },
      paths: {
        '/search': {
          parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }],
          query: {
            parameters: [
              {
                name: 'filter',
                in: 'querystring',
                content: { 'application/json': { schema: { type: 'object' } } },
              },
            ],
            responses: { '200': { description: 'no' } },
          },
        },
      },
    };
    const diagnostics = collectOas32DocumentDiagnostics(invalid);
    expect(diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'query-querystring-conflict' })]),
    );
  });

  test('current springdoc snapshots remain 3.1 generator evidence, not relabeled 3.2', () => {
    expect(boot4SpringdocDocument.openapi).toBe('3.1.0');
    expect(JSON.stringify(boot4SpringdocDocument)).not.toMatch(/"openapi":\s*"3\.2/);
    expect(JSON.stringify(boot4SpringdocDocument)).not.toMatch(/additionalOperations/);
    expect(JSON.stringify(springdocDocument)).not.toMatch(/"openapi":\s*"3\.2/);
    expect(getOpenApiStandardHttpMethods('3.1.0')).not.toContain('query');
    expect(getOpenApiStandardHttpMethods('3.2.0')).toContain('query');
  });

  test('change-tracking storage keys stay isolated across 3.1 and 3.2', () => {
    expect(buildApiChangeBaselineStorageKey(trackingIdentity, OAS32_API_CHANGE_SNAPSHOT_VERSION)).not.toBe(
      buildApiChangeBaselineStorageKey(trackingIdentity, OAS31_API_CHANGE_SNAPSHOT_VERSION),
    );
    expect(browserRequestConstraint('COPY', false)).toBeNull();
    expect(browserRequestConstraint('Copy', false)).toBeNull();
  });
});
