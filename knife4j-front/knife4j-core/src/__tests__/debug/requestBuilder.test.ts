import {
  replacePathParams,
  buildQueryString,
  mergeHeaders,
  authToHeaders,
  splitGlobalParams,
  validateRequired,
  buildRequest,
  buildCurl,
} from '../../debug/requestBuilder';
import type { OperationDebugModel, DebugFormValues, AuthValues, GlobalParamValues } from '../../debug/types';

// ─── replacePathParams ────────────────────────────────

describe('replacePathParams', () => {
  test('replaces single path param', () => {
    expect(replacePathParams('/users/{id}', { id: '42' })).toBe('/users/42');
  });

  test('replaces multiple path params', () => {
    expect(replacePathParams('/users/{userId}/posts/{postId}', { userId: '1', postId: '99' }))
      .toBe('/users/1/posts/99');
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
    const result = mergeHeaders(
      { 'Authorization': 'Bearer xxx' },
      { 'Content-Type': 'application/json' },
    );
    expect(result).toEqual({
      'Authorization': 'Bearer xxx',
      'Content-Type': 'application/json',
    });
  });

  test('later sources override earlier ones', () => {
    const result = mergeHeaders(
      { 'X-Token': 'old' },
      { 'X-Token': 'new' },
    );
    expect(result['X-Token']).toBe('new');
  });

  test('skips undefined and empty string values', () => {
    const result = mergeHeaders(
      { 'A': 'a', 'B': '', 'C': 'c' },
      undefined,
    );
    expect(result).toEqual({ 'A': 'a', 'C': 'c' });
  });

  test('handles all undefined sources', () => {
    expect(mergeHeaders(undefined, undefined)).toEqual({});
  });
});

// ─── authToHeaders ────────────────────────────────────

describe('authToHeaders', () => {
  test('bearer token', () => {
    const result = authToHeaders({ bearerToken: 'mytoken' });
    expect(result['Authorization']).toBe('Bearer mytoken');
  });

  test('basic credentials', () => {
    const result = authToHeaders({ basicCredentials: 'dXNlcjpwYXNz' });
    expect(result['Authorization']).toBe('Basic dXNlcjpwYXNz');
  });

  test('basic overrides bearer when both present', () => {
    const result = authToHeaders({ bearerToken: 'tok', basicCredentials: 'dXNlcjpwYXNz' });
    expect(result['Authorization']).toBe('Basic dXNlcjpwYXNz');
  });

  test('api keys', () => {
    const result = authToHeaders({ apiKeys: { 'X-API-Key': 'key123' } });
    expect(result['X-API-Key']).toBe('key123');
  });

  test('empty auth returns empty headers', () => {
    expect(authToHeaders(undefined)).toEqual({});
  });
});

// ─── splitGlobalParams ────────────────────────────────

describe('splitGlobalParams', () => {
  test('splits headers and queries', () => {
    const gp: GlobalParamValues = {
      headers: { 'X-Token': 'global-token' },
      queries: { 'lang': 'zh' },
    };
    const result = splitGlobalParams(gp);
    expect(result.headers).toEqual({ 'X-Token': 'global-token' });
    expect(result.queries).toEqual({ 'lang': 'zh' });
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

  test('reports missing required path param', () => {
    const form: DebugFormValues = {
      pathParams: { id: '' },
      queryParams: {},
      headerParams: { 'X-Auth': 'token' },
      cookieParams: {},
      body: '{}',
    };
    const errors = validateRequired(model, form);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'id', in: 'path' }),
      ]),
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
      expect.arrayContaining([
        expect.objectContaining({ name: 'X-Auth', in: 'header' }),
      ]),
    );
  });

  test('reports missing required body', () => {
    const form: DebugFormValues = {
      pathParams: { id: '1' },
      queryParams: {},
      headerParams: { 'X-Auth': 'token' },
      cookieParams: {},
      body: '',
    };
    const errors = validateRequired(model, form);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'requestBody', in: 'body' }),
      ]),
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
        queries: { 'lang': 'zh', 'verbose': 'false' },
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
      headers: { 'Authorization': 'Bearer tok' },
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
});

