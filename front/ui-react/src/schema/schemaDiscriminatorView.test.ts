import { describe, expect, test } from 'vitest';
import { collectOas32DocumentDiagnostics, interpretExampleObject } from 'knife4j-core';
import type { SwaggerDoc } from '../types/swagger';
import { ExternalResourceLoader } from './externalResourceGraph';
import { isOas32DiscriminatorDocument } from './schemaDiscriminator';
import {
  attachDiscriminatorMappingFields,
  componentDiscriminatorLocation,
  describeSchemaDiscriminator,
  discriminatorMetadataVisible,
  isDynamicScopeGenerationUnavailable,
  preferredDiscriminatorSchemaLocation,
  schemaDiscriminatorAllowsModelRoute,
  schemaDiscriminatorFieldName,
  schemaDiscriminatorIndexFor,
  schemaDiscriminatorTargetLabel,
  selectDiscriminatorExampleHint,
  selectedDiscriminatorCandidateId,
} from './schemaDiscriminatorView';

const uri = 'https://retrieval.example/entry.json';
const libraryUri = 'https://retrieval.example/library.json';

function document32(schemas: Record<string, unknown>, version = '3.2.0'): SwaggerDoc {
  return {
    openapi: version,
    info: { title: 'Discriminator product view', version: '1' },
    components: { schemas },
  } as SwaggerDoc;
}

function fixture(version = '3.2.0'): SwaggerDoc {
  return document32(
    {
      Payload: {
        type: 'object',
        oneOf: [{ $ref: '#/components/schemas/Known' }, { $ref: '#/components/schemas/Other' }],
        discriminator: { propertyName: 'kind', mapping: { known: 'Known' }, defaultMapping: 'Other' },
      },
      Known: {
        type: 'object',
        required: ['kind'],
        properties: { kind: { enum: ['known', 'Known'] } },
      },
      Other: { type: 'object', properties: { kind: { not: { enum: ['known', 'Known'] } } } },
    },
    version,
  );
}

