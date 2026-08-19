import {
  buildExportDocument,
  buildExportOperation,
  type ExportDocumentSource,
  type ExportTagSource,
  type MdSchemaObject,
} from '../exportDocument';

describe('buildExportDocument', () => {
  const doc: ExportDocumentSource = {
    info: {
      title: '',
      version: '2026.8.19',
      description: 'Shared export contract.',
    },
    components: {
      schemas: {
        Address: {
          type: 'object',
          required: ['city'],
          properties: {
            city: { type: 'string', description: 'Home city' },
          },
        },
        Profile: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email', description: 'Contact email' },
            address: { $ref: '#/components/schemas/Address' },
          },
        },
        CreatePerson: {
          type: 'object',
          required: ['name', 'profile'],
          properties: {
            name: { type: 'string', description: 'Display name' },
            profile: { $ref: '#/components/schemas/Profile' },
          },
        },
        ErrorItem: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', description: 'Machine error code' },
          },
        },
        ErrorEnvelope: {
          type: 'object',
          properties: {
            errors: {
              type: 'array',
              description: 'Validation errors',
              items: { $ref: '#/components/schemas/ErrorItem' },
            },
          },
        },
      },
    },
  };

  const tags: ExportTagSource[] = [
    {
      tag: 'People',
      description: 'People operations.',
      operations: [
        {
          method: 'post',
          path: '/people',
          operation: {
            summary: 'Create a person',
            description: 'Creates a nested person.',
            deprecated: true,
            parameters: [
              {
                name: 'traceId',
                in: 'header',
                required: true,
                schema: { type: 'string' },
                description: 'Trace identifier',
              },
            ],
            requestBody: {
              required: true,
              description: 'Person input',
              content: {
                'text/plain': { schema: { type: 'string' } },
                'application/json': { schema: { $ref: '#/components/schemas/CreatePerson' } },
              },
            },
            responses: {
              201: {
                description: 'Created',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/CreatePerson' } },
                },
              },
              422: {
                description: 'Invalid',
                schema: { $ref: '#/components/schemas/ErrorEnvelope' },
              },
            },
          },
        },
        {
          method: 'get',
          path: '/people/health',
          operation: { responses: {} },
        },
      ],
    },
    {
      tag: 'Audit',
      description: 'Audit operations.',
      operations: [
        {
          method: 'get',
          path: '/audit',
          operation: { summary: 'List audit entries', responses: {} },
        },
      ],
    },
  ];

  test('preserves menu order, builds numbering and applies the final title fallback', () => {
    const result = buildExportDocument(doc, tags, { fallbackTitle: 'Fallback API' });

    expect(result.title).toBe('Fallback API');
    expect(result.version).toBe('2026.8.19');
    expect(result.description).toBe('Shared export contract.');
    expect(result.tags.map((tag) => tag.name)).toEqual(['People', 'Audit']);
    expect(result.tags.map((tag) => tag.numberPath)).toEqual([[1], [2]]);
    expect(result.tags[0].operations.map((operation) => operation.title)).toEqual([
      'Create a person',
      'GET /people/health',
    ]);
    expect(result.tags[0].operations.map((operation) => operation.numberPath)).toEqual([
      [1, 1],
      [1, 2],
    ]);
    expect(result.tags[1].operations[0].numberPath).toEqual([2, 1]);
  });

  test('extracts parameters and recursively flattens request and response schemas', () => {
    const operation = buildExportDocument(doc, tags, { fallbackTitle: 'Fallback API' }).tags[0].operations[0];

    expect(operation).toMatchObject({
      method: 'POST',
      path: '/people',
      summary: 'Create a person',
      description: 'Creates a nested person.',
      deprecated: true,
      parameters: [
        {
          name: 'traceId',
          location: 'header',
          required: true,
          typeDisplay: 'string',
          compactTypeDisplay: 'string',
          description: 'Trace identifier',
        },
      ],
      requestBody: {
        description: 'Person input',
        required: true,
        schema: {
          mediaType: 'application/json',
          typeDisplay: 'CreatePerson',
          kind: 'object',
        },
      },
    });
    expect(operation.requestBody?.schema?.fields.map((field) => field.fieldPath)).toEqual([
      'name',
      'profile',
      'profile.email',
      'profile.address',
      'profile.address.city',
    ]);
    expect(operation.requestBody?.schema?.fields.find((field) => field.fieldPath === 'profile.email')).toMatchObject({
      typeDisplay: 'string / email',
      required: true,
      description: 'Contact email',
      truncated: false,
    });

    expect(operation.responses.map((response) => response.statusCode)).toEqual(['201', '422']);
    expect(operation.responses[1].schema).toMatchObject({
      mediaType: 'application/json',
      typeDisplay: 'ErrorEnvelope',
    });
    expect(operation.responses[1].schema?.fields.map((field) => field.fieldPath)).toEqual(['errors', 'errors[].code']);
    expect(operation.responses[1].schema?.fields[1]).toMatchObject({
      required: true,
      description: 'Machine error code',
      truncated: false,
    });
  });

  test('uses item-level required fields for a top-level inline array schema', () => {
    const operation = buildExportOperation(
      {
        method: 'post',
        path: '/batch',
        operation: {
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id'],
                    properties: {
                      id: { type: 'integer', format: 'int64' },
                      label: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      {},
    );

    expect(operation.requestBody?.schema?.fields).toEqual([
      {
        fieldPath: 'id',
        typeDisplay: 'integer / int64',
        required: true,
        description: '',
        truncated: false,
        depth: 0,
      },
      {
        fieldPath: 'label',
        typeDisplay: 'string',
        required: false,
        description: '',
        truncated: false,
        depth: 0,
      },
    ]);
  });
});

describe('export schema recursion guards', () => {
  test('marks a circular schema field as truncated without localizing it', () => {
    const doc: ExportDocumentSource = {
      info: { title: 'Cycles', version: '1' },
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
    };
    const operation = buildExportOperation(
      {
        method: 'post',
        path: '/nodes',
        operation: {
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } },
          },
        },
      },
      doc,
    );

    expect(operation.requestBody?.schema?.fields).toEqual([
      {
        fieldPath: 'value',
        typeDisplay: 'string',
        required: false,
        description: '',
        truncated: false,
        depth: 0,
      },
      {
        fieldPath: 'child',
        typeDisplay: 'Node',
        required: false,
        description: '',
        truncated: true,
        depth: 0,
      },
    ]);
  });

  test('stops inline object expansion at the legacy depth limit', () => {
    let schema: MdSchemaObject = { type: 'string' };
    for (let index = 0; index < 32; index += 1) {
      schema = { type: 'object', properties: { child: schema } };
    }

    const operation = buildExportOperation(
      {
        method: 'post',
        path: '/deep',
        operation: {
          requestBody: { content: { 'application/json': { schema } } },
        },
      },
      {},
    );
    const fields = operation.requestBody?.schema?.fields ?? [];

    expect(fields).toHaveLength(31);
    expect(fields.filter((field) => field.truncated)).toHaveLength(1);
    expect(fields[fields.length - 1].fieldPath.split('.')).toHaveLength(31);
  });
});
