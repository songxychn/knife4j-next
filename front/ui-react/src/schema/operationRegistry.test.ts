import { describe, expect, test, vi } from 'vitest';
import {
  buildOperationDebugModel,
  buildRequest,
  buildCurl,
  collectOas32DocumentDiagnostics,
  operationHttpMethod,
} from 'knife4j-core';
import { parseMenuTags } from '../api/knife4jClient';
import { buildHomeStats } from '../pages/homeStats';
import { findMenuOperation, visibleOperationModeKeys } from '../pages/api/operationRouting';
import { browserRequestConstraint } from '../pages/api/browserRequestConstraints';
import { buildBodyContentDefaults, buildInitialParamValues } from '../pages/api/debugDefaultValues';
import { buildOpenApiViewState } from '../pages/api/openApiViewState';
import { locateOperationRecord, locatePathItemMember } from './openApiDocumentPointer';
import { ExternalResourceLoader } from './externalResourceGraph';
import { operationSchemaDocuments, resolveOperationLink } from './operationRegistry';
import { generateCode } from '../pages/api/ScriptView';
import type { SwaggerDoc } from '../types/swagger';

const entryUri = 'https://fixture.example.test/openapi.json';
const doc = (openapi = '3.2.0'): SwaggerDoc => ({
  openapi,
  info: { title: 'Synthetic OAS 3.2 operation fixture', version: '1' },
  paths: {
    '/methods': {
      query: {},
      additionalOperations: {
        COPY: {
          tags: ['Methods', 'All'],
          operationId: 'upperCopy',
          parameters: [{ name: 'variant', in: 'query', schema: { type: 'string', default: 'upper' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'string', default: 'upper' } } } },
        },
        Copy: {
          tags: ['Methods', 'All'],
          operationId: 'mixedCopy',
          parameters: [{ name: 'variant', in: 'query', schema: { type: 'string', default: 'mixed' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'string', default: 'mixed' } } } },
        },
        patch: {},
        get: {},
        'x-PING': {},
      },
    },
    '/callbacks': {
      post: { callbacks: { next: { '{$request.query.callback}': { additionalOperations: { Notify: {} } } } } },
    },
    'x-opaque': { additionalOperations: { Ghost: {} } },
  },
  webhooks: { changed: { query: {} } },
  components: { pathItems: { Shared: { additionalOperations: { SEARCH: {} } } } },
});

