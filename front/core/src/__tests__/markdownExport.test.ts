import { generateApiMarkdown, type ApiMarkdownLabels, type GenerateApiMarkdownOptions } from '../markdownExport';

const baseOptions: GenerateApiMarkdownOptions = {
  method: 'post',
  path: '/users',
  docContext: {},
  operation: {
    summary: 'Create user',
    deprecated: true,
    parameters: [
      {
        name: 'traceId',
        in: 'header',
        required: true,
        schema: { type: 'string' },
      },
    ],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              age: { type: 'integer' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'ok',
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      },
    },
  },
};

const japaneseLabels: ApiMarkdownLabels = {
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
};

describe('generateApiMarkdown labels', () => {
  test('keeps the existing English output by default', () => {
    const markdown = generateApiMarkdown(baseOptions);

    expect(markdown).toContain('> ⚠️ This API is deprecated.');
    expect(markdown).toContain('## Request Parameters');
    expect(markdown).toContain('| Name | In | Type | Required | Description |');
    expect(markdown).toContain('| `traceId` | header | string | Yes |  |');
    expect(markdown).toContain('## Request Body');
    expect(markdown).toContain('| Field | Type | Required | Description |');
    expect(markdown).toContain('| `age` | integer | No |  |');
    expect(markdown).toContain('## Response Structure');
    expect(markdown).toContain('| Status | Description | Schema |');
  });

  test('uses caller-provided Japanese labels, including empty states', () => {
    const markdown = generateApiMarkdown({ ...baseOptions, labels: japaneseLabels });
    const emptyMarkdown = generateApiMarkdown({
      method: 'get',
      path: '/empty',
      docContext: {},
      operation: {},
      labels: japaneseLabels,
    });
    const primitiveBodyMarkdown = generateApiMarkdown({
      method: 'post',
      path: '/primitive',
      docContext: {},
      operation: {
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'string' },
            },
          },
        },
      },
      labels: japaneseLabels,
    });

    expect(markdown).toContain('> ⚠️ この API は非推奨です。');
    expect(markdown).toContain('## リクエストパラメータ');
    expect(markdown).toContain('| 名前 | 位置 | 型 | 必須 | 説明 |');
    expect(markdown).toContain('| `traceId` | header | string | はい |  |');
    expect(markdown).toContain('| フィールド | 型 | 必須 | 説明 |');
    expect(markdown).toContain('| `age` | integer | いいえ |  |');
    expect(markdown).toContain('## レスポンス構造');
    expect(markdown).toContain('| ステータス | 説明 | スキーマ |');
    expect(emptyMarkdown).toContain('_リクエストパラメータはありません。_');
    expect(emptyMarkdown).toContain('_リクエストボディはありません。_');
    expect(emptyMarkdown).toContain('_レスポンスは定義されていません。_');
    expect(primitiveBodyMarkdown).toContain('_リクエストボディのスキーマを展開できません。_');
  });
});
