import { describe, expect, test, vi } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import {
  collectOas32DocumentDiagnostics,
  enumerateOpenApiOperations,
  OperationEnumerationBudget,
  resolveLocalJsonPointer,
  type OperationEnumerationDiagnostic,
} from 'knife4j-core';
import { parseMenuTags } from '../api/knife4jClient';
import { findMenuOperation, visibleOperationModeKeys } from '../pages/api/operationRouting';
import { buildOpenApiViewState } from '../pages/api/openApiViewState';
import { buildHomeStats } from '../pages/homeStats';
import { locateOperationRecord, locatePathItemMember } from './openApiDocumentPointer';
import { ExternalResourceLoader } from './externalResourceGraph';
import { enumerateRegistryOperations, operationResponseLinks, resolveOperationLink } from './operationRegistry';
import type { SwaggerDoc } from '../types/swagger';

const uri = 'https://fixture.example.test/entry.json';
const libraryUri = 'https://fixture.example.test/library.json';
const info = { title: 'Synthetic review regression', version: '1' };
const parameter = { name: 'cb', in: 'query', schema: { type: 'string' } };
const doc = (paths: unknown, components?: unknown): SwaggerDoc =>
  ({ openapi: '3.2.0', info, paths, ...(components === undefined ? {} : { components }) }) as SwaggerDoc;
const flat = (document: SwaggerDoc) => parseMenuTags(document, { retrievalUri: uri }).flatMap((tag) => tag.operations);

function callbackDag(depth: number): SwaggerDoc {
  const callbacks: Record<string, unknown> = {};
  for (let i = depth; i >= 0; i--)
    callbacks[`C${i}`] = {
      '{$request.query.cb}': {
        query: {
          parameters: [parameter],
          ...(i < depth
            ? {
                callbacks: {
                  left: { $ref: `#/components/callbacks/C${i + 1}` },
                  right: { $ref: `#/components/callbacks/C${i + 1}` },
                },
              }
            : {}),
        },
      },
    };
  return doc(
    { '/start': { query: { parameters: [parameter], callbacks: { next: { $ref: '#/components/callbacks/C0' } } } } },
    { callbacks },
  );
}

function nestedComponent(mounts: number): SwaggerDoc {
  const nested = {
    query: {
      operationId: 'called',
      parameters: [parameter],
      callbacks: {
        again: { '{$request.query.cb}': { additionalOperations: { Notify: {} } } },
      },
    },
  };
  const shared = { post: { parameters: [parameter], callbacks: { done: { '{$request.query.cb}': nested } } } };
  return doc(
    Object.fromEntries(
      Array.from({ length: mounts }, (_, i) => [`/run${i}`, { $ref: '#/components/pathItems/Shared' }]),
    ),
    { pathItems: { Shared: shared } },
  );
}

describe('E772-F1: physical pointers and decoded Router parameters', () => {
  test.each(['%', '%41', '%2F', 'Copy'])('preserves %s through real routes and preview', (method) => {
    const document = doc({
      '/percent': {
        parameters: [parameter],
        additionalOperations: { [method]: { summary: method, tags: ['tag%41'] } },
      },
    });
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const tags = parseMenuTags(document, { retrievalUri: uri });
    const operation = tags[0].operations[0];
    const params = matchRoutes([{ path: '/:group/:tag/:operaterId/:mode' }], `/default/${operation.key}/doc`)![0]
      .params;
    expect(findMenuOperation(tags, params.tag, params.operaterId)).toBe(operation);
    expect(locateOperationRecord(document, operation)?.tokens.at(-1)).toBe(method);
    expect(locatePathItemMember(document, operation, 'parameters')?.tokens).toEqual([
      'paths',
      '/percent',
      'parameters',
    ]);
    const preview = buildOpenApiViewState(document, operation, { status: 'unavailable' });
    expect(preview.status).toBe('ready');
    if (preview.status === 'ready')
      expect(Object.keys(JSON.parse(preview.json).paths['/percent'].additionalOperations)).toEqual([method]);
  });

  test('keeps literal %2F and slash tags distinct through Router parameters', () => {
    const document = doc({
      '/tags': {
        additionalOperations: {
          COPY: { tags: ['%2F'] },
          Copy: { tags: ['/'] },
          '%': { tags: ['%'] },
          '%41': { tags: ['%41'] },
        },
      },
    });
    const tags = parseMenuTags(document, { retrievalUri: uri });
    for (const tag of tags) {
      const operation = tag.operations[0];
      const params = matchRoutes([{ path: '/:group/:tag/:operaterId/:mode' }], `/default/${operation.key}/doc`)![0]
        .params;
      expect(findMenuOperation(tags, params.tag, params.operaterId)).toBe(operation);
    }
    expect(new Set(tags.map((tag) => tag.routeId)).size).toBe(4);
  });

  test('reads exactly C target %41 while standard URI fragments still decode once', () => {
    const document = doc({
      '/source': {
        additionalOperations: {
          '%41': {
            parameters: [{ name: 'literalPercent', in: 'query', schema: { type: 'string', default: 'correct' } }],
          },
          A: { parameters: [{ name: 'decoy', in: 'query', schema: { type: 'integer', default: 42 } }] },
        },
      },
      '/consumer': { get: { parameters: [{ $ref: '#/paths/~1source/additionalOperations/%2541/parameters/0' }] } },
      'x-opaque': { additionalOperations: { Ghost: {} } },
    });
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const operation = flat(document).find((item) => item.path === '/consumer')!;
    expect(operation.resourceSnapshot?.diagnostics).toEqual([]);
    expect(operation.operation.parameters?.[0]).toMatchObject({
      name: 'literalPercent',
      schema: { default: 'correct' },
    });
    expect(operation.identity?.parameterLocations['query:literalPercent']).toMatchObject({
      pointer: '#/paths/~1source/additionalOperations/%41/parameters/0',
      value: { name: 'literalPercent' },
    });
    expect(
      resolveLocalJsonPointer(document, '#/paths/~1source/additionalOperations/%2541/parameters/0').value,
    ).toMatchObject({ name: 'literalPercent' });
  });
});

