import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSchemaEngine } from 'knife4j-schema-engine';
import { parseMenuTags } from '../api/knife4jClient';
import type { SwaggerDoc } from '../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import { locateOperationResponses, responseForDisplay } from './registeredResponse';
import { createSchemaDisplayProjector } from './schemaDisplayProjection';
import { generateOperationSchemaExamples } from './operationSchemaExamples';
import { evaluateResponseBodySchema, prepareResponseBodySchemaEvaluation } from './responseBodySchemaValidation';

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
