import { buildOperationDebugModel } from '../../debug/operationDebugModel';
import { buildRequest, buildCurl, authToHeaders, validateRequired } from '../../debug/requestBuilder';
import { assertOas32BrowserRequest, Oas32ParameterRequestError } from '../../debug/oas32ParameterRequest';
import { serializeOas32Parameter, serializeOas32Parameters } from '../../debug/oas32ParameterSerialization';
import type { Oas32ParameterInput } from '../../debug/oas32ParameterTypes';
import { collectOas32DocumentDiagnostics } from '../../openapi32';
import type { DebugFormValues, ParameterInstance } from '../../debug/types';

const form = (): DebugFormValues => ({ pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} });
const model = (parameters: Record<string, unknown>[], path = '/items') => {
  const doc = {
    openapi: '3.2.0',
    info: { title: 'Normative serialization fixtures', version: '1' },
    paths: { [path]: { get: { parameters, responses: { '200': { description: 'Synthetic' } } } } },
  };
  expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
  return buildOperationDebugModel({ doc, path, method: 'GET' });
};
const whole = (mediaType: string, schema: unknown = { type: 'string' }, mediaFields: Record<string, unknown> = {}) =>
  model([{ name: 'whole', in: 'querystring', required: true, content: { [mediaType]: { schema, ...mediaFields } } }]);
const one = (raw: Record<string, unknown>, input: Oas32ParameterInput) => {
  const m = model([raw], raw.in === 'path' ? `/items/{${String(raw.name)}}` : '/items');
  return serializeOas32Parameter(m.oas32Parameters!.parameters[0], input);
};
const request = (
  m: ReturnType<typeof model>,
  inputs: Readonly<Record<string, Oas32ParameterInput>>,
  extra: Partial<Parameters<typeof buildRequest>[0]> = {},
) =>
  buildRequest({
    baseUrl: 'https://example.test',
    path: '/items',
    method: 'GET',
    debugModel: m,
    formValues: { ...form(), oas32ParameterInputs: inputs },
    ...extra,
  });

