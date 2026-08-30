import { describe, expect, test } from 'bun:test';
import {
  classifyResourceMediaType,
  fetchAuthorizedResource,
  normalizeResourceDocumentUri,
  RESOURCE_ACCEPT_HEADER,
  ResourceLoadError,
} from '../src/resource-policy';

describe('resource URI policy', () => {
  test('normalizes an exact HTTP(S) document identity without its fragment', () => {
    expect(
      normalizeResourceDocumentUri(
        '../schemas/pet.yaml?revision=1#/Pet',
        'https://docs.example.test/groups/openapi.yaml',
        'https://docs.example.test/doc.html',
      ),
    ).toBe('https://docs.example.test/schemas/pet.yaml?revision=1');
  });

  test('rejects URL credentials, file resources, and HTTPS-to-HTTP downgrade', () => {
    expect(() =>
      normalizeResourceDocumentUri(
        'https://user:secret@schemas.example.test/pet.json',
        'https://docs.example.test/openapi.json',
      ),
    ).toThrow(ResourceLoadError);
    expect(() => normalizeResourceDocumentUri('file:///tmp/pet.json', 'https://docs.example.test/openapi.json')).toThrow(
      expect.objectContaining({ code: 'RESOURCE_SCHEME_UNSUPPORTED' }),
    );
    expect(() =>
      normalizeResourceDocumentUri(
        'http://schemas.example.test/pet.json',
        'https://docs.example.test/openapi.json',
        'https://docs.example.test/doc.html',
      ),
    ).toThrow(expect.objectContaining({ code: 'RESOURCE_MIXED_CONTENT_BLOCKED' }));
  });
});

describe('document media types', () => {
  test('accepts registered JSON/YAML types and structured suffixes', () => {
    expect(classifyResourceMediaType('application/openapi+json; charset=utf-8')).toEqual({
      format: 'json',
      legacy: false,
      essence: 'application/openapi+json',
    });
    expect(classifyResourceMediaType('application/yaml')).toEqual({
      format: 'yaml',
      legacy: false,
      essence: 'application/yaml',
    });
    expect(classifyResourceMediaType('application/vnd.example+yaml')).toEqual({
      format: 'yaml',
      legacy: false,
      essence: 'application/vnd.example+yaml',
    });
  });

  test('marks deprecated YAML aliases and rejects sniffing unknown bodies', () => {
    expect(classifyResourceMediaType('text/yaml')).toEqual({
      format: 'yaml',
      legacy: true,
      essence: 'text/yaml',
    });
    expect(() => classifyResourceMediaType('text/plain')).toThrow(
      expect.objectContaining({ code: 'RESOURCE_CONTENT_TYPE_UNSUPPORTED' }),
    );
    expect(() => classifyResourceMediaType(null)).toThrow(
      expect.objectContaining({ code: 'RESOURCE_CONTENT_TYPE_UNSUPPORTED' }),
    );
  });
});

describe('strict browser fetch contract', () => {
  test('does not issue a request without an exact authorization grant', async () => {
    let requests = 0;
    await expect(
      fetchAuthorizedResource('https://schemas.example.test/pet.json#Pet', 'https://docs.example.test/openapi.json', {
        pageUri: 'https://docs.example.test/doc.html',
        authorizedUris: new Set(),
        maxBytes: 1024,
        timeoutMs: 1000,
        fetchImpl: async () => {
          requests += 1;
          return new Response('{}', { headers: { 'content-type': 'application/json' } });
        },
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LOADING_DISABLED' });
    expect(requests).toBe(0);
  });

  test('pins fetch options that prevent ambient authority and redirects', async () => {
    const retrievalUri = 'https://schemas.example.test/pet.json';
    let observedInput: RequestInfo | URL | undefined;
    let observedInit: RequestInit | undefined;
    const result = await fetchAuthorizedResource(`${retrievalUri}#/Pet`, 'https://docs.example.test/openapi.json', {
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

  test('rejects partial HTTP responses because they are not complete documents', async () => {
    const retrievalUri = 'https://schemas.example.test/pet.json';

    await expect(
      fetchAuthorizedResource(retrievalUri, 'https://docs.example.test/openapi.json', {
        pageUri: 'https://docs.example.test/doc.html',
        authorizedUris: new Set([retrievalUri]),
        maxBytes: 1024,
        timeoutMs: 1000,
        fetchImpl: async () =>
          new Response('{"type":"string"}', {
            status: 206,
            headers: { 'content-type': 'application/schema+json' },
          }),
      }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_HTTP_STATUS',
      details: { status: 206 },
    });
  });

  test('cancels an unsupported response body before returning its diagnostic', async () => {
    const retrievalUri = 'https://schemas.example.test/pet.txt';
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      fetchAuthorizedResource(retrievalUri, 'https://docs.example.test/openapi.json', {
        pageUri: 'https://docs.example.test/doc.html',
        authorizedUris: new Set([retrievalUri]),
        maxBytes: 1024,
        timeoutMs: 1000,
        fetchImpl: async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-type': 'text/plain' },
          }),
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONTENT_TYPE_UNSUPPORTED' });
    expect(cancelled).toBe(true);
  });
});
