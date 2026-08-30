import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  isOas31SchemaDocument,
  schemaDocumentRetrievalUri,
  SchemaDocumentSessionManager,
  toSchemaDocumentFailure,
  type SchemaDocumentFailure,
  type SchemaDocumentSession,
} from '../schema/schemaDocumentSession';
import { useGroup } from './GroupContext';

export type SchemaEngineContextValue =
  | { status: 'inactive'; retrievalUri: null; session: null; error: null }
  | { status: 'loading'; retrievalUri: string; session: null; error: null }
  | { status: 'ready'; retrievalUri: string; session: SchemaDocumentSession; error: null }
  | { status: 'error'; retrievalUri: string; session: null; error: SchemaDocumentFailure };

const INACTIVE_STATE: SchemaEngineContextValue = Object.freeze({
  status: 'inactive',
  retrievalUri: null,
  session: null,
  error: null,
});

const SchemaEngineContext = createContext<SchemaEngineContextValue | null>(null);

export const SchemaEngineProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeSwaggerGroup, swaggerDoc, loading, routeGroupReady } = useGroup();
  const managerRef = useRef<SchemaDocumentSessionManager | null>(null);
  const [state, setState] = useState<SchemaEngineContextValue>(INACTIVE_STATE);

  if (!managerRef.current) managerRef.current = new SchemaDocumentSessionManager();

  useEffect(() => {
    const manager = managerRef.current!;
    if (loading || !routeGroupReady || !isOas31SchemaDocument(swaggerDoc) || !activeSwaggerGroup) {
      manager.clear();
      setState(INACTIVE_STATE);
      return;
    }

    let active = true;
    const retrievalUri = schemaDocumentRetrievalUri(activeSwaggerGroup.url, activeSwaggerGroup.name);
    setState({ status: 'loading', retrievalUri, session: null, error: null });

    manager
      .open(swaggerDoc, retrievalUri)
      .then((result) => {
        if (!active || result.status === 'stale') return;
        setState({ status: 'ready', retrievalUri, session: result.session, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({ status: 'error', retrievalUri, session: null, error: toSchemaDocumentFailure(error) });
      });

    return () => {
      active = false;
      manager.clear();
    };
  }, [activeSwaggerGroup, loading, routeGroupReady, swaggerDoc]);

  return <SchemaEngineContext.Provider value={state}>{children}</SchemaEngineContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSchemaEngine = (): SchemaEngineContextValue => {
  const context = useContext(SchemaEngineContext);
  if (!context) throw new Error('useSchemaEngine must be used inside SchemaEngineProvider');
  return context;
};
