import { describe, expect, test } from 'vitest';
import type { OperationSchemaExamples } from '../../schema/operationSchemaExamples';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import type { SwaggerDoc } from '../../types/swagger';
import { currentApiDocExamples, type ApiDocExampleIdentity, type ApiDocExampleState } from './apiDocExampleState';

const document = { openapi: '3.1.1', info: { title: 'Examples', version: '1' }, paths: {} } as SwaggerDoc;
const session = {} as SchemaDocumentSession;
const identity: ApiDocExampleIdentity = {
  document,
  session,
  retrievalUri: 'https://examples.knife4j.example/openapi.json',
  operationKey: 'Pets/post',
};
const examples: OperationSchemaExamples = { responses: [] };

describe('ApiDoc OAS 3.1 example state', () => {
  test('exposes only a ready result for the current operation and document', () => {
    const ready: ApiDocExampleState = { status: 'ready', identity, examples };
    expect(currentApiDocExamples(ready, identity)).toBe(examples);
    expect(currentApiDocExamples(ready, { ...identity, operationKey: 'Pets/get' })).toBeNull();
    expect(
      currentApiDocExamples(ready, {
        ...identity,
        retrievalUri: 'https://examples.knife4j.example/other.json',
      }),
    ).toBeNull();
    expect(currentApiDocExamples(ready, { ...identity, document: { ...document } })).toBeNull();
    expect(currentApiDocExamples(ready, { ...identity, session: {} as SchemaDocumentSession })).toBeNull();
  });

  test('keeps loading, failed and stale results out of the rendered example tabs', () => {
    expect(currentApiDocExamples({ status: 'idle' }, identity)).toBeNull();
    expect(currentApiDocExamples({ status: 'loading', identity }, identity)).toBeNull();
    expect(currentApiDocExamples({ status: 'error', identity, message: 'failed' }, identity)).toBeNull();
    expect(currentApiDocExamples({ status: 'ready', identity, examples }, null)).toBeNull();
  });
});
