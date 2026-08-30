import { afterEach, describe, expect, test } from 'vitest';
import type { BodyContent, OperationDebugModel } from 'knife4j-core';
import type { MenuOperation, OperationObject, SwaggerDoc } from '../../types/swagger';
import { createSchemaDocumentSession, type SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import {
  canHydrateOas31DebugDefaults,
  emptyOas31BodyContentDefaults,
  generateOas31DebugBodyExamples,
  type Oas31DebugExampleIdentity,
  type Oas31DebugExampleState,
} from './oas31DebugExamples';

const sessions: SchemaDocumentSession[] = [];

function fixture(): { document: SwaggerDoc; operation: MenuOperation; debugModel: OperationDebugModel } {
  const jsonSchema = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      serverId: { type: 'integer', readOnly: true },
    },
    additionalProperties: false,
  };
  const formSchema = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1 },
      count: { type: 'integer', minimum: 1 },
    },
    additionalProperties: false,
  };
  const operationObject: OperationObject = {
    requestBody: {
      content: {
        'application/json': { schema: jsonSchema },
        'application/x-www-form-urlencoded': { schema: formSchema },
      },
    },
    responses: { 204: { description: 'created' } },
  };
  const document: SwaggerDoc = {
    openapi: '3.1.1',
    info: { title: 'Debug defaults', version: '1.0.0' },
    paths: { '/pets': { post: operationObject } },
  };
  const operation: MenuOperation = {
    key: 'Pets/post',
    path: '/pets',
    method: 'post',
    summary: 'Create pet',
    operation: operationObject,
    source: 'path',
  };
  const jsonBody: BodyContent = {
    mediaType: 'application/json',
    category: 'json',
    schema: jsonSchema,
    exampleValue: JSON.stringify({ name: 'legacy-invalid', serverId: 1 }, null, 2),
  };
  const formBody: BodyContent = {
    mediaType: 'application/x-www-form-urlencoded',
    category: 'urlencoded',
    schema: formSchema,
  };
  const debugModel: OperationDebugModel = {
    pathParams: [],
    queryParams: [],
    headerParams: [],
    cookieParams: [],
    bodyContents: [jsonBody, formBody],
    bodyRequired: true,
  };
  return { document, operation, debugModel };
}

afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
});

describe('OAS 3.1 debug defaults', () => {
  test('suppresses the synchronous fallback until a validated async value exists', () => {
    const { debugModel } = fixture();
    const defaults = emptyOas31BodyContentDefaults(debugModel);

    expect(defaults.bodyByMediaType).toEqual({
      'application/json': '',
      'application/x-www-form-urlencoded': '',
    });
    expect(defaults.formFieldsByMediaType['application/x-www-form-urlencoded']).toEqual({ name: '', count: '' });
  });

  test('uses the shared generator for JSON and form defaults', async () => {
    const { document, operation, debugModel } = fixture();
    const session = await createSchemaDocumentSession(document, 'https://examples.knife4j.example/debug.json');
    sessions.push(session);

    const generated = await generateOas31DebugBodyExamples(document, operation, debugModel, session);
    const jsonValue = JSON.parse(generated.defaults.bodyByMediaType['application/json']) as Record<string, unknown>;

    expect(generated.resultByMediaType['application/json']).toMatchObject({
      status: 'value',
      source: 'generated',
      validation: 'valid',
    });
    expect(jsonValue).toMatchObject({ name: expect.any(String) });
    expect(jsonValue).not.toHaveProperty('serverId');
    expect(generated.defaults.formFieldsByMediaType['application/x-www-form-urlencoded']).toMatchObject({
      name: expect.any(String),
      count: expect.stringMatching(/^\d/),
    });
  });
});

describe('async hydration guard', () => {
  const identity: Oas31DebugExampleIdentity = {
    retrievalUri: 'https://examples.knife4j.example/debug.json',
    operationKey: 'Pets/post',
  };
  const ready: Oas31DebugExampleState = {
    status: 'ready',
    identity,
    examples: {
      defaults: { bodyByMediaType: {}, formFieldsByMediaType: {} },
      resultByMediaType: {},
    },
  };

  test('applies a current result only before the user edits', () => {
    const base = {
      state: ready,
      currentIdentity: identity,
      hydratedDebugCacheKey: 'pets',
      currentDebugCacheKey: 'pets',
      alreadyApplied: false,
    };
    expect(canHydrateOas31DebugDefaults({ ...base, editRevision: 0 })).toBe(true);
    expect(canHydrateOas31DebugDefaults({ ...base, editRevision: 1 })).toBe(false);
    expect(canHydrateOas31DebugDefaults({ ...base, editRevision: 0, alreadyApplied: true })).toBe(false);
  });

  test('rejects results from a previous operation, group or cache identity', () => {
    const base = {
      state: ready,
      editRevision: 0,
      hydratedDebugCacheKey: 'pets',
      currentDebugCacheKey: 'pets',
      alreadyApplied: false,
    };
    expect(
      canHydrateOas31DebugDefaults({
        ...base,
        currentIdentity: { ...identity, operationKey: 'Pets/get' },
      }),
    ).toBe(false);
    expect(
      canHydrateOas31DebugDefaults({
        ...base,
        currentIdentity: { ...identity, retrievalUri: 'https://examples.knife4j.example/other.json' },
      }),
    ).toBe(false);
    expect(canHydrateOas31DebugDefaults({ ...base, currentIdentity: identity, currentDebugCacheKey: 'other' })).toBe(
      false,
    );
  });
});
