import { describe, expect, test } from 'vitest';
import {
  buildOperationDebugModel,
  buildRequest,
  collectOas32DocumentDiagnostics,
  serializeOas32Parameters,
  type DebugFormValues,
  type Oas32ParameterCollection,
} from 'knife4j-core';
import {
  collectOas32ParameterInputs,
  oas32ExampleParameterEntry,
  readOas32ParameterEntries,
} from './oas32ParameterAdapter';
import { evaluateOperationExample, locateOperationExampleCatalog } from './operationExampleCatalog';
import { parseMenuTags } from '../api/knife4jClient';
import type { SwaggerDoc } from '../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import { schemaDocumentsFromResourceGraph, schemaRegistrationContextFromResourceGraph } from './externalResourceGraph';

const uri = 'https://retrieval.example/entry.json';
const emptyForm = (): DebugFormValues => ({ pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} });
const document = (parameters: Record<string, unknown>[], openapi = '3.2.0'): SwaggerDoc =>
  ({
    openapi,
    info: { title: 'Adapter fixture', version: '1' },
    paths: {
      '/items/{id}/{+id}': {
        get: {
          parameters,
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  }) as SwaggerDoc;

function collection(parameters: Record<string, unknown>[]): Oas32ParameterCollection {
  const doc = document(parameters);
  expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
  return buildOperationDebugModel({
    doc: doc as unknown as Record<string, unknown>,
    path: '/items/{id}/{+id}',
    method: 'GET',
  }).oas32Parameters!;
}

describe('OAS 3.2 parameter adapter', () => {
  test('cache restore drops provenance and session identity', () => {
    expect(
      readOas32ParameterEntries({
        'querystring:whole': {
          kind: 'media',
          text: '',
          enabled: true,
          provenance: { id: 'author', layer: 'media', session: { fake: true } },
        },
        ignored: { kind: 'data' },
      }),
    ).toEqual({
      'querystring:whole': { kind: 'media', text: '', enabled: true },
    });
  });

  test('collects querystring empty media as present and cookie session as unknown', () => {
    const model = collection([
      {
        name: 'whole',
        in: 'querystring',
        required: true,
        content: { 'text/plain': { schema: { type: 'string' } } },
      },
      { name: 'SID', in: 'cookie', schema: { type: 'string' } },
    ]);
    const inputs = collectOas32ParameterInputs(
      model,
      {
        'querystring:whole': { kind: 'media', text: '', enabled: true },
        'cookie:SID': { kind: 'parameter', text: 'SID=manual', enabled: true },
      },
      'browser-session',
      1,
    );
    expect(inputs['querystring:whole']).toMatchObject({ kind: 'media', text: '' });
    expect(inputs['cookie:SID']).toEqual({ kind: 'browser-session' });
    const plan = serializeOas32Parameters(model, inputs);
    expect(plan.wholeQuery).toMatchObject({ present: true, component: '' });
    expect(plan.presence['cookie:SID']).toBe('unknown');
    expect(plan.cookieText).toBe('');
  });

  test('keeps invalid JSON as an editor input instead of throwing during collect', () => {
    const model = collection([
      {
        name: 'whole',
        in: 'querystring',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
    ]);
    expect(() =>
      collectOas32ParameterInputs(
        model,
        { 'querystring:whole': { kind: 'data', text: '{', enabled: true } },
        'explicit',
        0,
      ),
    ).not.toThrow();
    expect(
      collectOas32ParameterInputs(
        model,
        { 'querystring:whole': { kind: 'data', text: '{', enabled: true } },
        'explicit',
        0,
      )['querystring:whole'],
    ).toMatchObject({ kind: 'editor', text: '{' });
  });

  test('interprets G querystring examples through the 3.2 codec', async () => {
    const swagger = document([
      {
        name: 'whole',
        in: 'querystring',
        content: {
          'application/json': {
            schema: { type: 'object', properties: { n: { type: 'integer' } } },
            examples: { media: { serializedValue: '{ "n": 3 }' }, data: { dataValue: { n: 2 } } },
          },
        },
      },
    ]);
    const op = parseMenuTags(swagger, { retrievalUri: uri }).flatMap((tag) => tag.operations)[0];
    const catalog = locateOperationExampleCatalog(swagger, op);
    const media = catalog.targets.find((target) => target.name === 'media' && target.layer === 'media')!;
    const session: SchemaDocumentSession = await createSchemaDocumentSession(swagger, uri, {
      resourceDocuments: schemaDocumentsFromResourceGraph(op.resourceSnapshot!),
      registrationContext: schemaRegistrationContextFromResourceGraph(op.resourceSnapshot!, uri),
    });
    try {
      const result = await evaluateOperationExample(media, session);
      const entry = oas32ExampleParameterEntry(result, 4);
      expect(entry).toMatchObject({ kind: 'media', text: '{ "n": 3 }', enabled: true });
      expect(entry?.provenance?.session).toBe(session);
      expect(readOas32ParameterEntries({ [media.parameterKey!]: entry })).toEqual({
        'querystring:whole': { kind: 'media', text: '{ "n": 3 }', enabled: true },
      });
    } finally {
      session.dispose();
    }
  });

  test('builds requests from adapter inputs without the serializedExampleParameters bridge', () => {
    const swagger = document([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: '+id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    const debugModel = buildOperationDebugModel({
      doc: swagger as unknown as Record<string, unknown>,
      path: '/items/{id}/{+id}',
      method: 'GET',
    });
    const built = buildRequest({
      baseUrl: 'https://example.test',
      path: '/items/{id}/{+id}',
      method: 'GET',
      debugModel,
      formValues: {
        ...emptyForm(),
        oas32ParameterInputs: {
          'path:id': { kind: 'editor', text: '0' },
          'path:+id': { kind: 'editor', text: '1' },
        },
      },
    });
    expect(built.url).toBe('https://example.test/items/0/1');
  });
});
