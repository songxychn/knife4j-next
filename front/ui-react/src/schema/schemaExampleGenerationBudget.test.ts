import { afterEach, expect, test } from 'vitest';
import type { JsonValue } from 'knife4j-schema-engine';
import type { OperationObject, SwaggerDoc } from '../types/swagger';
import { parseMenuTags } from '../api/knife4jClient';
import { generateOperationSchemaExamples } from './operationSchemaExamples';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import { generateSchemaExample } from './schemaExampleGeneration';

const sessions: SchemaDocumentSession[] = [];
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()));

function wideSchema(fields: number, requiredFields = fields): JsonValue {
  const names = Array.from({ length: fields }, (_, index) => `field${index}`);
  return {
    type: 'object',
    properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
    required: names.slice(0, requiredFields),
    additionalProperties: false,
  };
}

async function fixture(schema: JsonValue, openapi = '3.1.1') {
  const media = { schema: { $ref: '#/components/schemas/Value' } };
  const operation: OperationObject = {
    requestBody: { content: { 'application/json': media } },
    responses: { '200': { description: 'ok', content: { 'application/json': media } } },
  };
  const document: SwaggerDoc = {
    openapi,
    info: { title: 'Bounded example generation', version: '1.0.0' },
    paths: { '/values': { post: operation } },
    components: { schemas: { Value: schema as never } },
  };
  const retrievalUri = 'https://examples.knife4j.example/budget.json';
  const selected = parseMenuTags(document, { retrievalUri })[0].operations[0];
  const session = await createSchemaDocumentSession(document, retrievalUri);
  sessions.push(session);
  return { document, selected, session };
}

test.each([
  ['3.1.1', 100],
  ['3.1.1', 70],
  ['3.2.0', 100],
  ['3.2.0', 70],
] as const)('generates all 100 fields with default budgets in OAS %s (%i required)', async (version, required) => {
  const { document, selected, session } = await fixture(wideSchema(100, required), version);
  const result = await generateOperationSchemaExamples(document, selected, session);
  const expected = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, '']));

  expect(result.responses).toHaveLength(1);
  for (const example of [result.request?.result, result.responses[0].result]) {
    expect(example).toMatchObject({
      status: 'value',
      source: 'generated',
      validation: 'valid',
      authored: false,
      value: expected,
      diagnostics: [],
    });
    if (example?.status !== 'value') throw new Error('Expected a complete generated example');
    await expect(session.evaluate('#/components/schemas/Value', example.value)).resolves.toMatchObject({ valid: true });
  }
});

test('extends the default node budget while keeping explicit limits and cancellation effective', async () => {
  const { session } = await fixture(wideSchema(500));
  for (const direction of ['request', 'response'] as const) {
    await expect(generateSchemaExample(session, '#/components/schemas/Value', { direction })).resolves.toMatchObject({
      status: 'value',
      validation: 'valid',
    });
  }
  sessions.pop()!.dispose();
  const small = await fixture(wideSchema(2));
  await expect(
    generateSchemaExample(small.session, '#/components/schemas/Value', {
      direction: 'request',
      limits: { maxNodes: 1 },
    }),
  ).resolves.toMatchObject({ status: 'none', reason: 'search-budget-exceeded' });
  const controller = new AbortController();
  controller.abort();
  await expect(
    generateSchemaExample(small.session, '#/components/schemas/Value', {
      direction: 'request',
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

test('reuses candidates without losing the smaller valid object or leaking between sessions', async () => {
  for (const constant of ['first', 'second']) {
    const { session } = await fixture({
      type: 'object',
      required: ['id'],
      properties: { id: { const: constant }, optional: { type: 'string' } },
      not: { required: ['optional'] },
      additionalProperties: false,
    });
    const result = await generateSchemaExample(session, '#/components/schemas/Value', { direction: 'request' });
    expect(result).toMatchObject({ status: 'value', validation: 'valid', value: { id: constant } });
    if (result.status !== 'value') throw new Error('Expected a valid minimum object');
    await expect(session.evaluate('#/components/schemas/Value', result.value)).resolves.toMatchObject({ valid: true });
    sessions.pop()!.dispose();
  }
});

test('preserves invalid authored examples and rejects impossible generated values', async () => {
  const { session } = await fixture({ type: 'string', minLength: 2, maxLength: 1 });
  await expect(
    generateSchemaExample(session, '#/components/schemas/Value', { direction: 'response' }),
  ).resolves.toMatchObject({ status: 'none', reason: 'no-valid-candidate' });
  await expect(
    generateSchemaExample(session, '#/components/schemas/Value', {
      direction: 'response',
      explicit: [{ source: 'media-example', value: 'author' }],
    }),
  ).resolves.toMatchObject({ status: 'value', source: 'media-example', value: 'author', validation: 'invalid' });
});
