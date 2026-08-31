import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { BodyContent, OperationDebugModel } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import { initialBodyValueForContent, initialFormFieldsForContent } from './debugDefaultValues';
import {
  canHydrateOas31DebugDefaults,
  generateOas31DebugBodyExamples,
  sameOas31DebugExampleIdentity,
  type Oas31DebugBodyExamples,
  type Oas31DebugExampleIdentity,
  type Oas31DebugExampleState,
} from './oas31DebugExamples';

type GenerateDebugExamples = typeof generateOas31DebugBodyExamples;

export interface Oas31DebugExampleLoaderProps {
  readonly enabled: boolean;
  readonly document: SwaggerDoc | null;
  readonly operation: MenuOperation | null;
  readonly debugModel: OperationDebugModel | null;
  readonly session: SchemaDocumentSession | null;
  readonly identity: Oas31DebugExampleIdentity | null;
  readonly setState: Dispatch<SetStateAction<Oas31DebugExampleState>>;
  readonly generateExamples?: GenerateDebugExamples;
}

export function Oas31DebugExampleLoader({
  enabled,
  document,
  operation,
  debugModel,
  session,
  identity,
  setState,
  generateExamples = generateOas31DebugBodyExamples,
}: Oas31DebugExampleLoaderProps) {
  useEffect(() => {
    if (!enabled || !document || !operation || !debugModel || !session || !identity) {
      setState({ status: 'idle' });
      return;
    }

    const controller = new AbortController();
    setState({ status: 'loading', identity });
    generateExamples(document, operation, debugModel, session, { signal: controller.signal })
      .then((examples) => {
        if (!controller.signal.aborted) setState({ status: 'ready', identity, examples });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || (reason instanceof Error && reason.name === 'AbortError')) return;
        setState({
          status: 'error',
          identity,
          message: reason instanceof Error ? reason.message : 'Unable to generate OAS 3.1 debug examples.',
        });
      });
    return () => controller.abort();
  }, [debugModel, document, enabled, generateExamples, identity, operation, session, setState]);

  return null;
}

export interface Oas31DebugDefaultHydratorProps {
  readonly activeExamples: Oas31DebugBodyExamples | null;
  readonly state: Oas31DebugExampleState;
  readonly identity: Oas31DebugExampleIdentity | null;
  readonly editRevisionRef: MutableRefObject<number>;
  readonly appliedIdentityRef: MutableRefObject<Oas31DebugExampleIdentity | null>;
  readonly hydratedDebugCacheKey: string | null;
  readonly currentDebugCacheKey: string | null;
  readonly selectedBody: BodyContent | undefined;
  readonly setBody: Dispatch<SetStateAction<string>>;
  readonly setFormFields: Dispatch<SetStateAction<Record<string, string>>>;
}

export function Oas31DebugDefaultHydrator({
  activeExamples,
  state,
  identity,
  editRevisionRef,
  appliedIdentityRef,
  hydratedDebugCacheKey,
  currentDebugCacheKey,
  selectedBody,
  setBody,
  setFormFields,
}: Oas31DebugDefaultHydratorProps) {
  useEffect(() => {
    const hydrationState: Oas31DebugExampleState =
      activeExamples && identity ? { status: 'ready', identity, examples: activeExamples } : state;
    const alreadyApplied = sameOas31DebugExampleIdentity(appliedIdentityRef.current, identity);
    if (
      !canHydrateOas31DebugDefaults({
        state: hydrationState,
        currentIdentity: identity,
        editRevision: editRevisionRef.current,
        hydratedDebugCacheKey,
        currentDebugCacheKey,
        alreadyApplied,
      })
    ) {
      return;
    }
    if (hydrationState.status !== 'ready') return;

    setBody(initialBodyValueForContent(selectedBody, hydrationState.examples.defaults));
    setFormFields(initialFormFieldsForContent(selectedBody, hydrationState.examples.defaults));
    appliedIdentityRef.current = hydrationState.identity;
  }, [
    activeExamples,
    appliedIdentityRef,
    currentDebugCacheKey,
    editRevisionRef,
    hydratedDebugCacheKey,
    identity,
    selectedBody,
    setBody,
    setFormFields,
    state,
  ]);

  return null;
}
