import { afterEach, describe, expect, test, vi } from 'vitest';
import type { EvaluationResult } from 'knife4j-schema-engine';
import type { MenuOperation, OperationObject, SwaggerDoc } from '../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import {
  evaluateResponseBodySchema,
  isResponseBodySchemaEvaluationAborted,
  prepareResponseBodySchemaEvaluation,
  responseBodyInstanceLabel,
  responseBodySchemaFailureDiagnostic,
  responseBodySchemaResultIsCurrent,
  responseSchemaMediaTypeKey,
  responseSchemaStatusKey,
} from './responseBodySchemaValidation';

const sessions: SchemaDocumentSession[] = [];

function menuOperation(path: string, operationObject: OperationObject, method = 'get'): MenuOperation {
  return {
    key: `diagnostics/${method}`,
    path,
    method,
    summary: 'response body diagnostics',
    operation: operationObject,
    source: 'path',
  };
}

function documentWithResponses(responses: OperationObject['responses']): {
  document: SwaggerDoc;
  operation: MenuOperation;
} {
  const operationObject: OperationObject = { responses };
  const document: SwaggerDoc = {
    openapi: '3.1.1',
    info: { title: 'Response diagnostics', version: '1.0.0' },
    paths: { '/diagnostics': { get: operationObject } },
  };
  return { document, operation: menuOperation('/diagnostics', operationObject) };
}

function fakeSession(result: EvaluationResult | Error) {
  const evaluate = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const session: SchemaDocumentSession = {
    retrievalUri: 'https://fixtures.knife4j.example/openapi.json',
    resolve: async () => {
      throw new Error('not used');
    },
    evaluate,
    dispose: vi.fn(),
  };
  return { session, evaluate };
}

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

describe('response schema selection', () => {
  test('prefers an exact status, then the uppercase range, then default', () => {
    expect(responseSchemaStatusKey({ 200: {}, '2XX': {}, default: {} }, 200)).toBe('200');
    expect(responseSchemaStatusKey({ '2XX': {}, default: {} }, 204)).toBe('2XX');
    expect(responseSchemaStatusKey({ '2xx': {}, default: {} }, 204)).toBe('default');
    expect(responseSchemaStatusKey({ default: {} }, 422)).toBe('default');
    expect(responseSchemaStatusKey({ 200: {} }, 422)).toBeNull();
  });

  test('uses the most specific media range without substituting another concrete JSON type', () => {
    const content = {
      '*/*': {},
      'application/*': {},
      'application/problem+json': {},
    };
    expect(responseSchemaMediaTypeKey(content, 'Application/Problem+Json; charset=utf-8')).toBe(
      'application/problem+json',
    );
    expect(responseSchemaMediaTypeKey({ '*/*': {}, 'application/*': {} }, 'application/problem+json')).toBe(
      'application/*',
    );
    expect(responseSchemaMediaTypeKey({ 'application/json': {} }, 'application/problem+json')).toBeNull();
    expect(responseSchemaMediaTypeKey({ 'application/*+json': {} }, 'application/problem+json')).toBeNull();
  });

  test('locates exact, range, and default response schemas', () => {
    const { document, operation } = documentWithResponses({
      200: { content: { 'application/json': { schema: { const: 'exact' } } } },
      '2XX': { content: { 'application/*': { schema: { const: 'range' } } } },
      default: { content: { '*/*': { schema: { const: 'default' } } } },
    });
    const prepare = (statusCode: number, contentType = 'application/json') =>
      prepareResponseBodySchemaEvaluation({
        document,
        operation,
        statusCode,
        contentType,
        body: '"value"',
      });

    expect(prepare(200)).toMatchObject({ status: 'ready', responseKey: '200', mediaType: 'application/json' });
    expect(prepare(204, 'application/problem+json')).toMatchObject({
      status: 'ready',
      responseKey: '2XX',
      mediaType: 'application/*',
    });
    expect(prepare(422)).toMatchObject({ status: 'ready', responseKey: 'default', mediaType: '*/*' });
  });

  test('follows local Path Item and Response Object references while preserving the schema URI', () => {
    const operationObject: OperationObject = {
      responses: { 200: { $ref: '#/components/responses/Success~1Response' } },
    };
    const document: SwaggerDoc = {
      openapi: '3.1.1',
      info: { title: 'References', version: '1.0.0' },
      paths: { '/diagnostics': { $ref: '#/components/pathItems/Diagnostics~1Path' } },
      components: {
        pathItems: { 'Diagnostics/Path': { get: operationObject } },
        responses: {
          'Success/Response': {
            content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Envelope' } } },
          },
        },
        schemas: { Envelope: { type: 'object' } },
      },
    };

    expect(
      prepareResponseBodySchemaEvaluation({
        document,
        operation: menuOperation('/diagnostics', operationObject),
        statusCode: 200,
        contentType: 'application/problem+json; charset=utf-8',
        body: '{}',
      }),
    ).toMatchObject({
      status: 'ready',
      reference: '#/components/responses/Success~1Response/content/application~1problem%2Bjson/schema',
    });
  });

  test('skips unsupported responses and distinguishes an unavailable response reference', () => {
    const { document, operation } = documentWithResponses({
      200: { content: { 'application/json': { schema: { type: 'object' } } } },
    });
    const base = { document, operation, statusCode: 200, contentType: 'application/json', body: '{}' };

    expect(prepareResponseBodySchemaEvaluation({ ...base, document: { ...document, openapi: '3.0.4' } })).toEqual({
      status: 'skipped',
      reason: 'version',
    });
    expect(prepareResponseBodySchemaEvaluation({ ...base, contentType: 'text/plain' })).toEqual({
      status: 'skipped',
      reason: 'content-type',
    });
    expect(prepareResponseBodySchemaEvaluation({ ...base, body: '  ' })).toEqual({
      status: 'skipped',
      reason: 'empty-body',
    });
    expect(prepareResponseBodySchemaEvaluation({ ...base, statusCode: 404 })).toEqual({
      status: 'skipped',
      reason: 'no-response',
    });
    expect(prepareResponseBodySchemaEvaluation({ ...base, body: '{broken' })).toEqual({ status: 'invalid-json' });

    const noMatchingMedia = documentWithResponses({
      200: { content: { 'application/json': { schema: { type: 'object' } } } },
    });
    expect(
      prepareResponseBodySchemaEvaluation({
        ...base,
        ...noMatchingMedia,
        contentType: 'application/problem+json',
      }),
    ).toEqual({ status: 'skipped', reason: 'no-schema' });

    const external = documentWithResponses({
      200: { $ref: 'https://schemas.example.test/responses/success' },
    });
    expect(prepareResponseBodySchemaEvaluation({ ...base, ...external })).toEqual({ status: 'unavailable' });
  });
});

