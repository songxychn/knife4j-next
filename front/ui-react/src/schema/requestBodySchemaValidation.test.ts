import { afterEach, describe, expect, test, vi } from 'vitest';
import type { EvaluationResult } from 'knife4j-schema-engine';
import type { MenuOperation, OperationObject, SwaggerDoc } from '../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import {
  consumeRequestBodySchemaOverride,
  evaluateRequestBodySchema,
  effectiveRequestContentType,
  isJsonCompatibleMediaType,
  prepareRequestBodySchemaEvaluation,
  requestBodyInstanceLabel,
} from './requestBodySchemaValidation';

const sessions: SchemaDocumentSession[] = [];

function operation(path: string, operationObject: OperationObject, method = 'post'): MenuOperation {
  return {
    key: `pets/${method}`,
    path,
    method,
    summary: 'request body validation',
    operation: operationObject,
    source: 'path',
  };
}

function documentWithSchema(schema: unknown, mediaType = 'application/json'): SwaggerDoc {
  const operationObject: OperationObject = {
    requestBody: {
      content: {
        [mediaType]: { schema: schema as never },
      },
    },
    responses: { 204: { description: 'accepted' } },
  };
  return {
    openapi: '3.1.1',
    info: { title: 'Request diagnostics', version: '1.0.0' },
    paths: { '/pets/{id}': { post: operationObject } },
  };
}

