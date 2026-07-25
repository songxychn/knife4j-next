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
});
