import { describe, expect, it, vi } from 'vitest';
import { collectOas32DocumentDiagnostics } from 'knife4j-core';
import { parseMenuTags } from '../api/knife4jClient';
import type { SwaggerDoc } from '../types/swagger';
import { ExternalResourceLoader } from './externalResourceGraph';
import { resolveOas32OperationServers } from './oas32OperationServers';
import { resolveOas32Server } from './oas32ServerResolution';
import { locateOperationResponses, responseForDisplay } from './registeredResponse';
import { oas32MetadataDiagnostics } from './oas32MetadataDiagnostics';
import { oas32TagMenu, oas32TagPresentationParents } from './oas32TagMenu';
import { resolveHomeServers } from '../pages/homeServerInfo';

const entryUri = 'http://docs.test/specs/root.json';
const externalUri = 'http://docs.test/libraries/owner.json';
const doc = (openapi = '3.2.0'): SwaggerDoc => ({ openapi, info: { title: 'F metadata', version: '1' }, paths: {} });

describe('F metadata adapters', () => {
  it.each(['3.2.0', '3.2.99'])('uses each field physical owner and entry root inheritance in %s', async (version) => {
    const document = doc(version);
    document.$self = 'https://logical.test/entry.json';
    document.servers = [{ name: 'Entry', url: './entry' }];
    document.paths = { '/pets/{id}': { $ref: `${externalUri}#/components/pathItems/Shared` } };
    const library = doc(version);
    library.$self = 'https://logical.test/library.json';
    library.servers = [{ url: '/MUST-NOT-INHERIT' }];
    library.components = {
      pathItems: {
        Shared: {
          servers: [{ name: 'Path', url: './path-base' }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          get: {
            servers: [
              { name: 'First', url: './{version}/base', variables: { version: { default: 'v1', enum: ['v1', 'v2'] } } },
              { name: 'Second', url: './{version}/base', variables: { version: { default: 'v1' } } },
            ],
            responses: {
              '200': { $ref: '#/components/responses/Alias', summary: '', description: '' },
              '204': {},
              '2XX': { summary: 'Only summary' },
            },
          },
          query: { responses: { '204': {} } },
        },
      },
      responses: {
        Alias: { $ref: '#/components/responses/Result', summary: 'Inner', description: 'Inner description' },
        Result: { summary: 'Target', content: { 'application/json': { schema: { type: 'string' } } } },
      },
    };
    expect(collectOas32DocumentDiagnostics(document)).toEqual([]);
    expect(collectOas32DocumentDiagnostics(library)).toEqual([]);
    const loader = new ExternalResourceLoader(document, entryUri, {
      fetchImpl: vi.fn(
        async () => new Response(JSON.stringify(library), { headers: { 'Content-Type': 'application/json' } }),
      ),
    });
    const snapshot = await loader.load(
      loader.discover().candidates.map((candidate) => ({
        documentScope: loader.documentScope,
        resourceKey: candidate.retrievalUriHash,
        scope: 'generation',
      })),
    );
    const tags = parseMenuTags(document, { retrievalUri: entryUri, resourceSnapshot: snapshot });
    const operations = tags.flatMap((tag) => tag.operations);
    const get = operations.find((operation) => operation.method === 'GET')!;
    const query = operations.find((operation) => operation.method === 'QUERY')!;
    const servers = resolveOas32OperationServers(document, get, entryUri);
    expect(servers.resolutions.map((server) => [server.name, server.requestUrl])).toEqual([
      ['First', 'http://docs.test/libraries/v1/base'],
      ['Second', 'http://docs.test/libraries/v1/base'],
    ]);
    expect(resolveOas32Server(servers.servers[0], { version: 'v2' }).requestUrl).toBe(
      'http://docs.test/libraries/v2/base',
    );
    expect(resolveOas32OperationServers(document, query, entryUri).resolutions[0]).toMatchObject({
      requestUrl: 'http://docs.test/libraries/path-base',
      source: { ownerRetrievalUri: externalUri, level: 'path-item' },
    });
    expect(resolveHomeServers(document, 'https://ui.test', entryUri)[0].url).toBe('http://docs.test/specs/entry');
    expect(oas32MetadataDiagnostics(document, tags)).toEqual([]);
    const responses = locateOperationResponses(document, get);
    expect(responses[0].location).toMatchObject({
      retrievalUri: externalUri,
      tokens: ['components', 'responses', 'Result'],
      value: { summary: '', description: '' },
    });
    expect(responseForDisplay(responses[0].location!).content?.['application/json'].schema).toEqual({
      $ref: `${externalUri}#/components/responses/Result/content/application~1json/schema`,
    });
    expect(responses[1].location?.value).toEqual({});
    expect(responses[2].location?.value.summary).toBe('Only summary');
    loader.dispose();
  });

  it('does not inherit an external document root server without a path or operation override', async () => {
    const document = doc();
    document.servers = [{ url: './entry' }];
    document.paths = { '/mounted': { $ref: `${externalUri}#/components/pathItems/Shared` } };
    const library = doc();
    library.servers = [{ url: '/external-root' }];
    library.components = { pathItems: { Shared: { get: { responses: { '204': {} } } } } };
    const loader = new ExternalResourceLoader(document, entryUri, {
      fetchImpl: vi.fn(
        async () => new Response(JSON.stringify(library), { headers: { 'Content-Type': 'application/json' } }),
      ),
    });
    const snapshot = await loader.load(
      loader.discover().candidates.map((candidate) => ({
        documentScope: loader.documentScope,
        resourceKey: candidate.retrievalUriHash,
        scope: 'generation',
      })),
    );
    const operation = parseMenuTags(document, { retrievalUri: entryUri, resourceSnapshot: snapshot })[0].operations[0];
    expect(resolveOas32OperationServers(document, operation, entryUri).resolutions[0].requestUrl).toBe(
      'http://docs.test/specs/entry',
    );
    loader.dispose();
  });

  it('keeps unresolved parameters unavailable instead of inventing missing bindings', () => {
    const document = doc();
    document.paths = {
      '/pets/{id}': {
        get: { parameters: [{ $ref: `${externalUri}#/components/parameters/Id` }], responses: { '204': {} } },
      },
    };
    const groups = parseMenuTags(document, { retrievalUri: entryUri });
    expect(oas32MetadataDiagnostics(document, groups).map((diagnostic) => diagnostic.code)).toEqual([
      'path-parameters-unresolved',
    ]);
    document.paths['/pets/{id}'].get!.parameters = [{ name: 'other', in: 'path', required: true }];
    expect(
      oas32MetadataDiagnostics(document, parseMenuTags(document, { retrievalUri: entryUri })).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toEqual(['unmatched-path-parameter', 'missing-path-parameter']);
  });

  it('distinguishes unavailable, wrong-type, cycle and legal empty responses', () => {
    const document = doc();
    document.paths = {
      '/result': {
        get: {
          responses: {
            '200': { $ref: `${externalUri}#/components/responses/Result` },
            '201': { $ref: '#/components/parameters/Id' },
            '202': { $ref: '#/paths/~1result/get/responses/202' },
            '204': {},
          },
        },
      },
    };
    document.components = { parameters: { Id: { name: 'id', in: 'path', required: true } } };
    const operation = parseMenuTags(document, { retrievalUri: entryUri })[0].operations[0];
    expect(locateOperationResponses(document, operation).map((response) => response.location?.value ?? null)).toEqual([
      null,
      null,
      null,
      {},
    ]);
  });

  it('sorts pure parents with all tags and preserves name, operations and ancestors during search', () => {
    const document = doc();
    document.tags = [
      { name: 'child', summary: 'Same', parent: 'parent', kind: 'custom', 'x-order': 2 },
      { name: 'parent', summary: 'Parent summary', 'x-order': 1 },
      { name: '%2F', summary: 'Same' },
      { name: '', summary: 'Empty' },
    ];
    document.paths = {
      '/item': { get: { tags: ['child', '%2F', ''], summary: 'Find operation', responses: { '204': {} } } },
    };
    const groups = parseMenuTags(document, { retrievalUri: entryUri, tagsSorter: 'alpha' });
    const apis = groups.flatMap((group) =>
      group.operations.map((operation) => ({
        key: operation.key,
        method: operation.method,
        summary: operation.summary,
        path: operation.path,
        tag: group.tag,
      })),
    );
    const navigation = oas32TagMenu(document, groups, apis, '')!;
    expect(navigation.roots.map((node) => node.name)).toEqual(['parent', '%2F', '']);
    expect(navigation.roots[0].operations).toEqual([]);
    expect(navigation.roots[0].children[0].operations[0]).toBe(apis[0]);
    expect(oas32TagMenu(document, groups, apis, 'Parent summary')!.nodes.map((node) => node.name)).toEqual([
      'parent',
      'child',
    ]);
    expect(oas32TagMenu(document, groups, apis, 'Find operation')!.nodes).toHaveLength(4);
    expect(oas32TagMenu({ ...document, openapi: '3.1.2' }, groups, apis, '')).toBeNull();
  });

  it('bounds deep menu presentation without dropping tags or operations', () => {
    const document = doc();
    document.tags = Array.from({ length: 2000 }, (_, index) => ({
      name: `tag${index}`,
      ...(index ? { parent: `tag${index - 1}` } : {}),
    }));
    document.paths = { '/deep': { get: { tags: ['tag1999'], responses: { '204': {} } } } };
    const groups = parseMenuTags(document, { retrievalUri: entryUri });
    const apis = groups.flatMap((group) =>
      group.operations.map((operation) => ({
        key: operation.key,
        method: operation.method,
        summary: operation.summary,
        path: operation.path,
        tag: group.tag,
      })),
    );
    const navigation = oas32TagMenu(document, groups, apis, 'deep')!;
    const parents = oas32TagPresentationParents(navigation);
    expect(parents.size).toBe(2000);
    expect(parents.get('tag1999')).toBe('tag11');
    expect(navigation.nodes[1999].operations[0]).toBe(apis[0]);
    expect(navigation.nodes[1999].parentName).toBe('tag1998');
  });
});
