import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { createClientId } from '../utils/id';

const LEGACY_STORAGE_KEY = 'knife4j_global_params';
const STORAGE_PREFIX = 'knife4j:global-params:';

export type GlobalParamLocation = 'header' | 'query';
export type GlobalParamValueSource = 'manual' | 'request';
export type GlobalParamRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type GlobalParamCredentialsMode = 'same-origin' | 'include';

export interface GlobalParamHttpRequest {
  method: GlobalParamRequestMethod;
  url: string;
  headers: string;
  body: string;
}

export interface GlobalParamValueRequest extends GlobalParamHttpRequest {
  jsonPath: string;
  prefix: string;
}

export interface GlobalParamItem {
  id: string;
  name: string;
  value: string;
  in: GlobalParamLocation;
  enabled: boolean;
  masked: boolean;
  valueSource: GlobalParamValueSource;
  request?: GlobalParamValueRequest;
}

export interface CookieSessionConfig {
  credentials: GlobalParamCredentialsMode;
  login?: GlobalParamHttpRequest;
  logout?: GlobalParamHttpRequest;
}

interface StoredGroupConfig {
  params: GlobalParamItem[];
  cookieSession: CookieSessionConfig;
}

interface GlobalParamContextValue extends StoredGroupConfig {
  groupId: string;
  addParam: (param: Omit<GlobalParamItem, 'id'>) => void;
  updateParam: (id: string, patch: Partial<Omit<GlobalParamItem, 'id'>>) => void;
  removeParam: (id: string) => void;
  setCookieSession: (config: CookieSessionConfig) => void;
  clearGroup: () => void;
}

const DEFAULT_COOKIE_SESSION: CookieSessionConfig = { credentials: 'same-origin' };

const GlobalParamContext = createContext<GlobalParamContextValue | null>(null);

