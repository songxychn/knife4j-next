import {
  authToHeaders,
  buildCurl,
  buildQueryString,
  buildRequest,
  buildUrlencodedBody,
  mergeHeaders,
  replacePathParams,
  splitGlobalParams,
  validateRequired,
} from '../../debug/requestBuilder';
import type { DebugFormValues, GlobalParamValues, OperationDebugModel } from '../../debug/types';

// ─── replacePathParams ────────────────────────────────

describe('replacePathParams', () => {
  test('replaces single path param', () => {
    expect(replacePathParams('/users/{id}', { id: '42' })).toBe('/users/42');
  });

  test('replaces multiple path params', () => {
    expect(replacePathParams('/users/{userId}/posts/{postId}', { userId: '1', postId: '99' })).toBe(
      '/users/1/posts/99',
    );
  });

  test('encodes special characters', () => {
    expect(replacePathParams('/files/{path}', { path: 'a/b c' })).toBe('/files/a%2Fb%20c');
  });

  test('ignores empty param name', () => {
    expect(replacePathParams('/users/{id}', { '': 'x', id: '1' })).toBe('/users/1');
  });

  test('leaves unreferenced placeholders as-is', () => {
    expect(replacePathParams('/users/{id}', {})).toBe('/users/{id}');
  });

  test('handles RFC 6570 {+name} style', () => {
    expect(replacePathParams('/files/{+path}', { path: 'a/b' })).toBe('/files/a%2Fb');
  });
});

// ─── buildQueryString ─────────────────────────────────

describe('buildQueryString', () => {
  test('builds query string from params', () => {
    expect(buildQueryString({ page: '1', size: '10' })).toBe('page=1&size=10');
  });

  test('encodes special characters', () => {
    const result = buildQueryString({ q: 'hello world', filter: 'a&b' });
    expect(result).toContain('q=hello%20world');
    expect(result).toContain('filter=a%26b');
  });

  test('skips empty name AND value', () => {
    expect(buildQueryString({ '': '' })).toBe('');
  });

  test('handles empty input', () => {
    expect(buildQueryString({})).toBe('');
  });

  test('repeats query parameter names for OAS3 arrays by default', () => {
    expect(buildQueryString({ httpCode: ['SUCCESS', 'BAD_REQUEST'] })).toBe('httpCode=SUCCESS&httpCode=BAD_REQUEST');
  });

  test('joins OAS3 array values for explicit form explode=false', () => {
    expect(
      buildQueryString({ httpCode: ['SUCCESS', 'BAD_REQUEST'] }, { httpCode: { style: 'form', explode: false } }),
    ).toBe('httpCode=SUCCESS,BAD_REQUEST');
  });

  test('encodes item commas separately from the form array delimiter', () => {
    expect(buildQueryString({ status: ['A,B', 'C'] }, { status: { style: 'form', explode: false } })).toBe(
      'status=A%2CB,C',
    );
  });

  test('supports OAS3 spaceDelimited and pipeDelimited array styles', () => {
    expect(
      buildQueryString(
        { spaces: ['a', 'b'], pipes: ['a', 'b'] },
        {
          spaces: { style: 'spaceDelimited' },
          pipes: { style: 'pipeDelimited' },
        },
      ),
    ).toBe('spaces=a%20b&pipes=a%7Cb');
  });

  test('rejects style and explode combinations that OAS3 does not define for query arrays', () => {
    expect(() =>
      buildQueryString({ status: ['OPEN', 'CLOSED'] }, { status: { style: 'pipeDelimited', explode: true } }),
    ).toThrow('Unsupported OAS3 query array serialization');
    expect(() =>
      buildQueryString({ status: ['OPEN', 'CLOSED'] }, { status: { style: 'deepObject', explode: false } }),
    ).toThrow('Unsupported OAS3 query array serialization');
  });
});

describe('buildUrlencodedBody', () => {
  test('preserves non-empty values and keeps the legacy behavior of omitting empty fields', () => {
    expect(buildUrlencodedBody({ padded: '  value  ', empty: '' })).toBe('padded=%20%20value%20%20');
  });
});

// ─── mergeHeaders ─────────────────────────────────────

describe('mergeHeaders', () => {
  test('merges multiple header sources', () => {
    const result = mergeHeaders({ Authorization: 'Bearer xxx' }, { 'Content-Type': 'application/json' });
    expect(result).toEqual({
      Authorization: 'Bearer xxx',
      'Content-Type': 'application/json',
    });
  });

  test('later sources override earlier ones', () => {
    const result = mergeHeaders({ 'X-Token': 'old' }, { 'X-Token': 'new' });
    expect(result['X-Token']).toBe('new');
  });

  test('later sources override case-insensitively and preserve only the winning key casing', () => {
    const result = mergeHeaders({ 'X-Token': 'old' }, { 'x-token': 'new' });
    expect(result).toEqual({ 'x-token': 'new' });
  });

  test('skips undefined and empty string values', () => {
    const result = mergeHeaders({ A: 'a', B: '', C: 'c' }, undefined);
    expect(result).toEqual({ A: 'a', C: 'c' });
  });

  test('handles all undefined sources', () => {
    expect(mergeHeaders(undefined, undefined)).toEqual({});
  });
});

// ─── authToHeaders ────────────────────────────────────