describe('E772-F2: one finite expansion budget', () => {
  test.each([
    { maxOperations: 18, maxWork: 5000 },
    { maxOperations: 500, maxWork: 30 },
  ])('bounds DAG work and results with %j', (limits) => {
    const document = callbackDag(8);
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const budget = new OperationEnumerationBudget(limits);
    const operations = enumerateOpenApiOperations(document as never, { budget });
    expect(operations.length).toBeLessThanOrEqual(limits.maxOperations);
    expect(budget.work).toBeLessThanOrEqual(limits.maxWork);
    expect(budget.operations).toBeLessThanOrEqual(limits.maxOperations);
    expect(budget.diagnostic?.code).toBe('OPERATION_EXPANSION_LIMIT');
    const result = enumerateRegistryOperations(document, uri, undefined, limits);
    expect(result.snapshot.diagnostics).toEqual([]);
    expect(result.diagnostic?.code).toBe('OPERATION_EXPANSION_LIMIT');
    let warning: OperationEnumerationDiagnostic | undefined;
    const tags = parseMenuTags(document, {
      retrievalUri: uri,
      operationLimits: limits,
      onOperationLimit: (value) => {
        warning = value;
      },
    });
    expect(warning?.code).toBe('OPERATION_EXPANSION_LIMIT');
    expect(tags.flatMap((tag) => tag.operations).every((operation) => operation.enumerationLimited)).toBe(true);
  });

  test('component roots share the same budget and cycles terminate without consuming it', () => {
    const document = nestedComponent(0);
    const budget = new OperationEnumerationBudget({ maxOperations: 2 });
    expect(enumerateOpenApiOperations(document as never, { budget })).toHaveLength(2);
    expect(budget.diagnostic?.resource).toBe('operations');
    const cycle = callbackDag(0);
    (cycle.components!.callbacks!.C0 as Record<string, unknown>)['{$request.query.cb}'] = {
      query: { parameters: [parameter], callbacks: { loop: { $ref: '#/components/callbacks/C0' } } },
    };
    const cycleBudget = new OperationEnumerationBudget({ maxOperations: 20 });
    expect(enumerateOpenApiOperations(cycle as never, { budget: cycleBudget }).length).toBeLessThan(10);
    expect(cycleBudget.diagnostic).toBeUndefined();
  });
});