describe('OAS 3.2 whole query representations', () => {
  test('separates JSON data, media text and parameter text without double encoding', () => {
    const m = whole('application/json', { type: 'object' });
    const media = '{ "x": "%2F+", "y": [1,2] }';
    const encoded = encodeURIComponent(media);
    const raw = request(m, { 'querystring:whole': { kind: 'parameter', text: encoded } });
    const fromMedia = request(m, { 'querystring:whole': { kind: 'media', text: media } });
    const data = request(m, { 'querystring:whole': { kind: 'data', value: { x: '%2F+', y: [1, 2] } } });
    expect(raw.url).toBe(`https://example.test/items?${encoded}`);
    expect(fromMedia.url).toBe(raw.url);
    expect(data.url).toBe(`https://example.test/items?${encodeURIComponent('{"x":"%2F+","y":[1,2]}')}`);
    expect(fromMedia.oas32ParameterPlan!.results[0]).toMatchObject({
      mediaText: media,
      parameterText: encoded,
      decodedData: { x: '%2F+', y: [1, 2] },
    });
    expect(raw.query).toEqual({});
    expect(buildCurl(raw)).toContain(raw.url);
  });

  test('empty text is present and differs from absent', () => {
    const m = whole('text/plain');
    const empty = request(m, { 'querystring:whole': { kind: 'media', text: '' } });
    const absent = request(m, {});
    expect(empty.url).toBe('https://example.test/items?');
    expect(empty.parameterPresence).toEqual({ 'querystring:whole': true });
    expect(absent.url).toBe('https://example.test/items');
    expect(
      validateRequired(m, { ...form(), oas32ParameterInputs: { 'querystring:whole': { kind: 'data', value: '' } } }),
    ).toEqual([]);
    expect(validateRequired(m, form())).toMatchObject([{ in: 'querystring', key: 'querystring:whole' }]);
  });

  test.each(['parameter', 'media'] as const)(
    'keeps form %%, plus, repeats, empty pairs and order at %s layer',
    (kind) => {
      const text = 'x=1&x=2&&empty=&bare&plus=%2B+%20&esc=%2526';
      const result = request(whole('application/x-www-form-urlencoded', { type: 'object' }), {
        'querystring:whole': { kind, text },
      });
      expect(result.url).toBe(`https://example.test/items?${text}`);
      expect(result.oas32ParameterPlan!.wholeQuery!.component).toBe(text);
      expect(result.oas32ParameterPlan!.results[0].serialization).toBe('unavailable');
    },
  );

  test('encodes and decodes known form properties and repeated arrays without flattening payload objects', () => {
    const m = whole('application/x-www-form-urlencoded', {
      type: 'object',
      properties: { tag: { type: 'array', items: { type: 'string' } }, json: { type: 'object' } },
    });
    const value = { tag: ['%2F', '+ space'], json: { $ref: '#opaque', $id: 'payload' } };
    const built = request(m, { 'querystring:whole': { kind: 'data', value } });
    expect(built.oas32ParameterPlan!.wholeQuery!.component).toBe(
      'tag=%252F&tag=%2B+space&json=%7B%22%24ref%22%3A%22%23opaque%22%2C%22%24id%22%3A%22payload%22%7D',
    );
    const decoded = request(m, {
      'querystring:whole': { kind: 'parameter', text: built.oas32ParameterPlan!.wholeQuery!.component! },
    });
    expect(decoded.oas32ParameterPlan!.results[0].decodedData).toEqual(value);
  });

  test('uses explicit form Encoding style over contentType and ignores unused Encoding keys', () => {
    const m = whole(
      'application/x-www-form-urlencoded',
      { type: 'object', properties: { values: { type: 'object', properties: { n: { type: 'integer' } } } } },
      {
        encoding: {
          values: { style: 'deepObject', explode: false, contentType: 'application/json' },
          ignored: { contentType: 'text/plain' },
        },
      },
    );
    const built = request(m, { 'querystring:whole': { kind: 'data', value: { values: { n: 2 } } } });
    expect(built.url).toBe('https://example.test/items?values%5Bn%5D=2');
  });

  test.each(['application', 'global', 'custom', 'auth'] as const)(
    'blocks %s query injection and preserves its source',
    (source) => {
      const m = whole('application/json', { type: 'object' });
      const values = { ...form(), oas32ParameterInputs: { 'querystring:whole': { kind: 'data' as const, value: {} } } };
      const sourceOptions =
        source === 'application'
          ? { applicationParams: { headers: {}, queries: { tenant: '' } } }
          : source === 'global'
            ? { globalParams: { headers: {}, queries: { tenant: 'x' } } }
            : source === 'custom'
              ? { formValues: { ...values, queryParams: { tenant: '' } } }
              : {
                  auth: {
                    bySecurityKey: {
                      tenant: { type: 'apiKey' as const, in: 'query' as const, name: 'tenant', value: 'x' },
                    },
                  },
                };
      try {
        request(m, values.oas32ParameterInputs, sourceOptions);
        throw new Error('Expected conflict');
      } catch (error) {
        expect(error).toBeInstanceOf(Oas32ParameterRequestError);
        expect((error as Oas32ParameterRequestError).diagnostics).toContainEqual(
          expect.objectContaining({
            phase: 'input',
            code: 'QUERYSTRING_SOURCE_CONFLICT',
            source,
            name: 'tenant',
            blocks: 'all',
          }),
        );
      }
    },
  );

  test('does not inject an auth query from an unselected scheme', () => {
    const built = request(
      whole('text/plain'),
      { 'querystring:whole': { kind: 'data', value: 'hello' } },
      {
        auth: { bySecurityKey: { key: { type: 'apiKey', in: 'query', name: 'key', value: 'synthetic' } } },
        securityKeys: [],
      },
    );
    expect(built.url).toBe('https://example.test/items?hello');
  });

  test.each(['?x=1', '&x=1', 'x=#fragment', 'x=%zz', 'x=%FF', 'x=one two', 'x=1\r\nY: 2', 'x=[1]'])(
    'blocks unsafe author parameter text %s',
    (text) => {
      expect(() =>
        request(whole('application/x-www-form-urlencoded'), { 'querystring:whole': { kind: 'parameter', text } }),
      ).toThrow();
    },
  );

  test('keeps unknown-media text inspectable without claiming data or Schema validity', () => {
    const built = request(whole('application/vnd.synthetic'), {
      'querystring:whole': { kind: 'parameter', text: 'a=1&a=2' },
    });
    expect(built.oas32ParameterPlan!.results[0]).toMatchObject({
      serialization: 'unavailable',
      dataStatus: 'unavailable',
      parameterText: 'a=1&a=2',
    });
    expect(() =>
      request(whole('application/vnd.synthetic'), { 'querystring:whole': { kind: 'data', value: {} } }),
    ).toThrow();
  });

  test('retains G metadata and separates authored data, decoded data and mismatched pairing', () => {
    const parameter = whole('application/json', false).oas32Parameters!.parameters[0];
    const session = Object.freeze({ generation: 7 });
    const provenance = {
      id: 'author-id',
      layer: 'parameter' as const,
      sourceLocation: parameter.location,
      schemaLocation: parameter.schemaLocation,
      generation: 7,
      session,
    };
    const input = { kind: 'parameter' as const, text: '%7B%22n%22%3A2%7D', data: { n: 1 }, provenance };
    const result = serializeOas32Parameter(parameter, input);
    expect(result.input).toEqual(input);
    expect(result.input.provenance!.session).toBe(session);
    expect(result).toMatchObject({ data: { n: 1 }, decodedData: { n: 2 }, pairing: 'invalid', serialization: 'valid' });
    expect(result.parameter.schema).toBe(false);
    expect(result).not.toHaveProperty('schemaValid');
  });

  test('the built logical snapshot does not change when an editor object is mutated', () => {
    const value = { n: 1 };
    const input = { kind: 'data' as const, value };
    const built = request(whole('application/json', { type: 'object' }), { 'querystring:whole': input });
    value.n = 2;
    expect(built.oas32ParameterPlan!.results[0].data).toEqual({ n: 1 });
    expect(built.url).toContain('%7B%22n%22%3A1%7D');
  });

  test('unsafe JSON numbers remain unavailable and malformed JSON is invalid', () => {
    const parameter = whole('application/json', true).oas32Parameters!.parameters[0];
    const unsafe = serializeOas32Parameter(parameter, { kind: 'media', text: '9007199254740993' });
    expect(unsafe).toMatchObject({ dataStatus: 'unavailable', serialization: 'unavailable' });
    expect(unsafe).not.toHaveProperty('decodedData');
    expect(serializeOas32Parameter(parameter, { kind: 'media', text: '' })).toMatchObject({ serialization: 'invalid' });
  });
});

