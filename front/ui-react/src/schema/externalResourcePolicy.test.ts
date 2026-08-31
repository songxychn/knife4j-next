import { describe, expect, test, vi } from 'vitest';
import {
  classifyExternalResourceMediaType,
  fetchExternalResource,
  normalizeExternalResourceUri,
  RESOURCE_ACCEPT_HEADER,
  ResourceLoadError,
} from './externalResourcePolicy';

describe('external resource URI and media policy', () => {
  test('normalizes an exact HTTP(S) identity without broadening its fragment', () => {
    expect(
      normalizeExternalResourceUri(
        '../schemas/pet.yaml?revision=1#/Pet',
        'https://docs.example.test/groups/openapi.yaml',
        'https://docs.example.test/doc.html',
      ),
    ).toBe('https://docs.example.test/schemas/pet.yaml?revision=1');
  });

  test('rejects URL credentials, unsupported schemes, and mixed content before fetch', () => {
    expect(() =>
      normalizeExternalResourceUri(
        'https://user:secret@schemas.example.test/pet.json',
        'https://docs.example.test/openapi.json',
      ),
    ).toThrow(expect.objectContaining({ code: 'RESOURCE_URI_CREDENTIALS_FORBIDDEN' }));
    expect(() =>
      normalizeExternalResourceUri('file:///tmp/pet.json', 'https://docs.example.test/openapi.json'),
    ).toThrow(expect.objectContaining({ code: 'RESOURCE_SCHEME_UNSUPPORTED' }));
    expect(() =>
      normalizeExternalResourceUri(
        'http://schemas.example.test/pet.json',
        'https://docs.example.test/openapi.json',
        'https://docs.example.test/doc.html',
      ),
    ).toThrow(expect.objectContaining({ code: 'RESOURCE_MIXED_CONTENT_BLOCKED' }));
  });

  test('accepts registered JSON/YAML media types and marks legacy YAML aliases', () => {
    expect(classifyExternalResourceMediaType('application/openapi+json; charset=utf-8')).toEqual({
      format: 'json',
      legacy: false,
      essence: 'application/openapi+json',
    });
    expect(classifyExternalResourceMediaType('application/yaml')).toEqual({
      format: 'yaml',
      legacy: false,
      essence: 'application/yaml',
    });
    expect(classifyExternalResourceMediaType('text/yaml')).toEqual({
      format: 'yaml',
      legacy: true,
      essence: 'text/yaml',
    });
    expect(() => classifyExternalResourceMediaType('text/plain')).toThrow(
      expect.objectContaining({ code: 'RESOURCE_CONTENT_TYPE_UNSUPPORTED' }),
    );
  });
});

describe('strict browser fetch contract', () => {
  test('performs no request without an exact authorization grant', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    await expect(
      fetchExternalResource('https://schemas.example.test/pet.json', 'https://docs.example.test/openapi.json', {
        pageUri: 'https://docs.example.test/doc.html',
        authorizedUris: new Set(),
        maxBytes: 1024,
        timeoutMs: 1000,
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LOADING_DISABLED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('does not copy query credentials into authorization errors', async () => {
    const secretUri = 'https://schemas.example.test/pet.json?token=super-secret';
    try {
      await fetchExternalResource(secretUri, 'https://docs.example.test/openapi.json', {
        pageUri: 'https://docs.example.test/doc.html',
        authorizedUris: new Set(['https://schemas.example.test/pet.json?token=another-value']),
        maxBytes: 1024,
        timeoutMs: 1000,
        fetchImpl: vi.fn(),
      });
      throw new Error('expected an authorization error');
    } catch (error) {
      expect(error).toMatchObject({ code: 'RESOURCE_NOT_AUTHORIZED' });
      expect(error instanceof Error ? error.message : String(error)).not.toContain('super-secret');
      expect(JSON.stringify((error as ResourceLoadError).details)).not.toContain('super-secret');
    }
  });

  test('pins credentials, redirects, referrer, cache, CORS, and the safelisted Accept header', async () => {
    const retrievalUri = 'https://schemas.example.test/pet.json';
    let observedInput: RequestInfo | URL | undefined;
    let observedInit: RequestInit | undefined;
    const result = await fetchExternalResource(`${retrievalUri}#/Pet`, 'https://docs.example.test/openapi.json', {
      pageUri: 'https://docs.example.test/doc.html',
      authorizedUris: new Set([retrievalUri]),
      maxBytes: 1024,
      timeoutMs: 1000,
      fetchImpl: async (input, init) => {
        observedInput = input;
        observedInit = init;
        return new Response('{"type":"string"}', {
          status: 200,
          headers: { 'content-type': 'application/schema+json' },
        });
      },
    });

    expect(result).toMatchObject({ retrievalUri, bytes: 17, mediaType: { format: 'json' } });
    expect(observedInput).toBe(retrievalUri);
    expect(observedInit).toMatchObject({
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    const headers = new Headers(observedInit?.headers);
    expect(headers.get('accept')).toBe(RESOURCE_ACCEPT_HEADER);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
  });

  test('requires a complete HTTP 200 response and valid UTF-8', async () => {
    const retrievalUri = 'https://schemas.example.test/pet.json';
    await expect(
      fetchExternalResource(retrievalUri, retrievalUri, {
        pageUri: retrievalUri,
        authorizedUris: new Set([retrievalUri]),
        maxBytes: 1024,
        timeoutMs: 1000,
        fetchImpl: async () =>
          new Response('{}', { status: 206, headers: { 'content-type': 'application/schema+json' } }),
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_HTTP_STATUS', details: { status: 206 } });

    await expect(
      fetchExternalResource(retrievalUri, retrievalUri, {
        pageUri: retrievalUri,
        authorizedUris: new Set([retrievalUri]),
        maxBytes: 1024,
        timeoutMs: 1000,
        fetchImpl: async () =>
          new Response(new Uint8Array([0xc3, 0x28]), {
            status: 200,
            headers: { 'content-type': 'application/schema+json' },
          }),
      }),
    ).rejects.toBeInstanceOf(ResourceLoadError);
  });

  test('aborts the complete request body at the fixed timeout with a stable diagnostic', async () => {
    vi.useFakeTimers();
    try {
      const retrievalUri = 'https://schemas.example.test/slow.json';
      const fetchImpl = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(new DOMException('aborted', 'AbortError'));
            if (init?.signal?.aborted) abort();
            else init?.signal?.addEventListener('abort', abort, { once: true });
          }),
      );
      const loading = fetchExternalResource(retrievalUri, retrievalUri, {
        pageUri: retrievalUri,
        authorizedUris: new Set([retrievalUri]),
        maxBytes: 1024,
        timeoutMs: 10,
        fetchImpl,
      });
      const rejected = expect(loading).rejects.toMatchObject({ code: 'RESOURCE_TIMEOUT' });

      await vi.advanceTimersByTimeAsync(11);
      await rejected;
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
