import { buildSchemaFieldTree, type SchemaFieldNode } from 'knife4j-core';
import { normalizeGenericTitle } from '../components/schema/schemaUtils';
import type { SchemaObject, SwaggerDoc } from '../types/swagger';
import {
  componentSchemaReference,
  type SchemaDisplayProjector,
  type SchemaProjectionDiagnostic,
} from './schemaDisplayProjection';

const MODEL_PROJECTION_CONCURRENCY = 4;

export type SchemaModelProjectionSource = 'legacy' | 'schema-engine' | 'legacy-fallback';

export interface SchemaModelDisplay {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly fields: SchemaFieldNode[];
  readonly source: SchemaModelProjectionSource;
}

export interface SchemaModelDiagnostic extends SchemaProjectionDiagnostic {
  readonly modelName: string;
}

export interface SchemaModelProjectionFailure {
  readonly modelName: string;
  readonly code?: string;
  readonly message: string;
}

export interface SchemaModelsProjection {
  readonly models: SchemaModelDisplay[];
  readonly diagnostics: SchemaModelDiagnostic[];
  readonly failures: SchemaModelProjectionFailure[];
}

export interface ProjectSchemaModelsOptions {
  readonly signal?: AbortSignal;
}

function legacyFields(schema: SchemaObject, swaggerDoc: SwaggerDoc): SchemaFieldNode[] {
  return buildSchemaFieldTree(schema as Record<string, unknown>, {
    doc: swaggerDoc as unknown as Record<string, unknown>,
    maxDepth: 8,
  });
}

function modelDisplay(
  name: string,
  schema: SchemaObject,
  fields: SchemaFieldNode[],
  source: SchemaModelProjectionSource,
): SchemaModelDisplay {
  return {
    name,
    title: normalizeGenericTitle(schema.title),
    description: schema.description,
    fields,
    source,
  };
}

export function buildLegacySchemaModels(
  schemas: Record<string, SchemaObject>,
  swaggerDoc: SwaggerDoc,
): SchemaModelDisplay[] {
  return Object.entries(schemas).map(([name, schema]) =>
    modelDisplay(name, schema, legacyFields(schema, swaggerDoc), 'legacy'),
  );
}

function projectionFailure(modelName: string, error: unknown): SchemaModelProjectionFailure {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  return {
    modelName,
    ...(typeof candidate?.code === 'string' ? { code: candidate.code } : {}),
    message: typeof candidate?.message === 'string' ? candidate.message : 'Unable to project this schema for display.',
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function mapWithConcurrency<T, R>(
  values: T[],
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

export async function projectSchemaModels(
  schemas: Record<string, SchemaObject>,
  swaggerDoc: SwaggerDoc,
  projector: SchemaDisplayProjector,
  options: ProjectSchemaModelsOptions = {},
): Promise<SchemaModelsProjection> {
  const entries = Object.entries(schemas);
  const projected = await mapWithConcurrency(entries, MODEL_PROJECTION_CONCURRENCY, async ([name, schema]) => {
    try {
      const result = await projector.project(componentSchemaReference(name), { signal: options.signal });
      return {
        model: modelDisplay(name, schema, result.fields, 'schema-engine'),
        diagnostics: result.diagnostics.map((diagnostic) => ({ ...diagnostic, modelName: name })),
        failure: undefined,
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return {
        model: modelDisplay(name, schema, legacyFields(schema, swaggerDoc), 'legacy-fallback'),
        diagnostics: [],
        failure: projectionFailure(name, error),
      };
    }
  });

  return {
    models: projected.map(({ model }) => model),
    diagnostics: projected.flatMap(({ diagnostics }) => diagnostics),
    failures: projected.flatMap(({ failure }) => (failure ? [failure] : [])),
  };
}