describe('response schema evaluation', () => {
  test('evaluates conditionals, combinations, nested paths, and boolean schemas through the document session', async () => {
    const schema = {
      type: 'object',
      properties: {
        kind: { enum: ['business', 'personal'] },
        detail: {
          oneOf: [
            { type: 'object', required: ['taxId'], properties: { taxId: { type: 'string' } } },
            { type: 'object', required: ['nickname'], properties: { nickname: { type: 'string' } } },
          ],
        },
      },
      required: ['kind', 'detail'],
      if: { properties: { kind: { const: 'business' } }, required: ['kind'] },
      then: { properties: { detail: { required: ['taxId'] } } },
    };
    const { document, operation } = documentWithResponses({
      200: { description: 'valid or invalid envelope', content: { 'application/json': { schema } } },
      400: { description: 'always invalid', content: { 'application/json': { schema: false as never } } },
    });
    const session = await createSchemaDocumentSession(document, 'https://fixtures.knife4j.example/responses.json');
    sessions.push(session);
    const prepare = (statusCode: number, body: string) =>
      prepareResponseBodySchemaEvaluation({ document, operation, statusCode, contentType: 'application/json', body });

    const valid = prepare(200, '{"kind":"business","detail":{"taxId":"91310000"}}');
    const invalid = prepare(200, '{"kind":"business","detail":{"taxId":1}}');
    const booleanFalse = prepare(400, 'null');
    if (valid.status !== 'ready' || invalid.status !== 'ready' || booleanFalse.status !== 'ready') {
      throw new Error('expected prepared response evaluations');
    }

    await expect(evaluateResponseBodySchema(session, valid)).resolves.toEqual({ status: 'valid' });
    await expect(evaluateResponseBodySchema(session, invalid)).resolves.toMatchObject({
      status: 'invalid',
      issues: expect.arrayContaining([
        expect.objectContaining({ instanceLocation: expect.stringContaining('/detail/taxId'), keyword: 'type' }),
      ]),
    });
    await expect(evaluateResponseBodySchema(session, booleanFalse)).resolves.toMatchObject({ status: 'invalid' });
  });

  test('caps nested issues, passes cancellation, and rejects stale request results', async () => {
    const nestedError = {
      keyword: 'https://json-schema.org/keyword/oneOf',
      absoluteKeywordLocation: 'https://schemas.example.test/body#/oneOf',
      instanceLocation: '',
      valid: false,
      errors: [
        {
          keyword: 'https://json-schema.org/keyword/type',
          absoluteKeywordLocation: 'https://schemas.example.test/body#/oneOf/0/type',
          instanceLocation: '/profile/age',
          valid: false,
        },
        {
          keyword: 'https://json-schema.org/keyword/required',
          absoluteKeywordLocation: 'https://schemas.example.test/body#/oneOf/1/required',
          instanceLocation: '/profile',
          valid: false,
        },
      ],
    };
    const { session, evaluate } = fakeSession({ valid: false, errors: [nestedError], annotations: [] });
    const controller = new AbortController();
    const result = await evaluateResponseBodySchema(
      session,
      {
        status: 'ready',
        reference: '#/components/schemas/Envelope',
        instance: {},
        responseKey: '200',
        mediaType: 'application/json',
      },
      { signal: controller.signal, maxIssues: 1 },
    );

    expect(result).toMatchObject({ status: 'invalid', totalIssues: 2, issues: [{ keyword: 'type' }] });
    expect(evaluate).toHaveBeenCalledWith('#/components/schemas/Envelope', {}, { signal: controller.signal });
    expect(responseBodyInstanceLabel('/profile/age')).toBe('$/profile/age');
    expect(responseBodySchemaResultIsCurrent(7, 7, 'group|operation', 'group|operation')).toBe(true);
    expect(responseBodySchemaResultIsCurrent(7, 8, 'group|operation', 'group|operation')).toBe(false);
    expect(responseBodySchemaResultIsCurrent(7, 7, 'old', 'new')).toBe(false);
  });

  test('aborts an in-flight response evaluation through the document session signal', async () => {
    const controller = new AbortController();
    const session: SchemaDocumentSession = {
      retrievalUri: 'https://fixtures.knife4j.example/openapi.json',
      resolve: async () => {
        throw new Error('not used');
      },
      evaluate: async (_reference, _instance, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('aborted'), { code: 'OPERATION_ABORTED' })),
            { once: true },
          );
        }),
      dispose: vi.fn(),
    };
    const evaluation = evaluateResponseBodySchema(
      session,
      {
        status: 'ready',
        reference: '#/components/schemas/Envelope',
        instance: {},
        responseKey: '200',
        mediaType: 'application/json',
      },
      { signal: controller.signal },
    );

    controller.abort();
    await expect(evaluation).rejects.toMatchObject({ code: 'OPERATION_ABORTED' });
  });

  test('classifies budget, reference, engine failures, and cancellation', () => {
    const budget = Object.assign(new Error('budget'), { code: 'EVALUATION_BUDGET_EXCEEDED' });
    const reference = Object.assign(new Error('external'), { code: 'EXTERNAL_RESOURCE_LOADING_DISABLED' });
    const aborted = Object.assign(new Error('aborted'), { code: 'OPERATION_ABORTED' });

    expect(responseBodySchemaFailureDiagnostic(budget)).toEqual({
      status: 'unavailable',
      reason: 'budget-rejected',
    });
    expect(responseBodySchemaFailureDiagnostic(reference)).toEqual({
      status: 'unavailable',
      reason: 'reference-unavailable',
    });
    expect(responseBodySchemaFailureDiagnostic(new Error('engine failed'))).toEqual({
      status: 'unavailable',
      reason: 'evaluation-failed',
      message: 'engine failed',
    });
    expect(isResponseBodySchemaEvaluationAborted(aborted)).toBe(true);
    const controller = new AbortController();
    controller.abort();
    expect(isResponseBodySchemaEvaluationAborted(new Error('late'), controller.signal)).toBe(true);
  });
});
