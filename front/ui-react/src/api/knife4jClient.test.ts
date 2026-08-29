import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SwaggerDoc } from '../types/swagger';
import {
  fetchSwaggerDocResult,
  fetchSwaggerUiConfig,
  isOpenApi3Document,
  parseGroupsFromConfig,
  parseMenuTags,
} from './knife4jClient';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function textResponse(body: string, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('knife4jClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('discovers custom springdoc swagger-config through the Knife4j runtime config endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(
        jsonResponse({
          schemaVersion: '1',
          openapi: {
            apiDocsUrl: 'api/openapi',
            swaggerConfigUrl: 'api/openapi/swagger-config',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ url: '/api/openapi', tagsSorter: 'alpha' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSwaggerUiConfig()).resolves.toEqual({ url: '/api/openapi', tagsSorter: 'alpha' });
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'v3/api-docs/swagger-config');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'knife4j/config');
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'api/openapi/swagger-config');
  });

  it('uses the single springdoc url when swagger-config has no urls array', () => {
    expect(parseGroupsFromConfig({ url: '/api/openapi' })).toEqual([{ name: 'default', url: '/api/openapi' }]);
  });

  it('distinguishes OpenAPI 3 from Swagger 2 documents', () => {
    expect(isOpenApi3Document({ openapi: '3.1.0', info: { title: 'demo', version: '1' }, paths: {} })).toBe(true);
    expect(isOpenApi3Document({ openapi: '3.bad', info: { title: 'demo', version: '1' }, paths: {} })).toBe(false);
    expect(isOpenApi3Document({ swagger: '2.0', info: { title: 'demo', version: '1' }, paths: {} })).toBe(false);
  });

  it('normalizes a webhook-only OAS 3.1 response to an empty internal paths map', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        textResponse(
          JSON.stringify({
            openapi: '3.1.1',
            info: { title: 'Webhook API', version: '1' },
            webhooks: { changed: { post: { summary: 'Changed' } } },
          }),
        ),
      ),
    );

    const result = await fetchSwaggerDocResult('/openapi.json');
    expect(result.error).toBeNull();
    expect(result.doc?.paths).toEqual({});
    expect(parseMenuTags(result.doc!)[0].operations[0].source).toBe('webhook');
  });

  it('preserves aggregation route metadata from swagger-config urls', () => {
    expect(
      parseGroupsFromConfig({
        urls: [
          {
            name: '用户中心',
            url: '/iam/v3/api-docs',
            contextPath: '/iam',
            header: 'nacos-user-service',
          },
        ],
      }),
    ).toEqual([
      {
        name: '用户中心',
        url: '/iam/v3/api-docs',
        contextPath: '/iam',
        header: 'nacos-user-service',
      },
    ]);
  });

  it('normalizes OpenAPI docs with missing info', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(textResponse(JSON.stringify({ openapi: '3.0.1', paths: {} })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSwaggerDocResult('/v3/api-docs')).resolves.toEqual({
      doc: {
        openapi: '3.0.1',
        info: { title: 'API Docs', version: '' },
        paths: {},
      },
      error: null,
    });
  });

  it('sends the selected UI language when fetching api-docs', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      textResponse(
        JSON.stringify({
          openapi: '3.0.1',
          info: { title: 'demo', version: '1.0.0' },
          paths: {},
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchSwaggerDocResult('/v3/api-docs', { preferredLanguage: 'en-US' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/v3/api-docs',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept-Language': expect.stringMatching(/^en-US(?:,|$)/),
        }),
      }),
    );
  });

  it('sends the aggregation route header alongside the selected language when fetching api-docs', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      textResponse(
        JSON.stringify({
          openapi: '3.0.1',
          info: { title: 'demo', version: '1.0.0' },
          paths: {},
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchSwaggerDocResult('/v3/api-docs', {
      preferredLanguage: 'zh-CN',
      routeHeader: 'nacos-user-service',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/v3/api-docs',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept-Language': expect.stringMatching(/^zh-CN(?:,|$)/),
          'knife4j-gateway-request': 'nacos-user-service',
        }),
      }),
    );
  });

  it('rejects non OpenAPI JSON responses with a diagnostic message', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(textResponse(JSON.stringify({ error: 'not found' })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSwaggerDocResult('/v3/api-docs');

    expect(result.doc).toBeNull();
    expect(result.error?.key).toBe('error.apiDocs.invalidObject');
  });

  it('diagnoses Base64 encoded api-docs responses', async () => {
    const encoded = btoa(JSON.stringify({ openapi: '3.0.1', info: { title: 'demo', version: '1.0.0' }, paths: {} }));
    const fetchMock = vi.fn().mockResolvedValueOnce(textResponse(JSON.stringify(encoded)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSwaggerDocResult('/v3/api-docs');

    expect(result.doc).toBeNull();
    expect(result.error?.key).toBe('error.apiDocs.base64');
  });

  it('sorts tags and operations by Knife4j x-order extensions', () => {
    const doc: SwaggerDoc = {
      openapi: '3.0.1',
      info: { title: 'demo', version: '1.0.0' },
      tags: [
        { name: 'users', description: 'User APIs', 'x-order': 20 },
        { name: 'pets', description: 'Pet APIs', 'x-order': 10 },
      ],
      paths: {
        '/pets/search': {
          get: {
            tags: ['pets'],
            summary: 'Search pets',
            operationId: 'searchPets',
            'x-order': 20,
          },
        },
        '/pets': {
          post: {
            tags: ['pets'],
            summary: 'Create pet',
            operationId: 'createPet',
            'x-order': 10,
          },
        },
        '/users': {
          get: {
            tags: ['users'],
            summary: 'List users',
            operationId: 'listUsers',
            'x-order': 10,
          },
        },
      },
    };

    const menuTags = parseMenuTags(doc);

    expect(menuTags.map((tag) => tag.tag)).toEqual(['pets', 'users']);
    expect(menuTags[0].operations.map((operation) => operation.operationId)).toEqual(['createPet', 'searchPets']);
  });

  it('keeps a stable fallback when Knife4j x-order values tie or are invalid', () => {
    const doc: SwaggerDoc = {
      openapi: '3.0.1',
      info: { title: 'demo', version: '1.0.0' },
      tags: [
        { name: 'users', 'x-order': 10 },
        { name: 'pets', 'x-order': '10' },
        { name: 'reports', 'x-order': 'invalid' },
        { name: 'audit', 'x-order': 'NaN' },
      ],
      paths: {
        '/users/search': {
          get: {
            tags: ['users'],
            summary: 'Search users',
            operationId: 'searchUsers',
            'x-order': 20,
          },
        },
        '/users/create': {
          post: {
            tags: ['users'],
            summary: 'Create user',
            operationId: 'createUser',
            'x-order': '20',
          },
        },
        '/users/export': {
          get: {
            tags: ['users'],
            summary: 'Export users',
            operationId: 'exportUsers',
            'x-order': 'invalid',
          },
        },
        '/users/import': {
          post: {
            tags: ['users'],
            summary: 'Import users',
            operationId: 'importUsers',
            'x-order': 'NaN',
          },
        },
      },
    };

    const menuTags = parseMenuTags(doc);

    expect(menuTags.map((tag) => tag.tag)).toEqual(['users', 'pets', 'reports', 'audit']);
    expect(menuTags[0].operations.map((operation) => operation.operationId)).toEqual([
      'searchUsers',
      'createUser',
      'exportUsers',
      'importUsers',
    ]);
  });

  it('preserves source order when Knife4j x-order and sorter options are absent', () => {
    const doc: SwaggerDoc = {
      openapi: '3.0.1',
      info: { title: 'demo', version: '1.0.0' },
      tags: [{ name: 'users' }, { name: 'pets' }],
      paths: {
        '/z-users': {
          get: {
            tags: ['users'],
            summary: 'List users',
            operationId: 'listUsers',
          },
        },
        '/a-users': {
          post: {
            tags: ['users'],
            summary: 'Create user',
            operationId: 'createUser',
          },
        },
      },
    };

    const menuTags = parseMenuTags(doc);

    expect(menuTags.map((tag) => tag.tag)).toEqual(['users', 'pets']);
    expect(menuTags[0].operations.map((operation) => operation.operationId)).toEqual(['listUsers', 'createUser']);
  });

  it('filters same-path multi-method operations to the configured method', () => {
    const doc: SwaggerDoc = {
      openapi: '3.0.1',
      info: { title: 'demo', version: '1.0.0' },
      tags: [{ name: 'files' }],
      paths: {
        '/files/upload': {
          get: {
            tags: ['files'],
            summary: 'Read upload endpoint',
            operationId: 'readUpload',
          },
          post: {
            tags: ['files'],
            summary: 'Upload file',
            operationId: 'uploadFile',
          },
          put: {
            tags: ['files'],
            summary: 'Replace upload',
            operationId: 'replaceUpload',
          },
        },
        '/files/status': {
          get: {
            tags: ['files'],
            summary: 'Upload status',
            operationId: 'uploadStatus',
          },
        },
      },
    };

    const menuTags = parseMenuTags(doc, {
      filterMultipartApis: true,
      filterMultipartApiMethodType: 'POST',
    });

    expect(menuTags[0].operations.map((operation) => operation.operationId)).toEqual(['uploadFile', 'uploadStatus']);
    expect(menuTags[0].operations.map((operation) => operation.method)).toEqual(['post', 'get']);
  });

  it('falls back to the first same-path operation when the configured filter method is absent', () => {
    const doc: SwaggerDoc = {
      openapi: '3.0.1',
      info: { title: 'demo', version: '1.0.0' },
      tags: [{ name: 'files' }],
      paths: {
        '/files/upload': {
          get: {
            tags: ['files'],
            summary: 'Read upload endpoint',
            operationId: 'readUpload',
          },
          put: {
            tags: ['files'],
            summary: 'Replace upload',
            operationId: 'replaceUpload',
          },
        },
      },
    };

    const menuTags = parseMenuTags(doc, {
      filterMultipartApis: true,
      filterMultipartApiMethodType: 'POST',
    });

    expect(menuTags[0].operations.map((operation) => operation.operationId)).toEqual(['readUpload']);
    expect(menuTags[0].operations.map((operation) => operation.method)).toEqual(['get']);
  });

  it('falls back to configured sorters when Knife4j x-order is absent', () => {
    const doc: SwaggerDoc = {
      openapi: '3.0.1',
      info: { title: 'demo', version: '1.0.0' },
      tags: [{ name: 'users' }, { name: 'pets' }],
      paths: {
        '/z-users': {
          get: {
            tags: ['users'],
            summary: 'List users',
            operationId: 'listUsers',
          },
        },
        '/a-users': {
          post: {
            tags: ['users'],
            summary: 'Create user',
            operationId: 'createUser',
          },
        },
      },
    };

    const menuTags = parseMenuTags(doc, { tagsSorter: 'alpha', operationsSorter: 'alpha' });

    expect(menuTags.map((tag) => tag.tag)).toEqual(['pets', 'users']);
    expect(menuTags[1].operations.map((operation) => operation.operationId)).toEqual(['createUser', 'listUsers']);
  });

  it('parses TRACE paths and OAS 3.1 webhook operations while ignoring Path Item metadata', () => {
    const doc = {
      openapi: '3.1.1',
      info: { title: 'Events', version: '1.0.0' },
      paths: {
        '/diagnostics': {
          summary: 'metadata only',
          parameters: [{ name: 'requestId', in: 'query' }],
          trace: {
            tags: ['diagnostics'],
            operationId: 'traceDiagnostics',
            summary: 'Trace diagnostics',
          },
        },
      },
      webhooks: {
        petChanged: { $ref: '#/components/pathItems/Pet%20ChangedAlias' },
      },
      components: {
        pathItems: {
          'Pet ChangedAlias': { $ref: '#/components/pathItems/Pet%20Changed' },
          'Pet Changed': {
            post: {
              tags: ['events'],
              operationId: 'petChanged',
              summary: 'Pet changed',
            },
          },
        },
      },
    } as SwaggerDoc;

    const menuTags = parseMenuTags(doc);
    const trace = menuTags.find((tag) => tag.tag === 'diagnostics')?.operations[0];
    const webhook = menuTags.find((tag) => tag.tag === 'events')?.operations[0];

    expect(trace).toMatchObject({ method: 'trace', source: 'path', routeId: 'traceDiagnostics' });
    expect(webhook).toMatchObject({
      path: 'petChanged',
      method: 'post',
      source: 'webhook',
      routeId: 'webhook:petChanged',
    });
    expect(menuTags.flatMap((tag) => tag.operations)).toHaveLength(2);
  });

  it('accepts a webhook-only OAS 3.1 document with no paths field', () => {
    const doc = {
      openapi: '3.1.1',
      info: { title: 'Webhook only', version: '1.0.0' },
      webhooks: {
        invoicePaid: {
          post: { summary: 'Invoice paid' },
        },
      },
    } as SwaggerDoc;

    expect(parseMenuTags(doc)[0].operations[0]).toMatchObject({ source: 'webhook', path: 'invoicePaid' });
  });

  it('uses distinct routes for webhook methods without operationId', () => {
    const doc = {
      openapi: '3.1.2',
      info: { title: 'Webhook routes', version: '1.0.0' },
      webhooks: {
        changed: {
          post: { summary: 'Changed by POST' },
          put: { summary: 'Changed by PUT' },
        },
      },
    } as SwaggerDoc;

    expect(parseMenuTags(doc)[0].operations.map((operation) => operation.routeId)).toEqual([
      'webhook:post:changed',
      'webhook:put:changed',
    ]);
  });

  it('qualifies fallback routes only when path methods collide in the same tag', () => {
    const doc = {
      openapi: '3.1.2',
      info: { title: 'Path routes', version: '1.0.0' },
      paths: {
        '/diagnostics': {
          get: { tags: ['diagnostics'], summary: 'Read diagnostics' },
          trace: { tags: ['diagnostics'], summary: 'Trace diagnostics' },
        },
        '/health': {
          get: { tags: ['diagnostics'], summary: 'Read health' },
        },
      },
    } as SwaggerDoc;

    expect(parseMenuTags(doc)[0].operations.map((operation) => operation.routeId)).toEqual([
      'get:/diagnostics',
      'trace:/diagnostics',
      '/health',
    ]);
  });

  it('disambiguates valid path and webhook identities that collide across sources', () => {
    const doc = {
      openapi: '3.1.2',
      info: { title: 'Cross-source routes', version: '1.0.0' },
      paths: {
        '/changed': {
          get: { tags: ['events'], operationId: 'webhook:changed' },
        },
      },
      webhooks: {
        changed: {
          post: { tags: ['events'], operationId: 'changed' },
        },
      },
    } as SwaggerDoc;

    expect(parseMenuTags(doc)[0].operations.map((operation) => operation.routeId)).toEqual([
      'path:get:/changed',
      'webhook:post:changed',
    ]);
  });
});
