import type { OpenApiObjectLocation, OpenApiOperation } from '../openapiOperations';
import type { ExampleCheck, ExampleLayer } from './exampleRepresentation';
import type { Oas31ParameterSerialization, ParameterInstance, ParamIn, SchemaValue } from './types';
import type { SerializedQueryParameter } from './parameterSerialization';

export type Oas32ParamIn = ParamIn | 'querystring';

/** Diagnostics do not stand in for JSON Schema evaluation. Only the Schema session can do that. */
export interface Oas32ParameterDiagnostic {
  readonly phase: 'declaration' | 'input' | 'serialization' | 'pairing' | 'transport' | 'browser';
  readonly code: string;
  readonly message: string;
  readonly key?: string;
  readonly location?: OpenApiObjectLocation;
  readonly source?: 'application' | 'global' | 'custom' | 'auth' | 'base-url';
  readonly name?: string;
  readonly blocks: 'all' | 'browser' | 'none';
}

/** No fetch capability: callers supply C's typed, already resolved edges and D's Schema projection. */
export interface Oas32ParameterContext {
  readonly resolveReference?: (
    location: OpenApiObjectLocation,
    kind: 'parameter' | 'media-type',
  ) => OpenApiObjectLocation | null;
  readonly documentFor?: (location: OpenApiObjectLocation) => Record<string, unknown> | undefined;
  readonly schemaView?: (location: OpenApiObjectLocation) => SchemaValue | undefined;
}

export interface Oas32Parameter {
  readonly key: string;
  readonly name: string;
  readonly in: Oas32ParamIn;
  readonly required: boolean;
  readonly location: OpenApiObjectLocation;
  readonly declarationLocation: OpenApiObjectLocation;
  readonly raw: Readonly<Record<string, unknown>>;
  readonly serialization?: Oas31ParameterSerialization;
  readonly mediaLocation?: OpenApiObjectLocation;
  readonly schemaLocation?: OpenApiObjectLocation;
  readonly schemaReference?: string;
  readonly schema?: SchemaValue;
  /** Codec hints only; never replaces the actual Schema or its physical evaluation location. */
  readonly schemaView?: SchemaValue;
  readonly itemSchemaLocation?: OpenApiObjectLocation;
  readonly itemSchemaReference?: string;
}

export interface Oas32ParameterCollection {
  readonly version: '3.2';
  readonly operation: OpenApiOperation;
  readonly parameters: readonly Oas32Parameter[];
  /** Includes overridden and unavailable declarations, so completeness is observable. */
  readonly declarations: readonly {
    readonly site: OpenApiObjectLocation;
    readonly target?: OpenApiObjectLocation;
    readonly scope: 'path' | 'operation';
  }[];
  readonly complete: boolean;
  readonly diagnostics: readonly Oas32ParameterDiagnostic[];
}

/** Carries G's actual author identity, physical locations and lifecycle token through the pure codec. */
export interface Oas32ParameterProvenance {
  readonly id: string;
  readonly layer: ExampleLayer;
  readonly sourceLocation: OpenApiObjectLocation;
  readonly containerLocation?: OpenApiObjectLocation;
  readonly mediaLocation?: OpenApiObjectLocation;
  readonly schemaLocation?: OpenApiObjectLocation;
  readonly schemaReference?: string;
  readonly itemSchemaLocation?: OpenApiObjectLocation;
  readonly operationIdentity?: string;
  readonly generation?: number;
  readonly editRevision?: number;
  readonly session?: unknown;
}

export type Oas32ParameterInput = (
  | { readonly kind: 'absent' | 'browser-session' }
  | { readonly kind: 'data'; readonly value: ParameterInstance }
  | { readonly kind: 'media' | 'parameter'; readonly text: string; readonly data?: ParameterInstance }
  /** Explicit editor syntax, not a wire decoder. Kept separate from author parameter text. */
  | { readonly kind: 'editor'; readonly text: string }
) & { readonly provenance?: Oas32ParameterProvenance };

export interface Oas32CookiePair {
  readonly name: string;
  readonly value: string;
  readonly raw: string;
  readonly parameterKey: string;
}

export interface Oas32ParameterResult {
  readonly parameter: Oas32Parameter;
  readonly input: Oas32ParameterInput;
  readonly present: boolean | 'unknown';
  readonly data?: ParameterInstance;
  readonly decodedData?: ParameterInstance;
  readonly dataStatus: 'available' | 'unavailable' | 'absent';
  readonly mediaText?: string;
  readonly parameterText?: string;
  readonly serialization: ExampleCheck;
  readonly pairing: ExampleCheck;
  readonly diagnostics: readonly Oas32ParameterDiagnostic[];
}

export interface Oas32ParameterPlan {
  readonly results: readonly Oas32ParameterResult[];
  readonly path: Readonly<Record<string, string>>;
  readonly query: readonly SerializedQueryParameter[];
  readonly headers: readonly { readonly name: string; readonly value: string; readonly parameterKey: string }[];
  readonly cookies: readonly Oas32CookiePair[];
  /** Author/OAS style text; form's '&' is not silently repaired to RFC6265 '; '. */
  readonly cookieText: string;
  readonly wholeQuery?: {
    readonly key: string;
    readonly present: boolean;
    readonly component?: string;
    readonly mediaType: string;
  };
  readonly presence: Readonly<Record<string, boolean | 'unknown'>>;
  readonly diagnostics: readonly Oas32ParameterDiagnostic[];
}
