import { buildMediaTypeExampleValue } from '../debug/mediaTypeExample';
import { exampleParameterInput, interpretExampleObject, serializeExampleData } from '../debug/exampleRepresentation';
import { serializeOas31Parameters } from '../debug/parameterSerialization';
import { buildCurl, buildRequest, validateRequired } from '../debug/requestBuilder';
import type { BodyContent, DebugFormValues, DebugParam, OperationDebugModel } from '../debug/types';

describe('OAS 3.2 Example Object values', () => {
  const context = { doc: { openapi: '3.2.0', info: { title: 'Example fixture', version: '1' }, paths: {} } };

  test('preserves an authored serialized JSON representation rather than replacing it with a candidate', () => {
    const text = '{ "answer": 0 }\n';
    expect(
      buildMediaTypeExampleValue(
        { examples: { authored: { dataValue: { answer: 0 }, serializedValue: text } } },
        undefined,
        context,
        { mediaType: 'application/json' },
      ),
    ).toBe(text);
  });

  test.each([null, false, 0, ''])('retains field presence for dataValue %p', (value) => {
    expect(
      buildMediaTypeExampleValue({ examples: { authored: { dataValue: value } } }, undefined, context, {
        mediaType: 'application/json',
      }),
    ).toBe(JSON.stringify(value));
  });
});

const json = {
  layer: 'media' as const,
  mediaType: 'application/json',
  documentBaseUri: 'https://contract.example/author/api.json',
};
const queryParam = (schema: DebugParam['schema'] = { type: 'string' }): DebugParam => ({
  name: 'q',
  in: 'query',
  required: false,
  type: 'string',
  schema,
  parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
});

