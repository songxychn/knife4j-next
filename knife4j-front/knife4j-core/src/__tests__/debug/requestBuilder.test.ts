import {
  authToHeaders,
  buildCurl,
  buildQueryString,
  buildRequest,
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

  test('multipart body: ok when at least one file uploaded', () => {
    const multipartModel: OperationDebugModel = {
      pathParams: [],
      queryParams: [],
      headerParams: [],
      cookieParams: [],
      bodyContents: [{ mediaType: 'multipart/form-data', category: 'multipart', schema: {} }],
      bodyRequired: true,
    };
    const form: DebugFormValues = {
      pathParams: {},
      queryParams: {},
      headerParams: {},
      cookieParams: {},
      selectedContentType: 'multipart/form-data',
      formFields: {},
      fileFields: { file: [new Uint8Array([1, 2, 3])] },
    };
    const errors = validateRequired(multipartModel, form);
    expect(errors.filter((e) => e.in === 'body')).toHaveLength(0);
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

  test('interface overrides global and auth in sourceMap', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: {
        ...baseForm,
        headerParams: { Authorization: 'Custom Token' },
        queryParams: { gq: '2' },
      },
      auth: { bearerToken: 'mytoken' },
      globalParams: { headers: { 'X-Global': 'val' }, queries: { gq: '1' } },
    });
    // Auth sets Authorization=auth, but interface overrides it
    expect(result.sourceMap!.headers['Authorization']).toBe('interface');
    expect(result.sourceMap!.query['gq']).toBe('interface');
    // Global header should still be 'global'
    expect(result.sourceMap!.headers['X-Global']).toBe('global');
  });

  test('global overrides auth in sourceMap', () => {
    const result = buildRequest({
      baseUrl: 'http://localhost',
      path: '/api/test',
      method: 'GET',
      debugModel: baseModel,
      formValues: baseForm,
      auth: { bearerToken: 'mytoken' },
      globalParams: { headers: { Authorization: 'GlobalAuth' }, queries: {} },
    });
    // Global overrides auth for Authorization header
    expect(result.sourceMap!.headers['Authorization']).toBe('global');
    expect(result.headers['Authorization']).toBe('GlobalAuth');
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
