import { selectRequestBodyExample, selectResponseExamples } from '../../debug/operationExamples';

describe('operation example selection', () => {
  const doc = {
    components: {
      examples: {
        Created: {
          value: { id: 42, message: '' },
        },
      },
      schemas: {
        Result: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
          },
        },
        BinaryFile: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  };

  test('prefers application/json and resolves a local named example', () => {
    const selected = selectRequestBodyExample(
      {
        content: {
          'text/plain': { example: 'plain' },
          'application/json': {
            examples: {
              created: { $ref: '#/components/examples/Created' },
            },
          },
        },
      },
      undefined,
      { doc },
    );

    expect(selected).toEqual({
      mediaType: 'application/json',
      value: JSON.stringify({ id: 42, message: '' }, null, 2),
    });
  });

  test('supports example-only media and keeps explicitly empty values', () => {
    expect(
      selectRequestBodyExample(
        {
          content: {
            'text/plain': { example: '' },
          },
        },
        undefined,
        { doc },
      ),
    ).toEqual({ mediaType: 'text/plain', value: '' });
  });

  test('falls back to a generated schema example', () => {
    const selected = selectRequestBodyExample(
      {
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Result' },
          },
        },
      },
      undefined,
      { doc },
    );

    expect(selected).toEqual({
      mediaType: 'application/json',
      value: JSON.stringify({ ok: true }, null, 2),
    });
  });

  test('selects one example per response and suppresses generated binary placeholders', () => {
    const selected = selectResponseExamples(
      {
        '200': {
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Result' },
            },
          },
        },
        '201': {
          content: {
            '*/*': {
              examples: {
                created: { $ref: '#/components/examples/Created' },
              },
            },
          },
        },
        '206': {
          content: {
            'application/octet-stream': {
              schema: { $ref: '#/components/schemas/BinaryFile' },
            },
          },
        },
      },
      { doc },
    );

    expect(selected).toEqual([
      {
        statusCode: '200',
        mediaType: 'application/json',
        value: JSON.stringify({ ok: true }, null, 2),
      },
      {
        statusCode: '201',
        mediaType: '*/*',
        value: JSON.stringify({ id: 42, message: '' }, null, 2),
      },
    ]);
  });

  test('does not fetch externalValue and uses the schema fallback instead', () => {
    const selected = selectResponseExamples(
      {
        '200': {
          content: {
            'application/json': {
              schema: { type: 'string' },
              examples: {
                remote: { externalValue: 'https://example.com/example.json' },
              },
            },
          },
        },
      },
      { doc },
    );

    expect(selected).toEqual([
      {
        statusCode: '200',
        mediaType: 'application/json',
        value: JSON.stringify('string', null, 2),
      },
    ]);
  });

  test('preserves the legacy response.schema binary fallback when content is absent', () => {
    expect(
      selectResponseExamples(
        {
          '200': {
            schema: { type: 'string', format: 'binary' },
          },
        },
        { doc },
      ),
    ).toEqual([
      {
        statusCode: '200',
        mediaType: 'application/json',
        value: JSON.stringify('', null, 2),
      },
    ]);
  });
});