describe('E772-F3: loaded Link-only targets', () => {
  test('opens a loaded external target read-only and keeps pending, wrong-type and budget states distinct', async () => {
    const library = doc(
      { '/copy': { additionalOperations: { Copy: { summary: 'External Copy' } } } },
      { schemas: { Wrong: { type: 'string' } } },
    );
    const document = doc({
      '/from': {
        get: {
          responses: {
            '200': {
              description: 'OK',
              links: {
                next: { operationRef: `${libraryUri}#/paths/~1copy/additionalOperations/Copy` },
                wrong: { operationRef: `${libraryUri}#/components/schemas/Wrong` },
              },
            },
          },
        },
      },
    });
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(library), { headers: { 'Content-Type': 'application/json' } }),
    );
    const loader = new ExternalResourceLoader(document, uri, { fetchImpl });
    const before = parseMenuTags(document, { retrievalUri: uri, resourceSnapshot: loader.currentSnapshot() }).flatMap(
      (tag) => tag.operations,
    );
    const pending = operationResponseLinks(before[0])[0];
    expect(resolveOperationLink(before, pending.location, before[0].resourceSnapshot)).toEqual({
      status: 'not-loaded',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    const discovery = loader.discover();
    const snapshot = await loader.load(
      discovery.candidates.map((candidate) => ({
        documentScope: loader.documentScope,
        resourceKey: candidate.retrievalUriHash,
        scope: 'generation',
      })),
    );
    const operations = parseMenuTags(document, { retrievalUri: uri, resourceSnapshot: snapshot }).flatMap(
      (tag) => tag.operations,
    );
    const links = operationResponseLinks(operations.find((operation) => operation.path === '/from')!);
    const target = resolveOperationLink(operations, links[0].location, snapshot);
    expect(target.status).toBe('resolved');
    if (target.status === 'resolved') {
      expect(target.operation).toMatchObject({ source: 'link', method: 'Copy', path: '#/paths/~1copy' });
      expect(target.operation.identity).toMatchObject({
        ownerRetrievalUri: libraryUri,
        mountPointer: '',
        operationPointer: '#/paths/~1copy/additionalOperations/Copy',
      });
      expect(visibleOperationModeKeys(target.operation.source, true, true)).toEqual(['doc', 'openapi']);
    }
    expect(resolveOperationLink(operations, links[1].location, snapshot)).toEqual({ status: 'wrong-type' });
    const limited = parseMenuTags(document, {
      retrievalUri: uri,
      resourceSnapshot: snapshot,
      operationLimits: { maxOperations: 1 },
    }).flatMap((tag) => tag.operations);
    expect(resolveOperationLink(limited, links[0].location, snapshot)).toEqual({ status: 'limited' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(
      Object.isFrozen(
        snapshot.objectLocations.find(
          (location) => location.kind === 'operation' && location.ownerRetrievalUri === libraryUri,
        ),
      ),
    ).toBe(true);
    loader.dispose();
  });

  test('opens a standalone loaded Operation without inventing a method or execution path', async () => {
    const operationDocument = { summary: 'Standalone linked contract', operationId: 'standalone' };
    const document = doc({
      '/from': { get: { responses: { '200': { description: 'OK', links: { next: { operationRef: libraryUri } } } } } },
    });
    const loader = new ExternalResourceLoader(document, uri, {
      fetchImpl: async () =>
        new Response(JSON.stringify(operationDocument), { headers: { 'Content-Type': 'application/json' } }),
    });
    const discovery = loader.discover();
    const snapshot = await loader.load(
      discovery.candidates.map((candidate) => ({
        documentScope: loader.documentScope,
        resourceKey: candidate.retrievalUriHash,
        scope: 'generation',
      })),
    );
    const operations = parseMenuTags(document, { retrievalUri: uri, resourceSnapshot: snapshot }).flatMap(
      (tag) => tag.operations,
    );
    const link = operationResponseLinks(operations[0])[0];
    const target = resolveOperationLink(operations, link.location, snapshot);
    expect(target.status).toBe('resolved');
    if (target.status === 'resolved') {
      expect(target.operation).toMatchObject({ source: 'link', method: '', path: '#' });
      expect(target.operation.identity).toMatchObject({
        methodSource: 'unknown',
        mountPointer: '',
        pathItemPointer: '',
        operationPointer: '#',
      });
      const preview = buildOpenApiViewState(document, target.operation, { status: 'unavailable' });
      expect(preview.status).toBe('ready');
      if (preview.status === 'ready') expect(JSON.parse(preview.json)).toEqual(operationDocument);
    }
    loader.dispose();
  });

  test('retains real multiple mount ambiguity', () => {
    const document = nestedComponent(2);
    const operations = flat(document);
    const snapshot = operations[0].resourceSnapshot!;
    expect(
      resolveOperationLink(
        operations,
        { value: { operationId: 'called' }, pointer: '#/components/links/Next', ownerRetrievalUri: uri },
        snapshot,
      ),
    ).toEqual({ status: 'ambiguous' });
  });
});

describe('E772-F4: callback prototype provenance', () => {
  test.each([0, 1, 2])('preserves %i real mounts and recursively filters prototypes', (mounts) => {
    const document = nestedComponent(mounts);
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    const tags = parseMenuTags(document, { retrievalUri: uri });
    const operations = tags.flatMap((tag) => tag.operations);
    expect(operations).toHaveLength(Math.max(mounts, 1) * 3);
    expect(buildHomeStats(document, tags).counts).toMatchObject({
      POST: Math.max(mounts, 1),
      QUERY: Math.max(mounts, 1),
      Notify: Math.max(mounts, 1),
    });
    expect(new Set(operations.map((operation) => operation.identity?.identity)).size).toBe(operations.length);
    if (mounts === 0) expect(operations.every((operation) => operation.source === 'component')).toBe(true);
    else expect(operations.filter((operation) => operation.source === 'component')).toHaveLength(0);
  });
});