describe('OAS 3.2 schema styles and wire decoding', () => {
  test.each([undefined, false, true])('deepObject ignores explode=%s', (explode) => {
    const result = one(
      {
        name: 'filter',
        in: 'query',
        style: 'deepObject',
        ...(explode === undefined ? {} : { explode }),
        schema: { type: 'object', properties: { n: { type: 'integer' } } },
      },
      { kind: 'data', value: { n: 2 } },
    );
    expect(result).toMatchObject({ parameterText: 'filter%5Bn%5D=2', serialization: 'valid' });
  });

  test('nested deepObject values are unavailable instead of inventing bracket conventions', () => {
    const result = one(
      { name: 'filter', in: 'query', style: 'deepObject', schema: { type: 'object' } },
      { kind: 'data', value: { nested: { n: 1 } } },
    );
    expect(result.serialization).toBe('unavailable');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ blocks: 'all' }));
  });

  test.each(['simple', 'label', 'matrix'])('path %s preserves reserved triples but escapes / ? #', (style) => {
    const result = one(
      { name: 'p', in: 'path', required: true, style, allowReserved: true, schema: { type: 'string' } },
      { kind: 'data', value: ':@%2f/?#[]' },
    );
    expect(result.parameterText).toBe(
      `${style === 'label' ? '.' : style === 'matrix' ? ';p=' : ''}:@%2f%2F%3F%23%5B%5D`,
    );
  });

  test('path text cannot add separators and an already encoded percent sign stays encoded', () => {
    const raw = { name: 'p', in: 'path', required: true, schema: { type: 'string' } };
    expect(one(raw, { kind: 'parameter', text: '%252F' }).decodedData).toBe('%2F');
    expect(one(raw, { kind: 'parameter', text: 'a/b' }).serialization).toBe('invalid');
  });

  test('a serialized author parameter cannot silently rename a declared primitive parameter', () => {
    expect(
      one({ name: 'right', in: 'query', schema: { type: 'string' } }, { kind: 'parameter', text: 'wrong=1' })
        .serialization,
    ).toBe('invalid');
    expect(
      one(
        { name: 'right', in: 'cookie', style: 'cookie', schema: { type: 'string' } },
        { kind: 'parameter', text: 'wrong=1' },
      ).serialization,
    ).toBe('invalid');
  });

  test('ordinary query priority remains interface over global/auth/application', () => {
    const built = request(
      model([{ name: 'q', in: 'query', schema: { type: 'string' } }]),
      { 'query:q': { kind: 'data', value: 'interface' } },
      {
        globalParams: { headers: {}, queries: { q: 'global', other: 'remain' } },
        applicationParams: { headers: {}, queries: { q: 'app' } },
      },
    );
    expect(built.url).toBe('https://example.test/items?other=remain&q=interface');
    expect(built.query).toEqual({ other: 'remain', q: 'interface' });
    expect(built.sourceMap!.query.q).toBe('interface');
  });

  test('wire nullable strings have no editor quote escape hatch', () => {
    const raw = { name: 'q', in: 'query', schema: { type: ['string', 'null'] } };
    expect(one(raw, { kind: 'parameter', text: 'q=%221%22' }).decodedData).toBe('"1"');
    expect(one(raw, { kind: 'parameter', text: 'q=' }).serialization).toBe('unavailable');
  });

  test('ambiguous type unions and reserved input triples are not declared uniquely decoded', () => {
    expect(
      one(
        { name: 'q', in: 'query', schema: { type: ['string', 'array'], items: { type: 'string' } } },
        { kind: 'parameter', text: 'q=a,b' },
      ).serialization,
    ).toBe('unavailable');
    expect(
      one(
        { name: 'q', in: 'query', allowReserved: true, schema: { type: 'string' } },
        { kind: 'parameter', text: 'q=%2F' },
      ).serialization,
    ).toBe('unavailable');
  });

  test.each(['parameter', 'data'] as const)(
    'Header %s preserves quotes, percent signs, plus and punctuation',
    (kind) => {
      const raw = { name: 'X-Value', in: 'header', allowReserved: true, schema: { type: 'string' } };
      const text = 'W/"x%2F+y"';
      const result = one(raw, kind === 'parameter' ? { kind, text } : { kind, value: text });
      expect(result.parameterText).toBe(text);
      if (kind === 'parameter') expect(result.decodedData).toBe(text);
    },
  );

  test('case-sensitive Header declarations still diagnose HTTP field collision', () => {
    const m = model([
      { name: 'X-Id', in: 'header', schema: { type: 'string' } },
      { name: 'x-id', in: 'header', schema: { type: 'string' } },
    ]);
    expect(m.oas32Parameters!.parameters).toHaveLength(2);
    expect(() =>
      request(m, { 'header:X-Id': { kind: 'data', value: 'a' }, 'header:x-id': { kind: 'data', value: 'b' } }),
    ).toThrow(/case-insensitive/);
  });

  test('Header injection blocks construction; Fetch restrictions block dispatch independently', () => {
    const m = model([{ name: 'X-Id', in: 'header', schema: { type: 'string' } }]);
    expect(() => request(m, { 'header:X-Id': { kind: 'data', value: 'a\r\nInjected: yes' } })).toThrow();
    const host = request(model([{ name: 'Host', in: 'header', schema: { type: 'string' } }]), {
      'header:Host': { kind: 'data', value: 'different.test' },
    });
    expect(buildCurl(host)).toContain('Host: different.test');
    expect(() => assertOas32BrowserRequest(host)).toThrow(/Host/);
    expect(() => request(model([]), {}, { method: 'GET\r\nInjected: yes' })).toThrow(/HTTP method/);
  });

  test('empty Header survives both final request and cURL', () => {
    const built = request(model([{ name: 'X-Empty', in: 'header', schema: { type: 'string' } }]), {
      'header:X-Empty': { kind: 'data', value: '' },
    });
    expect(built.headers['X-Empty']).toBe('');
    expect(buildCurl(built)).toContain("'X-Empty;'");
    expect(buildCurl(built)).toContain('--globoff');
    expect(buildCurl(built)).toContain('--path-as-is');
  });

  test.each(['__proto__', 'constructor', 'toString'])(
    'special name %s is an own property in parameters and auth sources',
    (name) => {
      const m = model([
        { name, in: 'query', schema: { type: 'string' } },
        { name, in: 'header', schema: { type: 'string' } },
      ]);
      const built = request(m, {
        [`query:${name}`]: { kind: 'data', value: 'first' },
        [`header:${name}`]: { kind: 'data', value: 'second' },
      });
      expect(Object.prototype.hasOwnProperty.call(built.query, name)).toBe(true);
      expect(built.query[name]).toBe('first');
      expect(built.headers[name]).toBe('second');
      const auth = {
        bySecurityKey: { key: { type: 'apiKey' as const, in: 'query' as const, name, value: 'synthetic' } },
      };
      expect(Object.prototype.hasOwnProperty.call(authToHeaders(auth).queries, name)).toBe(true);
      const authRequest = request(model([]), {}, { auth });
      expect(authRequest.url).toBe(`https://example.test/items?${name}=synthetic`);
      expect(authRequest.sourceMap!.query[name]).toBe('auth');
      expect(() => request(whole('text/plain'), {}, { auth })).toThrow(/auth query/);
    },
  );
});

