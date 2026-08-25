/* eslint-disable react-refresh/only-export-components -- storage and merge helpers are exported for regression tests. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  KNIFE4J_STORAGE_KEYS,
  KNIFE4J_STORAGE_PREFIXES,
  getKnife4jStorageItem,
  getKnife4jStorageResetSnapshot,
  persistKnife4jStorageItem,
  removeKnife4jStorageItem,
  setKnife4jStorageItem,
  subscribeKnife4jStorageReset,
  type Knife4jStorageResetSnapshot,
} from '../storage/knife4jStorage';
import { createClientId } from '../utils/id';

export type GlobalParamLocation = 'header' | 'query';
export type GlobalParamValueSource = 'manual' | 'request';
export type GlobalParamRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type GlobalParamCredentialsMode = 'same-origin' | 'include';
export type GlobalParamScope = 'application' | 'group';

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

export interface ScopedGlobalParamItem extends GlobalParamItem {
  scope: GlobalParamScope;
}

export interface CookieSessionConfig {
  credentials: GlobalParamCredentialsMode;
  login?: GlobalParamHttpRequest;
  logout?: GlobalParamHttpRequest;
}

export interface StoredGroupConfig {
  params: GlobalParamItem[];
  cookieSession: CookieSessionConfig;
}

export interface GlobalParamStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

type NewGlobalParam = Omit<GlobalParamItem, 'id'>;
type GlobalParamPatch = Partial<NewGlobalParam>;

interface AddGlobalParam {
  (scope: GlobalParamScope, param: NewGlobalParam): void;
  /** @deprecated Pass an explicit scope. This compatibility form adds a group parameter. */
  (param: NewGlobalParam): void;
}

interface UpdateGlobalParam {
  (scope: GlobalParamScope, id: string, patch: GlobalParamPatch): void;
  /** @deprecated Pass an explicit scope. This compatibility form updates a group parameter. */
  (id: string, patch: GlobalParamPatch): void;
}

interface RemoveGlobalParam {
  (scope: GlobalParamScope, id: string): void;
  /** @deprecated Pass an explicit scope. This compatibility form removes a group parameter. */
  (id: string): void;
}

interface GlobalParamContextValue {
  groupId: string;
  /** @deprecated Use groupParams or effectiveParams according to the call site. */
  params: ScopedGlobalParamItem[];
  applicationParams: ScopedGlobalParamItem[];
  groupParams: ScopedGlobalParamItem[];
  effectiveParams: ScopedGlobalParamItem[];
  cookieSession: CookieSessionConfig;
  addParam: AddGlobalParam;
  updateParam: UpdateGlobalParam;
  removeParam: RemoveGlobalParam;
  clearParams: (scope: GlobalParamScope) => void;
  setCookieSession: (config: CookieSessionConfig) => void;
  clearGroup: () => void;
}

const DEFAULT_COOKIE_SESSION: CookieSessionConfig = { credentials: 'same-origin' };

function emptyStoredGroupConfig(): StoredGroupConfig {
  return { params: [], cookieSession: DEFAULT_COOKIE_SESSION };
}

const GlobalParamContext = createContext<GlobalParamContextValue | null>(null);

export function groupStorageKey(groupId: string): string {
  return `${KNIFE4J_STORAGE_PREFIXES.groupGlobalParams}${encodeURIComponent(groupId)}`;
}

export function applicationStorageKey(pathname: string): string {
  return `${KNIFE4J_STORAGE_PREFIXES.applicationGlobalParams}${encodeURIComponent(pathname || '/')}`;
}

function currentDocumentPathname(): string {
  try {
    return globalThis.document?.location?.pathname || '/';
  } catch {
    return '/';
  }
}

function browserStorage(): GlobalParamStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
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

export function normalizeParam(value: unknown): GlobalParamItem | null {
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

export function normalizeStoredConfig(value: unknown): StoredGroupConfig {
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

function asManualParam(param: GlobalParamItem): GlobalParamItem {
  return {
    id: param.id,
    name: param.name,
    value: param.value,
    in: param.in,
    enabled: param.enabled,
    masked: param.masked,
    valueSource: 'manual',
  };
}

export function normalizeStoredApplicationParams(value: unknown): GlobalParamItem[] {
  const params = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as Partial<StoredGroupConfig>).params)
      ? (value as Partial<StoredGroupConfig>).params!
      : [];
  return params
    .map(normalizeParam)
    .filter((param): param is GlobalParamItem => param !== null)
    .map(asManualParam);
}

