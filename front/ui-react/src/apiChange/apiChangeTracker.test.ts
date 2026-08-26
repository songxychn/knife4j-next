import { describe, expect, it } from 'vitest';
import type { SwaggerDoc } from '../types/swagger';
import {
  API_CHANGE_BASELINE_MAX_BYTES,
  acknowledgeAllApiOperations,
  acknowledgeApiOperation,
  apiOperationIdentity,
  buildApiChangeBaselineStorageKey,
  buildApiOperationFingerprints,
  compareApiChangeBaseline,
  parseApiChangeBaseline,
  reconcileApiChangeBaseline,
  serializeApiChangeBaseline,
  sha256Hex,
  stableSerializeJson,
  summarizeApiChanges,
  type ApiDocumentIdentity,
} from './apiChangeTracker';

const IDENTITY: ApiDocumentIdentity = {
  origin: 'https://docs.example.com',
  applicationPath: '/service/doc.html',
  group: 'pets',
  apiDocsUrl: '/service/v3/api-docs/pets',
};

function apiDocument(): SwaggerDoc {
  return {
    openapi: '3.0.3',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          summary: 'List pets',
          tags: ['Pets'],
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
                },
              },
            },
          },
          security: [{ bearerAuth: [] }],
          'x-owner': 'platform',
        },
      },
    },
    components: {
      schemas: {
        Pet: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            age: { type: 'integer' },
          },
        },
      },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
  } as SwaggerDoc;
}

function fingerprints(document = apiDocument()) {
  const result = buildApiOperationFingerprints(document);
  expect(result).not.toBeNull();
  return result!;
}

