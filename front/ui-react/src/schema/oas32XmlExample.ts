import type { ExampleRepresentation } from 'knife4j-core';
import type { SchemaDocumentSession } from './schemaDocumentSession';
import type { ResourceGraphSnapshot } from './externalResourceGraph';
import {
  serializeOas32Xml,
  type Oas32XmlSchemaLocation,
  type Oas32XmlSerializationResult,
} from './oas32XmlSerialization';

export function isOas32XmlMediaType(mediaType: string | undefined): boolean {
  const essence = (mediaType ?? '').split(';', 1)[0].trim().toLowerCase();
  return essence === 'application/xml' || essence === 'text/xml' || essence.endsWith('+xml');
}

export async function serializeKnownOas32XmlExample(options: {
  readonly snapshot: ResourceGraphSnapshot;
  readonly session: Pick<SchemaDocumentSession, 'resolve'>;
  readonly schemaLocation: Oas32XmlSchemaLocation;
  readonly value: unknown;
  readonly source: 'author' | 'candidate';
  readonly signal?: AbortSignal;
}): Promise<Oas32XmlSerializationResult> {
  return serializeOas32Xml({
    snapshot: options.snapshot,
    session: options.session,
    schemaLocation: options.schemaLocation,
    data: { kind: 'known', source: options.source, value: options.value },
    signal: options.signal,
  });
}

export function overlayOas32XmlExampleRepresentation(
  representation: ExampleRepresentation,
  xml: Oas32XmlSerializationResult,
): ExampleRepresentation {
  const xmlDiagnostics = xml.diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.severity === 'error' ||
        diagnostic.code === 'XML_FRAGMENT' ||
        diagnostic.code === 'ROUND_TRIP_AMBIGUOUS',
    )
    .map((diagnostic) => ({ phase: 'serialization' as const, code: diagnostic.code }));
  if (xml.status !== 'document' && xml.status !== 'fragment') {
    if (xmlDiagnostics.length === 0) return representation;
    return {
      ...representation,
      diagnostics: [
        ...representation.diagnostics.filter((diagnostic) => diagnostic.code !== 'CODEC_UNAVAILABLE'),
        ...xmlDiagnostics,
      ],
    };
  }
  return {
    ...representation,
    text: xml.xml,
    serialization: 'valid',
    diagnostics: [
      ...representation.diagnostics.filter((diagnostic) => diagnostic.code !== 'CODEC_UNAVAILABLE'),
      ...xmlDiagnostics,
    ],
  };
}

/** Fill XML text from known logical data. Authored serialized XML and external examples stay untouched. */
export async function attachOas32XmlExampleSerialization(
  representation: ExampleRepresentation,
  options: {
    readonly snapshot?: ResourceGraphSnapshot;
    readonly session?: Pick<SchemaDocumentSession, 'resolve'>;
    readonly schemaLocation?: Oas32XmlSchemaLocation;
    readonly mediaType?: string;
    readonly source: 'author' | 'candidate';
    readonly signal?: AbortSignal;
  },
): Promise<ExampleRepresentation> {
  if (!options.snapshot || !options.session || !options.schemaLocation) return representation;
  if (!isOas32XmlMediaType(options.mediaType)) return representation;
  if (representation.external) return representation;
  if (representation.text !== undefined) return representation;
  if (representation.data === undefined) return representation;
  if (representation.serialization === 'invalid') return representation;
  const xml = await serializeKnownOas32XmlExample({
    snapshot: options.snapshot,
    session: options.session,
    schemaLocation: options.schemaLocation,
    value: representation.data,
    source: options.source,
    signal: options.signal,
  });
  return overlayOas32XmlExampleRepresentation(representation, xml);
}

export function discriminatorGeneratedExampleSeed(value: unknown, xmlMedia: boolean): ExampleRepresentation {
  return {
    fields: {
      dataValue: true,
      serializedValue: false,
      externalValue: false,
      value: false,
    },
    data: value as never,
    dataSource: 'dataValue',
    pairing: 'absent',
    ...(xmlMedia
      ? {
          serialization: 'unavailable' as const,
          diagnostics: [{ phase: 'serialization' as const, code: 'CODEC_UNAVAILABLE' }],
        }
      : {
          text: JSON.stringify(value, null, 2),
          serialization: 'valid' as const,
          diagnostics: [],
        }),
  };
}

export function canApplyGeneratedExample(representation: ExampleRepresentation): boolean {
  return representation.text !== undefined && representation.serialization !== 'invalid';
}

export function shouldCommitGeneratedExample(
  requestedRevision: number,
  currentRevision: number,
  representation: ExampleRepresentation | undefined,
): representation is ExampleRepresentation {
  return representation !== undefined && requestedRevision === currentRevision;
}

/** Serialize a discriminator-generated instance. Combinator parents stay diagnostic-only. */
export async function materializeDiscriminatorGeneratedExample(options: {
  readonly value: unknown;
  readonly snapshot?: ResourceGraphSnapshot;
  readonly session?: Pick<SchemaDocumentSession, 'resolve'>;
  readonly schemaLocation?: Oas32XmlSchemaLocation;
  readonly mediaType?: string;
  readonly signal?: AbortSignal;
}): Promise<ExampleRepresentation> {
  const xmlMedia = isOas32XmlMediaType(options.mediaType);
  return attachOas32XmlExampleSerialization(discriminatorGeneratedExampleSeed(options.value, xmlMedia), {
    snapshot: options.snapshot,
    session: options.session,
    schemaLocation: options.schemaLocation,
    mediaType: options.mediaType,
    source: 'candidate',
    signal: options.signal,
  });
}
