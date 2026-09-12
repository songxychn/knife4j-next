import { writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import { parseMenuTags } from '../../api/knife4jClient';
import { createSchemaDocumentSession, type SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import {
  ExternalResourceLoader,
  schemaDocumentsFromResourceGraph,
  schemaRegistrationContextFromResourceGraph,
} from '../../schema/externalResourceGraph';
import type { SwaggerDoc } from '../../types/swagger';
import { buildOas31ExportSnapshot } from './oas31ExportSnapshot';
import {
  buildOas32DegradedExportSnapshot,
  buildOas32ExportSnapshot,
  collectOas32ExportResourceGraphIssues,
  Oas32ExportBudgetError,
  selectOas32ExportResourceSnapshot,
} from './oas32ExportSnapshot';
import { renderDocx, renderHtmlDoc, renderMarkdownDoc, renderWordDoc, type OfficeDocLabels } from './OfficeDoc';

vi.mock('../../context/GroupContext', () => ({
  useGroup: () => ({}),
}));

const ENTRY_URI = 'https://docs.knife4j.example/v3/api-docs';
const SECURITY_URI = '#/components/securitySchemes/Bearer';
const sessions: SchemaDocumentSession[] = [];

function valid32(extra: Record<string, unknown> = {}): SwaggerDoc {
  const document = {
    openapi: '3.2.0',
    info: { title: 'OAS 3.2 offline API', version: '1.0.0', description: 'Offline export fixture.' },
    ...extra,
  };
  expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
  return document as SwaggerDoc;
}

function semanticsDocument(): SwaggerDoc {
  return valid32({
    tags: [{ name: 'Events', summary: 'Event APIs', kind: 'nav', description: 'Sequential events.' }],
    servers: [{ url: 'https://api.example.test/v1', name: 'prod', description: 'Production' }],
    security: [{ Bearer: [] }],
    paths: {
      '/events': {
        query: {
          tags: ['Events'],
          summary: 'Query events',
          security: [{ Bearer: [] }, { [SECURITY_URI]: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json-seq': { $ref: '#/components/mediaTypes/Events' },
            },
          },
          responses: {
            '200': {
              summary: 'Event stream',
              description: 'Sequential records.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [{ $ref: '#/components/schemas/Known' }, { $ref: '#/components/schemas/Other' }],
                    discriminator: {
                      propertyName: 'kind',
                      mapping: { known: 'Known' },
                      defaultMapping: 'Other',
                    },
                    xml: { nodeType: 'element', name: 'Payload' },
                  },
                  example: { kind: 'known', id: 7 },
                },
              },
            },
          },
        },
        additionalOperations: {
          COPY: {
            tags: ['Events'],
            summary: 'Copy events',
            responses: { '200': { description: 'copied upper' } },
          },
          Copy: {
            tags: ['Events'],
            summary: 'Copy events mixed',
            responses: { '200': { description: 'copied mixed' } },
          },
        },
      },
    },
    components: {
      schemas: {
        Known: {
          type: 'object',
          required: ['kind', 'id'],
          properties: {
            kind: { const: 'known' },
            id: { type: 'integer', xml: { nodeType: 'attribute' } },
          },
        },
        Other: {
          type: 'object',
          required: ['kind'],
          properties: { kind: { const: 'other' } },
        },
      },
      mediaTypes: {
        Events: {
          schema: { type: 'array' },
          itemSchema: { type: 'integer' },
          prefixEncoding: [{ contentType: 'text/plain' }],
          itemEncoding: { contentType: 'application/json' },
        },
      },
      securitySchemes: {
        Bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        Metadata: {
          type: 'oauth2',
          oauth2MetadataUrl: 'https://auth.example.test/.well-known/oauth-authorization-server',
          flows: {},
        },
      },
    },
  });
}

async function openSession(document: SwaggerDoc) {
  const fetchSpy = vi.fn(async () => {
    throw new Error('export must stay registry-only');
  });
  const loader = new ExternalResourceLoader(document, ENTRY_URI, {
    pageUri: 'https://docs.knife4j.example/doc.html',
    fetchImpl: fetchSpy,
  });
  const snapshot = loader.currentSnapshot();
  const session = await createSchemaDocumentSession(document, ENTRY_URI, {
    registrationContext: schemaRegistrationContextFromResourceGraph(snapshot, ENTRY_URI),
    resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
  });
  sessions.push(session);
  return { session, snapshot, fetchSpy, loader };
}

