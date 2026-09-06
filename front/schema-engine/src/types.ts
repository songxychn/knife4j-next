export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface SchemaNode {
  requestedUri: string;
  canonicalUri: string;
  resourceUri: string;
  dialectId: string;
  anchors: Readonly<Record<string, string>>;
  dynamicAnchors: Readonly<Record<string, string>>;
  schema: JsonValue;
}

export interface EvaluationIssue {
  keyword: string;
  absoluteKeywordLocation: string;
  instanceLocation: string;
  valid: boolean;
  annotation?: unknown;
  errors?: EvaluationIssue[];
}

export interface EvaluationAnnotation {
  instanceLocation: string;
  keywordId: string;
  values: unknown[];
}

export interface EvaluationResult {
  valid: boolean;
  errors: EvaluationIssue[];
  annotations: EvaluationAnnotation[];
}

export interface EvaluationOptions {
  signal?: AbortSignal;
}

export interface SchemaEngineLimits {
  maxSchemaNodes: number;
  maxSchemaDepth: number;
  maxResourcesPerDocument: number;
  maxReferencesPerDocument: number;
  maxInstanceNodes: number;
  maxInstanceDepth: number;
  maxEvaluationSteps: number;
  maxEvaluationMs: number;
}

export interface SchemaEngineOptions {
  limits?: Partial<SchemaEngineLimits>;
}

/** Locations come from a typed OAS traversal, never from payload-shape inference. */
export interface SchemaLocationMetadata {
  readonly pointer: string;
  /** Public base before this Schema Object's own $id is applied. */
  readonly evaluationBaseUri: string;
  readonly schemaDialect?: string;
}

export interface SchemaDocumentRegistrationContext {
  readonly openapi32: true;
  readonly documentBaseUri?: string;
  readonly selfUri?: string;
  readonly schemaLocations: readonly SchemaLocationMetadata[];
  readonly aliases?: readonly { readonly uri: string; readonly pointer: string }[];
}

export interface SchemaEngine {
  registerDocument(document: unknown, retrievalUri: string, context?: SchemaDocumentRegistrationContext): Promise<void>;
  resolve(schemaUri: string): Promise<SchemaNode>;
  evaluate(schemaUri: string, instance: unknown, options?: EvaluationOptions): Promise<EvaluationResult>;
  unregisterDocument(retrievalUri: string): void;
  dispose(): void;
}
