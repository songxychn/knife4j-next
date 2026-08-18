import { describe, expect, it, vi } from 'vitest';

// This suite exercises the exported storage/merge helpers in a Node environment.
// The provider itself is covered by the front build, so a minimal React facade
// keeps Vitest from selecting React's server-only conditional export here.
vi.mock('react', () => ({
  default: {},
  createContext: () => ({}),
  useCallback: vi.fn(),
  useContext: vi.fn(),
  useMemo: vi.fn(),
  useState: vi.fn(),
}));
import {
  applicationStorageKey,
  type GlobalParamItem,
  type GlobalParamStorage,
  globalParamIdentity,
  groupStorageKey,
  loadApplicationParams,
  loadGroup,
  normalizeParam,
  normalizeStoredApplicationParams,
  resolveEffectiveParams,
} from './GlobalParamContext';

function param(overrides: Partial<GlobalParamItem> & Pick<GlobalParamItem, 'id' | 'name'>): GlobalParamItem {
  return {
    value: 'value',
    in: 'header',
    enabled: true,
    masked: false,
    valueSource: 'manual',
    ...overrides,
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: GlobalParamStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return { data, storage };
}

describe('global parameter normalization', () => {
  it('keeps the existing request defaults for group parameters', () => {
    const normalized = normalizeParam({
      id: 'group-request',
      name: 'Authorization',
      value: 42,
      in: 'header',
      enabled: false,
      masked: true,
      valueSource: 'request',
      request: { method: 'INVALID', url: '/token', headers: 42, body: null, jsonPath: 42, prefix: null },
    });

    expect(normalized).toEqual({
      id: 'group-request',
      name: 'Authorization',
      value: '',
      in: 'header',
      enabled: false,
      masked: true,
      valueSource: 'request',
      request: { method: 'POST', url: '/token', headers: '', body: '', jsonPath: '$.data', prefix: '' },
    });
  });

  it('drops invalid entries and forces application entries to be manual', () => {
    const normalized = normalizeStoredApplicationParams([
      null,
      { id: 'invalid', name: 'missing-location' },
      {
        id: 'application-request',
        name: 'Authorization',
        value: 'Bearer token',
        in: 'header',
        valueSource: 'request',
        request: {
          method: 'POST',
          url: '/token',
          headers: '',
          body: '',
          jsonPath: '$.token',
          prefix: 'Bearer ',
        },
      },
    ]);

    expect(normalized).toEqual([
      {
        id: 'application-request',
        name: 'Authorization',
        value: 'Bearer token',
        in: 'header',
        enabled: true,
        masked: false,
        valueSource: 'manual',
      },
    ]);
  });
});

describe('application parameter storage', () => {
  it('uses a pathname namespace that cannot collide with a group key', () => {
    expect(applicationStorageKey('/one/doc.html')).not.toBe(applicationStorageKey('/two/doc.html'));
    expect(applicationStorageKey('/doc.html')).not.toBe(groupStorageKey('application-global-params:%2Fdoc.html'));
  });

  it('migrates the legacy value only to the application key', () => {
    const pathname = '/service/doc.html';
    const existingGroup = {
      params: [param({ id: 'group', name: 'X-Group', value: 'kept' })],
      cookieSession: { credentials: 'include' },
    };
    const legacyParam = {
      ...param({ id: 'legacy', name: 'Authorization', value: 'legacy' }),
      valueSource: 'request',
      request: {
        method: 'POST',
        url: '/token',
        headers: '',
        body: '',
        jsonPath: '$.token',
        prefix: '',
      },
    };
    const { data, storage } = memoryStorage({
      knife4j_global_params: JSON.stringify([legacyParam]),
      [groupStorageKey('group-a')]: JSON.stringify(existingGroup),
    });

    const loaded = loadApplicationParams(pathname, storage);

    expect(loaded).toEqual([{ ...legacyParam, valueSource: 'manual', request: undefined }]);
    expect(JSON.parse(data.get(applicationStorageKey(pathname))!)).toEqual(loaded);
    expect(data.has('knife4j_global_params')).toBe(false);
    expect(loadGroup('group-a', storage)).toEqual(existingGroup);
  });

  it('does not let group loading consume or promote a legacy value', () => {
    const { data, storage } = memoryStorage({
      knife4j_global_params: JSON.stringify([param({ id: 'legacy', name: 'X-Legacy' })]),
    });

    expect(loadGroup('group-a', storage)).toEqual({
      params: [],
      cookieSession: { credentials: 'same-origin' },
    });
    expect(data.has('knife4j_global_params')).toBe(true);
    expect(data.has(groupStorageKey('group-a'))).toBe(false);
  });

  it('does not fall back to legacy data when the application key is corrupt', () => {
    const pathname = '/doc.html';
    const { data, storage } = memoryStorage({
      [applicationStorageKey(pathname)]: '{not-json',
      knife4j_global_params: JSON.stringify([param({ id: 'legacy', name: 'X-Legacy' })]),
      [groupStorageKey('group-a')]: '{not-json',
    });

    expect(loadApplicationParams(pathname, storage)).toEqual([]);
    expect(loadGroup('group-a', storage)).toEqual({
      params: [],
      cookieSession: { credentials: 'same-origin' },
    });
    expect(data.has('knife4j_global_params')).toBe(true);
  });

  it('treats unavailable storage as non-fatal', () => {
    const storage: GlobalParamStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };

    expect(loadApplicationParams('/doc.html', storage)).toEqual([]);
    expect(loadGroup('group-a', storage)).toEqual({
      params: [],
      cookieSession: { credentials: 'same-origin' },
    });
  });
});

describe('effective global parameters', () => {
  it('normalizes identities by location and header casing', () => {
    expect(globalParamIdentity(param({ id: 'a', name: ' Authorization ', in: 'header' }))).toBe(
      globalParamIdentity(param({ id: 'b', name: 'authorization', in: 'header' })),
    );
    expect(globalParamIdentity(param({ id: 'a', name: ' Tenant ', in: 'query' }))).not.toBe(
      globalParamIdentity(param({ id: 'b', name: 'tenant', in: 'query' })),
    );
    expect(globalParamIdentity(param({ id: 'a', name: 'tenant', in: 'header' }))).not.toBe(
      globalParamIdentity(param({ id: 'b', name: 'tenant', in: 'query' })),
    );
  });

  it('applies last-wins, group shadowing, and opt-out before filtering', () => {
    const application = [
      param({ id: 'app-auth-old', name: 'Authorization', value: 'old' }),
      param({ id: 'app-auth-new', name: ' authorization ', value: 'new' }),
      param({ id: 'app-query-lower', name: 'tenant', value: 'lower', in: 'query' }),
      param({ id: 'app-query-upper', name: 'Tenant', value: 'upper', in: 'query' }),
      param({ id: 'app-header', name: 'tenant', value: 'header', in: 'header' }),
    ];
    const group = [
      param({ id: 'group-auth-disabled', name: 'AUTHORIZATION', value: 'ignored', enabled: false }),
      param({ id: 'group-query-empty', name: ' tenant ', value: '', in: 'query' }),
      param({ id: 'group-query-upper', name: 'Tenant', value: 'group-upper', in: 'query' }),
      param({ id: 'group-duplicate-old', name: 'X-Trace', value: 'old' }),
      param({ id: 'group-duplicate-new', name: ' x-trace ', value: 'new' }),
    ];

    expect(resolveEffectiveParams(application, group)).toEqual([
      { ...application[4], scope: 'application' },
      { ...group[2], scope: 'group' },
      { ...group[4], scope: 'group' },
    ]);
  });
});
