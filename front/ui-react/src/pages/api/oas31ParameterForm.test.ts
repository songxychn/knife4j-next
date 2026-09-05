import { describe, expect, test } from 'vitest';
import {
  buildRequest,
  replaceSerializedPathParams,
  serializeOas31Parameters,
  validateRequired,
  type DebugFormValues,
  type DebugParam,
  type OperationDebugModel,
} from 'knife4j-core';
import {
  buildInitialParamEnabled,
  collectOas31ParameterValues,
  filterRequiredErrorsForCookieSource,
  isNullableOas31Parameter,
  isOas31RequiredParameterError,
} from './oas31ParameterForm';
import { effectiveCookieParameterSource, hasExplicitCookieHeader } from './cookieParameterSource';
import { browserRequestConstraint } from './browserRequestConstraints';
import { buildPreviewCurl } from './requestPreviewBuild';

function parameter(name: string, options: Partial<DebugParam> = {}): DebugParam {
  return {
    name,
    in: 'query',
    required: false,
    type: 'string',
    parameterSerialization: { kind: 'schema', style: 'form', explode: true, allowReserved: false },
    ...options,
  };
}

function model(parameters: DebugParam[]): OperationDebugModel {
  return {
    pathParams: [],
    queryParams: parameters,
    headerParams: [],
    cookieParams: [],
    bodyContents: [],
    bodyRequired: false,
  };
}

