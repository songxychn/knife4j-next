import type { SchemaResolveContext } from './types';
import { resolveRef } from './resolveRef';
import { buildSchemaExample } from './schemaExample';
import { getOpenApiSpecificationFeatures } from '../openapiVersion';
import { interpretExampleObject } from './exampleRepresentation';
import { parseLocalJsonPointer, resolveLocalJsonPointer } from '../openapi31/document';

interface MediaTypeExampleSource {
  example?: unknown;
  examples?: Record<string, unknown>;
  encoding?: Record<string, unknown>;
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

function formatExampleValue(value: unknown, options: MediaTypeExampleOptions = {}): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    return isJsonMediaType(options.mediaType) ? JSON.stringify(value) : value;
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

/** This convenience API has no registry. Only known local component positions are resolvable here. */
function resolveOas32Example(example: unknown, doc: Record<string, unknown>): Record<string, unknown> | undefined {
  const seen = new Set<string>();
  let current = example;
  for (let depth = 0; depth <= 20; depth++) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    const object = current as Record<string, unknown>;
    if (typeof object.$ref !== 'string') return object;
    const parsed = parseLocalJsonPointer(object.$ref);
    if (
      !parsed.valid ||
      parsed.tokens?.length !== 3 ||
      parsed.tokens[0] !== 'components' ||
      parsed.tokens[1] !== 'examples' ||
      seen.has(object.$ref)
    )
      return undefined;
    seen.add(object.$ref);
    const resolved = resolveLocalJsonPointer(doc, object.$ref);
    if (!resolved.found) return undefined;
    current = resolved.value;
  }
  return undefined;
}

export function buildMediaTypeExampleValue(
  mediaObj: MediaTypeExampleSource | undefined,
  schema: Record<string, unknown> | undefined,
  ctx: SchemaResolveContext,
  options: MediaTypeExampleOptions = {},
): string | undefined {
  if (getOpenApiSpecificationFeatures(ctx.doc.openapi)?.family === '3.2') {
    const authored =
      mediaObj && hasOwn(mediaObj as Record<string, unknown>, 'example')
        ? [{ value: mediaObj.example }]
        : Object.values(mediaObj?.examples ?? {}).map((example) => resolveOas32Example(example, ctx.doc));
    const selected =
      authored.find(
        (example) => example && ['dataValue', 'serializedValue', 'value'].some((field) => hasOwn(example, field)),
      ) ?? authored.find((example) => example && hasOwn(example, 'externalValue'));
    const mediaType = options.mediaType ?? '';
    const exampleContext = {
      layer: 'media' as const,
      mediaType,
      encoding: mediaObj?.encoding,
      bodyContent: {
        mediaType,
        category:
          mediaType.split(';', 1)[0].trim().toLowerCase() === 'application/x-www-form-urlencoded'
            ? ('urlencoded' as const)
            : ('raw' as const),
        schema,
      },
    };
    if (selected) return interpretExampleObject(selected, exampleContext).text;
    if (authored.some((example) => !example)) return undefined;
    return schema
      ? interpretExampleObject({ dataValue: buildSchemaExample(schema, ctx) }, exampleContext).text
      : undefined;
  }
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
