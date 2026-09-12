import { useEffect, useState } from 'react';
import {
  evaluateOperationExample,
  exampleDefaultTarget,
  type OperationExampleCatalog,
  type OperationExampleResult,
} from './operationExampleCatalog';
import type { SchemaDocumentSession } from './schemaDocumentSession';

export function useOperationExampleDefaults(catalog: OperationExampleCatalog | null, session?: SchemaDocumentSession) {
  const [state, setState] = useState<{
    catalog: OperationExampleCatalog;
    session?: SchemaDocumentSession;
    results: ReadonlyMap<string, OperationExampleResult>;
  } | null>(null);
  useEffect(() => {
    if (!catalog || !session) return;
    const controller = new AbortController();
    void (async () => {
      const results = new Map<string, OperationExampleResult>();
      const groups = [
        ...new Set(catalog.targets.filter((target) => target.direction === 'request').map((target) => target.group)),
      ];
      for (const group of groups) {
        const target = exampleDefaultTarget(catalog.targets.filter((target) => target.group === group));
        if (target) results.set(group, await evaluateOperationExample(target, session, { signal: controller.signal }));
      }
      if (!controller.signal.aborted) setState({ catalog, session, results });
    })().catch(() => {
      /* Each visible picker retains the author value and reports unavailable evaluation. */
    });
    return () => controller.abort();
  }, [catalog, session]);
  return state?.catalog === catalog && state.session === session ? state.results : null;
}