describe('authToHeaders', () => {
  test('bearer token', () => {
    const result = authToHeaders({ bearerToken: 'mytoken' });
    expect(result.headers['Authorization']).toBe('Bearer mytoken');
  });

  test('basic credentials', () => {
    const result = authToHeaders({ basicCredentials: 'dXNlcjpwYXNz' });
    expect(result.headers['Authorization']).toBe('Basic dXNlcjpwYXNz');
  });

  test('basic overrides bearer when both present', () => {
    const result = authToHeaders({ bearerToken: 'tok', basicCredentials: 'dXNlcjpwYXNz' });
    expect(result.headers['Authorization']).toBe('Basic dXNlcjpwYXNz');
  });

  test('api keys', () => {
    const result = authToHeaders({ apiKeys: { 'X-API-Key': 'key123' } });
    expect(result.headers['X-API-Key']).toBe('key123');
  });

  test('empty auth returns empty headers', () => {
    expect(authToHeaders(undefined)).toEqual({ headers: {}, queries: {} });
  });

  // ── bySecurityKey tests ──

  test('apiKey in header via bySecurityKey', () => {
    const result = authToHeaders({
      bySecurityKey: {
        apiHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key', value: 'mykey' },
      },
    });
    expect(result.headers['X-API-Key']).toBe('mykey');
    expect(result.queries).toEqual({});
  });

  test('apiKey in query via bySecurityKey', () => {
    const result = authToHeaders({
      bySecurityKey: {
        apiQuery: { type: 'apiKey', in: 'query', name: 'api_key', value: 'qkey' },
      },
    });
    expect(result.queries['api_key']).toBe('qkey');
    expect(result.headers).toEqual({});
  });

  test('apiKey in cookie via bySecurityKey', () => {
    const result = authToHeaders({
      bySecurityKey: {
        apiCookie: { type: 'apiKey', in: 'cookie', name: 'session', value: 'abc123' },
      },
    });
    expect(result.headers['Cookie']).toBe('session=abc123');
  });

  test('apiKey in cookie appends to existing Cookie header', () => {
    const result = authToHeaders({
      bySecurityKey: {
        apiCookie: { type: 'apiKey', in: 'cookie', name: 'session', value: 'abc123' },
        apiCookie2: { type: 'apiKey', in: 'cookie', name: 'token', value: 'xyz' },
      },
    });
    expect(result.headers['Cookie']).toContain('session=abc123');
    expect(result.headers['Cookie']).toContain('token=xyz');
  });

  test('apiKey in cookie merges into existing lowercase cookie header (case-insensitive)', () => {
    // Simulates a caller that already injected a lowercase `cookie` key into
    // `apiKeys`; the cookie-position scheme below should append into the same
    // header instead of producing a duplicate `Cookie` entry.
    const result = authToHeaders({
      apiKeys: { cookie: 'pre=set' },
      bySecurityKey: {
        apiCookie: { type: 'apiKey', in: 'cookie', name: 'session', value: 'abc123' },
      },
    });
    expect(result.headers['cookie']).toBe('pre=set; session=abc123');
    expect(result.headers['Cookie']).toBeUndefined();
  });

  test('http bearer via bySecurityKey', () => {
    const result = authToHeaders({
      bySecurityKey: {
        bearerAuth: { type: 'http', scheme: 'bearer', token: 'bykey-token' },
      },
    });
    expect(result.headers['Authorization']).toBe('Bearer bykey-token');
  });

  test('http basic via bySecurityKey', () => {
    const result = authToHeaders({
      bySecurityKey: {
        basicAuth: { type: 'http', scheme: 'basic', username: 'user', password: 'pass' },
      },
    });
    expect(result.headers['Authorization']).toBe('Basic dXNlcjpwYXNz');
  });

  test('oauth2 via bySecurityKey', () => {
    const result = authToHeaders({
      bySecurityKey: {
        oauth: { type: 'oauth2', accessToken: 'oauth-token', tokenType: 'Bearer' },
      },
    });
    expect(result.headers['Authorization']).toBe('Bearer oauth-token');
  });

  test('oauth2 with custom tokenType', () => {
    const result = authToHeaders({
      bySecurityKey: {
        oauth: { type: 'oauth2', accessToken: 'mac-token', tokenType: 'MAC' },
      },
    });
    expect(result.headers['Authorization']).toBe('MAC mac-token');
  });

  test('securityKeys filters bySecurityKey entries', () => {
    const result = authToHeaders(
      {
        bySecurityKey: {
          apiKey1: { type: 'apiKey', in: 'header', name: 'X-Key-1', value: 'v1' },
          apiKey2: { type: 'apiKey', in: 'header', name: 'X-Key-2', value: 'v2' },
        },
      },
      ['apiKey2'],
    );
    expect(result.headers['X-Key-2']).toBe('v2');
    expect(result.headers['X-Key-1']).toBeUndefined();
  });

  test('securityKeys with unknown key falls through gracefully', () => {
    const result = authToHeaders(
      {
        bySecurityKey: {
          apiKey1: { type: 'apiKey', in: 'header', name: 'X-Key-1', value: 'v1' },
        },
      },
      ['nonExistent'],
    );
    expect(result.headers).toEqual({});
  });

  test('no securityKeys means all bySecurityKey entries are injected', () => {
    const result = authToHeaders({
      bySecurityKey: {
        apiKey1: { type: 'apiKey', in: 'header', name: 'X-Key-1', value: 'v1' },
        apiKey2: { type: 'apiKey', in: 'header', name: 'X-Key-2', value: 'v2' },
      },
    });
    expect(result.headers['X-Key-1']).toBe('v1');
    expect(result.headers['X-Key-2']).toBe('v2');
  });

  test('bySecurityKey overrides legacy bearerToken', () => {
    const result = authToHeaders({
      bearerToken: 'legacy-token',
      bySecurityKey: {
        bearerAuth: { type: 'http', scheme: 'bearer', token: 'new-token' },
      },
    });
    expect(result.headers['Authorization']).toBe('Bearer new-token');
  });

  test('skips apiKey with empty name or value', () => {
    const result = authToHeaders({
      bySecurityKey: {
        emptyName: { type: 'apiKey', in: 'header', name: '', value: 'v' },
        emptyValue: { type: 'apiKey', in: 'header', name: 'X-Key', value: '' },
      },
    });
    expect(result.headers).toEqual({});
  });
});

// ─── splitGlobalParams ────────────────────────────────

describe('splitGlobalParams', () => {
  test('splits headers and queries', () => {
    const gp: GlobalParamValues = {
      headers: { 'X-Token': 'global-token' },
      queries: { lang: 'zh' },
    };
    const result = splitGlobalParams(gp);
    expect(result.headers).toEqual({ 'X-Token': 'global-token' });
    expect(result.queries).toEqual({ lang: 'zh' });
  });

  test('handles undefined', () => {
    const result = splitGlobalParams(undefined);
    expect(result.headers).toEqual({});
    expect(result.queries).toEqual({});
  });
});

// ─── validateRequired ─────────────────────────────────

