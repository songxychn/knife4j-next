import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SwaggerDoc } from '../types/swagger';
import {
  createSchemaDocumentSession,
  isOas31SchemaDocument,
  schemaDocumentRetrievalUri,
  schemaReferenceUri,
  SchemaDocumentSessionManager,
  toSchemaDocumentFailure,
  type SchemaDocumentSession,
} from './schemaDocumentSession';

const retrievalUri = 'https://docs.knife4j.example/v3/api-docs';
const sessions: SchemaDocumentSession[] = [];

const openApiDocument = (schema: Record<string, unknown> = { type: 'string' }): SwaggerDoc => ({
  openapi: '3.1.0',
  info: { title: 'Schema session fixture', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      Pet: schema,
    },
  },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const fakeSession = (uri: string): SchemaDocumentSession => ({
  retrievalUri: uri,
  resolve: async () => {
    throw new Error('Not used by lifecycle tests.');
  },
  evaluate: async () => {
    throw new Error('Not used by lifecycle tests.');
  },
  dispose: vi.fn(),
});

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
});

describe('document identity and support boundary', () => {
  test('normalizes the api-docs URL without retaining credentials or fragments', () => {
    expect(
      schemaDocumentRetrievalUri(
        '/v3/api-docs?group=pets#model',
        'pets',
        'https://user:secret@docs.knife4j.example/ui/group/pets',
      ),
    ).toBe('https://docs.knife4j.example/v3/api-docs?group=pets');
    expect(schemaDocumentRetrievalUri('http://[', 'pet group', 'https://docs.knife4j.example/')).toBe(
      'https://knife4j.invalid/groups/pet%20group/openapi.json',
    );
  });

  test('only activates for OpenAPI 3.1.x documents', () => {
    expect(isOas31SchemaDocument(openApiDocument())).toBe(true);
    expect(isOas31SchemaDocument({ ...openApiDocument(), openapi: '3.1.1-beta' })).toBe(true);
    expect(isOas31SchemaDocument({ ...openApiDocument(), openapi: '3.0.4' })).toBe(false);
    expect(isOas31SchemaDocument({ ...openApiDocument(), openapi: '3.2.0' })).toBe(false);
    expect(isOas31SchemaDocument(null)).toBe(false);
  });

  test('resolves local and absolute schema references against the document identity', () => {
    expect(schemaReferenceUri(retrievalUri, '#/components/schemas/Pet')).toBe(
      `${retrievalUri}#/components/schemas/Pet`,
    );
    expect(schemaReferenceUri(retrievalUri, 'https://schemas.knife4j.example/pet')).toBe(
      'https://schemas.knife4j.example/pet',
    );
    expect(() => schemaReferenceUri('not-an-absolute-uri', 'relative')).toThrow(TypeError);
  });
});

describe('SchemaDocumentSession', () => {
  test('resolves and evaluates a component schema from the loaded document', async () => {
    const session = await createSchemaDocumentSession(
      openApiDocument({
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer' } },
        unevaluatedProperties: false,
      }),
      retrievalUri,
    );
    sessions.push(session);

    const node = await session.resolve('#/components/schemas/Pet');
    expect(node.requestedUri).toBe(`${retrievalUri}#/components/schemas/Pet`);
    expect(node.schema).toMatchObject({ type: 'object', required: ['id'] });
    await expect(session.evaluate('#/components/schemas/Pet', { id: 1 })).resolves.toMatchObject({ valid: true });
    await expect(session.evaluate('#/components/schemas/Pet', { id: '1' })).resolves.toMatchObject({ valid: false });
  });

  test('keeps external references registry-only and performs no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not be called'));
    const session = await createSchemaDocumentSession(
      openApiDocument({ $ref: 'https://schemas.knife4j.example/pet' }),
      retrievalUri,
    );
    sessions.push(session);

    await expect(session.evaluate('#/components/schemas/Pet', {})).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('disposes the underlying engine exactly once', async () => {
    const session = await createSchemaDocumentSession(openApiDocument(), retrievalUri);
    session.dispose();
    session.dispose();

    await expect(session.resolve('#/components/schemas/Pet')).rejects.toMatchObject({ code: 'ENGINE_DISPOSED' });
  });
});

describe('SchemaDocumentSessionManager', () => {
  test('disposes the active session before replacing or clearing it', async () => {
    const first = fakeSession('https://docs.knife4j.example/first');
    const second = fakeSession('https://docs.knife4j.example/second');
    const factory = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const manager = new SchemaDocumentSessionManager(factory);

    await expect(manager.open(openApiDocument(), first.retrievalUri)).resolves.toEqual({
      status: 'ready',
      session: first,
    });
    await expect(manager.open(openApiDocument(), second.retrievalUri)).resolves.toEqual({
      status: 'ready',
      session: second,
    });
    expect(first.dispose).toHaveBeenCalledOnce();

    manager.clear();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  test('discards and disposes stale asynchronous initialization results', async () => {
    const firstDeferred = deferred<SchemaDocumentSession>();
    const secondDeferred = deferred<SchemaDocumentSession>();
    const first = fakeSession('https://docs.knife4j.example/first');
    const second = fakeSession('https://docs.knife4j.example/second');
    const factory = vi
      .fn()
      .mockImplementationOnce(() => firstDeferred.promise)
      .mockImplementationOnce(() => secondDeferred.promise);
    const manager = new SchemaDocumentSessionManager(factory);

    const firstOpen = manager.open(openApiDocument(), first.retrievalUri);
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    const secondOpen = manager.open(openApiDocument(), second.retrievalUri);
    firstDeferred.resolve(first);
    await expect(firstOpen).resolves.toEqual({ status: 'stale' });
    expect(first.dispose).toHaveBeenCalledOnce();

    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
    secondDeferred.resolve(second);
    await expect(secondOpen).resolves.toEqual({ status: 'ready', session: second });
    manager.clear();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  test('normalizes initialization errors without leaking mutable details', () => {
    const failure = toSchemaDocumentFailure(
      Object.assign(new Error('Unsupported dialect'), {
        code: 'UNSUPPORTED_DIALECT',
        details: { uri: 'https://dialects.knife4j.example/custom' },
      }),
    );

    expect(failure).toEqual({
      code: 'UNSUPPORTED_DIALECT',
      message: 'Unsupported dialect',
      details: { uri: 'https://dialects.knife4j.example/custom' },
    });
    expect(Object.isFrozen(failure)).toBe(true);
    expect(Object.isFrozen(failure.details)).toBe(true);
  });
});
