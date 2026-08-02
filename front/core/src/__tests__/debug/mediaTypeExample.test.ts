import { buildMediaTypeExampleValue } from '../../debug/mediaTypeExample';

describe('buildMediaTypeExampleValue', () => {
  test.each([
    ['object', { message: '', ok: true }],
    ['array', ['alpha', 2]],
    ['number', 123],
    ['boolean', false],
  ])('serializes a native JSON %s example without changing its type', (_label, value) => {
    const rendered = buildMediaTypeExampleValue(
      { example: value },
      undefined,
      { doc: {} },
      { mediaType: 'application/json' },
    );

    expect(JSON.parse(rendered!)).toEqual(value);
  });

  test('resolves a referenced Example Object and preserves its native object value', () => {
    const value = { pictureUrl: '', title: 'cover' };
    const doc = {
      components: {
        examples: {
          Picture: { value },
        },
      },
    };

    const rendered = buildMediaTypeExampleValue(
      {
        examples: {
          picture: { $ref: '#/components/examples/Picture' },
        },
      },
      undefined,
      { doc },
      { mediaType: 'application/json' },
    );

    expect(JSON.parse(rendered!)).toEqual(value);
  });
});
