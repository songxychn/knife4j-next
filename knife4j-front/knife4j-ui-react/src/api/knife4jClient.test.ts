import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSwaggerUiConfig, parseGroupsFromConfig } from './knife4jClient';

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('knife4jClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('discovers custom springdoc swagger-config through the Knife4j fallback endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({ swaggerConfigUrl: 'api/openapi/swagger-config' }))
      .mockResolvedValueOnce(jsonResponse({ url: '/api/openapi', tagsSorter: 'alpha' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSwaggerUiConfig()).resolves.toEqual({ url: '/api/openapi', tagsSorter: 'alpha' });
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'v3/api-docs/swagger-config');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'knife4j/swagger-config');
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'api/openapi/swagger-config');
  });

  it('uses the single springdoc url when swagger-config has no urls array', () => {
    expect(parseGroupsFromConfig({ url: '/api/openapi' })).toEqual([{ name: 'default', url: '/api/openapi' }]);
  });
});