describe('validateRequired', () => {
  const model: OperationDebugModel = {
    pathParams: [{ name: 'id', in: 'path', required: true, type: 'integer' }],
    queryParams: [{ name: 'page', in: 'query', required: false, type: 'integer' }],
    headerParams: [{ name: 'X-Auth', in: 'header', required: true, type: 'string' }],
    cookieParams: [],
    bodyContents: [{ mediaType: 'application/json', category: 'json', schema: {} }],
    bodyRequired: true,
  };

  test('reports missing required path param (with locator key)', () => {
    const form: DebugFormValues = {
      pathParams: { id: '' },
      queryParams: {},
      headerParams: { 'X-Auth': 'token' },
      cookieParams: {},
      body: '{}',
    };
    const errors = validateRequired(model, form);
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'id', in: 'path', key: 'path:id' })]),
    );
  });

  test('reports missing required header', () => {
    const form: DebugFormValues = {
      pathParams: { id: '1' },
      queryParams: {},
      headerParams: {},
      cookieParams: {},
      body: '{}',
    };
    const errors = validateRequired(model, form);
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'X-Auth', in: 'header', key: 'header:X-Auth' })]),
    );
  });

  test('reports missing required json body', () => {
    const form: DebugFormValues = {
      pathParams: { id: '1' },
      queryParams: {},
      headerParams: { 'X-Auth': 'token' },
      cookieParams: {},
      body: '',
    };
    const errors = validateRequired(model, form);
    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'requestBody', in: 'body', key: 'body:requestBody' })]),
    );
  });

  test('returns no errors when all required fields are filled', () => {
    const form: DebugFormValues = {
      pathParams: { id: '1' },
      queryParams: {},
      headerParams: { 'X-Auth': 'token' },
      cookieParams: {},
      body: '{"name":"test"}',
    };
    const errors = validateRequired(model, form);
    expect(errors).toHaveLength(0);
  });

  test('urlencoded body: missing when formFields all empty', () => {
    const urlencodedModel: OperationDebugModel = {
      pathParams: [],
      queryParams: [],
      headerParams: [],
      cookieParams: [],
      bodyContents: [{ mediaType: 'application/x-www-form-urlencoded', category: 'urlencoded', schema: {} }],
      bodyRequired: true,
    };
    const form: DebugFormValues = {
      pathParams: {},
      queryParams: {},
      headerParams: {},
      cookieParams: {},
      selectedContentType: 'application/x-www-form-urlencoded',
      formFields: { a: '', b: '' },
    };
    const errors = validateRequired(urlencodedModel, form);
    expect(errors.map((e) => e.key)).toContain('body:requestBody');
  });

  test('urlencoded body: an explicitly empty dynamic field still supplies the request body', () => {
    const urlencodedModel: OperationDebugModel = {
      pathParams: [],
      queryParams: [],
      headerParams: [],
      cookieParams: [],
      bodyContents: [{ mediaType: 'application/x-www-form-urlencoded', category: 'urlencoded', schema: {} }],
      bodyRequired: true,
    };
    const form: DebugFormValues = {
      pathParams: {},
      queryParams: {},
      headerParams: {},
      cookieParams: {},
      selectedContentType: 'application/x-www-form-urlencoded',
      formFields: { clear: '' },
      formFieldNamesToIncludeWhenEmpty: ['clear'],
    };

    expect(validateRequired(urlencodedModel, form)).toHaveLength(0);
  });

  test('urlencoded body: an allowlisted name missing from formFields does not satisfy the request body', () => {
    const urlencodedModel: OperationDebugModel = {
      pathParams: [],
      queryParams: [],
      headerParams: [],
      cookieParams: [],
      bodyContents: [{ mediaType: 'application/x-www-form-urlencoded', category: 'urlencoded', schema: {} }],
      bodyRequired: true,
    };
    const form: DebugFormValues = {
      pathParams: {},
      queryParams: {},
      headerParams: {},
      cookieParams: {},
      selectedContentType: 'application/x-www-form-urlencoded',
      formFields: { optional: '' },
      formFieldNamesToIncludeWhenEmpty: ['missing'],
    };

    expect(validateRequired(urlencodedModel, form).map((error) => error.key)).toContain('body:requestBody');
  });

  test('multipart body: validates a required file field', () => {
    const multipartModel: OperationDebugModel = {
      pathParams: [],
      queryParams: [],
      headerParams: [],
      cookieParams: [],
      bodyContents: [
        {
          mediaType: 'multipart/form-data',
          category: 'multipart',
          schema: {
            type: 'object',
            required: ['file'],
            properties: {
              file: { type: 'string', format: 'binary' },
            },
          },
          fileFields: ['file'],
        },
      ],
      bodyRequired: false,
    };
    const form: DebugFormValues = {
      pathParams: {},
      queryParams: {},
      headerParams: {},
      cookieParams: {},
      selectedContentType: 'multipart/form-data',
      fileFields: { file: [] },
    };

    expect(validateRequired(multipartModel, form)).toEqual([
      expect.objectContaining({ name: 'file', in: 'body', key: 'body:file' }),
    ]);

    form.fileFields = { file: [new Uint8Array([1, 2, 3])] };
    expect(validateRequired(multipartModel, form)).toHaveLength(0);
  });

  test('OAS 3.1 multipart files defer required diagnostics to the shared form plan', () => {
    const multipartModel: OperationDebugModel = {
      pathParams: [],
      queryParams: [],
      headerParams: [],
      cookieParams: [],
      bodyContents: [
        {
          mediaType: 'multipart/form-data',
          category: 'multipart',
          schema: { type: 'object', required: ['file'], properties: { file: { format: 'binary' } } },
          fileFields: ['file'],
          oas31Form: {
            diagnostics: [],
            fields: [
              {
                name: 'file',
                schema: { format: 'binary' },
                type: 'unknown',
                required: true,
                readOnly: false,
                file: true,
                multiple: false,
                maxFiles: 1,
                encoding: {
                  kind: 'content',
                  contentTypes: ['application/octet-stream'],
                  contentTypeExplicit: false,
                  headers: [],
                },
              },
            ],
          },
        },
      ],
      bodyRequired: true,
    };

    expect(
      validateRequired(multipartModel, {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        selectedContentType: 'multipart/form-data',
        fileFields: { file: [] },
      }),
    ).toEqual([]);
  });

  test('binary body: validates that a file was selected', () => {
    const binaryModel: OperationDebugModel = {
      pathParams: [],
      queryParams: [],
      headerParams: [],
      cookieParams: [],
      bodyContents: [{ mediaType: 'application/octet-stream', category: 'raw', binary: true }],
      bodyRequired: true,
    };
    const form: DebugFormValues = {
      pathParams: {},
      queryParams: {},
      headerParams: {},
      cookieParams: {},
      selectedContentType: 'application/octet-stream',
    };

    expect(validateRequired(binaryModel, form).map((error) => error.key)).toContain('body:requestBody');
    form.binaryBodyFileName = 'payload.bin';
    expect(validateRequired(binaryModel, form)).toHaveLength(0);
  });
});

