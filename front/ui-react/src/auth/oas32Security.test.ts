import { authToHeaders, collectOas32DocumentDiagnostics, type AuthValues, type SchemeValue } from 'knife4j-core';
import { describe, expect, test, vi } from 'vitest';
import { ExternalResourceLoader, type ResourceGraphSnapshot } from '../schema/externalResourceGraph';
import { enumerateRegistryOperations } from '../schema/operationRegistry';
import type { SwaggerDoc } from '../types/swagger';
import { sha256Hex } from '../utils/stableJson';
import { planOas32Security, projectOas32Security, type Oas32SecuritySchemeResolution } from './oas32Security';

const entry = 'https://docs.example.test/entry.json';
const bearer = { type: 'http', scheme: 'bearer' };
const queryKey = { type: 'apiKey', in: 'query', name: 'api_key' };
const response = (document: unknown) =>
  new Response(JSON.stringify(document), { headers: { 'content-type': 'application/json' } });
const document32 = (extra: Record<string, unknown> = {}) => ({
  openapi: '3.2.0',
  info: { title: 'Synthetic security projection', version: '1' },
  paths: { '/sample': { get: { responses: { '200': { description: 'OK' } } } } },
  ...extra,
});

function fixture(extra: Record<string, unknown> = {}) {
  const document = document32(extra);
  expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
  const fetchImpl = vi.fn();
  const loader = new ExternalResourceLoader(document, entry, { fetchImpl });
  const snapshot = loader.currentSnapshot();
  const { operations } = enumerateRegistryOperations(document as SwaggerDoc, entry, snapshot);
  return { document, loader, snapshot, operation: operations[0], fetchImpl };
}

const credentials: AuthValues = {
  bearerToken: 'legacy-secret',
  basicCredentials: 'legacy-basic-secret',
  apiKeys: { 'X-Legacy': 'legacy-key-secret' },
  bySecurityKey: {
    A: { type: 'http', scheme: 'bearer', token: 'synthetic-token-a' },
    B: { type: 'apiKey', in: 'query', name: 'api_key', value: 'synthetic-key-b' },
    Other: { type: 'http', scheme: 'bearer', token: 'unselected-secret' },
  },
};

function resolved(resolution: Oas32SecuritySchemeResolution) {
  expect(resolution.status).toBe('resolved');
  if (resolution.status !== 'resolved') throw new Error('Expected resolved synthetic scheme');
  return resolution;
}

function projectionFor(schemes: Record<string, unknown>, security: unknown) {
  const data = fixture({ components: { securitySchemes: schemes }, security });
  return projectOas32Security(data.snapshot, data.operation);
}

const supplied = (entries: [string, SchemeValue][]): AuthValues => ({ bySecurityKey: Object.fromEntries(entries) });
const keyCredential = (place: 'header' | 'query' | 'cookie', name: string, value = 'synthetic-value'): SchemeValue => ({
  type: 'apiKey',
  in: place,
  name,
  value,
});
const oauth = { type: 'oauth2', flows: { clientCredentials: { tokenUrl: '/token', scopes: { read: 'Read' } } } };

function snapshotEvidence(snapshot: ResourceGraphSnapshot) {
  return JSON.stringify({
    ...snapshot,
    nodes: [...snapshot.nodes],
    resourceTargets: [...snapshot.resourceTargets],
    anchorTargets: [...snapshot.anchorTargets],
    documentTargets: [...snapshot.documentTargets],
  });
}

