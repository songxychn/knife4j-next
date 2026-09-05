import {
  encodeParameterComponent,
  encodeReservedQueryValue,
  parseOas31ParameterValue,
  replaceSerializedPathParams,
  serializeOas31Parameters,
} from '../../debug/parameterSerialization';
import type { DebugParam, Oas31ParameterSerialization, ParamIn, SchemaValue } from '../../debug/types';

function parameter(
  name: string,
  in_: ParamIn,
  serialization: Oas31ParameterSerialization,
  schema: SchemaValue,
  type = typeof schema === 'object' && typeof schema.type === 'string' ? schema.type : 'string',
): DebugParam {
  return {
    name,
    in: in_,
    required: in_ === 'path',
    type,
    schema,
    parameterSerialization: serialization,
  };
}

function serialize(param: DebugParam, rawValue: string) {
  return serializeOas31Parameters(
    {
      pathParams: param.in === 'path' ? [param] : [],
      queryParams: param.in === 'query' ? [param] : [],
      headerParams: param.in === 'header' ? [param] : [],
      cookieParams: param.in === 'cookie' ? [param] : [],
    },
    { [`${param.in}:${param.name}`]: rawValue },
  );
}

describe('OAS 3.1 parameter logical instances', () => {
  test('converts declared JSON types before schema evaluation', () => {
    const array = parameter(
      'ids',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      {
        type: 'array',
        items: { type: 'integer' },
      },
    );
    const object = parameter(
      'filter',
      'query',
      { kind: 'schema', style: 'deepObject', explode: true, allowReserved: false },
      { type: 'object' },
    );
    const boolean = parameter(
      'active',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      { type: 'boolean' },
    );

    expect(parseOas31ParameterValue(array, '[1,2]')).toEqual({ ok: true, instance: [1, 2] });
    expect(parseOas31ParameterValue(object, '{"role":"admin"}')).toEqual({
      ok: true,
      instance: { role: 'admin' },
    });
    expect(parseOas31ParameterValue(boolean, 'false')).toEqual({ ok: true, instance: false });
  });

  test('supports type arrays and keeps null distinct from the string null', () => {
    const nullable = parameter(
      'limit',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      { type: ['integer', 'null'] },
      'integer',
    );
    const stringOrNull = parameter(
      'label',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      { type: ['string', 'null'] },
      'string',
    );

    expect(parseOas31ParameterValue(nullable, 'null')).toEqual({ ok: true, instance: null });
    expect(parseOas31ParameterValue(nullable, '12')).toEqual({ ok: true, instance: 12 });
    expect(parseOas31ParameterValue(stringOrNull, 'null')).toEqual({ ok: true, instance: null });
    expect(parseOas31ParameterValue(stringOrNull, '"null"')).toEqual({ ok: true, instance: 'null' });
    expect(parseOas31ParameterValue(stringOrNull, 'literal')).toEqual({ ok: true, instance: 'literal' });
  });

  test('uses media type JSON syntax for content parameters and preserves a raw fallback on syntax errors', () => {
    const content = parameter(
      'coordinates',
      'query',
      { kind: 'content', mediaType: 'application/problem+json' },
      { type: 'object' },
      'object',
    );

    const valid = serialize(content, '{"lat":1.2,"long":3.4}');
    expect(valid.instances[0].instance).toEqual({ lat: 1.2, long: 3.4 });
    expect(valid.query).toEqual([
      expect.objectContaining({
        name: 'coordinates',
        value: '{"lat":1.2,"long":3.4}',
        encodedValue: '%7B%22lat%22%3A1.2%2C%22long%22%3A3.4%7D',
      }),
    ]);

    const invalid = serialize(content, '{broken');
    expect(invalid.instances).toEqual([]);
    expect(invalid.diagnostics).toEqual([expect.objectContaining({ key: 'query:coordinates', kind: 'invalid-json' })]);
    expect(invalid.query[0]).toMatchObject({ value: '{broken', encodedValue: '%7Bbroken' });
  });

  test('diagnoses unsafe JSON numbers before parsing can silently rewrite them', () => {
    const integer = parameter(
      'id',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      { type: 'integer', format: 'int64' },
      'integer',
    );
    const object = parameter(
      'filter',
      'query',
      { kind: 'schema', style: 'deepObject', explode: true, allowReserved: false },
      { type: 'object' },
      'object',
    );

    expect(parseOas31ParameterValue(integer, '9007199254740991')).toEqual({
      ok: true,
      instance: 9007199254740991,
    });
    expect(parseOas31ParameterValue(integer, '9007199254740993')).toEqual(
      expect.objectContaining({ ok: false, kind: 'unsafe-number' }),
    );
    expect(parseOas31ParameterValue(integer, '1e309')).toEqual(
      expect.objectContaining({ ok: false, kind: 'unsafe-number' }),
    );
    expect(parseOas31ParameterValue(object, '{"id":9007199254740993}')).toEqual(
      expect.objectContaining({ ok: false, kind: 'unsafe-number' }),
    );

    const fallback = serialize(integer, '9007199254740993');
    expect(fallback.instances).toEqual([]);
    expect(fallback.diagnostics).toEqual([expect.objectContaining({ key: 'query:id', kind: 'unsafe-number' })]);
    expect(fallback.query[0]).toMatchObject({
      value: '9007199254740993',
      encodedValue: '9007199254740993',
    });
  });

  test('uses form-urlencoded encoding only for content-based query parameters', () => {
    const content = parameter('note id', 'query', { kind: 'content', mediaType: 'text/plain' }, { type: 'string' });
    const schema = parameter(
      'note id',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      { type: 'string' },
    );

    expect(serialize(content, 'hello world+~*').query[0]).toMatchObject({
      encodedName: 'note+id',
      encodedValue: 'hello+world%2B%7E*',
    });
    expect(serialize(schema, 'hello world+~*').query[0]).toMatchObject({
      encodedName: 'note%20id',
      encodedValue: 'hello%20world%2B~%2A',
    });
  });

  test('passes boolean schemas through as real document schemas', () => {
    const alwaysInvalid = parameter(
      'value',
      'header',
      { kind: 'schema', style: 'simple', explode: false, allowReserved: false },
      false,
    );
    expect(serialize(alwaysInvalid, 'anything').instances[0].instance).toBe('anything');
  });

  test('constructs logical JSON instances from composition branches and unconstrained boolean schemas', () => {
    const composed = parameter(
      'value',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      {
        oneOf: [{ type: 'array', items: { type: 'integer' } }, { type: 'object' }, { type: 'string' }],
      },
    );
    const unconstrained = parameter(
      'anything',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      true,
    );

    expect(parseOas31ParameterValue(composed, '[1,2]')).toEqual({ ok: true, instance: [1, 2] });
    expect(parseOas31ParameterValue(composed, '{"role":"admin"}')).toEqual({
      ok: true,
      instance: { role: 'admin' },
    });
    expect(parseOas31ParameterValue(composed, 'literal')).toEqual({ ok: true, instance: 'literal' });
    expect(parseOas31ParameterValue(unconstrained, 'null')).toEqual({ ok: true, instance: null });
    expect(parseOas31ParameterValue(unconstrained, '{"enabled":true}')).toEqual({
      ok: true,
      instance: { enabled: true },
    });
  });
});

