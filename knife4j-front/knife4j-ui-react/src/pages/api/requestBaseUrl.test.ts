import { describe, expect, it } from 'vitest';
import type { SwaggerDoc } from '../../types/swagger';
import { normalizeRequestBaseUrl, resolveRequestBaseUrl } from './requestBaseUrl';

function docWithServers(urls: string[]): SwaggerDoc {
  return {
    openapi: '3.0.1',
    info: { title: 'test', version: '1.0.0' },
    paths: {},
    servers: urls.map((url) => ({ url })),
  };
}

describe('request base URL resolution', () => {
  it('uses the first OpenAPI server URL including context path', () => {
    expect(
      resolveRequestBaseUrl({
        swaggerDoc: docWithServers(['http://127.0.0.1:18000/api']),
        enableHost: false,
        enableHostText: '',
        origin: 'http://127.0.0.1:3002',
      }),
    ).toBe('http://127.0.0.1:18000/api');
  });

  it('resolves relative server URLs from the UI origin root', () => {
    expect(normalizeRequestBaseUrl('/api/', 'http://127.0.0.1:18000')).toBe('http://127.0.0.1:18000/api');
    expect(normalizeRequestBaseUrl('api', 'http://127.0.0.1:18000')).toBe('http://127.0.0.1:18000/api');
  });

  it('keeps the explicit host override ahead of OpenAPI servers', () => {
    expect(
      resolveRequestBaseUrl({
        swaggerDoc: docWithServers(['http://127.0.0.1:18000/api']),
        enableHost: true,
        enableHostText: 'http://gateway.example.test/root/',
        origin: 'http://127.0.0.1:3002',
      }),
    ).toBe('http://gateway.example.test/root');
  });

  it('falls back to the UI origin when no override or server is available', () => {
    expect(
      resolveRequestBaseUrl({
        swaggerDoc: docWithServers([]),
        enableHost: false,
        enableHostText: '',
        origin: 'http://127.0.0.1:3002',
      }),
    ).toBe('http://127.0.0.1:3002');
  });
});