export function loadGroup(groupId: string, storage?: GlobalParamStorage): StoredGroupConfig {
  const target = storage ?? browserStorage();
  if (!target) return { params: [], cookieSession: DEFAULT_COOKIE_SESSION };
  try {
    const stored = getKnife4jStorageItem(target, groupStorageKey(groupId));
    if (stored !== null) return normalizeStoredConfig(JSON.parse(stored));
  } catch {
    // Invalid or unavailable localStorage is non-fatal.
  }
  return { params: [], cookieSession: DEFAULT_COOKIE_SESSION };
}

function saveGroup(groupId: string, config: StoredGroupConfig, storage?: GlobalParamStorage): void {
  const target = storage ?? browserStorage();
  if (!target) return;
  try {
    void setKnife4jStorageItem(target, groupStorageKey(groupId), JSON.stringify(config));
  } catch {
    // Storage failures must not make the debugger unusable.
  }
}

export function loadApplicationParams(pathname: string, storage?: GlobalParamStorage): GlobalParamItem[] {
  const target = storage ?? browserStorage();
  if (!target) return [];

  const key = applicationStorageKey(pathname);
  let stored: string | null;
  try {
    stored = getKnife4jStorageItem(target, key);
  } catch {
    return [];
  }

  // Presence, rather than validity, decides whether migration is allowed: a
  // corrupt current value must never make an old credential spread again.
  if (stored !== null) {
    try {
      return normalizeStoredApplicationParams(JSON.parse(stored));
    } catch {
      return [];
    }
  }

  let legacy: string | null;
  try {
    legacy = getKnife4jStorageItem(target, KNIFE4J_STORAGE_KEYS.legacyGlobalParams);
  } catch {
    return [];
  }
  if (legacy === null) return [];

  let migrated: GlobalParamItem[];
  try {
    migrated = normalizeStoredApplicationParams(JSON.parse(legacy));
  } catch {
    return [];
  }

  void persistKnife4jStorageItem(target, key, JSON.stringify(migrated)).then((persisted) => {
    if (persisted) void removeKnife4jStorageItem(target, KNIFE4J_STORAGE_KEYS.legacyGlobalParams);
  });
  return migrated;
}

function saveApplicationParams(pathname: string, params: GlobalParamItem[], storage?: GlobalParamStorage): void {
  const target = storage ?? browserStorage();
  if (!target) return;
  try {
    void setKnife4jStorageItem(target, applicationStorageKey(pathname), JSON.stringify(params.map(asManualParam)));
  } catch {
    // Storage failures must not make the debugger unusable.
  }
}

export function globalParamIdentity(param: Pick<GlobalParamItem, 'in' | 'name'>): string {
  const name = param.name.trim();
  return JSON.stringify([param.in, param.in === 'header' ? name.toLowerCase() : name]);
}

function lastByIdentity(params: readonly GlobalParamItem[]): Map<string, GlobalParamItem> {
  const result = new Map<string, GlobalParamItem>();
  for (const param of params) {
    const identity = globalParamIdentity(param);
    // Reinsert so abnormal duplicates retain the order of their winning item.
    result.delete(identity);
    result.set(identity, param);
  }
  return result;
}

export function resolveEffectiveParams(
  applicationParams: readonly GlobalParamItem[],
  groupParams: readonly GlobalParamItem[],
): ScopedGlobalParamItem[] {
  const applicationByIdentity = lastByIdentity(applicationParams);
  const groupByIdentity = lastByIdentity(groupParams);

  // A group item is an explicit override even when it is disabled or empty.
  // Filtering happens only after application values have been shadowed.
  for (const identity of groupByIdentity.keys()) applicationByIdentity.delete(identity);

  return [
    ...Array.from(applicationByIdentity.values(), (param) => ({ ...param, scope: 'application' as const })),
    ...Array.from(groupByIdentity.values(), (param) => ({ ...param, scope: 'group' as const })),
  ].filter((param) => param.enabled && param.name.trim() !== '' && param.value !== '');
}

export interface GlobalParamMemoryState {
  resetGeneration: string;
  resetActive: boolean;
  applicationParams: GlobalParamItem[];
  configs: Map<string, StoredGroupConfig>;
}

/** Clear every reset-scoped in-memory collection before it can be persisted again. */
export function invalidateGlobalParamMemoryForReset(
  state: GlobalParamMemoryState,
  snapshot: Knife4jStorageResetSnapshot,
): GlobalParamMemoryState {
  if (state.resetGeneration === snapshot.generation && state.resetActive === snapshot.active) return state;
  if (state.resetGeneration !== snapshot.generation || snapshot.active) {
    return {
      resetGeneration: snapshot.generation,
      resetActive: snapshot.active,
      applicationParams: [],
      configs: new Map(),
    };
  }
  return { ...state, resetActive: false };
}

