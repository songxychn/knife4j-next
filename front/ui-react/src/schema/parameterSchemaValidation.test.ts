import { afterEach, describe, expect, test, vi } from 'vitest';
import type { BuiltParameterInstance } from 'knife4j-core';
import type { EvaluationResult } from 'knife4j-schema-engine';
import type { MenuOperation, OperationObject, SwaggerDoc } from '../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import {
  evaluateParameterSchemas,
  parameterInstanceLabel,
  prepareParameterSchemaEvaluation,
} from './parameterSchemaValidation';

const sessions: SchemaDocumentSession[] = [];

function menuOperation(document: SwaggerDoc, method = 'get'): MenuOperation {
  return {
    key: `parameters/${method}`,
    path: '/pets/{id}',
    method,
    summary: 'parameter validation',
    operation: document.paths['/pets/{id}'][method] as OperationObject,
    source: 'path',
  };
}

function instance(
  name: string,
  location: BuiltParameterInstance['in'],
  value: BuiltParameterInstance['instance'],
): BuiltParameterInstance {
  return { key: `${location}:${name}`, name, in: location, instance: value };
}

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

describe('parameter schema preparation', () => {
  test('locates Path Item, operation override, referenced and content schemas in the original document', () => {
    const operationObject = {
      parameters: [
        { name: 'filter', in: 'query', schema: false },
        { $ref: '#/components/parameters/Trace~1Header' },
        {
          name: 'state',
          in: 'cookie',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      ],
      responses: { 204: { description: 'accepted' } },
    } as unknown as OperationObject;
    const document: SwaggerDoc = {
      openapi: '3.1.1',
      info: { title: 'Parameter schemas', version: '1.0.0' },
      paths: {
        '/pets/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'filter', in: 'query', schema: { type: 'string' } },
          ],
          get: operationObject,
        },
      },
      components: {
        parameters: {
          'Trace/Header': {
            name: 'X-Trace',
            in: 'header',
            schema: { type: 'string', pattern: '^[A-Z]+$' },
          },
        },
      },
    };
    const instances = [
      instance('id', 'path', 7),
      instance('filter', 'query', 'active'),
      instance('X-Trace', 'header', 'TRACE'),
      instance('state', 'cookie', { page: 1 }),
      instance('missing', 'query', 'value'),
    ];

    expect(prepareParameterSchemaEvaluation({ document, operation: menuOperation(document), instances })).toEqual({
      status: 'ready',
      evaluations: [
        { ...instances[0], reference: '#/paths/~1pets~1%7Bid%7D/parameters/0/schema' },
        { ...instances[1], reference: '#/paths/~1pets~1%7Bid%7D/get/parameters/0/schema' },
        { ...instances[2], reference: '#/components/parameters/Trace~1Header/schema' },
        {
          ...instances[3],
          reference: '#/paths/~1pets~1%7Bid%7D/get/parameters/2/content/application~1json/schema',
        },
      ],
      unavailable: [instances[4]],
    });
  });

  test('does not activate for OAS 3.0 or an empty parameter snapshot', () => {
    const document: SwaggerDoc = {
      openapi: '3.0.4',
      info: { title: 'Legacy', version: '1.0.0' },
      paths: { '/pets/{id}': { get: { responses: {} } } },
    };
    expect(
      prepareParameterSchemaEvaluation({
        document,
        operation: menuOperation(document),
        instances: [instance('id', 'path', 1)],
      }),
    ).toEqual({ status: 'skipped', reason: 'version' });
    expect(
      prepareParameterSchemaEvaluation({
        document: { ...document, openapi: '3.1.2' },
        operation: undefined,
        instances: [],
      }),
    ).toEqual({ status: 'skipped', reason: 'version' });
  });
});

