import { afterEach, describe, expect, test, vi } from 'vitest';
import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import type { SwaggerDoc } from '../types/swagger';
import {
  ExternalResourceLoader,
  schemaDocumentsFromResourceGraph,
  schemaRegistrationContextFromResourceGraph,
} from './externalResourceGraph';
import {
  createSchemaDocumentSession,
  evaluateSchemaDocumentDirectionally,
  type SchemaDocumentResource,
  type SchemaDocumentSession,
} from './schemaDocumentSession';
import { createSchemaDiscriminatorIndex } from './schemaDiscriminator';
import { sha256Hex } from '../utils/stableJson';
import * as examples from './schemaExampleGeneration';
import * as documents from './schemaDocumentSession';
import {
  generateDiscriminatorCandidate,
  type GenerateDiscriminatorCandidateInput,
} from './schemaDiscriminatorGeneration';

const uri = 'https://docs.example/entry.json';
const location = { ownerRetrievalUri: uri, pointer: '#/components/schemas/Payload' };
const sessions: SchemaDocumentSession[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.restoreAllMocks();
});

function fixture(version = '3.2.0', propertyName = 'kind'): SwaggerDoc {
  return {
    openapi: version,
    info: { title: 'Synthetic explicit discriminator generation', version: '1' },
    components: {
      schemas: {
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
    },
  } as SwaggerDoc;
}

async function setup(document = fixture(), resources = new Map<string, unknown>(), registered = document) {
  expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
  const loader = new ExternalResourceLoader(document, uri, {
    fetchImpl: async (input) =>
      new Response(JSON.stringify(resources.get(String(input))), { headers: { 'content-type': 'application/json' } }),
  });
  const snapshot = resources.size
    ? await loader.load(
        [...resources.keys()].map((resource) => ({
          scope: 'generation',
          documentScope: loader.documentScope,
          resourceKey: sha256Hex(resource),
        })),
      )
    : loader.currentSnapshot();
  const metadata = createSchemaDiscriminatorIndex(snapshot).describe(location);
  const session = await createSchemaDocumentSession(registered, uri, {
    resourceDocuments: schemaDocumentsFromResourceGraph(snapshot),
    registrationContext: schemaRegistrationContextFromResourceGraph(snapshot, uri),
  });
  sessions.push(session);
  return { document, loader, snapshot, metadata, session };
}

async function replaceSession(
  context: Awaited<ReturnType<typeof setup>>,
  extraDocuments: readonly SchemaDocumentResource[],
) {
  context.session.dispose();
  const session = await createSchemaDocumentSession(context.document, uri, {
    resourceDocuments: [...schemaDocumentsFromResourceGraph(context.snapshot), ...extraDocuments],
    registrationContext: schemaRegistrationContextFromResourceGraph(context.snapshot, uri),
  });
  sessions.push(session);
  return { ...context, session };
}

function request(
  context: Awaited<ReturnType<typeof setup>>,
  source = 'explicit',
  key?: string,
): GenerateDiscriminatorCandidateInput {
  const target = context.metadata.targets.find(
    (candidate) => candidate.source === source && (key === undefined || candidate.key === key),
  )!;
  return {
    metadata: context.metadata,
    snapshot: context.snapshot,
    generation: context.snapshot.generation,
    requested: context.metadata.requested,
    session: context.session,
    direction: 'request',
    targetId: target.id,
    operationToken: 'operation-1',
    selectionToken: 'selection-1',
  };
}

describe('explicit target candidate generation', () => {
  test.each(['3.2.0', '3.2.99'])(
    'generates and directionally verifies explicit, implicit and default choices in %s',
    async (version) => {
      const context = await setup(fixture(version));
      for (const [source, key] of [
        ['explicit', 'known'],
        ['implicit', 'Known'],
        ['default', undefined],
      ] as const) {
        const result = await generateDiscriminatorCandidate(request(context, source, key));
        expect(result.status).toBe('value');
        if (result.status !== 'value') throw new Error(JSON.stringify(result));
        expect(result.validations.target?.valid).toBe(true);
        expect(result.validations.branch?.valid).toBe(true);
        expect(result.validations.root?.valid).toBe(true);
        if (source === 'default')
          expect(result.value).toEqual(
            result.generationResult?.status === 'value' ? result.generationResult.value : undefined,
          );
        else expect(result.value).toEqual({ kind: key });
        expect(result.provenance.snapshot).toBe(context.snapshot);
        expect(result.provenance.session).toBe(context.session);
        expect(result.provenance.selectionToken).toBe('selection-1');
        expect(result.budget.generationCalls).toBe(1);
        expect(result.budget.validationCalls).toBe(3);
      }
    },
  );
});

describe('selected branch, seed and root validation remain independent', () => {
  test('a default action preserves the generated missing property and does not inject a key', async () => {
    const document = fixture();
    (document.components!.schemas!.Other as Record<string, unknown>).examples = [{}];
    const context = await setup(document);
    const result = await generateDiscriminatorCandidate(request(context, 'default'));
    expect(result).toMatchObject({ status: 'value', value: {}, hint: { reason: 'default-missing' } });
    expect(result.generationResult).toMatchObject({ status: 'value', value: {}, authored: true });
  });

  test.each(['', '__proto__', 'constructor', 'a/b~#中文', 'a.b'])(
    'seeds the literal %j property on a fresh own-safe candidate',
    async (propertyName) => {
      const document = fixture('3.2.0', propertyName);
      const source = { [propertyName]: 'known', nested: JSON.parse('{"__proto__":{"keep":true}}') };
      (document.components!.schemas!.Known as Record<string, unknown>).examples = [source];
      const before = JSON.stringify(document);
      const context = await setup(document);
      const result = await generateDiscriminatorCandidate(request(context, 'implicit', 'Known'));
      expect(result.status).toBe('value');
      if (result.status !== 'value') throw new Error(JSON.stringify(result.diagnostics));
      expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
      expect(Object.prototype.hasOwnProperty.call(result.value, propertyName)).toBe(true);
      expect((result.value as Record<string, unknown>)[propertyName]).toBe('Known');
      expect(result.value).not.toBe(source);
      expect(result.generationResult).toMatchObject({ status: 'value', value: source });
      expect(JSON.stringify(document)).toBe(before);
      expect(Object.isFrozen(source)).toBe(false);
      expect(source[propertyName]).toBe('known');
    },
  );

  test('requires explicit branch choice for a shared target and preserves that branch assertion siblings', async () => {
    const document = fixture();
    Object.assign(document.components!.schemas!.Payload as object, {
      required: ['kind', 'side'],
      oneOf: [
        { $ref: '#/components/schemas/Known', required: ['side'], properties: { side: { const: 'left' } } },
        { $ref: '#/components/schemas/Known', required: ['side'], properties: { side: { const: 'right' } } },
      ],
      discriminator: { propertyName: 'kind', mapping: { known: 'Known' } },
    });
    const context = await setup(document);
    const input = request(context);
    expect(await generateDiscriminatorCandidate(input)).toMatchObject({
      status: 'none',
      reason: 'ambiguous',
      budget: { generationCalls: 0 },
    });
    const right = context.metadata.candidates[1];
    const result = await generateDiscriminatorCandidate({ ...input, candidateId: right.id });
    expect(result).toMatchObject({
      status: 'value',
      value: { kind: 'known', side: 'right' },
      validations: { root: { valid: true } },
    });
    expect(result.provenance.branch).toBe(right);
    expect(result.hint?.status).toBe('ambiguous');
    expect(await generateDiscriminatorCandidate({ ...input, candidateId: 'invented' })).toMatchObject({
      status: 'none',
      reason: 'unavailable',
      budget: { generationCalls: 0 },
    });
  });

  test.each(['required', 'not', 'additionalProperties', 'overlapping-oneOf'])(
    'never promotes a valid target/branch when the whole root fails %s',
    async (constraint) => {
      const document = fixture();
      const root = document.components!.schemas!.Payload as Record<string, unknown>;
      if (constraint === 'required') root.required = ['rootOnly'];
      if (constraint === 'not') root.not = { required: ['kind'] };
      if (constraint === 'additionalProperties') root.additionalProperties = false;
      if (constraint === 'overlapping-oneOf') root.oneOf = [{ $ref: '#/components/schemas/Known' }, { type: 'object' }];
      // The negative instance, rather than the hint, exercises the complete JSON Schema.
      const context = await setup(document);
      const result = await generateDiscriminatorCandidate(request(context));
      expect(result).toMatchObject({
        status: 'none',
        reason: 'root-invalid',
        validations: { target: { valid: true }, branch: { valid: true }, root: { valid: false } },
      });
      expect(result).not.toHaveProperty('value');
      expect(result.hint).toMatchObject({ reason: 'explicit' });
    },
  );

  test('anyOf overlap remains valid and the selected target and branch are separately checked', async () => {
    const document = fixture();
    const root = document.components!.schemas!.Payload as Record<string, unknown>;
    delete root.oneOf;
    root.anyOf = [{ $ref: '#/components/schemas/Known' }, { $ref: '#/components/schemas/Other' }];
    document.components!.schemas!.Other = { type: 'object' };
    const context = await setup(document);
    const result = await generateDiscriminatorCandidate(request(context));
    expect(result).toMatchObject({
      status: 'value',
      validations: { target: { valid: true }, branch: { valid: true }, root: { valid: true } },
    });
  });

  test('seeding an incompatible key fails the actual target even when another root branch validates', async () => {
    const document = fixture();
    (document.components!.schemas!.Payload as Record<string, unknown>).discriminator = {
      propertyName: 'kind',
      mapping: { incompatible: 'Known' },
      defaultMapping: 'Other',
    };
    const context = await setup(document);
    const result = await generateDiscriminatorCandidate(request(context));
    expect(result).toMatchObject({
      status: 'none',
      reason: 'target-invalid',
      validations: { target: { valid: false }, branch: { valid: false }, root: { valid: true } },
    });
  });

  test('a seed must still validate the selected complete branch even if the target and another root branch pass', async () => {
    const document = fixture();
    Object.assign(document.components!.schemas!.Payload as object, {
      oneOf: [
        { $ref: '#/components/schemas/Known', properties: { kind: { const: 'known' } } },
        { $ref: '#/components/schemas/Known', properties: { kind: { const: 'Known' } } },
      ],
      discriminator: { propertyName: 'kind', mapping: { Known: 'Known' } },
    });
    const context = await setup(document);
    const result = await generateDiscriminatorCandidate({
      ...request(context),
      candidateId: context.metadata.candidates[0].id,
    });
    expect(result).toMatchObject({
      status: 'none',
      reason: 'branch-invalid',
      validations: { target: { valid: true }, branch: { valid: false }, root: { valid: true } },
    });
    expect(result).not.toHaveProperty('value');
  });

  test('a default selection cannot claim a candidate that the hint assigns to another model', async () => {
    const document = fixture();
    const root = document.components!.schemas!.Payload as Record<string, unknown>;
    delete root.oneOf;
    root.anyOf = [{ $ref: '#/components/schemas/Known' }, { $ref: '#/components/schemas/Other' }];
    document.components!.schemas!.Other = { type: 'object', examples: [{ kind: 'known' }] };
    const context = await setup(document);
    const result = await generateDiscriminatorCandidate(request(context, 'default'));
    expect(result).toMatchObject({
      status: 'none',
      reason: 'selection-conflict',
      validations: { target: { valid: true }, branch: { valid: true }, root: { valid: true } },
    });
  });

  test.each(['readOnly', 'writeOnly'] as const)(
    'diagnoses %s seed direction without stripping the property or changing Schema assertions',
    async (annotation) => {
      const document = fixture();
      (document.components!.schemas!.Known as Record<string, unknown>).properties = {
        kind: { const: 'known', [annotation]: true },
      };
      const context = await setup(document);
      const incompatible = annotation === 'readOnly' ? 'request' : 'response';
      const result = await generateDiscriminatorCandidate({ ...request(context), direction: incompatible });
      expect(result).toMatchObject({
        status: 'none',
        reason: 'direction-incompatible',
        validations: { target: { valid: true }, root: { valid: true } },
      });
      expect(
        await generateDiscriminatorCandidate({
          ...request(context),
          direction: incompatible === 'request' ? 'response' : 'request',
        }),
      ).toMatchObject({ status: 'value', value: { kind: 'known' } });
    },
  );

  test('generates an allOf child and still validates the original parent', async () => {
    const document = fixture();
    document.components!.schemas!.Payload = {
      type: 'object',
      required: ['kind'],
      properties: { kind: { type: 'string' } },
      discriminator: { propertyName: 'kind', mapping: { child: 'Child' } },
    };
    document.components!.schemas!.Child = {
      allOf: [{ $ref: '#/components/schemas/Payload' }],
      required: ['name'],
      properties: { name: { const: 'child-name' } },
    };
    const context = await setup(document);
    const result = await generateDiscriminatorCandidate(request(context));
    expect(result.diagnostics).toEqual([]);
    expect(result).toMatchObject({
      status: 'value',
      value: { kind: 'child', name: 'child-name' },
      validations: { root: { valid: true } },
    });
    expect(result.provenance.branch?.location.pointer).toBe('#/components/schemas/Child');
  });
});

describe('snapshot/session provenance and available public identities', () => {
  test.each(['generation', 'snapshot', 'requested', 'tokens', 'target', 'fake-session'])(
    'rejects mismatched %s before any generation',
    async (kind) => {
      const context = await setup();
      const input = request(context);
      const invalid = {
        ...input,
        ...(kind === 'generation' ? { generation: input.generation + 1 } : {}),
        ...(kind === 'snapshot'
          ? { snapshot: new ExternalResourceLoader(context.document, uri).currentSnapshot() }
          : {}),
        ...(kind === 'requested'
          ? { requested: { ...input.requested, reference: `${uri}#/components/schemas/Other` } }
          : {}),
        ...(kind === 'tokens' ? { selectionToken: '' } : {}),
        ...(kind === 'target' ? { targetId: 'unknown-target' } : {}),
        ...(kind === 'fake-session' ? { session: { ...context.session } } : {}),
      };
      expect(await generateDiscriminatorCandidate(invalid)).toMatchObject({
        status: 'none',
        reason: 'unavailable',
        budget: { generationCalls: 0 },
      });
    },
  );

  test('rejects stale registered values at the same URI but accepts object key reordering', async () => {
    const document = fixture();
    const stale = structuredClone(document);
    (stale.components!.schemas!.Known as Record<string, unknown>).required = ['changed'];
    const context = await setup(document, new Map(), stale);
    expect(await generateDiscriminatorCandidate(request(context))).toMatchObject({
      status: 'none',
      diagnostics: [{ code: 'SESSION_SNAPSHOT_CONTENT_MISMATCH' }],
      budget: { generationCalls: 0 },
    });
    context.session.dispose();
    const reverseKeys = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reverseKeys)
        : value && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, nested]) => [key, reverseKeys(nested)]),
            )
          : value;
    const reordered = await setup(document, new Map(), reverseKeys(document) as SwaggerDoc);
    expect(await generateDiscriminatorCandidate(request(reordered))).toMatchObject({ status: 'value' });
  });

  test('compares document fields beyond the selected Schema and preserves array ordering', async () => {
    for (const change of ['info', 'array'] as const) {
      const document = fixture();
      const registered = structuredClone(document);
      if (change === 'info') registered.info!.version = 'other-version';
      else
        (
          (registered.components!.schemas!.Known as Record<string, unknown>).properties as Record<
            string,
            { enum: string[] }
          >
        ).kind.enum.reverse();
      const context = await setup(document, new Map(), registered);
      expect(await generateDiscriminatorCandidate(request(context))).toMatchObject({
        status: 'none',
        diagnostics: [{ code: 'SESSION_SNAPSHOT_CONTENT_MISMATCH' }],
      });
      context.session.dispose();
    }
  });

  test('selects an externally owned same-name Schema using source self independently of schema id', async () => {
    const libraryUri = 'https://resources.example/library.json';
    const external = fixture();
    Object.assign(external, { $self: 'https://identity.example/library/openapi.json#identity' });
    external.components!.schemas!.Payload = {
      $id: 'nested/model',
      type: 'object',
      oneOf: [{ $ref: `${uri}#/components/schemas/Known` }, { $ref: `${libraryUri}#/components/schemas/Known` }],
      required: ['kind'],
      discriminator: {
        propertyName: 'kind',
        mapping: { remote: './openapi.json#/components/schemas/Known', local: 'Known' },
      },
    };
    external.components!.schemas!.Known = {
      type: 'object',
      required: ['kind', 'remote'],
      properties: { kind: { const: 'remote' }, remote: { const: true } },
    };
    const document = fixture();
    document.components!.schemas!.Payload = { $ref: `${libraryUri}#/components/schemas/Payload` };
    document.components!.schemas!.Known = {
      type: 'object',
      required: ['kind'],
      properties: { kind: { const: 'local' } },
    };
    const context = await setup(document, new Map([[libraryUri, external]]));
    const result = await generateDiscriminatorCandidate(request(context, 'explicit', 'remote'));
    expect(result).toMatchObject({ status: 'value', value: { kind: 'remote', remote: true } });
    expect(result.provenance.target?.location).toMatchObject({
      ownerRetrievalUri: libraryUri,
      pointer: '#/components/schemas/Known',
    });
    expect(result.provenance.target?.location).not.toHaveProperty('componentName');
  });

  test.each(['a%3A', 'a:', 'a/b~#中文'])('uses the exact public pointer for %s', async (name) => {
    const document = fixture();
    const reference = `#/components/schemas/Payload/$defs/${encodeURIComponent(name.replace(/~/g, '~0').replace(/\//g, '~1'))}`;
    document.components!.schemas!.Payload = {
      type: 'object',
      required: ['kind'],
      $defs: { [name]: { type: 'object', required: ['kind'], properties: { kind: { const: name } } } },
      oneOf: [{ $ref: reference }],
      discriminator: { propertyName: 'kind', mapping: { [name]: reference } },
    };
    const context = await setup(document);
    const result = await generateDiscriminatorCandidate(request(context));
    expect(result).toMatchObject({ status: 'value', value: { kind: name } });
    expect(result.provenance.target?.location?.reference).toBe(`${uri}${reference.replace('$defs', '%24defs')}`);
  });
});

