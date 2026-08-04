import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSwaggerDocForMode, loadInitialGroups } from './knife4xStartup';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function documentResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('Knife4x startup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps Java discovery when the global config is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ url: '/v3/api-docs' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadInitialGroups({ mode: 'java' }, 'zh-CN')).resolves.toEqual({
      mode: 'ready',
      groups: [{ name: 'default', url: '/v3/api-docs' }],
      swaggerUiConfig: { url: '/v3/api-docs' },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      'v3/api-docs/swagger-config',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Accept-Language': expect.stringMatching(/^zh-CN(?:,|$)/) }),
      }),
    );
  });

  it('preserves the aggregation route header from swagger-resources fallback', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            name: '用户中心',
            location: '/iam/v3/api-docs',
            swaggerVersion: '3.0',
            header: 'nacos-user-service',
          },
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadInitialGroups({ mode: 'java' })).resolves.toEqual({
      mode: 'ready',
      groups: [
        {
          name: '用户中心',
          url: '/iam/v3/api-docs',
          location: '/iam/v3/api-docs',
          swaggerVersion: '3.0',
          header: 'nacos-user-service',
        },
      ],
      swaggerUiConfig: null,
    });
  });

  it('creates one default group in Embed mode without Java discovery', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      loadInitialGroups(
        {
          mode: 'embed',
          config: { specUrl: 'https://example.com/docs/openapi.json', basePath: '/docs' },
        },
        'zh-CN',
      ),
    ).resolves.toEqual({
      mode: 'ready',
      groups: [{ name: 'default', url: 'https://example.com/docs/openapi.json' }],
      swaggerUiConfig: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed for an invalid Embed config without Java discovery', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(loadInitialGroups({ mode: 'error', error: 'bad config' }, 'zh-CN')).resolves.toEqual({
      mode: 'error',
      error: 'bad config',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts OpenAPI 3 documents in Embed mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          documentResponse({ openapi: '3.1.0', info: { title: 'demo', version: '1' }, paths: {} }),
        ),
    );

    const result = await fetchSwaggerDocForMode('/openapi.json', 'embed');

    expect(result.doc?.openapi).toBe('3.1.0');
    expect(result.error).toBeNull();
  });

  it('rejects Swagger 2 documents in Embed mode', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(documentResponse({ swagger: '2.0', info: { title: 'demo', version: '1' }, paths: {} })),
    );

    await expect(fetchSwaggerDocForMode('/swagger.json', 'embed')).resolves.toEqual({
      doc: null,
      error: { key: 'error.knife4x.openApi3Only' },
    });
  });
});
