import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildOperationDebugModel, dereferenceReferenceObject } from 'knife4j-core';
import { parseMenuTags } from '../api/knife4jClient';
import boot3MvcSpringdocDocument from '../test-fixtures/springdoc-oas31/boot3-mvc-springdoc-2.8.9.json';
import browserSupplementDocument from '../test-fixtures/springdoc-oas31/browser-supplement-3.1.2.json';
import type { SwaggerDoc } from '../types/swagger';
import {
  projectApiDocSchemaRegions,
  REQUEST_BODY_REGION_KEY,
  responseSchemaRegionKey,
} from '../pages/api/apiDocSchemaProjection';
import { visibleOperationModeKeys } from '../pages/api/operationRouting';
import { ExternalResourceLoader } from './externalResourceGraph';
import { generateOperationSchemaExamples } from './operationSchemaExamples';
import { evaluateRequestBodySchema, prepareRequestBodySchemaEvaluation } from './requestBodySchemaValidation';
import { evaluateResponseBodySchema, prepareResponseBodySchemaEvaluation } from './responseBodySchemaValidation';
import { createSchemaDisplayProjector } from './schemaDisplayProjection';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import { projectSchemaModels } from './schemaModelProjection';

const sessions: SchemaDocumentSession[] = [];
const springdocDocument = boot3MvcSpringdocDocument as unknown as SwaggerDoc;
const supplementDocument = browserSupplementDocument as unknown as SwaggerDoc;

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
});