describe('generation dependency closure', () => {
  test.each([
    ['component', 'pending'],
    ['component', 'failed'],
    ['operation', 'pending'],
    ['operation', 'failed'],
  ] as const)('ignores an unrelated %s Schema with a %s external reference', async (position, state) => {
    const document = fixture();
    const externalUri = 'https://unrelated.example/schema.json';
    if (position === 'component') document.components!.schemas!.Unused = { $ref: externalUri };
    else
      document.paths = {
        '/unrelated': {
          get: {
            responses: {
              '200': {
                description: 'Unrelated response',
                content: { 'application/json': { schema: { $ref: externalUri } } },
              },
            },
          },
        },
      };
    const context = await setup(document);
    const snapshot =
      state === 'pending'
        ? context.snapshot
        : await context.loader.load([
            { scope: 'generation', documentScope: context.loader.documentScope, resourceKey: sha256Hex(externalUri) },
          ]);
    expect(snapshot.edges.find((edge) => edge.resolvedUri === externalUri)?.state).toBe(state);
    const metadata = createSchemaDiscriminatorIndex(snapshot).describe(location);
    const result = await generateDiscriminatorCandidate(request({ ...context, snapshot, metadata }));
    expect(result.diagnostics).toEqual([]);
    expect(result).toMatchObject({
      status: 'value',
      value: { kind: 'known' },
      validations: { target: { valid: true }, branch: { valid: true }, root: { valid: true } },
    });
  });

  test.each(['pending', 'failed'] as const)(
    'rejects a relevant %s reference even when a real session separately registered its target',
    async (state) => {
      const document = fixture();
      const externalUri = 'https://related.example/value.json';
      (document.components!.schemas!.Known as Record<string, unknown>).properties = {
        kind: { const: 'known' },
        profile: { type: 'object', properties: { value: { $ref: externalUri } } },
      };
      const initial = await setup(document);
      const snapshot =
        state === 'pending'
          ? initial.snapshot
          : await initial.loader.load([
              { scope: 'generation', documentScope: initial.loader.documentScope, resourceKey: sha256Hex(externalUri) },
            ]);
      expect(snapshot.edges.find((edge) => edge.resolvedUri === externalUri)?.state).toBe(state);
      const metadata = createSchemaDiscriminatorIndex(snapshot).describe(location);
      const context = await replaceSession({ ...initial, snapshot, metadata }, [
        { retrievalUri: externalUri, document: { type: 'string' } },
      ]);
      expect((await context.session.resolve(externalUri)).schema).toMatchObject({ type: 'string' });
      expect(await generateDiscriminatorCandidate(request(context))).toMatchObject({
        status: 'none',
        reason: 'unavailable',
        diagnostics: [{ code: 'SNAPSHOT_SCHEMA_DEPENDENCY_UNAVAILABLE' }],
        budget: { generationCalls: 0 },
      });
    },
  );

  test.each(['branch-sibling', 'root-sibling', 'other-root-branch', 'array-child', 'dynamic-ref'])(
    'checks the complete related %s despite an extra session registration',
    async (position) => {
      const document = fixture();
      const externalUri = 'https://related.example/assertion.json';
      const root = document.components!.schemas!.Payload as Record<string, unknown>;
      const reference = { $ref: externalUri };
      if (position === 'branch-sibling') (root.oneOf as Record<string, unknown>[])[0].properties = { extra: reference };
      if (position === 'root-sibling') {
        document.components!.schemas!.Declaration = document.components!.schemas!.Payload;
        document.components!.schemas!.Payload = {
          $ref: '#/components/schemas/Declaration',
          properties: { extra: reference },
        };
      }
      if (position === 'other-root-branch')
        (document.components!.schemas!.Other as Record<string, unknown>).allOf = [reference];
      if (position === 'array-child')
        ((document.components!.schemas!.Known as Record<string, unknown>).properties as Record<string, unknown>).items =
          {
            type: 'array',
            prefixItems: [reference],
          };
      if (position === 'dynamic-ref')
        ((document.components!.schemas!.Known as Record<string, unknown>).properties as Record<string, unknown>).extra =
          { $dynamicRef: externalUri };
      const context = await replaceSession(await setup(document), [{ retrievalUri: externalUri, document: true }]);
      expect((await context.session.evaluate(externalUri, {})).valid).toBe(true);
      expect(await generateDiscriminatorCandidate(request(context))).toMatchObject({
        status: 'none',
        diagnostics: [{ code: 'SNAPSHOT_SCHEMA_DEPENDENCY_UNAVAILABLE' }],
        budget: { generationCalls: 0 },
      });
    },
  );

  test.each(['local', 'loaded'] as const)(
    'generates through an authorized %s nested Schema dependency',
    async (state) => {
      const document = fixture();
      const externalUri = 'https://related.example/value.json';
      const nested = { type: 'string', const: 'nested-value' };
      if (state === 'local') document.components!.schemas!.Value = nested;
      ((document.components!.schemas!.Known as Record<string, unknown>).properties as Record<string, unknown>).profile =
        {
          type: 'object',
          required: ['values'],
          properties: {
            values: {
              type: 'array',
              minItems: 1,
              prefixItems: [{ $ref: state === 'local' ? '#/components/schemas/Value' : externalUri }],
            },
          },
        };
      const context = await setup(document, state === 'loaded' ? new Map([[externalUri, nested]]) : undefined);
      expect(await generateDiscriminatorCandidate(request(context))).toMatchObject({
        status: 'value',
        value: { kind: 'known', profile: { values: ['nested-value'] } },
        validations: { target: { valid: true }, branch: { valid: true }, root: { valid: true } },
      });
    },
  );

  test.each(['unrelated-missing', 'unrelated-stale', 'related-stale'] as const)(
    'compares the full documents of actual dependency owners for %s',
    async (condition) => {
      const document = fixture();
      const externalUri = 'https://related.example/owner.json';
      if (condition === 'related-stale')
        ((document.components!.schemas!.Known as Record<string, unknown>).properties as Record<string, unknown>).extra =
          { $ref: externalUri };
      else document.components!.schemas!.Unused = { $ref: externalUri };
      const context = await setup(document, new Map([[externalUri, { type: 'string' }]]));
      context.session.dispose();
      const session = await createSchemaDocumentSession(document, uri, {
        registrationContext: schemaRegistrationContextFromResourceGraph(context.snapshot, uri),
        resourceDocuments:
          condition === 'unrelated-missing'
            ? []
            : [
                {
                  retrievalUri: externalUri,
                  document: { type: 'boolean' },
                  context: schemaRegistrationContextFromResourceGraph(context.snapshot, externalUri),
                },
              ],
      });
      sessions.push(session);
      const result = await generateDiscriminatorCandidate({ ...request(context), session });
      if (condition === 'related-stale')
        expect(result).toMatchObject({
          status: 'none',
          diagnostics: [{ code: 'SESSION_SNAPSHOT_CONTENT_MISMATCH' }],
          budget: { generationCalls: 0 },
        });
      else expect(result).toMatchObject({ status: 'value', value: { kind: 'known' } });
    },
  );

  test.each(['loaded', 'pending'] as const)(
    'follows an external same-name Schema back into the entry and its %s dependency',
    async (state) => {
      const document = fixture();
      const libraryUri = 'https://related.example/library.json';
      const leafUri = 'https://related.example/leaf.json';
      const library = {
        openapi: '3.2.0',
        info: { title: 'Related library', version: '1' },
        components: { schemas: { Known: { $ref: `${uri}#/components/schemas/Back` } } },
      };
      document.components!.schemas!.Back = { $ref: leafUri };
      ((document.components!.schemas!.Known as Record<string, unknown>).properties as Record<string, unknown>).back = {
        $ref: `${libraryUri}#/components/schemas/Known`,
      };
      const leaf = { type: 'string', const: 'returned-to-entry' };
      const resources = new Map<string, unknown>([[libraryUri, library]]);
      if (state === 'loaded') resources.set(leafUri, leaf);
      let context = await setup(document, resources);
      if (state === 'pending') context = await replaceSession(context, [{ retrievalUri: leafUri, document: leaf }]);
      const result = await generateDiscriminatorCandidate(request(context));
      if (state === 'loaded')
        expect(result).toMatchObject({ status: 'value', value: { kind: 'known', back: 'returned-to-entry' } });
      else
        expect(result).toMatchObject({
          status: 'none',
          diagnostics: [{ code: 'SNAPSHOT_SCHEMA_DEPENDENCY_UNAVAILABLE' }],
          budget: { generationCalls: 0 },
        });
    },
  );

  test.each(['opaque', 'contentSchema', 'definitions'])(
    'ignores opaque fake references and unapplied %s annotations',
    async (keyword) => {
      const document = fixture();
      const externalUri = 'https://unused.example/value.json';
      const pseudo = { $ref: externalUri, properties: { value: { $dynamicRef: externalUri } } };
      Object.assign(document.components!.schemas!.Payload as object, {
        examples: [pseudo],
        'x-schema': pseudo,
        unknownAnnotation: pseudo,
      });
      if (keyword === 'contentSchema')
        (document.components!.schemas!.Payload as Record<string, unknown>).contentSchema = { $ref: externalUri };
      if (keyword === 'definitions')
        (document.components!.schemas!.Payload as Record<string, unknown>).definitions = {
          Unused: { $ref: externalUri },
        };
      document.components!.schemas!.UnrelatedDynamic = { $dynamicRef: externalUri };
      const context = await setup(document);
      expect(context.snapshot.edges.filter((edge) => edge.resolvedUri === externalUri)).toHaveLength(
        keyword === 'opaque' ? 1 : 2,
      );
      const result = await generateDiscriminatorCandidate(request(context));
      expect(result.diagnostics).toEqual([]);
      expect(result).toMatchObject({
        status: 'value',
        value: { kind: 'known' },
      });
    },
  );

  test('retains the actual D compilation dependency within $defs even when no assertion references it', async () => {
    const document = fixture();
    const externalUri = 'https://related.example/reserved.json';
    (document.components!.schemas!.Payload as Record<string, unknown>).$defs = { Unused: { $ref: externalUri } };
    const context = await setup(document);
    await expect(
      evaluateSchemaDocumentDirectionally(
        context.session,
        context.metadata.requested.reference,
        { kind: 'known' },
        'request',
      ),
    ).rejects.toMatchObject({ code: 'EXTERNAL_RESOURCE_LOADING_DISABLED' });
    expect(await generateDiscriminatorCandidate(request(context))).toMatchObject({
      status: 'none',
      diagnostics: [{ code: 'SNAPSHOT_SCHEMA_DEPENDENCY_UNAVAILABLE' }],
      budget: { generationCalls: 0 },
    });
  });

  test.each(['definitions', 'contentSchema'])(
    'includes %s when reached by a real Schema reference',
    async (keyword) => {
      const document = fixture();
      const externalUri = 'https://related.example/annotation-target.json';
      const target = { $ref: externalUri };
      const known = document.components!.schemas!.Known as Record<string, unknown>;
      known[keyword] = keyword === 'definitions' ? { Value: target } : target;
      (known.properties as Record<string, unknown>).extra = {
        $ref: `#/components/schemas/Known/${keyword}${keyword === 'definitions' ? '/Value' : ''}`,
      };
      const context = await setup(document);
      expect(await generateDiscriminatorCandidate(request(context))).toMatchObject({
        status: 'none',
        diagnostics: [{ code: 'SNAPSHOT_SCHEMA_DEPENDENCY_UNAVAILABLE' }],
        budget: { generationCalls: 0 },
      });
    },
  );

  test('checks a recursive reference closure once and still uses actual G and root validation', async () => {
    const document = fixture();
    Object.assign(document.components!.schemas!.Known as object, {
      properties: { kind: { const: 'known' }, next: { $ref: '#/components/schemas/Known' } },
      examples: [{ kind: 'known' }],
    });
    const context = await setup(document);
    expect(await generateDiscriminatorCandidate(request(context))).toMatchObject({
      status: 'value',
      value: { kind: 'known' },
      budget: { generationCalls: 1, validationCalls: 3 },
    });
  });

  test.each(['pointer', 'plain-anchor', 'dynamic-anchor'] as const)(
    'handles the public %s dynamic-reference boundary',
    async (kind) => {
      const document = fixture();
      document.components!.schemas!.Value = {
        type: 'string',
        const: 'referenced-value',
        ...(kind === 'plain-anchor'
          ? { $anchor: 'value' }
          : kind === 'dynamic-anchor'
            ? { $dynamicAnchor: 'value' }
            : {}),
      };
      ((document.components!.schemas!.Known as Record<string, unknown>).properties as Record<string, unknown>).extra = {
        $dynamicRef: kind === 'pointer' ? '#/components/schemas/Value' : '#value',
      };
      const context = await setup(document);
      const result = await generateDiscriminatorCandidate(request(context));
      if (kind === 'dynamic-anchor')
        expect(result).toMatchObject({
          status: 'none',
          diagnostics: [{ code: 'DYNAMIC_SCHEMA_DEPENDENCY_UNAVAILABLE' }],
          budget: { generationCalls: 0 },
        });
      else expect(result).toMatchObject({ status: 'value', value: { kind: 'known', extra: 'referenced-value' } });
    },
  );
});