describe('OAS 3.2 security declarations and single-alternative plans', () => {
  test.each(['3.2.0', '3.2.99'])('projects root inheritance and selects only one OR branch for %s', (openapi) => {
    const { snapshot, operation, fetchImpl } = fixture({
      openapi,
      components: { securitySchemes: { A: bearer, B: queryKey } },
      security: [{ A: [] }, { B: [] }],
    });
    const projection = projectOas32Security(snapshot, operation);
    expect(projection).toMatchObject({
      status: 'ready',
      declaration: 'requirements',
      inherited: true,
      source: { ownerRetrievalUri: entry, pointer: '#/security' },
    });
    expect(projection.branches.map((branch) => branch.members.map((member) => member.key))).toEqual([['A'], ['B']]);
    const plan = planOas32Security(projection, credentials);
    expect(plan).toMatchObject({ selectedIndex: 0, complete: true, securityKeys: ['A'] });
    expect(authToHeaders(plan.auth, plan.securityKeys)).toEqual({
      headers: { Authorization: 'Bearer synthetic-token-a' },
      queries: {},
    });
    expect(JSON.stringify(plan)).not.toContain('legacy-secret');
    expect(JSON.stringify(plan)).not.toContain('unselected-secret');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('operation [] overrides root; absent and anonymous remain distinct', () => {
    for (const security of [undefined, [], [{}]]) {
      const { snapshot, operation } = fixture({ ...(security === undefined ? {} : { security }) });
      const projection = projectOas32Security(snapshot, operation);
      const plan = planOas32Security(projection, credentials);
      expect(projection.declaration).toBe(
        security === undefined ? 'absent' : security.length ? 'requirements' : 'empty',
      );
      expect(plan.auth).toEqual({ bySecurityKey: {} });
      expect(plan.securityKeys).toEqual([]);
      expect(plan.complete).toBe(true);
      expect(plan.selectedIndex).toBe(security?.length ? 0 : null);
    }
    const { snapshot, operation } = fixture({
      security: [{ A: [] }],
      components: { securitySchemes: { A: bearer } },
      paths: { '/sample': { get: { security: [], responses: { '200': { description: 'OK' } } } } },
    });
    expect(projectOas32Security(snapshot, operation)).toMatchObject({
      declaration: 'empty',
      inherited: false,
      source: { pointer: '#/paths/~1sample/get/security' },
    });
  });

  test('keeps all AND members and scopes/roles while defaulting to the first complete branch', () => {
    const { snapshot, operation } = fixture({
      components: {
        securitySchemes: { A: bearer, B: queryKey, Missing: { type: 'apiKey', in: 'header', name: 'X-Missing' } },
      },
      security: [{ Missing: ['operator'] }, { A: ['admin'], B: [] }, {}],
    });
    const projection = projectOas32Security(snapshot, operation);
    const plan = planOas32Security(projection, credentials);
    expect(plan.selectedIndex).toBe(1);
    expect(plan.securityKeys).toEqual(['A', 'B']);
    expect(projection.branches[1].members[0]).toMatchObject({ values: ['admin'], valueKind: 'roles' });
    const missing = planOas32Security(projection, credentials, 0);
    expect(missing).toMatchObject({ selectedIndex: 0, complete: false, securityKeys: [] });
    expect(missing.branches[0].members[0].credentialStatus).toBe('missing');
    expect(planOas32Security(projection, credentials, 2)).toMatchObject({
      selectedIndex: 2,
      complete: true,
      securityKeys: [],
    });
  });

  test('uses entry foo before a cross-owner explicit ./foo URI through C/E', async () => {
    const library = 'https://resources.example.test/library.json';
    const external = 'https://identity.example.test/library/foo';
    const document = document32({
      components: { securitySchemes: { foo: bearer } },
      paths: { '/sample': { $ref: `${library}#/paths/~1other` } },
    });
    const libraryDoc = document32({
      $self: 'https://identity.example.test/library/openapi.json',
      components: { securitySchemes: { foo: { type: 'http', scheme: 'basic' } } },
      paths: {
        '/other': { query: { security: [{ foo: [] }, { './foo': [] }], responses: { '200': { description: 'OK' } } } },
      },
    });
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    expect(collectOas32DocumentDiagnostics(libraryDoc)).toEqual([]);
    const fetchImpl = vi.fn(async (url) => response(String(url) === library ? libraryDoc : queryKey));
    const loader = new ExternalResourceLoader(document, entry, { fetchImpl });
    const grant = (url: string) => ({
      scope: 'generation' as const,
      documentScope: loader.documentScope,
      resourceKey: sha256Hex(url),
    });
    await loader.load([grant(library)]);
    const snapshot = await loader.continueLoad([grant(external)]);
    const { operations } = enumerateRegistryOperations(document as SwaggerDoc, entry, snapshot);
    const projection = projectOas32Security(snapshot, operations[0]);
    const [named, uri] = projection.branches.map((branch) => branch.members[0].resolution);
    expect(named).toMatchObject({
      status: 'resolved',
      credentialKey: 'foo',
      target: { ownerRetrievalUri: entry, pointer: '#/components/securitySchemes/foo' },
      scheme: bearer,
    });
    expect(uri).toMatchObject({
      status: 'resolved',
      bindingKind: 'uri',
      target: { ownerRetrievalUri: external, pointer: '#' },
      scheme: queryKey,
    });
    expect(uri.credentialKey).not.toBe('foo');
    expect(projection.source).toMatchObject({ ownerRetrievalUri: library, pointer: '#/paths/~1other/query/security' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('typed registry references and physical identities', () => {
  test('retains the outermost description override, final target and raw flow/metadata fields', () => {
    const flow = {
      deviceAuthorization: { deviceAuthorizationUrl: '/device', tokenUrl: '/token', scopes: { read: 'Read' } },
    };
    const data = fixture({
      components: {
        securitySchemes: {
          Outer: { $ref: '#/components/securitySchemes/Middle', description: '', summary: 'ignored reference summary' },
          Middle: { $ref: '#/components/securitySchemes/Target', description: 'Middle description' },
          Target: {
            type: 'oauth2',
            flows: flow,
            description: 'Target description',
            deprecated: true,
            oauth2MetadataUrl: '../oauth-metadata',
            'x-opaque': { security: [{ Ghost: [] }], $ref: 'https://never.example.test/opaque' },
          },
        },
      },
      security: [{ Outer: ['read', 'unlisted', 'read'] }],
    });
    const before = snapshotEvidence(data.snapshot);
    const projection = projectOas32Security(data.snapshot, data.operation);
    const member = projection.branches[0].members[0];
    const result = resolved(member.resolution);
    expect(result).toMatchObject({
      source: { pointer: '#/components/securitySchemes/Outer' },
      target: { ownerRetrievalUri: entry, pointer: '#/components/securitySchemes/Target' },
      credentialKey: 'Outer',
      descriptionSource: { pointer: '#/components/securitySchemes/Outer/description' },
      scheme: {
        type: 'oauth2',
        description: '',
        deprecated: true,
        oauth2MetadataUrl: '../oauth-metadata',
        flows: flow,
      },
    });
    expect(result.chain.map((location) => location.pointer)).toEqual([
      '#/components/securitySchemes/Outer',
      '#/components/securitySchemes/Middle',
      '#/components/securitySchemes/Target',
    ]);
    expect(result.scheme).not.toHaveProperty('summary');
    expect(result.target.value).toMatchObject({ description: 'Target description' });
    expect(member).toMatchObject({
      key: 'Outer',
      source: { pointer: '#/security/0/Outer', value: ['read', 'unlisted', 'read'] },
      values: ['read', 'unlisted', 'read'],
      valueKind: 'scopes',
    });
    expect(projection.schemes.map(({ name }) => name)).toEqual(['Middle', 'Outer', 'Target']);
    expect(snapshotEvidence(data.snapshot)).toBe(before);
    expect(data.fetchImpl).not.toHaveBeenCalled();
  });

  test('keeps named aliases independent while URI bindings use the same final physical target', () => {
    const localUri = '#/components/securitySchemes/Target';
    const absoluteUri = `${entry}#/components/securitySchemes/Target`;
    const projection = projectionFor({ Target: bearer, Alias: { $ref: localUri } }, [
      { Target: [] },
      { Alias: [] },
      { [localUri]: ['one'], [absoluteUri]: ['two'] },
    ]);
    const target = resolved(projection.branches[0].members[0].resolution);
    const alias = resolved(projection.branches[1].members[0].resolution);
    const [first, second] = projection.branches[2].members.map((member) => resolved(member.resolution));
    expect([target.credentialKey, alias.credentialKey]).toEqual(['Target', 'Alias']);
    expect(first.credentialKey).toBe(second.credentialKey);
    expect(first.credentialKey).not.toBe('Target');
    expect(first.credentialKey).not.toMatch(/^[A-Za-z0-9._-]+$/);
    const input = supplied([
      ['Target', { type: 'http', scheme: 'bearer', token: 'named-target' }],
      ['Alias', { type: 'http', scheme: 'bearer', token: 'named-alias' }],
    ]);
    expect(planOas32Security(projection, input, 2)).toMatchObject({ complete: false, securityKeys: [] });
    const uriInput = supplied([[first.credentialKey, { type: 'http', scheme: 'bearer', token: 'uri-token' }]]);
    const plan = planOas32Security(projection, uriInput, 2);
    expect(plan).toMatchObject({ complete: true, securityKeys: [first.credentialKey] });
    expect(plan.branches[2].members).toHaveLength(2);
    expect(plan.branches[2].members.map((member) => member.member.values)).toEqual([['one'], ['two']]);
    expect(authToHeaders(plan.auth, plan.securityKeys).headers).toEqual({ Authorization: 'Bearer uri-token' });
  });

  test('uses literal percent source pointers and distinguishes reserved-encoded physical owners', async () => {
    const encoded = 'https://resources.example.test/%3A/scheme.json';
    const literal = 'https://resources.example.test/:/scheme.json';
    const document = document32({
      paths: {
        '/%41': {
          additionalOperations: {
            '%41': { security: [{ [encoded]: [] }, { [literal]: [] }], responses: { '200': { description: 'OK' } } },
            A: { security: [], responses: { '200': { description: 'Decoy' } } },
          },
        },
      },
    });
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const fetchImpl = vi.fn(async (url) => response(String(url) === encoded ? bearer : queryKey));
    const loader = new ExternalResourceLoader(document, entry, { fetchImpl });
    const snapshot = await loader.load(
      [encoded, literal].map((url) => ({
        scope: 'generation' as const,
        documentScope: loader.documentScope,
        resourceKey: sha256Hex(url),
      })),
    );
    const { operations } = enumerateRegistryOperations(document as SwaggerDoc, entry, snapshot);
    const operation = operations.find((item) => item.method === '%41');
    expect(operation).toBeDefined();
    const projection = projectOas32Security(snapshot, operation);
    expect(projection.source?.pointer).toBe('#/paths/~1%41/additionalOperations/%41/security');
    const [first, second] = projection.branches.map((branch) => resolved(branch.members[0].resolution));
    expect(first.target).toMatchObject({ ownerRetrievalUri: encoded, pointer: '#' });
    expect(second.target).toMatchObject({ ownerRetrievalUri: literal, pointer: '#' });
    expect(first.credentialKey).not.toBe(second.credentialKey);
    expect(first.scheme.type).toBe('http');
    expect(second.scheme.type).toBe('apiKey');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('follows C targets despite misleading URI spelling and never reconstructs a missing edge', () => {
    const data = fixture({ components: { securitySchemes: { A: bearer, B: queryKey } }, security: [{ A: [] }] });
    const withoutEdge = {
      ...data.snapshot,
      edges: data.snapshot.edges.filter((edge) => edge.kind !== 'security-requirement'),
    };
    expect(projectOas32Security(withoutEdge, data.operation).branches[0].members[0].resolution).toMatchObject({
      status: 'unavailable',
      diagnostic: { code: 'missing-edge' },
    });
    const redirected = {
      ...data.snapshot,
      edges: data.snapshot.edges.map((edge) =>
        edge.kind === 'security-requirement'
          ? { ...edge, target: { ownerRetrievalUri: entry, pointer: '#/components/securitySchemes/B' } }
          : edge,
      ),
    };
    expect(projectOas32Security(redirected, data.operation).branches[0].members[0].resolution).toMatchObject({
      status: 'resolved',
      credentialKey: 'A',
      scheme: queryKey,
      target: { pointer: '#/components/securitySchemes/B' },
    });
    // This deliberately altered graph tests authority consumption, not a valid C name-precedence fixture.
    expect(data.fetchImpl).not.toHaveBeenCalled();
  });

  test.each(['pending', 'failed', 'duplicate', 'wrong-kind', 'missing-target', 'missing-node'] as const)(
    'preserves unavailable requirements for %s registry edges',
    (mode) => {
      const data = fixture({ components: { securitySchemes: { A: bearer } }, security: [{ A: [] }] });
      const edge = data.snapshot.edges.find((item) => item.kind === 'security-requirement')!;
      const modified =
        mode === 'pending' || mode === 'failed'
          ? { ...edge, state: mode }
          : mode === 'wrong-kind'
            ? { ...edge, target: { ownerRetrievalUri: entry, pointer: '#/paths/~1sample/get' } }
            : mode === 'missing-target'
              ? { ...edge, target: undefined }
              : edge;
      const snapshot: ResourceGraphSnapshot = {
        ...data.snapshot,
        nodes: mode === 'missing-node' ? new Map() : data.snapshot.nodes,
        edges:
          mode === 'duplicate'
            ? [...data.snapshot.edges, edge]
            : data.snapshot.edges.map((item) => (item === edge ? modified : item)),
      };
      const projection = projectOas32Security(snapshot, mode === 'missing-node' ? undefined : data.operation);
      if (mode === 'missing-node') {
        expect(projection).toMatchObject({ status: 'unavailable', diagnostic: { code: 'unsupported-version' } });
      } else {
        const code = {
          pending: 'not-loaded',
          failed: 'reference-failed',
          duplicate: 'ambiguous-edge',
          'wrong-kind': 'wrong-kind',
          'missing-target': 'target-missing',
        }[mode];
        expect(projection.branches[0].members[0].resolution).toMatchObject({
          status: 'unavailable',
          credentialKey: 'A',
          diagnostic: { code },
        });
        expect(planOas32Security(projection, credentials)).toMatchObject({
          complete: false,
          selectedIndex: 0,
          securityKeys: [],
        });
      }
    },
  );

  test('retains C failure diagnostics and pending Reference source without fetching', async () => {
    const external = 'https://resources.example.test/scheme.json';
    const document = document32({
      components: { securitySchemes: { A: { $ref: external, description: 'Ref label' } } },
      security: [{ A: [] }],
    });
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    const loader = new ExternalResourceLoader(document, entry, { fetchImpl });
    const pending = projectOas32Security(loader.currentSnapshot());
    expect(pending.branches[0].members[0].resolution).toMatchObject({
      status: 'unavailable',
      source: { pointer: '#/components/securitySchemes/A' },
      diagnostic: { code: 'not-loaded', source: { pointer: '#/components/securitySchemes/A/$ref' } },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    const failedSnapshot = await loader.load([
      { scope: 'generation', documentScope: loader.documentScope, resourceKey: sha256Hex(external) },
    ]);
    const failure = projectOas32Security(failedSnapshot).branches[0].members[0].resolution;
    expect(failure).toMatchObject({ status: 'unavailable', diagnostic: { code: 'reference-failed' } });
    if (failure.status !== 'unavailable') throw new Error('Expected synthetic registry failure');
    expect(failure.diagnostic.graphDiagnostics.length).toBeGreaterThan(0);
    expect(failure.diagnostic.graphDiagnostics.every((item) => failedSnapshot.diagnostics.includes(item))).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('rejects a Reference to the wrong OAS object kind with C diagnostics intact', () => {
    const document = document32({
      components: {
        securitySchemes: { A: { $ref: '#/components/schemas/Payload' } },
        schemas: { Payload: { type: 'object' } },
      },
      security: [{ A: [] }],
    });
    expect(collectOas32DocumentDiagnostics(document).length).toBeGreaterThan(0);
    const snapshot = new ExternalResourceLoader(document, entry).currentSnapshot();
    const result = projectOas32Security(snapshot).branches[0].members[0].resolution;
    expect(result).toMatchObject({
      status: 'unavailable',
      diagnostic: {
        code: 'wrong-kind',
        source: { pointer: '#/components/securitySchemes/A/$ref' },
        graphDiagnostics: expect.arrayContaining([expect.objectContaining({ code: 'DOCUMENT_KIND_MISMATCH' })]),
      },
    });
  });

  test('follows Reference chains across physical owners and self aliases while retaining the entry binding', async () => {
    const library = 'https://resources.example.test/library.json';
    const self = 'https://identity.example.test/%3A/library.json';
    const target = 'https://resources.example.test/target.json';
    const document = document32({
      components: {
        securitySchemes: { A: { $ref: `${library}#/components/securitySchemes/Alias`, description: 'Entry override' } },
      },
      security: [{ A: [] }, { [`${self}#/components/securitySchemes/Alias`]: [] }],
    });
    const external = document32({
      $self: self,
      components: {
        securitySchemes: {
          Alias: { $ref: `${target}#/components/securitySchemes/Token`, description: 'Library override' },
        },
      },
    });
    const targetDocument = document32({
      components: { securitySchemes: { Token: { ...bearer, description: 'Target text' } } },
    });
    for (const item of [document, external, targetDocument]) expect(collectOas32DocumentDiagnostics(item)).toEqual([]);
    const fetchImpl = vi.fn(async (url) => response(String(url) === library ? external : targetDocument));
    const loader = new ExternalResourceLoader(document, entry, { fetchImpl });
    const grant = (url: string) => ({
      scope: 'generation' as const,
      documentScope: loader.documentScope,
      resourceKey: sha256Hex(url),
    });
    await loader.load([grant(library)]);
    const snapshot = await loader.continueLoad([grant(target)]);
    const projection = projectOas32Security(snapshot);
    const [named, uri] = projection.branches.map((branch) => resolved(branch.members[0].resolution));
    expect(named).toMatchObject({
      credentialKey: 'A',
      target: { ownerRetrievalUri: target, pointer: '#/components/securitySchemes/Token' },
      scheme: { description: 'Entry override' },
    });
    expect(named.chain.map((location) => location.ownerRetrievalUri)).toEqual([entry, library, target]);
    expect(uri).toMatchObject({
      bindingKind: 'uri',
      target: { ownerRetrievalUri: target, pointer: '#/components/securitySchemes/Token' },
      scheme: { description: 'Library override' },
    });
    expect(uri.credentialKey).not.toBe('A');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('rejects Reference cycles and caps depth/work without resolving from text', () => {
    const invalidDocument = document32({
      components: {
        securitySchemes: {
          A: { $ref: '#/components/securitySchemes/B' },
          B: { $ref: '#/components/securitySchemes/A' },
        },
      },
      security: [{ A: [] }],
    });
    expect(collectOas32DocumentDiagnostics(invalidDocument).map((item) => item.code)).toEqual([
      'reference-cycle',
      'reference-cycle',
    ]);
    const cyclic = projectOas32Security(new ExternalResourceLoader(invalidDocument, entry).currentSnapshot());
    expect(cyclic.branches[0].members[0].resolution).toMatchObject({
      status: 'unavailable',
      diagnostic: { code: 'cycle' },
    });
    const data = fixture({
      components: {
        securitySchemes: {
          A: { $ref: '#/components/securitySchemes/B' },
          B: { $ref: '#/components/securitySchemes/C' },
          C: bearer,
        },
      },
      security: [{ A: [] }],
    });
    expect(
      projectOas32Security(data.snapshot, data.operation, { maxReferenceDepth: 1 }).branches[0].members[0].resolution,
    ).toMatchObject({
      status: 'unavailable',
      diagnostic: { code: 'depth-limit', source: { pointer: '#/components/securitySchemes/B/$ref' } },
    });
    expect(
      projectOas32Security(data.snapshot, data.operation, { maxReferenceDepth: 2 }).branches[0].members[0].resolution
        .status,
    ).toBe('resolved');
    const limited = projectOas32Security(data.snapshot, data.operation, { maxWork: 2 });
    expect(limited.work).toBe(2);
    expect(limited.branches[0].members[0].resolution).toMatchObject({
      status: 'unavailable',
      diagnostic: { code: 'work-limit' },
    });
    expect(planOas32Security(limited, credentials)).toMatchObject({ complete: false, securityKeys: [] });
    expect(projectOas32Security(data.snapshot, data.operation, { maxWork: 0 }).work).toBe(0);
  });

  test('does not interpret examples/extensions as requirements or schemes', () => {
    const opaque = {
      security: [{ Ghost: [] }],
      components: { securitySchemes: { Ghost: bearer } },
      $ref: 'https://never.example.test/ghost',
    };
    const data = fixture({
      'x-opaque': opaque,
      components: { examples: { Payload: { value: opaque } } },
      paths: {
        '/sample': {
          get: {
            'x-opaque': opaque,
            responses: { '200': { description: 'OK', content: { 'application/json': { example: opaque } } } },
          },
        },
      },
    });
    const projection = projectOas32Security(data.snapshot, data.operation);
    expect(projection).toMatchObject({ declaration: 'absent', branches: [], schemes: [] });
    expect(planOas32Security(projection, credentials)).toMatchObject({ auth: { bySecurityKey: {} }, securityKeys: [] });
    expect(data.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('selection, inheritance and invalid declarations', () => {
  test('keeps the first incomplete alternative, provides only unambiguous entered AND members, and accepts an explicit choice', () => {
    const projection = projectionFor(
      { A: bearer, B: queryKey, Missing: { type: 'apiKey', in: 'header', name: 'X-Missing' } },
      [
        { A: [], Missing: [] },
        { B: [], Missing: [] },
      ],
    );
    expect(planOas32Security(projection, credentials)).toMatchObject({
      complete: false,
      selectedIndex: 0,
      securityKeys: ['A'],
    });
    const second = planOas32Security(projection, credentials, 1);
    expect(second).toMatchObject({ complete: false, selectedIndex: 1, securityKeys: ['B'] });
    expect(authToHeaders(second.auth, second.securityKeys)).toEqual({
      headers: {},
      queries: { api_key: 'synthetic-key-b' },
    });
    expect(second.branches.every((branch) => branch.members.length === 2)).toBe(true);
  });

  test('defaults to a later anonymous branch when earlier credentials are missing', () => {
    const projection = projectionFor({ A: bearer }, [{ A: [] }, {}]);
    expect(planOas32Security(projection)).toMatchObject({
      complete: true,
      selectedIndex: 1,
      auth: { bySecurityKey: {} },
      securityKeys: [],
    });
    expect(planOas32Security(projection, credentials)).toMatchObject({
      complete: true,
      selectedIndex: 0,
      securityKeys: ['A'],
    });
  });

  test.each([-1, 2, 0.5, NaN, Infinity])(
    'rejects explicit index %s without silently choosing another branch',
    (index) => {
      const projection = projectionFor({ A: bearer }, [{ A: [] }, {}]);
      expect(planOas32Security(projection, credentials, index)).toMatchObject({
        status: 'invalid-selection',
        complete: false,
        selectedIndex: null,
        auth: { bySecurityKey: {} },
        securityKeys: [],
        previewSecurityKeys: [],
      });
    },
  );

  test('external operation absence inherits entry security, while operation own [] removes it', async () => {
    const library = 'https://resources.example.test/library.json';
    const document = document32({
      components: { securitySchemes: { A: bearer } },
      security: [{ A: [] }],
      paths: { '/sample': { $ref: `${library}#/paths/~1actual` } },
    });
    const external = document32({
      components: { securitySchemes: { B: queryKey } },
      security: [{ B: [] }],
      paths: {
        '/actual': {
          get: { responses: { '200': { description: 'OK' } } },
          post: { security: [], responses: { '200': { description: 'OK' } } },
        },
      },
    });
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    expect(collectOas32DocumentDiagnostics(external)).toEqual([]);
    const loader = new ExternalResourceLoader(document, entry, { fetchImpl: async () => response(external) });
    const snapshot = await loader.load([
      { scope: 'generation', documentScope: loader.documentScope, resourceKey: sha256Hex(library) },
    ]);
    const { operations } = enumerateRegistryOperations(document as SwaggerDoc, entry, snapshot);
    const get = operations.find((operation) => operation.method === 'GET');
    const post = operations.find((operation) => operation.method === 'POST');
    expect(get).toBeDefined();
    expect(post).toBeDefined();
    const inherited = projectOas32Security(snapshot, get);
    expect(inherited).toMatchObject({ inherited: true, source: { ownerRetrievalUri: entry, pointer: '#/security' } });
    expect(inherited.branches[0].members.map((member) => member.key)).toEqual(['A']);
    expect(projectOas32Security(snapshot, post)).toMatchObject({
      inherited: false,
      declaration: 'empty',
      source: { ownerRetrievalUri: library, pointer: '#/paths/~1actual/post/security' },
    });
  });

  test.each([null, {}, 'A', 1])('does not treat invalid security %j as anonymous', (security) => {
    const document = document32({ security });
    expect(collectOas32DocumentDiagnostics(document).length).toBeGreaterThan(0);
    const projection = projectOas32Security(new ExternalResourceLoader(document, entry).currentSnapshot());
    expect(projection).toMatchObject({
      status: 'unavailable',
      declaration: 'invalid',
      diagnostic: { code: 'invalid-security' },
    });
    expect(planOas32Security(projection, credentials)).toMatchObject({
      status: 'unavailable',
      complete: false,
      securityKeys: [],
    });
  });

  test.each([null, [], { A: 'role' }, { A: [1] }])(
    'retains invalid requirement %j as an incomplete declaration',
    (requirement) => {
      const document = document32({ components: { securitySchemes: { A: bearer } }, security: [requirement] });
      expect(collectOas32DocumentDiagnostics(document).length).toBeGreaterThan(0);
      const projection = projectOas32Security(new ExternalResourceLoader(document, entry).currentSnapshot());
      expect(projection.branches[0]).toMatchObject({ valid: false, anonymous: false, source: { value: requirement } });
      expect(planOas32Security(projection, credentials)).toMatchObject({ complete: false, securityKeys: [] });
    },
  );

  test('rejects invalid URI component names without treating them as a valid name-precedence example', () => {
    const invalidName = 'https://identity.example.test/invalid-component-key';
    const document = document32({
      components: { securitySchemes: { [invalidName]: bearer } },
      security: [{ [invalidName]: [] }],
    });
    expect(collectOas32DocumentDiagnostics(document).length).toBeGreaterThan(0);
    const projection = projectOas32Security(new ExternalResourceLoader(document, entry).currentSnapshot());
    expect(projection.schemes[0].resolution).toMatchObject({
      status: 'unavailable',
      diagnostic: { code: 'invalid-component-name' },
    });
    expect(projection.branches[0].members[0].resolution).toMatchObject({
      status: 'unavailable',
      diagnostic: { code: 'invalid-component-name' },
    });
  });

  test.each(['3.0.3', '3.1.2', '3.3.0'])('does not adopt the helper for unsupported version %s', (openapi) => {
    const { snapshot } = fixture();
    // C already rejects unsupported entry versions; exercise this helper's own boundary too.
    const nodes = new Map(snapshot.nodes);
    nodes.set(entry, { ...nodes.get(entry)!, document: document32({ openapi }) });
    const projection = projectOas32Security({ ...snapshot, nodes });
    expect(projection).toMatchObject({ status: 'unavailable', diagnostic: { code: 'unsupported-version' } });
    expect(planOas32Security(projection, credentials).securityKeys).toEqual([]);
  });

  test('rejects stale/foreign operations instead of applying their security to the current snapshot', () => {
    const first = fixture({ security: [] });
    const second = fixture({ security: [{}] });
    expect(projectOas32Security(second.snapshot, first.operation)).toMatchObject({
      status: 'unavailable',
      diagnostic: { code: 'operation-mismatch' },
    });
    expect(
      projectOas32Security(first.snapshot, { ...first.operation, documentUri: 'https://other.example.test/doc.json' }),
    ).toMatchObject({ status: 'unavailable', diagnostic: { code: 'operation-mismatch' } });
  });
});

describe('browser transport capability and AND conflicts', () => {
  test('normalizes HTTP scheme case and accepts header name case without changing stored inputs', () => {
    const projection = projectionFor(
      { Basic: { type: 'http', scheme: 'BaSiC' }, Key: { type: 'apiKey', in: 'header', name: 'X-Token' } },
      [{ Basic: [], Key: [] }],
    );
    const input = supplied([
      ['Basic', { type: 'http', scheme: 'basic', username: 'synthetic-user', password: 'synthetic-password' }],
      ['Key', keyCredential('header', 'x-token')],
    ]);
    const before = JSON.stringify(input);
    const plan = planOas32Security(projection, input);
    expect(plan.complete).toBe(true);
    expect(authToHeaders(plan.auth, plan.securityKeys)).toEqual({
      headers: { Authorization: `Basic ${btoa('synthetic-user:synthetic-password')}`, 'X-Token': 'synthetic-value' },
      queries: {},
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  test.each(['same-header', 'authorization', 'same-query', 'same-cookie', 'cookie-header'] as const)(
    'diagnoses %s conflicts without last-write-wins or dropping members',
    (mode) => {
      const [left, right] =
        mode === 'same-header'
          ? [
              { type: 'apiKey', in: 'header', name: 'X-Key' },
              { type: 'apiKey', in: 'header', name: 'x-key' },
            ]
          : mode === 'authorization'
            ? [bearer, { type: 'http', scheme: 'basic' }]
            : mode === 'same-query'
              ? [
                  { type: 'apiKey', in: 'query', name: 'key' },
                  { type: 'apiKey', in: 'query', name: 'key' },
                ]
              : mode === 'same-cookie'
                ? [
                    { type: 'apiKey', in: 'cookie', name: 'key' },
                    { type: 'apiKey', in: 'cookie', name: 'key' },
                  ]
                : [
                    { type: 'apiKey', in: 'header', name: 'Cookie' },
                    { type: 'apiKey', in: 'cookie', name: 'key' },
                  ];
      const projection = projectionFor({ A: left, B: right }, [{ A: [], B: [] }]);
      const input =
        mode === 'authorization'
          ? supplied([
              ['A', { type: 'http', scheme: 'bearer', token: 'synthetic-token' }],
              ['B', { type: 'http', scheme: 'basic', username: 'user', password: 'pass' }],
            ])
          : supplied([
              ['A', keyCredential(left.in as 'header' | 'query' | 'cookie', left.name!)],
              ['B', keyCredential(right.in as 'header' | 'query' | 'cookie', right.name!)],
            ]);
      const plan = planOas32Security(projection, input);
      expect(plan).toMatchObject({ complete: false, securityKeys: [], previewSecurityKeys: [] });
      expect(plan.branches[0].members).toHaveLength(2);
      for (const member of plan.branches[0].members)
        expect(member).toMatchObject({
          canExecute: false,
          canPreview: false,
          issues: expect.arrayContaining(['transport-conflict']),
        });
      expect(authToHeaders(plan.auth, plan.securityKeys)).toEqual({ headers: {}, queries: {} });
    },
  );

  test.each(['query', 'cookie'] as const)('compares %s names case-sensitively', (place) => {
    const projection = projectionFor(
      { A: { type: 'apiKey', in: place, name: 'Key' }, B: { type: 'apiKey', in: place, name: 'key' } },
      [{ A: [], B: [] }],
    );
    const plan = planOas32Security(
      projection,
      supplied([
        ['A', keyCredential(place, 'Key', 'upper')],
        ['B', keyCredential(place, 'key', 'lower')],
      ]),
    );
    expect(plan.previewSecurityKeys).toEqual(['A', 'B']);
    expect(plan.branches[0].members.every((member) => !member.issues.includes('transport-conflict'))).toBe(true);
    if (place === 'query')
      expect(authToHeaders(plan.auth, plan.securityKeys).queries).toEqual({ Key: 'upper', key: 'lower' });
    else {
      expect(plan).toMatchObject({ complete: false, securityKeys: [] });
      expect(authToHeaders(plan.previewAuth, plan.previewSecurityKeys).headers).toEqual({
        Cookie: 'Key=upper; key=lower',
      });
    }
  });

  test('does not silently merge two named bindings to the same Authorization target', () => {
    const projection = projectionFor({ A: bearer, B: { $ref: '#/components/securitySchemes/A' } }, [{ A: [], B: [] }]);
    const plan = planOas32Security(
      projection,
      supplied([
        ['A', { type: 'http', scheme: 'bearer', token: 'same-value' }],
        ['B', { type: 'http', scheme: 'bearer', token: 'same-value' }],
      ]),
    );
    expect(plan).toMatchObject({ complete: false, securityKeys: [] });
    expect(plan.branches[0].members.every((member) => member.issues.includes('transport-conflict'))).toBe(true);
  });

  test.each([
    [{ type: 'mutualTLS' }, 'browser-client-certificate-unmanaged'],
    [{ type: 'openIdConnect', openIdConnectUrl: './openid' }, 'openid-connect-not-implemented'],
    [{ type: 'http', scheme: 'Digest' }, 'unsupported-http-scheme'],
  ])('retains display-only declarations for %j', (scheme, issue) => {
    const projection = projectionFor({ A: scheme }, [{ A: ['admin'] }]);
    const plan = planOas32Security(projection, credentials);
    expect(plan).toMatchObject({ complete: false, selectedIndex: 0, securityKeys: [], previewSecurityKeys: [] });
    expect(plan.branches[0].members[0]).toMatchObject({
      canDisplay: true,
      canPreview: false,
      canExecute: false,
      issues: [issue],
      member: { values: ['admin'] },
    });
  });

  test.each(['DPoP', '', undefined])('never treats OAuth token type %s as Bearer', (tokenType) => {
    const projection = projectionFor({ A: oauth }, [{ A: ['read'] }]);
    const plan = planOas32Security(
      projection,
      supplied([
        ['A', { type: 'oauth2', accessToken: 'opaque-token', ...(tokenType !== undefined ? { tokenType } : {}) }],
      ]),
    );
    expect(plan).toMatchObject({ complete: false, securityKeys: [], previewSecurityKeys: [] });
    expect(plan.branches[0].members[0]).toMatchObject({
      canDisplay: true,
      credentialStatus: 'filled',
      canExecute: false,
      issues: ['unsupported-token-type'],
    });
  });

  test('preserves OAuth scopes and emits a declared Bearer token without deriving claims', () => {
    const projection = projectionFor({ A: oauth }, [{ A: ['read', 'not-in-flow', 'read'] }]);
    const plan = planOas32Security(
      projection,
      supplied([['A', { type: 'oauth2', accessToken: 'opaque.not-a-jwt.token', tokenType: 'bEaReR' }]]),
    );
    expect(plan).toMatchObject({ complete: true, securityKeys: ['A'] });
    expect(plan.branches[0].members[0].member).toMatchObject({
      values: ['read', 'not-in-flow', 'read'],
      valueKind: 'scopes',
    });
    expect(authToHeaders(plan.auth, plan.securityKeys).headers).toEqual({
      Authorization: 'bEaReR opaque.not-a-jwt.token',
    });
  });

  test.each(['Host', 'Origin', 'Cookie', 'Set-Cookie', 'Content-Length', 'Sec-Token', 'Proxy-Token'])(
    'separates preview from browser execution for forbidden header %s',
    (name) => {
      const plan = planOas32Security(
        projectionFor({ A: { type: 'apiKey', in: 'header', name } }, [{ A: [] }]),
        supplied([['A', keyCredential('header', name)]]),
      );
      expect(plan).toMatchObject({ complete: false, securityKeys: [], previewSecurityKeys: ['A'] });
      expect(plan.branches[0].members[0]).toMatchObject({
        canDisplay: true,
        canPreview: true,
        canExecute: false,
        issues: ['browser-forbidden-header'],
      });
    },
  );

  test.each(['CONNECT', 'get, TrAcE', 'TRACK'])('recognizes forbidden method override value %s', (value) => {
    const name = 'X-HTTP-Method-Override';
    const projection = projectionFor({ A: { type: 'apiKey', in: 'header', name } }, [{ A: [] }]);
    const plan = planOas32Security(projection, supplied([['A', keyCredential('header', name, value)]]));
    expect(plan.branches[0].members[0].issues).toEqual(['browser-forbidden-header']);
    expect(plan.securityKeys).toEqual([]);
    expect(planOas32Security(projection, supplied([['A', keyCredential('header', name, 'PATCH')]])).complete).toBe(
      true,
    );
  });

  test.each(['"GET,TRACE,POST", PATCH', '"unterminated,TRACE', '\u00a0TRACE'])(
    'does not misclassify quoted/non-HTTP whitespace override value %j',
    (value) => {
      const name = 'X-Method-Override';
      const plan = planOas32Security(
        projectionFor({ A: { type: 'apiKey', in: 'header', name } }, [{ A: [] }]),
        supplied([['A', keyCredential('header', name, value)]]),
      );
      expect(plan).toMatchObject({ complete: true, securityKeys: ['A'] });
      expect(plan.branches[0].members[0].issues).toEqual([]);
    },
  );

  test.each(['header', 'query'] as const)(
    'records the current core __proto__ %s assignment gap pending the Phase 2 wire fix',
    (place) => {
      const input = supplied([['A', keyCredential(place, '__proto__')]]);
      const coreOutput = authToHeaders(input, ['A']);
      // Real current-core limitation, deliberately kept separate from normative/browser restrictions.
      expect(Object.hasOwn(place === 'header' ? coreOutput.headers : coreOutput.queries, '__proto__')).toBe(false);
      const projection = projectionFor({ A: { type: 'apiKey', in: place, name: '__proto__' } }, [{ A: [] }]);
      const plan = planOas32Security(projection, input);
      expect(plan.branches[0].members[0]).toMatchObject({
        canDisplay: true,
        canExecute: false,
        issues: ['transport-implementation-limit'],
        member: { resolution: { status: 'resolved', scheme: { name: '__proto__' } } },
      });
      expect(plan.securityKeys).toEqual([]);
    },
  );
});

describe('credential isolation and input immutability', () => {
  test('reads and constructs __proto__/constructor component and credential keys as own properties', () => {
    const schemes = Object.fromEntries([
      ['__proto__', { type: 'apiKey', in: 'header', name: 'X-Proto' }],
      ['constructor', { type: 'apiKey', in: 'query', name: 'constructor' }],
    ]);
    const requirement = Object.fromEntries([
      ['__proto__', []],
      ['constructor', []],
    ]);
    const projection = projectionFor(schemes, [requirement]);
    const input = supplied([
      ['__proto__', keyCredential('header', 'X-Proto')],
      ['constructor', keyCredential('query', 'constructor')],
    ]);
    const plan = planOas32Security(projection, input);
    expect(plan).toMatchObject({ complete: true, securityKeys: ['__proto__', 'constructor'] });
    expect(Object.hasOwn(plan.auth.bySecurityKey!, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(plan.auth.bySecurityKey)).toBe(Object.prototype);
    expect(authToHeaders(plan.auth, plan.securityKeys)).toEqual({
      headers: { 'X-Proto': 'synthetic-value' },
      queries: { constructor: 'synthetic-value' },
    });
    const inherited = Object.create(input.bySecurityKey) as Record<string, SchemeValue>;
    expect(planOas32Security(projection, { bySecurityKey: inherited })).toMatchObject({
      complete: false,
      securityKeys: [],
    });
  });

  test.each([
    { type: 'apiKey', in: 'header', name: 'api_key', value: 'synthetic' },
    { type: 'apiKey', in: 'query', name: 'different', value: 'synthetic' },
    { type: 'http', scheme: 'bearer', token: 'synthetic' },
  ])('does not use mismatched saved credential %j to change the declared transport', (candidate) => {
    const plan = planOas32Security(
      projectionFor({ A: queryKey }, [{ A: [] }]),
      supplied([['A', candidate as SchemeValue]]),
    );
    expect(plan).toMatchObject({ complete: false, securityKeys: [] });
    expect(plan.branches[0].members[0]).toMatchObject({
      credentialStatus: 'mismatch',
      transport: { in: 'query', name: 'api_key' },
      issues: ['credential-mismatch'],
    });
  });

  test.each(['header', 'cookie'] as const)('does not preview or execute malformed %s field values', (place) => {
    const projection = projectionFor({ A: { type: 'apiKey', in: place, name: 'X-Key' } }, [{ A: [] }]);
    const plan = planOas32Security(projection, supplied([['A', keyCredential(place, 'X-Key', 'injected\r\nvalue')]]));
    expect(plan).toMatchObject({ complete: false, securityKeys: [], previewSecurityKeys: [] });
    expect(plan.branches[0].members[0]).toMatchObject({
      credentialStatus: 'invalid',
      issues: expect.arrayContaining(['invalid-credential']),
    });
    expect(JSON.stringify(plan)).not.toContain('injected');
  });

  test.each(['', '   '])('treats blank apiKey %j as missing', (value) => {
    const plan = planOas32Security(
      projectionFor({ A: queryKey }, [{ A: [] }]),
      supplied([['A', keyCredential('query', 'api_key', value)]]),
    );
    expect(plan).toMatchObject({ complete: false, securityKeys: [] });
    expect(plan.branches[0].members[0].credentialStatus).toBe('missing');
  });

  test.each(['white space', 'line\r\nbreak', 'not:token'])('does not emit malformed bearer credential %j', (token) => {
    const plan = planOas32Security(
      projectionFor({ A: bearer }, [{ A: [] }]),
      supplied([['A', { type: 'http', scheme: 'bearer', token }]]),
    );
    expect(plan).toMatchObject({ complete: false, securityKeys: [], previewSecurityKeys: [] });
    expect(plan.branches[0].members[0]).toMatchObject({ credentialStatus: 'invalid', issues: ['invalid-credential'] });
  });

  test('rejects a Basic username colon without banning password colons or empty username', () => {
    const projection = projectionFor({ A: { type: 'http', scheme: 'basic' } }, [{ A: [] }]);
    const invalid = planOas32Security(
      projection,
      supplied([['A', { type: 'http', scheme: 'basic', username: 'bad:user', password: 'pass' }]]),
    );
    expect(invalid).toMatchObject({ complete: false, securityKeys: [] });
    const valid = planOas32Security(
      projection,
      supplied([['A', { type: 'http', scheme: 'basic', username: '', password: 'pass:word' }]]),
    );
    expect(valid.complete).toBe(true);
    expect(authToHeaders(valid.auth, valid.securityKeys).headers).toEqual({
      Authorization: `Basic ${btoa(':pass:word')}`,
    });
  });

  test('does not mutate frozen snapshot, raw operation, requirements or credentials; output changes stay local', () => {
    const data = fixture({
      components: { securitySchemes: { A: bearer, B: queryKey } },
      security: [{ A: [] }, { B: [] }],
    });
    const frozenCredentials = Object.freeze({
      ...credentials,
      bySecurityKey: Object.freeze(
        Object.fromEntries(
          Object.entries(credentials.bySecurityKey!).map(([key, value]) => [key, Object.freeze({ ...value })]),
        ),
      ),
    });
    const beforeGraph = snapshotEvidence(data.snapshot);
    const beforeCredentials = JSON.stringify(frozenCredentials);
    const projection = projectOas32Security(data.snapshot, data.operation);
    const beforeProjection = JSON.stringify(projection);
    const plan = planOas32Security(projection, frozenCredentials);
    expect(plan.auth).not.toBe(frozenCredentials);
    expect(plan.auth.bySecurityKey!.A).not.toBe(frozenCredentials.bySecurityKey.A);
    expect(plan.previewAuth.bySecurityKey!.A).not.toBe(plan.auth.bySecurityKey!.A);
    expect(plan.auth).not.toHaveProperty('bearerToken');
    expect(plan.auth).not.toHaveProperty('basicCredentials');
    expect(plan.auth).not.toHaveProperty('apiKeys');
    expect(JSON.stringify(plan.branches)).not.toContain('synthetic-token-a');
    expect(JSON.stringify(plan)).not.toContain('synthetic-key-b');
    expect(JSON.stringify(plan)).not.toContain('legacy-');
    plan.auth.bySecurityKey!.A = { type: 'http', scheme: 'bearer', token: 'caller-local-change' };
    plan.securityKeys.push('caller-local-key');
    expect(snapshotEvidence(data.snapshot)).toBe(beforeGraph);
    expect(JSON.stringify(projection)).toBe(beforeProjection);
    expect(JSON.stringify(frozenCredentials)).toBe(beforeCredentials);
    expect(data.fetchImpl).not.toHaveBeenCalled();
  });
});
