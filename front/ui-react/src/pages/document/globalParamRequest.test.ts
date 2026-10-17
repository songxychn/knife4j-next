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

  test.each([
    ["$['a,b']", 'a,b'],
    ["$['a\\'b']", "a'b"],
    ['$["a\\"b"]', 'a"b'],
    [String.raw`$['a\\b']`, String.raw`a\b`],
    ["$['a.b']", 'a.b'],
    ["$['中文']", '中文'],
  ])('extracts the literal property in %s', async (jsonPath, key) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ [key]: 'abc' })));

    await expect(fetchGlobalParamValue({ ...request, jsonPath }, 'https://example.com', 'omit', fetcher)).resolves.toBe(
      'Bearer abc',
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test.each([0, false, ''])('keeps a single scalar %j', async (value) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { token: value } })));

    await expect(fetchGlobalParamValue(request, 'https://example.com', 'omit', fetcher)).resolves.toBe(
      `Bearer ${String(value)}`,
    );
  });

  test.each([null, {}, []])('rejects a non-scalar %j', async (value) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { token: value } })));

    await expect(fetchGlobalParamValue(request, 'https://example.com', 'omit', fetcher)).rejects.toThrow(
      'JSONPath 结果必须是字符串、数字或布尔值',
    );
  });

  test.each(['$[0:0]', '$[1:1]'])('does not extract an element from the empty slice %s', async (jsonPath) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('[1,2]'));

    await expect(
      fetchGlobalParamValue({ ...request, jsonPath }, 'https://example.com', 'omit', fetcher),
    ).rejects.toThrow('JSONPath 没有匹配到值');
  });

  test('rejects multiple literal properties even when a name contains a comma', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ 'a,b': 'one', other: 'two' })));

    await expect(
      fetchGlobalParamValue({ ...request, jsonPath: "$['a,b','other']" }, 'https://example.com', 'omit', fetcher),
    ).rejects.toThrow('JSONPath 匹配到多个值');
  });

  test.each(['$[?(@.token)]', '$[(@.length-1)]'])('keeps expression evaluation disabled for %s', async (jsonPath) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('[{"token":"abc"}]'));

    await expect(
      fetchGlobalParamValue({ ...request, jsonPath }, 'https://example.com', 'omit', fetcher),
    ).rejects.toThrow(/Eval .* prevented in JSONPath expression/);
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
