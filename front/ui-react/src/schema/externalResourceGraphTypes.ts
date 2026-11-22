import type { ResourceLoadErrorCode } from './externalResourcePolicy';

export type ExpectedTargetKind =
  | 'schema'
  | 'path-item'
  | 'operation'
  | 'parameter'
  | 'request-body'
  | 'response'
  | 'header'
  | 'callback'
  | 'link'
  | 'example'
  | 'security-scheme'
  | 'media-type';

export type ResourceReferenceKind =
  | 'reference-object'
  | 'path-item-ref'
  | 'schema-ref'
  | 'schema-dynamic-ref'
  | 'link-operation-ref'
  | 'discriminator-mapping'
  | 'security-requirement';

export type ResourceDiagnosticPhase = 'discover' | 'authorize' | 'fetch' | 'read' | 'parse' | 'index' | 'register';

export interface ResourceLoadLimits {
  readonly maxResourceBytes: number;
  readonly maxTotalBytes: number;
  readonly maxDocuments: number;
  readonly maxReferences: number;
  readonly maxDepth: number;
  readonly maxParsedNodesPerDocument: number;
  readonly maxTotalParsedNodes: number;
  readonly maxSchemaResources: number;
  readonly maxConcurrency: number;
  readonly requestTimeoutMs: number;
  readonly waveTimeoutMs: number;
  readonly maxExplicitRetriesPerResource: number;
  readonly maxYamlAliases: number;
}

export const DEFAULT_RESOURCE_LOAD_LIMITS: Readonly<ResourceLoadLimits> = Object.freeze({
  maxResourceBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxDocuments: 64,
  maxReferences: 10_000,
  maxDepth: 32,
  maxParsedNodesPerDocument: 100_000,
  maxTotalParsedNodes: 250_000,
  maxSchemaResources: 1_000,
  maxConcurrency: 4,
  requestTimeoutMs: 10_000,
  waveTimeoutMs: 30_000,
  maxExplicitRetriesPerResource: 1,
  maxYamlAliases: 100,
});

export interface ResourceReferenceEvidence {
  readonly sourceDocumentUriHash: string;
  readonly sourcePointer: string;
  readonly kind: ResourceReferenceKind;
  readonly rawReferenceDisplay: string;
  readonly resolutionBaseDisplay: string;
  readonly fragment: string;
}

export interface ResourceCandidate {
  readonly retrievalUri: string;
  readonly retrievalUriHash: string;
  readonly displayUri: string;
  readonly sameOrigin: boolean;
  readonly depth: number;
  readonly state: 'pending' | 'failed';
  readonly retryable: boolean;
  readonly failureCode?: ResourceLoadErrorCode;
  readonly references: readonly ResourceReferenceEvidence[];
}

export interface ResourceGrant {
  readonly scope: 'generation' | 'document';
  readonly documentScope: string;
  readonly resourceKey: string;
}

export interface ResourceGraphNode {
  readonly retrievalUri: string;
  readonly retrievalUriHash: string;
  readonly displayUri: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly contentDigest: string;
  readonly documentKind: 'openapi' | 'json-schema' | 'referenceable-object';
  /** OAS 3.2 identity metadata; retrievalUri remains the authorization/cache key. */
  readonly openApiVersion?: string;
  readonly selfUri?: string;
  readonly documentBaseUri?: string;
  readonly authorizationScope: 'entry' | ResourceGrant['scope'];
  readonly resourceUris: readonly string[];
  readonly document: unknown;
}

export interface ResourceGraphEdge {
  readonly sourceRetrievalUri: string;
  readonly sourcePointer: string;
  readonly kind: ResourceReferenceKind;
  readonly resolvedUri: string;
  readonly targetRetrievalUri: string;
  readonly fragment: string;
  readonly state: 'local' | 'pending' | 'loaded' | 'failed';
  /** Target resolved by the existing controlled graph; consumers must not repeat URI/alias resolution. */
  readonly target?: Pick<ResourceGraphTarget, 'ownerRetrievalUri' | 'pointer'>;
}

/** Immutable location metadata for a resource or anchor already indexed by the graph. */
export interface ResourceGraphTarget {
  readonly ownerRetrievalUri: string;
  readonly pointer: string;
  readonly evaluationBaseUri: string;
}

/** Frozen projection of the graph's typed object index; carries no loader capability. */
export interface ResourceGraphObject extends ResourceGraphTarget {
  /** Physical parent already recorded while indexing an Operation; never inferred by consumers. */
  readonly operationPathItemPointer?: string;
  readonly kind: ExpectedTargetKind | 'openapi';
  readonly schemaDialect?: string;
}

export interface ResourceDiagnostic {
  readonly code: ResourceLoadErrorCode;
  readonly phase: ResourceDiagnosticPhase;
  readonly sourceRetrievalUriHash: string;
  readonly sourcePointer: string;
  readonly referenceKind: ResourceReferenceKind;
  readonly rawReferenceDisplay: string;
  readonly resolutionBaseDisplay: string;
  readonly targetRetrievalUriHash?: string;
  readonly resourceDisplay?: string;
  readonly limit?: number;
  readonly actual?: number;
  readonly generation: number;
  readonly retryable: boolean;
}

export interface ResourceGraphSnapshot {
  readonly generation: number;
  readonly entryRetrievalUri: string;
  readonly documentScope: string;
  readonly nodes: ReadonlyMap<string, ResourceGraphNode>;
  readonly resourceTargets: ReadonlyMap<string, ResourceGraphTarget>;
  readonly anchorTargets: ReadonlyMap<string, ResourceGraphTarget>;
  /** Full $self identities, including non-empty fragments. */
  readonly documentTargets: ReadonlyMap<string, ResourceGraphTarget>;
  readonly objectLocations: readonly ResourceGraphObject[];
  readonly edges: readonly ResourceGraphEdge[];
  readonly diagnostics: readonly ResourceDiagnostic[];
  readonly complete: boolean;
}

export interface ResourceDiscovery {
  readonly generation: number;
  readonly documentScope: string;
  readonly candidates: readonly ResourceCandidate[];
  readonly diagnostics: readonly ResourceDiagnostic[];
}

export interface ExternalResourceLoaderOptions {
  readonly pageUri?: string;
  readonly limits?: Partial<ResourceLoadLimits>;
  readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}
