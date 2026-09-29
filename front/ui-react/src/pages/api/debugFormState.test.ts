import { describe, expect, it } from 'vitest';
import type { OperationDebugModel } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import { DEBUG_CACHE_VERSION, type DebugCacheState } from './debugCache';
import { buildInitialDebugState, restoreInitialDebugStateFromCache } from './debugFormState';

const document: SwaggerDoc = {
  openapi: '3.0.3',
  info: { title: 'Form restoration', version: '1.0' },
  paths: { '/pets': { post: { responses: { '204': { description: 'created' } } } } },
};
const operation: MenuOperation = {
  key: 'Pets/post',
  path: '/pets',
  method: 'post',
  operation: document.paths!['/pets'].post!,
};
const model: OperationDebugModel = {
  pathParams: [],
  queryParams: [],
  headerParams: [],
  cookieParams: [],
  bodyContents: [{ mediaType: 'application/json', category: 'json', schema: { type: 'object' } }],
  bodyRequired: true,
};
const defaults = {
  bodyByMediaType: { 'application/json': '{"name":"default"}' },
  formFieldsByMediaType: { 'application/json': {} },
};

function initialState() {
  return buildInitialDebugState(model, operation, document, 'https://api.example.test', defaults);
}

function cache(overrides: Partial<DebugCacheState> = {}): DebugCacheState {
  return { ...initialState(), version: DEBUG_CACHE_VERSION, ...overrides };
}

describe('debug form restoration', () => {
  it('initializes the operation and keeps the default snapshot unchanged when cache is absent', () => {
    const initial = initialState();
    expect(initial).toMatchObject({
      method: 'POST',
      path: '/pets',
      body: '{"name":"default"}',
      selectedContentType: 'application/json',
      rawMode: 'json',
    });
    expect(restoreInitialDebugStateFromCache(initial, null, model, defaults)).toBe(initial);
  });

  it('restores only current parameter keys while retaining new defaults and disabled selections', () => {
    const initial = {
      ...initialState(),
      paramValues: { 'query:old': 'default', 'query:new': 'new default' },
      paramEnabled: { 'query:old': true, 'query:new': true },
    };
    const restored = restoreInitialDebugStateFromCache(
      initial,
      cache({
        paramValues: { 'query:old': 'edited', 'query:removed': 'stale' },
        paramEnabled: { 'query:old': false, 'query:removed': true },
      }),
      model,
      defaults,
    );
    expect(restored.paramValues).toEqual({ 'query:old': 'edited', 'query:new': 'new default' });
    expect(restored.paramEnabled).toEqual({ 'query:old': false, 'query:new': true });
    expect(initial.paramValues['query:old']).toBe('default');
  });

  it('drops an obsolete body media selection and its custom fields while retaining unrelated headers', () => {
    const headers = [{ id: 'header', name: 'X-Trace', value: 'trace' }];
    const restored = restoreInitialDebugStateFromCache(
      initialState(),
      cache({
        selectedContentType: 'multipart/form-data',
        body: 'obsolete body',
        rawMode: 'text',
        formFields: { obsolete: 'value' },
        formPartContentTypes: { obsolete: 'text/plain' },
        customBodyParams: [{ id: 'body', name: 'obsolete', value: 'value' }],
        customHeaders: headers,
      }),
      model,
      defaults,
    );
    expect(restored).toMatchObject({
      selectedContentType: 'application/json',
      body: '{"name":"default"}',
      rawMode: 'json',
      formFields: {},
      formPartContentTypes: {},
      customBodyParams: [],
      customHeaders: headers,
    });
  });

  it('preserves declared additional-method case while refusing an unrelated cached method', () => {
    const initial = { ...initialState(), method: 'customMethod' };
    expect(
      restoreInitialDebugStateFromCache(initial, cache({ method: 'customMethod' }), model, defaults, true).method,
    ).toBe('customMethod');
    expect(
      restoreInitialDebugStateFromCache(initial, cache({ method: 'otherMethod' }), model, defaults, true).method,
    ).toBe('customMethod');
    expect(restoreInitialDebugStateFromCache(initialState(), cache({ method: 'put' }), model, defaults).method).toBe(
      'PUT',
    );
  });
});