export function reconcileGlobalParamMemoryForReset(
  state: GlobalParamMemoryState,
  snapshot: Knife4jStorageResetSnapshot,
  loadDurableApplicationParams: () => GlobalParamItem[],
): GlobalParamMemoryState {
  const invalidated = invalidateGlobalParamMemoryForReset(state, snapshot);
  if (snapshot.active || invalidated === state) return invalidated;
  return { ...invalidated, applicationParams: loadDurableApplicationParams() };
}

export const GlobalParamProvider: React.FC<{ children: React.ReactNode; groupId?: string }> = ({
  children,
  groupId = 'default',
}) => {
  const [pathname] = useState(currentDocumentPathname);
  const initialResetSnapshotRef = useRef<Knife4jStorageResetSnapshot | null>(null);
  if (initialResetSnapshotRef.current === null) {
    initialResetSnapshotRef.current = getKnife4jStorageResetSnapshot();
  }
  const initialResetSnapshot = initialResetSnapshotRef.current;
  const [memory, setMemory] = useState<GlobalParamMemoryState>(() => ({
    resetGeneration: initialResetSnapshot.generation,
    resetActive: initialResetSnapshot.active,
    applicationParams: initialResetSnapshot.active ? [] : loadApplicationParams(pathname),
    configs: initialResetSnapshot.active
      ? new Map()
      : (new Map([[groupId, loadGroup(groupId)]]) as Map<string, StoredGroupConfig>),
  }));
  const config = useMemo(() => memory.configs.get(groupId) ?? emptyStoredGroupConfig(), [groupId, memory.configs]);

  useEffect(() => {
    const handleResetSnapshot = (snapshot: Knife4jStorageResetSnapshot) => {
      setMemory((current) =>
        reconcileGlobalParamMemoryForReset(current, snapshot, () => loadApplicationParams(pathname)),
      );
    };
    const unsubscribe = subscribeKnife4jStorageReset(handleResetSnapshot);
    handleResetSnapshot(getKnife4jStorageResetSnapshot());
    return unsubscribe;
  }, [pathname]);

  useEffect(() => {
    if (memory.resetActive || memory.configs.has(groupId)) return;
    const snapshot = getKnife4jStorageResetSnapshot();
    const loaded = snapshot.active ? emptyStoredGroupConfig() : loadGroup(groupId);
    setMemory((current) => {
      const invalidated = invalidateGlobalParamMemoryForReset(current, snapshot);
      if (invalidated !== current || snapshot.active || current.configs.has(groupId)) return invalidated;
      return { ...current, configs: new Map(current.configs).set(groupId, loaded) };
    });
  }, [groupId, memory.configs, memory.resetActive]);

  const updateGroupConfig = useCallback(
    (updater: (current: StoredGroupConfig) => StoredGroupConfig) => {
      const snapshot = getKnife4jStorageResetSnapshot();
      setMemory((current) => {
        const invalidated = invalidateGlobalParamMemoryForReset(current, snapshot);
        if (snapshot.active || invalidated !== current) return invalidated;
        const nextConfig = updater(current.configs.get(groupId) ?? emptyStoredGroupConfig());
        saveGroup(groupId, nextConfig);
        return { ...current, configs: new Map(current.configs).set(groupId, nextConfig) };
      });
    },
    [groupId],
  );

  const updateApplicationParams = useCallback(
    (updater: (current: GlobalParamItem[]) => GlobalParamItem[]) => {
      const snapshot = getKnife4jStorageResetSnapshot();
      setMemory((current) => {
        const invalidated = invalidateGlobalParamMemoryForReset(current, snapshot);
        if (snapshot.active || invalidated !== current) return invalidated;
        const nextParams = updater(current.applicationParams).map(asManualParam);
        saveApplicationParams(pathname, nextParams);
        return { ...current, applicationParams: nextParams };
      });
    },
    [pathname],
  );

  const addParam = useCallback(
    (scopeOrParam: GlobalParamScope | NewGlobalParam, scopedParam?: NewGlobalParam) => {
      const scope = typeof scopeOrParam === 'string' ? scopeOrParam : 'group';
      const param = typeof scopeOrParam === 'string' ? scopedParam : scopeOrParam;
      if (!param) return;
      const nextParam = { ...param, id: createClientId() };
      if (scope === 'application') {
        updateApplicationParams((current) => [...current, asManualParam(nextParam)]);
      } else {
        updateGroupConfig((current) => ({ ...current, params: [...current.params, nextParam] }));
      }
    },
    [updateApplicationParams, updateGroupConfig],
  ) as AddGlobalParam;

  const updateParam = useCallback(
    (
      scopeOrId: GlobalParamScope | string,
      scopedIdOrPatch: string | GlobalParamPatch,
      scopedPatch?: GlobalParamPatch,
    ) => {
      const scoped = scopedPatch !== undefined;
      const scope = scoped ? (scopeOrId as GlobalParamScope) : 'group';
      const id = scoped ? (scopedIdOrPatch as string) : scopeOrId;
      const patch = scoped ? scopedPatch : (scopedIdOrPatch as GlobalParamPatch);
      if (scope === 'application') {
        updateApplicationParams((current) =>
          current.map((param) => (param.id === id ? asManualParam({ ...param, ...patch }) : param)),
        );
      } else {
        updateGroupConfig((current) => ({
          ...current,
          params: current.params.map((param) => (param.id === id ? { ...param, ...patch } : param)),
        }));
      }
    },
    [updateApplicationParams, updateGroupConfig],
  ) as UpdateGlobalParam;

  const removeParam = useCallback(
    (scopeOrId: GlobalParamScope | string, scopedId?: string) => {
      const scope = scopedId === undefined ? 'group' : (scopeOrId as GlobalParamScope);
      const id = scopedId === undefined ? scopeOrId : scopedId;
      if (scope === 'application') {
        updateApplicationParams((current) => current.filter((param) => param.id !== id));
      } else {
        updateGroupConfig((current) => ({ ...current, params: current.params.filter((param) => param.id !== id) }));
      }
    },
    [updateApplicationParams, updateGroupConfig],
  ) as RemoveGlobalParam;

  const clearParams = useCallback(
    (scope: GlobalParamScope) => {
      if (scope === 'application') {
        // Persist an explicit empty value so a leftover legacy key cannot be
        // migrated after the user intentionally clears application params.
        updateApplicationParams(() => []);
      } else {
        updateGroupConfig((current) => ({ ...current, params: [] }));
      }
    },
    [updateApplicationParams, updateGroupConfig],
  );

  const setCookieSession = useCallback(
    (cookieSession: CookieSessionConfig) => {
      updateGroupConfig((current) => ({ ...current, cookieSession }));
    },
    [updateGroupConfig],
  );

  const clearGroup = useCallback(() => {
    const snapshot = getKnife4jStorageResetSnapshot();
    setMemory((current) => {
      const invalidated = invalidateGlobalParamMemoryForReset(current, snapshot);
      if (snapshot.active || invalidated !== current) return invalidated;
      return {
        ...current,
        configs: new Map(current.configs).set(groupId, emptyStoredGroupConfig()),
      };
    });
    if (snapshot.active) return;
    const storage = browserStorage();
    if (!storage) return;
    void removeKnife4jStorageItem(storage, groupStorageKey(groupId));
  }, [groupId]);

  const applicationParams = useMemo<ScopedGlobalParamItem[]>(
    () => memory.applicationParams.map((param) => ({ ...param, scope: 'application' })),
    [memory.applicationParams],
  );
  const groupParams = useMemo<ScopedGlobalParamItem[]>(
    () => config.params.map((param) => ({ ...param, scope: 'group' })),
    [config.params],
  );
  const effectiveParams = useMemo(
    () => resolveEffectiveParams(memory.applicationParams, config.params),
    [config.params, memory.applicationParams],
  );

  const value = useMemo(
    () => ({
      groupId,
      params: groupParams,
      applicationParams,
      groupParams,
      effectiveParams,
      cookieSession: config.cookieSession,
      addParam,
      updateParam,
      removeParam,
      clearParams,
      setCookieSession,
      clearGroup,
    }),
    [
      addParam,
      applicationParams,
      clearGroup,
      clearParams,
      config.cookieSession,
      effectiveParams,
      groupId,
      groupParams,
      removeParam,
      setCookieSession,
      updateParam,
    ],
  );

  return <GlobalParamContext.Provider value={value}>{children}</GlobalParamContext.Provider>;
};

export const useGlobalParam = (): GlobalParamContextValue => {
  const ctx = useContext(GlobalParamContext);
  if (!ctx) throw new Error('useGlobalParam must be used inside GlobalParamProvider');
  return ctx;
};
