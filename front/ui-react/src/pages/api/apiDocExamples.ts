import {
  buildSchemaExampleValue,
  selectFirstMediaType,
  selectRequestBodyExample,
  selectResponseExamples,
} from 'knife4j-core';
import type { RequestBodyObject, ResponseObject, SchemaObject, SwaggerDoc } from '../../types/swagger';

type RequestMediaObject = NonNullable<RequestBodyObject['content']>[string];

export interface RequestMediaEntry {
  mediaType: string;
  mediaObj: RequestMediaObject;
}

export function firstRequestMedia(requestBody: RequestBodyObject | undefined): RequestMediaEntry | undefined {
  const selected = selectFirstMediaType(requestBody?.content);
  return selected ? { mediaType: selected.mediaType, mediaObj: selected.mediaObj } : undefined;
}

/** Build a pretty-printed JSON example string from a schema, or return null. */
export function buildJsonExample(schema: SchemaObject | undefined, doc: SwaggerDoc): string | null {
  return (
    buildSchemaExampleValue(schema, {
      doc: doc as unknown as Record<string, unknown>,
    }) ?? null
  );
}

/** Build the request body example shown in the API document. */
export function requestBodyExample(
  requestBody: RequestBodyObject | undefined,
  bodySchema: SchemaObject | undefined,
  doc: SwaggerDoc,
): string | null {
  return (
    selectRequestBodyExample(requestBody, bodySchema, {
      doc: doc as unknown as Record<string, unknown>,
    })?.value ?? null
  );
}

/** Extract per-status-code response examples, preferring explicit media examples over generated schema values. */
export function responseExamples(
  responses: Record<string, ResponseObject> | undefined,
  doc: SwaggerDoc,
): Array<{ statusCode: string; example: string }> {
  return selectResponseExamples(responses, {
    doc: doc as unknown as Record<string, unknown>,
  }).map(({ statusCode, value }) => ({ statusCode, example: value }));
}
