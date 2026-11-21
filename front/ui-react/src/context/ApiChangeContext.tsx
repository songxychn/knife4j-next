import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  acknowledgeAllApiOperations,
  acknowledgeApiOperation,
  apiOperationIdentity,
  buildApiChangeBaselineStorageKey,
  buildApiChangeFingerprintSnapshot,
  compareApiChangeBaseline,
  parseApiChangeBaseline,
  reconcileApiChangeBaseline,
  serializeApiChangeBaseline,
  summarizeApiChanges,
  type ApiChangeBaseline,
  type ApiChangeFingerprintBuildResult,
  type ApiChangeSnapshotVersion,
  type ApiChangeStatusMap,
  type ApiChangeSummary,
  type ApiChangeUnavailableReason,
  type ApiDocumentIdentity,
  type ApiOperationFingerprintMap,
  type Oas31ApiChangeEnvironment,
} from '../apiChange/apiChangeTracker';
import {
  getKnife4jStorageItem,
  setKnife4jStorageItem,
  subscribeKnife4jStorageCleanup,
  updateKnife4jStorageItem,
} from '../storage/knife4jStorage';
import { useGroup } from './GroupContext';
import {
  useExternalResources,
  useSchemaEngine,
  type ExternalResourceContextValue,
  type SchemaEngineContextValue,
} from './SchemaEngineContext';
import { useSettings } from './SettingsContext';

interface ApiChangeTrackerState {
  ready: boolean;
  scopeKey: string;
  identity: ApiDocumentIdentity | null;
  storageKey: string;
  snapshotVersion: ApiChangeSnapshotVersion | null;
  fingerprints: ApiOperationFingerprintMap;
  baseline: ApiChangeBaseline | null;
  statuses: ApiChangeStatusMap;
  unavailableReason: ApiChangeUnavailableReason | null;
}

interface ApiChangeContextValue {
  enabled: boolean;
  ready: boolean;
  scopeKey: string;
  statuses: ApiChangeStatusMap;
  summary: ApiChangeSummary;
  unavailableReason: ApiChangeUnavailableReason | null;
  acknowledgeOperation: (method: string, path: string) => void;
  acknowledgeAll: () => void;
}

function emptyStringRecord<T extends string>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function emptyState(scopeKey = '', unavailableReason: ApiChangeUnavailableReason | null = null): ApiChangeTrackerState {
  return {
    ready: false,
    scopeKey,
    identity: null,
    storageKey: '',
    snapshotVersion: null,
    fingerprints: emptyStringRecord<string>(),
    baseline: null,
    statuses: emptyStringRecord<'added' | 'changed'>(),
    unavailableReason,
  };
}

const EMPTY_SUMMARY: ApiChangeSummary = { added: 0, changed: 0, total: 0 };

