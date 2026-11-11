import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSchemaEngine } from 'knife4j-schema-engine';
import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import { parseMenuTags } from '../api/knife4jClient';
import type { SwaggerDoc } from '../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import { locateOperationResponses, responseForDisplay } from './registeredResponse';
import { createSchemaDisplayProjector } from './schemaDisplayProjection';
import { generateOperationSchemaExamples } from './operationSchemaExamples';
import { evaluateResponseBodySchema, prepareResponseBodySchemaEvaluation } from './responseBodySchemaValidation';
import { projectApiDocSchemaRegions } from '../pages/api/apiDocSchemaProjection';
import { schemaNodeTypeLabel } from '../components/schema/schemaUtils';

const entryUri = 'https://docs.example.test/spec/openapi.json';
const resourceUri = 'https://resources.example.test/responses/openapi.json';
const sessions: SchemaDocumentSession[] = [];

function fixture(): { document: SwaggerDoc; resource: SwaggerDoc } {
  return {
    document: {
      openapi: '3.1.2',
      info: { title: 'Response registry', version: '1' },
      paths: {
        '/result': {
          get: {
            responses: {
              '200': { $ref: `${resourceUri}#/components/responses/Alias`, description: 'Entry annotation' },
            },
          },
        },
      },
    },
    resource: {
      openapi: '3.1.2',
      info: { title: 'Reusable response', version: '1' },
      paths: {},
      components: {
        responses: {
          Alias: { $ref: '#/components/responses/Result', description: 'Inner annotation' },
          Result: {
            description: 'Target annotation',
            headers: { 'x-result': { $ref: '#/components/headers/Result' } },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Result' },
                examples: { authored: { $ref: '#/components/examples/Result' } },
              },
            },
          },
        },
        headers: { Result: { schema: { type: 'string' }, description: 'Result header' } },
        examples: { Result: { value: { id: 'external-result' } } },
        schemas: { Result: { type: 'object', required: ['id'], properties: { id: { const: 'external-result' } } } },
      },
    },
  };
}

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