// ─── buildRequest ─────────────────────────────────────

describe('buildRequest', () => {
  const debugModel: OperationDebugModel = {
    pathParams: [{ name: 'id', in: 'path', required: true, type: 'integer' }],
    queryParams: [{ name: 'verbose', in: 'query', required: false, type: 'boolean' }],
    headerParams: [{ name: 'X-Token', in: 'header', required: false, type: 'string' }],
    cookieParams: [],
    bodyContents: [{ mediaType: 'application/json', category: 'json', schema: {} }],
    bodyRequired: false,
  };

  test('builds GET request with path + query', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/users/{id}',
      method: 'GET',
      debugModel,
      formValues: {
        pathParams: { id: '42' },
        queryParams: { verbose: 'true' },
        headerParams: {},
        cookieParams: {},
      },
    });

    expect(result.url).toBe('http://localhost:8080/users/42?verbose=true');
    expect(result.method).toBe('GET');
    expect(result.body).toBeUndefined();
  });

  test('keeps an explicitly supplied GET body for non-browser clients and cURL', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/search',
      method: 'GET',
      debugModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        selectedContentType: 'application/json',
        body: '{"query":"knife4j"}',
      },
    });

    expect(result.body).toBe('{"query":"knife4j"}');
    expect(buildCurl(result)).toContain('-d');
  });

  test('keeps an explicitly supplied HEAD body in the pure request and cURL model', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/probe',
      method: 'HEAD',
      debugModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        selectedContentType: 'application/json',
        body: '{"probe":true}',
      },
    });

    expect(result.body).toBe('{"probe":true}');
    expect(buildCurl(result)).toContain('-d');
  });

  test('serializes array query params with their OAS3 style and explode metadata', () => {
    const arrayQueryModel: OperationDebugModel = {
      ...debugModel,
      pathParams: [],
      queryParams: [
        { name: 'httpCode', in: 'query', required: false, type: 'array' },
        { name: 'status', in: 'query', required: false, type: 'array', style: 'form', explode: false },
      ],
    };
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/enum/batch',
      method: 'GET',
      debugModel: arrayQueryModel,
      formValues: {
        pathParams: {},
        queryParams: {
          httpCode: ['SUCCESS', 'BAD_REQUEST'],
          status: ['OPEN', 'CLOSED'],
        },
        headerParams: {},
        cookieParams: {},
      },
    });

    expect(result.url).toBe(
      'http://localhost:8080/enum/batch?httpCode=SUCCESS&httpCode=BAD_REQUEST&status=OPEN,CLOSED',
    );
    expect(result.query.httpCode).toEqual(['SUCCESS', 'BAD_REQUEST']);
  });

  test('builds POST request with body', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/users/{id}',
      method: 'POST',
      debugModel,
      formValues: {
        pathParams: { id: '1' },
        queryParams: {},
        headerParams: { 'X-Token': 'abc' },
        cookieParams: {},
        body: '{"name":"test"}',
        selectedContentType: 'application/json',
      },
    });

    expect(result.url).toBe('http://localhost:8080/users/1');
    expect(result.method).toBe('POST');
    expect(result.body).toBe('{"name":"test"}');
    expect(result.headers['X-Token']).toBe('abc');
    expect(result.contentType).toBe('application/json');
  });

  test('merges global params (does not override user values)', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/users/{id}',
      method: 'GET',
      debugModel,
      formValues: {
        pathParams: { id: '1' },
        queryParams: { verbose: 'true' },
        headerParams: {},
        cookieParams: {},
      },
      globalParams: {
        headers: { 'X-Global': 'yes' },
        queries: { lang: 'zh', verbose: 'false' },
      },
    });

    expect(result.headers['X-Global']).toBe('yes');
    // user value should override global
    expect(result.query['verbose']).toBe('true');
    expect(result.query['lang']).toBe('zh');
  });

  test('adds auth headers', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/users/{id}',
      method: 'GET',
      debugModel,
      formValues: {
        pathParams: { id: '1' },
        queryParams: {},
        headerParams: {},
        cookieParams: {},
      },
      auth: { bearerToken: 'mytoken' },
    });

    expect(result.headers['Authorization']).toBe('Bearer mytoken');
  });

  test('adds cookie params to Cookie header', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/users/{id}',
      method: 'GET',
      debugModel,
      formValues: {
        pathParams: { id: '1' },
        queryParams: {},
        headerParams: { Cookie: 'theme=dark' },
        cookieParams: { session: 'abc123', trace: 'req-1' },
      },
    });

    expect(result.headers['Cookie']).toBe('theme=dark; session=abc123; trace=req-1');
  });

  test('cookie params merge into existing lowercase cookie header (case-insensitive)', () => {
    // 某些调用方（如全局参数或 fetch 原始 headers）会以小写 `cookie` 名义提供。
    // appendCookieParams 应识别并合并到同一个 header，而不是另外输出大写 `Cookie`。
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/users/{id}',
      method: 'GET',
      debugModel,
      formValues: {
        pathParams: { id: '1' },
        queryParams: {},
        headerParams: { cookie: 'theme=dark' },
        cookieParams: { session: 'abc123' },
      },
    });

    expect(result.headers['cookie']).toBe('theme=dark; session=abc123');
    expect(result.headers['Cookie']).toBeUndefined();
  });

  test('Content-Type header is set from selectedContentType', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/data',
      method: 'POST',
      debugModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        body: 'plain text',
        selectedContentType: 'text/plain',
      },
    });

    expect(result.headers['Content-Type']).toBe('text/plain');
  });

  test('user Content-Type header overrides auto-detected', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/data',
      method: 'POST',
      debugModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: { 'Content-Type': 'text/csv' },
        cookieParams: {},
        body: 'a,b',
        selectedContentType: 'application/json',
      },
    });

    expect(result.headers['Content-Type']).toBe('text/csv');
  });

  test('lowercase content-type header overrides auto-detected JSON body type without a duplicate key', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/data',
      method: 'POST',
      debugModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        body: '{"message":"test"}',
        selectedContentType: 'application/json',
      },
      applicationParams: {
        headers: { 'content-type': 'application/problem+json' },
        queries: {},
      },
    });

    expect(result.headers).toEqual({ 'content-type': 'application/problem+json' });
    expect(result.headers['Content-Type']).toBeUndefined();
    expect(result.sourceMap!.headers).toEqual({ 'content-type': 'application' });
    expect(result.body).toBe('{"message":"test"}');
  });

  test('mixed-case content-type header overrides urlencoded form auto-detection', () => {
    const urlencodedModel: OperationDebugModel = {
      ...debugModel,
      bodyContents: [
        {
          mediaType: 'application/x-www-form-urlencoded',
          category: 'urlencoded',
          schema: {},
        },
      ],
    };
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/form',
      method: 'POST',
      debugModel: urlencodedModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        formFields: { name: 'alice' },
        selectedContentType: 'application/x-www-form-urlencoded',
      },
      globalParams: {
        headers: { 'CoNtEnT-TyPe': 'application/custom-form' },
        queries: {},
      },
    });

    expect(result.headers).toEqual({ 'CoNtEnT-TyPe': 'application/custom-form' });
    expect(result.headers['Content-Type']).toBeUndefined();
    expect(result.sourceMap!.headers).toEqual({ 'CoNtEnT-TyPe': 'global' });
    expect(result.body).toBe('name=alice');
  });

  test('multipart form keeps one explicit mixed-case content-type key', () => {
    const multipartModel: OperationDebugModel = {
      ...debugModel,
      bodyContents: [{ mediaType: 'multipart/form-data', category: 'multipart', schema: {} }],
    };
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/upload',
      method: 'POST',
      debugModel: multipartModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: { 'content-TYPE': 'multipart/form-data; boundary=explicit' },
        cookieParams: {},
        formFields: { description: 'sample' },
        selectedContentType: 'multipart/form-data',
      },
    });

    expect(result.headers).toEqual({ 'content-TYPE': 'multipart/form-data; boundary=explicit' });
    expect(result.headers['Content-Type']).toBeUndefined();
    expect(result.body).toBe('{"description":"sample"}');
  });

  test('urlencoded form preserves whitespace and includes only explicitly empty fields', () => {
    const urlencodedModel: OperationDebugModel = {
      ...debugModel,
      bodyContents: [{ mediaType: 'application/x-www-form-urlencoded', category: 'urlencoded', schema: {} }],
    };
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/form',
      method: 'POST',
      debugModel: urlencodedModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        formFields: Object.fromEntries([
          ['padded', '  value  '],
          ['clear', ''],
          ['optional', ''],
          ['__proto__', ''],
        ]),
        formFieldNamesToIncludeWhenEmpty: ['clear', '__proto__'],
        selectedContentType: 'application/x-www-form-urlencoded',
      },
    });

    expect(result.body).toBe('padded=%20%20value%20%20&clear=&__proto__=');
  });

  test('multipart preview includes explicitly empty fields but omits untouched empty schema fields', () => {
    const multipartModel: OperationDebugModel = {
      ...debugModel,
      bodyContents: [{ mediaType: 'multipart/form-data', category: 'multipart', schema: {} }],
    };
    const result = buildRequest({
      baseUrl: 'http://localhost:8080',
      path: '/upload',
      method: 'POST',
      debugModel: multipartModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        formFields: Object.fromEntries([
          ['padded', '  value  '],
          ['clear', ''],
          ['optional', ''],
          ['__proto__', ''],
        ]),
        formFieldNamesToIncludeWhenEmpty: ['clear', '__proto__'],
        selectedContentType: 'multipart/form-data',
      },
    });

    expect(result.body).toBe('{"padded":"  value  ","clear":"","__proto__":""}');
  });
});

