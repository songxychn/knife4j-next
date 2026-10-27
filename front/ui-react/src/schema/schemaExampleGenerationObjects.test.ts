import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildOperationDebugModel } from 'knife4j-core';
import type { JsonValue } from 'knife4j-schema-engine';
import { parseMenuTags } from '../api/knife4jClient';
import issue963Document from '../test-fixtures/issue963-springdoc-oas31.json';
import type { SwaggerDoc } from '../types/swagger';
import { generateOas31DebugBodyExamples } from '../pages/api/oas31DebugExamples';
import * as schemaSessions from './schemaDocumentSession';
import { generateSchemaExample } from './schemaExampleGeneration';

const sessions: schemaSessions.SchemaDocumentSession[] = [];
const reference = '#/components/schemas/Value';

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

async function fixture(schema: JsonValue, openapi = '3.1.0') {
  const document = {
    openapi,
    info: { title: 'Bounded object examples', version: '1' },
    paths: {},
    components: { schemas: { Value: schema } },
  } as SwaggerDoc;
  const session = await schemaSessions.createSchemaDocumentSession(
    document,
    'https://examples.knife4j.example/objects.json',
  );
  sessions.push(session);
  return session;
}

async function generatedValue(session: schemaSessions.SchemaDocumentSession, direction: 'request' | 'response') {
  const result = await generateSchemaExample(session, reference, { direction });
  expect(result).toMatchObject({ status: 'value', source: 'generated', validation: 'valid' });
  if (result.status !== 'value') throw new Error(`Expected a valid object, received ${result.reason}`);
  await expect(session.evaluate(reference, result.value)).resolves.toMatchObject({ valid: true });
  return result.value;
}

describe('issue #963 object candidate coverage', () => {
  // Actual /v3/api-docs from taofangf/knife4j-next-demo@2eba11d, Boot 4.1.2 /
  // springdoc 3.0.3 / Knife4j 5.7.10. Only the local servers entry is omitted.
  test.each(['/sysmgr/user/create', '/sysmgr/user/modify'])('fills a validated debug Body for %s', async (path) => {
    const document = issue963Document as unknown as SwaggerDoc;
    const operation = parseMenuTags(document)
      .flatMap((tag) => tag.operations)
      .find((item) => item.path === path)!;
    const model = buildOperationDebugModel({ doc: document, path, method: 'post' });
    const session = await schemaSessions.createSchemaDocumentSession(
      document,
      'https://examples.knife4j.example/issue963.json',
    );
    sessions.push(session);

    const generated = await generateOas31DebugBodyExamples(document, operation, model, session);
    expect(generated.resultByMediaType['application/json']).toMatchObject({
      status: 'value',
      source: 'generated',
      validation: 'valid',
      authored: false,
    });
    const body = generated.defaults.bodyByMediaType['application/json'];
    expect(body).not.toBe('');
    const value = JSON.parse(body) as Record<string, unknown>;
    expect(value.username).toEqual(expect.stringMatching(/^\w+$/));
    const name = path.endsWith('create') ? 'UserReqVO' : 'UserModifyReqVO';
    await expect(session.evaluate(`#/components/schemas/${name}`, value)).resolves.toMatchObject({ valid: true });
    await expect(generateOas31DebugBodyExamples(document, operation, model, session)).resolves.toEqual(generated);
  });

  test.each(['3.1.0', '3.2.0'].flatMap((version) => [0, 2, 7].map((position) => [version, position] as const)))(
    'covers an early constrained field in OAS %s at position %i',
    async (version, position) => {
      const entries: Array<[string, JsonValue]> = Array.from({ length: 7 }, (_, index) => [
        `field${index}`,
        { type: 'string' },
      ]);
      entries.splice(position, 0, ['username', { type: 'string', pattern: '^\\w+$' }]);
      const session = await fixture(
        { type: 'object', properties: Object.fromEntries(entries), required: entries.map(([name]) => name) },
        version,
      );
      for (const direction of ['request', 'response'] as const) {
        const first = await generatedValue(session, direction);
        await expect(generatedValue(session, direction)).resolves.toEqual(first);
      }
    },
  );

  test('covers different valid choices in multiple constrained fields', async () => {
    const properties = {
      first: { type: 'string', pattern: '^s[t]ring$' },
      second: { type: 'string', pattern: '^e[x]ample$' },
      a: { type: 'string' },
      b: { type: 'string' },
      c: { type: 'string' },
    };
    const session = await fixture({ type: 'object', properties, required: Object.keys(properties) });
    expect(await generatedValue(session, 'request')).toMatchObject({ first: 'string', second: 'example' });
  });

  test('keeps minimum-object candidates when the full-object pool fills the budget', async () => {
    const properties = Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [`field${index}`, { type: 'string' }]),
    );
    const session = await fixture({
      type: 'object',
      properties,
      required: ['field0'],
      not: { required: ['field1'] },
      additionalProperties: false,
    });
    expect(await generatedValue(session, 'request')).toEqual({ field0: '' });
  });

  test('keeps cross-field constraints in the final validation', async () => {
    const properties = {
      first: { type: 'string', pattern: '^\\w+$' },
      second: { type: 'string' },
      a: { type: 'string' },
      b: { type: 'string' },
    };
    const session = await fixture({
      type: 'object',
      properties,
      required: Object.keys(properties),
      not: { properties: { first: { const: 'string' } }, required: ['first'] },
    });
    const value = await generatedValue(session, 'request');
    expect(value).not.toMatchObject({ first: 'string' });
  });

  test.each([
    [{ maxCandidates: 7, maxEvaluations: 3 }, 3],
    [{ maxCandidates: 2, maxEvaluations: 48 }, 2],
    [{}, 48],
  ])('bounds evaluations and never returns an invalid generated object with limits %j', async (limits, maximum) => {
    const session = await fixture({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' } },
      required: ['a', 'b', 'c'],
      not: {},
    });
    const evaluate = vi.spyOn(schemaSessions, 'evaluateSchemaDocumentDirectionally');
    await expect(generateSchemaExample(session, reference, { direction: 'request', limits })).resolves.toMatchObject({
      status: 'none',
    });
    expect(evaluate.mock.calls.length).toBeGreaterThan(0);
    expect(evaluate.mock.calls.length).toBeLessThanOrEqual(maximum);
  });
});
