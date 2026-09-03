import { afterEach, describe, expect, test, vi } from 'vitest';
import { parseMenuTags } from '../../api/knife4jClient';
import { createSchemaDocumentSession, type SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import type { SwaggerDoc } from '../../types/swagger';
import { buildOas31ExportSnapshot, Oas31ExportBudgetError } from './oas31ExportSnapshot';

const ENTRY_URI = 'https://docs.knife4j.example/v3/api-docs';
const RESOURCE_URI = 'https://schemas.knife4j.example/payload.json';
const sessions: SchemaDocumentSession[] = [];

function documentFixture(openapi = '3.1.1'): SwaggerDoc {
  return {
    openapi,
    info: { title: 'Projected offline API', version: '1.0.0', description: 'OAS 3.1 snapshot fixture.' },
    tags: [{ name: 'Payloads', description: 'Projected payload operations.' }],
    paths: {
      '/payloads': {
        parameters: [
          {
            name: 'filter',
            in: 'query',
            schema: { type: ['string', 'null'] },
            description: 'Nullable filter.',
          },
        ],
        post: {
          tags: ['Payloads'],
          summary: 'Create payload',
          parameters: [
            {
              name: 'criteria',
              in: 'query',
              required: true,
              style: 'deepObject',
              schema: {
                type: 'object',
                required: ['phrase', 'clientToken'],
                properties: {
                  phrase: { type: 'string' },
                  clientToken: { type: 'string', writeOnly: true },
                  serverHint: { type: 'string', readOnly: true },
                },
              },
              example: { phrase: 'Ada', clientToken: 'parameter-secret' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: `${RESOURCE_URI}#payload` },
                example: { name: 'Ada', secret: 'request-secret' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Projected payload.',
              content: {
                'application/json': {
                  schema: { $ref: `${RESOURCE_URI}#payload` },
                  example: { name: 'Ada', serverId: 'response-id' },
                },
              },
            },
            '299': {
              description: 'Projection diagnostics.',
              content: { 'application/json': { schema: { $ref: `${RESOURCE_URI}#diagnostic` } } },
            },
            '422': {
              description: 'No value is valid.',
              content: { 'application/json': { schema: false as never } },
            },
          },
        },
      },
    },
  };
}

const resourceDocument = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: RESOURCE_URI,
  $defs: {
    Payload: {
      $anchor: 'payload',
      type: 'object',
      additionalProperties: false,
      required: ['name', 'serverId', 'secret'],
      properties: {
        name: { const: 'Ada', description: 'Shared name.' },
        serverId: { const: 'response-id', readOnly: true, description: 'Response-only field.' },
        secret: { const: 'request-secret', writeOnly: true, description: 'Request-only field.' },
        tuple: {
          type: 'array',
          prefixItems: [{ const: 1 }, { const: 'two' }],
          items: false,
        },
      },
    },
    Diagnostic: {
      $anchor: 'diagnostic',
      $dynamicAnchor: 'node',
      type: 'object',
      properties: {
        choice: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
        parent: { $ref: '#diagnostic' },
        dynamic: { $dynamicRef: '#node' },
      },
    },
  },
};

async function openSession(document: SwaggerDoc, withResource = true): Promise<SchemaDocumentSession> {
  const session = await createSchemaDocumentSession(document, ENTRY_URI, {
    resourceDocuments: withResource ? [{ document: resourceDocument, retrievalUri: RESOURCE_URI }] : [],
  });
  sessions.push(session);
  return session;
}

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

describe('OAS 3.1 offline export snapshot', () => {
  test('projects every format-neutral operation through the registered session', async () => {
    const document = documentFixture();
    const session = await openSession(document);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('export must stay registry-only'));

    const snapshot = await buildOas31ExportSnapshot(document, parseMenuTags(document), session);
    const operation = snapshot.document.tags[0].operations[0];
    const requestFields = operation.requestBody?.schema?.fields.map((field) => field.fieldPath) ?? [];
    const responseFields = operation.responses[0].schema?.fields.map((field) => field.fieldPath) ?? [];

    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'filter', typeDisplay: 'string | null', compactTypeDisplay: 'string|null' }),
        expect.objectContaining({ name: 'criteria', typeDisplay: 'object', compactTypeDisplay: 'object' }),
      ]),
    );
    const criteria = operation.parameters.find((parameter) => parameter.name === 'criteria')!;
    expect(criteria.schema?.fields.map((field) => field.fieldPath)).toEqual(['phrase', 'clientToken']);
    expect(criteria.schema?.fields.map((field) => field.fieldPath)).not.toContain('serverHint');
    expect(JSON.parse(criteria.example!.value)).toEqual({ phrase: 'Ada', clientToken: 'parameter-secret' });
    expect(requestFields).toEqual(expect.arrayContaining(['name', 'secret', 'tuple', 'tuple[0]', 'tuple[1]']));
    expect(requestFields).not.toContain('serverId');
    expect(responseFields).toContain('serverId');
    expect(responseFields).not.toContain('secret');
    const diagnosticFields = operation.responses[1].schema?.fields ?? [];
    expect(diagnosticFields.map((field) => field.fieldPath)).toEqual(
      expect.arrayContaining(['choice', 'choice.oneOf[1]', 'choice.oneOf[2]', 'parent', 'dynamic']),
    );
    expect(diagnosticFields.find((field) => field.fieldPath === 'parent')).toMatchObject({
      truncated: true,
      truncationReason: 'circular-reference',
    });
    expect(diagnosticFields.find((field) => field.fieldPath === 'dynamic')).toMatchObject({
      truncated: true,
      truncationReason: 'projection-loss',
    });
    expect(operation.responses[2].schema).toMatchObject({ typeDisplay: 'never', kind: 'primitive', fields: [] });
    expect(JSON.parse(operation.requestBody!.example!.value)).toMatchObject({
      name: 'Ada',
      secret: 'request-secret',
    });
    expect(JSON.parse(operation.responses[0].example!.value)).toMatchObject({
      name: 'Ada',
      serverId: 'response-id',
    });
    expect(JSON.parse(operation.requestBody!.example!.value)).not.toHaveProperty('serverId');
    expect(JSON.parse(operation.responses[0].example!.value)).not.toHaveProperty('secret');

    expect(snapshot.complete).toBe(false);
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DYNAMIC_REFERENCE',
          severity: 'warning',
          operation: 'POST /payloads',
        }),
        expect.objectContaining({ code: 'CIRCULAR_REFERENCE', severity: 'info' }),
      ]),
    );
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.document.tags[0].operations[0].responses)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test.each(['3.1.0', '3.1.1', '3.1.2'])('accepts the whole declared %s patch line', async (openapi) => {
    const document: SwaggerDoc = {
      openapi,
      info: { title: 'Patch line', version: '1' },
      paths: {
        '/ping': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { type: 'string' }, example: 'ping' } },
            },
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { type: 'string' }, example: 'pong' } },
              },
            },
          },
        },
      },
    };
    const session = await openSession(document, false);
    const snapshot = await buildOas31ExportSnapshot(document, parseMenuTags(document), session);
    expect(snapshot.document.title).toBe('Patch line');
    expect(snapshot.complete).toBe(true);
  });

  test.each(['3.1.3', '3.1.999'])('rejects the unfrozen %s patch version', async (openapi) => {
    const document = documentFixture(openapi);
    const session = await openSession(document);
    await expect(buildOas31ExportSnapshot(document, parseMenuTags(document), session)).rejects.toThrow(
      'supports only OpenAPI 3.1.0, 3.1.1, and 3.1.2',
    );
  });

  test('locates an operation kept as a non-conflicting Path Item reference sibling', async () => {
    const document: SwaggerDoc = {
      openapi: '3.1.2',
      info: { title: 'Path Item sibling', version: '1.0.0' },
      tags: [{ name: 'Sibling' }],
      paths: {
        '/sibling': {
          $ref: '#/components/pathItems/SharedMetadata',
          post: {
            tags: ['Sibling'],
            summary: 'Sibling operation',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { input: { type: 'string' } } },
                  example: { input: 'request-sibling' },
                },
              },
            },
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { type: 'object', properties: { output: { type: 'string' } } },
                    example: { output: 'response-sibling' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        pathItems: {
          SharedMetadata: {
            summary: 'Referenced metadata',
            parameters: [
              {
                name: 'tenant',
                in: 'query',
                schema: { type: 'string' },
                example: 'tenant-sibling',
              },
            ],
          },
        },
      },
    };
    const session = await openSession(document, false);
    const snapshot = await buildOas31ExportSnapshot(document, parseMenuTags(document), session);
    const operation = snapshot.document.tags[0].operations[0];

    expect(snapshot.complete).toBe(true);
    expect(operation.parameters[0]).toMatchObject({
      name: 'tenant',
      example: { value: 'tenant-sibling' },
    });
    expect(operation.requestBody?.schema?.fields.map((field) => field.fieldPath)).toEqual(['input']);
    expect(operation.requestBody?.example?.value).toContain('request-sibling');
    expect(operation.responses[0].schema?.fields.map((field) => field.fieldPath)).toEqual(['output']);
    expect(operation.responses[0].example?.value).toContain('response-sibling');
  });

  test('keeps an incomplete resource graph explicit without trying to fetch', async () => {
    const document = documentFixture();
    const session = await openSession(document, false);
    const snapshot = await buildOas31ExportSnapshot(document, parseMenuTags(document), session, {
      initialIssues: [{ code: 'RESOURCE_GRAPH_INCOMPLETE', severity: 'warning' }],
    });

    expect(snapshot.complete).toBe(false);
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RESOURCE_GRAPH_INCOMPLETE' }),
        expect.objectContaining({ code: 'REFERENCE_UNAVAILABLE', region: 'requestBody' }),
      ]),
    );
  });

  test('rejects operation and projected-field budget overflow and honors cancellation', async () => {
    const document = documentFixture();
    const session = await openSession(document);
    const tags = parseMenuTags(document);
    const duplicated = [{ ...tags[0], operations: [...tags[0].operations, ...tags[0].operations] }];

    await expect(
      buildOas31ExportSnapshot(document, duplicated, session, { limits: { maxOperations: 1 } }),
    ).rejects.toMatchObject<Oas31ExportBudgetError>({
      code: 'EXPORT_BUDGET_EXCEEDED',
      dimension: 'operations',
    });
    await expect(
      buildOas31ExportSnapshot(document, tags, session, { limits: { maxProjectedFields: 1 } }),
    ).rejects.toMatchObject<Oas31ExportBudgetError>({
      code: 'EXPORT_BUDGET_EXCEEDED',
      dimension: 'projected-fields',
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      buildOas31ExportSnapshot(document, tags, session, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