const ApiChangeContext = createContext<ApiChangeContextValue>({
  enabled: false,
  ready: false,
  scopeKey: '',
  statuses: emptyStringRecord<'added' | 'changed'>(),
  summary: EMPTY_SUMMARY,
  unavailableReason: null,
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

function readBaseline(storage: Storage | null, key: string): string | null {
  if (!storage) return null;
  return getKnife4jStorageItem(storage, key);
}

function persistBaseline(storage: Storage | null, key: string, baseline: ApiChangeBaseline): void {
  if (!storage) return;
  const serialized = serializeApiChangeBaseline(baseline);
  if (!serialized) return;
  setKnife4jStorageItem(storage, key, serialized);
}

function oas31FingerprintEnvironment(
  schemaEngine: SchemaEngineContextValue,
  resources: ExternalResourceContextValue,
  documentDiagnostics: Oas31ApiChangeEnvironment['documentDiagnostics'],
): Oas31ApiChangeEnvironment {
  const snapshot = resources.snapshot;
  if (
    schemaEngine.status === 'loading' ||
    resources.status === 'discovering' ||
    resources.status === 'loading' ||
    (schemaEngine.status === 'inactive' && !snapshot)
  ) {
    return { status: 'preparing', retrievalUri: schemaEngine.retrievalUri, snapshot, documentDiagnostics };
  }

  const failure = resources.registrationError ?? (schemaEngine.status === 'error' ? schemaEngine.error : null);
  if (failure) {
    return {
      status: 'failed',
      retrievalUri: schemaEngine.retrievalUri,
      snapshot,
      documentDiagnostics,
      ...(failure.code ? { errorCode: failure.code } : {}),
    };
  }

  if (
    schemaEngine.status === 'ready' &&
    snapshot &&
    schemaEngine.retrievalUri === snapshot.entryRetrievalUri &&
    resources.documentScope === snapshot.documentScope
  ) {
    return { status: 'ready', retrievalUri: schemaEngine.retrievalUri, snapshot, documentDiagnostics };
  }

  return { status: 'failed', retrievalUri: schemaEngine.retrievalUri, snapshot, documentDiagnostics };
}

export const ApiChangeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings } = useSettings();
  const { activeSwaggerGroup, swaggerDoc, loading, documentDiagnostics } = useGroup();
  const schemaEngine = useSchemaEngine();
  const externalResources = useExternalResources();
  const [state, setState] = useState<ApiChangeTrackerState>(() => emptyState());
  const stateRef = useRef(state);

  const commitState = useCallback((nextState: ApiChangeTrackerState) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  // OAS 3.2 reuses this already-loaded graph environment. Fingerprinting collects
  // 3.2 structural diagnostics itself and does not treat metadata diagnostics as blockers.
  const oas31Environment = useMemo(
    () => oas31FingerprintEnvironment(schemaEngine, externalResources, documentDiagnostics),
    [documentDiagnostics, externalResources, schemaEngine],
  );

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
    let fingerprintResult: ApiChangeFingerprintBuildResult | null;
    try {
      fingerprintResult = buildApiChangeFingerprintSnapshot(swaggerDoc, oas31Environment);
    } catch {
      fingerprintResult = null;
    }

    const snapshotVersion = fingerprintResult?.snapshotVersion ?? null;
    const storageKey = snapshotVersion ? buildApiChangeBaselineStorageKey(identity, snapshotVersion) : '';
    if (!fingerprintResult || fingerprintResult.status === 'unavailable') {
      commitState(emptyState(storageKey, fingerprintResult?.reason ?? 'snapshot-unavailable'));
      return undefined;
    }
    const { fingerprints } = fingerprintResult;

    const storage = browserLocalStorage();
    const refresh = () => {
      const storedRaw = readBaseline(storage, storageKey);
      const reconciliation = reconcileApiChangeBaseline(
        identity,
        fingerprintResult.snapshotVersion,
        fingerprints,
        storedRaw,
      );
      const nextState: ApiChangeTrackerState = {
        ready: true,
        scopeKey: storageKey,
        identity,
        storageKey,
        snapshotVersion: fingerprintResult.snapshotVersion,
        fingerprints,
        baseline: reconciliation.baseline,
        statuses: reconciliation.statuses,
        unavailableReason: null,
      };
      commitState(nextState);
      if (reconciliation.initialized) {
        persistBaseline(storage, storageKey, reconciliation.baseline);
      }
    };

    refresh();
    const onStorage = (event: StorageEvent) => {
      if (storage && event.storageArea && event.storageArea !== storage) return;
      if (event.key === storageKey || event.key === null) {
        refresh();
      }
    };
    window.addEventListener('storage', onStorage);
    const unsubscribeCleanup = subscribeKnife4jStorageCleanup(() => refresh());
    return () => {
      window.removeEventListener('storage', onStorage);
      unsubscribeCleanup();
    };
  }, [activeSwaggerGroup, commitState, loading, oas31Environment, settings.enableVersion, swaggerDoc]);

  const acknowledgeOperation = useCallback(
    (method: string, path: string) => {
      const current = stateRef.current;
      const operationKey = apiOperationIdentity(method, path);
      if (
        !current.ready ||
        !current.identity ||
        !current.snapshotVersion ||
        !current.baseline ||
        !Object.prototype.hasOwnProperty.call(current.statuses, operationKey)
      ) {
        return;
      }

      const identity = current.identity;
      const snapshotVersion = current.snapshotVersion;
      const storage = browserLocalStorage();
      const nextBaseline = acknowledgeApiOperation(current.baseline, current.fingerprints, method, path);
      const nextState = {
        ...current,
        baseline: nextBaseline,
        statuses: compareApiChangeBaseline(nextBaseline, current.fingerprints),
      };
      commitState(nextState);
      if (!storage) return;

      const result = updateKnife4jStorageItem(storage, current.storageKey, (rawBaseline) => {
        const durableBaseline =
          parseApiChangeBaseline(rawBaseline, identity, snapshotVersion) ??
          acknowledgeAllApiOperations(identity, snapshotVersion, current.fingerprints);
        const mergedBaseline = acknowledgeApiOperation(durableBaseline, current.fingerprints, method, path);
        const serialized = serializeApiChangeBaseline(mergedBaseline);
        if (!serialized) throw new Error('API change baseline exceeds the storage limit');
        return serialized;
      });
      if (!result.persisted) return;
      const durableBaseline = parseApiChangeBaseline(result.value, identity, snapshotVersion);
      if (!durableBaseline) return;
      commitState({
        ...nextState,
        baseline: durableBaseline,
        statuses: compareApiChangeBaseline(durableBaseline, current.fingerprints),
      });
    },
    [commitState],
  );

  const acknowledgeAll = useCallback(() => {
    const current = stateRef.current;
    if (!current.ready || !current.identity || !current.snapshotVersion || !current.baseline) return;

    const nextBaseline = acknowledgeAllApiOperations(current.identity, current.snapshotVersion, current.fingerprints);
    const nextState = {
      ...current,
      baseline: nextBaseline,
      statuses: compareApiChangeBaseline(nextBaseline, current.fingerprints),
    };
    commitState(nextState);
    persistBaseline(browserLocalStorage(), current.storageKey, nextBaseline);
  }, [commitState]);

  const summary = useMemo(() => (state.ready ? summarizeApiChanges(state.statuses) : EMPTY_SUMMARY), [state]);
  const value = useMemo<ApiChangeContextValue>(
    () => ({
      enabled: settings.enableVersion,
      ready: state.ready,
      scopeKey: state.scopeKey,
      statuses: state.statuses,
      summary,
      unavailableReason: state.unavailableReason,
      acknowledgeOperation,
      acknowledgeAll,
    }),
    [acknowledgeAll, acknowledgeOperation, settings.enableVersion, state, summary],
  );

  return <ApiChangeContext.Provider value={value}>{children}</ApiChangeContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useApiChanges = (): ApiChangeContextValue => useContext(ApiChangeContext);
