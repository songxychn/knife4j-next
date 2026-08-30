import type { SchemaFieldNode } from 'knife4j-core';
import type { JsonValue } from 'knife4j-schema-engine';
import type { SchemaDisplayProjector, SchemaProjectionDiagnostic } from '../../schema/schemaDisplayProjection';
import type { OperationObject } from '../../types/swagger';
import { applyValidationGroupRequiredFields } from './validationGroups';

const API_DOC_PROJECTION_CONCURRENCY = 4;

export const REQUEST_BODY_REGION_KEY = 'requestBody';

export function responseSchemaRegionKey(statusCode: string): string {
  return `response:${statusCode}`;
}

export type ApiDocSchemaAccessMode = 'request' | 'response';

export interface ApiDocSchemaProjectionTarget {
  readonly key: string;
  readonly schema: JsonValue;
  readonly mode: ApiDocSchemaAccessMode;
  readonly operation?: OperationObject;
}

export interface ApiDocSchemaProjectedRegion {
  readonly key: string;
  readonly fields: SchemaFieldNode[];
}

export interface ApiDocSchemaProjectionDiagnostic extends SchemaProjectionDiagnostic {
  readonly regionKey: string;
}

export interface ApiDocSchemaProjectionFailure {
  readonly regionKey: string;
  readonly code?: string;
  readonly message: string;
}

export interface ApiDocSchemaProjection {
  readonly regions: ApiDocSchemaProjectedRegion[];
  readonly diagnostics: ApiDocSchemaProjectionDiagnostic[];
  readonly failures: ApiDocSchemaProjectionFailure[];
}

export interface ProjectApiDocSchemaRegionsOptions {
  readonly signal?: AbortSignal;
}

interface ProjectionAttempt {
  readonly region?: ApiDocSchemaProjectedRegion;
  readonly diagnostics: ApiDocSchemaProjectionDiagnostic[];
  readonly failure?: ApiDocSchemaProjectionFailure;
}

function abortError(): Error {
  const error = new Error('ApiDoc schema projection was aborted.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function projectionFailure(regionKey: string, error: unknown): ApiDocSchemaProjectionFailure {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  return {
    regionKey,
    ...(typeof candidate?.code === 'string' ? { code: candidate.code } : {}),
    message: typeof candidate?.message === 'string' ? candidate.message : 'Unable to project this schema for display.',
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

export function filterApiDocSchemaFields(fields: SchemaFieldNode[], mode: ApiDocSchemaAccessMode): SchemaFieldNode[] {
  return fields
    .filter((field) => {
      if (mode === 'request' && field.readOnly) return false;
      if (mode === 'response' && field.writeOnly) return false;
      return true;
    })
    .map((field) =>
      field.children
        ? {
            ...field,
            children: filterApiDocSchemaFields(field.children, mode),
          }
        : field,
    );
}

export function prepareApiDocSchemaFields(
  fields: SchemaFieldNode[],
  mode: ApiDocSchemaAccessMode,
  operation?: OperationObject,
): SchemaFieldNode[] {
  const filtered = filterApiDocSchemaFields(fields, mode);
  return mode === 'request' && operation ? applyValidationGroupRequiredFields(filtered, operation) : filtered;
}

export async function projectApiDocSchemaRegions(
  targets: readonly ApiDocSchemaProjectionTarget[],
  projector: SchemaDisplayProjector,
  options: ProjectApiDocSchemaRegionsOptions = {},
): Promise<ApiDocSchemaProjection> {
  throwIfAborted(options.signal);
  const attempts = await mapWithConcurrency(
    targets,
    API_DOC_PROJECTION_CONCURRENCY,
    async (target): Promise<ProjectionAttempt> => {
      throwIfAborted(options.signal);
      try {
        const result = await projector.projectValue(target.schema, { signal: options.signal });
        return {
          region: {
            key: target.key,
            fields: prepareApiDocSchemaFields(result.fields, target.mode, target.operation),
          },
          diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic, regionKey: target.key })),
        };
      } catch (error) {
        if (isAbortError(error)) throw error;
        return {
          diagnostics: [],
          failure: projectionFailure(target.key, error),
        };
      }
    },
  );
  throwIfAborted(options.signal);

  return {
    regions: attempts.flatMap(({ region }) => (region ? [region] : [])),
    diagnostics: attempts.flatMap(({ diagnostics }) => diagnostics),
    failures: attempts.flatMap(({ failure }) => (failure ? [failure] : [])),
  };
}
