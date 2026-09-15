import { afterEach, expect, test, vi } from 'vitest';
const { jsxFactory } = vi.hoisted(() => ({
  jsxFactory: (type: unknown, props: Record<string, unknown>) => ({ type, props }),
}));
vi.mock('react/jsx-runtime', () => ({ jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory }));
vi.mock('react/jsx-dev-runtime', () => ({ jsx: jsxFactory, jsxs: jsxFactory, jsxDEV: jsxFactory }));
import type { SwaggerDoc } from '../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import { generateSchemaExample } from './schemaExampleGeneration';
import SchemaExampleNotice from '../components/schema/SchemaExampleNotice';
import { parseMenuTags } from '../api/knife4jClient';
import { evaluateOperationExample, locateOperationExampleCatalog } from './operationExampleCatalog';

let session: SchemaDocumentSession | undefined;
afterEach(() => session?.dispose());

test.each(['request', 'response'] as const)(
  'preserves the %s example and maps copied Schema errors to the original document',
  async (direction) => {
    const document = {
      openapi: '3.2.0',
      info: { title: 'Diagnostic source', version: '1' },
      components: {
        schemas: {
          Good: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } } },
          'Bad/% 中文~': { $id: 'nested.json', type: 'object', properties: { file: { type: 'file' } } },
        },
      },
    } as unknown as SwaggerDoc;
    const uri = 'https://example.test/original.json';
    session = await createSchemaDocumentSession(document, uri);
    const result = await generateSchemaExample(session, '#/components/schemas/Good', {
      direction,
      explicit: [{ source: 'example-object', value: { ids: ['one'] } }],
    });
    expect(result).toMatchObject({
      status: 'value',
      value: { ids: ['one'] },
      authored: true,
      validation: 'unavailable',
      diagnostics: [
        {
          schemaIssues: expect.arrayContaining([
            { documentUri: uri, pointer: '#/components/schemas/Bad~1% 中文~0/properties/file/type', keyword: 'type' },
          ]),
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/knife4j-internal|schema-projections|physical|document0|root0/);
    const notice = SchemaExampleNotice({ result });
    expect(notice?.props.message).toBe('schema.example.invalidDocument.title');
    expect(JSON.stringify(notice)).toContain('#/components/schemas/Bad~1% 中文~0/properties/file/type');
  },
);

test('keeps a valid document and author example valid without a warning', async () => {
  session = await createSchemaDocumentSession(
    {
      openapi: '3.2.0',
      info: { title: 'Valid', version: '1' },
      components: { schemas: { Good: { type: 'array', items: { type: 'string' } } } },
    } as SwaggerDoc,
    'https://example.test/valid.json',
  );
  const result = await generateSchemaExample(session, '#/components/schemas/Good', {
    direction: 'request',
    explicit: [{ source: 'example-object', value: ['one'] }],
  });
  expect(result).toMatchObject({ status: 'value', value: ['one'], validation: 'valid', diagnostics: [] });
  expect(SchemaExampleNotice({ result })).toBeNull();
});

test('locates an inline upload error through the operation example catalog', async () => {
  const uri = 'https://example.test/inline.json';
  const document = {
    openapi: '3.2.0',
    info: { title: 'Inline', version: '1' },
    paths: {
      '/items': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } } },
                examples: { json: { value: { ids: ['one'] } } },
              },
            },
          },
          responses: { '200': { description: 'OK' } },
        },
      },
      '/upload': {
        post: {
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: { type: 'object', properties: { file: { type: 'file', format: 'binary' } } },
              },
            },
          },
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  } as unknown as SwaggerDoc;
  const op = parseMenuTags(document, { retrievalUri: uri })
    .flatMap((tag) => tag.operations)
    .find((op) => op.path === '/items')!;
  const target = locateOperationExampleCatalog(document, op).targets.find((target) => target.name === 'json')!;
  session = await createSchemaDocumentSession(document, uri);
  const result = await evaluateOperationExample(target, session);
  expect(result.representation.data).toEqual({ ids: ['one'] });
  expect(result.schemaResult).toMatchObject({
    status: 'value',
    validation: 'unavailable',
    diagnostics: [
      {
        schemaIssues: expect.arrayContaining([
          {
            documentUri: uri,
            pointer: '#/paths/~1upload/post/requestBody/content/multipart~1form-data/schema/properties/file/type',
            keyword: 'type',
          },
        ]),
      },
    ],
  });
  expect(JSON.stringify(result.schemaResult)).not.toMatch(/knife4j-internal|schema-projections|document0|root0/);
});

test('reports the registered external document as the source of a copied Schema failure', async () => {
  const uri = 'https://example.test/entry.json';
  const externalUri = 'https://example.test/external.json';
  session = await createSchemaDocumentSession(
    {
      openapi: '3.2.0',
      info: { title: 'Entry', version: '1' },
      components: { schemas: { Ref: { $ref: './external.json#/components/schemas/Bad' } } },
    } as SwaggerDoc,
    uri,
    {
      resourceDocuments: [
        {
          retrievalUri: externalUri,
          document: {
            openapi: '3.2.0',
            info: { title: 'External', version: '1' },
            components: { schemas: { Bad: { type: 'file' } } },
          },
        },
      ],
    },
  );
  const result = await generateSchemaExample(session, '#/components/schemas/Ref', {
    direction: 'request',
    explicit: [{ source: 'example-object', value: 'authored' }],
  });
  expect(result).toMatchObject({
    status: 'value',
    value: 'authored',
    validation: 'unavailable',
    diagnostics: [
      {
        schemaIssues: expect.arrayContaining([
          { documentUri: externalUri, pointer: '#/components/schemas/Bad/type', keyword: 'type' },
        ]),
      },
    ],
  });
});

test.each([
  ['request', 'readOnly', 'required'],
  ['request', 'readOnly', 'dependentRequired'],
  ['response', 'writeOnly', 'required'],
  ['response', 'writeOnly', 'dependentRequired'],
] as const)(
  'locates the %s %s filtered %s keyword without misidentifying an array element',
  async (direction, annotation, keyword) => {
    const uri = 'https://example.test/filtered.json';
    session = await createSchemaDocumentSession(
      {
        openapi: '3.2.0',
        info: { title: 'Filtered diagnostic', version: '1' },
        components: {
          schemas: {
            Bad: {
              type: 'object',
              properties: { ro: { type: 'string', [annotation]: true } },
              [keyword]: keyword === 'required' ? ['ro', 123] : { other: ['ro', 123] },
            },
          },
        },
      } as unknown as SwaggerDoc,
      uri,
    );
    const result = await generateSchemaExample(session, '#/components/schemas/Bad', {
      direction,
      explicit: [{ source: 'example-object', value: { other: 'one' } }],
    });
    expect(result).toMatchObject({
      status: 'value',
      value: { other: 'one' },
      validation: 'unavailable',
      diagnostics: [
        {
          schemaIssues: [{ documentUri: uri, pointer: `#/components/schemas/Bad/${keyword}`, keyword }],
        },
      ],
    });
  },
);