describe('parameter schema evaluation', () => {
  test('evaluates all four parameter locations with JSON Schema 2020-12 and boolean schemas', async () => {
    const operationObject = {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
        { name: 'filter', in: 'query', schema: { type: ['string', 'null'], minLength: 2 } },
        { name: 'X-Trace', in: 'header', schema: { type: 'string', pattern: '^[A-Z]+$' } },
        {
          name: 'state',
          in: 'cookie',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { page: { type: 'integer' } },
                required: ['page'],
                unevaluatedProperties: false,
              },
            },
          },
        },
        { name: 'blocked', in: 'query', schema: false },
      ],
      responses: { 204: { description: 'accepted' } },
    } as unknown as OperationObject;
    const document: SwaggerDoc = {
      openapi: '3.1.1',
      info: { title: 'Parameter schemas', version: '1.0.0' },
      paths: { '/pets/{id}': { get: operationObject } },
    };
    const instances = [
      instance('id', 'path', 0),
      instance('filter', 'query', 'ok'),
      instance('X-Trace', 'header', 'trace-1'),
      instance('state', 'cookie', { extra: true }),
      instance('blocked', 'query', 'anything'),
    ];
    const preparation = prepareParameterSchemaEvaluation({ document, operation: menuOperation(document), instances });
    if (preparation.status !== 'ready') throw new Error('expected parameter preparation');

    const session = await createSchemaDocumentSession(document, 'https://fixtures.knife4j.example/parameters.json');
    sessions.push(session);
    await expect(evaluateParameterSchemas(session, preparation)).resolves.toMatchObject({
      status: 'invalid',
      issues: expect.arrayContaining([
        expect.objectContaining({ key: 'path:id', in: 'path', keyword: 'minimum' }),
        expect.objectContaining({ key: 'header:X-Trace', in: 'header', keyword: 'pattern' }),
        expect.objectContaining({ key: 'cookie:state', in: 'cookie' }),
        expect.objectContaining({ key: 'query:blocked', in: 'query' }),
      ]),
    });
  });

  test('flattens issues, caps display output and forwards cancellation to the session', async () => {
    const evaluationError = {
      keyword: 'https://json-schema.org/keyword/type',
      absoluteKeywordLocation: 'https://schemas.example.test/parameter#/type',
      instanceLocation: '#/value',
      valid: false,
    };
    const evaluate = vi.fn(async (_reference, _value, options) => {
      if (options?.signal?.aborted) throw Object.assign(new Error('aborted'), { code: 'OPERATION_ABORTED' });
      return { valid: false, errors: [evaluationError], annotations: [] } satisfies EvaluationResult;
    });
    const session: SchemaDocumentSession = {
      retrievalUri: 'https://fixtures.knife4j.example/openapi.json',
      resolve: async () => {
        throw new Error('not used');
      },
      evaluate,
      dispose: vi.fn(),
    };
    const preparation = {
      status: 'ready' as const,
      evaluations: [
        { ...instance('first', 'query', 1), reference: '#/components/schemas/First' },
        { ...instance('second', 'header', 2), reference: '#/components/schemas/Second' },
      ],
      unavailable: [],
    };

    await expect(evaluateParameterSchemas(session, preparation, { maxIssues: 1 })).resolves.toEqual({
      status: 'invalid',
      totalIssues: 2,
      issues: [
        {
          key: 'query:first',
          name: 'first',
          in: 'query',
          instanceLocation: '#/value',
          keyword: 'type',
          absoluteKeywordLocation: 'https://schemas.example.test/parameter#/type',
        },
      ],
    });
    expect(parameterInstanceLabel('')).toBe('$');
    expect(parameterInstanceLabel('/value')).toBe('$/value');

    const controller = new AbortController();
    controller.abort();
    await expect(evaluateParameterSchemas(session, preparation, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  test('propagates schema-engine budget rejection without converting it into a valid result', async () => {
    const budgetError = Object.assign(new Error('evaluation budget exceeded'), {
      code: 'EVALUATION_BUDGET_EXCEEDED',
    });
    const session: SchemaDocumentSession = {
      retrievalUri: 'https://fixtures.knife4j.example/openapi.json',
      resolve: async () => {
        throw new Error('not used');
      },
      evaluate: vi.fn().mockRejectedValue(budgetError),
      dispose: vi.fn(),
    };
    const preparation = {
      status: 'ready' as const,
      evaluations: [{ ...instance('filter', 'query', { role: 'admin' }), reference: '#/components/schemas/Filter' }],
      unavailable: [],
    };

    await expect(evaluateParameterSchemas(session, preparation)).rejects.toBe(budgetError);
  });
});
