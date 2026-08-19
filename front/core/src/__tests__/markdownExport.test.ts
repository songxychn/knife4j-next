import { buildExportDocument, type ExportDocumentSource, type ExportTagSource } from '../exportDocument';
import {
  generateApiMarkdown,
  renderExportDocumentMarkdown,
  type ApiMarkdownLabels,
  type GenerateApiMarkdownOptions,
} from '../markdownExport';

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

    expect(markdown.split('\n')[0]).toBe('# Create user');
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

describe('shared export model Markdown rendering', () => {
  const doc: ExportDocumentSource = {
    info: {
      title: 'Unified API',
      version: '1.2.3',
      description: 'One semantic document.',
    },
    components: {
      schemas: {
        Profile: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', description: 'Contact email' },
          },
        },
        CreateUser: {
          type: 'object',
          required: ['profile'],
          properties: {
            profile: { $ref: '#/components/schemas/Profile' },
          },
        },
        UserEnvelope: {
          type: 'object',
          required: ['data'],
          properties: {
            data: { $ref: '#/components/schemas/CreateUser' },
          },
        },
      },
    },
  };
  const tags: ExportTagSource[] = [
    {
      tag: 'Users',
      description: 'User operations.',
      operations: [
        {
          method: 'post',
          path: '/users',
          operation: {
            summary: 'Create user',
            description: 'Creates one user.',
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
                'application/json': { schema: { $ref: '#/components/schemas/CreateUser' } },
              },
            },
            responses: {
              201: {
                description: 'Created',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/UserEnvelope' } },
                },
              },
            },
          },
        },
      ],
    },
  ];

  test('renders the complete document with the agreed heading hierarchy and version', () => {
    const markdown = renderExportDocumentMarkdown(buildExportDocument(doc, tags));
    const lines = markdown.split('\n');

    expect(lines).toContain('# Unified API');
    expect(lines).toContain('**Version:** 1.2.3');
    expect(lines).toContain('# Users');
    expect(lines).toContain('## Create user');
    expect(lines).toContain('### Request Parameters');
    expect(lines).toContain('### Request Body');
    expect(lines).toContain('### Response Structure');
    expect(lines).toContain('#### Status `201`');
    expect(markdown).toContain('| `profile.email` | string | Yes | Contact email |');
    expect(markdown).toContain('| `data.profile.email` | string | Yes | Contact email |');
  });

  test('keeps the single-operation compatibility wrapper at H1 while allowing an explicit shift', () => {
    const h1 = generateApiMarkdown(baseOptions);
    const h2 = generateApiMarkdown({ ...baseOptions, headingLevel: 2 });

    expect(h1.split('\n')[0]).toBe('# Create user');
    expect(h1).toContain('## Request Parameters');
    expect(h2.split('\n')[0]).toBe('## Create user');
    expect(h2).toContain('### Request Parameters');
  });

  test('preserves the complete legacy single-operation output while the full document gains detail', () => {
    const markdown = generateApiMarkdown({
      method: 'post',
      path: '/binary',
      docContext: {
        components: {
          schemas: {
            Node: {
              type: 'object',
              properties: {
                value: { type: 'string' },
                child: { $ref: '#/components/schemas/Node' },
              },
            },
          },
        },
      },
      operation: {
        parameters: [
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', format: 'int64' },
          },
          {
            name: 'chunks',
            in: 'query',
            schema: {
              type: 'array',
              items: { type: 'string', format: 'byte' },
            },
          },
          {
            name: 'legacyByte',
            in: 'query',
            type: 'string',
            format: 'byte',
          },
        ],
        requestBody: {
          description: 'Upload payload description',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['payload'],
                properties: {
                  payload: { type: 'string', format: 'byte', description: 'binary | data\nline' },
                  nested: {
                    type: 'object',
                    properties: { id: { type: 'integer' } },
                  },
                  child: { $ref: '#/components/schemas/Node' },
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
                schema: { type: 'array', items: { type: 'string', format: 'byte' } },
              },
            },
          },
          400: {
            description: 'bad request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { code: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    });

    expect(markdown).toBe(
      [
        '# /binary',
        '',
        '**POST** `/binary`',
        '',
        '## Request Parameters',
        '',
        '| Name | In | Type | Required | Description |',
        '| --- | --- | --- | --- | --- |',
        '| `offset` | query | integer/int64 | No |  |',
        '| `chunks` | query | byte[] | No |  |',
        '| `legacyByte` | query | string/byte | No |  |',
        '',
        '## Request Body',
        '',
        '| Field | Type | Required | Description |',
        '| --- | --- | --- | --- |',
        '| `payload` | byte | Yes | binary \\| data line |',
        '| `nested` | object | No |  |',
        '| `child` | Node | No |  |',
        '',
        '## Response Structure',
        '',
        '| Status | Description | Schema |',
        '| --- | --- | --- |',
        '| 200 | ok | byte[] |',
        '| 400 | bad request | object |',
        '',
      ].join('\n'),
    );
  });

  test('preserves legacy media selection, fallback order and one-hop root ref behavior', () => {
    const selectionMarkdown = generateApiMarkdown({
      method: 'post',
      path: '/selection',
      docContext: {},
      operation: {
        summary: '   ',
        requestBody: {
          content: {
            'text/plain': {},
            'application/xml': { schema: { type: 'integer' } },
          },
        },
        responses: {
          200: {
            description: 'first entry has no schema',
            content: {
              'text/plain': {},
              'application/xml': { schema: { type: 'integer' } },
            },
          },
          201: {
            description: 'OAS2 fallback wins',
            schema: { type: 'string' },
            content: { 'application/xml': { schema: { type: 'integer' } } },
          },
        },
      },
    });
    const multiHopRefMarkdown = generateApiMarkdown({
      method: 'post',
      path: '/refs',
      docContext: {
        components: {
          schemas: {
            A: { $ref: '#/components/schemas/B' },
            B: { type: 'object', properties: { id: { type: 'string' } } },
          },
        },
      },
      operation: {
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/A' } } },
        },
      },
    });

    expect(selectionMarkdown.split('\n')[0]).toBe('#    ');
    expect(selectionMarkdown).toContain('_No request body._');
    expect(selectionMarkdown).toContain('| 200 | first entry has no schema |  |');
    expect(selectionMarkdown).toContain('| 201 | OAS2 fallback wins | string |');
    expect(multiHopRefMarkdown).toContain('_Request body schema cannot be expanded._');
    expect(multiHopRefMarkdown).not.toContain('| `id` |');
  });
});
