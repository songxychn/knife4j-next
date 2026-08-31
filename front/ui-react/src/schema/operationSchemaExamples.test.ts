import { afterEach, describe, expect, test, vi } from 'vitest';
import type { MenuOperation, OperationObject, SwaggerDoc } from '../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import {
  formatSchemaExampleValue,
  generateOperationSchemaExample,
  generateOperationSchemaExamples,
  locateRequestSchemaExampleTargets,
  locateResponseSchemaExampleTargets,
} from './operationSchemaExamples';

const sessions: SchemaDocumentSession[] = [];

function currentOperation(document: SwaggerDoc): MenuOperation {
  const operation = document.paths['/messages'].post as OperationObject;
  return {
    key: 'Messages/post',
    path: '/messages',
    method: 'post',
    summary: 'Create message',
    operation,
    source: 'path',
  };
}

function exampleDocument(openapi = '3.1.2'): SwaggerDoc {
  const operation: OperationObject = {
    requestBody: { $ref: '#/components/requestBodies/Message~1Body' },
    responses: {
      200: { $ref: '#/components/responses/Message~1Response' },
      201: {
        description: 'created',
        content: {
          'application/problem+json': {
            schema: { $ref: '#/components/schemas/Message' },
          },
        },
      },
    },
  };
  return {
    openapi,
    info: { title: 'Operation examples', version: '1.0.0' },
    paths: { '/messages': { post: operation } },
    components: {
      examples: {
        'Message/Example': { value: { kind: 'authored', text: 'from example object' } },
      },
      requestBodies: {
        'Message/Body': {
          content: {
            'text/plain': { schema: { type: 'string' } },
            'application/json': {
              schema: { $ref: '#/components/schemas/Message' },
              examples: { authored: { $ref: '#/components/examples/Message~1Example' } },
            },
          },
        },
      },
      responses: {
        'Message/Response': {
          description: 'ok',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Message' },
              example: { kind: 'authored', text: 'from media' },
            },
          },
        },
      },
      schemas: {
        Message: {
          type: 'object',
          required: ['kind', 'text'],
          properties: {
            kind: { enum: ['generated'] },
            text: { type: 'string', minLength: 1 },
          },
          additionalProperties: false,
        },
      },
    },
  };
}

async function openSession(document: SwaggerDoc): Promise<SchemaDocumentSession> {
  const session = await createSchemaDocumentSession(document, 'https://examples.knife4j.example/v3/api-docs');
  sessions.push(session);
  return session;
}

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

describe('operation example targets', () => {
  test('follows local path objects, request bodies, responses and Example Object references', () => {
    const document = exampleDocument();
    const operation = currentOperation(document);
    const requestTargets = locateRequestSchemaExampleTargets(document, operation);
    const responseTargets = locateResponseSchemaExampleTargets(document, operation);

    expect(requestTargets).toEqual([
      expect.objectContaining({
        mediaType: 'text/plain',
        schemaReference: '#/components/requestBodies/Message~1Body/content/text~1plain/schema',
      }),
      expect.objectContaining({
        mediaType: 'application/json',
        schemaReference: '#/components/requestBodies/Message~1Body/content/application~1json/schema',
        explicit: [{ source: 'example-object', value: { kind: 'authored', text: 'from example object' } }],
      }),
    ]);
    expect(responseTargets).toEqual([
      expect.objectContaining({
        statusCode: '200',
        mediaType: 'application/json',
        schemaReference: '#/components/responses/Message~1Response/content/application~1json/schema',
        explicit: [{ source: 'media-example', value: { kind: 'authored', text: 'from media' } }],
      }),
      expect.objectContaining({
        statusCode: '201',
        mediaType: 'application/problem+json',
        schemaReference: '#/paths/~1messages/post/responses/201/content/application~1problem%2Bjson/schema',
      }),
    ]);
  });

  test('stops reading Example Objects after the first usable explicit value', () => {
    const examples: Record<string, unknown> = {};
    Object.defineProperty(examples, 'first', {
      enumerable: true,
      value: { value: { selected: true } },
    });
    Object.defineProperty(examples, 'unused', {
      enumerable: true,
      get: () => {
        throw new Error('unused Example Object must not be read');
      },
    });
    const operationObject: OperationObject = {
      requestBody: {
        content: {
          'application/json': {
            schema: { type: 'object' },
            examples: examples as never,
          },
        },
      },
      responses: {},
    };
    const document: SwaggerDoc = {
      openapi: '3.1.1',
      info: { title: 'Bounded examples', version: '1.0.0' },
      paths: { '/messages': { post: operationObject } },
    };

    expect(locateRequestSchemaExampleTargets(document, currentOperation(document))[0]?.explicit).toEqual([
      { source: 'example-object', value: { selected: true } },
    ]);
  });

  test.each(['3.1.0', '3.1.2'])(
    'keeps ApiDoc and ApiDebug request generation consistent for OAS %s',
    async (version) => {
      const document = exampleDocument(version);
      const operation = currentOperation(document);
      const session = await openSession(document);
      const requestTarget = locateRequestSchemaExampleTargets(document, operation).find(
        (target) => target.mediaType === 'application/json',
      );
      if (!requestTarget) throw new Error('expected the JSON request target');

      const debugResult = await generateOperationSchemaExample(session, requestTarget, 'request');
      const apiDocResult = (await generateOperationSchemaExamples(document, operation, session)).request?.result;

      expect(debugResult).toEqual(apiDocResult);
      expect(debugResult).toMatchObject({
        status: 'value',
        source: 'example-object',
        validation: 'invalid',
        value: { kind: 'authored', text: 'from example object' },
      });
    },
  );

  test('validates every generated response candidate and never fetches an external schema', async () => {
    const document = exampleDocument();
    const operation = currentOperation(document);
    const session = await openSession(document);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not be called'));

    const generated = await generateOperationSchemaExamples(document, operation, session);
    expect(generated.responses[0].result).toMatchObject({
      status: 'value',
      source: 'media-example',
      validation: 'invalid',
    });
    expect(generated.responses[1].result).toMatchObject({
      status: 'value',
      source: 'generated',
      validation: 'valid',
    });
    const second = generated.responses[1].result;
    if (second.status !== 'value') throw new Error('expected a generated response value');
    await expect(
      session.evaluate(
        '#/paths/~1messages/post/responses/201/content/application~1problem%2Bjson/schema',
        second.value,
      ),
    ).resolves.toMatchObject({ valid: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('formats native JSON strings without parsing them and keeps text media literal', () => {
    expect(formatSchemaExampleValue('{"kind":"literal"}', 'application/json')).toBe(
      JSON.stringify('{"kind":"literal"}', null, 2),
    );
    expect(formatSchemaExampleValue('', 'text/plain')).toBe('');
    expect(formatSchemaExampleValue({ ok: true }, 'application/problem+json')).toBe(
      JSON.stringify({ ok: true }, null, 2),
    );
  });
});