describe('OAS 3.2 Cookie text, pairing and browser boundary', () => {
  test('cookie style preserves duplicate names, case and author escapes', () => {
    const m = model([
      { name: 'sid', in: 'cookie', style: 'cookie', schema: { type: 'array', items: { type: 'string' } } },
      { name: 'SID', in: 'cookie', style: 'cookie', schema: { type: 'string' } },
    ]);
    const built = request(m, {
      'cookie:sid': { kind: 'data', value: ['a%2F', 'b+'] },
      'cookie:SID': { kind: 'data', value: 'C' },
    });
    expect(built.headers.Cookie).toBe('sid=a%2F; sid=b+; SID=C');
    expect(built.oas32ParameterPlan!.cookies.map((pair) => [pair.name, pair.value])).toEqual([
      ['sid', 'a%2F'],
      ['sid', 'b+'],
      ['SID', 'C'],
    ]);
    expect(() => assertOas32BrowserRequest(built)).toThrow();
    expect(buildCurl(built)).toContain('Cookie: sid=a%2F; sid=b+; SID=C');
  });

  test('cookie raw decoding never performs URI percent decoding', () => {
    const result = one(
      { name: 'sid', in: 'cookie', style: 'cookie', schema: { type: 'array', items: { type: 'string' } } },
      { kind: 'parameter', text: 'sid=a%2F; sid=b+' },
    );
    expect(result.decodedData).toEqual(['a%2F', 'b+']);
  });

  test.each(['a; admin=true', 'a,b', 'a b'])('Cookie data %s needs author escaping before expansion', (value) => {
    const m = model([{ name: 'sid', in: 'cookie', style: 'cookie', schema: { type: 'string' } }]);
    expect(() => request(m, { 'cookie:sid': { kind: 'data', value } })).toThrow(/author escaping/);
  });

  test('empty author query/Cookie text has no pair while empty values retain their names', () => {
    const cookie = { name: 'sid', in: 'cookie', style: 'cookie', required: true, schema: { type: 'string' } };
    expect(one(cookie, { kind: 'parameter', text: '' }).present).toBe(false);
    expect(one(cookie, { kind: 'parameter', text: 'sid=' }).present).toBe(true);
    expect(one({ name: 'q', in: 'query', schema: { type: 'string' } }, { kind: 'parameter', text: '' }).present).toBe(
      false,
    );
  });

  test.each([
    ['form', true, 'sid=a&sid=b'],
    ['form', false, 'sid=a,b'],
    ['cookie', false, 'sid=a,b'],
  ] as const)(
    'keeps the legal %s/explode=%s style preview %s with transport diagnostics',
    (style, explode, expected) => {
      const m = model([
        { name: 'sid', in: 'cookie', style, explode, schema: { type: 'array', items: { type: 'string' } } },
      ]);
      expect(m.oas32Parameters!.diagnostics).toEqual([]);
      const built = request(m, { 'cookie:sid': { kind: 'data', value: ['a', 'b'] } });
      expect(built.headers.Cookie).toBe(expected);
      expect(built.oas32ParameterPlan!.diagnostics).toContainEqual(
        expect.objectContaining({ phase: 'transport', blocks: 'browser' }),
      );
    },
  );

  test('cookie form default remains form and cookie style default explode is true', () => {
    const m = model([
      { name: 'default', in: 'cookie', schema: { type: 'string' } },
      { name: 'new', in: 'cookie', style: 'cookie', schema: { type: 'string' } },
    ]);
    expect(m.oas32Parameters!.parameters.map((parameter) => parameter.serialization)).toEqual([
      { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      { kind: 'schema', style: 'cookie', explode: true, allowReserved: false },
    ]);
  });

  test('unknown browser-session Cookie presence never fabricates a local value', () => {
    const m = model([
      { name: 'sid', in: 'cookie', required: true, style: 'cookie', schema: { type: 'string', const: 'secret' } },
    ]);
    const inputs = { 'cookie:sid': { kind: 'browser-session' as const } };
    const plan = serializeOas32Parameters(m.oas32Parameters!, inputs);
    expect(plan.presence['cookie:sid']).toBe('unknown');
    expect(plan.results[0]).toMatchObject({ dataStatus: 'unavailable', serialization: 'unavailable' });
    expect(plan.results[0]).not.toHaveProperty('data');
    expect(validateRequired(m, { ...form(), oas32ParameterInputs: inputs })).toEqual([]);
    expect(request(m, inputs).headers).not.toHaveProperty('Cookie');
  });

  test.each([null, false, 0, ''] as ParameterInstance[])('keeps own logical value %s', (value) => {
    const result = one({ name: 'sid', in: 'cookie', style: 'cookie', schema: true }, { kind: 'data', value });
    expect(result.data).toBe(value);
    expect(result.present).toBe(true);
  });
});
