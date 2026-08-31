import type { OperationSchemaExamples } from '../../schema/operationSchemaExamples';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import type { SwaggerDoc } from '../../types/swagger';

export interface ApiDocExampleIdentity {
  readonly document: SwaggerDoc;
  readonly session: SchemaDocumentSession;
  readonly retrievalUri: string;
  readonly operationKey: string;
}

export type ApiDocExampleState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly identity: ApiDocExampleIdentity }
  | {
      readonly status: 'ready';
      readonly identity: ApiDocExampleIdentity;
      readonly examples: OperationSchemaExamples;
    }
  | { readonly status: 'error'; readonly identity: ApiDocExampleIdentity; readonly message: string };

export function sameApiDocExampleIdentity(
  left: ApiDocExampleIdentity | null,
  right: ApiDocExampleIdentity | null,
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.document === right.document &&
    left.session === right.session &&
    left.retrievalUri === right.retrievalUri &&
    left.operationKey === right.operationKey
  );
}

export function currentApiDocExamples(
  state: ApiDocExampleState,
  identity: ApiDocExampleIdentity | null,
): OperationSchemaExamples | null {
  return state.status === 'ready' && sameApiDocExampleIdentity(state.identity, identity) ? state.examples : null;
}