describe('registered OAS response consumers', () => {
  test('preserves an external inline resource base and its genuine member reference name', async () => {
    const { document, resource } = fixture();
    resource.components!.responses!.Result.content!['application/json'].schema = {
      $id: 'https://resources.example.test/inline-array',
      type: 'array',
      items: { $ref: '#/$defs/Member' },
      $defs: { Member: { type: 'string' } },
    };
    const session = await createSchemaDocumentSession(document, entryUri, {
      resourceDocuments: [{ document: resource, retrievalUri: resourceUri }],
    });
    sessions.push(session);
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Registry-only'));
    const operation = parseMenuTags(document)[0].operations[0];
    const location = locateOperationResponses(document, operation, session)[0].location!;
    const response = responseForDisplay(location, session);
    const schema = response.content!['application/json'].schema as { $ref: string };
    const result = await projectApiDocSchemaRegions(
      [{ key: '200', mode: 'response', schema, reference: schema.$ref }],
      createSchemaDisplayProjector(session),
    );
    expect(result.failures).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.regions[0].fields.map(schemaNodeTypeLabel)).toEqual(['Member[]']);
    expect(network).not.toHaveBeenCalled();
  });

  test.each(['3.1.0', '3.2.0'])(
    'projects a registered physical Schema location without treating its path as a model in OAS %s',
    async (openapi) => {
      const document: SwaggerDoc = {
        openapi,
        info: { title: 'Response types', version: '1' },
        paths: {
          '/result': {
            get: {
              responses: {
                '200': { description: 'String', content: { '*/*': { schema: { type: 'string', example: '0' } } } },
                '201': { description: 'Boolean schema', content: { 'application/json': { schema: false } } },
              },
            },
          },
        },
      };
      const validator = createSchemaEngine();
      try {
        if (openapi.startsWith('3.2')) expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
        else
          expect((await validator.evaluate('https://spec.openapis.org/oas/3.1/schema-base', document)).valid).toBe(
            true,
          );
      } finally {
        validator.dispose();
      }
      const session = await createSchemaDocumentSession(document, entryUri);
      sessions.push(session);
      const operation = parseMenuTags(document, { retrievalUri: entryUri })[0].operations[0];
      const targets = locateOperationResponses(document, operation, session).map(({ statusCode, location }) => {
        const response = responseForDisplay(location!, session);
        const schema = Object.values(response.content!)[0].schema as { $ref: string };
        return { key: statusCode, mode: 'response' as const, schema, reference: schema.$ref };
      });
      const result = await projectApiDocSchemaRegions(targets, createSchemaDisplayProjector(session));
      expect(result.failures).toEqual([]);
      expect(result.regions.map(({ fields }) => fields.map(schemaNodeTypeLabel))).toEqual([['string'], ['never']]);
      expect(result.regions[0].fields[0]).toMatchObject({ type: 'string', example: '0', isRoot: true });
    },
  );

  test('uses one registered response for display, authored examples and actual response validation', async () => {
    const { document, resource } = fixture();
    const validator = createSchemaEngine();
    try {
      for (const input of [document, resource])
        expect((await validator.evaluate('https://spec.openapis.org/oas/3.1/schema-base', input)).valid).toBe(true);
    } finally {
      validator.dispose();
    }
    const original = structuredClone({ document, resource });
    const session = await createSchemaDocumentSession(document, entryUri, {
      resourceDocuments: [{ document: resource, retrievalUri: resourceUri }],
    });
    sessions.push(session);
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Registry-only'));
    const operation = parseMenuTags(document)[0].operations[0];
    const location = locateOperationResponses(document, operation, session)[0].location!;
    expect(location.retrievalUri).toBe(resourceUri);
    const display = responseForDisplay(location, session);
    expect(display.description).toBe('Entry annotation');
    expect(display.headers?.['x-result'].description).toBe('Result header');
    const fields = await createSchemaDisplayProjector(session).projectValue(
      display.content!['application/json'].schema!,
    );
    expect(fields.fields.some((field) => field.name === 'id')).toBe(true);
    const examples = await generateOperationSchemaExamples(document, operation, session);
    expect(examples.responses[0].result).toMatchObject({
      status: 'value',
      source: 'example-object',
      value: { id: 'external-result' },
      validation: 'valid',
    });
    const prepared = prepareResponseBodySchemaEvaluation({
      document,
      operation,
      session,
      statusCode: 200,
      contentType: 'application/json',
      body: '{"id":"external-result"}',
    });
    expect(prepared.status).toBe('ready');
    if (prepared.status === 'ready')
      expect(await evaluateResponseBodySchema(session, prepared)).toEqual({ status: 'valid' });
    expect({ document, resource }).toEqual(original);
    expect(network).not.toHaveBeenCalled();
  });

  test('retains immutable resource data and does not share it across sessions or after disposal', async () => {
    const { document, resource } = fixture();
    const operation = parseMenuTags(document)[0].operations[0];
    const session = await createSchemaDocumentSession(document, entryUri, {
      resourceDocuments: [{ document: resource, retrievalUri: resourceUri }],
    });
    sessions.push(session);
    resource.components!.responses!.Result.description = 'Mutated after registration';
    document.paths['/result'].get!.responses!['200'].description = 'Mutated entry';
    expect(locateOperationResponses(document, operation, session)[0].location?.value.description).toBe(
      'Entry annotation',
    );
    session.dispose();
    expect(locateOperationResponses(document, operation, session)[0].location).toBeNull();
    const isolated = await createSchemaDocumentSession(document, entryUri);
    sessions.push(isolated);
    expect(locateOperationResponses(document, operation, isolated)[0].location).toBeNull();
  });

  test('does not turn a wrong-type reference, cycle or Responses extension into a usable response', async () => {
    const { document, resource } = fixture();
    document.paths['/result'].get!.responses = {
      '200': { $ref: `${resourceUri}#/components/examples/Result` },
      '201': { $ref: '#/paths/~1result/get/responses/201' },
      '204': { description: 'No content' },
      'x-business-data': { content: { 'application/json': { schema: { $ref: 'https://opaque.example.test/data' } } } },
    };
    const session = await createSchemaDocumentSession(document, entryUri, {
      resourceDocuments: [{ document: resource, retrievalUri: resourceUri }],
    });
    sessions.push(session);
    const operation = parseMenuTags(document)[0].operations[0];
    const responses = locateOperationResponses(document, operation, session);
    expect(responses.map((response) => response.statusCode)).toEqual(['200', '201', '204']);
    expect(responses.map((response) => response.location?.value.description ?? null)).toEqual([
      null,
      null,
      'No content',
    ]);
  });
});

describe('OAS 3.2 Response metadata consumer regression', () => {
  test.each(['3.2.0', '3.2.99'])('keeps outer summary and empty description in %s', (openapi) => {
    const document: SwaggerDoc = {
      openapi,
      info: { title: 'Metadata', version: '1' },
      paths: {
        '/result': {
          get: {
            responses: {
              '200': { $ref: '#/components/responses/Result', summary: 'Outer', description: '' },
              '204': {},
            },
          },
        },
      },
      components: { responses: { Result: { summary: 'Target', description: 'Target description' } } },
    };
    const operation = parseMenuTags(document, { retrievalUri: entryUri })[0].operations[0];
    const records = locateOperationResponses(document, operation);
    expect(records[0].location?.value).toMatchObject({ summary: 'Outer', description: '' });
    expect(records[1].location?.value).toEqual({});
  });
});
