import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createClientId } from '../utils/id';
import {
  applyUpsertGlobalParams,
  asManualParam,
  emptyStoredGroupConfig,
  findShadowedApplicationIdentities,
  loadApplicationParams,
  loadGroup,
  removeStoredGroup,
  resolveEffectiveParams,
  saveApplicationParams,
  saveGroup,
  type CookieSessionConfig,
  type GlobalParamItem,
  type GlobalParamScope,
  type GlobalParamUpsertInput,
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
  GlobalParamUpsertInput,
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

export interface UpsertGlobalParamsResult {
  readonly shadowedApplicationIdentities: ReadonlySet<string>;
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
  upsertParams: (updates: readonly GlobalParamUpsertInput[]) => UpsertGlobalParamsResult;
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

  const upsertParams = useCallback(
    (updates: readonly GlobalParamUpsertInput[]): UpsertGlobalParamsResult => {
      if (updates.length === 0) {
        return { shadowedApplicationIdentities: new Set<string>() };
      }
      const appUpdates = updates.filter((item) => item.scope === 'application');
      const groupUpdates = updates.filter((item) => item.scope === 'group');
      const current = memoryRef.current;
      let nextApplicationParams = current.applicationParams;
      let nextApplicationPersistenceFailed = current.applicationPersistenceFailed;
      let nextConfigs = current.configs;
      let nextFailedGroups = current.failedGroups;

      if (appUpdates.length > 0) {
        nextApplicationParams = applyUpsertGlobalParams(current.applicationParams, appUpdates, 'application');
        nextApplicationPersistenceFailed = !saveApplicationParams(pathname, nextApplicationParams);
      }

      let activeGroupConfig = current.configs.get(groupId) ?? emptyStoredGroupConfig();
      if (groupUpdates.length > 0) {
        activeGroupConfig = {
          ...activeGroupConfig,
          params: applyUpsertGlobalParams(activeGroupConfig.params, groupUpdates, 'group'),
        };
        const persisted = saveGroup(groupId, activeGroupConfig);
        const failed = new Set(current.failedGroups);
        if (persisted) failed.delete(groupId);
        else failed.add(groupId);
        nextFailedGroups = failed;
        nextConfigs = new Map(current.configs).set(groupId, activeGroupConfig);
      }

      commitMemory({
        ...current,
        applicationParams: nextApplicationParams,
        applicationPersistenceFailed: nextApplicationPersistenceFailed,
        configs: nextConfigs,
        failedGroups: nextFailedGroups,
      });

      const shadowedApplicationIdentities =
        appUpdates.length > 0
          ? findShadowedApplicationIdentities(activeGroupConfig.params, appUpdates)
          : new Set<string>();
      return { shadowedApplicationIdentities };
    },
    [commitMemory, groupId, pathname],
  );

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
      upsertParams,
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
      upsertParams,
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
