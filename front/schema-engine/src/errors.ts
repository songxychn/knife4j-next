export type SchemaEngineErrorCode =
  | 'INVALID_DOCUMENT'
  | 'INVALID_INSTANCE'
  | 'INVALID_URI'
  | 'UNSUPPORTED_DIALECT'
  | 'DOCUMENT_ALREADY_REGISTERED'
  | 'RESOURCE_URI_CONFLICT'
  | 'RESOURCE_NOT_REGISTERED'
  | 'SCHEMA_RESOLUTION_FAILED'
  | 'EXTERNAL_RESOURCE_LOADING_DISABLED'
  | 'SCHEMA_BUDGET_EXCEEDED'
  | 'INSTANCE_BUDGET_EXCEEDED'
  | 'EVALUATION_BUDGET_EXCEEDED'
  | 'OPERATION_ABORTED'
  | 'ENGINE_SCOPE_CONFLICT'
  | 'ENGINE_STATE_CHANGED'
  | 'ENGINE_DISPOSED';

export interface SchemaEngineErrorDetails {
  uri?: string;
  resourceUri?: string;
  limit?: number;
  actual?: number;
}

export class SchemaEngineError extends Error {
  public readonly code: SchemaEngineErrorCode;
  public readonly details: Readonly<SchemaEngineErrorDetails>;

  public constructor(
    code: SchemaEngineErrorCode,
    message: string,
    details: SchemaEngineErrorDetails = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SchemaEngineError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
