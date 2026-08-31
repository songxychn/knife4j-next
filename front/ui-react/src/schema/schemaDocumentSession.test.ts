import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SwaggerDoc } from '../types/swagger';
import { createDirectionalSchemaProjection } from './schemaDirectionProjection';
import {
  createSchemaDocumentSession,
  evaluateSchemaDocumentDirectionally,
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

  test('registers policy-validated graph documents without giving SchemaEngine a fetch capability', async () => {
    const externalUri = 'https://schemas.knife4j.example/pet';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fetch must not be called'));
    const session = await createSchemaDocumentSession(openApiDocument({ $ref: externalUri }), retrievalUri, {
      resourceDocuments: [
        {
          retrievalUri: externalUri,
          document: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'integer' } },
            additionalProperties: false,
          },
        },
      ],
    });
    sessions.push(session);

    await expect(session.evaluate('#/components/schemas/Pet', { id: 1 })).resolves.toMatchObject({ valid: true });
    await expect(session.evaluate('#/components/schemas/Pet', { id: '1' })).resolves.toMatchObject({ valid: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('evaluates request and response projections without changing raw schema semantics', async () => {
    const session = await createSchemaDocumentSession(
      openApiDocument({
        type: 'object',
        required: ['responseId', 'requestSecret'],
        properties: {
          responseId: { type: 'integer', readOnly: true },
          requestSecret: { type: 'string', writeOnly: true },
        },
        additionalProperties: false,
      }),
      retrievalUri,
    );
    sessions.push(session);

    const [request, response, raw] = await Promise.all([
      evaluateSchemaDocumentDirectionally(session, '#/components/schemas/Pet', { requestSecret: 'secret' }, 'request'),
      evaluateSchemaDocumentDirectionally(session, '#/components/schemas/Pet', { responseId: 1 }, 'response'),
      session.evaluate('#/components/schemas/Pet', { requestSecret: 'secret' }),
    ]);

    expect(request.valid).toBe(true);
    expect(response.valid).toBe(true);
    expect(raw).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ keyword: 'https://json-schema.org/keyword/required' })],
    });
  });

  test('projects inline schemas under an OpenAPI default response', async () => {
    const document: SwaggerDoc = {
      openapi: '3.1.1',
      info: { title: 'Default response projection', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            responses: {
              default: {
                description: 'fallback',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      required: ['responseId'],
                      properties: { responseId: { type: 'integer', readOnly: true } },
                      additionalProperties: false,
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const session = await createSchemaDocumentSession(document, retrievalUri);
    sessions.push(session);
    const reference = '#/paths/~1pets/get/responses/default/content/application~1json/schema';

    await expect(session.evaluate(reference, {})).resolves.toMatchObject({ valid: false });
    await expect(evaluateSchemaDocumentDirectionally(session, reference, {}, 'request')).resolves.toMatchObject({
      valid: true,
    });
  });

  test('does not confuse arbitrary component names with example data fields', async () => {
    const document: SwaggerDoc = {
      openapi: '3.1.1',
      info: { title: 'Named request body projection', version: '1.0.0' },
      paths: {},
      components: {
        requestBodies: {
          value: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id'],
                  properties: { id: { type: 'integer', readOnly: true } },
                  additionalProperties: false,
                },
              },
            },
          },
        },
      },
    };
    const session = await createSchemaDocumentSession(document, retrievalUri);
    sessions.push(session);
    const reference = '#/components/requestBodies/value/content/application~1json/schema';

    await expect(session.evaluate(reference, {})).resolves.toMatchObject({ valid: false });
    await expect(evaluateSchemaDocumentDirectionally(session, reference, {}, 'request')).resolves.toMatchObject({
      valid: true,
    });
  });

  test('rejects quadratic directional specializations during projection construction', () => {
    const propertyCount = 400;
    const properties = Object.fromEntries(
      Array.from({ length: propertyCount }, (_, index) => [`field${index}`, { type: 'integer' }]),
    );
    const wrappers = Object.fromEntries(
      Array.from({ length: propertyCount }, (_, index) => [
        `Wrapper${index}`,
        {
          $ref: '#/components/schemas/Base',
          properties: { [`field${index}`]: { type: 'integer', readOnly: true } },
        },
      ]),
    );
    const document: SwaggerDoc = {
      ...openApiDocument(),
      components: {
        schemas: {
          Base: { type: 'object', properties },
          ...wrappers,
        },
      },
    };

    let failure: unknown;
    try {
      createDirectionalSchemaProjection(
        document,
        retrievalUri,
        'request',
        'https://knife4j.invalid/schema-projections/budget/',
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: 'SCHEMA_BUDGET_EXCEEDED',
      details: { limit: 100_000 },
    });
  });

  test('collapses ordinary-ref diamond paths to their effective dynamic scope', () => {
    const levelCount = 18;
    const resource = (name: string): string => `https://diamond.knife4j.example/${name}`;
    const layers: Record<string, unknown> = {};
    for (let level = levelCount - 1; level >= 0; level -= 1) {
      for (const side of ['a', 'b']) {
        const name = `${side}${level}`;
        layers[name] =
          level === levelCount - 1
            ? { $id: resource(name), type: 'object' }
            : {
                $id: resource(name),
                allOf: [{ $ref: resource(`a${level + 1}`) }, { $ref: resource(`b${level + 1}`) }],
              };
      }
    }
    const document: SwaggerDoc = {
      ...openApiDocument(),
      components: {
        schemas: {
          DiamondRoot: {
            allOf: [{ $ref: resource('a0') }, { $ref: resource('b0') }],
          },
          ...layers,
        },
      },
    };

    const projection = createDirectionalSchemaProjection(
      document,
      retrievalUri,
      'request',
      'https://knife4j.invalid/schema-projections/diamond/',
    );

    expect(projection.referenceFor('#/components/schemas/DiamondRoot')).toContain('/diamond/request/bundle#/');
  });

  test('reuses a dynamic-scope signature across large sibling collections', () => {
    const entryCount = 5000;
    const anchoredDefinitions = Object.fromEntries(
      Array.from({ length: entryCount }, (_, index) => [`Anchor${index}`, { $dynamicAnchor: `anchor${index}` }]),
    );
    const document = openApiDocument({
      $id: 'https://signature.knife4j.example/root',
      $defs: anchoredDefinitions,
      allOf: Array.from({ length: entryCount }, () => ({})),
    });

    const projection = createDirectionalSchemaProjection(
      document,
      retrievalUri,
      'request',
      'https://knife4j.invalid/schema-projections/signature/',
    );

    expect(projection.referenceFor('#/components/schemas/Pet')).toContain('/signature/request/bundle#/');
  });

  test('ignores unreferenced dynamic anchors when scopes fan out', () => {
    const commonAnchorCount = 5000;
    const resourceCount = 900;
    const resource = (index: number): string => `https://scope.knife4j.example/resource-${index}`;
    const resources = Object.fromEntries(
      Array.from({ length: resourceCount }, (_, index) => [
        `Resource${index}`,
        { $id: resource(index), $dynamicAnchor: `unique${index}` },
      ]),
    );
    const document: SwaggerDoc = {
      ...openApiDocument(),
      components: {
        schemas: {
          Pet: {
            $id: 'https://scope.knife4j.example/root',
            $defs: Object.fromEntries(
              Array.from({ length: commonAnchorCount }, (_, index) => [
                `Anchor${index}`,
                { $dynamicAnchor: `common${index}` },
              ]),
            ),
            allOf: Array.from({ length: resourceCount }, (_, index) => ({ $ref: resource(index) })),
          },
          ...resources,
        },
      },
    };

    const projection = createDirectionalSchemaProjection(
      document,
      retrievalUri,
      'request',
      'https://knife4j.invalid/schema-projections/scope-fanout/',
    );

    expect(projection.referenceFor('#/components/schemas/Pet')).toContain('/scope-fanout/request/bundle#/');
  });

  test('reuses inherited ignored-property identities across many specializations', () => {
    const propertyCount = 2000;
    const referenceCount = 4000;
    const targets = Object.fromEntries(Array.from({ length: referenceCount }, (_, index) => [`Target${index}`, true]));
    const document: SwaggerDoc = {
      ...openApiDocument(),
      components: {
        schemas: {
          Pet: {
            type: 'object',
            properties: Object.fromEntries(
              Array.from({ length: propertyCount }, (_, index) => [`field${index}`, { readOnly: true }]),
            ),
            allOf: Array.from({ length: referenceCount }, (_, index) => ({
              $ref: `#/components/schemas/Target${index}`,
            })),
          },
          ...targets,
        },
      },
    };

    const projection = createDirectionalSchemaProjection(
      document,
      retrievalUri,
      'request',
      'https://knife4j.invalid/schema-projections/ignored-context/',
    );

    expect(projection.referenceFor('#/components/schemas/Pet')).toContain('/ignored-context/request/bundle#/');
  });

  test('rejects quadratic directional-name memberships through the metadata budget', () => {
    const schemaCount = 600;
    const schemas = Object.fromEntries(
      Array.from({ length: schemaCount }, (_, index) => [
        `Schema${index}`,
        {
          properties: { [`field${index}`]: { readOnly: true } },
          ...(index + 1 < schemaCount ? { $ref: `#/components/schemas/Schema${index + 1}` } : {}),
        },
      ]),
    );
    const document: SwaggerDoc = {
      ...openApiDocument(),
      components: { schemas },
    };

    expect(() =>
      createDirectionalSchemaProjection(
        document,
        retrievalUri,
        'request',
        'https://knife4j.invalid/schema-projections/property-metadata-budget/',
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'SCHEMA_BUDGET_EXCEEDED',
        details: { limit: 100_000, actual: 100_001 },
      }),
    );
  });

  test('walks long reference chains without cloning the active path at every level', () => {
    const schemaCount = 1500;
    const schemas = Object.fromEntries(
      Array.from({ length: schemaCount }, (_, index) => [
        `Schema${index}`,
        index + 1 < schemaCount ? { $ref: `#/components/schemas/Schema${index + 1}` } : { type: 'object' },
      ]),
    );
    const document: SwaggerDoc = {
      ...openApiDocument(),
      components: { schemas },
    };

    const projection = createDirectionalSchemaProjection(
      document,
      retrievalUri,
      'request',
      'https://knife4j.invalid/schema-projections/long-reference-chain/',
    );

    expect(projection.referenceFor('#/components/schemas/Schema0')).toContain('/long-reference-chain/request/bundle#/');
  });

  test('rejects reference chains before exhausting the JavaScript call stack', () => {
    const schemaCount = 5000;
    const schemas = Object.fromEntries(
      Array.from({ length: schemaCount }, (_, index) => [
        `Schema${index}`,
        index + 1 < schemaCount ? { $ref: `#/components/schemas/Schema${index + 1}` } : { type: 'object' },
      ]),
    );
    const document: SwaggerDoc = {
      ...openApiDocument(),
      components: { schemas },
    };

    expect(() =>
      createDirectionalSchemaProjection(
        document,
        retrievalUri,
        'request',
        'https://knife4j.invalid/schema-projections/analysis-depth-budget/',
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'SCHEMA_BUDGET_EXCEEDED',
        details: { limit: 2048, actual: 2049 },
      }),
    );
  });

  test('matches the schema-engine depth budget before indexing projection paths', () => {
    let schema: Record<string, unknown> = { type: 'object' };
    for (let depth = 0; depth <= 256; depth += 1) schema = { allOf: [schema] };

    expect(() =>
      createDirectionalSchemaProjection(
        openApiDocument(schema),
        retrievalUri,
        'request',
        'https://knife4j.invalid/schema-projections/depth-budget/',
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'SCHEMA_BUDGET_EXCEEDED',
        details: { limit: 256, actual: 257 },
      }),
    );
  });

  test('rejects directional analysis before exceeding its state budget', () => {
    const document = openApiDocument({
      allOf: Array.from({ length: 20_001 }, () => ({})),
    });

    let failure: unknown;
    try {
      createDirectionalSchemaProjection(
        document,
        retrievalUri,
        'request',
        'https://knife4j.invalid/schema-projections/analysis-budget/',
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      code: 'SCHEMA_BUDGET_EXCEEDED',
      details: { limit: 20_000, actual: 20_001 },
    });
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