describe('schema discriminator product view', () => {
  test.each(['3.2.0', '3.2.99'])(
    'attaches mapping and defaultMapping rows for %s without selecting a composition branch',
    (version) => {
      const document = fixture(version);
      expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
      const snapshot = new ExternalResourceLoader(document, uri).currentSnapshot();
      const metadata = describeSchemaDiscriminator(snapshot, componentDiscriminatorLocation(uri, 'Payload'));
      expect(metadata.status).toBe('ready');
      expect(schemaDiscriminatorIndexFor(snapshot)).toBe(schemaDiscriminatorIndexFor(snapshot));
      const fields = attachDiscriminatorMappingFields(
        [
          { name: 'kind', type: 'string', required: false },
          { name: 'oneOf[1]', type: 'object', required: false, refName: 'Known' },
        ],
        metadata,
      );
      expect(fields.slice(0, 2).map((field) => field.name)).toEqual(['kind', 'oneOf[1]']);
      expect(fields.map((field) => field.name)).toEqual(
        expect.arrayContaining(['kind', 'oneOf[1]', 'mapping[known]', 'implicit[Known]', 'defaultMapping']),
      );
      const explicit = fields.find((field) => field.name === 'mapping[known]');
      const implicit = fields.find((field) => field.name === 'implicit[Known]');
      const fallback = fields.find((field) => field.name === 'defaultMapping');
      expect(explicit).toMatchObject({ refName: 'Known' });
      expect(implicit).toMatchObject({ refName: 'Known' });
      expect(fallback).toMatchObject({ refName: 'Other' });
    },
  );

  test('never uses an entry same-name model route for an external mapping target', () => {
    const document = document32({
      Payload: {
        type: 'object',
        oneOf: [
          { $ref: `${libraryUri}#/components/schemas/Known` },
          { $ref: '#/components/schemas/Known' },
          { $ref: '#/components/schemas/Other' },
        ],
        discriminator: {
          propertyName: 'kind',
          mapping: { known: `${libraryUri}#/components/schemas/Known` },
          defaultMapping: 'Other',
        },
      },
      Known: { type: 'object', properties: { kind: { const: 'local' } } },
      Other: { type: 'object' },
    });
    const loader = new ExternalResourceLoader(document, uri);
    const snapshot = loader.currentSnapshot();
    const metadata = describeSchemaDiscriminator(snapshot, componentDiscriminatorLocation(uri, 'Payload'));
    const target = metadata.targets.find((item) => item.source === 'explicit' && item.key === 'known');
    expect(schemaDiscriminatorAllowsModelRoute(target?.location)).toBe(false);
    expect(schemaDiscriminatorTargetLabel(target!)).toContain(libraryUri);
    const fields = attachDiscriminatorMappingFields([], metadata);
    const mapped = fields.find((field) => field.name === schemaDiscriminatorFieldName(target!));
    expect(mapped?.refName).toBeUndefined();
    expect(mapped?.description).toContain(libraryUri);
  });

  test('does not overlay mapping rows onto OAS 3.1 documents', () => {
    const document = fixture('3.1.0');
    const snapshot = new ExternalResourceLoader(document, uri).currentSnapshot();
    const metadata = describeSchemaDiscriminator(snapshot, componentDiscriminatorLocation(uri, 'Payload'));
    expect(metadata.status).toBe('unsupported-version');
    expect(discriminatorMetadataVisible(metadata)).toBe(false);
    expect(attachDiscriminatorMappingFields([{ name: 'kind', type: 'string', required: false }], metadata)).toEqual([
      { name: 'kind', type: 'string', required: false },
    ]);
  });

  test('does not treat OAS 3.0 documents as discriminator product documents', () => {
    expect(isOas32DiscriminatorDocument(fixture('3.0.3'))).toBe(false);
  });

  test('keeps authored no-data examples from driving defaultMapping and does not treat hints as validation', () => {
    const snapshot = new ExternalResourceLoader(fixture(), uri).currentSnapshot();
    const metadata = describeSchemaDiscriminator(snapshot, componentDiscriminatorLocation(uri, 'Payload'));
    const serialized = interpretExampleObject(
      { serializedValue: '{"kind":"known"}' },
      { layer: 'media', mediaType: 'application/unknown' },
    );
    const hint = selectDiscriminatorExampleHint(metadata, serialized);
    expect(hint.status).toBe('no-data');
    expect(hint).not.toHaveProperty('valid');
    expect(hint).not.toHaveProperty('errors');
    const author = interpretExampleObject({ dataValue: {} }, { layer: 'media', mediaType: 'application/json' });
    expect(selectDiscriminatorExampleHint(metadata, author)).toMatchObject({ reason: 'default-missing' });
  });

  test('lets explicit mapping win over defaultMapping without treating the hint as JSON Schema validation', () => {
    const snapshot = new ExternalResourceLoader(fixture(), uri).currentSnapshot();
    const metadata = describeSchemaDiscriminator(snapshot, componentDiscriminatorLocation(uri, 'Payload'));
    const author = interpretExampleObject(
      { dataValue: { kind: 'known' } },
      { layer: 'media', mediaType: 'application/json' },
    );
    const hint = selectDiscriminatorExampleHint(metadata, author);
    expect(hint).toMatchObject({ status: 'selected', reason: 'explicit' });
    expect(hint).not.toHaveProperty('valid');
    expect(hint).not.toHaveProperty('errors');
  });

  test('does not invent a default mapping when a validated optional property lacks defaultMapping', () => {
    const document = fixture();
    delete (document.components!.schemas!.Payload as { discriminator: { defaultMapping?: string } }).discriminator
      .defaultMapping;
    const snapshot = new ExternalResourceLoader(document, uri).currentSnapshot();
    const metadata = describeSchemaDiscriminator(snapshot, componentDiscriminatorLocation(uri, 'Payload'));
    const author = interpretExampleObject({ dataValue: {} }, { layer: 'media', mediaType: 'application/json' });
    const hint = selectDiscriminatorExampleHint(metadata, author, { missingPropertyValidated: true });
    expect(hint.status).toBe('unmapped');
    expect(hint.diagnostics.map((item) => item.code)).toContain('OPTIONAL_PROPERTY_WITHOUT_DEFAULT');
  });

  test('surfaces dynamic-scope generation unavailability without claiming a candidate', () => {
    expect(isDynamicScopeGenerationUnavailable('DYNAMIC_SCHEMA_DEPENDENCY_UNAVAILABLE')).toBe(true);
    expect(isDynamicScopeGenerationUnavailable('GENERATION_DID_NOT_PRODUCE_VALID_VALUE')).toBe(false);
  });

  test('does not treat an unchosen overlapping branch as selected', () => {
    expect(selectedDiscriminatorCandidateId(undefined, [{ id: 'left' }, { id: 'right' }])).toBeUndefined();
    expect(selectedDiscriminatorCandidateId('missing', [{ id: 'left' }, { id: 'right' }])).toBeUndefined();
    expect(selectedDiscriminatorCandidateId('left', [{ id: 'left' }, { id: 'right' }])).toBe('left');
    expect(selectedDiscriminatorCandidateId(undefined, [{ id: 'only' }])).toBe('only');
    expect(selectedDiscriminatorCandidateId('missing', [{ id: 'only' }])).toBe('only');
  });

  test('prefers the field-table media schema over document-order content', () => {
    const xml = {
      layer: 'media',
      group: 'body:application/xml',
      mediaType: 'application/xml',
      schemaLocation: { ownerRetrievalUri: uri, pointer: '#/xml' },
    };
    const json = {
      layer: 'media',
      group: 'body:application/json',
      mediaType: 'application/json',
      schemaLocation: { ownerRetrievalUri: uri, pointer: '#/json' },
    };
    expect(preferredDiscriminatorSchemaLocation([xml, json], { role: 'body', mediaType: 'application/json' })).toEqual(
      json.schemaLocation,
    );
    expect(preferredDiscriminatorSchemaLocation([xml, json], { role: 'body' })).toBeUndefined();
    expect(preferredDiscriminatorSchemaLocation([xml, json], { role: 'body', mediaType: 'application/xml' })).toEqual(
      xml.schemaLocation,
    );
    expect(
      preferredDiscriminatorSchemaLocation(
        [
          {
            layer: 'media',
            group: 'response:200:application/xml',
            mediaType: 'application/xml',
            statusCode: '200',
            schemaLocation: { ownerRetrievalUri: uri, pointer: '#/xml' },
          },
          {
            layer: 'media',
            group: 'response:200:application/json',
            mediaType: 'application/json',
            statusCode: '200',
            schemaLocation: { ownerRetrievalUri: uri, pointer: '#/json' },
          },
        ],
        { role: 'response', statusCode: '200', mediaType: 'application/json' },
      ),
    ).toEqual({ ownerRetrievalUri: uri, pointer: '#/json' });
  });
});
