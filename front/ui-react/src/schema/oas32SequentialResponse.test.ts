import { afterEach, describe, expect, test } from 'vitest';
import type { MenuOperation, OperationObject, SwaggerDoc } from '../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import {
  consumeOas32SequentialResponse,
  locateOas32SequentialSchemas,
  shouldConsumeOas32SequentialResponse,
} from './oas32SequentialResponse';

const sessions: SchemaDocumentSession[] = [];

function menuOperation(path: string, operationObject: OperationObject, method = 'get'): MenuOperation {
  return {
    key: `sequential/${method}`,
    path,
    method,
    summary: 'sequential media',
    operation: operationObject,
    source: 'path',
  };
}

function document32(content: Record<string, unknown>): { document: SwaggerDoc; operation: MenuOperation } {
  const operationObject: OperationObject = {
    responses: {
      '200': {
        description: 'stream',
        content,
      },
    },
  };
  const document: SwaggerDoc = {
    openapi: '3.2.0',
    info: { title: 'OAS 3.2 sequential', version: '1' },
    paths: { '/stream': { get: operationObject } },
  };
  return { document, operation: menuOperation('/stream', operationObject) };
}

function jsonlResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'application/jsonl' } });
}

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
});

describe('shouldConsumeOas32SequentialResponse', () => {
  test('is limited to OAS 3.2 structured sequential media', () => {
    expect(shouldConsumeOas32SequentialResponse(true, 'application/jsonl')).toBe(true);
    expect(shouldConsumeOas32SequentialResponse(true, 'application/json')).toBe(false);
    expect(shouldConsumeOas32SequentialResponse(false, 'text/event-stream')).toBe(false);
  });
});

describe('locateOas32SequentialSchemas', () => {
  test('separates complete schema from itemSchema on the selected media type', () => {
    const { document, operation } = document32({
      'application/jsonl': {
        schema: { type: 'array', maxItems: 2 },
        itemSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      },
    });
    expect(
      locateOas32SequentialSchemas({
        document,
        operation,
        statusCode: 200,
        contentType: 'application/jsonl',
      }),
    ).toMatchObject({
      responseKey: '200',
      mediaType: 'application/jsonl',
      schemaReference: expect.stringContaining('/schema'),
      itemSchemaReference: expect.stringContaining('/itemSchema'),
    });
  });
});

describe('consumeOas32SequentialResponse', () => {
  test('validates JSONL items incrementally and the complete array only after eof', async () => {
    const { document, operation } = document32({
      'application/jsonl': {
        schema: { type: 'array', minItems: 2, maxItems: 2 },
        itemSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      },
    });
    const session = await createSchemaDocumentSession(document, 'https://fixtures.knife4j.example/sequential.json');
    sessions.push(session);
    const seen: number[] = [];
    const result = await consumeOas32SequentialResponse({
      response: jsonlResponse(['{"id":1}\n', '{"id":2}\n']),
      contentType: 'application/jsonl',
      document,
      operation,
      session,
      onItem: (item) => {
        seen.push(item.record.index);
      },
    });
    expect(seen).toEqual([0, 1]);
    expect(result.termination).toBe('eof');
    expect(result.truncated).toBe(false);
    expect(result.items.map((item) => item.itemSchema.status)).toEqual(['valid', 'valid']);
    expect(result.completeSchema).toEqual({ status: 'valid' });
  });

  test('does not report a truncated JSONL collection as a valid complete schema', async () => {
    const { document, operation } = document32({
      'application/jsonl': {
        schema: { type: 'array' },
        itemSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      },
    });
    const session = await createSchemaDocumentSession(
      document,
      'https://fixtures.knife4j.example/sequential-budget.json',
    );
    sessions.push(session);
    const result = await consumeOas32SequentialResponse({
      response: jsonlResponse(['{"id":1}\n', '{"id":2}\n', '{"id":3}\n']),
      contentType: 'application/jsonl',
      document,
      operation,
      session,
      limits: { maxItems: 2, maxRetainedItems: 2 },
    });
    expect(result.termination).toBe('budget-items');
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(2);
    expect(result.completeSchema).toEqual({ status: 'skipped', reason: 'truncated' });
  });

  test('does not report a character-clipped SSE collection as a valid complete schema', async () => {
    const { document, operation } = document32({
      'text/event-stream': {
        schema: { type: 'array' },
        itemSchema: { type: 'object' },
      },
    });
    const session = await createSchemaDocumentSession(
      document,
      'https://fixtures.knife4j.example/sequential-clip.json',
    );
    sessions.push(session);
    const encoder = new TextEncoder();
    const result = await consumeOas32SequentialResponse({
      response: new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${'x'.repeat(80)}\n\n`));
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
      contentType: 'text/event-stream',
      document,
      operation,
      session,
      limits: { maxRecordCharacters: 8 },
    });
    expect(result.termination).toBe('eof');
    expect(result.items[0]?.record.complete).toBe(true);
    expect(result.items[0]?.record.diagnostics.map((item) => item.code)).toContain('BUDGET_EXCEEDED');
    expect(result.completeSchema).toEqual({ status: 'skipped', reason: 'not-representable' });
  });

  test('keeps an invalid JSONL item distinct from later valid items', async () => {
    const { document, operation } = document32({
      'application/jsonl': {
        schema: { type: 'array' },
        itemSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
      },
    });
    const session = await createSchemaDocumentSession(
      document,
      'https://fixtures.knife4j.example/sequential-invalid.json',
    );
    sessions.push(session);
    const result = await consumeOas32SequentialResponse({
      response: jsonlResponse(['{"id":1}\n', 'not-json\n', '{"id":3}\n']),
      contentType: 'application/jsonl',
      document,
      operation,
      session,
    });
    expect(result.termination).toBe('eof');
    expect(result.items.map((item) => [item.itemSchema.status, item.record.complete])).toEqual([
      ['valid', true],
      ['skipped', false],
      ['valid', true],
    ]);
    expect(result.completeSchema).toEqual({ status: 'skipped', reason: 'not-representable' });
  });

  test('exposes the first SSE event before the stream ends', async () => {
    const encoder = new TextEncoder();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('data: first\n\n'));
        await gate;
        controller.close();
      },
    });
    const seen: string[] = [];
    const consuming = consumeOas32SequentialResponse({
      response: new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      contentType: 'text/event-stream',
      document: null,
      operation: undefined,
      onItem: (item) => {
        if (item.record.value.kind === 'sse') seen.push(item.record.value.event.data);
      },
    });
    await viWaitFor(() => expect(seen).toEqual(['first']));
    release();
    const result = await consuming;
    expect(result.termination).toBe('eof');
    expect(result.items).toHaveLength(1);
  });

  test('treats abort as cancel and does not invent a trailing partial JSONL item', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"id":1}\n{"id":'));
      },
    });
    const controller = new AbortController();
    const seen: number[] = [];
    const consuming = consumeOas32SequentialResponse({
      response: new Response(stream, { status: 200, headers: { 'content-type': 'application/jsonl' } }),
      contentType: 'application/jsonl',
      document: null,
      operation: undefined,
      signal: controller.signal,
      onItem: (item) => {
        seen.push(item.record.index);
      },
    });
    await viWaitFor(() => expect(seen).toEqual([0]));
    controller.abort();
    const result = await consuming;
    expect(result.termination).toBe('cancel');
    expect(result.truncated).toBe(true);
    expect(result.items.map((item) => item.record.complete)).toEqual([true]);
    expect(result.completeSchema).toEqual({ status: 'absent' });
  });
});

async function viWaitFor(assert: () => void, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      assert();
      return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