describe('representation, decoding and pairing remain independent', () => {
  test.each(Array.from({ length: 16 }, (_, mask) => [mask]))(
    'checks all field combinations by presence (%i)',
    (mask) => {
      const fields = ['dataValue', 'serializedValue', 'externalValue', 'value'];
      const values = [1, '1', './one.json', 1];
      const source = Object.fromEntries(fields.flatMap((field, i) => (mask & (1 << i) ? [[field, values[i]]] : [])));
      const result = interpretExampleObject(source, json);
      const valid = [0, 1, 2, 3, 4, 5, 8].includes(mask);
      expect(result.diagnostics.some((item) => item.code === 'EXAMPLE_FIELDS_CONFLICT')).toBe(!valid);
      for (let i = 0; i < fields.length; i++)
        expect(result.fields[fields[i] as keyof typeof result.fields]).toBe(Boolean(mask & (1 << i)));
      if (!valid) expect(result.text).toBeUndefined();
    },
  );
  test('metadata-only is not empty data and external-only is never body content', () => {
    const metadata = interpretExampleObject({ summary: 'About this example' }, json);
    expect(metadata).toMatchObject({ serialization: 'absent', pairing: 'absent', diagnostics: [] });
    expect(metadata).not.toHaveProperty('data');
    const external = interpretExampleObject({ externalValue: '../files/payload.bin' }, json);
    expect(external.external?.resolvedUri).toBe('https://contract.example/files/payload.bin');
    expect(external.text).toBeUndefined();
    expect(external).not.toHaveProperty('data');
    expect(external.serialization).toBe('unavailable');
  });
  test('opaque payload keys, object order and author whitespace are retained', () => {
    const data = { $ref: 'https://never.example/fetch', $id: 'opaque', answer: 0 };
    const text = '{"answer":0, "$id":"opaque", "$ref":"https://never.example/fetch"}\n';
    const result = interpretExampleObject({ dataValue: data, serializedValue: text }, json);
    expect(result).toMatchObject({ data, text, serialized: text, pairing: 'valid', serialization: 'valid' });
    expect(data.$id).toBe('opaque');
  });
  test('JSON string data is different from serialized object text', () => {
    expect(interpretExampleObject({ dataValue: '{"n":1}' }, json).text).toBe('"{\\"n\\":1}"');
    expect(interpretExampleObject({ serializedValue: '{"n":1}' }, json).data).toEqual({ n: 1 });
    expect(interpretExampleObject({ dataValue: { n: 0 }, serializedValue: '{"n":1}' }, json)).toMatchObject({
      data: { n: 0 },
      pairing: 'invalid',
      serialization: 'valid',
    });
    expect(interpretExampleObject({ serializedValue: '' }, json)).toMatchObject({ serialization: 'invalid' });
    expect(interpretExampleObject({ serializedValue: '' }, { layer: 'media', mediaType: 'text/plain' })).toMatchObject({
      data: '',
      text: '',
      serialization: 'valid',
    });
  });
  test('unknown media cannot claim decoding or synthesize JSON bodies', () => {
    expect(
      interpretExampleObject({ dataValue: { n: 1 } }, { layer: 'media', mediaType: 'application/xml' }).text,
    ).toBeUndefined();
    expect(
      interpretExampleObject({ serializedValue: '<n>1</n>' }, { layer: 'media', mediaType: 'application/xml' }),
    ).toMatchObject({ text: '<n>1</n>', serialization: 'unavailable' });
    expect(
      interpretExampleObject({ dataValue: 'AA==', externalValue: './image' }, { ...json, mediaType: 'image/png' }),
    ).toMatchObject({ data: 'AA==', serialization: 'unavailable', pairing: 'unavailable' });
  });
  test.each(['9007199254740993', '1e400', '{"nested":[9007199254740993]}'])(
    'keeps unsafe numeric JSON text without claiming data validation: %s',
    (text) => {
      const result = interpretExampleObject({ serializedValue: text }, json);
      expect(result).toMatchObject({ text, serialization: 'unavailable' });
      expect(result).not.toHaveProperty('data');
      expect(result).not.toHaveProperty('decodedData');
      expect(result.diagnostics.map((item) => item.code)).toContain('UNSAFE_EXAMPLE_NUMBER');
      expect(result.diagnostics.map((item) => item.code)).not.toContain('INVALID_JSON_SERIALIZATION');
    },
  );
  test('metadata permits a Schema default but an explicit external author never becomes a default body', () => {
    const context = { doc: { openapi: '3.2.0' } };
    const schema = { type: 'integer', default: 7 };
    expect(
      buildMediaTypeExampleValue({ examples: { note: { summary: 'Only metadata' } } }, schema, context, {
        mediaType: 'application/json',
      }),
    ).toBe('7');
    expect(
      buildMediaTypeExampleValue({ examples: { remote: { externalValue: './body' } } }, schema, context, {
        mediaType: 'application/json',
      }),
    ).toBeUndefined();
    expect(buildMediaTypeExampleValue(undefined, schema, context, { mediaType: 'application/xml' })).toBeUndefined();
  });
  test('retains legacy non-JSON strings without inventing parsed logical data', () => {
    const result = interpretExampleObject({ value: 'a=1&a=2' }, { layer: 'media', mediaType: 'application/x-custom' });
    expect(result).toMatchObject({ text: 'a=1&a=2', legacyValue: 'a=1&a=2', serialization: 'unavailable' });
    expect(result).not.toHaveProperty('data');
  });
  test.each(['3.0.4', '3.1.1'])('does not enable 3.2 fields in %s', (version) => {
    expect(
      buildMediaTypeExampleValue(
        { examples: { e: { dataValue: 5 } } },
        undefined,
        { doc: { openapi: version } },
        { mediaType: 'application/json' },
      ),
    ).toBeUndefined();
    expect(
      buildMediaTypeExampleValue(
        { examples: { e: { value: 0 } } },
        undefined,
        { doc: { openapi: version } },
        { mediaType: 'application/json' },
      ),
    ).toBe('0');
  });
});

