import { inferReferenceObjectTargetKind, resolveLocalJsonPointer } from 'knife4j-core';
import type { MenuOperation, ResponseObject, SwaggerDoc } from '../types/swagger';
import { asOpenApiRecord, locateOperationRecord, pointerReference, type OpenApiRecord } from './openApiDocumentPointer';
import { registeredSchemaDocument, type SchemaDocumentSession } from './schemaDocumentSession';

export interface RegisteredObjectLocation {
  readonly value: OpenApiRecord;
  readonly document: SwaggerDoc;
  readonly tokens: readonly string[];
  readonly retrievalUri?: string;
}

export interface OperationResponseRecord {
  readonly statusCode: string;
  readonly location: RegisteredObjectLocation | null;
}

export function registeredObjectReference(location: RegisteredObjectLocation, suffix: readonly string[] = []): string {
  const tokens = [...location.tokens, ...suffix];
  return `${location.retrievalUri ?? ''}${tokens.length === 0 ? '#' : pointerReference(tokens)}`;
}

/** Resolve OAS objects in the fixed session registry, preserving their physical Schema context. */
export function followRegisteredObject(
  initial: RegisteredObjectLocation,
  kind: 'response' | 'header' | 'example',
  session?: SchemaDocumentSession,
): RegisteredObjectLocation | null {
  let location = initial;
  const seen = new Set<string>();
  let description: string | undefined;
  let summary: string | undefined;
  for (let depth = 0; depth <= 20; depth += 1) {
    const value = location.value;
    if (typeof value.$ref !== 'string') {
      return {
        ...location,
        value: {
          ...value,
          ...(description === undefined ? {} : { description }),
          ...(summary === undefined ? {} : { summary }),
        },
      };
    }
    if (typeof value.description === 'string') description ??= value.description;
    if (kind === 'example' && typeof value.summary === 'string') summary ??= value.summary;
    let uri = location.retrievalUri;
    let fragment = value.$ref;
    if (uri) {
      try {
        const target = new URL(value.$ref, uri);
        fragment = target.hash || '#';
        target.hash = '';
        uri = target.href;
      } catch {
        return null;
      }
    } else if (!fragment.startsWith('#')) return null;
    const key = `${uri ?? ''}${fragment}`;
    if (seen.has(key)) return null;
    seen.add(key);
    // Reject known wrong-type component targets, as the local consumer does.
    const targetKind = inferReferenceObjectTargetKind(fragment);
    if (targetKind && targetKind !== kind) return null;
    const document =
      uri && uri !== location.retrievalUri
        ? session
          ? registeredSchemaDocument(session, uri)
          : undefined
        : location.document;
    const target = resolveLocalJsonPointer(document, fragment);
    const record = target.found ? asOpenApiRecord(target.value) : null;
    if (!record) return null;
    let tokens: string[];
    try {
      const pointer = decodeURIComponent(fragment.slice(1));
      tokens =
        pointer === ''
          ? []
          : pointer
              .slice(1)
              .split('/')
              .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
    } catch {
      return null;
    }
    location = { value: record, document: document as SwaggerDoc, tokens, retrievalUri: uri };
  }
  return null;
}

export function locateOperationResponses(
  document: SwaggerDoc,
  operation: MenuOperation,
  session?: SchemaDocumentSession,
): OperationResponseRecord[] {
  const registered = session ? registeredSchemaDocument(session, session.retrievalUri) : undefined;
  const snapshotDocument = (registered as SwaggerDoc | undefined) ?? document;
  const located = locateOperationRecord(snapshotDocument, operation);
  const responses = asOpenApiRecord(located?.value.responses);
  if (!located || !responses) return [];
  return Object.entries(responses)
    .filter(([status]) => !status.startsWith('x-'))
    .map(([statusCode, value]) => {
      const record = asOpenApiRecord(value);
      return {
        statusCode,
        location: record
          ? followRegisteredObject(
              {
                value: record,
                document: snapshotDocument,
                tokens: [...located.tokens, 'responses', statusCode],
                retrievalUri: session?.retrievalUri,
              },
              'response',
              session,
            )
          : null,
      };
    });
}

/** Schema values stay at their registered URI instead of being relocated into the entry document. */
export function responseForDisplay(
  location: RegisteredObjectLocation,
  session?: SchemaDocumentSession,
): ResponseObject {
  const content = asOpenApiRecord(location.value.content);
  const headers = asOpenApiRecord(location.value.headers);
  return {
    ...location.value,
    ...(content
      ? {
          content: Object.fromEntries(
            Object.entries(content).map(([mediaType, value]) => {
              const media = asOpenApiRecord(value);
              return [
                mediaType,
                media && Object.prototype.hasOwnProperty.call(media, 'schema')
                  ? {
                      ...media,
                      schema: { $ref: registeredObjectReference(location, ['content', mediaType, 'schema']) },
                    }
                  : value,
              ];
            }),
          ),
        }
      : {}),
    ...(headers
      ? {
          headers: Object.fromEntries(
            Object.entries(headers).map(([name, value]) => {
              const header = asOpenApiRecord(value);
              const resolved = header
                ? followRegisteredObject(
                    { ...location, value: header, tokens: [...location.tokens, 'headers', name] },
                    'header',
                    session,
                  )
                : null;
              return [name, resolved?.value ?? {}];
            }),
          ),
        }
      : {}),
  } as ResponseObject;
}