const labels: OfficeDocLabels = {
  language: 'en-US',
  version: 'Version',
  description: 'Description',
  name: 'Name',
  location: 'Location',
  required: 'Required',
  type: 'Type',
  field: 'Field',
  yes: 'Yes',
  no: 'No',
  requestBody: 'Request body',
  requestExample: 'Request Example',
  mediaType: 'Content-Type',
  responses: 'Responses',
  response: 'Response',
  responseExample: 'Response Example',
  statusCode: 'Status code',
  schema: 'Schema',
  deprecated: 'Deprecated',
  parameters: 'Parameters',
  circularReference: 'Circular reference',
  truncated: 'Truncated',
  fallbackTitle: 'API documentation',
  security: 'Security',
  servers: 'Servers',
  itemSchema: 'itemSchema',
  sequentialKind: 'Sequential media',
  encoding: 'Encoding',
  notes: 'Notes',
  markdown: {
    version: 'Version',
    truncated: 'Truncated',
    circularReference: 'Circular reference',
    deprecated: 'Deprecated',
    requestParameters: 'Request parameters',
    noRequestParameters: 'No request parameters.',
    requestBody: 'Request body',
    requestExample: 'Request Example',
    noRequestBody: 'No request body.',
    requestBodyNotExpandable: 'Request body schema cannot be expanded.',
    mediaType: 'Content-Type',
    responseStructure: 'Responses',
    responseExample: 'Response Example',
    noResponse: 'No response defined.',
    name: 'Name',
    location: 'Location',
    type: 'Type',
    required: 'Required',
    description: 'Description',
    field: 'Field',
    yes: 'Yes',
    no: 'No',
    status: 'Status code',
    schema: 'Schema',
    security: 'Security',
    servers: 'Servers',
    itemSchema: 'itemSchema',
    sequentialKind: 'Sequential media',
    encoding: 'Encoding',
    notes: 'Notes',
  },
};

async function readDocumentXml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const documentPart = zip.file('word/document.xml');
  expect(documentPart).not.toBeNull();
  return documentPart!.async('text');
}

function operationMethods(snapshot: {
  document: { tags: Array<{ operations: Array<{ method: string }> }> };
}): string[] {
  return snapshot.document.tags.flatMap((tag) => tag.operations.map((operation) => operation.method));
}

function expectRenderedSemantics(output: string): void {
  expect(output).toContain('QUERY');
  expect(output).toContain('COPY');
  expect(output).toContain('Copy');
  expect(output).toContain('itemSchema');
  expect(output).toContain('Sequential media');
  expect(output).toContain('json-seq');
  expect(output).not.toMatch(/itemSchema[:\s]+json-seq/);
  expect(output).toContain('defaultMapping');
  expect(output).toContain('text/plain');
  expect(output).toMatch(/nodeType/);
  expect(output).toContain(SECURITY_URI);
  expect(output).not.toMatch(/Bearer ey|password|client_secret|Authorization:\s*Bearer/i);
}

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

