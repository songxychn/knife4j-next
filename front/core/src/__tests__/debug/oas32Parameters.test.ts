import { buildOperationDebugModel } from '../../debug/operationDebugModel';
import { buildRequest } from '../../debug/requestBuilder';
import { collectOas32DocumentDiagnostics } from '../../openapi32';
import type { DebugFormValues } from '../../debug/types';

const emptyForm = (): DebugFormValues => ({ pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} });
const documentWith = (parameters: Record<string, unknown>[], openapi = '3.2.0', path = '/items') => ({
  openapi,
  info: { title: 'Normative parameter fixture', version: '1' },
  paths: { [path]: { get: { parameters, responses: { '200': { description: 'Synthetic response' } } } } },
});

describe('OAS 3.2 parameter execution baseline', () => {
  test('substitutes exact path variable names including reserved characters', () => {
    const path = '/items/{id}/{+id}/{?}/{#}/{%}';
    const names = ['id', '+id', '?', '#', '%'];
    const doc = documentWith(
      names.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      '3.2.0',
      path,
    );
    expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
    const debugModel = buildOperationDebugModel({ doc, path, method: 'GET' });
    const request = buildRequest({
      baseUrl: 'https://example.test',
      path,
      method: 'GET',
      debugModel,
      formValues: { ...emptyForm(), pathParams: Object.fromEntries(names.map((name, i) => [name, String(i)])) },
    });
    expect(request.url).toBe('https://example.test/items/0/1/2/3/4');
  });
  test.each(['3.2.0', '3.2.99'])('preserves the whole query component for %s', (version) => {
    const doc = documentWith(
      [
        {
          name: 'search',
          in: 'querystring',
          content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } },
        },
      ],
      version,
    );
    expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
    const debugModel = buildOperationDebugModel({ doc, path: '/items', method: 'GET' });
    const request = buildRequest({
      baseUrl: 'https://example.test',
      path: '/items',
      method: 'GET',
      debugModel,
      formValues: {
        ...emptyForm(),
        serializedExampleParameters: { 'querystring:search': { text: 'a=1&a=2&x=%2B+y', layer: 'parameter' } },
      },
    });
    expect(request.url).toBe('https://example.test/items?a=1&a=2&x=%2B+y');
  });

  test('uses reserved expansion in path without introducing URL component separators', () => {
    const doc = documentWith(
      [{ name: 'id', in: 'path', required: true, allowReserved: true, schema: { type: 'string' } }],
      '3.2.0',
      '/items/{id}',
    );
    expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
    const debugModel = buildOperationDebugModel({ doc, path: '/items/{id}', method: 'GET' });
    const request = buildRequest({
      baseUrl: 'https://example.test',
      path: '/items/{id}',
      method: 'GET',
      debugModel,
      formValues: { ...emptyForm(), oas31ParameterValues: { 'path:id': 'a:b/%2F?#' } },
    });
    expect(request.url).toBe('https://example.test/items/a:b%2F%2F%3F%23');
  });

  test('preserves ordered repeated Cookie pairs in author parameter text', () => {
    const doc = documentWith([
      { name: 'SID', in: 'cookie', style: 'cookie', schema: { type: 'array', items: { type: 'string' } } },
    ]);
    expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
    const debugModel = buildOperationDebugModel({ doc, path: '/items', method: 'GET' });
    const request = buildRequest({
      baseUrl: 'https://example.test',
      path: '/items',
      method: 'GET',
      debugModel,
      formValues: {
        ...emptyForm(),
        serializedExampleParameters: { 'cookie:SID': { text: 'SID=x; SID=y%2F', layer: 'parameter' } },
      },
    });
    expect(request.headers.Cookie).toBe('SID=x; SID=y%2F');
    expect(request.hasExplicitCookieParameters).toBe(true);
  });

  test('does not declare the effective collection complete after dropping an unresolved reference', () => {
    const doc = documentWith([
      { name: 'search', in: 'querystring', content: { 'text/plain': { schema: { type: 'string' } } } },
      { $ref: 'https://schemas.example.test/parameters.json#/Query' },
    ]);
    const debugModel = buildOperationDebugModel({ doc, path: '/items', method: 'GET' });
    expect(() =>
      buildRequest({
        baseUrl: 'https://example.test',
        path: '/items',
        method: 'GET',
        debugModel,
        formValues: emptyForm(),
      }),
    ).toThrow(/incomplete|unavailable/i);
  });
});