// ─── buildCurl ────────────────────────────────────────

describe('buildCurl', () => {
  test('generates curl for GET request', () => {
    const curl = buildCurl({
      url: 'http://localhost:8080/users/42?page=1',
      method: 'GET',
      headers: { Authorization: 'Bearer tok' },
      query: { page: '1' },
      contentType: '',
    });

    expect(curl).toContain('curl');
    expect(curl).toContain('-X');
    expect(curl).toContain('GET');
    expect(curl).toContain('Authorization: Bearer tok');
    expect(curl).toContain("'http://localhost:8080/users/42?page=1'");
  });

  test('generates curl for POST request with body', () => {
    const curl = buildCurl({
      url: 'http://localhost:8080/users',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      query: {},
      body: '{"name":"test"}',
      contentType: 'application/json',
    });

    expect(curl).toContain('-X');
    expect(curl).toContain('POST');
    expect(curl).toContain('-d');
    expect(curl).toContain('"name":"test"');
  });

  test('escapes single quotes in body', () => {
    const curl = buildCurl({
      url: 'http://localhost:8080/echo',
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      query: {},
      body: "it's a test",
      contentType: 'text/plain',
    });

    expect(curl).toContain("it'\\''s a test");
  });

  test('shell-quotes headers and allowReserved URLs as complete arguments', () => {
    const curl = buildCurl({
      url: "https://api.example.test/items?q=it's$(printf injected)",
      method: 'GET',
      headers: { Cookie: "session=a; token=$(printf injected); note=it's" },
      query: {},
      contentType: '',
    });

    expect(curl).toContain("'Cookie: session=a; token=$(printf injected); note=it'\\''s'");
    expect(curl).toContain("'https://api.example.test/items?q=it'\\''s$(printf injected)'");
    expect(curl).not.toContain('-H \\\n  Cookie:');
  });

  test('no -d flag when body is empty', () => {
    const curl = buildCurl({
      url: 'http://localhost:8080/items',
      method: 'GET',
      headers: {},
      query: {},
      contentType: '',
    });

    expect(curl).not.toContain('-d');
  });

  test('generates a binary-file placeholder without serializing file contents', () => {
    const curl = buildCurl({
      url: 'http://localhost:8080/avatar',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      query: {},
      binaryBodyFileName: "avatar's.png",
      contentType: 'image/png',
    });

    expect(curl).toContain('--data-binary');
    expect(curl).toContain("'@/path/to/avatar'\\''s.png'");
    expect(curl).not.toContain('-d ');
  });

  test('multipart body emits -F entries and TODO comment (no -d)', () => {
    const curl = buildCurl({
      url: 'http://localhost:8080/upload',
      method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data', 'X-Trace': '1' },
      query: {},
      body: JSON.stringify({ name: 'alice', note: "it's fine" }),
      contentType: 'multipart/form-data',
    });

    expect(curl).toContain('-X');
    expect(curl).toContain('POST');
    expect(curl).not.toContain('-d');
    // content-type 不应出现在 curl 命令中（由 curl 自动生成）
    expect(curl).not.toContain('Content-Type: multipart/form-data');
    expect(curl).toMatch(/-F[\s\\]+'name=alice'/);
    expect(curl).toMatch(/-F[\s\\]+'note=it'\\''s fine'/);
    expect(curl).toContain('TODO append file fields');
    // 其他 header 仍保留
    expect(curl).toContain('X-Trace: 1');
  });

  test('keeps non-form-data legacy multipart on the pre-existing raw curl path', () => {
    const curl = buildCurl({
      url: 'http://localhost:8080/upload',
      method: 'POST',
      headers: { 'Content-Type': 'multipart/mixed' },
      query: {},
      body: '{"legacy":"body"}',
      contentType: 'multipart/mixed',
    });

    expect(curl).toContain("-H \\\n  'Content-Type: multipart/mixed'");
    expect(curl).toContain('-d \\\n  \'{"legacy":"body"}\'');
    expect(curl).not.toContain('-F');
    expect(curl).not.toContain('TODO append file fields');
  });

  test('does not classify a legacy media type parameter value as multipart/form-data', () => {
    const contentType = 'application/example; profile="multipart/form-data"';
    const curl = buildCurl({
      url: 'http://localhost:8080/upload',
      method: 'POST',
      headers: { 'Content-Type': contentType },
      query: {},
      body: 'legacy body',
      contentType,
    });

    expect(curl).toContain(`Content-Type: ${contentType}`);
    expect(curl).toContain("-d \\\n  'legacy body'");
    expect(curl).not.toContain('-F');
  });

  test('multipart body emits an explicitly empty field from the final request body', () => {
    const curl = buildCurl({
      url: 'http://localhost:8080/upload',
      method: 'POST',
      headers: {},
      query: {},
      body: JSON.stringify({ clear: '' }),
      contentType: 'multipart/form-data',
    });

    expect(curl).toMatch(/-F[\s\\]+'clear='/);
  });

  test('multipart body emits an explicitly empty __proto__ field', () => {
    const curl = buildCurl({
      url: 'http://localhost:8080/upload',
      method: 'POST',
      headers: {},
      query: {},
      body: JSON.stringify(Object.fromEntries([['__proto__', '']])),
      contentType: 'multipart/form-data',
    });

    expect(curl).toMatch(/-F[\s\\]+'__proto__='/);
  });
});
// ─── sourceMap 追踪测试 (TASK-031) ─────────────────────

describe('buildRequest sourceMap', () => {
  const baseModel: OperationDebugModel = {
    pathParams: [],
    queryParams: [],
    headerParams: [],
    cookieParams: [],
    bodyContents: [],
    bodyRequired: false,
  };

  const baseForm: DebugFormValues = {
    pathParams: {},
    queryParams: {},
    headerParams: {},
    cookieParams: {},
  };

  test('no sourceMap when auth and globalParams are undefined', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: baseForm,
    });
    expect(result.sourceMap).toBeUndefined();
  });

  test('sourceMap generated when auth is provided', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: baseForm,
      auth: { bearerToken: 'mytoken' },
    });
    expect(result.sourceMap).toBeDefined();
    expect(result.sourceMap!.headers['Authorization']).toBe('auth');
    expect(result.headers['Authorization']).toBe('Bearer mytoken');
  });

  test('sourceMap generated when globalParams is provided', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: baseForm,
      globalParams: { headers: { 'X-Global': 'val' }, queries: { gq: '1' } },
    });
    expect(result.sourceMap).toBeDefined();
    expect(result.sourceMap!.headers['X-Global']).toBe('global');
    expect(result.sourceMap!.query['gq']).toBe('global');
  });

  test('application params are used as the lowest-priority fallback', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: baseForm,
      applicationParams: { headers: { 'X-Shared': 'application' }, queries: { shared: 'application' } },
    });

    expect(result.headers).toEqual({ 'X-Shared': 'application' });
    expect(result.query).toEqual({ shared: 'application' });
    expect(result.sourceMap).toEqual({
      headers: { 'X-Shared': 'application' },
      query: { shared: 'application' },
    });
  });

  test('auth overrides application params', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: baseForm,
      applicationParams: {
        headers: { authorization: 'ApplicationAuth' },
        queries: { api_key: 'application' },
      },
      auth: {
        bearerToken: 'auth-token',
        bySecurityKey: {
          queryKey: { type: 'apiKey', in: 'query', name: 'api_key', value: 'auth' },
        },
      },
    });

    expect(result.headers).toEqual({ Authorization: 'Bearer auth-token' });
    expect(result.query.api_key).toBe('auth');
    expect(result.sourceMap!.headers).toEqual({ Authorization: 'auth' });
    expect(result.sourceMap!.query.api_key).toBe('auth');
  });

  test('four layers use application < auth < global < interface priority', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: {
        ...baseForm,
        headerParams: { 'x-priority': 'interface' },
        queryParams: { priority: 'interface' },
      },
      applicationParams: { headers: { 'X-PRIORITY': 'application' }, queries: { priority: 'application' } },
      auth: {
        apiKeys: { 'X-Priority': 'auth' },
        bySecurityKey: {
          queryKey: { type: 'apiKey', in: 'query', name: 'priority', value: 'auth' },
        },
      },
      globalParams: { headers: { 'x-Priority': 'global' }, queries: { priority: 'global' } },
    });

    expect(result.headers).toEqual({ 'x-priority': 'interface' });
    expect(result.query).toEqual({ priority: 'interface' });
    expect(result.sourceMap!.headers).toEqual({ 'x-priority': 'interface' });
    expect(result.sourceMap!.query).toEqual({ priority: 'interface' });
  });

  test('global group params override auth in headers and query', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: baseForm,
      auth: {
        bearerToken: 'mytoken',
        bySecurityKey: {
          queryKey: { type: 'apiKey', in: 'query', name: 'api_key', value: 'auth' },
        },
      },
      globalParams: { headers: { Authorization: 'GlobalAuth' }, queries: { api_key: 'global' } },
    });

    expect(result.sourceMap!.headers['Authorization']).toBe('global');
    expect(result.headers['Authorization']).toBe('GlobalAuth');
    expect(result.sourceMap!.query.api_key).toBe('global');
    expect(result.query.api_key).toBe('global');
  });

  test('header overrides remove stale differently-cased sourceMap keys', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: baseForm,
      applicationParams: { headers: { 'X-Token': 'application' }, queries: {} },
      auth: { apiKeys: { 'x-token': 'auth' } },
      globalParams: { headers: { 'X-TOKEN': 'global' }, queries: {} },
    });

    expect(result.headers).toEqual({ 'X-TOKEN': 'global' });
    expect(result.sourceMap!.headers).toEqual({ 'X-TOKEN': 'global' });
  });

  test('query names remain case-sensitive across all sources', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: { ...baseForm, queryParams: { token: 'interface' } },
      applicationParams: { headers: {}, queries: { token: 'application' } },
      auth: {
        bySecurityKey: {
          queryKey: { type: 'apiKey', in: 'query', name: 'Token', value: 'auth' },
        },
      },
      globalParams: { headers: {}, queries: { TOKEN: 'global' } },
    });

    expect(result.query).toEqual({ token: 'interface', Token: 'auth', TOKEN: 'global' });
    expect(result.sourceMap!.query).toEqual({ token: 'interface', Token: 'auth', TOKEN: 'global' });
  });

  test('basic auth generates sourceMap with auth source', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: baseForm,
      auth: { basicCredentials: 'dXNlcjpwYXNz' },
    });
    expect(result.sourceMap!.headers['Authorization']).toBe('auth');
    expect(result.headers['Authorization']).toBe('Basic dXNlcjpwYXNz');
  });

  test('apiKey auth generates sourceMap', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: baseForm,
      auth: { apiKeys: { 'X-API-Key': 'abc123' } },
    });
    expect(result.sourceMap!.headers['X-API-Key']).toBe('auth');
    expect(result.headers['X-API-Key']).toBe('abc123');
  });

  test('empty auth and globalParams still generates sourceMap', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: baseForm,
      auth: {},
      globalParams: { headers: {}, queries: {} },
    });
    // sourceMap generated because auth !== undefined
    expect(result.sourceMap).toBeDefined();
    expect(Object.keys(result.sourceMap!.headers)).toHaveLength(0);
    expect(Object.keys(result.sourceMap!.query)).toHaveLength(0);
  });

  test('interface empty value does not mark as interface source', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: {
        ...baseForm,
        headerParams: { 'X-Empty': '' },
      },
      auth: { bearerToken: 'mytoken' },
    });
    // Empty string interface header should not override auth
    expect(result.sourceMap!.headers['X-Empty']).toBeUndefined();
    expect(result.sourceMap!.headers['Authorization']).toBe('auth');
  });

  test('authToHeaders returns { headers, queries }', () => {
    const result = authToHeaders({ bearerToken: 'tok' });
    expect(result.headers).toBeDefined();
    expect(result.queries).toBeDefined();
    expect(result.headers['Authorization']).toBe('Bearer tok');
    expect(Object.keys(result.queries)).toHaveLength(0);
  });
});

