import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  acknowledgeAllApiOperations,
  acknowledgeApiOperation,
  apiOperationIdentity,
  buildApiChangeBaselineStorageKey,
  buildApiOperationFingerprints,
  compareApiChangeBaseline,
  parseApiChangeBaseline,
  reconcileApiChangeBaseline,
  serializeApiChangeBaseline,
  summarizeApiChanges,
  type ApiChangeBaseline,
  type ApiChangeStatusMap,
  type ApiChangeSummary,
  type ApiDocumentIdentity,
  type ApiOperationFingerprintMap,
} from '../apiChange/apiChangeTracker';
import {
  KNIFE4J_STORAGE_KEYS,
  getKnife4jStorageItemSnapshot,
  setKnife4jStorageItem,
  type Knife4jStorageItemSnapshot,
} from '../storage/knife4jStorage';
import { useGroup } from './GroupContext';
import { useSettings } from './SettingsContext';

interface ApiChangeTrackerState {
  ready: boolean;
  scopeKey: string;
  identity: ApiDocumentIdentity | null;
  storageKey: string;
  fingerprints: ApiOperationFingerprintMap;
  baseline: ApiChangeBaseline | null;
  statuses: ApiChangeStatusMap;
}

interface ApiChangeContextValue {
  enabled: boolean;
  ready: boolean;
  scopeKey: string;
  statuses: ApiChangeStatusMap;
  summary: ApiChangeSummary;
  acknowledgeOperation: (method: string, path: string) => void;
  acknowledgeAll: () => void;
}

function emptyStringRecord<T extends string>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function emptyState(scopeKey = ''): ApiChangeTrackerState {
  return {
    ready: false,
    scopeKey,
    identity: null,
    storageKey: '',
    fingerprints: emptyStringRecord<string>(),
    baseline: null,
    statuses: emptyStringRecord<'added' | 'changed'>(),
  };
}

const EMPTY_SUMMARY: ApiChangeSummary = { added: 0, changed: 0, total: 0 };

const ApiChangeContext = createContext<ApiChangeContextValue>({
  enabled: false,
  ready: false,
  scopeKey: '',
  statuses: emptyStringRecord<'added' | 'changed'>(),
  summary: EMPTY_SUMMARY,
  acknowledgeOperation: () => {},
  acknowledgeAll: () => {},
});

function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readBaselineSnapshot(storage: Storage | null, key: string): Knife4jStorageItemSnapshot | null {
  if (!storage) return null;
  try {
    return getKnife4jStorageItemSnapshot(storage, key, storage);
  } catch {
    return null;
  }
}

function persistBaseline(
  storage: Storage | null,
  key: string,
  baseline: ApiChangeBaseline,
  expectedSnapshot?: Knife4jStorageItemSnapshot | null,
): void {
  if (!storage) return;
  const serialized = serializeApiChangeBaseline(baseline);
  if (!serialized) return;
  void setKnife4jStorageItem(storage, key, serialized, storage, undefined, expectedSnapshot ?? undefined);
}

export const ApiChangeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings } = useSettings();
  const { activeSwaggerGroup, swaggerDoc, loading } = useGroup();
  const [state, setState] = useState<ApiChangeTrackerState>(() => emptyState());
  const stateRef = useRef(state);

  const commitState = useCallback((nextState: ApiChangeTrackerState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  useEffect(() => {
    if (!settings.enableVersion || loading || !swaggerDoc || !activeSwaggerGroup || typeof window === 'undefined') {
      commitState(emptyState());
      return undefined;
    }

    const identity: ApiDocumentIdentity = {
      origin: window.location.origin,
      applicationPath: window.location.pathname,
      group: activeSwaggerGroup.name,
      apiDocsUrl: activeSwaggerGroup.url,
    };
    const storageKey = buildApiChangeBaselineStorageKey(identity);
    let fingerprints: ApiOperationFingerprintMap | null;
    try {
      fingerprints = buildApiOperationFingerprints(swaggerDoc);
    } catch {
      fingerprints = null;
    }

    // The reusable closed-reference snapshot currently supports OAS 3.0.x.
    // Unsupported or malformed documents stay fully usable without tracking.
    if (!fingerprints) {
      commitState(emptyState(storageKey));
      return undefined;
    }

    const storage = browserLocalStorage();
    const refresh = () => {
      const snapshot = readBaselineSnapshot(storage, storageKey);
      const reconciliation = reconcileApiChangeBaseline(identity, fingerprints!, snapshot?.value ?? null);
      const nextState: ApiChangeTrackerState = {
        ready: true,
        scopeKey: storageKey,
        identity,
        storageKey,
        fingerprints: fingerprints!,
        baseline: reconciliation.baseline,
        statuses: reconciliation.statuses,
      };
      commitState(nextState);
      if (reconciliation.initialized) {
        persistBaseline(storage, storageKey, reconciliation.baseline, snapshot);
      }
    };

    refresh();
    const onStorage = (event: StorageEvent) => {
      if (storage && event.storageArea && event.storageArea !== storage) return;
      if (
        event.key === storageKey ||
        event.key === KNIFE4J_STORAGE_KEYS.requestCacheEpoch ||
        event.key === KNIFE4J_STORAGE_KEYS.resetGeneration
      ) {
        refresh();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [activeSwaggerGroup, commitState, loading, settings.enableVersion, swaggerDoc]);

  const acknowledgeOperation = useCallback(
    (method: string, path: string) => {
      const current = stateRef.current;
      const operationKey = apiOperationIdentity(method, path);
      if (
        !current.ready ||
        !current.identity ||
        !current.baseline ||
        !Object.prototype.hasOwnProperty.call(current.statuses, operationKey)
      ) {
        return;
      }

      const storage = browserLocalStorage();
      const snapshot = readBaselineSnapshot(storage, current.storageKey);
      const durableBaseline = parseApiChangeBaseline(snapshot?.value ?? null, current.identity);
      const nextBaseline = acknowledgeApiOperation(
        durableBaseline ?? current.baseline,
        current.fingerprints,
        method,
        path,
      );
      const nextState = {
        ...current,
        baseline: nextBaseline,
        statuses: compareApiChangeBaseline(nextBaseline, current.fingerprints),
      };
      commitState(nextState);
      persistBaseline(storage, current.storageKey, nextBaseline, snapshot);
    },
    [commitState],
  );

  const acknowledgeAll = useCallback(() => {
    const current = stateRef.current;
    if (!current.ready || !current.identity || !current.baseline) return;

    const nextBaseline = acknowledgeAllApiOperations(current.identity, current.fingerprints);
    const nextState = {
      ...current,
      baseline: nextBaseline,
      statuses: compareApiChangeBaseline(nextBaseline, current.fingerprints),
    };
    commitState(nextState);
    const storage = browserLocalStorage();
    persistBaseline(storage, current.storageKey, nextBaseline, readBaselineSnapshot(storage, current.storageKey));
  }, [commitState]);

  const summary = useMemo(() => (state.ready ? summarizeApiChanges(state.statuses) : EMPTY_SUMMARY), [state]);
  const value = useMemo<ApiChangeContextValue>(
    () => ({
      enabled: settings.enableVersion,
      ready: state.ready,
      scopeKey: state.scopeKey,
      statuses: state.statuses,
      summary,
      acknowledgeOperation,
      acknowledgeAll,
    }),
    [acknowledgeAll, acknowledgeOperation, settings.enableVersion, state, summary],
  );

  return <ApiChangeContext.Provider value={value}>{children}</ApiChangeContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useApiChanges = (): ApiChangeContextValue => useContext(ApiChangeContext);