describe('API change fingerprints', () => {
  it('uses a standard SHA-256 digest and stable object-key serialization', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(stableSerializeJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it('does not report changes when only JSON object property order differs', () => {
    const original = apiDocument();
    const reordered = {
      components: {
        securitySchemes: { bearerAuth: { scheme: 'bearer', type: 'http' } },
        schemas: {
          Pet: {
            properties: { age: { type: 'integer' }, name: { type: 'string' } },
            required: ['name'],
            type: 'object',
          },
        },
      },
      paths: {
        '/pets': {
          get: {
            'x-owner': 'platform',
            security: [{ bearerAuth: [] }],
            responses: original.paths['/pets'].get!.responses,
            parameters: original.paths['/pets'].get!.parameters,
            tags: ['Pets'],
            summary: 'List pets',
            operationId: 'listPets',
          },
        },
      },
      info: { version: '1.0.0', title: 'Pets' },
      openapi: '3.0.3',
    } as unknown as SwaggerDoc;

    expect(fingerprints(reordered)).toEqual(fingerprints(original));
  });

  it('tracks operation and reachable schema semantics but ignores global document metadata', () => {
    const initial = fingerprints();
    const operationChanged = apiDocument();
    operationChanged.paths['/pets'].get!.parameters![0].description = 'Maximum items';
    expect(fingerprints(operationChanged)).not.toEqual(initial);

    const schemaChanged = apiDocument();
    schemaChanged.components!.schemas!.Pet.properties!.name.description = 'Display name';
    expect(fingerprints(schemaChanged)).not.toEqual(initial);

    const extensionChanged = apiDocument();
    (extensionChanged.paths['/pets'].get as Record<string, unknown>)['x-owner'] = 'consumer';
    expect(fingerprints(extensionChanged)).not.toEqual(initial);

    const infoChanged = apiDocument();
    infoChanged.info.version = '2.0.0';
    infoChanged.info.title = 'Renamed service';
    expect(fingerprints(infoChanged)).toEqual(initial);

    const patchVersionChanged = apiDocument();
    patchVersionChanged.openapi = '3.0.1';
    expect(fingerprints(patchVersionChanged)).toEqual(initial);
  });

  it('limits the closed semantic snapshot contract to OAS 3.0.x', () => {
    const document = apiDocument();
    document.openapi = '3.1.0';
    expect(buildApiOperationFingerprints(document)).toBeNull();
  });
});

describe('API change baselines', () => {
  it('establishes the first baseline without marking every operation as new', () => {
    const current = fingerprints();
    const result = reconcileApiChangeBaseline(IDENTITY, current, null);

    expect(result.initialized).toBe(true);
    expect(result.statuses).toEqual({});
    expect(result.baseline.operations).toEqual(current);
  });

  it('distinguishes added APIs from changed Method + Path identities', () => {
    const initial = fingerprints();
    const baseline = reconcileApiChangeBaseline(IDENTITY, initial, null).baseline;
    const nextDocument = apiDocument();
    nextDocument.paths['/owners'] = {
      post: {
        operationId: 'createOwner',
        summary: 'Create owner',
        tags: ['Owners'],
        responses: { '204': { description: 'Created' } },
      },
    };
    nextDocument.paths['/pets'].get!.summary = 'List all pets';
    const current = fingerprints(nextDocument);
    const statuses = compareApiChangeBaseline(baseline, current);

    expect(statuses[apiOperationIdentity('GET', '/pets')]).toBe('changed');
    expect(statuses[apiOperationIdentity('POST', '/owners')]).toBe('added');
    expect(summarizeApiChanges(statuses)).toEqual({ added: 1, changed: 1, total: 2 });
  });

  it('acknowledges one operation or the whole current group snapshot', () => {
    const baseline = reconcileApiChangeBaseline(IDENTITY, fingerprints(), null).baseline;
    const nextDocument = apiDocument();
    nextDocument.paths['/pets'].get!.summary = 'List every pet';
    nextDocument.paths['/owners'] = {
      get: { summary: 'List owners', tags: ['Owners'], responses: { '200': { description: 'OK' } } },
    };
    const current = fingerprints(nextDocument);

    const acknowledgedOne = acknowledgeApiOperation(baseline, current, 'GET', '/pets');
    expect(compareApiChangeBaseline(acknowledgedOne, current)).toEqual({
      [apiOperationIdentity('GET', '/owners')]: 'added',
    });

    const acknowledgedAll = acknowledgeAllApiOperations(IDENTITY, current);
    expect(compareApiChangeBaseline(acknowledgedAll, current)).toEqual({});
  });

  it('isolates baseline keys by origin, application path, group, and api-docs URL', () => {
    const originalKey = buildApiChangeBaselineStorageKey(IDENTITY);
    (Object.keys(IDENTITY) as Array<keyof ApiDocumentIdentity>).forEach((field) => {
      const changed = { ...IDENTITY, [field]: `${IDENTITY[field]}-other` };
      expect(buildApiChangeBaselineStorageKey(changed)).not.toBe(originalKey);
    });
  });

  it('safely rebuilds corrupt, old-version, wrong-document, and oversized caches', () => {
    const current = fingerprints();
    const baseline = reconcileApiChangeBaseline(IDENTITY, current, null).baseline;
    const serialized = serializeApiChangeBaseline(baseline);
    expect(serialized).not.toBeNull();
    expect(parseApiChangeBaseline(serialized, IDENTITY)).toEqual(baseline);

    expect(parseApiChangeBaseline('{broken', IDENTITY)).toBeNull();
    expect(parseApiChangeBaseline(JSON.stringify({ ...baseline, version: 0 }), IDENTITY)).toBeNull();
    expect(parseApiChangeBaseline(serialized, { ...IDENTITY, group: 'other' })).toBeNull();
    expect(parseApiChangeBaseline('x'.repeat(API_CHANGE_BASELINE_MAX_BYTES + 1), IDENTITY)).toBeNull();

    for (const raw of ['{broken', JSON.stringify({ ...baseline, version: 0 })]) {
      const rebuilt = reconcileApiChangeBaseline(IDENTITY, current, raw);
      expect(rebuilt.initialized).toBe(true);
      expect(rebuilt.statuses).toEqual({});
    }
  });
});
