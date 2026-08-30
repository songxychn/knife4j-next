import type { EvaluationPlugin } from '@hyperjump/json-schema/experimental';
import { SchemaEngineError } from './errors';
import type { SchemaEngineLimits } from './types';

export const DEFAULT_SCHEMA_ENGINE_LIMITS: Readonly<SchemaEngineLimits> = Object.freeze({
  maxSchemaNodes: 100_000,
  maxSchemaDepth: 256,
  maxResourcesPerDocument: 1_000,
  maxReferencesPerDocument: 20_000,
  maxInstanceNodes: 100_000,
  maxInstanceDepth: 256,
  maxEvaluationSteps: 250_000,
  maxEvaluationMs: 1_000,
});

export const normalizeLimits = (overrides: Partial<SchemaEngineLimits> = {}): Readonly<SchemaEngineLimits> => {
  const limits = { ...DEFAULT_SCHEMA_ENGINE_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
      throw new TypeError(`SchemaEngine limit '${name}' must be a positive integer.`);
    }
  }
  return Object.freeze(limits);
};

interface JsonInspectionOptions {
  kind: 'schema' | 'instance';
  maxNodes: number;
  maxDepth: number;
  maxReferences?: number;
}

export interface JsonInspection {
  nodes: number;
  depth: number;
  references: number;
}

export const inspectJsonValue = (value: unknown, options: JsonInspectionOptions): JsonInspection => {
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let deepest = 0;
  let references = 0;

  const visit = (candidate: unknown, depth: number): void => {
    nodes += 1;
    deepest = Math.max(deepest, depth);
    if (nodes > options.maxNodes) {
      throw new SchemaEngineError(
        options.kind === 'schema' ? 'SCHEMA_BUDGET_EXCEEDED' : 'INSTANCE_BUDGET_EXCEEDED',
        `${options.kind === 'schema' ? 'Schema' : 'Instance'} node limit exceeded.`,
        { limit: options.maxNodes, actual: nodes },
      );
    }
    if (depth > options.maxDepth) {
      throw new SchemaEngineError(
        options.kind === 'schema' ? 'SCHEMA_BUDGET_EXCEEDED' : 'INSTANCE_BUDGET_EXCEEDED',
        `${options.kind === 'schema' ? 'Schema' : 'Instance'} depth limit exceeded.`,
        { limit: options.maxDepth, actual: depth },
      );
    }

    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) {
        throw new SchemaEngineError(
          options.kind === 'schema' ? 'INVALID_DOCUMENT' : 'INVALID_INSTANCE',
          'JSON values must not contain NaN or Infinity.',
        );
      }
      return;
    }
    if (typeof candidate !== 'object') {
      throw new SchemaEngineError(
        options.kind === 'schema' ? 'INVALID_DOCUMENT' : 'INVALID_INSTANCE',
        `JSON values must not contain '${typeof candidate}'.`,
      );
    }

    if (ancestors.has(candidate)) {
      throw new SchemaEngineError(
        options.kind === 'schema' ? 'INVALID_DOCUMENT' : 'INVALID_INSTANCE',
        'JSON values must not contain cycles.',
      );
    }
    ancestors.add(candidate);
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
    } else {
      if (Object.getPrototypeOf(candidate) !== Object.prototype && Object.getPrototypeOf(candidate) !== null) {
        throw new SchemaEngineError(
          options.kind === 'schema' ? 'INVALID_DOCUMENT' : 'INVALID_INSTANCE',
          'JSON objects must use the plain Object prototype.',
        );
      }
      for (const [key, child] of Object.entries(candidate)) {
        if (options.maxReferences !== undefined && (key === '$ref' || key === '$dynamicRef')) {
          references += 1;
          if (references > options.maxReferences) {
            throw new SchemaEngineError('SCHEMA_BUDGET_EXCEEDED', 'Schema reference limit exceeded.', {
              limit: options.maxReferences,
              actual: references,
            });
          }
        }
        visit(child, depth + 1);
      }
    }
    ancestors.delete(candidate);
  };

  visit(value, 0);
  return { nodes, depth: deepest, references };
};

const now = (): number => globalThis.performance?.now() ?? Date.now();

export class EvaluationBudgetPlugin implements EvaluationPlugin {
  private steps = 0;
  private readonly deadline: number;

  public constructor(
    private readonly maxSteps: number,
    maxDurationMs: number,
    private readonly signal?: AbortSignal,
  ) {
    this.deadline = now() + maxDurationMs;
    this.check();
  }

  public beforeSchema(): void {
    this.check();
  }

  public beforeKeyword(): void {
    this.steps += 1;
    this.check();
  }

  public assertWithinBudget(): void {
    this.check();
  }

  private check(): void {
    if (this.signal?.aborted) {
      throw new SchemaEngineError('OPERATION_ABORTED', 'Schema evaluation was aborted.');
    }
    if (this.steps > this.maxSteps) {
      throw new SchemaEngineError('EVALUATION_BUDGET_EXCEEDED', 'Schema evaluation step limit exceeded.', {
        limit: this.maxSteps,
        actual: this.steps,
      });
    }
    if (now() > this.deadline) {
      throw new SchemaEngineError('EVALUATION_BUDGET_EXCEEDED', 'Schema evaluation time limit exceeded.');
    }
  }
}
