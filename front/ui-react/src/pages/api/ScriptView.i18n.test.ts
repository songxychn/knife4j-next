import { describe, expect, test, vi } from 'vitest';
import type { SchemaObject, SwaggerDoc } from '../../types/swagger';
import { generateCode, type CodeCommentLabels } from './ScriptView';

vi.mock('./useCurrentOperation', () => ({
  OperationModeLayout: () => null,
  useCurrentOperation: () => ({}),
}));

const doc: SwaggerDoc = {
  openapi: '3.0.1',
  info: { title: 'Demo', version: '1.0.0' },
  paths: {},
};

const labels: CodeCommentLabels = {
  requestBody: 'リクエストボディ',
  requestInterface: 'リクエストパラメータインターフェース',
  requestType: 'リクエストパラメータ型',
  responseInterface: 'レスポンスインターフェース',
  responseType: 'レスポンス型',
};

describe('ScriptView generated comments', () => {
  test('localizes object interface comments without changing identifiers', () => {
    const schema: SchemaObject = {
      type: 'object',
      properties: { id: { type: 'string' } },
    };
    const code = generateCode('POST', '/users', 'createUser', undefined, [], schema, schema, doc, labels);

    expect(code.ts).toContain('// リクエストパラメータインターフェース');
    expect(code.ts).toContain('export interface CreateUserParams');
    expect(code.ts).toContain('// レスポンスインターフェース');
    expect(code.ts).toContain('export interface CreateUserRes');
    expect(code.ts).toContain('@param params リクエストボディ');
    expect(code.js).toContain('@param {object} params リクエストボディ');
    expect(code.ts).not.toContain('request body');
    expect(code.js).not.toContain('request body');
  });

  test('localizes array type comments without changing identifiers', () => {
    const schema: SchemaObject = {
      type: 'array',
      items: { type: 'string' },
    };
    const code = generateCode('POST', '/users', 'createUser', undefined, [], schema, schema, doc, labels).ts;

    expect(code).toContain('// リクエストパラメータ型');
    expect(code).toContain('export type CreateUserParams = string[];');
    expect(code).toContain('// レスポンス型');
    expect(code).toContain('export type CreateUserRes = string[];');
  });

  test('renders OAS 3.1 nullable type arrays as TypeScript unions', () => {
    const schema: SchemaObject = {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: ['string', 'null'] },
      },
    };
    const code = generateCode(
      'POST',
      '/users',
      'createUser',
      undefined,
      [],
      schema,
      schema,
      { ...doc, openapi: '3.1.1' },
      labels,
    ).ts;

    expect(code).toContain('name: string | null;');
  });

  test('parenthesizes nullable array item unions', () => {
    const schema: SchemaObject = {
      type: 'array',
      items: { type: ['string', 'null'] },
    };
    const code = generateCode(
      'POST',
      '/aliases',
      'createAliases',
      undefined,
      [],
      schema,
      schema,
      { ...doc, openapi: '3.1.2' },
      labels,
    ).ts;

    expect(code).toContain('export type CreateAliasesParams = (string | null)[];');
    expect(code).toContain('export type CreateAliasesRes = (string | null)[];');
  });

  test('strips the legacy UsingTRACE suffix from generated function names', () => {
    const code = generateCode(
      'TRACE',
      '/diagnostics',
      'traceDiagnosticsUsingTRACE',
      undefined,
      [],
      undefined,
      undefined,
      doc,
      labels,
    );

    expect(code.ts).toContain('export function traceDiagnostics(');
    expect(code.ts).not.toContain('traceDiagnosticsUsingTRACE');
  });

  test('resolves nested $defs and intersects same-property $ref siblings', () => {
    const oas31Doc = {
      ...doc,
      openapi: '3.1.2',
      components: {
        schemas: {
          Wrapper: {
            $defs: {
              Payload: {
                type: 'object',
                properties: { id: { type: 'string' } },
              },
            },
          },
          Base: {
            type: 'object',
            properties: { value: { type: 'string' } },
          },
        },
      },
    } as SwaggerDoc;

    const requestSchema = { $ref: '#/components/schemas/Wrapper/$defs/Payload' } as SchemaObject;
    const responseSchema = {
      $ref: '#/components/schemas/Base',
      properties: { value: { minLength: 2 } },
    } as SchemaObject;
    const code = generateCode(
      'POST',
      '/payloads',
      'createPayload',
      undefined,
      [],
      requestSchema,
      responseSchema,
      oas31Doc,
      labels,
    ).ts;

    expect(code).toContain('id?: string;');
    expect(code).toContain('value?: string;');
  });
});