describe('bounded generation, unavailable inputs and cancellation', () => {
  test.each(['false', 'scalar', 'invalid-author', 'no-candidate'])(
    'preserves G outcome for %s without inventing an empty object',
    async (kind) => {
      const document = fixture();
      if (kind === 'false') document.components!.schemas!.Known = false as never;
      if (kind === 'scalar') document.components!.schemas!.Known = { const: 'scalar' };
      if (kind === 'invalid-author')
        (document.components!.schemas!.Known as Record<string, unknown>).examples = [{ kind: 'wrong' }];
      if (kind === 'no-candidate')
        document.components!.schemas!.Known = { type: 'string', pattern: '^unhandled.{50}$' };
      const context = await setup(document);
      const result = await generateDiscriminatorCandidate(request(context));
      expect(result.status).toBe('none');
      expect(result.budget.generationCalls).toBe(1);
      expect(result.budget.validationCalls).toBe(0);
      expect(result.generationResult).toBeDefined();
      if (kind === 'false')
        expect(result.generationResult).toMatchObject({ status: 'none', reason: 'no-valid-candidate' });
      if (kind === 'scalar')
        expect(result).toMatchObject({
          reason: 'seed-not-object',
          generationResult: { status: 'value', value: 'scalar' },
        });
      if (kind === 'invalid-author')
        expect(result.generationResult).toMatchObject({ status: 'value', authored: true, validation: 'invalid' });
    },
  );

  test('rejects unresolved external Schema dependencies without fetching', async () => {
    const document = fixture();
    (document.components!.schemas!.Known as Record<string, unknown>).$ref = 'https://never.example/schema';
    const context = await setup(document);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No fetch allowed'));
    const result = await generateDiscriminatorCandidate(request(context));
    expect(result).toMatchObject({ status: 'none', reason: 'unavailable', budget: { generationCalls: 0 } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('preserves the graph refusal of an explicitly loaded target with an unknown dialect', async () => {
    const document = fixture();
    const externalUri = 'https://external.example/unknown.json';
    (document.components!.schemas!.Known as Record<string, unknown>).$ref = externalUri;
    const context = await setup(
      document,
      new Map([[externalUri, { $schema: 'https://unknown.example/dialect', type: 'object' }]]),
    );
    expect(context.snapshot.diagnostics.map((item) => item.code)).toContain('DIALECT_UNSUPPORTED');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No fetch allowed'));
    expect(await generateDiscriminatorCandidate(request(context))).toMatchObject({
      status: 'none',
      reason: 'unavailable',
      budget: { generationCalls: 0 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('does not accept a real session missing a Schema owner that was granted in the snapshot', async () => {
    const document = fixture();
    const externalUri = 'https://external.example/known.json';
    (document.components!.schemas!.Known as Record<string, unknown>).$ref = externalUri;
    const context = await setup(document, new Map([[externalUri, { type: 'object' }]]));
    context.session.dispose();
    const session = await createSchemaDocumentSession(document, uri, {
      registrationContext: schemaRegistrationContextFromResourceGraph(context.snapshot, uri),
    });
    sessions.push(session);
    expect(await generateDiscriminatorCandidate({ ...request(context), session })).toMatchObject({
      status: 'none',
      diagnostics: [{ code: 'SESSION_SNAPSHOT_CONTENT_MISMATCH' }],
      budget: { generationCalls: 0 },
    });
  });

  test('stops at inspection, generator and extra validation budgets', async () => {
    const context = await setup();
    for (const limits of [
      { maxInspectionNodes: 1 },
      { maxInspectionDepth: 1 },
      { maxInspectionCharacters: 1 },
      { maxValidationCalls: 1 },
    ]) {
      const result = await generateDiscriminatorCandidate(request(context), { limits });
      expect(result).toMatchObject({ status: 'none', reason: 'budget-exceeded' });
      expect(result.budget.validationCalls).toBeLessThanOrEqual(limits.maxValidationCalls ?? 3);
    }
    const result = await generateDiscriminatorCandidate(request(context), { generatorLimits: { maxNodes: 1 } });
    expect(result).toMatchObject({
      status: 'none',
      generationResult: { status: 'none', reason: 'search-budget-exceeded' },
    });
    await expect(
      generateDiscriminatorCandidate(request(context), { limits: { maxValidationCalls: 0 } }),
    ).rejects.toThrow('positive safe integer');
  });

  test('cancellation before and immediately after the real G call cannot return success', async () => {
    const context = await setup();
    const already = new AbortController();
    already.abort();
    expect(await generateDiscriminatorCandidate(request(context), { signal: already.signal })).toMatchObject({
      status: 'none',
      reason: 'aborted',
      budget: { generationCalls: 0 },
    });
    const controller = new AbortController();
    const original = examples.generateSchemaExample;
    vi.spyOn(examples, 'generateSchemaExample').mockImplementation(async (...args) => {
      const result = await original(...args);
      controller.abort();
      return result;
    });
    expect(await generateDiscriminatorCandidate(request(context), { signal: controller.signal })).toMatchObject({
      status: 'none',
      reason: 'aborted',
      budget: { generationCalls: 1, validationCalls: 0 },
    });
  });

  test('cancellation after a real root evaluation still rejects the completed candidate', async () => {
    const context = await setup();
    const controller = new AbortController();
    const original = documents.evaluateSchemaDocumentDirectionally;
    vi.spyOn(documents, 'evaluateSchemaDocumentDirectionally').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[1] === context.metadata.requested.reference) controller.abort();
      return result;
    });
    expect(await generateDiscriminatorCandidate(request(context), { signal: controller.signal })).toMatchObject({
      status: 'none',
      reason: 'aborted',
      validations: { root: { valid: true } },
      budget: { validationCalls: 3 },
    });
  });

  test('a disposed source session cannot return success after the real root evaluation completed', async () => {
    const context = await setup();
    const original = documents.evaluateSchemaDocumentDirectionally;
    vi.spyOn(documents, 'evaluateSchemaDocumentDirectionally').mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[1] === context.metadata.requested.reference) context.session.dispose();
      return result;
    });
    expect(await generateDiscriminatorCandidate(request(context))).toMatchObject({
      status: 'none',
      reason: 'unavailable',
      diagnostics: [{ code: 'SESSION_SNAPSHOT_CONTENT_MISMATCH' }],
      validations: { root: { valid: true } },
      budget: { validationCalls: 3 },
    });
  });
});

describe('real directional annotation evidence', () => {
  test('retains readOnly as a public property annotation after directional validation', async () => {
    const document = fixture();
    (document.components!.schemas!.Known as Record<string, unknown>).properties = {
      kind: { const: 'known', readOnly: true },
    };
    const { session } = await setup(document);
    const result = await evaluateSchemaDocumentDirectionally(
      session,
      '#/components/schemas/Known',
      { kind: 'known' },
      'request',
    );
    expect(result.valid).toBe(true);
    expect(result.annotations).toContainEqual({
      instanceLocation: '/kind',
      keywordId: 'https://json-schema.org/keyword/readOnly',
      values: [true],
    });
  });
});