describe('OAS 3.2 offline export snapshot', () => {
  test('rejects OAS 3.1 documents and keeps the 3.1 builder rejecting 3.2', async () => {
    const document32 = semanticsDocument();
    const { session, snapshot } = await openSession(document32);
    const tags = parseMenuTags(document32, { retrievalUri: ENTRY_URI, resourceSnapshot: snapshot });
    await expect(buildOas32ExportSnapshot({ ...document32, openapi: '3.1.2' }, tags, session)).rejects.toThrow(
      'requires a valid OpenAPI 3.2.x version',
    );
    await expect(buildOas31ExportSnapshot(document32, tags, session)).rejects.toThrow(
      'requires a valid OpenAPI 3.1.x version',
    );
  });

  test('preserves QUERY and additionalOperations case, 3.2 metadata, and stays registry-only', async () => {
    const document = semanticsDocument();
    const { session, snapshot, fetchSpy } = await openSession(document);
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('export must stay registry-only'));
    const tags = parseMenuTags(document, { retrievalUri: ENTRY_URI, resourceSnapshot: snapshot });
    const result = await buildOas32ExportSnapshot(document, tags, session, {
      retrievalUri: ENTRY_URI,
      resourceSnapshot: snapshot,
    });
    const methods = operationMethods(result);
    expect(methods).toHaveLength(3);
    expect(methods).toEqual(expect.arrayContaining(['QUERY', 'COPY', 'Copy']));
    expect(methods).not.toContain('GET');
    expect(methods.filter((method) => method === 'Copy')).toHaveLength(1);
    expect(methods.filter((method) => method === 'COPY')).toHaveLength(1);

    const query = result.document.tags[0].operations.find((operation) => operation.method === 'QUERY')!;
    expect(query.methodSource).toBe('fixed');
    expect(query.notes).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'BROWSER_EXECUTION_UNSUPPORTED', detail: 'QUERY' })]),
    );
    expect(query.requestBody?.itemSchema?.role).toBe('itemSchema');
    expect(query.requestBody?.itemSchema?.typeDisplay).toMatch(/integer/);
    expect(query.requestBody?.encodings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'prefix', contentType: 'text/plain' }),
        expect.objectContaining({ kind: 'item', contentType: 'application/json' }),
      ]),
    );
    expect(query.requestBody?.sequentialKind).toBe('json-seq');
    expect(query.responses[0].summary).toBe('Event stream');
    expect(JSON.stringify(query.responses[0].schema)).toMatch(/defaultMapping/);
    expect(query.responses[0].schema?.discriminator?.defaultMapping).toBe('Other');
    expect(query.responses[0].schema?.xml?.nodeType).toBe('element');
    expect(
      query.responses[0].schema?.fields.some(
        (field) => field.xml?.nodeType === 'attribute' || /xml:attribute/.test(field.typeDisplay),
      ),
    ).toBe(true);
    expect(query.security?.some((requirement) => requirement.schemes.some((scheme) => scheme.name === 'Bearer'))).toBe(
      true,
    );
    expect(
      query.security?.some((requirement) => requirement.schemes.some((scheme) => scheme.name === SECURITY_URI)),
    ).toBe(true);
    expect(result.document.servers?.[0]).toMatchObject({ url: 'https://api.example.test/v1', name: 'prod' });
    expect(result.document.securitySchemes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Bearer', type: 'http', scheme: 'bearer' }),
        expect.objectContaining({
          name: 'Metadata',
          notes: expect.arrayContaining([expect.objectContaining({ code: 'METADATA_URL_NOT_FETCHED' })]),
        }),
      ]),
    );
    expect(JSON.stringify(result.document)).not.toMatch(/Bearer ey|password|client_secret|Authorization:\s*Bearer/i);
    expect(result.document.tags[0]).toMatchObject({ summary: 'Event APIs', kind: 'nav' });
    expect(result.issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ITEM_SCHEMA_ABSENT' })]),
    );

    const html = renderHtmlDoc(result, labels);
    const markdown = renderMarkdownDoc(result, labels);
    const word = renderWordDoc(result, labels);
    const docx = await readDocumentXml(await renderDocx(result, labels));
    for (const output of [html, markdown, word, docx]) {
      expectRenderedSemantics(output);
    }
    expect(html).not.toMatch(/<(script|link|img|iframe)[^>]+\s(src|href)=["']https?:/i);
    expect(markdown).toContain('**QUERY** `/events`');
    expect(markdown).toContain('**Copy** `/events`');
    expect(globalFetch).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    writeFileSync('/tmp/knife4j-oas32-782-offline.html', html);
  });

  test('keeps QUERY and additional method identity in a degraded 3.2 snapshot', async () => {
    const document = semanticsDocument();
    const { snapshot } = await openSession(document);
    const tags = parseMenuTags(document, { retrievalUri: ENTRY_URI, resourceSnapshot: snapshot });
    const degraded = buildOas32DegradedExportSnapshot(document, tags, [
      { code: 'SCHEMA_SESSION_UNAVAILABLE', severity: 'warning' },
    ]);
    expect(degraded.complete).toBe(false);
    expect(degraded.document.openapi).toBe('3.2.0');
    expect(operationMethods(degraded)).toEqual(expect.arrayContaining(['QUERY', 'COPY', 'Copy']));
    expect(degraded.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'SCHEMA_SESSION_UNAVAILABLE' })]),
    );
    const query = degraded.document.tags[0].operations.find((operation) => operation.method === 'QUERY');
    const copy = degraded.document.tags[0].operations.find((operation) => operation.method === 'COPY');
    const mixed = degraded.document.tags[0].operations.find((operation) => operation.method === 'Copy');
    expect(query?.notes).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'BROWSER_EXECUTION_UNSUPPORTED', detail: 'QUERY' })]),
    );
    expect(copy?.notes).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'BROWSER_EXECUTION_UNSUPPORTED', detail: 'COPY' })]),
    );
    expect(mixed?.notes).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'BROWSER_EXECUTION_UNSUPPORTED', detail: 'Copy' })]),
    );
    expect(renderHtmlDoc(degraded, { ...labels, incompleteTitle: 'INCOMPLETE SNAPSHOT' })).toContain(
      'INCOMPLETE SNAPSHOT',
    );
    expect(renderHtmlDoc(degraded, labels)).toContain('BROWSER_EXECUTION_UNSUPPORTED');
  });

  test('labels sequential media separately from itemSchema when itemSchema is absent', async () => {
    const document = valid32({
      paths: {
        '/stream': {
          query: {
            responses: {
              '200': {
                description: 'stream',
                content: {
                  'application/json-seq': { schema: { type: 'array' } },
                },
              },
            },
          },
        },
      },
    });
    const { session, snapshot, fetchSpy } = await openSession(document);
    const tags = parseMenuTags(document, { retrievalUri: ENTRY_URI, resourceSnapshot: snapshot });
    const result = await buildOas32ExportSnapshot(document, tags, session, {
      retrievalUri: ENTRY_URI,
      resourceSnapshot: snapshot,
    });
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ITEM_SCHEMA_ABSENT', severity: 'warning' })]),
    );
    expect(result.document.tags[0].operations[0].responses[0].sequentialKind).toBe('json-seq');
    expect(result.document.tags[0].operations[0].responses[0].notes).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'ITEM_SCHEMA_ABSENT' })]),
    );
    const html = renderHtmlDoc(result, { ...labels, incompleteTitle: 'INCOMPLETE SNAPSHOT' });
    const markdown = renderMarkdownDoc(result, labels);
    expect(html).toContain('INCOMPLETE SNAPSHOT');
    expect(html).toContain('Sequential media');
    expect(html).toContain('json-seq');
    expect(html).toContain('ITEM_SCHEMA_ABSENT');
    expect(markdown).toContain('**Sequential media:** json-seq');
    expect(markdown).toContain('ITEM_SCHEMA_ABSENT');
    expect(html).not.toMatch(/<strong>itemSchema<\/strong>\s*<code>json-seq/);
    expect(markdown).not.toMatch(/\*\*itemSchema:\*\* json-seq/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('changing only info and the 3.2 patch still exports the same operation identities', async () => {
    const document = {
      ...semanticsDocument(),
      openapi: '3.2.1',
      info: { title: 'Renamed offline API', version: '1.0.1', description: 'info patch only.' },
    };
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const { session, snapshot, fetchSpy } = await openSession(document);
    const tags = parseMenuTags(document, { retrievalUri: ENTRY_URI, resourceSnapshot: snapshot });
    const result = await buildOas32ExportSnapshot(document, tags, session, {
      retrievalUri: ENTRY_URI,
      resourceSnapshot: snapshot,
    });
    expect(result.document.title).toBe('Renamed offline API');
    expect(result.document.openapi).toBe('3.2.1');
    expect(operationMethods(result)).toEqual(expect.arrayContaining(['QUERY', 'COPY', 'Copy']));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('marks an unavailable Response reference incomplete without fetching', async () => {
    const document = valid32({
      paths: {
        '/result': {
          get: {
            responses: {
              '200': { $ref: 'https://missing.example.test/openapi.json#/components/responses/Result' },
              '204': { description: 'No content' },
            },
          },
        },
      },
    });
    const { session, snapshot, fetchSpy } = await openSession(document);
    const tags = parseMenuTags(document, { retrievalUri: ENTRY_URI, resourceSnapshot: snapshot });
    const result = await buildOas32ExportSnapshot(document, tags, session, {
      retrievalUri: ENTRY_URI,
      resourceSnapshot: snapshot,
    });
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RESPONSE_REFERENCE_UNAVAILABLE', region: 'response 200' }),
      ]),
    );
    expect(result.document.tags[0].operations[0].responses.map((response) => response.statusCode)).toEqual([
      '200',
      '204',
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('marks a missing resource graph incomplete without substituting a 3.0 projection', async () => {
    const document = semanticsDocument();
    const { session, fetchSpy } = await openSession(document);
    const tags = parseMenuTags(document);
    const result = await buildOas32ExportSnapshot(document, tags, session, { retrievalUri: ENTRY_URI });
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'RESOURCE_GRAPH_INCOMPLETE' })]),
    );
    expect(result.issues).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'GRAPH_STALE' })]));
    expect(operationMethods(result)).toEqual(expect.arrayContaining(['QUERY', 'COPY', 'Copy']));
    expect(result.document.openapi).toBe('3.2.0');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('does not expand $ref closures from a menu-cached graph when the current snapshot is withheld', async () => {
    const document = semanticsDocument();
    const { session, snapshot, fetchSpy } = await openSession(document);
    const tags = parseMenuTags(document, { retrievalUri: ENTRY_URI, resourceSnapshot: snapshot });
    expect(tags.some((tag) => tag.operations.some((operation) => operation.resourceSnapshot))).toBe(true);
    const result = await buildOas32ExportSnapshot(document, tags, session, { retrievalUri: ENTRY_URI });
    const query = result.document.tags[0].operations.find((operation) => operation.method === 'QUERY')!;
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'RESOURCE_GRAPH_INCOMPLETE' })]),
    );
    expect(query.requestBody?.itemSchema).toBeUndefined();
    expect(query.requestBody?.notes).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MEDIA_TYPE_REFERENCE_UNAVAILABLE' })]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('treats a document-scope mismatch as GRAPH_STALE and does not use the stale graph', async () => {
    const document = semanticsDocument();
    const { session, snapshot, fetchSpy } = await openSession(document);
    const tags = parseMenuTags(document, { retrievalUri: ENTRY_URI, resourceSnapshot: snapshot });
    const stale = { ...snapshot, documentScope: `${snapshot.documentScope}-other` };
    expect(selectOas32ExportResourceSnapshot(stale, ENTRY_URI, snapshot.documentScope)).toBeUndefined();
    expect(
      collectOas32ExportResourceGraphIssues({
        snapshot: stale,
        retrievalUri: ENTRY_URI,
        documentScope: snapshot.documentScope,
        graphStatus: 'ready',
      }),
    ).toEqual([expect.objectContaining({ code: 'GRAPH_STALE', severity: 'warning' })]);
    const result = await buildOas32ExportSnapshot(document, tags, session, {
      retrievalUri: ENTRY_URI,
      documentScope: snapshot.documentScope,
      resourceSnapshot: stale,
    });
    const query = result.document.tags[0].operations.find((operation) => operation.method === 'QUERY')!;
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'GRAPH_STALE' })]));
    expect(query.requestBody?.itemSchema).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('records an unresolved Media Type $ref as incomplete instead of MEDIA_SCHEMA_ABSENT', async () => {
    const document = valid32({
      paths: {
        '/payloads': {
          post: {
            requestBody: {
              content: {
                'application/json': { $ref: 'https://schemas.example.test/media.json' },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    });
    const { session, snapshot, fetchSpy } = await openSession(document);
    const tags = parseMenuTags(document, { retrievalUri: ENTRY_URI, resourceSnapshot: snapshot });
    const result = await buildOas32ExportSnapshot(document, tags, session, {
      retrievalUri: ENTRY_URI,
      resourceSnapshot: snapshot,
    });
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MEDIA_TYPE_REFERENCE_UNAVAILABLE', region: 'requestBody' }),
      ]),
    );
    expect(result.document.tags[0].operations[0].requestBody?.notes).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MEDIA_TYPE_REFERENCE_UNAVAILABLE' })]),
    );
    expect(result.document.tags[0].operations[0].requestBody?.notes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MEDIA_SCHEMA_ABSENT' })]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('marks an incomplete resource graph without fetching', async () => {
    const document = valid32({
      paths: {
        '/payloads': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: 'https://schemas.example.test/payload.json' } },
              },
            },
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    });
    const { session, snapshot, fetchSpy } = await openSession(document);
    const tags = parseMenuTags(document, { retrievalUri: ENTRY_URI, resourceSnapshot: snapshot });
    const result = await buildOas32ExportSnapshot(document, tags, session, {
      retrievalUri: ENTRY_URI,
      resourceSnapshot: snapshot,
      initialIssues: [{ code: 'RESOURCE_GRAPH_INCOMPLETE', severity: 'warning' }],
    });
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RESOURCE_GRAPH_INCOMPLETE' }),
        expect.objectContaining({ code: expect.stringMatching(/REFERENCE|UNAVAILABLE|PROJECTION/) }),
      ]),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('rejects operation budget overflow and honors cancellation', async () => {
    const document = semanticsDocument();
    const { session, snapshot } = await openSession(document);
    const tags = parseMenuTags(document, { retrievalUri: ENTRY_URI, resourceSnapshot: snapshot });
    const duplicated = [{ ...tags[0], operations: [...tags[0].operations, ...tags[0].operations] }];
    await expect(
      buildOas32ExportSnapshot(document, duplicated, session, {
        retrievalUri: ENTRY_URI,
        resourceSnapshot: snapshot,
        limits: { maxOperations: 1 },
      }),
    ).rejects.toMatchObject<Oas32ExportBudgetError>({
      code: 'EXPORT_BUDGET_EXCEEDED',
      dimension: 'operations',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildOas32ExportSnapshot(document, tags, session, {
        retrievalUri: ENTRY_URI,
        resourceSnapshot: snapshot,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
