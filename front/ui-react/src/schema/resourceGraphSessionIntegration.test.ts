import { afterEach, describe, expect, test, vi } from 'vitest';
import { sha256Hex } from '../apiChange/apiChangeTracker';
import {
  projectApiDocSchemaRegions,
  REQUEST_BODY_REGION_KEY,
  responseSchemaRegionKey,
} from '../pages/api/apiDocSchemaProjection';
import type { SwaggerDoc } from '../types/swagger';
import { ExternalResourceLoader, schemaDocumentsFromResourceGraph, type ResourceGrant } from './externalResourceGraph';
import { createSchemaDisplayProjector } from './schemaDisplayProjection';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import { projectSchemaModels } from './schemaModelProjection';

const entryUri = 'https://docs.knife4j.example/v3/api-docs';
const pageUri = 'https://docs.knife4j.example/doc.html';
const sessions: SchemaDocumentSession[] = [];

const document = (schemas: Record<string, unknown>): SwaggerDoc => ({
  openapi: '3.1.1',
  info: { title: 'Graph integration', version: '1.0.0' },
  paths: {
    '/pets': {
      post: {
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
          },
        },
      },
    },
  },
  components: { schemas },
});

const grants = (loader: ExternalResourceLoader, ...uris: string[]): ResourceGrant[] =>
  uris.map((uri) => ({
    scope: 'generation',
    documentScope: loader.documentScope,
    resourceKey: sha256Hex(uri),
  }));

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
  vi.restoreAllMocks();
});

describe('resource graph and SchemaDocumentSession integration', () => {
  test('resolves and evaluates one external Schema consistently without any engine-side fetch', async () => {
    const externalUri = 'https://schemas.knife4j.example/pet.json';
    const entry = document({ Pet: { $ref: externalUri } });
    const entryBefore = JSON.stringify(entry);
    const loader = new ExternalResourceLoader(entry, entryUri, {
      pageUri,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            $dynamicAnchor: 'node',
            type: 'object',
            required: ['id'],
            properties: { id: { type: 'integer' }, child: { $dynamicRef: '#node' } },
            additionalProperties: false,
          }),
          { headers: { 'content-type': 'application/schema+json' } },
        ),
    });
    const snapshot = await loader.load(grants(loader, externalUri));
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('SchemaEngine must remain registry-only'));
    const session = await createSchemaDocumentSession(entry, entryUri, {
      resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
    });
    sessions.push(session);

    await expect(session.resolve(externalUri)).resolves.toMatchObject({ resourceUri: externalUri });
    await expect(session.evaluate('#/components/schemas/Pet', { id: 1 })).resolves.toMatchObject({ valid: true });
    await expect(session.evaluate('#/components/schemas/Pet', { id: '1' })).resolves.toMatchObject({ valid: false });
    await expect(session.evaluate('#/components/schemas/Pet', { id: 1, child: { id: '1' } })).resolves.toMatchObject({
      valid: false,
    });

    const projector = createSchemaDisplayProjector(session);
    const models = await projectSchemaModels(entry.components?.schemas ?? {}, entry, projector);
    const apiDoc = await projectApiDocSchemaRegions(
      [
        { key: REQUEST_BODY_REGION_KEY, schema: { $ref: '#/components/schemas/Pet' }, mode: 'request' },
        {
          key: responseSchemaRegionKey('200'),
          schema: { $ref: '#/components/schemas/Pet' },
          mode: 'response',
        },
      ],
      projector,
    );

    expect(models.failures).toEqual([]);
    expect(models.models[0]).toMatchObject({
      name: 'Pet',
      source: 'schema-engine',
      fields: expect.arrayContaining([expect.objectContaining({ name: 'id', type: 'integer' })]),
    });
    expect(apiDoc.failures).toEqual([]);
    expect(apiDoc.regions).toEqual([
      expect.objectContaining({
        key: REQUEST_BODY_REGION_KEY,
        fields: expect.arrayContaining([expect.objectContaining({ name: 'id', type: 'integer' })]),
      }),
      expect.objectContaining({
        key: responseSchemaRegionKey('200'),
        fields: expect.arrayContaining([expect.objectContaining({ name: 'id', type: 'integer' })]),
      }),
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(entry)).toBe(entryBefore);
  });

  test('keeps successful regions usable when another authorized resource fails', async () => {
    const goodUri = 'https://schemas.knife4j.example/good.json';
    const badUri = 'https://schemas.knife4j.example/bad.json';
    const entry = document({ Good: { $ref: goodUri }, Bad: { $ref: badUri } });
    const loader = new ExternalResourceLoader(entry, entryUri, {
      pageUri,
      fetchImpl: async (input) =>
        String(input) === goodUri
          ? new Response('{"type":"integer"}', { headers: { 'content-type': 'application/schema+json' } })
          : new Response('{}', { status: 503, headers: { 'content-type': 'application/schema+json' } }),
    });
    const snapshot = await loader.load(grants(loader, goodUri, badUri));
    expect(snapshot.complete).toBe(false);
    expect(snapshot.nodes.has(goodUri)).toBe(true);
    expect(snapshot.nodes.has(badUri)).toBe(false);
    expect(snapshot.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'RESOURCE_HTTP_STATUS', retryable: true })]),
    );

    const session = await createSchemaDocumentSession(entry, entryUri, {
      resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
    });
    sessions.push(session);
    await expect(session.evaluate('#/components/schemas/Good', 1)).resolves.toMatchObject({ valid: true });
    await expect(session.evaluate('#/components/schemas/Bad', 1)).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
    });
  });

  test('does not share an authorized graph with a new document session', async () => {
    const externalUri = 'https://schemas.knife4j.example/private.json';
    const firstDocument = document({ Private: { $ref: externalUri } });
    const firstLoader = new ExternalResourceLoader(firstDocument, entryUri, {
      pageUri,
      fetchImpl: async () =>
        new Response('{"type":"string"}', { headers: { 'content-type': 'application/schema+json' } }),
    });
    const firstSnapshot = await firstLoader.load(grants(firstLoader, externalUri));
    const first = await createSchemaDocumentSession(firstDocument, entryUri, {
      resourceDocuments: schemaDocumentsFromResourceGraph(firstSnapshot),
    });
    sessions.push(first);
    await expect(first.evaluate('#/components/schemas/Private', 'ok')).resolves.toMatchObject({ valid: true });
    first.dispose();
    sessions.splice(sessions.indexOf(first), 1);

    const secondUri = 'https://docs.knife4j.example/v3/api-docs?group=second';
    const secondDocument = document({ Private: { $ref: externalUri } });
    const second = await createSchemaDocumentSession(secondDocument, secondUri);
    sessions.push(second);
    await expect(second.evaluate('#/components/schemas/Private', 'ok')).rejects.toMatchObject({
      code: 'EXTERNAL_RESOURCE_LOADING_DISABLED',
    });
  });
});
