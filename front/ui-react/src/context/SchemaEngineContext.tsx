import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalResourceLoader,
  schemaDocumentsFromResourceGraph,
  type ResourceCandidate,
  type ResourceDiagnostic,
  type ResourceGrant,
  type ResourceGraphSnapshot,
} from '../schema/externalResourceGraph';
import { readRememberedResourceGrants, rememberResourceGrants } from '../schema/resourceGrantStorage';
import {
  isOas31SchemaDocument,
  schemaDocumentRetrievalUri,
  SchemaDocumentSessionManager,
  toSchemaDocumentFailure,
  type SchemaDocumentFailure,
  type SchemaDocumentSession,
} from '../schema/schemaDocumentSession';
import type { SwaggerDoc } from '../types/swagger';
import { resourceGrantsForOperation } from './resourceOperationGrants';
import { useGroup } from './GroupContext';

export type SchemaEngineContextValue =
  | { status: 'inactive'; retrievalUri: null; session: null; error: null }
  | { status: 'loading'; retrievalUri: string; session: null; error: null }
  | { status: 'ready'; retrievalUri: string; session: SchemaDocumentSession; error: null }
  | { status: 'error'; retrievalUri: string; session: null; error: SchemaDocumentFailure };

export type ExternalResourceStatus =
  'inactive' | 'discovering' | 'pending' | 'loading' | 'ready' | 'partial' | 'failed';

export interface ExternalResourceContextValue {
  readonly status: ExternalResourceStatus;
  readonly generation: number;
  readonly documentScope: string | null;
  readonly candidates: readonly ResourceCandidate[];
  readonly diagnostics: readonly ResourceDiagnostic[];
  readonly snapshot: ResourceGraphSnapshot | null;
  readonly registrationError: SchemaDocumentFailure | null;
  loadOnce(resourceKeys: readonly string[]): Promise<void>;
  rememberAndLoad(resourceKeys: readonly string[]): Promise<boolean>;
  retry(resourceKey: string): Promise<void>;
  cancel(): void;
}

interface ExternalResourceData {
  readonly status: ExternalResourceStatus;
  readonly generation: number;
  readonly documentScope: string | null;
  readonly candidates: readonly ResourceCandidate[];
  readonly diagnostics: readonly ResourceDiagnostic[];
  readonly snapshot: ResourceGraphSnapshot | null;
  readonly registrationError: SchemaDocumentFailure | null;
}

interface ActiveResourceRuntime {
  readonly revision: number;
  readonly document: SwaggerDoc;
  readonly retrievalUri: string;
  readonly loader: ExternalResourceLoader;
  readonly rememberedGrantKeys: Set<string>;
  operationRevision: number;
}

const INACTIVE_STATE: SchemaEngineContextValue = Object.freeze({
  status: 'inactive',
  retrievalUri: null,
  session: null,
  error: null,
});

const INACTIVE_RESOURCES: ExternalResourceData = Object.freeze({
  status: 'inactive',
  generation: 0,
  documentScope: null,
  candidates: Object.freeze([]),
  diagnostics: Object.freeze([]),
  snapshot: null,
  registrationError: null,
});

const SchemaEngineContext = createContext<SchemaEngineContextValue | null>(null);
const ExternalResourceContext = createContext<ExternalResourceContextValue | null>(null);

function resourceData(
  loader: ExternalResourceLoader,
  snapshot: ResourceGraphSnapshot,
  statusOverride?: ExternalResourceStatus,
  registrationError: SchemaDocumentFailure | null = null,
): ExternalResourceData {
  const discovery = loader.currentDiscovery();
  const pending = discovery.candidates.some((candidate) => candidate.state === 'pending');
  const failed =
    discovery.candidates.some((candidate) => candidate.state === 'failed') ||
    snapshot.diagnostics.some((diagnostic) => diagnostic.code !== 'LEGACY_MEDIA_TYPE');
  let status: ExternalResourceStatus;
  if (statusOverride) status = statusOverride;
  else if (snapshot.complete && !failed) status = 'ready';
  else if (snapshot.nodes.size > 1) status = 'partial';
  else if (pending) status = 'pending';
  else status = 'failed';
  return Object.freeze({
    status,
    generation: snapshot.generation,
    documentScope: snapshot.documentScope,
    candidates: discovery.candidates,
    diagnostics: snapshot.diagnostics,
    snapshot,
    registrationError,
  });
}

function grantsFor(runtime: ActiveResourceRuntime, selectedGrantKeys: readonly string[] = []): ResourceGrant[] {
  return resourceGrantsForOperation(runtime.loader.documentScope, runtime.rememberedGrantKeys, selectedGrantKeys);
}