describe('layer-aware text on the actual request builder', () => {
  test('request instances describe the serialized wire independently of mismatching author data', () => {
    const context = { layer: 'parameter' as const, parameter: queryParam({ type: 'integer' }) };
    const pair = interpretExampleObject({ dataValue: 1, serializedValue: 'q=2' }, context);
    expect(pair).toMatchObject({ data: 1, decodedData: 2, pairing: 'invalid' });
    expect(exampleParameterInput(pair, context.layer)).toEqual({ text: 'q=2', layer: 'parameter', instance: 2 });
  });
  test('a JSON-looking string stays a string when a referenced Schema has no local codec shape', () => {
    const parameter = queryParam({ $ref: 'https://registry.example/string-schema' });
    const result = interpretExampleObject({ dataValue: '{"a":1}' }, { layer: 'parameter', parameter });
    expect(result).toMatchObject({ data: '{"a":1}', text: 'q=%7B%22a%22%3A1%7D' });
    expect(result.text).not.toBe('a=1');
  });
  test.each([
    ['path', 'label', true, ['a.b', 'c'], '.a.b.c'],
    ['header', 'simple', false, ['a,b', 'c'], 'a,b,c'],
  ] as const)(
    'ambiguous %s %s delimiters use forward pairing without invented decoded data',
    (location, style, explode, data, expected) => {
      const parameter: DebugParam = {
        ...queryParam({ type: 'array', items: { type: 'string' } }),
        in: location,
        parameterSerialization: { kind: 'schema', style, explode, allowReserved: false },
      };
      const context = { layer: 'parameter' as const, parameter };
      const text = serializeExampleData([...data], context);
      expect(text).toBe(expected);
      const pair = interpretExampleObject({ dataValue: [...data], serializedValue: text }, context);
      expect(pair).toMatchObject({ data: [...data], pairing: 'valid', serialization: 'unavailable', text });
      expect(pair).not.toHaveProperty('decodedData');
      const serializedOnly = interpretExampleObject({ serializedValue: text }, context);
      expect(serializedOnly).not.toHaveProperty('data');
      expect(serializedOnly).not.toHaveProperty('decodedData');
    },
  );
  function request(param: DebugParam, text: string, layer: 'parameter' | 'media' = 'parameter') {
    const model: OperationDebugModel = {
      pathParams: param.in === 'path' ? [param] : [],
      queryParams: param.in === 'query' ? [param] : [],
      headerParams: param.in === 'header' ? [param] : [],
      cookieParams: [],
      bodyContents: [],
      bodyRequired: false,
    };
    const example = interpretExampleObject(
      { serializedValue: text },
      {
        layer,
        parameter: param,
        mediaType:
          param.parameterSerialization?.kind === 'content' ? param.parameterSerialization.mediaType : undefined,
      },
    );
    const input = exampleParameterInput(example, layer);
    expect(input).toBeDefined();
    return buildRequest({
      baseUrl: 'https://api.example',
      path: '/items/{q}',
      method: 'get',
      debugModel: model,
      globalParams: { headers: {}, queries: { q: 'stale', extra: 'yes' } },
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        serializedExampleParameters: { [`${param.in}:${param.name}`]: input! },
      },
    });
  }
  test('query names and repeated entries are not encoded twice', () => {
    const param = queryParam({ type: 'array', items: { type: 'string' } });
    const text = 'q=a%20b&q=%2B%25';
    const result = interpretExampleObject(
      { dataValue: ['a b', '+%'], serializedValue: text },
      { layer: 'parameter', parameter: param },
    );
    expect(result).toMatchObject({ pairing: 'valid', text });
    expect(request(param, text).url).toBe('https://api.example/items/{q}?extra=yes&q=a%20b&q=%2B%25');
  });
  test('splits raw query separators before decoding encoded commas and preserves deepObject bracket data', () => {
    const param: DebugParam = {
      ...queryParam({ type: 'array', items: { type: 'string' } }),
      name: 'tags',
      parameterSerialization: { kind: 'schema', style: 'form', explode: false, allowReserved: false },
    };
    const data = ['a,b', 'c'];
    const existing = serializeOas31Parameters(
      { pathParams: [], queryParams: [param], headerParams: [], cookieParams: [] },
      { 'query:tags': JSON.stringify(data) },
    );
    const text = existing.query.map((pair) => `${pair.encodedName}=${pair.encodedValue}`).join('&');
    expect(text).toBe('tags=a%2Cb,c');
    expect(
      interpretExampleObject({ dataValue: data, serializedValue: text }, { layer: 'parameter', parameter: param }),
    ).toMatchObject({ decodedData: data, pairing: 'valid' });
    const deep = {
      ...queryParam({ type: 'object', properties: { 'a][b': { type: 'string' } } }),
      name: 'q[x]',
      parameterSerialization: { kind: 'schema' as const, style: 'deepObject', explode: true, allowReserved: false },
    };
    const deepData = { 'a][b': 'c,d' };
    const deepText = serializeExampleData(deepData, { layer: 'parameter', parameter: deep });
    expect(deepText).toBe('q%5Bx%5D%5Ba%5D%5Bb%5D=c%2Cd');
    expect(
      interpretExampleObject(
        { dataValue: deepData, serializedValue: deepText },
        { layer: 'parameter', parameter: deep },
      ),
    ).toMatchObject({ decodedData: deepData, pairing: 'valid' });
  });
  test('nullable and mixed string values use the existing escape hatch without inventing an inverse', () => {
    const param = queryParam({ type: ['string', 'integer', 'null'] });
    expect(serializeExampleData('1', { layer: 'parameter', parameter: param })).toBe('q=1');
    expect(
      interpretExampleObject({ dataValue: '1', serializedValue: 'q=1' }, { layer: 'parameter', parameter: param }),
    ).toMatchObject({ data: '1', pairing: 'valid', serialization: 'unavailable' });
    expect(
      interpretExampleObject({ serializedValue: 'q=1' }, { layer: 'parameter', parameter: param }),
    ).not.toHaveProperty('data');
  });
  test('urlencoded JSON string fields and comma arrays replay the existing field codecs', () => {
    const bodyContent: BodyContent = {
      mediaType: 'application/x-www-form-urlencoded',
      category: 'urlencoded',
      schema: {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } }, payload: { type: 'string' } },
      },
    };
    const context = {
      layer: 'media' as const,
      mediaType: bodyContent.mediaType,
      bodyContent,
      encoding: { tags: { style: 'form', explode: false }, payload: { contentType: 'application/json' } },
    };
    const data = { tags: ['a,b', 'c'], payload: 'hello' };
    const text = serializeExampleData(data, context);
    expect(text).toBe('tags=a%2Cb,c&payload=%22hello%22');
    expect(interpretExampleObject({ dataValue: data, serializedValue: text }, context)).toMatchObject({
      data,
      decodedData: data,
      pairing: 'valid',
    });
  });
  test('JSON media text receives exactly one parameter envelope', () => {
    const param = {
      ...queryParam({ type: 'object', properties: { n: { type: 'integer' } } }),
      parameterSerialization: { kind: 'content' as const, mediaType: 'application/json' },
    };
    const text = '{ "n": 0 }';
    expect(request(param, text, 'media').url).toContain('q=%7B+%22n%22%3A+0+%7D');
    const encoded = 'q=%7B%20%22n%22%3A%200%20%7D';
    expect(request(param, encoded).url).toContain(encoded);
    expect(
      interpretExampleObject(
        { dataValue: { n: 0 }, serializedValue: encoded },
        { layer: 'parameter', parameter: param },
      ).pairing,
    ).toBe('valid');
  });
  test.each([
    ['matrix', ';q=blue;q=black'],
    ['label', '.blue.black'],
  ])('%s retains its leading delimiter', (style, text) => {
    const param: DebugParam = {
      ...queryParam({ type: 'array', items: { type: 'string' } }),
      in: 'path',
      parameterSerialization: { kind: 'schema', style, explode: true, allowReserved: false },
    };
    expect(request(param, text).url).toContain(`/items/${text}`);
    expect(
      interpretExampleObject({ serializedValue: text.slice(1) }, { layer: 'parameter', parameter: param })
        .serialization,
    ).toBe('invalid');
  });
  test('header uses only the header value, including exploded property names', () => {
    const param: DebugParam = {
      ...queryParam({ type: 'object', properties: { n: { type: 'integer' } } }),
      in: 'header',
      parameterSerialization: { kind: 'schema', style: 'simple', explode: true, allowReserved: false },
    };
    expect(request(param, 'n=0').headers.q).toBe('n=0');
    expect(
      interpretExampleObject({ serializedValue: 'q: n=0' }, { layer: 'header', parameter: param }).serialization,
    ).toBe('invalid');
    expect(
      interpretExampleObject({ serializedValue: 'x\r\ny: z' }, { layer: 'header', parameter: param }).serialization,
    ).toBe('invalid');
  });
  test('urlencoded data and author bytes share the existing codec, preview and cURL', () => {
    const bodyContent: BodyContent = {
      mediaType: 'application/x-www-form-urlencoded',
      category: 'urlencoded',
      schema: {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
          zero: { type: 'integer' },
          flag: { type: 'boolean' },
          empty: { type: 'string' },
        },
      },
    };
    const data = { tags: ['a b', '+%'], zero: 0, flag: false, empty: '' };
    const text = 'tags=a+b&tags=%2B%25&zero=0&flag=false&empty=';
    const result = interpretExampleObject(
      { dataValue: data, serializedValue: text },
      { layer: 'media', mediaType: bodyContent.mediaType, bodyContent },
    );
    expect(result).toMatchObject({ data, text, pairing: 'valid', serialization: 'valid' });
    expect(
      interpretExampleObject({ dataValue: data }, { layer: 'media', mediaType: bodyContent.mediaType, bodyContent })
        .text,
    ).toBe(text);
    const built = buildRequest({
      baseUrl: 'https://api.example',
      path: '/items',
      method: 'post',
      debugModel: {
        pathParams: [],
        queryParams: [],
        headerParams: [],
        cookieParams: [],
        bodyContents: [bodyContent],
        bodyRequired: true,
      },
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        selectedContentType: bodyContent.mediaType,
        serializedExampleBody: { mediaType: bodyContent.mediaType, text },
        formFields: { ignored: 'stale' },
      },
    });
    expect(built.body).toBe(text);
    expect(buildCurl(built)).toContain(text);
    expect(buildCurl({ ...built, body: '' }).replace(/\\\n\s*/g, '')).toContain("-d ''");
  });
});