function fakeSession(result: EvaluationResult) {
  const evaluate = vi.fn(async () => result);
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

describe('request body validation preparation', () => {
  test('recognizes JSON media types using their media essence', () => {
    expect(isJsonCompatibleMediaType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonCompatibleMediaType('application/problem+json')).toBe(true);
    expect(isJsonCompatibleMediaType('text/vnd.example+json')).toBe(true);
    expect(isJsonCompatibleMediaType('text/json')).toBe(false);
    expect(isJsonCompatibleMediaType('application/xml')).toBe(false);
    expect(effectiveRequestContentType({ 'content-type': 'application/problem+json' }, 'text/plain')).toBe(
      'application/problem+json',
    );
    expect(effectiveRequestContentType({}, 'application/json')).toBe('application/json');
  });

  test('addresses an inline schema without copying it out of the OAS document', async () => {
    const mediaType = 'application/problem+json';
    const document = documentWithSchema({ type: 'object' }, mediaType);
    const currentOperation = operation('/pets/{id}', document.paths['/pets/{id}'].post!);
    const prepared = prepareRequestBodySchemaEvaluation({
      document,
      operation: currentOperation,
      schemaMediaType: mediaType,
      effectiveContentType: `${mediaType}; charset=utf-8`,
      body: '{"id":1}',
    });

    expect(prepared).toMatchObject({
      status: 'ready',
      reference: '#/paths/~1pets~1%7Bid%7D/post/requestBody/content/application~1problem%2Bjson/schema',
      instance: { id: 1 },
    });
    if (prepared.status !== 'ready') throw new Error('expected a prepared schema evaluation');

    const { session, evaluate } = fakeSession({ valid: true, errors: [], annotations: [] });
    await expect(evaluateRequestBodySchema(session, prepared)).resolves.toEqual({ status: 'valid' });
    expect(evaluate).toHaveBeenCalledWith(prepared.reference, { id: 1 }, { signal: undefined });
  });

  test('follows local Path Item and Request Body references while preserving the schema URI', () => {
    const operationObject: OperationObject = {
      requestBody: { $ref: '#/components/requestBodies/Pet~1Body' },
      responses: { 204: { description: 'accepted' } },
    };
    const document: SwaggerDoc = {
      openapi: '3.1.1',
      info: { title: 'References', version: '1.0.0' },
      paths: { '/pets': { $ref: '#/components/pathItems/Pet~1Path' } },
      components: {
        pathItems: { 'Pet/Path': { post: operationObject } },
        requestBodies: {
          'Pet/Body': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
        schemas: { Pet: { type: 'object' } },
      },
    };

    expect(
      prepareRequestBodySchemaEvaluation({
        document,
        operation: operation('/pets', operationObject),
        schemaMediaType: 'application/json',
        effectiveContentType: 'application/json',
        body: '{}',
      }),
    ).toMatchObject({
      status: 'ready',
      reference: '#/components/requestBodies/Pet~1Body/content/application~1json/schema',
    });
  });

  test('keeps non-applicable requests out and distinguishes unavailable references', () => {
    const document = documentWithSchema({ type: 'object' });
    const currentOperation = operation('/pets/{id}', document.paths['/pets/{id}'].post!);
    const base = {
      document,
      operation: currentOperation,
      schemaMediaType: 'application/json',
      effectiveContentType: 'application/json',
      body: '{}',
    };

    expect(prepareRequestBodySchemaEvaluation({ ...base, effectiveContentType: 'text/plain' })).toEqual({
      status: 'skipped',
      reason: 'content-type',
    });
    expect(prepareRequestBodySchemaEvaluation({ ...base, body: '   ' })).toEqual({
      status: 'skipped',
      reason: 'empty-body',
    });
    expect(
      prepareRequestBodySchemaEvaluation({
        ...base,
        document: { ...document, openapi: '3.0.4' },
      }),
    ).toEqual({ status: 'skipped', reason: 'version' });
    expect(prepareRequestBodySchemaEvaluation({ ...base, body: '{broken' })).toEqual({ status: 'invalid-json' });

    const externalOperation: OperationObject = {
      requestBody: { $ref: 'https://schemas.example.test/request-body' },
    };
    const externalDocument: SwaggerDoc = {
      ...document,
      paths: { '/external': { post: externalOperation } },
    };
    expect(
      prepareRequestBodySchemaEvaluation({
        ...base,
        document: externalDocument,
        operation: operation('/external', externalOperation),
      }),
    ).toEqual({ status: 'unavailable' });
  });
});

describe('request body schema evaluation', () => {
  test('uses JSON Schema 2020-12 conditionals and boolean schemas through the document session', async () => {
    const mediaType = 'application/problem+json';
    const conditionalSchema = {
      type: 'object',
      properties: {
        kind: { enum: ['business', 'personal'] },
        taxId: { type: 'string' },
      },
      required: ['kind'],
      if: { properties: { kind: { const: 'business' } }, required: ['kind'] },
      then: { required: ['taxId'] },
      unevaluatedProperties: false,
    };
    const document = documentWithSchema(conditionalSchema, mediaType);
    const currentOperation = operation('/pets/{id}', document.paths['/pets/{id}'].post!);
    const session = await createSchemaDocumentSession(
      document,
      'https://fixtures.knife4j.example/request-diagnostics.json',
    );
    sessions.push(session);

    const prepare = (body: string) =>
      prepareRequestBodySchemaEvaluation({
        document,
        operation: currentOperation,
        schemaMediaType: mediaType,
        effectiveContentType: `${mediaType}; charset=utf-8`,
        body,
      });
    const valid = prepare('{"kind":"business","taxId":"91310000"}');
    const invalid = prepare('{"kind":"business","extra":true}');
    if (valid.status !== 'ready' || invalid.status !== 'ready') throw new Error('expected prepared evaluations');

    await expect(evaluateRequestBodySchema(session, valid)).resolves.toEqual({ status: 'valid' });
    await expect(evaluateRequestBodySchema(session, invalid)).resolves.toMatchObject({
      status: 'invalid',
      issues: expect.arrayContaining([
        expect.objectContaining({
          instanceLocation: '',
          keyword: expect.stringMatching(/required|unevaluatedProperties/),
        }),
      ]),
    });

    session.dispose();
    const falseDocument = documentWithSchema(false);
    const falseSession = await createSchemaDocumentSession(
      falseDocument,
      'https://fixtures.knife4j.example/false-request.json',
    );
    sessions.push(falseSession);
    const falsePrepared = prepareRequestBodySchemaEvaluation({
      document: falseDocument,
      operation: operation('/pets/{id}', falseDocument.paths['/pets/{id}'].post!),
      schemaMediaType: 'application/json',
      effectiveContentType: 'application/json',
      body: 'null',
    });
    if (falsePrepared.status !== 'ready') throw new Error('expected a prepared boolean schema evaluation');
    await expect(evaluateRequestBodySchema(falseSession, falsePrepared)).resolves.toMatchObject({ status: 'invalid' });
  });

  test('flattens nested output, de-duplicates issues and caps the visible list', async () => {
    const nestedError = {
      keyword: 'https://json-schema.org/keyword/oneOf',
      absoluteKeywordLocation: 'https://schemas.example.test/body#/oneOf',
      instanceLocation: '#',
      valid: false,
      errors: [
        {
          keyword: 'https://json-schema.org/keyword/type',
          absoluteKeywordLocation: 'https://schemas.example.test/body#/oneOf/0/type',
          instanceLocation: '#/profile/age',
          valid: false,
        },
        {
          keyword: 'https://json-schema.org/keyword/type',
          absoluteKeywordLocation: 'https://schemas.example.test/body#/oneOf/0/type',
          instanceLocation: '#/profile/age',
          valid: false,
        },
        {
          keyword: 'https://json-schema.org/keyword/required',
          absoluteKeywordLocation: 'https://schemas.example.test/body#/oneOf/1/required',
          instanceLocation: '#/profile',
          valid: false,
        },
      ],
    };
    const { session } = fakeSession({ valid: false, errors: [nestedError], annotations: [] });
    const result = await evaluateRequestBodySchema(
      session,
      { status: 'ready', reference: '#/components/schemas/Body', instance: {} },
      { maxIssues: 1 },
    );

    expect(result).toEqual({
      status: 'invalid',
      totalIssues: 2,
      issues: [
        {
          instanceLocation: '#/profile/age',
          keyword: 'type',
          absoluteKeywordLocation: 'https://schemas.example.test/body#/oneOf/0/type',
        },
      ],
    });
    expect(requestBodyInstanceLabel('')).toBe('$');
    expect(requestBodyInstanceLabel('/profile/age')).toBe('$/profile/age');
  });

  test('consumes a matching override exactly once and rejects stale routes', () => {
    const consumed = consumeRequestBodySchemaOverride(4, 4, 'group|tag|operation', 'group|tag|operation');
    expect(consumed).toBe(5);
    expect(consumeRequestBodySchemaOverride(4, consumed!, 'group|tag|operation', 'group|tag|operation')).toBeNull();
    expect(consumeRequestBodySchemaOverride(4, 4, 'old', 'new')).toBeNull();
  });
});