describe('OAS 3.2 operation consumers', () => {
  test.each(['3.2.0', '3.2.99'])(
    'menu, search routes, counts, defaults and previews share exact identity in %s',
    (version) => {
      const document = doc(version);
      expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
      const tags = parseMenuTags(document, { retrievalUri: entryUri, filterMultipartApis: true });
      const operations = tags.flatMap((tag) => tag.operations);
      const unique = [...new Map(operations.map((operation) => [operation.identity!.identity, operation])).values()];
      expect(unique.map((operation) => operation.method).sort()).toEqual(
        ['COPY', 'Copy', 'Notify', 'POST', 'QUERY', 'QUERY', 'SEARCH', 'get', 'patch', 'x-PING'].sort(),
      );
      const stats = buildHomeStats(document, tags);
      expect(stats.total).toBe(10);
      expect(stats.counts).toMatchObject({ COPY: 1, Copy: 1, QUERY: 2, patch: 1, get: 1 });
      for (const method of ['COPY', 'Copy']) {
        const operation = tags
          .find((tag) => tag.tag === 'Methods')!
          .operations.find((operation) => operation.method === method)!;
        expect(findMenuOperation(tags, encodeURIComponent('Methods'), encodeURIComponent(operation.routeId!))).toBe(
          operation,
        );
        expect(operationHttpMethod(operation)).toBe(method);
        const debug = buildOperationDebugModel({
          doc: document as never,
          method,
          path: '/methods',
          operationIdentity: operation.identity,
        });
        expect(debug.queryParams[0].default).toBe(method === 'COPY' ? 'upper' : 'mixed');
        expect(buildInitialParamValues(debug, document, operation)['query:variant']).toBe(
          method === 'COPY' ? 'upper' : 'mixed',
        );
        expect(buildBodyContentDefaults(document, operation, debug).bodyByMediaType['application/json']).toBe(
          JSON.stringify(method === 'COPY' ? 'upper' : 'mixed', null, 2),
        );
        expect(locateOperationRecord(document, operation)?.tokens).toEqual([
          'paths',
          '/methods',
          'additionalOperations',
          method,
        ]);
        const preview = buildOpenApiViewState(document, operation, { status: 'unavailable' });
        expect(preview).toMatchObject({ status: 'ready', downloadable: false });
        if (preview.status === 'ready')
          expect(JSON.parse(preview.json).paths['/methods'].additionalOperations[method]).toBeDefined();
        const built = buildRequest({
          baseUrl: 'https://fixture.example.test',
          path: '/methods',
          method,
          preserveMethodCase: true,
          debugModel: debug,
          formValues: { pathParams: {}, queryParams: {}, headerParams: {}, cookieParams: {} },
        });
        expect(built.method).toBe(method);
        expect(buildCurl(built)).toContain(`  ${method} `);
      }
      expect(visibleOperationModeKeys('callback', true, true)).toEqual(['doc', 'openapi']);
      expect(visibleOperationModeKeys('component', true, true)).toEqual(['doc', 'openapi']);
    },
  );

  test.each(['QUERY', 'COPY', 'Copy', 'patch'])('allows exact Fetch method %s', (method) => {
    expect(browserRequestConstraint(method, true)).toBeNull();
  });
  test.each(['get', 'Get', 'post', 'pUt', 'delete', 'OPTIONS'])(
    'reports Fetch normalization only when spelling changes for %s',
    (method) => {
      expect(browserRequestConstraint(method, false)).toBe(method === 'OPTIONS' ? null : 'normalized-method');
    },
  );
  test.each(['CONNECT', 'connect', 'Trace', 'TRACK', 'Bad Method'])(
    'rejects forbidden or invalid method %s',
    (method) => {
      expect(browserRequestConstraint(method, false)).toBe('unsupported-method');
    },
  );

  test('keeps graph owner and mount distinct across references and resolves Link to the exact method', async () => {
    const libraryUri = 'https://fixture.example.test/library.json';
    const library = {
      openapi: '3.2.0',
      $self: 'https://logical.example.test/library',
      info: { title: 'Library', version: '1' },
      components: {
        schemas: { Shared: { type: 'string', default: 'library-value' } },
        pathItems: {
          Shared: {
            parameters: [{ name: 'id', in: 'query', schema: { $ref: '#/components/schemas/Shared' } }],
            additionalOperations: {
              Copy: {
                operationId: 'externalCopy',
                requestBody: { $ref: `${entryUri}#/components/requestBodies/Shared` },
                responses: { '200': { $ref: `${entryUri}#/components/responses/Shared` } },
              },
            },
          },
        },
      },
    };
    const document: SwaggerDoc = {
      openapi: '3.2.0',
      info: { title: 'Entry', version: '1' },
      paths: { '/mount': { $ref: `${libraryUri}#/components/pathItems/Shared` } },
      components: {
        schemas: { Shared: { type: 'integer', default: 42 } },
        requestBodies: {
          Shared: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Shared' } } } },
        },
        responses: {
          Shared: {
            description: 'Entry response',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Shared' } } },
          },
        },
        links: { Next: { operationRef: `${libraryUri}#/components/pathItems/Shared/additionalOperations/Copy` } },
      },
    };
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(library), { headers: { 'Content-Type': 'application/json' } }),
    );
    const loader = new ExternalResourceLoader(document, entryUri, { fetchImpl });
    expect(parseMenuTags(document, { retrievalUri: entryUri }).flatMap((tag) => tag.operations)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    const discovery = loader.discover();
    const snapshot = await loader.load(
      discovery.candidates.map((candidate) => ({
        documentScope: loader.documentScope,
        resourceKey: candidate.retrievalUriHash,
        scope: 'generation',
      })),
    );
    const operations = parseMenuTags(document, { retrievalUri: entryUri, resourceSnapshot: snapshot }).flatMap(
      (tag) => tag.operations,
    );
    expect(operations).toHaveLength(1);
    const operation = operations[0];
    expect(operation.identity).toMatchObject({
      method: 'Copy',
      ownerRetrievalUri: libraryUri,
      operationPointer: '#/components/pathItems/Shared/additionalOperations/Copy',
      mountPointer: '#/paths/~1mount',
    });
    expect(locateOperationRecord(document, operation)?.ownerRetrievalUri).toBe(libraryUri);
    expect(locatePathItemMember(document, operation, 'parameters')).toMatchObject({
      ownerRetrievalUri: libraryUri,
      tokens: ['components', 'pathItems', 'Shared', 'parameters'],
    });
    expect(operation.operation.parameters?.[0]).toMatchObject({ name: 'id' });
    const documents = operationSchemaDocuments(document, operation);
    const debug = buildOperationDebugModel({
      doc: document as never,
      path: '/mount',
      method: 'Copy',
      operationIdentity: operation.identity,
      operationDocuments: documents,
    });
    expect(debug.queryParams[0]).toMatchObject({ type: 'string', default: 'library-value' });
    expect(debug.bodyContents[0]).toMatchObject({ schema: { type: 'integer', default: 42 }, exampleValue: '42' });
    expect(buildInitialParamValues(debug, document, operation)['query:id']).toBe('library-value');
    expect(buildBodyContentDefaults(document, operation, debug).bodyByMediaType['application/json']).toBe('42');
    expect(operation.identity?.requestBodyLocation).toMatchObject({
      ownerRetrievalUri: entryUri,
      pointer: '#/components/requestBodies/Shared',
    });
    expect(operation.identity?.parameterLocations['query:id']).toMatchObject({
      ownerRetrievalUri: libraryUri,
      pointer: '#/components/pathItems/Shared/parameters/0',
    });
    const code = generateCode(
      'Copy',
      '/mount',
      undefined,
      undefined,
      operation.operation.parameters ?? [],
      operation.operation.requestBody?.content?.['application/json'].schema,
      operation.operation.responses?.['200'].content?.['application/json'].schema,
      document,
      {
        requestBody: 'Body',
        requestInterface: 'Request',
        requestType: 'Request type',
        responseInterface: 'Response',
        responseType: 'Response type',
      },
      documents,
    );
    expect(code.ts).toContain('Params = number');
    expect(code.ts).toContain('Res = number');
    expect(code.ts).toContain('id: string | undefined');
    expect(code.ts).toContain('method: "Copy"');
    expect(
      resolveOperationLink(
        operations,
        { value: document.components!.links!.Next, pointer: '#/components/links/Next', ownerRetrievalUri: entryUri },
        snapshot,
      ),
    ).toEqual({ status: 'resolved', operation });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(snapshot.edges.find((edge) => edge.target)?.target)).toBe(true);
    loader.dispose();
  });
});