describe('Springdoc OpenAPI 3.1 acceptance matrix', () => {
  test('drives navigation, debug parsing, schema models, examples, and diagnostics from one real response', async () => {
    const operations = parseMenuTags(springdocDocument).flatMap((tag) => tag.operations);
    expect(operations.map(({ path, method }) => ({ path, method }))).toEqual(
      expect.arrayContaining([
        { path: '/oas31/search', method: 'get' },
        { path: '/oas31/json', method: 'post' },
        { path: '/oas31/raw-binary', method: 'post' },
        { path: '/oas31/multipart', method: 'post' },
      ]),
    );

    const getBody = buildOperationDebugModel({
      doc: springdocDocument as Parameters<typeof buildOperationDebugModel>[0]['doc'],
      path: '/oas31/search',
      method: 'get',
    });
    expect(getBody.queryParams).toEqual([
      expect.objectContaining({
        name: 'limit',
        in: 'query',
        required: false,
        description: 'Optional result limit',
        type: 'integer',
        format: 'int32',
      }),
    ]);
    expect(getBody.bodyRequired).toBe(true);
    expect(getBody.bodyContents).toEqual([
      expect.objectContaining({ mediaType: 'application/json', category: 'json' }),
    ]);

    const rawBinary = buildOperationDebugModel({
      doc: springdocDocument as Parameters<typeof buildOperationDebugModel>[0]['doc'],
      path: '/oas31/raw-binary',
      method: 'post',
    });
    expect(rawBinary.bodyContents).toEqual([
      expect.objectContaining({ mediaType: 'application/octet-stream', category: 'raw', binary: true }),
    ]);

    const multipart = buildOperationDebugModel({
      doc: springdocDocument as Parameters<typeof buildOperationDebugModel>[0]['doc'],
      path: '/oas31/multipart',
      method: 'post',
    });
    expect(multipart.bodyContents[0]).toMatchObject({
      mediaType: 'multipart/form-data',
      category: 'multipart',
      fileFields: ['file', 'files'],
      fileFieldsMultiple: ['files'],
    });

    const retrievalUri = 'https://docs.knife4j.example/v3/api-docs?matrix=boot3-mvc';
    const session = await createSchemaDocumentSession(springdocDocument, retrievalUri);
    sessions.push(session);
    const jsonOperation = operations.find(({ path, method }) => path === '/oas31/json' && method === 'post');
    if (!jsonOperation) throw new Error('expected the Springdoc JSON matrix operation');
    const examples = await generateOperationSchemaExamples(springdocDocument, jsonOperation, session);
    expect(examples.request?.result).toMatchObject({
      status: 'value',
      source: 'generated',
      validation: 'valid',
      value: {
        nullableName: 'matrix',
        metadata: {},
        mode: 'stable',
        tuple: [{}, {}],
      },
    });
    expect(examples.responses[0]).toMatchObject({
      statusCode: '200',
      mediaType: 'application/json',
      result: {
        status: 'value',
        source: 'generated',
        validation: 'valid',
        value: { id: 1, serverValue: 'server' },
      },
    });

    const invalidRequest = prepareRequestBodySchemaEvaluation({
      document: springdocDocument,
      operation: jsonOperation,
      schemaMediaType: 'application/json',
      effectiveContentType: 'application/json',
      body: JSON.stringify({ mode: 'changed', tuple: [{}] }),
    });
    if (invalidRequest.status !== 'ready') throw new Error('expected the Springdoc request diagnostic target');
    const requestDiagnostic = await evaluateRequestBodySchema(session, invalidRequest);
    expect(requestDiagnostic).toMatchObject({ status: 'invalid' });
    if (requestDiagnostic.status !== 'invalid') throw new Error('expected invalid request diagnostics');
    expect(requestDiagnostic.issues.map(({ keyword }) => keyword)).toEqual(
      expect.arrayContaining(['const', 'minItems']),
    );

    const invalidResponse = prepareResponseBodySchemaEvaluation({
      document: springdocDocument,
      operation: jsonOperation,
      statusCode: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ serverValue: 'server' }),
    });
    if (invalidResponse.status !== 'ready') throw new Error('expected the Springdoc response diagnostic target');
    const responseDiagnostic = await evaluateResponseBodySchema(session, invalidResponse);
    expect(responseDiagnostic).toMatchObject({ status: 'invalid' });
    if (responseDiagnostic.status !== 'invalid') throw new Error('expected invalid response diagnostics');
    expect(responseDiagnostic.issues.map(({ keyword }) => keyword)).toContain('required');

    const projector = createSchemaDisplayProjector(session);
    const models = await projectSchemaModels(springdocDocument.components?.schemas ?? {}, springdocDocument, projector);

    expect(models.failures).toEqual([]);
    expect(models.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Oas31MatrixRequest',
          source: 'schema-engine',
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'nullableName',
              types: ['string', 'null'],
              example: 'matrix',
            }),
            expect.objectContaining({ name: 'metadata', type: 'object' }),
            expect.objectContaining({ name: 'mode', constValue: 'stable', example: 'stable' }),
            expect.objectContaining({
              name: 'tuple',
              type: 'array',
              truncated: true,
              truncationReason: 'projection-loss',
              children: expect.arrayContaining([
                expect.objectContaining({ name: '[0]', type: 'unknown' }),
                expect.objectContaining({ name: '[1]', type: 'unknown' }),
              ]),
            }),
          ]),
        }),
      ]),
    );

    await expect(
      session.evaluate('#/components/schemas/Oas31MatrixRequest', {
        nullableName: null,
        metadata: {},
        mode: 'stable',
        tuple: ['left', 1],
      }),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      session.evaluate('#/components/schemas/Oas31MatrixRequest', {
        mode: 'changed',
        tuple: ['only-one'],
      }),
    ).resolves.toMatchObject({ valid: false });

    const apiDoc = await projectApiDocSchemaRegions(
      [
        {
          key: REQUEST_BODY_REGION_KEY,
          schema: { $ref: '#/components/schemas/Oas31MatrixRequest' },
          mode: 'request',
        },
        {
          key: responseSchemaRegionKey('200'),
          schema: { $ref: '#/components/schemas/Oas31MatrixResponse' },
          mode: 'response',
        },
      ],
      projector,
    );
    expect(apiDoc.failures).toEqual([]);
    expect(apiDoc.regions[0].fields.map(({ name }) => name)).toEqual(['nullableName', 'metadata', 'mode', 'tuple']);
    expect(apiDoc.regions[1].fields.map(({ name }) => name)).toEqual(['id', 'serverValue']);
  });

  test('consumes standards-only references, keeps webhooks read-only, and denies external loading', async () => {
    const operations = parseMenuTags(supplementDocument).flatMap((tag) => tag.operations);
    const referenceOperation = operations.find(
      ({ path, method, source }) => path === '/supplement/reference' && method === 'post' && source === 'path',
    );
    if (!referenceOperation) throw new Error('expected the standards-only Reference Object operation');
    const webhook = operations.find(({ source }) => source === 'webhook');
    expect(webhook).toMatchObject({
      path: 'matrix.changed',
      method: 'post',
      source: 'webhook',
    });
    expect(visibleOperationModeKeys(webhook?.source, true, true)).toEqual(['doc', 'openapi']);

    const referenceDebugModel = buildOperationDebugModel({
      doc: supplementDocument as Parameters<typeof buildOperationDebugModel>[0]['doc'],
      path: referenceOperation.path,
      method: referenceOperation.method,
    });
    expect(referenceDebugModel.bodyRequired).toBe(true);
    expect(referenceDebugModel.bodyContents).toEqual([
      expect.objectContaining({ mediaType: 'application/json', category: 'json' }),
    ]);

    const rawReferencePathItem = supplementDocument.paths?.['/supplement/reference'] as unknown as Record<
      string,
      unknown
    >;
    const rawReferenceOperation = rawReferencePathItem.post as Record<string, unknown>;
    const rawRequestBody = rawReferenceOperation.requestBody as Record<string, unknown>;
    expect(rawRequestBody).toMatchObject({
      $ref: '#/components/requestBodies/MatrixInput',
      summary: 'Referenced matrix input',
      description: 'Reference Object siblings are legal in OpenAPI 3.1.',
    });
    const requestBody = dereferenceReferenceObject(
      rawRequestBody,
      supplementDocument as unknown as Record<string, unknown>,
    );
    expect(requestBody).toMatchObject({
      required: true,
      description: 'Reference Object siblings are legal in OpenAPI 3.1.',
    });
    expect(requestBody).not.toHaveProperty('summary');
    const rawResponses = rawReferenceOperation.responses as Record<string, unknown>;
    const rawAcceptedResponse = rawResponses['202'] as Record<string, unknown>;
    expect(rawAcceptedResponse).toMatchObject({
      $ref: '#/components/responses/Accepted',
      summary: 'Referenced accepted response',
      description: 'The response remains a Reference Object.',
    });
    const response = dereferenceReferenceObject(
      rawAcceptedResponse,
      supplementDocument as unknown as Record<string, unknown>,
    );
    expect(response).toMatchObject({
      description: 'The response remains a Reference Object.',
    });
    expect(response).not.toHaveProperty('summary');

    const fetchImpl = vi.fn(async () => {
      throw new Error('ungranted resources must not be fetched');
    });
    const loader = new ExternalResourceLoader(
      supplementDocument,
      'https://docs.knife4j.example/v3/browser-supplement.json',
      {
        pageUri: 'https://docs.knife4j.example/doc.html',
        fetchImpl,
      },
    );
    expect(loader.discover().candidates).toEqual([
      expect.objectContaining({
        retrievalUriHash: expect.any(String),
        sameOrigin: false,
      }),
    ]);

    const snapshot = await loader.load([]);
    expect(snapshot.complete).toBe(false);
    expect(snapshot.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetRetrievalUri: 'https://unapproved.knife4j.example/schema.json',
          state: 'pending',
        }),
      ]),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    loader.dispose();

    const session = await createSchemaDocumentSession(
      supplementDocument,
      'https://docs.knife4j.example/v3/browser-supplement.json',
    );
    sessions.push(session);
    const referenceExamples = await generateOperationSchemaExamples(supplementDocument, referenceOperation, session);
    expect(referenceExamples.request).toMatchObject({
      mediaType: 'application/json',
      result: {
        status: 'value',
        validation: 'valid',
        value: {
          metadata: { source: 'springdoc' },
          tuple: ['stable', 1],
          mode: 'stable',
        },
      },
    });
    expect(referenceExamples.responses).toEqual([
      expect.objectContaining({
        statusCode: '202',
        mediaType: 'application/json',
        result: expect.objectContaining({ status: 'value', validation: 'valid' }),
      }),
    ]);

    const referenceProjection = await projectApiDocSchemaRegions(
      [
        {
          key: REQUEST_BODY_REGION_KEY,
          schema: { $ref: '#/components/schemas/MatrixInput' },
          mode: 'request',
        },
        {
          key: responseSchemaRegionKey('202'),
          schema: { $ref: '#/components/schemas/MatrixEvent' },
          mode: 'response',
        },
      ],
      createSchemaDisplayProjector(session),
    );
    expect(referenceProjection.failures).toEqual([]);
    expect(referenceProjection.regions[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'metadata',
          type: 'object',
          children: [expect.objectContaining({ name: 'source', type: 'string', example: 'springdoc' })],
        }),
        expect.objectContaining({
          name: 'tuple',
          type: 'array',
          children: expect.arrayContaining([
            expect.objectContaining({ name: '[0]', type: 'string' }),
            expect.objectContaining({ name: '[1]', type: 'integer' }),
          ]),
        }),
        expect.objectContaining({ name: 'mode', constValue: 'stable', example: 'stable' }),
      ]),
    );
    expect(referenceProjection.regions[1].fields).toEqual([
      expect.objectContaining({ name: 'payload', type: 'object' }),
    ]);
    await expect(session.evaluate('#/components/schemas/TypedTuple', ['stable', 1])).resolves.toMatchObject({
      valid: true,
    });
    await expect(session.evaluate('#/components/schemas/TypedTuple', ['stable', 'one'])).resolves.toMatchObject({
      valid: false,
    });
    await expect(session.evaluate('#/components/schemas/ExternalPayload', {})).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
    });
  });
});
