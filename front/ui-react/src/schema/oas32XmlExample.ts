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
    return xmlDiagnostics.length === 0
      ? representation
      : { ...representation, diagnostics: [...representation.diagnostics, ...xmlDiagnostics] };
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
