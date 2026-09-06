import { afterEach, describe, expect, test, vi } from 'vitest';
import { JSON_SCHEMA_2020_12, OPENAPI_32_DIALECT } from 'knife4j-schema-engine';
import { sha256Hex } from '../apiChange/apiChangeTracker';
import type { SwaggerDoc } from '../types/swagger';
import {
  ExternalResourceLoader,
  schemaDocumentsFromResourceGraph,
  schemaRegistrationContextFromResourceGraph,
  type ResourceGrant,
} from './externalResourceGraph';
import {
  createSchemaDocumentSession,
  evaluateSchemaDocumentDirectionally,
  isOas31SchemaDocument,
  isSchemaEngineDocument,
  SchemaDocumentSessionManager,
  type SchemaDocumentSession,
} from './schemaDocumentSession';

const retrievalUri = 'https://docs.example/entry.json';
const sessions: SchemaDocumentSession[] = [];
const document32 = (schemas: Record<string, unknown> = {}): SwaggerDoc => ({
  openapi: '3.2.0',
  info: { title: 'OAS 3.2 Schema sessions', version: '1' },
  components: { schemas },
});
const grants = (loader: ExternalResourceLoader, uris: string[]): ResourceGrant[] =>
  uris.map((uri) => ({
    scope: 'generation',
    documentScope: loader.documentScope,
    resourceKey: sha256Hex(uri),
  }));
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

