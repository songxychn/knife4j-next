import type { EvaluationResult, SchemaDocumentRegistrationContext, SchemaNode } from 'knife4j-schema-engine';
import type { SwaggerDoc } from '../types/swagger';
import type { SchemaDocumentResource } from './schemaDocumentSession';
import type { SchemaEvaluationDirection } from './schemaDirectionProjection';
import type { GenerateSchemaExampleOptions, SchemaExampleResult } from './schemaExampleGeneration';
import type { SelectedAuthoredExample } from './schemaExampleAuthored';

/** Complete already-authorized source graph, with the original retrieval identity and typed OAS positions. */
export interface SchemaWorkerSource {
  readonly id: number;
  readonly document: SwaggerDoc;
  readonly retrievalUri: string;
  readonly resourceDocuments: readonly SchemaDocumentResource[];
  readonly registrationContext?: SchemaDocumentRegistrationContext;
}

export type SchemaWorkerCommand =
  | { readonly method: 'open' }
  | { readonly method: 'resolve'; readonly reference: string }
  | { readonly method: 'evaluate'; readonly reference: string; readonly instance: unknown }
  | {
      readonly method: 'directional';
      readonly reference: string;
      readonly instance: unknown;
      readonly direction: SchemaEvaluationDirection;
      readonly ignoredProperties?: readonly string[];
    }
  | {
      readonly method: 'generate';
      readonly reference: string;
      readonly options: Omit<GenerateSchemaExampleOptions, 'signal'>;
    };

export interface SchemaWorkerRequest {
  readonly id: number;
  readonly sourceId: number;
  readonly source?: SchemaWorkerSource;
  readonly command: SchemaWorkerCommand;
}

export interface SchemaWorkerError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly details?: unknown;
}

export type SchemaWorkerResponse =
  | {
      readonly id: number;
      readonly sourceId: number;
      readonly result: SchemaNode | EvaluationResult | SchemaExampleResult | null;
    }
  | { readonly id: number; readonly sourceId: number; readonly error: SchemaWorkerError }
  | { readonly id: number; readonly sourceId: number; readonly authored: SelectedAuthoredExample };

export const SCHEMA_WORKER_TASK_TIMEOUT_MS = 2_000;
