import { afterEach, describe, expect, test, vi } from 'vitest';
import { collectOas32DocumentDiagnostics, interpretExampleObject } from 'knife4j-core';
import type { SwaggerDoc } from '../types/swagger';
import {
  ExternalResourceLoader,
  schemaDocumentsFromResourceGraph,
  schemaRegistrationContextFromResourceGraph,
  type ResourceGraphSnapshot,
} from './externalResourceGraph';
import { createSchemaDocumentSession, type SchemaDocumentSession } from './schemaDocumentSession';
import { sha256Hex } from '../utils/stableJson';
import {
  createSchemaDiscriminatorIndex,
  discriminatorExampleInput,
  isOas32DiscriminatorDocument,
  selectSchemaDiscriminator,
  type SchemaDiscriminatorInput,
} from './schemaDiscriminator';

const uri = 'https://retrieval.example/entry.json';
const payload = { ownerRetrievalUri: uri, pointer: '#/components/schemas/Payload' };
const sessions: SchemaDocumentSession[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

describe('exact discriminator values, target identities and failure states', () => {
  test.each(['', 'a.b', 'a/b', 'a~b', '#', '中文', '__proto__', 'constructor'])(
    'uses the literal own-property name %j',
    async (name) => {
      const document = fixture('3.2.0', name);
      const metadata = createSchemaDiscriminatorIndex(snapshotFor(document)).describe(payload);
      const value = { [name]: 'known' };
      const session = await sessionFor(document);
      expect(selectSchemaDiscriminator(metadata, known(value))).toMatchObject({
        reason: 'explicit',
        observation: { status: 'present', value: 'known' },
      });
      expect(await session.evaluate(metadata.requested.reference, value)).toMatchObject({ valid: true });
      expect(selectSchemaDiscriminator(metadata, known(Object.create({ [name]: 'known' })))).toMatchObject({
        reason: 'default-missing',
      });
    },
  );

  test('distinguishes null, false, numeric zero and empty string without coercion', () => {
    const document = document32({
      Payload: {
        type: 'object',
        oneOf: [{ $ref: '#/components/schemas/Known' }, { $ref: '#/components/schemas/Other' }],
        discriminator: {
          propertyName: 'kind',
          mapping: { '': 'Known', '0': 'Known', Other: 'Known' },
          defaultMapping: 'Other',
        },
      },
      Known: { required: ['kind'], properties: { kind: { enum: ['', '0', 'Known', 'Other'] } } },
      Other: { properties: { kind: { not: { enum: ['', '0', 'Known', 'Other'] } } } },
    });
    const metadata = createSchemaDiscriminatorIndex(snapshotFor(document)).describe(payload);
    for (const value of [null, false, 0])
      expect(selectSchemaDiscriminator(metadata, known({ kind: value }))).toMatchObject({
        reason: 'default-unmapped',
        observation: { status: 'present', value },
      });
    for (const value of ['', '0', 'Other'])
      expect(selectSchemaDiscriminator(metadata, known({ kind: value }))).toMatchObject({
        reason: 'explicit',
        target: { location: { componentName: 'Known' } },
      });
    expect(selectSchemaDiscriminator(metadata, known({}))).toMatchObject({
      reason: 'default-missing',
      observation: { status: 'missing' },
    });
  });

  test.each(['pending', 'missing', 'wrong-kind'] as const)(
    'never falls back from an explicit %s mapping',
    (failure) => {
      const target =
        failure === 'pending'
          ? 'https://external.example/schema.json'
          : failure === 'missing'
            ? 'foo.json'
            : '#/components/parameters/Wrong';
      // Missing/wrong-kind targets are deliberate invalid reference contracts: rejection only.
      const document = document32({
        Payload: {
          type: 'object',
          oneOf: [
            { $ref: '#/components/schemas/Known' },
            { $ref: '#/components/schemas/Other' },
            ...(failure === 'pending' ? [{ $ref: target }] : []),
          ],
          discriminator: { propertyName: 'kind', mapping: { Known: target }, defaultMapping: 'Other' },
        },
        Known: { type: 'object', required: ['kind'], properties: { kind: { const: 'local' } } },
        Other: { type: 'object', properties: { kind: { not: { enum: ['Known', 'local'] } } } },
      });
      document.components!.parameters = { Wrong: { name: 'n', in: 'query', schema: { type: 'integer' } } };
      const fetchImpl = vi.fn();
      const loader = new ExternalResourceLoader(document, uri, { fetchImpl });
      const metadata = createSchemaDiscriminatorIndex(loader.currentSnapshot()).describe(payload);
      const choice = selectSchemaDiscriminator(metadata, known({ kind: 'Known' }));
      expect(choice).toMatchObject({
        status: 'unavailable',
        reason: 'explicit',
        target: { rawReference: target, state: failure },
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      if (failure !== 'pending') expect(loader.currentDiscovery().candidates).toEqual([]);
    },
  );

  test('inline titles, schema id tails and payload URIs never become implicit component names', () => {
    const document = document32({
      Payload: {
        type: 'object',
        oneOf: [
          {
            title: 'Inline',
            $id: 'https://schema.example/UriName',
            required: ['kind'],
            properties: { kind: { const: 'inline' } },
          },
          { $ref: '#/components/schemas/Other' },
        ],
        discriminator: {
          propertyName: 'kind',
          mapping: { inline: '#/components/schemas/Payload/oneOf/0' },
          defaultMapping: 'Other',
        },
      },
      Other: { type: 'object', properties: { kind: { not: { const: 'inline' } } } },
    });
    const metadata = createSchemaDiscriminatorIndex(snapshotFor(document)).describe(payload);
    expect(selectSchemaDiscriminator(metadata, known({ kind: 'inline' }))).toMatchObject({
      status: 'selected',
      reason: 'explicit',
      target: { location: { pointer: `${payload.pointer}/oneOf/0` } },
    });
    for (const value of ['Inline', 'UriName', 'https://schema.example/UriName'])
      expect(selectSchemaDiscriminator(metadata, known({ kind: value }))).toMatchObject({ reason: 'default-unmapped' });
  });

  test('preserves two complete branches with the same mapped target and different assertion siblings', async () => {
    const document = document32({
      Payload: {
        type: 'object',
        required: ['kind', 'side'],
        oneOf: [
          { $ref: '#/components/schemas/Known', properties: { side: { const: 'left' } } },
          { $ref: '#/components/schemas/Known', properties: { side: { const: 'right' } } },
        ],
        discriminator: { propertyName: 'kind' },
      },
      Known: { type: 'object', properties: { kind: { const: 'Known' } } },
    });
    const snapshot = snapshotFor(document);
    const metadata = createSchemaDiscriminatorIndex(snapshot).describe(payload);
    const data = { kind: 'Known', side: 'left' };
    const choice = selectSchemaDiscriminator(metadata, known(data));
    expect(choice).toMatchObject({ status: 'ambiguous', reason: 'implicit' });
    expect(choice.candidates.map((candidate) => candidate.location.pointer)).toEqual([
      `${payload.pointer}/oneOf/0`,
      `${payload.pointer}/oneOf/1`,
    ]);
    expect(choice.diagnostics.map((item) => item.code)).toContain('AMBIGUOUS_BRANCH');
    const session = await sessionFor(document, snapshot);
    expect(await session.evaluate(metadata.requested.reference, data)).toMatchObject({ valid: true });
  });

  test('diagnoses unlisted targets and undefined mixed compositions without inventing a branch', () => {
    for (const mixed of [false, true]) {
      const document = fixture();
      const schema = document.components!.schemas!.Payload as Record<string, unknown>;
      if (mixed) schema.anyOf = [{ type: 'object' }];
      else {
        document.components!.schemas!.Unlisted = { type: 'object' };
        schema.discriminator = { propertyName: 'kind', mapping: { chosen: 'Unlisted' }, defaultMapping: 'Other' };
      }
      const metadata = createSchemaDiscriminatorIndex(snapshotFor(document)).describe(payload);
      const result = selectSchemaDiscriminator(metadata, known({ kind: mixed ? 'known' : 'chosen' }));
      expect(result.status).toBe('unsupported-configuration');
      expect(result.diagnostics.map((item) => item.code)).toContain(
        mixed ? 'UNSUPPORTED_CONFIGURATION' : 'TARGET_NOT_LISTED',
      );
    }
  });
});

describe('allOf relationships and bounded property-presence evidence', () => {
  test('keeps parent validation independent of the hinted child and excludes property/items references from inheritance', async () => {
    const document = document32({
      Payload: {
        type: 'object',
        required: ['kind'],
        discriminator: { propertyName: 'kind', mapping: { child: 'Child' } },
      },
      Child: { allOf: [{ $ref: '#/components/schemas/Payload' }], required: ['name'] },
      Grandchild: { allOf: [{ $ref: '#/components/schemas/Child' }], required: ['age'] },
      Wrapper: { type: 'object', properties: { child: { $ref: '#/components/schemas/Payload' } } },
      List: { type: 'array', items: { $ref: '#/components/schemas/Payload' } },
    });
    const snapshot = snapshotFor(document);
    const metadata = createSchemaDiscriminatorIndex(snapshot).describe(payload);
    expect(metadata.configuration).toBe('allOf');
    expect(metadata.candidates.map((candidate) => candidate.location.componentName)).toEqual(['Child', 'Grandchild']);
    const choice = selectSchemaDiscriminator(metadata, known({ kind: 'child' }));
    expect(choice).toMatchObject({ status: 'selected', target: { location: { componentName: 'Child' } } });
    const session = await sessionFor(document, snapshot);
    expect(await session.evaluate(metadata.requested.reference, { kind: 'child' })).toMatchObject({ valid: true });
    expect(await session.evaluate(choice.target!.location!.reference, { kind: 'child' })).toMatchObject({
      valid: false,
    });
    expect(snapshot.diagnostics).toEqual([]);
  });

  test('locates a referenced declaration without merging its schema and resolves required through a same-instance ref', () => {
    const document = fixture();
    document.components!.schemas!.Alias = { $ref: '#/components/schemas/Payload', title: 'Alias' };
    document.components!.schemas!.Required = { required: ['kind'] };
    const schema = document.components!.schemas!.Payload as Record<string, unknown>;
    schema.$ref = '#/components/schemas/Required';
    const metadata = createSchemaDiscriminatorIndex(snapshotFor(document)).describe({
      ...payload,
      pointer: '#/components/schemas/Alias',
    });
    expect(metadata).toMatchObject({
      declaration: payload,
      requested: { pointer: '#/components/schemas/Alias' },
      requirement: 'required',
    });
    expect(selectSchemaDiscriminator(metadata, known({ kind: 'known' })).reason).toBe('explicit');
  });

  test('proves required through every anyOf branch and through indirect allOf constraints', () => {
    const document = document32({
      Payload: {
        anyOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
        discriminator: { propertyName: 'kind' },
      },
      A: { allOf: [{ $ref: '#/components/schemas/Required' }] },
      B: { required: ['kind'] },
      Required: { required: ['kind'] },
    });
    expect(createSchemaDiscriminatorIndex(snapshotFor(document)).describe(payload).requirement).toBe('required');
  });

  test('keeps uncertain optionality unknown and accepts only actual missing plus whole-valid caller evidence', async () => {
    // Deliberately missing defaultMapping: a valid logical instance proves the annotation defect.
    const document = document32({
      Payload: { type: 'object', anyOf: [{ $ref: '#/components/schemas/A' }], discriminator: { propertyName: 'kind' } },
      A: {
        required: ['other'],
        properties: { other: { type: 'integer' } },
        if: { required: ['trigger'] },
        then: { required: ['kind'] },
      },
    });
    const snapshot = snapshotFor(document);
    const metadata = createSchemaDiscriminatorIndex(snapshot).describe(payload);
    expect(metadata.requirement).toBe('unknown');
    expect(metadata.diagnostics.map((item) => item.code)).not.toContain('OPTIONAL_PROPERTY_WITHOUT_DEFAULT');
    const data = { other: 1 };
    const session = await sessionFor(document, snapshot);
    const validation = await session.evaluate(metadata.requested.reference, data);
    expect(validation.valid).toBe(true);
    const selected = selectSchemaDiscriminator(metadata, known(data), { missingPropertyValidated: validation.valid });
    expect(selected.requirement).toBe('proven-optional');
    expect(selected.diagnostics.map((item) => item.code)).toContain('OPTIONAL_PROPERTY_WITHOUT_DEFAULT');
    expect(
      selectSchemaDiscriminator(
        metadata,
        { status: 'no-data', source: 'externalValue' },
        { missingPropertyValidated: true },
      ).requirement,
    ).toBe('unknown');
    expect(
      selectSchemaDiscriminator(metadata, known({ kind: null }), { missingPropertyValidated: true }).requirement,
    ).toBe('unknown');
  });

  test('reports proven optional without default but does not infer optionality from a missing root required array', () => {
    const document = fixture();
    (document.components!.schemas!.Payload as Record<string, unknown>).discriminator = {
      propertyName: 'kind',
      mapping: { known: 'Known' },
    };
    const metadata = createSchemaDiscriminatorIndex(snapshotFor(document)).describe(payload);
    expect(metadata.requirement).toBe('proven-optional');
    expect(metadata.diagnostics.map((item) => item.code)).toContain('OPTIONAL_PROPERTY_WITHOUT_DEFAULT');
  });
});

function document32(schemas: Record<string, unknown> = {}, version = '3.2.0'): SwaggerDoc {
  return {
    openapi: version,
    info: { title: 'Synthetic discriminator hints', version: '1' },
    components: { schemas },
  } as SwaggerDoc;
}

// Complete OAS documents; the discriminator conditions are checked against
// OAS 3.2.0 §§4.25 and 4.1.2.3, independently of the structural collector.
function fixture(version = '3.2.0', propertyName = 'kind'): SwaggerDoc {
  return document32(
    {
      Payload: {
        type: 'object',
        oneOf: [{ $ref: '#/components/schemas/Known' }, { $ref: '#/components/schemas/Other' }],
        discriminator: { propertyName, mapping: { known: 'Known' }, defaultMapping: 'Other' },
      },
      Known: {
        type: 'object',
        required: [propertyName],
        properties: { [propertyName]: { enum: ['known', 'Known'] } },
      },
      Other: { type: 'object', properties: { [propertyName]: { not: { enum: ['known', 'Known'] } } } },
    },
    version,
  );
}

function snapshotFor(document: SwaggerDoc): ResourceGraphSnapshot {
  if (document.openapi?.startsWith('3.2.')) expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
  return new ExternalResourceLoader(document, uri).currentSnapshot();
}

async function sessionFor(document: SwaggerDoc, snapshot = snapshotFor(document)) {
  const session = await createSchemaDocumentSession(document, uri, {
    resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
    registrationContext: schemaRegistrationContextFromResourceGraph(snapshot, uri),
  });
  sessions.push(session);
  return session;
}

const known = (value: unknown): SchemaDiscriminatorInput => ({ status: 'known', value, source: 'dataValue' });

describe('current C/D graph identities, dialects and work budgets', () => {
  test('uses the entry names and source document self for mappings, independently of the schema id', async () => {
    const libraryUri = 'https://retrieval.example/library.json';
    const targetUri = 'https://identity.example/library/uri.json';
    const external = document32({
      Payload: {
        $id: 'nested/payload',
        type: 'object',
        oneOf: [
          { $ref: `${uri}#/components/schemas/Known` },
          { $ref: `${uri}#/components/schemas/Other` },
          { $ref: '../uri.json' },
        ],
        discriminator: {
          propertyName: 'kind',
          mapping: { known: 'Known', explicit: './uri.json' },
          defaultMapping: 'Other',
        },
      },
      Known: { type: 'object', properties: { wrong: { const: true } } },
      Other: { type: 'object' },
    });
    Object.assign(external, { $self: 'https://identity.example/library/openapi.json#identity' });
    const document = fixture();
    document.components!.schemas!.Payload = { $ref: `${libraryUri}#/components/schemas/Payload` };
    document.components!.schemas!.Other = {
      type: 'object',
      properties: { kind: { not: { enum: ['Known', 'known', 'explicit'] } } },
    };
    const explicitTarget = { type: 'object', required: ['kind'], properties: { kind: { const: 'explicit' } } };
    expect(collectOas32DocumentDiagnostics(external)).toEqual([]);
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(JSON.stringify(String(input) === libraryUri ? external : explicitTarget), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const loader = new ExternalResourceLoader(document, uri, { fetchImpl });
    const grant = (resource: string) => ({
      scope: 'generation' as const,
      documentScope: loader.documentScope,
      resourceKey: sha256Hex(resource),
    });
    const pending = await loader.load([grant(libraryUri)]);
    const pendingMetadata = createSchemaDiscriminatorIndex(pending).describe(payload);
    expect(selectSchemaDiscriminator(pendingMetadata, known({ kind: 'explicit' }))).toMatchObject({
      status: 'unavailable',
      reason: 'explicit',
      target: { state: 'pending', resolvedUri: targetUri },
    });
    const snapshot = await loader.continueLoad([grant(targetUri)]);
    const beforeCalls = fetchImpl.mock.calls.length;
    const metadata = createSchemaDiscriminatorIndex(snapshot).describe(payload);
    expect(metadata.declaration).toMatchObject({ ownerRetrievalUri: libraryUri, pointer: payload.pointer });
    const implicit = selectSchemaDiscriminator(metadata, known({ kind: 'Known' }));
    expect(implicit).toMatchObject({
      status: 'selected',
      reason: 'implicit',
      target: { location: { ownerRetrievalUri: uri, componentName: 'Known' } },
    });
    const explicit = selectSchemaDiscriminator(metadata, known({ kind: 'explicit' }));
    expect(explicit).toMatchObject({
      status: 'selected',
      reason: 'explicit',
      target: { location: { ownerRetrievalUri: targetUri, pointer: '#' } },
    });
    expect(explicit.target!.location).not.toHaveProperty('componentName');
    const session = await sessionFor(document, snapshot);
    expect(await session.resolve(explicit.target!.location!.reference)).toMatchObject({ schema: explicitTarget });
    expect(await session.evaluate(metadata.requested.reference, { kind: 'explicit' })).toMatchObject({ valid: true });
    expect(fetchImpl).toHaveBeenCalledTimes(beforeCalls);
    expect(selectSchemaDiscriminator(pendingMetadata, known({ kind: 'explicit' })).target?.state).toBe('pending');
    expect(metadata.snapshot).toBe(snapshot);
  });

  test('keeps equal external component names physically distinct and does not route them to the entry name', async () => {
    const externalUri = 'https://external.example/models.json';
    const external = document32({
      Known: { type: 'object', required: ['kind'], properties: { kind: { const: 'remote' } } },
    });
    const document = fixture();
    const schema = document.components!.schemas!.Payload as Record<string, unknown>;
    (schema.oneOf as unknown[]).push({ $ref: `${externalUri}#/components/schemas/Known` });
    schema.discriminator = {
      propertyName: 'kind',
      mapping: { remote: `${externalUri}#/components/schemas/Known` },
      defaultMapping: 'Other',
    };
    document.components!.schemas!.Other = { properties: { kind: { not: { enum: ['Known', 'known', 'remote'] } } } };
    const loader = new ExternalResourceLoader(document, uri, {
      fetchImpl: async () =>
        new Response(JSON.stringify(external), { headers: { 'content-type': 'application/json' } }),
    });
    const snapshot = await loader.load([
      { scope: 'generation', documentScope: loader.documentScope, resourceKey: sha256Hex(externalUri) },
    ]);
    const metadata = createSchemaDiscriminatorIndex(snapshot).describe(payload);
    const choice = selectSchemaDiscriminator(metadata, known({ kind: 'remote' }));
    expect(choice.target?.location?.ownerRetrievalUri).toBe(externalUri);
    expect(choice.target?.location).not.toHaveProperty('componentName');
    expect(selectSchemaDiscriminator(metadata, known({ kind: 'Known' })).target?.location?.ownerRetrievalUri).toBe(uri);
  });

  test('round-trips percent, punctuation and Unicode physical locations through the actual session', async () => {
    const names = ['a%3A', 'a:', 'a%26', 'a&', 'a%253A', 'a/b~#中文'];
    const reference = (name: string) =>
      `#/components/schemas/Payload/$defs/${encodeURIComponent(name.replace(/~/g, '~0').replace(/\//g, '~1'))}`;
    const definitions = Object.fromEntries(
      names.map((name) => [name, { type: 'object', required: ['kind'], properties: { kind: { const: name } } }]),
    );
    const document = document32({
      Payload: {
        type: 'object',
        required: ['kind'],
        $defs: definitions,
        oneOf: names.map((name) => ({ $ref: reference(name) })),
        discriminator: {
          propertyName: 'kind',
          mapping: Object.fromEntries(names.map((name) => [name, reference(name)])),
        },
      },
    });
    const snapshot = snapshotFor(document);
    const metadata = createSchemaDiscriminatorIndex(snapshot).describe(payload);
    const session = await sessionFor(document, snapshot);
    const references = new Set<string>();
    for (const name of names) {
      const selected = selectSchemaDiscriminator(metadata, known({ kind: name }));
      expect(selected.status).toBe('selected');
      expect(selected.target?.rawReference).toBe(reference(name));
      const publicReference = selected.target!.location!.reference;
      references.add(publicReference);
      expect(await session.resolve(publicReference)).toMatchObject({ schema: definitions[name] });
      expect(await session.evaluate(metadata.requested.reference, { kind: name })).toMatchObject({ valid: true });
      expect(publicReference).not.toContain('knife4j-adapter');
    }
    expect(references.size).toBe(names.length);
  });

  test.each([
    'https://json-schema.org/draft/2020-12/schema',
    'https://spec.openapis.org/oas/3.1/dialect/base',
    'https://spec.openapis.org/oas/3.2/dialect/2025-09-17',
  ])('uses OAS hints at actual Schema positions with public dialect %s', async (dialect) => {
    const document = fixture();
    (document.components!.schemas!.Payload as Record<string, unknown>).$schema = dialect;
    const snapshot = snapshotFor(document);
    const metadata = createSchemaDiscriminatorIndex(snapshot).describe(payload);
    const session = await sessionFor(document, snapshot);
    expect((await session.resolve(metadata.requested.reference)).dialectId).toBe(dialect);
    expect(selectSchemaDiscriminator(metadata, known({ kind: 'known' })).status).toBe('selected');
  });

  test('does not bypass unsupported external dialects or treat opaque annotations as declarations', async () => {
    const document = fixture();
    const opaque = {
      discriminator: { propertyName: 'kind', defaultMapping: 'https://never.example/target' },
      oneOf: [true],
    };
    Object.assign(document.components!.schemas!.Payload as object, {
      examples: [opaque],
      'x-data': opaque,
      unknownAnnotation: opaque,
    });
    const externalUri = 'https://external.example/unknown.json';
    document.components!.schemas!.Unknown = { $ref: externalUri };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ $schema: 'https://unknown.example/dialect', ...opaque }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    const loader = new ExternalResourceLoader(document, uri, { fetchImpl });
    const snapshot = await loader.load([
      { scope: 'generation', documentScope: loader.documentScope, resourceKey: sha256Hex(externalUri) },
    ]);
    const index = createSchemaDiscriminatorIndex(snapshot);
    expect(index.declarations.map((item) => item.pointer)).toEqual([payload.pointer]);
    expect(index.describe({ ownerRetrievalUri: externalUri, pointer: '#' }).status).toBe('unavailable');
    expect(snapshot.diagnostics.map((item) => item.code)).toContain('DIALECT_UNSUPPORTED');
    for (const pointer of [
      `${payload.pointer}/examples/0`,
      `${payload.pointer}/x-data`,
      `${payload.pointer}/unknownAnnotation`,
    ])
      expect(index.describe({ ...payload, pointer }).status).toBe('unavailable');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test.each(['3.0.4', '3.1.1'])('keeps legal %s documents outside this application path', (version) => {
    const document = document32(
      {
        Payload: {
          type: 'object',
          required: ['kind'],
          oneOf: [{ $ref: '#/components/schemas/A' }],
          discriminator: { propertyName: 'kind' },
        },
        A: { type: 'object' },
      },
      version,
    );
    expect(isOas32DiscriminatorDocument(document)).toBe(false);
    if (version.startsWith('3.1.')) {
      const metadata = createSchemaDiscriminatorIndex(
        new ExternalResourceLoader(document, uri).currentSnapshot(),
      ).describe(payload);
      expect(metadata.status).toBe('unsupported-version');
      expect(selectSchemaDiscriminator(metadata, known({ kind: 'A' })).status).toBe('not-applicable');
    }
  });

  test('stops at index, target, candidate, traversal and depth budgets; cancellation cannot select a fallback', () => {
    const document = fixture();
    document.components!.schemas!.Alias1 = { $ref: '#/components/schemas/Alias2' };
    document.components!.schemas!.Alias2 = { $ref: '#/components/schemas/Payload' };
    const snapshot = snapshotFor(document);
    for (const limits of [{ maxIndexEntries: 1 }, { maxIndexSteps: 1 }]) {
      const index = createSchemaDiscriminatorIndex(snapshot, { limits });
      expect(index.status).toBe('budget-exceeded');
      expect(selectSchemaDiscriminator(index.describe(payload), known({})).status).toBe('unavailable');
    }
    for (const limits of [{ maxTargets: 1 }, { maxCandidates: 1 }, { maxTraversalSteps: 1 }, { maxDepth: 1 }]) {
      const metadata = createSchemaDiscriminatorIndex(snapshot, { limits }).describe({
        ...payload,
        pointer: '#/components/schemas/Alias1',
      });
      expect(metadata.status).toBe('budget-exceeded');
      expect(selectSchemaDiscriminator(metadata, known({ kind: 'known' })).status).toBe('unavailable');
    }
    const controller = new AbortController();
    controller.abort();
    expect(createSchemaDiscriminatorIndex(snapshot, { signal: controller.signal }).status).toBe('aborted');
    const index = createSchemaDiscriminatorIndex(snapshot);
    expect(index.describe(payload, { signal: controller.signal }).status).toBe('aborted');
    expect(selectSchemaDiscriminator(index.describe(payload), known({}), { signal: controller.signal }).status).toBe(
      'unavailable',
    );
    expect(() => createSchemaDiscriminatorIndex(snapshot, { limits: { maxDepth: 0 } })).toThrow(
      'positive safe integer',
    );
  });

  test('bounds normal recursive inheritance and reuses one index for many data selections without mutation', () => {
    const schemas: Record<string, unknown> = {
      Payload: {
        type: 'object',
        required: ['kind'],
        discriminator: { propertyName: 'kind' },
        properties: { child: { $ref: '#/components/schemas/Payload' } },
      },
    };
    for (let i = 0; i < 120; i++)
      schemas[`Child${i}`] = {
        allOf: [{ $ref: '#/components/schemas/Payload' }],
        properties: { kind: { const: `Child${i}` } },
      };
    const document = document32(schemas);
    const before = JSON.stringify(document);
    const snapshot = snapshotFor(document);
    const snapshotBefore = JSON.stringify({
      locations: snapshot.objectLocations,
      edges: snapshot.edges,
      nodes: [...snapshot.nodes],
    });
    const index = createSchemaDiscriminatorIndex(snapshot);
    const metadata = index.describe(payload);
    expect(metadata.status).toBe('ready');
    expect(metadata.candidates).toHaveLength(120);
    const steps = index.indexSteps;
    for (let i = 0; i < 120; i++) {
      const value = { kind: `Child${i}`, child: { kind: 'Child0' } };
      expect(selectSchemaDiscriminator(metadata, known(value))).toMatchObject({
        status: 'selected',
        reason: 'implicit',
      });
      expect(Object.isFrozen(value)).toBe(false);
    }
    expect(index.indexSteps).toBe(steps);
    expect(Object.isFrozen(metadata.candidates)).toBe(true);
    expect(JSON.stringify(document)).toBe(before);
    expect(
      JSON.stringify({ locations: snapshot.objectLocations, edges: snapshot.edges, nodes: [...snapshot.nodes] }),
    ).toBe(snapshotBefore);
  });
});

describe('OAS 3.2 discriminator metadata and selection', () => {
  test.each(['3.2.0', '3.2.99'])(
    'uses explicit, implicit and default choices without changing %s validation',
    async (version) => {
      const document = fixture(version);
      const snapshot = snapshotFor(document);
      const index = createSchemaDiscriminatorIndex(snapshot);
      const metadata = index.describe(payload);
      const session = await sessionFor(document, snapshot);
      expect(metadata).toMatchObject({ status: 'ready', configuration: 'oneOf', requirement: 'proven-optional' });
      expect(metadata.declaration).toMatchObject({ ...payload, reference: `${uri}#/components/schemas/Payload` });
      for (const [value, reason, name] of [
        [{ kind: 'known' }, 'explicit', 'Known'],
        [{ kind: 'Known' }, 'implicit', 'Known'],
        [{}, 'default-missing', 'Other'],
        [{ kind: 'unlisted' }, 'default-unmapped', 'Other'],
        [{ kind: 'Other' }, 'implicit', 'Other'],
      ] as const) {
        const before = JSON.stringify(value);
        const selection = selectSchemaDiscriminator(metadata, known(value));
        expect(selection).toMatchObject({ status: 'selected', reason, target: { location: { componentName: name } } });
        expect(selection.candidates).toHaveLength(1);
        expect(await session.resolve(selection.target!.location!.reference)).toMatchObject({
          schema: expect.any(Object),
        });
        expect(await session.evaluate(metadata.requested.reference, value)).toMatchObject({ valid: true });
        expect(JSON.stringify(value)).toBe(before);
      }
      expect(JSON.stringify(document)).toBe(JSON.stringify(fixture(version)));
    },
  );

  test('preserves whole oneOf failure even when a target is selected; anyOf may validate multiple branches', async () => {
    for (const composition of ['oneOf', 'anyOf']) {
      const document = document32({
        Payload: {
          type: 'object',
          required: ['kind'],
          [composition]: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
          discriminator: { propertyName: 'kind', mapping: { chosen: 'A' } },
        },
        A: { type: 'object' },
        B: { type: 'object' },
      });
      const snapshot = snapshotFor(document);
      const metadata = createSchemaDiscriminatorIndex(snapshot).describe(payload);
      const data = { kind: 'chosen' };
      const session = await sessionFor(document, snapshot);
      const before = await session.evaluate(metadata.requested.reference, data);
      expect(selectSchemaDiscriminator(metadata, known(data))).toMatchObject({
        status: 'selected',
        reason: 'explicit',
      });
      expect(before.valid).toBe(composition === 'anyOf');
      expect(await session.evaluate(metadata.requested.reference, data)).toEqual(before);
      session.dispose();
    }
  });

  test('distinguishes G logical data from serialized or external no-data and non-object input', () => {
    const metadata = createSchemaDiscriminatorIndex(snapshotFor(fixture())).describe(payload);
    for (const source of [{ serializedValue: '{}' }, { externalValue: './example.json' }, { summary: 'metadata' }]) {
      const representation = interpretExampleObject(source, { layer: 'media', mediaType: 'application/unknown' });
      const input = discriminatorExampleInput(representation);
      expect(input.status).toBe('no-data');
      expect(selectSchemaDiscriminator(metadata, input)).toMatchObject({
        status: 'no-data',
        observation: { status: 'no-data' },
      });
    }
    const author = interpretExampleObject({ dataValue: {} }, { layer: 'media', mediaType: 'application/json' });
    expect(selectSchemaDiscriminator(metadata, discriminatorExampleInput(author))).toMatchObject({
      reason: 'default-missing',
    });
    for (const value of [null, false, 0, '', []])
      expect(selectSchemaDiscriminator(metadata, known(value))).toMatchObject({ status: 'not-applicable' });
  });
});

describe('annotation rejection and validation separation', () => {
  test.each([
    { mapping: { known: 'Known' }, defaultMapping: 'Other' },
    { propertyName: 0, defaultMapping: 'Other' },
    { propertyName: 'kind', mapping: false, defaultMapping: 'Other' },
  ])('rejects malformed discriminator structure without choosing a default', (discriminator) => {
    const document = fixture();
    (document.components!.schemas!.Payload as Record<string, unknown>).discriminator = discriminator;
    // Deliberately malformed fixtures verify diagnostics, never compatibility.
    expect(collectOas32DocumentDiagnostics(document).length).toBeGreaterThan(0);
    const metadata = createSchemaDiscriminatorIndex(
      new ExternalResourceLoader(document, uri).currentSnapshot(),
    ).describe(payload);
    expect(selectSchemaDiscriminator(metadata, known({ kind: 'known' })).status).toBe('unsupported-configuration');
  });

  test('keeps invalid explicit target values present and never falls back to a valid default', () => {
    const document = fixture();
    (document.components!.schemas!.Payload as Record<string, unknown>).discriminator = {
      propertyName: 'kind',
      mapping: { known: false },
      defaultMapping: 'Other',
    };
    const metadata = createSchemaDiscriminatorIndex(
      new ExternalResourceLoader(document, uri).currentSnapshot(),
    ).describe(payload);
    expect(selectSchemaDiscriminator(metadata, known({ kind: 'known' }))).toMatchObject({
      status: 'unavailable',
      reason: 'explicit',
      target: { rawReference: false, state: 'invalid' },
    });
  });

  test('distinguishes a missing required property and an unmapped present value when there is no default', () => {
    const document = document32({
      Payload: {
        type: 'object',
        required: ['kind'],
        anyOf: [{ $ref: '#/components/schemas/Known' }],
        discriminator: { propertyName: 'kind' },
      },
      Known: { type: 'object' },
    });
    const metadata = createSchemaDiscriminatorIndex(snapshotFor(document)).describe(payload);
    expect(selectSchemaDiscriminator(metadata, known({}))).toMatchObject({
      status: 'unmapped',
      observation: { status: 'missing' },
      requirement: 'required',
    });
    expect(selectSchemaDiscriminator(metadata, known({ kind: 'missing' }))).toMatchObject({
      status: 'unmapped',
      observation: { status: 'present', value: 'missing' },
    });
  });

  test('does not treat a selected and valid target as validation of other root assertions', async () => {
    const document = fixture();
    (document.components!.schemas!.Payload as Record<string, unknown>).required = ['rootOnly'];
    const snapshot = snapshotFor(document);
    const metadata = createSchemaDiscriminatorIndex(snapshot).describe(payload);
    const data = { kind: 'known' };
    const session = await sessionFor(document, snapshot);
    const validation = await session.evaluate(metadata.requested.reference, data);
    const selection = selectSchemaDiscriminator(metadata, known(data));
    expect(selection.status).toBe('selected');
    expect(await session.evaluate(selection.target!.location!.reference, data)).toMatchObject({ valid: true });
    expect(validation.valid).toBe(false);
    expect(await session.evaluate(metadata.requested.reference, data)).toEqual(validation);
    expect(selection).not.toHaveProperty('valid');
    expect(selection).not.toHaveProperty('errors');
  });

  test('uses a literal __proto__ mapping key and actual __proto__ component without prototype lookup', () => {
    const document = document32({
      Payload: {
        type: 'object',
        required: ['kind'],
        anyOf: [{ $ref: '#/components/schemas/__proto__' }],
        discriminator: { propertyName: 'kind', mapping: { ['__proto__']: '__proto__' } },
      },
      ['__proto__']: { type: 'object' },
    });
    const metadata = createSchemaDiscriminatorIndex(snapshotFor(document)).describe(payload);
    expect(selectSchemaDiscriminator(metadata, known({ kind: '__proto__' }))).toMatchObject({
      status: 'selected',
      reason: 'explicit',
      target: { key: '__proto__', location: { componentName: '__proto__' } },
    });
    expect(selectSchemaDiscriminator(metadata, known({ kind: 'constructor' })).status).toBe('unmapped');
  });
});
