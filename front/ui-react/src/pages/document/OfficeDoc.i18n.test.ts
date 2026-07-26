import { describe, expect, test, vi } from 'vitest';
import type { MenuTag, SchemaObject, SwaggerDoc } from '../../types/swagger';
import { buildDocx, buildHtmlDoc, buildMarkdownDoc, buildWordDoc, type OfficeDocLabels } from './OfficeDoc';

vi.mock('../../context/GroupContext', () => ({
  useGroup: () => ({}),
}));

const labels: OfficeDocLabels = {
  language: 'ja-JP',
  version: 'バージョン',
  description: '説明',
  name: '名前',
  location: '位置',
  required: '必須',
  type: '型',
  field: 'フィールド名',
  yes: 'はい',
  no: 'いいえ',
  requestBody: 'リクエストボディ',
  responses: 'レスポンス構造',
  response: 'レスポンス',
  statusCode: 'ステータスコード',
  schema: 'Schema',
  deprecated: '非推奨',
  parameters: 'リクエストパラメータ',
  circularReference: '循環参照',
  fallbackTitle: 'API ドキュメント',
  markdown: {
    deprecated: 'この API は非推奨です。',
    requestParameters: 'リクエストパラメータ',
    noRequestParameters: 'リクエストパラメータはありません。',
    requestBody: 'リクエストボディ',
    noRequestBody: 'リクエストボディはありません。',
    requestBodyNotExpandable: 'リクエストボディのスキーマを展開できません。',
    responseStructure: 'レスポンス構造',
    noResponse: 'レスポンスは定義されていません。',
    name: '名前',
    location: '位置',
    type: '型',
    required: '必須',
    description: '説明',
    field: 'フィールド',
    yes: 'はい',
    no: 'いいえ',
    status: 'ステータス',
    schema: 'スキーマ',
  },
};

const doc: SwaggerDoc = {
  openapi: '3.0.1',
  info: {
    title: 'Demo API',
    version: '1.0.0',
    description: 'デモ',
  },
  paths: {},
};

const tags: MenuTag[] = [
  {
    tag: 'Users',
    operations: [
      {
        key: 'users/list',
        path: '/users',
        method: 'get',
        summary: 'List users',
        deprecated: true,
        operation: {
          summary: 'List users',
          deprecated: true,
          parameters: [
            {
              name: 'limit',
              in: 'query',
              required: true,
              schema: { type: 'integer' },
            },
          ],
          responses: {
            200: {
              description: 'ok',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['id'],
                    properties: {
                      id: { type: 'integer' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ],
  },
];

describe('offline document localization', () => {
  test.each([
    ['HTML', buildHtmlDoc],
    ['Word', buildWordDoc],
  ])('%s export uses the selected locale and translated labels', (_name, build) => {
    const output = build(doc, tags, labels);

    expect(output).toContain('<html lang="ja-JP">');
    expect(output).toContain('<strong>バージョン:</strong>');
    expect(output).toContain('<strong>説明:</strong>');
    expect(output).toContain('>必須<');
    expect(output).toContain('>はい<');
    expect(output).toContain('レスポンス構造');
    expect(output).toContain('レスポンス <code>200</code>');
    expect(output).toContain('[非推奨]');
  });

  test('DOCX export uses translated labels', async () => {
    const output = await (await buildDocx(doc, tags, labels)).text();

    expect(output).toContain('バージョン');
    expect(output).toContain('必須');
    expect(output).toContain('はい');
    expect(output).toContain('レスポンス構造');
    expect(output).toContain('非推奨');
  });

  test('Markdown export uses translated labels and fallback title', () => {
    const markdown = buildMarkdownDoc(
      {
        ...doc,
        info: { ...doc.info, title: '' },
      },
      tags,
      labels,
    );

    expect(markdown).toContain('# API ドキュメント');
    expect(markdown).toContain('> ⚠️ この API は非推奨です。');
    expect(markdown).toContain('## リクエストパラメータ');
    expect(markdown).toContain('| 名前 | 位置 | 型 | 必須 | 説明 |');
    expect(markdown).toContain('| `limit` | query | integer | はい |  |');
    expect(markdown).toContain('_リクエストボディはありません。_');
    expect(markdown).toContain('## レスポンス構造');
  });

  test.each([
    ['HTML', buildHtmlDoc],
    ['Word', buildWordDoc],
  ])('%s export localizes the circular reference placeholder', (_name, build) => {
    let schema: SchemaObject = { type: 'string' };
    for (let index = 0; index < 32; index += 1) {
      schema = { type: 'object', properties: { child: schema } };
    }
    const deepTags: MenuTag[] = [
      {
        tag: 'Deep',
        operations: [
          {
            key: 'deep/get',
            path: '/deep',
            method: 'get',
            summary: 'Deep schema',
            operation: {
              responses: {
                200: {
                  description: 'ok',
                  content: { 'application/json': { schema } },
                },
              },
            },
          },
        ],
      },
    ];

    const output = build(doc, deepTags, labels);
    expect(output).toContain('循環参照');
    expect(output).not.toContain('... circular reference ...');
  });
});
