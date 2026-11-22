import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createClientId } from '../utils/id';
import {
  asManualParam,
  emptyStoredGroupConfig,
  loadApplicationParams,
  loadGroup,
  removeStoredGroup,
  resolveEffectiveParams,
  saveApplicationParams,
  saveGroup,
  type CookieSessionConfig,
  type GlobalParamItem,
  type GlobalParamScope,
  type ScopedGlobalParamItem,
  type StoredGroupConfig,
} from './globalParamState';

export type {
  CookieSessionConfig,
  GlobalParamCredentialsMode,
  GlobalParamHttpRequest,
  GlobalParamItem,
  GlobalParamLocation,
  GlobalParamRequestMethod,
  GlobalParamScope,
  GlobalParamStorage,
  GlobalParamValueRequest,
  GlobalParamValueSource,
  ScopedGlobalParamItem,
  StoredGroupConfig,
} from './globalParamState';

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
  applicationPersistenceFailed: boolean;
  groupPersistenceFailed: boolean;
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

const GlobalParamContext = createContext<GlobalParamContextValue | null>(null);

function currentDocumentPathname(): string {
  try {
    return globalThis.document?.location?.pathname || '/';
  } catch {
    return '/';
  }
}

interface GlobalParamMemoryState {
  applicationParams: GlobalParamItem[];
  configs: Map<string, StoredGroupConfig>;
  applicationPersistenceFailed: boolean;
  failedGroups: ReadonlySet<string>;
}

export const GlobalParamProvider: React.FC<{ children: React.ReactNode; groupId?: string }> = ({
  children,
  groupId = 'default',
}) => {
  const [pathname] = useState(currentDocumentPathname);
  const [memory, setMemoryState] = useState<GlobalParamMemoryState>(() => ({
    applicationParams: loadApplicationParams(pathname),
    configs: new Map([[groupId, loadGroup(groupId)]]),
    applicationPersistenceFailed: false,
    failedGroups: new Set<string>(),
  }));
  const memoryRef = useRef(memory);
  const commitMemory = useCallback((next: GlobalParamMemoryState) => {
    memoryRef.current = next;
    setMemoryState(next);
  }, []);

  const config = useMemo(() => memory.configs.get(groupId) ?? emptyStoredGroupConfig(), [groupId, memory.configs]);

  useEffect(() => {
    if (memoryRef.current.configs.has(groupId)) return;
    const loaded = loadGroup(groupId);
    const current = memoryRef.current;
    if (current.configs.has(groupId)) return;
    commitMemory({ ...current, configs: new Map(current.configs).set(groupId, loaded) });
  }, [commitMemory, groupId]);

  const updateGroupConfig = useCallback(
    (updater: (current: StoredGroupConfig) => StoredGroupConfig) => {
      const current = memoryRef.current;
      const nextConfig = updater(current.configs.get(groupId) ?? emptyStoredGroupConfig());
      const persisted = saveGroup(groupId, nextConfig);
      const failedGroups = new Set(current.failedGroups);
      if (persisted) failedGroups.delete(groupId);
      else failedGroups.add(groupId);
      commitMemory({
        ...current,
        configs: new Map(current.configs).set(groupId, nextConfig),
        failedGroups,
      });
    },
    [commitMemory, groupId],
  );

  const updateApplicationParams = useCallback(
    (updater: (current: GlobalParamItem[]) => GlobalParamItem[]) => {
      const current = memoryRef.current;
      const nextParams = updater(current.applicationParams).map(asManualParam);
      const persisted = saveApplicationParams(pathname, nextParams);
      commitMemory({
        ...current,
        applicationParams: nextParams,
        applicationPersistenceFailed: !persisted,
      });
    },
    [commitMemory, pathname],
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
    const current = memoryRef.current;
    const nextConfig = emptyStoredGroupConfig();
    const persisted = removeStoredGroup(groupId);
    const failedGroups = new Set(current.failedGroups);
    if (persisted) failedGroups.delete(groupId);
    else failedGroups.add(groupId);
    commitMemory({
      ...current,
      configs: new Map(current.configs).set(groupId, nextConfig),
      failedGroups,
    });
  }, [commitMemory, groupId]);

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
      applicationPersistenceFailed: memory.applicationPersistenceFailed === true,
      groupPersistenceFailed: memory.failedGroups?.has(groupId) === true,
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
      memory.applicationPersistenceFailed,
      memory.failedGroups,
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

// eslint-disable-next-line react-refresh/only-export-components
export const useGlobalParam = (): GlobalParamContextValue => {
  const ctx = useContext(GlobalParamContext);
  if (!ctx) throw new Error('useGlobalParam must be used inside GlobalParamProvider');
  return ctx;
};
