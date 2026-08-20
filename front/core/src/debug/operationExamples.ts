import type { SchemaResolveContext } from './types';
import { dereference } from './resolveRef';
import { buildSchemaExample } from './schemaExample';
import { buildMediaTypeExampleValue } from './mediaTypeExample';

const DEFAULT_MEDIA_TYPE = 'application/json';

export interface OperationMediaTypeObject<TSchema extends object = Record<string, unknown>> {
  schema?: TSchema;
  example?: unknown;
  examples?: Record<string, unknown>;
}

export interface RequestBodyExampleSource<TSchema extends object = Record<string, unknown>> {
  content?: Record<string, OperationMediaTypeObject<TSchema>>;
}

export interface ResponseExampleSource<TSchema extends object = Record<string, unknown>> {
  content?: Record<string, OperationMediaTypeObject<TSchema>>;
  schema?: TSchema;
}

export interface SelectedOperationExample {
  mediaType: string;
  value: string;
}

export interface SelectedResponseExample extends SelectedOperationExample {
  statusCode: string;
}

export interface SelectedMediaType<TMedia extends object> {
  mediaType: string;
  mediaObj: TMedia;
}

function asSchemaRecord(schema: object | undefined): Record<string, unknown> | undefined {
  return schema as Record<string, unknown> | undefined;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Pick the media type displayed by the API document. */
export function selectFirstMediaType<TMedia extends object>(
  content: Record<string, TMedia> | undefined,
): SelectedMediaType<TMedia> | undefined {
  if (!content) return undefined;

  const jsonMedia = content[DEFAULT_MEDIA_TYPE];
  if (jsonMedia) return { mediaType: DEFAULT_MEDIA_TYPE, mediaObj: jsonMedia };

  const firstEntry = Object.entries(content)[0];
  if (!firstEntry) return undefined;
  return { mediaType: firstEntry[0], mediaObj: firstEntry[1] };
}

/** Generate the same pretty-printed Schema fallback used by the API document. */
export function buildSchemaExampleValue(schema: object | undefined, ctx: SchemaResolveContext): string | undefined {
  if (!schema) return undefined;
  try {
    const example = buildSchemaExample(asSchemaRecord(schema), ctx);
    if (example === null || example === undefined) return undefined;
    return JSON.stringify(example, null, 2);
  } catch {
    return undefined;
  }
}

/** Select the single request-body example shown by the API document. */
export function selectRequestBodyExample<TSchema extends object>(
  requestBody: RequestBodyExampleSource<TSchema> | undefined,
  fallbackSchema: TSchema | undefined,
  ctx: SchemaResolveContext,
): SelectedOperationExample | undefined {
  const mediaEntry = selectFirstMediaType(requestBody?.content);
  if (!mediaEntry) {
    const value = buildSchemaExampleValue(fallbackSchema, ctx);
    return value !== undefined ? { mediaType: DEFAULT_MEDIA_TYPE, value } : undefined;
  }

  try {
    const explicitValue = buildMediaTypeExampleValue(mediaEntry.mediaObj, undefined, ctx, {
      mediaType: mediaEntry.mediaType,
    });
    if (explicitValue !== undefined) {
      return { mediaType: mediaEntry.mediaType, value: explicitValue };
    }
  } catch {
    // Preserve the API document's request-example failure behavior.
    return undefined;
  }

  const value = buildSchemaExampleValue(mediaEntry.mediaObj.schema ?? fallbackSchema, ctx);
  return value !== undefined ? { mediaType: mediaEntry.mediaType, value } : undefined;
}

function responseSchema<TSchema extends object>(response: ResponseExampleSource<TSchema>): TSchema | undefined {
  return (
    response.content?.[DEFAULT_MEDIA_TYPE]?.schema ??
    response.schema ??
    Object.values(response.content ?? {})[0]?.schema
  );
}

function resolvedSchema(schema: object | undefined, ctx: SchemaResolveContext): Record<string, unknown> | undefined {
  const record = asSchemaRecord(schema);
  if (!record) return undefined;
  return typeof record.$ref === 'string' ? dereference(record, ctx.doc) : record;
}

/** Select at most one example for each response status code. */
export function selectResponseExamples<TSchema extends object>(
  responses: Record<string, ResponseExampleSource<TSchema>> | undefined,
  ctx: SchemaResolveContext,
): SelectedResponseExample[] {
  if (!responses) return [];

  const selected: SelectedResponseExample[] = [];
  for (const [statusCode, response] of Object.entries(responses)) {
    const mediaEntry = selectFirstMediaType(response.content);
    const schema = responseSchema(response);
    const resolved = resolvedSchema(schema, ctx);
    let explicitValue: string | undefined;

    if (mediaEntry) {
      try {
        explicitValue = buildMediaTypeExampleValue(mediaEntry.mediaObj, undefined, ctx, {
          mediaType: mediaEntry.mediaType,
        });
      } catch {
        explicitValue = undefined;
      }

      const isBinary = resolved?.format === 'binary';
      // Preserve the existing API-document boundary: a declared media example
      // bypasses binary placeholder suppression even when it only has externalValue.
      const hasMediaExample =
        hasOwn(mediaEntry.mediaObj, 'example') || Object.keys(mediaEntry.mediaObj.examples ?? {}).length > 0;
      const hasSchemaExample = Boolean(resolved && hasOwn(resolved, 'example'));
      if (isBinary && !hasMediaExample && !hasSchemaExample) continue;
    }

    const value = explicitValue ?? buildSchemaExampleValue(schema, ctx);
    if (value === undefined) continue;
    selected.push({
      statusCode,
      mediaType: mediaEntry?.mediaType ?? DEFAULT_MEDIA_TYPE,
      value,
    });
  }
  return selected;
}
