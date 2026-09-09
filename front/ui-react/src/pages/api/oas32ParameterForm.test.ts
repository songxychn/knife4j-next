import { describe, expect, test } from 'vitest';
import {
  assertOas32BrowserRequest,
  buildOperationDebugModel,
  buildRequest,
  collectOas32DocumentDiagnostics,
  Oas32ParameterRequestError,
  type DebugFormValues,
} from 'knife4j-core';
import {
  collectResolvedOas32ParameterInputs,
  oas32BrowserSendDiagnostics,
  oas32EntriesFromSerializedExamples,
  oas32QuerystringParameter,
  previewOas32DisplayPath,
  resolveOas32ParameterEntries,
  restoreOas32ParameterEntries,
  serializedExampleParametersFromEntries,
} from './oas32ParameterForm';
import { effectiveCookieParameterSource } from './cookieParameterSource';
import { filterRequiredErrorsForCookieSource, isBrowserSessionParameter } from './oas31ParameterForm';

const emptyForm = (): DebugFormValues => ({ pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} });

function model(parameters: Record<string, unknown>[], path = '/items/{id}/{+id}') {
  const doc = {
    openapi: '3.2.0',
    info: { title: 'Form fixture', version: '1' },
    paths: { [path]: { get: { parameters, responses: { '200': { description: 'ok' } } } } },
  };
  expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
  return buildOperationDebugModel({ doc, path, method: 'GET' });
}

describe('OAS 3.2 debug form binding', () => {
  test('replaces {id} and {+id} as distinct literal names', () => {
    const current = model([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: '+id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    expect(
      previewOas32DisplayPath(
        '/items/{id}/{+id}',
        current.oas32Parameters!,
        {},
        { 'path:id': '0', 'path:+id': '1' },
        { 'path:id': true, 'path:+id': true },
        'explicit',
        0,
      ),
    ).toBe('/items/0/1');
  });

  test('keeps empty querystring text present and reports query source conflicts', () => {
    const current = model(
      [
        {
          name: 'whole',
          in: 'querystring',
          required: true,
          content: { 'text/plain': { schema: { type: 'string' } } },
        },
      ],
      '/search',
    );
    expect(oas32QuerystringParameter(current.oas32Parameters)?.key).toBe('querystring:whole');
    const inputs = collectResolvedOas32ParameterInputs(
      current.oas32Parameters!,
      { 'querystring:whole': { kind: 'media', text: '', enabled: true } },
      {},
      {},
      'explicit',
      1,
    );
    const built = buildRequest({
      baseUrl: 'https://example.test',
      path: '/search',
      method: 'GET',
      debugModel: current,
      formValues: { ...emptyForm(), oas32ParameterInputs: inputs },
    });
    expect(built.url).toBe('https://example.test/search?');
    expect(built.parameterPresence).toEqual({ 'querystring:whole': true });
    expect(() =>
      buildRequest({
        baseUrl: 'https://example.test',
        path: '/search',
        method: 'GET',
        debugModel: current,
        formValues: {
          ...emptyForm(),
          oas32ParameterInputs: inputs,
          queryParams: { extra: '1' },
        },
      }),
    ).toThrow(Oas32ParameterRequestError);
  });

  test('cookie session values stay unknown while explicit cookies remain previewable', () => {
    const current = model(
      [{ name: 'SID', in: 'cookie', style: 'cookie', schema: { type: 'array', items: { type: 'string' } } }],
      '/session',
    );
    const cookie = current.cookieParams[0];
    expect(isBrowserSessionParameter(cookie, 'browser-session')).toBe(false);
    expect(isBrowserSessionParameter(cookie, 'browser-session', { declaredCookies: true })).toBe(true);
    expect(effectiveCookieParameterSource(true, 'browser-session')).toBe('browser-session');
    const sessionInputs = collectResolvedOas32ParameterInputs(
      current.oas32Parameters!,
      { 'cookie:SID': { kind: 'parameter', text: 'SID=x; SID=y%2F', enabled: true } },
      { 'cookie:SID': 'SID=x; SID=y%2F' },
      { 'cookie:SID': true },
      'browser-session',
      2,
    );
    const sessionRequest = buildRequest({
      baseUrl: 'https://example.test',
      path: '/session',
      method: 'GET',
      debugModel: current,
      formValues: { ...emptyForm(), oas32ParameterInputs: sessionInputs },
    });
    expect(sessionRequest.headers).not.toHaveProperty('Cookie');
    expect(sessionRequest.oas32ParameterPlan?.presence['cookie:SID']).toBe('unknown');
    expect(assertOas32BrowserRequest.length).toBe(1);
    expect(oas32BrowserSendDiagnostics(sessionRequest)).toEqual([]);
    expect(
      filterRequiredErrorsForCookieSource(
        current,
        [{ name: 'SID', in: 'cookie', key: 'cookie:SID', message: 'required' }],
        'browser-session',
        { declaredCookies: true },
      ),
    ).toEqual([]);

    const explicit = buildRequest({
      baseUrl: 'https://example.test',
      path: '/session',
      method: 'GET',
      debugModel: current,
      formValues: {
        ...emptyForm(),
        oas32ParameterInputs: collectResolvedOas32ParameterInputs(
          current.oas32Parameters!,
          { 'cookie:SID': { kind: 'parameter', text: 'SID=x; SID=y%2F', enabled: true } },
          {},
          { 'cookie:SID': true },
          'explicit',
          2,
        ),
      },
    });
    expect(explicit.headers.Cookie).toBe('SID=x; SID=y%2F');
    expect(oas32BrowserSendDiagnostics(explicit).some((diagnostic) => diagnostic.blocks === 'browser')).toBe(true);
  });

  test('restores editable entries without decoded instances or schema sessions', () => {
    const restored = restoreOas32ParameterEntries(
      {
        'querystring:whole': {
          kind: 'media',
          text: '',
          enabled: true,
          provenance: { id: 'stale', layer: 'media', session: { current: true } },
        },
      },
      { 'path:id': { text: '0', layer: 'parameter', instance: 'stale' } },
    );
    expect(restored).toEqual({
      'path:id': { kind: 'parameter', text: '0', enabled: true },
      'querystring:whole': { kind: 'media', text: '', enabled: true },
    });
    expect(serializedExampleParametersFromEntries(restored)).toEqual({
      'path:id': { text: '0', layer: 'parameter' },
      'querystring:whole': { text: '', layer: 'media' },
    });
    expect(oas32EntriesFromSerializedExamples({ 'header:X': { text: 'a', layer: 'media' } })).toEqual({
      'header:X': { kind: 'media', text: 'a', enabled: true },
    });
  });

  test('does not invent a querystring editor from the query param table', () => {
    const current = model(
      [
        {
          name: 'whole',
          in: 'querystring',
          content: { 'text/plain': { schema: { type: 'string' } } },
        },
      ],
      '/search',
    );
    expect(
      resolveOas32ParameterEntries(
        current.oas32Parameters!,
        {},
        { 'querystring:whole': 'should-not-bind' },
        { 'querystring:whole': true },
      ),
    ).toEqual({});
  });
});
