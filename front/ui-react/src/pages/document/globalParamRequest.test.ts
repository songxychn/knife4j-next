import { describe, expect, test, vi } from 'vitest';
import { executeConfiguredRequest, fetchGlobalParamValue } from './globalParamRequest';

const request = {
  method: 'POST' as const,
  url: '/login',
  headers: '{"Content-Type":"application/json"}',
  body: '{"username":"demo"}',
  jsonPath: '$.data.token',
  prefix: 'Bearer ',
};

describe('global parameter request', () => {
  test('extracts one scalar with JSONPath and applies the prefix', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { token: 'abc' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(fetchGlobalParamValue(request, 'https://example.com/api', 'include', fetcher)).resolves.toBe(
      'Bearer abc',
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/api/login',
      expect.objectContaining({ credentials: 'include', method: 'POST' }),
    );
  });

  test('rejects ambiguous JSONPath results', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [{ token: 'a' }, { token: 'b' }] }), { status: 200 }));

    await expect(
      fetchGlobalParamValue({ ...request, jsonPath: '$.data[*].token' }, 'https://example.com', 'same-origin', fetcher),
    ).rejects.toThrow('JSONPath 匹配到多个值');
  });

  test('keeps Cookie handling in the browser credentials mode', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    await executeConfiguredRequest(request, 'https://example.com', 'include', fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      'https://example.com/login',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
