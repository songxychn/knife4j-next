import { buildMediaTypeExampleValue, buildSchemaExample, dereference } from 'knife4j-core';
import type { RequestBodyObject, ResponseObject, SchemaObject, SwaggerDoc } from '../../types/swagger';

type RequestMediaObject = NonNullable<RequestBodyObject['content']>[string];

export interface RequestMediaEntry {
  mediaType: string;
  mediaObj: RequestMediaObject;
}

export function firstRequestMedia(requestBody: RequestBodyObject | undefined): RequestMediaEntry | undefined {
  if (!requestBody?.content) return undefined;
  const jsonMedia = requestBody.content['application/json'];
  if (jsonMedia) return { mediaType: 'application/json', mediaObj: jsonMedia };

  const firstEntry = Object.entries(requestBody.content)[0];
  if (!firstEntry) return undefined;
  const [mediaType, mediaObj] = firstEntry;
  return { mediaType, mediaObj };
}

/** Build a pretty-printed JSON example string from a schema, or return null. */
export function buildJsonExample(schema: SchemaObject | undefined, doc: SwaggerDoc): string | null {
  if (!schema) return null;
  try {
    const example = buildSchemaExample(schema as Record<string, unknown>, {
      doc: doc as unknown as Record<string, unknown>,
    });
    if (example === null || example === undefined) return null;
    return JSON.stringify(example, null, 2);
  } catch {
    return null;
  }
}

/** Build the request body example shown in the API document. */
export function requestBodyExample(
  requestBody: RequestBodyObject | undefined,
  bodySchema: SchemaObject | undefined,
  doc: SwaggerDoc,
): string | null {
  const mediaEntry = firstRequestMedia(requestBody);
  if (!mediaEntry) return buildJsonExample(bodySchema, doc);

  try {
    const example = buildMediaTypeExampleValue(
      mediaEntry.mediaObj,
      undefined,
      {
        doc: doc as unknown as Record<string, unknown>,
      },
      { mediaType: mediaEntry.mediaType },
    );
    if (example !== undefined) return example;
  } catch {
    return null;
  }

  return buildJsonExample(mediaEntry.mediaObj.schema ?? bodySchema, doc);
}

/** Extract per-status-code response examples, preferring explicit media examples over generated schema values. */
export function responseExamples(
  responses: Record<string, ResponseObject> | undefined,
  doc: SwaggerDoc,
): Array<{ statusCode: string; example: string }> {
  if (!responses) return [];
  return Object.entries(responses)
    .map(([statusCode, resp]) => {
      const mediaEntry = resp.content
        ? resp.content['application/json']
          ? (['application/json', resp.content['application/json']] as const)
          : Object.entries(resp.content)[0]
        : undefined;
      const schema =
        resp.content?.['application/json']?.schema ?? resp.schema ?? Object.values(resp.content ?? {})[0]?.schema;
      const resolvedSchema = schema?.$ref
        ? (dereference(
            schema as unknown as Record<string, unknown>,
            doc as unknown as Record<string, unknown>,
          ) as SchemaObject)
        : schema;
      let example: string | null | undefined;

      if (mediaEntry) {
        const hasExplicitExample =
          'example' in mediaEntry[1] ||
          Object.keys(mediaEntry[1].examples ?? {}).length > 0 ||
          Boolean(resolvedSchema && 'example' in resolvedSchema);
        if (resolvedSchema?.format === 'binary' && !hasExplicitExample) return null;
        try {
          example = buildMediaTypeExampleValue(
            mediaEntry[1],
            undefined,
            { doc: doc as unknown as Record<string, unknown> },
            { mediaType: mediaEntry[0] },
          );
        } catch {
          example = undefined;
        }
      }
      if (example === undefined) {
        example = buildJsonExample(schema, doc);
      }

      return example !== null && example !== undefined ? { statusCode, example } : null;
    })
    .filter((x): x is { statusCode: string; example: string } => x !== null);
}