describe('OAS 3.1 parameter request snapshots', () => {
  const model: OperationDebugModel = {
    pathParams: [
      {
        name: 'id',
        in: 'path',
        required: true,
        type: 'integer',
        schema: { type: 'integer' },
        parameterSerialization: { kind: 'schema', style: 'simple', explode: false, allowReserved: false },
      },
    ],
    queryParams: [
      {
        name: 'filter',
        in: 'query',
        required: false,
        type: 'object',
        schema: { type: 'object' },
        parameterSerialization: { kind: 'schema', style: 'deepObject', explode: true, allowReserved: false },
      },
    ],
    headerParams: [
      {
        name: 'X-Ids',
        in: 'header',
        required: false,
        type: 'array',
        schema: { type: 'array' },
        parameterSerialization: { kind: 'schema', style: 'simple', explode: false, allowReserved: false },
      },
    ],
    cookieParams: [
      {
        name: 'session',
        in: 'cookie',
        required: false,
        type: 'array',
        schema: { type: 'array' },
        parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
      },
    ],
    bodyContents: [],
    bodyRequired: false,
  };

  test('uses one serialized result for URL preview, headers, query data, and cURL', () => {
    const built = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/items/{id}',
      method: 'GET',
      debugModel: model,
      formValues: {
        pathParams: {},
        queryParams: { extra: 'x' },
        headerParams: {},
        cookieParams: {},
        oas31ParameterValues: {
          'path:id': '42',
          'query:filter': '{"role":"admin","label":"你好"}',
          'header:X-Ids': '[1,2]',
          'cookie:session': '["a","b"]',
        },
      },
    });

    expect(built.url).toBe(
      'https://api.example.test/items/42?extra=x&filter%5Brole%5D=admin&filter%5Blabel%5D=%E4%BD%A0%E5%A5%BD',
    );
    expect(built.query).toEqual({ extra: 'x', 'filter[role]': 'admin', 'filter[label]': '你好' });
    expect(built.headers).toMatchObject({ 'X-Ids': '1,2', Cookie: 'session=a; session=b' });
    expect(built.hasExplicitCookieParameters).toBe(true);
    expect(buildCurl(built)).toContain(`'${built.url}'`);
    expect(built.parameterInstances).toEqual([
      expect.objectContaining({ key: 'path:id', instance: 42 }),
      expect.objectContaining({ key: 'query:filter', instance: { role: 'admin', label: '你好' } }),
      expect.objectContaining({ key: 'header:X-Ids', instance: [1, 2] }),
      expect.objectContaining({ key: 'cookie:session', instance: ['a', 'b'] }),
    ]);
  });

  test('keeps the exact raw fallback snapshot for an explicit invalid-JSON override', () => {
    const arrayModel: OperationDebugModel = {
      ...model,
      pathParams: [],
      headerParams: [],
      cookieParams: [],
      queryParams: [
        {
          name: 'ids',
          in: 'query',
          required: false,
          type: 'array',
          schema: { type: 'array' },
          parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
        },
      ],
    };
    const built = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/items',
      method: 'GET',
      debugModel: arrayModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        oas31ParameterValues: { 'query:ids': '[broken' },
      },
    });

    expect(built.url).toBe('https://api.example.test/items?ids=%5Bbroken');
    expect(built.parameterInputDiagnostics).toEqual([
      expect.objectContaining({ key: 'query:ids', kind: 'invalid-json' }),
    ]);
  });

  test('keeps declared exploded query and cookie names above custom values', () => {
    const explodedModel: OperationDebugModel = {
      ...model,
      pathParams: [],
      headerParams: [],
      queryParams: [
        {
          name: 'filter',
          in: 'query',
          required: false,
          type: 'object',
          schema: { type: 'object' },
          parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
        },
      ],
      cookieParams: [
        {
          name: 'state',
          in: 'cookie',
          required: false,
          type: 'object',
          schema: { type: 'object' },
          parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
        },
      ],
    };
    const built = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/items',
      method: 'GET',
      debugModel: explodedModel,
      formValues: {
        pathParams: {},
        queryParams: { R: 'custom', untouched: 'yes' },
        headerParams: {},
        cookieParams: { state: 'custom', theme: 'custom' },
        oas31ParameterValues: {
          'query:filter': '{"R":100}',
          'cookie:state': '{"theme":"dark"}',
        },
      },
    });

    expect(built.url).toBe('https://api.example.test/items?untouched=yes&R=100');
    expect(built.query).toEqual({ untouched: 'yes', R: '100' });
    expect(built.headers.Cookie).toBe('theme=dark');
  });

  test('keeps OAS 3.1 path and exploded query values above legacy and global sources', () => {
    const precedenceModel: OperationDebugModel = {
      ...model,
      queryParams: [
        {
          ...model.queryParams[0],
          parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
        },
      ],
    };
    const built = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/items/{id}',
      method: 'GET',
      debugModel: precedenceModel,
      formValues: {
        pathParams: { id: 'legacy' },
        queryParams: { filter: 'legacy', role: 'legacy' },
        headerParams: {},
        cookieParams: {},
        oas31ParameterValues: {
          'path:id': '42',
          'query:filter': '{"role":"interface"}',
        },
      },
      globalParams: { headers: {}, queries: { filter: 'global', role: 'global' } },
    });

    expect(built.url).toBe('https://api.example.test/items/42?role=interface');
    expect(built.query).toEqual({ role: 'interface' });
    expect(built.sourceMap?.query).toEqual({ role: 'interface' });
  });

  test('treats an explicitly included empty OAS 3.1 string as present', () => {
    const requiredModel: OperationDebugModel = {
      ...model,
      pathParams: [],
      headerParams: [],
      cookieParams: [],
      queryParams: [
        {
          name: 'q',
          in: 'query',
          required: true,
          type: 'string',
          schema: { type: 'string' },
          parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
        },
      ],
    };
    expect(
      validateRequired(requiredModel, {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        oas31ParameterValues: { 'query:q': '' },
      }),
    ).toEqual([]);
  });

  test('keeps an explicitly included empty OAS 3.1 header in the shared request snapshot', () => {
    const emptyHeaderModel: OperationDebugModel = {
      ...model,
      pathParams: [],
      queryParams: [],
      cookieParams: [],
      headerParams: [
        {
          name: 'X-Optional',
          in: 'header',
          required: false,
          type: 'string',
          schema: { type: 'string' },
          parameterSerialization: { kind: 'schema', style: 'simple', explode: false, allowReserved: false },
        },
      ],
    };
    const built = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/items',
      method: 'GET',
      debugModel: emptyHeaderModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: {},
        cookieParams: {},
        oas31ParameterValues: { 'header:X-Optional': '' },
      },
      globalParams: { headers: { 'x-optional': 'global' }, queries: {} },
    });

    expect(built.headers).toEqual({ 'X-Optional': '' });
    expect(built.sourceMap?.headers).toEqual({ 'X-Optional': 'interface' });
    expect(buildCurl(built)).toContain('X-Optional: ');
  });

  test('omits an empty composite header and consumes lower-priority values with the same name', () => {
    const emptyHeaderModel: OperationDebugModel = {
      ...model,
      pathParams: [],
      queryParams: [],
      cookieParams: [],
      headerParams: [
        {
          name: 'X-Ids',
          in: 'header',
          required: false,
          type: 'array',
          schema: { type: 'array' },
          parameterSerialization: { kind: 'schema', style: 'simple', explode: false, allowReserved: false },
        },
      ],
    };
    const built = buildRequest({
      baseUrl: 'https://api.example.test',
      path: '/items',
      method: 'GET',
      debugModel: emptyHeaderModel,
      formValues: {
        pathParams: {},
        queryParams: {},
        headerParams: { 'x-ids': 'legacy' },
        cookieParams: {},
        oas31ParameterValues: { 'header:X-Ids': '[]' },
      },
      auth: { apiKeys: { 'X-Ids': 'auth' } },
      globalParams: { headers: { 'X-IDS': 'global' }, queries: {} },
    });

    expect(built.headers).toEqual({});
    expect(built.sourceMap?.headers).toEqual({});
  });

  test('blocks request construction when the document contract is invalid', () => {
    expect(() =>
      buildRequest({
        baseUrl: 'https://api.example.test',
        path: '/items',
        method: 'GET',
        debugModel: {
          ...model,
          parameterDiagnostics: [
            {
              key: 'query:filter',
              name: 'filter',
              in: 'query',
              code: 'SCHEMA_CONTENT_CONFLICT',
              message: 'schema/content conflict',
            },
          ],
        },
        formValues: { pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} },
      }),
    ).toThrow('schema/content conflict');
  });
});