describe('OAS 3.1 parameter form snapshots', () => {
  test('keeps path display usable when browser-session mode ignores an unserializable saved Cookie', () => {
    const current = model([]);
    current.pathParams = [
      parameter('id', {
        in: 'path',
        required: true,
        parameterSerialization: { kind: 'schema', style: 'simple', explode: false, allowReserved: false },
      }),
    ];
    current.cookieParams = [
      parameter('session', { in: 'cookie', type: 'array', schema: { type: 'array', items: { type: 'string' } } }),
    ];
    const values = { 'path:id': 'abc', 'cookie:session': '[{"nested":true}]' };
    expect(() => serializeOas31Parameters(current, collectOas31ParameterValues(current, values, {}))).toThrow(
      'Nested array or object parameter values do not have a defined OAS serialization.',
    );
    const serialized = serializeOas31Parameters(
      current,
      collectOas31ParameterValues(current, values, {}, 'browser-session'),
    );
    expect(replaceSerializedPathParams('/resource/{id}', serialized.path)).toBe('/resource/abc');
    expect(serialized.cookies).toEqual([]);
    expect(serialized.instances.map((instance) => instance.key)).toEqual(['path:id']);
    expect(values['cookie:session']).toBe('[{"nested":true}]');
  });

  test('constructs a browser-session request without inventing Cookie presence or validating saved Cookie text', () => {
    const current = model([parameter('query')]);
    current.cookieParams = [
      parameter('session', {
        in: 'cookie',
        required: true,
        parameterSerialization: { kind: 'content', mediaType: 'application/json' },
      }),
    ];
    const values = { 'query:query': 'kept', 'cookie:session': '{invalid saved JSON' };
    const form: DebugFormValues = {
      pathParams: {},
      queryParams: {},
      headerParams: {},
      cookieParams: {},
      oas31ParameterValues: collectOas31ParameterValues(current, values, {}, 'browser-session'),
    };
    const built = buildRequest({
      baseUrl: 'https://fixture.test',
      path: '/protected',
      method: 'GET',
      debugModel: current,
      formValues: form,
    });
    expect(built.url).toBe('https://fixture.test/protected?query=kept');
    expect(built.headers).not.toHaveProperty('Cookie');
    expect(built.parameterInstances?.map((instance) => instance.key)).toEqual(['query:query']);
    expect(built.parameterInputDiagnostics).toBeUndefined();
    expect(built.parameterPresence).not.toHaveProperty('cookie:session');
    expect(validateRequired(current, form, built.parameterPresence).map((error) => error.key)).toEqual([
      'cookie:session',
    ]);
    expect(
      filterRequiredErrorsForCookieSource(
        current,
        validateRequired(current, form, built.parameterPresence),
        'browser-session',
      ),
    ).toEqual([]);
    expect(browserRequestConstraint(built.method, false, hasExplicitCookieHeader(built.headers))).toBeNull();
    const curl = buildPreviewCurl(built, 'browser-session', 'Cookies must be configured separately.');
    expect(curl).toMatch(/^# Cookies must be configured separately\.\ncurl/);
    expect(curl).toContain("'https://fixture.test/protected?query=kept'");
    expect(curl).not.toContain('Cookie:');

    const explicit = buildRequest({
      baseUrl: 'https://fixture.test',
      path: '/protected',
      method: 'GET',
      debugModel: current,
      formValues: { ...form, oas31ParameterValues: collectOas31ParameterValues(current, values, {}, 'explicit') },
    });
    expect(explicit.parameterInputDiagnostics?.[0].key).toBe('cookie:session');
    expect(browserRequestConstraint(explicit.method, false, explicit.hasExplicitCookieParameters)).toBe(
      'unsupported-cookie',
    );
    expect(buildPreviewCurl(explicit, 'explicit', 'unused')).toContain('Cookie: session=');
    expect(values['cookie:session']).toBe('{invalid saved JSON');
  });

  test('keeps unrelated required checks and legacy Cookie behavior when using a browser session', () => {
    const current = model([parameter('session', { required: true })]);
    current.cookieParams = [
      parameter('session', { in: 'cookie', required: true }),
      parameter('legacy', { in: 'cookie', required: true, parameterSerialization: undefined }),
    ];
    const errors = validateRequired(current, { pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} });
    expect(filterRequiredErrorsForCookieSource(current, errors, 'browser-session').map((error) => error.key)).toEqual([
      'query:session',
      'cookie:legacy',
    ]);
    expect(filterRequiredErrorsForCookieSource(current, errors, 'explicit')).toEqual(errors);
    expect(effectiveCookieParameterSource(false, 'browser-session')).toBe('explicit');
    expect(effectiveCookieParameterSource(true, undefined)).toBe('explicit');
  });

  test('detects explicit Cookie headers from custom headers and authentication without silently discarding them', () => {
    const current = model([]);
    const built = buildRequest({
      baseUrl: 'https://fixture.test',
      path: '/protected',
      method: 'GET',
      debugModel: current,
      formValues: { pathParams: {}, queryParams: {}, headerParams: { cookie: 'manual=value' }, cookieParams: {} },
      auth: {
        bySecurityKey: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session', value: 'manual-session' } },
      },
    });
    expect(built.headers.cookie).toContain('manual=value');
    expect(browserRequestConstraint(built.method, false, hasExplicitCookieHeader(built.headers))).toBe(
      'unsupported-cookie',
    );
    const authOnly = buildRequest({
      baseUrl: 'https://fixture.test',
      path: '/protected',
      method: 'GET',
      debugModel: current,
      formValues: { pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} },
      auth: {
        bySecurityKey: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session', value: 'manual-session' } },
      },
    });
    expect(authOnly.headers.Cookie).toBe('session=manual-session');
    expect(browserRequestConstraint(authOnly.method, false, hasExplicitCookieHeader(authOnly.headers))).toBe(
      'unsupported-cookie',
    );
    expect(hasExplicitCookieHeader({ CoOkIe: '' })).toBe(true);
    expect(hasExplicitCookieHeader({ 'X-Cookie': 'ordinary' })).toBe(false);
  });

  test('leaves a required browser-session Cookie unknown while collecting other explicit parameters', () => {
    const current = model([parameter('query')]);
    current.cookieParams = [parameter('session', { in: 'cookie', required: true })];
    const values = { 'query:query': 'kept', 'cookie:session': '' };
    const enabled = buildInitialParamEnabled(current, values);

    expect(collectOas31ParameterValues(current, values, enabled, 'browser-session')).toEqual({
      'query:query': 'kept',
    });
    expect(collectOas31ParameterValues(current, values, enabled)).toEqual(values);
    expect(current.cookieParams[0].required).toBe(true);
  });

  test('allows explicit required-parameter overrides without loosening legacy or body required checks', () => {
    const current = model([
      parameter('tags', { required: true }),
      parameter('legacy', { required: true, parameterSerialization: undefined }),
    ]);
    expect(isOas31RequiredParameterError(current, { name: 'tags', in: 'query', message: 'required' })).toBe(true);
    expect(isOas31RequiredParameterError(current, { name: 'legacy', in: 'query', message: 'required' })).toBe(false);
    expect(isOas31RequiredParameterError(current, { name: 'tags', in: 'body', message: 'required' })).toBe(false);
  });
  test('starts empty optional 3.1 parameters disabled while preserving legacy and required defaults', () => {
    const current = model([
      parameter('optional'),
      parameter('required', { required: true }),
      parameter('example'),
      parameter('legacy', { parameterSerialization: undefined }),
    ]);

    expect(
      buildInitialParamEnabled(current, {
        'query:optional': '',
        'query:required': '',
        'query:example': 'active',
        'query:legacy': '',
      }),
    ).toEqual({
      'query:optional': false,
      'query:required': true,
      'query:example': true,
      'query:legacy': true,
    });
  });

  test('distinguishes an enabled empty value from an omitted value in one request snapshot', () => {
    const current = model([
      parameter('empty'),
      parameter('omitted'),
      parameter('legacy', { parameterSerialization: undefined }),
    ]);
    expect(
      collectOas31ParameterValues(
        current,
        { 'query:empty': '', 'query:omitted': 'ignored', 'query:legacy': 'legacy-value' },
        { 'query:empty': true, 'query:omitted': false, 'query:legacy': true },
      ),
    ).toEqual({ 'query:empty': '' });
  });

  test('recognizes nullable OAS 3.1 type arrays without changing legacy controls', () => {
    expect(
      isNullableOas31Parameter(parameter('nullable', { type: 'boolean', schema: { type: ['boolean', 'null'] } })),
    ).toBe(true);
    expect(isNullableOas31Parameter(parameter('boolean', { type: 'boolean', schema: { type: 'boolean' } }))).toBe(
      false,
    );
    expect(
      isNullableOas31Parameter(
        parameter('legacy', {
          type: 'boolean',
          schema: { type: ['boolean', 'null'] },
          parameterSerialization: undefined,
        }),
      ),
    ).toBe(false);
  });
});
