import type { SchemaResolveContext } from './types';
import { resolveRef } from './resolveRef';
import { buildSchemaExample } from './schemaExample';

interface MediaTypeExampleSource {
  example?: unknown;
  examples?: Record<string, unknown>;
}

interface MediaTypeExampleOptions {
  mediaType?: string;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isJsonMediaType(mediaType: string | undefined): boolean {
  if (!mediaType) return false;
  const normalized = mediaType.split(';', 1)[0].trim().toLowerCase();
  return normalized === 'application/json' || normalized.endsWith('+json');
}

function isJsonDocumentString(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function formatExampleValue(value: unknown, options: MediaTypeExampleOptions = {}): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    if (isJsonMediaType(options.mediaType) && !isJsonDocumentString(value)) {
      return JSON.stringify(value);
    }
    return value;
  }
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

function firstExamplesValue(
  examples: Record<string, unknown>,
  doc: Record<string, unknown>,
  options: MediaTypeExampleOptions,
): string | undefined {
  for (const example of Object.values(examples)) {
    const exampleObj = resolveExampleObject(example, doc);
    if (exampleObj && hasOwn(exampleObj, 'value')) {
      return formatExampleValue(exampleObj.value, options);
    }
  }
  return undefined;
}

export function buildMediaTypeExampleValue(
  mediaObj: MediaTypeExampleSource | undefined,
  schema: Record<string, unknown> | undefined,
  ctx: SchemaResolveContext,
  options: MediaTypeExampleOptions = {},
): string | undefined {
  if (mediaObj) {
    const mediaRecord = mediaObj as Record<string, unknown>;
    if (hasOwn(mediaRecord, 'example')) {
      const exampleValue = formatExampleValue(mediaObj.example, options);
      if (exampleValue !== undefined) return exampleValue;
    }

    if (mediaObj.examples) {
      const exampleValue = firstExamplesValue(mediaObj.examples, ctx.doc, options);
      if (exampleValue !== undefined) return exampleValue;
    }
  }

  if (!schema) return undefined;
  return JSON.stringify(buildSchemaExample(schema, ctx), null, 2);
}