function storageKey(groupId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(groupId)}`;
}

function normalizeRequest(value: unknown): GlobalParamHttpRequest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Partial<GlobalParamHttpRequest>;
  if (typeof input.url !== 'string') return undefined;
  const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(input.method ?? '')
    ? (input.method as GlobalParamRequestMethod)
    : 'POST';
  return {
    method,
    url: input.url,
    headers: typeof input.headers === 'string' ? input.headers : '',
    body: typeof input.body === 'string' ? input.body : '',
  };
}

function normalizeParam(value: unknown): GlobalParamItem | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<GlobalParamItem>;
  if (typeof input.name !== 'string' || (input.in !== 'header' && input.in !== 'query')) return null;

  const request = normalizeRequest(input.request);
  return {
    id: typeof input.id === 'string' ? input.id : createClientId(),
    name: input.name,
    value: typeof input.value === 'string' ? input.value : '',
    in: input.in,
    enabled: input.enabled !== false,
    masked: input.masked === true,
    valueSource: input.valueSource === 'request' ? 'request' : 'manual',
    request:
      request && input.request && typeof input.request === 'object'
        ? {
            ...request,
            jsonPath:
              typeof (input.request as Partial<GlobalParamValueRequest>).jsonPath === 'string'
                ? (input.request as Partial<GlobalParamValueRequest>).jsonPath!
                : '$.data',
            prefix:
              typeof (input.request as Partial<GlobalParamValueRequest>).prefix === 'string'
                ? (input.request as Partial<GlobalParamValueRequest>).prefix!
                : '',
          }
        : undefined,
  };
}

function normalizeStoredConfig(value: unknown): StoredGroupConfig {
  if (Array.isArray(value)) {
    return {
      params: value.map(normalizeParam).filter((param): param is GlobalParamItem => param !== null),
      cookieSession: DEFAULT_COOKIE_SESSION,
    };
  }
  if (!value || typeof value !== 'object') {
    return { params: [], cookieSession: DEFAULT_COOKIE_SESSION };
  }

  const input = value as Partial<StoredGroupConfig>;
  const cookieInput = input.cookieSession;
  return {
    params: Array.isArray(input.params)
      ? input.params.map(normalizeParam).filter((param): param is GlobalParamItem => param !== null)
      : [],
    cookieSession: {
      credentials: cookieInput?.credentials === 'include' ? 'include' : 'same-origin',
      login: normalizeRequest(cookieInput?.login),
      logout: normalizeRequest(cookieInput?.logout),
    },
  };
}

function loadGroup(groupId: string): StoredGroupConfig {
  try {
    const key = storageKey(groupId);
    const stored = localStorage.getItem(key);
    if (stored) return normalizeStoredConfig(JSON.parse(stored));

    // Existing installations stored one cross-group array. Move it into the
    // first group that loads so credentials never continue leaking across groups.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const migrated = normalizeStoredConfig(JSON.parse(legacy));
      localStorage.setItem(key, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return migrated;
    }
  } catch {
    // Invalid or unavailable localStorage is non-fatal.
  }
  return { params: [], cookieSession: DEFAULT_COOKIE_SESSION };
}

function saveGroup(groupId: string, config: StoredGroupConfig): void {
  try {
    localStorage.setItem(storageKey(groupId), JSON.stringify(config));
  } catch {
    // Storage failures must not make the debugger unusable.
  }
}

export const GlobalParamProvider: React.FC<{ children: React.ReactNode; groupId?: string }> = ({
  children,
  groupId = 'default',
}) => {
  const [configs, setConfigs] = useState(() => new Map([[groupId, loadGroup(groupId)]]));
  const config = useMemo(() => configs.get(groupId) ?? loadGroup(groupId), [configs, groupId]);

  const updateConfig = useCallback(
    (updater: (current: StoredGroupConfig) => StoredGroupConfig) => {
      setConfigs((current) => {
        const nextConfig = updater(current.get(groupId) ?? loadGroup(groupId));
        saveGroup(groupId, nextConfig);
        return new Map(current).set(groupId, nextConfig);
      });
    },
    [groupId],
  );

  const addParam = useCallback(
    (param: Omit<GlobalParamItem, 'id'>) => {
      updateConfig((current) => ({
        ...current,
        params: [...current.params, { ...param, id: createClientId() }],
      }));
    },
    [updateConfig],
  );

  const updateParam = useCallback(
    (id: string, patch: Partial<Omit<GlobalParamItem, 'id'>>) => {
      updateConfig((current) => ({
        ...current,
        params: current.params.map((param) => (param.id === id ? { ...param, ...patch } : param)),
      }));
    },
    [updateConfig],
  );

  const removeParam = useCallback(
    (id: string) => {
      updateConfig((current) => ({ ...current, params: current.params.filter((param) => param.id !== id) }));
    },
    [updateConfig],
  );

  const setCookieSession = useCallback(
    (cookieSession: CookieSessionConfig) => {
      updateConfig((current) => ({ ...current, cookieSession }));
    },
    [updateConfig],
  );

  const clearGroup = useCallback(() => {
    const empty = { params: [], cookieSession: DEFAULT_COOKIE_SESSION };
    setConfigs((current) => new Map(current).set(groupId, empty));
    try {
      localStorage.removeItem(storageKey(groupId));
    } catch {
      // Ignore unavailable localStorage.
    }
  }, [groupId]);

  const value = useMemo(
    () => ({
      ...config,
      groupId,
      addParam,
      updateParam,
      removeParam,
      setCookieSession,
      clearGroup,
    }),
    [addParam, clearGroup, config, groupId, removeParam, setCookieSession, updateParam],
  );

  return <GlobalParamContext.Provider value={value}>{children}</GlobalParamContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useGlobalParam = (): GlobalParamContextValue => {
  const ctx = useContext(GlobalParamContext);
  if (!ctx) throw new Error('useGlobalParam must be used inside GlobalParamProvider');
  return ctx;
};
