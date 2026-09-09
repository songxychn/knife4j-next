import { describe, expect, test, vi } from 'vitest';
import {
  assertOas32BrowserRequest,
  buildOperationDebugModel,
  buildRequest,
  collectOas32DocumentDiagnostics,
  Oas32ParameterRequestError,
  type DebugFormValues,
} from 'knife4j-core';
import {
  discardUnsentDebugResponse,
  inspectUnsentBrowserSendFailure,
  schemaOverrideMayDispatch,
  unsentBrowserSendFailureTab,
} from './apiDebugBrowserSend';
import { collectResolvedOas32ParameterInputs } from './oas32ParameterForm';

const emptyForm = (): DebugFormValues => ({ pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} });

function cookieModel() {
  const doc = {
    openapi: '3.2.0',
    info: { title: 'Send fixture', version: '1' },
    paths: {
      '/session': {
        get: {
          parameters: [{ name: 'SID', in: 'cookie', style: 'cookie', schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
  expect(collectOas32DocumentDiagnostics(doc)).toEqual([]);
  return buildOperationDebugModel({ doc, path: '/session', method: 'GET' });
}

describe('unsent browser send failures', () => {
  test('skipSchemaValidation still hits explicit Cookie and method hard failures before Fetch', () => {
    const skipSchemaValidation = true;
    const current = cookieModel();
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
          1,
        ),
      },
    });
    const cookieFailure = inspectUnsentBrowserSendFailure({
      built: explicit,
      hasBodyInput: false,
      cookieSessionCapable: true,
      isOas32: true,
    });
    expect(cookieFailure).toEqual({ kind: 'unsupported-cookie', method: 'GET' });
    expect(unsentBrowserSendFailureTab(cookieFailure!)).toBe('cookie');
    expect(schemaOverrideMayDispatch(cookieFailure)).toBe(false);
    expect(skipSchemaValidation && schemaOverrideMayDispatch(cookieFailure)).toBe(false);
    expect(() => assertOas32BrowserRequest(explicit)).toThrow(Oas32ParameterRequestError);
    expect(() => assertOas32BrowserRequest(explicit)).toThrow(/Fetch controls or forbids header Cookie/);

    const methodFailure = inspectUnsentBrowserSendFailure({
      built: { ...explicit, method: 'TRACE', headers: {} },
      hasBodyInput: false,
      cookieSessionCapable: true,
      isOas32: true,
    });
    expect(methodFailure?.kind).toBe('unsupported-method');
    expect(skipSchemaValidation && schemaOverrideMayDispatch(methodFailure)).toBe(false);

    const bodyFailure = inspectUnsentBrowserSendFailure({
      built: explicit,
      hasBodyInput: true,
      cookieSessionCapable: true,
      isOas32: true,
    });
    expect(bodyFailure?.kind).toBe('unsupported-body');
    expect(unsentBrowserSendFailureTab(bodyFailure!)).toBe('body');
    expect(skipSchemaValidation && schemaOverrideMayDispatch(bodyFailure)).toBe(false);
  });

  test('browser-session Cookie can proceed past hard checks, including a schema override', () => {
    const current = cookieModel();
    const session = buildRequest({
      baseUrl: 'https://example.test',
      path: '/session',
      method: 'GET',
      debugModel: current,
      formValues: {
        ...emptyForm(),
        oas32ParameterInputs: collectResolvedOas32ParameterInputs(
          current.oas32Parameters!,
          { 'cookie:SID': { kind: 'parameter', text: 'SID=x; SID=y%2F', enabled: true } },
          { 'cookie:SID': 'SID=x; SID=y%2F' },
          { 'cookie:SID': true },
          'browser-session',
          1,
        ),
      },
    });
    expect(session.headers).not.toHaveProperty('Cookie');
    const skipSchemaValidation = true;
    const hardFailure = inspectUnsentBrowserSendFailure({
      built: session,
      hasBodyInput: false,
      cookieSessionCapable: true,
      isOas32: true,
    });
    expect(hardFailure).toBeNull();
    expect(schemaOverrideMayDispatch(hardFailure)).toBe(true);
    expect(skipSchemaValidation && schemaOverrideMayDispatch(hardFailure)).toBe(true);
    expect(() => assertOas32BrowserRequest(session)).not.toThrow();
  });

  test('discards the previous response object URL instead of leaving a 200 panel', () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    discardUnsentDebugResponse({ objectUrl: 'blob:http://localhost/previous-200' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/previous-200');
    discardUnsentDebugResponse(null);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    revokeObjectURL.mockRestore();
  });
});
