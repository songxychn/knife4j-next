import { afterEach, describe, expect, test } from 'vitest';
import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import type { SwaggerDoc } from '../types/swagger';
import {
  ExternalResourceLoader,
  schemaDocumentsFromResourceGraph,
  schemaRegistrationContextFromResourceGraph,
} from './externalResourceGraph';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import { discriminatorGenerationSchemaLocation } from './schemaDiscriminatorGeneration';
import {
  canApplyGeneratedExample,
  materializeDiscriminatorGeneratedExample,
  shouldCommitGeneratedExample,
} from './oas32XmlExample';

const uri = 'https://retrieval.example/xml-disc.json';
const sessions: SchemaDocumentSession[] = [];
const loaders: ExternalResourceLoader[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  loaders.splice(0).forEach((loader) => loader.dispose());
});

async function petFixture() {
  const document = {
    openapi: '3.2.0',
    info: { title: 'Discriminator XML apply', version: '1' },
    components: {
      schemas: {
        Pet: {
          oneOf: [{ $ref: '#/components/schemas/Cat' }, { $ref: '#/components/schemas/Dog' }],
        },
        Cat: {
          type: 'object',
          xml: { name: 'Cat' },
          properties: { name: { type: 'string' } },
        },
        Dog: {
          type: 'object',
          xml: { name: 'Dog' },
          properties: { name: { type: 'string' } },
        },
      },
    },
  } as SwaggerDoc;
  expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
  const loader = new ExternalResourceLoader(document, uri);
  loaders.push(loader);
  const snapshot = loader.currentSnapshot();
  sessions.splice(0).forEach((session) => session.dispose());
  const session = await createSchemaDocumentSession(document, uri, {
    registrationContext: schemaRegistrationContextFromResourceGraph(snapshot, uri),
    resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
  });
  sessions.push(session);
  const location = (name: string) =>
    snapshot.objectLocations.find((item) => item.pointer === `#/components/schemas/${name}` && item.kind === 'schema')!;
  return { snapshot, session, location };
}

describe('discriminator generated XML apply', () => {
  test('does not produce XML text for a combinator parent Schema', async () => {
    const { snapshot, session, location } = await petFixture();
    const representation = await materializeDiscriminatorGeneratedExample({
      value: { name: 'A' },
      snapshot,
      session,
      schemaLocation: location('Pet'),
      mediaType: 'application/xml',
    });
    expect(representation.text).toBeUndefined();
    expect(canApplyGeneratedExample(representation)).toBe(false);
    expect(representation.diagnostics.map((item) => item.code)).toContain('UNSUPPORTED_MAPPING');
    expect(representation.diagnostics.map((item) => item.code)).not.toContain('CODEC_UNAVAILABLE');
  });

  test('serializes against the resolved branch Schema', async () => {
    const { snapshot, session, location } = await petFixture();
    const representation = await materializeDiscriminatorGeneratedExample({
      value: { name: 'A' },
      snapshot,
      session,
      schemaLocation: location('Cat'),
      mediaType: 'application/xml',
    });
    expect(representation.text).toBe('<Cat><name>A</name></Cat>');
    expect(canApplyGeneratedExample(representation)).toBe(true);
  });

  test('prefers the generated branch location and refuses a stale revision', () => {
    expect(
      discriminatorGenerationSchemaLocation({
        provenance: {
          target: {
            location: { ownerRetrievalUri: uri, pointer: '#/components/schemas/Pet', reference: `${uri}#/Pet` },
          },
          branch: {
            location: { ownerRetrievalUri: uri, pointer: '#/components/schemas/Cat', reference: `${uri}#/Cat` },
          },
        },
      } as never),
    ).toEqual({ ownerRetrievalUri: uri, pointer: '#/components/schemas/Cat' });
    const xml = {
      text: '<Cat/>',
      serialization: 'valid' as const,
      diagnostics: [],
      fields: {},
      pairing: 'absent' as const,
    };
    expect(shouldCommitGeneratedExample(3, 3, xml)).toBe(true);
    expect(shouldCommitGeneratedExample(3, 4, xml)).toBe(false);
    expect(shouldCommitGeneratedExample(3, 3, undefined)).toBe(false);
  });
});
