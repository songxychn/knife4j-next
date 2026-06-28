import type { SchemaResolveContext } from './types';
import { resolveRef } from './resolveRef';
import { buildSchemaExample } from './schemaExample';

interface MediaTypeExampleSource {
  example?: unknown;
  examples?: Record<string, unknown>;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function formatExampleValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function resolveExampleObject(example: unknown, doc: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!example || typeof example !== 'object') return undefined;

  const exampleObj = example as Record<string, unknown>;
  if (typeof exampleObj.$ref === 'string') {
    return resolveRef(exampleObj.$ref, doc) ?? exampleObj;
  }

  return exampleObj;
}

function firstExamplesValue(examples: Record<string, unknown>, doc: Record<string, unknown>): string | undefined {
  for (const example of Object.values(examples)) {
    const exampleObj = resolveExampleObject(example, doc);
    if (exampleObj && hasOwn(exampleObj, 'value')) {
      return formatExampleValue(exampleObj.value);
    }
  }
  return undefined;
}

export function buildMediaTypeExampleValue(
  mediaObj: MediaTypeExampleSource | undefined,
  schema: Record<string, unknown> | undefined,
  ctx: SchemaResolveContext,
): string | undefined {
  if (mediaObj) {
    const mediaRecord = mediaObj as Record<string, unknown>;
    if (hasOwn(mediaRecord, 'example')) {
      const exampleValue = formatExampleValue(mediaObj.example);
      if (exampleValue !== undefined) return exampleValue;
    }

    if (mediaObj.examples) {
      const exampleValue = firstExamplesValue(mediaObj.examples, ctx.doc);
      if (exampleValue !== undefined) return exampleValue;
    }
  }

  if (!schema) return undefined;
  return JSON.stringify(buildSchemaExample(schema, ctx), null, 2);
}