function selectedCandidateKeys(runtime: ActiveResourceRuntime, resourceKeys: readonly string[]): string[] {
  const requested = new Set(resourceKeys);
  return runtime.loader
    .currentDiscovery()
    .candidates.filter((candidate) => requested.has(candidate.retrievalUriHash))
    .map((candidate) => candidate.retrievalUriHash);
}

export const SchemaEngineProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeSwaggerGroup, swaggerDoc, loading, routeGroupReady } = useGroup();
  const managerRef = useRef<SchemaDocumentSessionManager | null>(null);
  const runtimeRef = useRef<ActiveResourceRuntime | null>(null);
  const revisionRef = useRef(0);
  const [state, setState] = useState<SchemaEngineContextValue>(INACTIVE_STATE);
  const [resources, setResources] = useState<ExternalResourceData>(INACTIVE_RESOURCES);

  if (!managerRef.current) managerRef.current = new SchemaDocumentSessionManager();

  const isCurrent = useCallback((runtime: ActiveResourceRuntime): boolean => runtimeRef.current === runtime, []);

  const openSnapshot = useCallback(
    async (
      runtime: ActiveResourceRuntime,
      snapshot: ResourceGraphSnapshot,
      operationRevision = runtime.operationRevision,
    ): Promise<void> => {
      const isCurrentOperation = (): boolean => isCurrent(runtime) && runtime.operationRevision === operationRevision;
      if (!isCurrentOperation()) return;
      setState({ status: 'loading', retrievalUri: runtime.retrievalUri, session: null, error: null });
      try {
        const result = await managerRef.current!.open(runtime.document, runtime.retrievalUri, {
          resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
        });
        if (!isCurrentOperation() || result.status === 'stale') return;
        setState({ status: 'ready', retrievalUri: runtime.retrievalUri, session: result.session, error: null });
        setResources(resourceData(runtime.loader, snapshot));
      } catch (error) {
        if (!isCurrentOperation()) return;
        const registrationError = toSchemaDocumentFailure(error);
        try {
          const fallback = await managerRef.current!.open(runtime.document, runtime.retrievalUri);
          if (!isCurrentOperation() || fallback.status === 'stale') return;
          setState({ status: 'ready', retrievalUri: runtime.retrievalUri, session: fallback.session, error: null });
          setResources(resourceData(runtime.loader, snapshot, 'failed', registrationError));
        } catch (fallbackError) {
          if (!isCurrentOperation()) return;
          setState({
            status: 'error',
            retrievalUri: runtime.retrievalUri,
            session: null,
            error: toSchemaDocumentFailure(fallbackError),
          });
          setResources(resourceData(runtime.loader, snapshot, 'failed', registrationError));
        }
      }
    },
    [isCurrent],
  );

  const applyGraphOperation = useCallback(
    async (runtime: ActiveResourceRuntime, operation: () => Promise<ResourceGraphSnapshot>): Promise<void> => {
      if (!isCurrent(runtime)) return;
      runtime.operationRevision += 1;
      const operationRevision = runtime.operationRevision;
      setResources(resourceData(runtime.loader, runtime.loader.currentSnapshot(), 'loading'));
      try {
        const snapshot = await operation();
        if (!isCurrent(runtime) || runtime.operationRevision !== operationRevision) return;
        await openSnapshot(runtime, snapshot, operationRevision);
      } catch (error) {
        if (!isCurrent(runtime) || runtime.operationRevision !== operationRevision) return;
        setResources(
          resourceData(runtime.loader, runtime.loader.currentSnapshot(), 'failed', toSchemaDocumentFailure(error)),
        );
      }
    },
    [isCurrent, openSnapshot],
  );

  const loadOnce = useCallback(
    async (resourceKeys: readonly string[]): Promise<void> => {
      const runtime = runtimeRef.current;
      if (!runtime || resourceKeys.length === 0) return;
      const selectedKeys = selectedCandidateKeys(runtime, resourceKeys);
      if (selectedKeys.length === 0) return;
      await applyGraphOperation(runtime, () => runtime.loader.load(grantsFor(runtime, selectedKeys)));
    },
    [applyGraphOperation],
  );

  const rememberAndLoad = useCallback(
    async (resourceKeys: readonly string[]): Promise<boolean> => {
      const runtime = runtimeRef.current;
      if (!runtime || resourceKeys.length === 0) return false;
      const requested = new Set(resourceKeys);
      const selected = runtime.loader
        .currentDiscovery()
        .candidates.filter((candidate) => requested.has(candidate.retrievalUriHash));
      if (selected.length === 0) return false;
      const selectedKeys = selected.map((candidate) => candidate.retrievalUriHash);
      const persisted = await rememberResourceGrants(runtime.loader.documentScope, selected);
      if (!isCurrent(runtime)) return persisted;
      selectedKeys.forEach((key) => {
        if (persisted) runtime.rememberedGrantKeys.add(key);
      });
      await applyGraphOperation(runtime, () => runtime.loader.load(grantsFor(runtime, selectedKeys)));
      return persisted;
    },
    [applyGraphOperation, isCurrent],
  );

  const retry = useCallback(
    async (resourceKey: string): Promise<void> => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      await applyGraphOperation(runtime, () => runtime.loader.retry(resourceKey));
    },
    [applyGraphOperation],
  );

  const cancel = useCallback((): void => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.operationRevision += 1;
    runtime.loader.cancel();
    setResources(resourceData(runtime.loader, runtime.loader.currentSnapshot()));
  }, []);

  useEffect(() => {
    const manager = managerRef.current!;
    revisionRef.current += 1;
    runtimeRef.current?.loader.dispose();
    runtimeRef.current = null;
    if (loading || !routeGroupReady || !isOas31SchemaDocument(swaggerDoc) || !activeSwaggerGroup) {
      manager.clear();
      setState(INACTIVE_STATE);
      setResources(INACTIVE_RESOURCES);
      return;
    }

    let active = true;
    const revision = revisionRef.current;
    const retrievalUri = schemaDocumentRetrievalUri(activeSwaggerGroup.url, activeSwaggerGroup.name);
    setState({ status: 'loading', retrievalUri, session: null, error: null });
    setResources({ ...INACTIVE_RESOURCES, status: 'discovering' });

    const initialize = async (): Promise<void> => {
      let runtime: ActiveResourceRuntime | null = null;
      try {
        const loader = new ExternalResourceLoader(swaggerDoc, retrievalUri, {
          pageUri: globalThis.location?.href ?? retrievalUri,
        });
        const remembered = readRememberedResourceGrants(loader.documentScope).map((grant) => grant.resourceKey);
        runtime = {
          revision,
          document: swaggerDoc,
          retrievalUri,
          loader,
          rememberedGrantKeys: new Set(remembered),
          operationRevision: 0,
        };
        runtimeRef.current = runtime;
        const discovery = loader.discover();
        const rememberedCandidates = discovery.candidates.filter((candidate) =>
          runtime!.rememberedGrantKeys.has(candidate.retrievalUriHash),
        );
        let snapshot = loader.currentSnapshot();
        if (rememberedCandidates.length > 0) {
          setResources(resourceData(loader, snapshot, 'loading'));
          snapshot = await loader.load(grantsFor(runtime));
        }
        if (!active || runtimeRef.current !== runtime) return;
        await openSnapshot(runtime, snapshot);
      } catch (error) {
        if (!active || (runtime && runtimeRef.current !== runtime)) return;
        setState({ status: 'error', retrievalUri, session: null, error: toSchemaDocumentFailure(error) });
        setResources({
          ...INACTIVE_RESOURCES,
          status: 'failed',
          registrationError: toSchemaDocumentFailure(error),
        });
      }
    };
    void initialize();

    return () => {
      active = false;
      if (runtimeRef.current?.revision === revision) {
        runtimeRef.current.loader.dispose();
        runtimeRef.current = null;
      }
      manager.clear();
    };
  }, [activeSwaggerGroup, loading, openSnapshot, routeGroupReady, swaggerDoc]);

  const externalResourceValue = useMemo<ExternalResourceContextValue>(
    () => ({ ...resources, loadOnce, rememberAndLoad, retry, cancel }),
    [cancel, loadOnce, rememberAndLoad, resources, retry],
  );

  return (
    <SchemaEngineContext.Provider value={state}>
      <ExternalResourceContext.Provider value={externalResourceValue}>{children}</ExternalResourceContext.Provider>
    </SchemaEngineContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSchemaEngine = (): SchemaEngineContextValue => {
  const context = useContext(SchemaEngineContext);
  if (!context) throw new Error('useSchemaEngine must be used inside SchemaEngineProvider');
  return context;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useExternalResources = (): ExternalResourceContextValue => {
  const context = useContext(ExternalResourceContext);
  if (!context) throw new Error('useExternalResources must be used inside SchemaEngineProvider');
  return context;
};