describe('OAS 3.1 style serialization', () => {
  test('covers simple, label, and matrix path styles', () => {
    const simple = parameter(
      'color',
      'path',
      { kind: 'schema', style: 'simple', explode: true, allowReserved: false },
      { type: 'object' },
      'object',
    );
    const label = parameter(
      'color',
      'path',
      { kind: 'schema', style: 'label', explode: true, allowReserved: false },
      { type: 'array' },
      'array',
    );
    const matrix = parameter(
      'color',
      'path',
      { kind: 'schema', style: 'matrix', explode: true, allowReserved: false },
      { type: 'object' },
      'object',
    );

    expect(serialize(simple, '{"R":100,"G":200}').path.color).toBe('R=100,G=200');
    expect(serialize(label, '["blue","black"]')).toMatchObject({ path: { color: '.blue.black' } });
    expect(serialize(matrix, '{"R":100,"G":200}').path.color).toBe(';R=100;G=200');
    expect(replaceSerializedPathParams('/paint/{color}', { color: '.blue.black' })).toBe('/paint/.blue.black');
    expect(replaceSerializedPathParams('/paint/{+color}', { color: '.blue.black' })).toBe('/paint/{+color}');
  });

  test.each([
    ['matrix', false, ';color=R,100,G,200'],
    ['matrix', true, ';R=100;G=200'],
    ['label', false, '.R,100,G,200'],
    ['label', true, '.R=100.G=200'],
    ['simple', false, 'R,100,G,200'],
    ['simple', true, 'R=100,G=200'],
  ] as const)('matches the OAS style table for path %s with explode=%s', (style, explode, expected) => {
    const value = parameter(
      'color',
      'path',
      { kind: 'schema', style, explode, allowReserved: false },
      { type: 'object' },
      'object',
    );
    expect(serialize(value, '{"R":100,"G":200}').path.color).toBe(expected);
  });

  test('distinguishes empty strings and null instances using the OAS undefined column', () => {
    const matrix = parameter(
      'color',
      'path',
      { kind: 'schema', style: 'matrix', explode: false, allowReserved: false },
      { type: ['string', 'null'] },
      'string',
    );
    const label = { ...matrix, parameterSerialization: { ...matrix.parameterSerialization!, style: 'label' } };
    const simple = { ...matrix, parameterSerialization: { ...matrix.parameterSerialization!, style: 'simple' } };
    const form = parameter(
      'color',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      { type: ['string', 'null'] },
      'string',
    );

    expect(serialize(matrix, '').path.color).toBe(';color=');
    expect(serialize(matrix, 'null').path.color).toBe(';color');
    expect(serialize(label, 'null').path.color).toBe('.');
    expect(serialize(simple, 'null').path.color).toBe('');
    expect(serialize(form, 'null').query).toEqual([
      { name: 'color', value: '', encodedName: 'color', encodedValue: '' },
    ]);
  });

  test.each([
    ['path', 'simple', false, '[]'],
    ['path', 'label', true, '[]'],
    ['path', 'matrix', false, '{}'],
    ['query', 'form', false, '[]'],
    ['query', 'form', true, '{}'],
    ['query', 'spaceDelimited', false, '[]'],
    ['query', 'pipeDelimited', false, '{}'],
    ['query', 'deepObject', true, '{}'],
    ['header', 'simple', false, '[]'],
    ['cookie', 'form', false, '{}'],
    ['cookie', 'form', true, '[]'],
  ] as const)('omits an RFC6570-undefined empty composite for %s %s/%s', (in_, style, explode, raw) => {
    const type = raw === '[]' ? 'array' : 'object';
    const value = parameter('color', in_, { kind: 'schema', style, explode, allowReserved: false }, { type }, type);
    const result = serialize(value, raw);

    expect(result.instances[0]?.instance).toEqual(type === 'array' ? [] : {});
    if (in_ === 'path') expect(result.path.color).toBe('');
    if (in_ === 'query') {
      expect(result.query).toEqual([]);
      expect(result.consumedQueryNames).toContain('color');
    }
    if (in_ === 'header') {
      expect(result.headers).toEqual({});
      expect(result.consumedHeaderNames).toEqual(['color']);
    }
    if (in_ === 'cookie') {
      expect(result.cookies).toEqual([]);
      expect(result.consumedCookieNames).toContain('color');
    }
  });

  test('omits undefined null members while preserving defined empty strings', () => {
    const object = parameter(
      'filter',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      { type: 'object' },
      'object',
    );
    const array = parameter(
      'color',
      'path',
      { kind: 'schema', style: 'label', explode: true, allowReserved: false },
      { type: 'array' },
      'array',
    );

    expect(serialize(object, '{"missing":null,"empty":"","active":true}').query).toEqual([
      { name: 'empty', value: '', encodedName: 'empty', encodedValue: '' },
      { name: 'active', value: 'true', encodedName: 'active', encodedValue: 'true' },
    ]);
    expect(serialize(array, '[null,"",null,"blue"]').path.color).toBe('..blue');
  });

  test('serializes query form arrays and objects with both explode values', () => {
    const arrayExploded = parameter(
      'color',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      { type: 'array' },
      'array',
    );
    const objectCompact = parameter(
      'color',
      'query',
      { kind: 'schema', style: 'form', explode: false, allowReserved: false },
      { type: 'object' },
      'object',
    );

    expect(serialize(arrayExploded, '["blue","black"]')).toMatchObject({
      query: [
        { name: 'color', value: 'blue', encodedName: 'color', encodedValue: 'blue' },
        { name: 'color', value: 'black', encodedName: 'color', encodedValue: 'black' },
      ],
    });
    expect(serialize(objectCompact, '{"R":100,"G":200}').query[0]).toMatchObject({
      value: 'R,100,G,200',
      encodedValue: 'R,100,G,200',
    });
  });

  test('serializes spaceDelimited, pipeDelimited, and scalar deepObject properties', () => {
    const spaces = parameter(
      'color',
      'query',
      { kind: 'schema', style: 'spaceDelimited', explode: false, allowReserved: false },
      { type: 'array' },
      'array',
    );
    const pipes = parameter(
      'color',
      'query',
      { kind: 'schema', style: 'pipeDelimited', explode: false, allowReserved: false },
      { type: 'object' },
      'object',
    );
    const deep = parameter(
      'color',
      'query',
      { kind: 'schema', style: 'deepObject', explode: true, allowReserved: false },
      { type: 'object' },
      'object',
    );

    expect(serialize(spaces, '["blue","black"]')).toMatchObject({
      query: [expect.objectContaining({ value: 'blue black', encodedValue: 'blue%20black' })],
    });
    expect(serialize(pipes, '{"R":100,"G":200}')).toMatchObject({
      query: [expect.objectContaining({ value: 'R|100|G|200', encodedValue: 'R%7C100%7CG%7C200' })],
    });
    expect(serialize(deep, '{"R":100,"G":200}').query).toEqual([
      { name: 'color[R]', value: '100', encodedName: 'color%5BR%5D', encodedValue: '100' },
      { name: 'color[G]', value: '200', encodedName: 'color%5BG%5D', encodedValue: '200' },
    ]);
  });

  test.each([
    ['form', false, '{"R":100,"G":200}', 'color=R,100,G,200'],
    ['form', true, '{"R":100,"G":200}', 'R=100&G=200'],
    ['spaceDelimited', false, '["blue","black"]', 'color=blue%20black'],
    ['pipeDelimited', false, '{"R":100,"G":200}', 'color=R%7C100%7CG%7C200'],
    ['deepObject', true, '{"R":100,"G":200}', 'color%5BR%5D=100&color%5BG%5D=200'],
  ] as const)('matches the OAS style table for query %s with explode=%s', (style, explode, raw, expected) => {
    const schema = raw.startsWith('[') ? { type: 'array' } : { type: 'object' };
    const value = parameter(
      'color',
      'query',
      { kind: 'schema', style, explode, allowReserved: false },
      schema,
      schema.type,
    );
    const query = serialize(value, raw)
      .query.map((pair) => `${pair.encodedName}=${pair.encodedValue}`)
      .join('&');
    expect(query).toBe(expected);
  });

  test('encodes Unicode and delimiters while allowReserved preserves only safe query reserved characters', () => {
    expect(encodeParameterComponent("你好 !'()*")).toBe('%E4%BD%A0%E5%A5%BD%20%21%27%28%29%2A');
    expect(encodeReservedQueryValue('a/b?c&d+e#f%2F%zz')).toBe('a/b?c%26d%2Be%23f%2F%25zz');

    const reserved = parameter(
      '公式 ❤️',
      'query',
      { kind: 'schema', style: 'form', explode: true, allowReserved: true },
      { type: 'string' },
    );
    expect(serialize(reserved, 'a/b?c&d+e#f%2F').query[0]).toMatchObject({
      encodedName: '%E5%85%AC%E5%BC%8F%20%E2%9D%A4%EF%B8%8F',
      encodedValue: 'a/b?c%26d%2Be%23f%2F',
    });
  });

  test('serializes simple headers and form cookies without creating a second request representation', () => {
    const header = parameter(
      'X-Color',
      'header',
      { kind: 'schema', style: 'simple', explode: true, allowReserved: false },
      { type: 'object' },
      'object',
    );
    const cookie = parameter(
      'color',
      'cookie',
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      { type: 'array' },
      'array',
    );

    expect(serialize(header, '{"R":100,"G":200}').headers).toEqual({ 'X-Color': 'R=100,G=200' });
    expect(serialize(cookie, '["blue","black"]').cookies).toEqual([
      { name: 'color', value: 'blue' },
      { name: 'color', value: 'black' },
    ]);
  });

  test.each([
    [{ type: 'string' }, 'W/"etag-v1%2F"', false, 'W/"etag-v1%2F"'],
    [{ type: 'string' }, 'one\ttwo words', false, 'one\ttwo words'],
    [{ type: 'array', items: { type: 'string' } }, '["\\"one\\"","W/\\"two\\""]', false, '"one",W/"two"'],
    [
      { type: 'object' },
      '{"etag":"\\"one\\"","uri":"https://example.test/a"}',
      false,
      'etag,"one",uri,https://example.test/a',
    ],
    [
      { type: 'object' },
      '{"etag":"\\"one\\"","uri":"https://example.test/a"}',
      true,
      'etag="one",uri=https://example.test/a',
    ],
  ] as const)(
    'preserves legal simple header data for %j input %s with explode=%s',
    (schema, raw, explode, expected) => {
      const header = parameter(
        'X-Value',
        'header',
        { kind: 'schema', style: 'simple', explode, allowReserved: false },
        schema,
      );
      expect(serialize(header, raw).headers).toEqual({ 'X-Value': expected });
    },
  );

  test.each(['\r', '\n', '\u0000', '\u001f', '\u007f'])(
    'rejects header controls before they can be disguised by URI encoding (%j)',
    (control) => {
      const header = parameter(
        'X-Value',
        'header',
        { kind: 'schema', style: 'simple', explode: true, allowReserved: false },
        { type: 'string' },
      );
      const object = { ...header, type: 'object', schema: { type: 'object' } };
      expect(() => serialize(header, `before${control}after`)).toThrow('forbidden control character');
      expect(() => serialize(object, JSON.stringify({ [`key${control}`]: 'value' }))).toThrow(
        'forbidden control character',
      );
    },
  );

  test.each([
    ['header', 'simple', false, [{ name: 'color', value: 'R,100,G,200' }]],
    ['header', 'simple', true, [{ name: 'color', value: 'R=100,G=200' }]],
    ['cookie', 'form', false, [{ name: 'color', value: 'R,100,G,200' }]],
    [
      'cookie',
      'form',
      true,
      [
        { name: 'R', value: '100' },
        { name: 'G', value: '200' },
      ],
    ],
  ] as const)('matches the OAS style table for %s %s with explode=%s', (in_, style, explode, expected) => {
    const value = parameter(
      'color',
      in_,
      { kind: 'schema', style, explode, allowReserved: false },
      { type: 'object' },
      'object',
    );
    const result = serialize(value, '{"R":100,"G":200}');
    const actual =
      in_ === 'header'
        ? [{ name: 'color', value: result.headers.color }]
        : result.cookies.map((pair) => ({ name: pair.name, value: pair.value }));
    expect(actual).toEqual(expected);
  });

  test('rejects undefined nested deepObject values', () => {
    const deep = parameter(
      'filter',
      'query',
      { kind: 'schema', style: 'deepObject', explode: true, allowReserved: false },
      { type: 'object' },
      'object',
    );
    expect(() => serialize(deep, '{"nested":{"role":"admin"}}')).toThrow(
      'Nested array or object parameter values do not have a defined OAS serialization',
    );
  });
});