// OAS 3.2.0 §§4.1.1, 4.14, 4.24; JSON Schema 2020-12 Core §8.2.3.2.
// Documents and fragment root roles are provided by C's typed graph, not inferred
// from a payload containing a schema-like key. No serializer/debug consumer runs.
describe('OAS 3.2 graph to SchemaDocumentSession', () => {
  test('activates only the engine gate for 3.2.x and preserves the 3.1-only gate', () => {
    for (const version of ['3.2.0', '3.2.99']) {
      const document = { ...document32(), openapi: version };
      expect(isSchemaEngineDocument(document)).toBe(true);
      expect(isOas31SchemaDocument(document)).toBe(false);
    }
    expect(isSchemaEngineDocument({ ...document32(), openapi: '3.1.1' })).toBe(true);
    expect(isSchemaEngineDocument({ ...document32(), openapi: '3.0.4' })).toBe(false);
    expect(isSchemaEngineDocument(null)).toBe(false);
  });

  test('registers full OAS, Media Type fragments and standalone Schema resources with directional dynamic references', async () => {
    const mediaUri = 'https://api.example/media.json';
    const externalUri = 'https://api.example/external.json';
    const treeUri = 'https://api.example/tree.json';
    const entry = {
      ...document32({ Tree: { $ref: 'tree.json' }, External: { $ref: 'external.json#/components/schemas/External' } }),
      $self: 'https://api.example/contract.json#identity',
      jsonSchemaDialect: OPENAPI_32_DIALECT,
      paths: {
        '/events': {
          query: {
            responses: {
              '200': {
                description: 'events',
                content: { 'application/json-seq': { $ref: '#/components/mediaTypes/Events' } },
              },
            },
          },
          post: { requestBody: { content: { 'multipart/form-data': { $ref: '#/components/mediaTypes/Multipart' } } } },
        },
      },
      components: {
        schemas: {
          Tree: { $ref: 'tree.json' },
          External: { $ref: 'external.json#/components/schemas/External' },
        },
        mediaTypes: {
          Events: { $ref: 'media.json' },
          Multipart: {
            schema: { type: 'object', properties: { part: { type: 'object' } } },
            encoding: {
              part: {
                headers: {
                  'X-Count': { content: { 'application/json': { schema: { $id: 'header-count', type: 'integer' } } } },
                },
              },
            },
          },
        },
        examples: { Opaque: { value: { $id: 'urn:opaque', $ref: 'https://never.example/fetch' } } },
      },
    } as SwaggerDoc;
    const documents = new Map<string, unknown>([
      [
        externalUri,
        {
          ...document32({ External: { $id: 'embedded%3Aexternal', type: 'integer' } }),
          $self: 'https://api.example/external.json',
        },
      ],
      [
        mediaUri,
        {
          schema: { type: 'array', minItems: 2, items: { $ref: 'tree.json' } },
          itemSchema: { $ref: 'tree.json' },
        },
      ],
      [
        treeUri,
        {
          $schema: JSON_SCHEMA_2020_12,
          $dynamicAnchor: 'node',
          type: 'object',
          required: ['id', 'secret'],
          properties: {
            id: { type: 'integer', readOnly: true },
            secret: { type: 'string', writeOnly: true },
            child: { $dynamicRef: '#node' },
          },
          additionalProperties: false,
        },
      ],
    ]);
    const before = JSON.stringify([entry, [...documents]]);
    const loader = new ExternalResourceLoader(entry, retrievalUri, {
      pageUri: 'https://docs.example/doc.html',
      fetchImpl: async (input) =>
        new Response(JSON.stringify(documents.get(String(input))), { headers: { 'content-type': 'application/json' } }),
    });
    const snapshot = await loader.load(grants(loader, [...documents.keys()]));
    expect(snapshot.diagnostics).toEqual([]);
    expect(snapshot.complete).toBe(true);
    expect(Object.isFrozen(snapshot.objectLocations)).toBe(true);
    expect(snapshot.objectLocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerRetrievalUri: mediaUri, pointer: '#', kind: 'media-type' }),
        expect.objectContaining({ ownerRetrievalUri: mediaUri, pointer: '#/itemSchema', kind: 'schema' }),
        expect.objectContaining({
          ownerRetrievalUri: treeUri,
          pointer: '#',
          kind: 'schema',
          schemaDialect: JSON_SCHEMA_2020_12,
        }),
      ]),
    );
    expect(snapshot.objectLocations.every((location) => Object.isFrozen(location))).toBe(true);
    expect(
      snapshot.objectLocations.some(
        (location) => location.kind === 'schema' && location.pointer.includes('/examples/'),
      ),
    ).toBe(false);
    const resources = schemaDocumentsFromResourceGraph(snapshot);
    expect(resources).toHaveLength(3);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Engine fetch is forbidden'));
    const session = await createSchemaDocumentSession(entry, retrievalUri, {
      registrationContext: schemaRegistrationContextFromResourceGraph(snapshot, retrievalUri),
      resourceDocuments: resources,
    });
    sessions.push(session);
    await expect(session.evaluate('#/components/schemas/External', 1)).resolves.toMatchObject({ valid: true });
    await expect(session.evaluate('https://api.example/embedded%3Aexternal', 'bad')).resolves.toMatchObject({
      valid: false,
    });
    await expect(session.evaluate('https://api.example/header-count', 1)).resolves.toMatchObject({ valid: true });
    const tree = '#/components/schemas/Tree';
    await expect(session.evaluate(tree, { id: 1, secret: 'x', child: { id: 2, secret: 'y' } })).resolves.toMatchObject({
      valid: true,
    });
    await expect(
      session.evaluate(tree, { id: 1, secret: 'x', child: { id: 'bad', secret: 'y' } }),
    ).resolves.toMatchObject({ valid: false });
    await expect(session.evaluate(tree, { secret: 'x' })).resolves.toMatchObject({ valid: false });
    await expect(
      evaluateSchemaDocumentDirectionally(session, tree, { secret: 'x', child: { secret: 'y' } }, 'request'),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      evaluateSchemaDocumentDirectionally(session, tree, { id: 1, child: { id: 2 } }, 'response'),
    ).resolves.toMatchObject({ valid: true });
    await expect(evaluateSchemaDocumentDirectionally(session, tree, { id: 'bad' }, 'response')).resolves.toMatchObject({
      valid: false,
    });
    await expect(session.evaluate(`${mediaUri}#/itemSchema`, { id: 1, secret: 'x' })).resolves.toMatchObject({
      valid: true,
    });
    await expect(session.evaluate(`${mediaUri}#/schema`, [{ id: 1, secret: 'x' }])).resolves.toMatchObject({
      valid: false,
    });
    await expect(
      evaluateSchemaDocumentDirectionally(session, `${mediaUri}#/itemSchema`, { secret: 'x' }, 'request'),
    ).resolves.toMatchObject({ valid: true });
    await expect(session.resolve('urn:opaque')).rejects.toMatchObject({ code: 'RESOURCE_NOT_REGISTERED' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify([entry, [...documents]])).toBe(before);
    loader.dispose();
  });

  test('projects special pointer keys and independent reserved resource identities without changing raw schemas', async () => {
    const keys = ['a#b% c', '中文', 'a~b/c', 'a:b', 'a%3Ab'];
    const entry = document32({
      Value: {
        type: 'object',
        properties: Object.fromEntries(keys.map((key) => [key, { const: key }])),
        additionalItems: { $id: 'https://schema.example/a%3Ab?x=%26', $ref: 'https://never.example/opaque' },
        unknownAnnotation: { $id: 'urn:opaque', $ref: 'https://never.example/opaque' },
        $recursiveRef: 'https://never.example/opaque',
      },
      Encoded: {
        $id: 'https://schema.example/a%3Ab?x=%26',
        type: 'object',
        required: ['id', 'secret'],
        properties: { id: { readOnly: true }, secret: { const: 'encoded' } },
      },
      Literal: {
        $id: 'https://schema.example/a:b?x=&',
        type: 'object',
        required: ['id', 'secret'],
        properties: { id: { readOnly: true }, secret: { const: 'literal' } },
      },
    });
    const before = JSON.stringify(entry);
    const session = await createSchemaDocumentSession(entry, retrievalUri);
    sessions.push(session);
    for (const key of keys) {
      const reference = `#/components/schemas/Value/properties/${encodeURIComponent(key.replace(/~/g, '~0').replace(/\//g, '~1'))}`;
      await expect(evaluateSchemaDocumentDirectionally(session, reference, key, 'request')).resolves.toMatchObject({
        valid: true,
      });
      await expect(evaluateSchemaDocumentDirectionally(session, reference, 'wrong', 'request')).resolves.toMatchObject({
        valid: false,
      });
    }
    await expect(
      evaluateSchemaDocumentDirectionally(
        session,
        'https://schema.example/a%3Ab?x=%26',
        { secret: 'encoded' },
        'request',
      ),
    ).resolves.toMatchObject({ valid: true });
    await expect(
      evaluateSchemaDocumentDirectionally(
        session,
        'https://schema.example/a%3Ab?x=%26',
        { secret: 'literal' },
        'request',
      ),
    ).resolves.toMatchObject({ valid: false });
    await expect(
      evaluateSchemaDocumentDirectionally(session, 'https://schema.example/a:b?x=&', { secret: 'literal' }, 'request'),
    ).resolves.toMatchObject({ valid: true });
    expect(JSON.stringify(entry)).toBe(before);
  });

  test('retains good regions in a partial graph and revokes external access with the session', async () => {
    const good = 'https://api.example/good.json';
    const missing = 'https://api.example/missing.json';
    const entry = document32({ Good: { $ref: good }, Missing: { $ref: missing } });
    const loader = new ExternalResourceLoader(entry, retrievalUri, {
      pageUri: 'https://docs.example/doc.html',
      fetchImpl: async (input) =>
        String(input) === good
          ? new Response('{"type":"integer"}', { headers: { 'content-type': 'application/schema+json' } })
          : new Response('{}', { status: 503 }),
    });
    const snapshot = await loader.load(grants(loader, [good, missing]));
    const session = await createSchemaDocumentSession(entry, retrievalUri, {
      registrationContext: schemaRegistrationContextFromResourceGraph(snapshot, retrievalUri),
      resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
    });
    sessions.push(session);
    await expect(session.evaluate('#/components/schemas/Good', 1)).resolves.toMatchObject({ valid: true });
    await expect(session.evaluate('#/components/schemas/Missing', 1)).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
    });
    session.dispose();
    const replacement = await createSchemaDocumentSession(entry, retrievalUri);
    sessions.push(replacement);
    await expect(replacement.evaluate('#/components/schemas/Good', 1)).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
    });
    loader.dispose();
  });

  test('serializes concurrent projection/normal evaluation and supersedes stale document initialization', async () => {
    const manager = new SchemaDocumentSessionManager();
    const first = manager.open(document32({ Value: { const: 'old' } }), retrievalUri);
    const current = manager.open(
      document32({
        Value: { type: 'object', required: ['id'], properties: { id: { readOnly: true, type: 'integer' } } },
      }),
      retrievalUri,
    );
    await expect(first).resolves.toEqual({ status: 'stale' });
    const result = await current;
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Expected current session');
    sessions.push(result.session);
    const results = await Promise.all([
      evaluateSchemaDocumentDirectionally(result.session, '#/components/schemas/Value', {}, 'request'),
      result.session.evaluate('#/components/schemas/Value', { id: 1 }),
      evaluateSchemaDocumentDirectionally(result.session, '#/components/schemas/Value', { id: 1 }, 'response'),
    ]);
    expect(results.every((result) => result.valid)).toBe(true);
    manager.clear();
  });
});

