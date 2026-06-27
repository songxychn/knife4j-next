import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SwaggerDoc } from '../types/swagger';
import { fetchSwaggerDocResult, fetchSwaggerUiConfig, parseGroupsFromConfig, parseMenuTags } from './knife4jClient';

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

  it('preserves gateway route contextPath from swagger-config urls', () => {
    expect(
      parseGroupsFromConfig({
        urls: [{ name: '用户中心', url: '/iam/v3/api-docs', contextPath: '/iam' }],
      }),
    ).toEqual([{ name: '用户中心', url: '/iam/v3/api-docs', contextPath: '/iam' }]);
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

  it('rejects non OpenAPI JSON responses with a diagnostic message', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(textResponse(JSON.stringify({ error: 'not found' })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSwaggerDocResult('/v3/api-docs');

    expect(result.doc).toBeNull();
    expect(result.error).toContain('不是 OpenAPI/Swagger JSON 对象');
  });

  it('diagnoses Base64 encoded api-docs responses', async () => {
    const encoded = btoa(JSON.stringify({ openapi: '3.0.1', info: { title: 'demo', version: '1.0.0' }, paths: {} }));
    const fetchMock = vi.fn().mockResolvedValueOnce(textResponse(JSON.stringify(encoded)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSwaggerDocResult('/v3/api-docs');

    expect(result.doc).toBeNull();
    expect(result.error).toContain('Base64');
    expect(result.error).toContain('HttpMessageConverter');
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
});