describe('reviewed Example request boundaries', () => {
  const emptyForm: DebugFormValues = { pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} };
  const modelFor = (body: BodyContent): OperationDebugModel => ({
    pathParams: [],
    queryParams: [],
    headerParams: [],
    cookieParams: [],
    bodyContents: [body],
    bodyRequired: true,
  });

  test.each([
    ['application/x-www-form-urlencoded', 'urlencoded', 'tags=a,b'],
    ['text/plain', 'raw', ''],
  ] as const)(
    'required %s accepts explicit text including empty, but not missing or mismatched media',
    (mediaType, category, text) => {
      const model = modelFor({ mediaType, category });
      const form = { ...emptyForm, selectedContentType: mediaType, serializedExampleBody: { mediaType, text } };
      const request = buildRequest({
        baseUrl: 'https://api.example',
        path: '/items',
        method: 'post',
        debugModel: model,
        formValues: form,
      });
      expect(request).toMatchObject({ body: text, explicitExampleBody: true });
      expect(validateRequired(model, form, request.parameterPresence)).toEqual([]);
      for (const missing of [
        { ...emptyForm, selectedContentType: mediaType },
        { ...form, serializedExampleBody: { mediaType: 'application/other', text } },
        {
          ...form,
          serializedExampleBody: { mediaType, text: undefined } as unknown as DebugFormValues['serializedExampleBody'],
        },
      ])
        expect(validateRequired(model, missing).map((error) => error.key)).toContain('body:requestBody');
      const external = interpretExampleObject({ externalValue: './sample' }, { layer: 'media', mediaType });
      expect(external.text).toBeUndefined();
    },
  );

  test.each(['"1"', '"abc"', 'null', ''])('wire scalar %p is not editor JSON-string escaping', (value) => {
    const parameter = queryParam({ type: ['string', 'null'] });
    const text = `q=${encodeURIComponent(value)}`;
    const result = interpretExampleObject({ serializedValue: text }, { layer: 'parameter', parameter });
    if (value === '') {
      expect(result.serialization).toBe('unavailable');
      expect(result).not.toHaveProperty('decodedData');
    } else expect(result).toMatchObject({ decodedData: value, data: value, text, serialization: 'valid' });
    const paired = interpretExampleObject(
      { dataValue: value, serializedValue: text },
      { layer: 'parameter', parameter },
    );
    expect(paired.pairing).toBe('valid');
  });

  test('nullable array items retain literal quotes and leave ambiguous empty values undecoded', () => {
    const parameter = queryParam({ type: 'array', items: { type: ['string', 'null'] } });
    expect(
      interpretExampleObject({ serializedValue: 'q=%221%22&q=null' }, { layer: 'parameter', parameter }),
    ).toMatchObject({ data: ['"1"', 'null'], serialization: 'valid' });
    expect(interpretExampleObject({ serializedValue: 'q=' }, { layer: 'parameter', parameter })).not.toHaveProperty(
      'data',
    );
  });

  test.each([
    { style: 'form', explode: false, contentType: 'application/json' },
    { explode: false, contentType: 'application/json' },
    { allowReserved: false, contentType: 'application/json' },
  ])('form inverse uses the same Encoding precedence as the forward codec: %p', (encoding) => {
    const bodyContent: BodyContent = {
      mediaType: 'application/x-www-form-urlencoded',
      category: 'urlencoded',
      schema: { type: 'object', properties: { payload: { type: 'object', properties: { a: { type: 'integer' } } } } },
    };
    const context = {
      layer: 'media' as const,
      mediaType: bodyContent.mediaType,
      bodyContent,
      encoding: { payload: encoding },
    };
    const data = { payload: { a: 1 } };
    const text = serializeExampleData(data, context);
    // form/explode=true flattens an object's keys; its inverse has no unique field ownership.
    if (!('explode' in encoding)) expect(text).toBe('a=1');
    else {
      expect(text).toBe('payload=a,1');
      for (const source of [
        { dataValue: data },
        { serializedValue: text },
        { dataValue: data, serializedValue: text },
      ]) {
        expect(interpretExampleObject(source, context)).toMatchObject({ data, text, serialization: 'valid' });
      }
      expect(
        interpretExampleObject({ dataValue: { payload: { a: 2 } }, serializedValue: text }, context),
      ).toMatchObject({ pairing: 'invalid', serialization: 'valid' });
    }
    expect(interpretExampleObject({ dataValue: data, serializedValue: text }, context).pairing).toBe('valid');
    expect(interpretExampleObject({ dataValue: data }, context).diagnostics.map((item) => item.code)).not.toContain(
      'INVALID_JSON_SERIALIZATION',
    );
  });

  test.each(['constructor', 'toString', '__proto__', 'normal'])(
    'form field %s does not inherit an Encoding Object',
    (name) => {
      const bodyContent: BodyContent = {
        mediaType: 'application/x-www-form-urlencoded',
        category: 'urlencoded',
        schema: { type: 'object', properties: Object.fromEntries([[name, { type: 'string' }]]) },
      };
      const context = { layer: 'media' as const, mediaType: bodyContent.mediaType, bodyContent };
      const data = Object.fromEntries([[name, 'ok']]);
      expect(interpretExampleObject({ serializedValue: `${name}=ok` }, context)).toMatchObject({
        data,
        serialization: 'valid',
      });
      expect(interpretExampleObject({ dataValue: data, serializedValue: `${name}=ok` }, context)).toMatchObject({
        data,
        serialization: 'valid',
        pairing: 'valid',
      });
    },
  );

  test.each(['__proto__', 'constructor', 'toString'])(
    'Header %s survives data, author text, editing and case-insensitive merge',
    (name) => {
      const parameter: DebugParam = {
        ...queryParam(),
        name,
        in: 'header',
        required: true,
        parameterSerialization: { kind: 'schema', style: 'simple', explode: false, allowReserved: false },
      };
      const model: OperationDebugModel = {
        pathParams: [],
        queryParams: [],
        headerParams: [parameter],
        cookieParams: [],
        bodyContents: [],
        bodyRequired: false,
      };
      for (const source of [{ dataValue: 'ok' }, { serializedValue: 'ok' }]) {
        const result = interpretExampleObject(source, { layer: 'parameter', parameter });
        expect(result).toMatchObject({ text: 'ok', data: 'ok', serialization: 'valid' });
        const form = {
          ...emptyForm,
          serializedExampleParameters: { [`header:${name}`]: exampleParameterInput(result, 'parameter')! },
        };
        const request = buildRequest({
          baseUrl: 'https://api.example',
          path: '/items',
          method: 'get',
          debugModel: model,
          formValues: form,
          globalParams: { headers: { [name.toUpperCase()]: 'global' }, queries: {} },
        });
        expect(Object.keys(request.headers)).toEqual([name]);
        expect(Object.prototype.hasOwnProperty.call(request.headers, name)).toBe(true);
        expect(request.headers[name]).toBe('ok');
        expect(request.sourceMap?.headers[name]).toBe('interface');
        expect(validateRequired(model, form)).toEqual([]);
        expect(buildCurl(request)).toContain(`${name}: ok`);
      }
      const edited = buildRequest({
        baseUrl: 'https://api.example',
        path: '/items',
        method: 'get',
        debugModel: model,
        formValues: { ...emptyForm, oas31ParameterValues: { [`header:${name}`]: 'edited' } },
      });
      expect(edited.headers[name]).toBe('edited');
      expect(validateRequired(model, emptyForm).map((error) => error.key)).toContain(`header:${name}`);
    },
  );
});