test.each(['3.1.1', '3.0.4'])('preserves C rejection of an external OpenAPI %s document', async (version) => {
  const externalUri = 'https://api.example/legacy.json';
  const entry = document32({ Value: { $ref: `${externalUri}#/components/schemas/Value` }, Local: { type: 'integer' } });
  const legacy = {
    openapi: version,
    info: { title: 'Other OpenAPI minor', version: '1' },
    paths: {},
    components: { schemas: { Value: { type: 'integer' } } },
  };
  const loader = new ExternalResourceLoader(entry, retrievalUri, {
    pageUri: 'https://docs.example/doc.html',
    fetchImpl: async () => new Response(JSON.stringify(legacy), { headers: { 'content-type': 'application/json' } }),
  });
  const snapshot = await loader.load(grants(loader, [externalUri]));
  expect(snapshot.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'OPENAPI_VERSION_UNSUPPORTED' })]),
  );
  expect(snapshot.complete).toBe(false);
  expect(schemaDocumentsFromResourceGraph(snapshot)).toEqual([]);
  const session = await createSchemaDocumentSession(entry, retrievalUri, {
    registrationContext: schemaRegistrationContextFromResourceGraph(snapshot, retrievalUri),
    resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
  });
  sessions.push(session);
  await expect(session.evaluate('#/components/schemas/Value', 1)).rejects.toMatchObject({
    code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
  });
  await expect(session.evaluate('#/components/schemas/Local', 1)).resolves.toMatchObject({ valid: true });
  loader.dispose();
});
