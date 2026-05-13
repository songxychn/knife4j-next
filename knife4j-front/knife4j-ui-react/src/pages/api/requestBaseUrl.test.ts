import { describe, expect, it } from 'vitest';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import { normalizeRequestBaseUrl, resolveRequestBaseUrl } from './requestBaseUrl';

function docWithServers(urls: string[]): SwaggerDoc {
  return {
    openapi: '3.0.1',
    info: { title: 'test', version: '1.0.0' },
    paths: {},
    servers: urls.map((url) => ({ url })),
  };
}

function docWithServerLevels({
  root = [],
  path = [],
  operation = [],
}: {
  root?: string[];
  path?: string[];
  operation?: string[];
}): SwaggerDoc {
  return {
    openapi: '3.0.1',
    info: { title: 'test', version: '1.0.0' },
    paths: {
      '/pets': {
        servers: path.map((url) => ({ url })),
        get: {
          summary: 'List pets',
          responses: {},
          servers: operation.map((url) => ({ url })),
        },
      },
    },
    servers: root.map((url) => ({ url })),
  };
}

function petOperation(doc: SwaggerDoc): MenuOperation {
  return {
    key: 'Pets/listPets',
    path: '/pets',
    method: 'get',
    summary: 'List pets',
    operation: doc.paths['/pets'].get!,
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

  it('upgrades same-host OpenAPI server URLs when the UI is served over HTTPS', () => {
    expect(
      resolveRequestBaseUrl({
        swaggerDoc: docWithServers(['http://api.example.test/api/']),
        enableHost: false,
        enableHostText: '',
        origin: 'https://api.example.test',
      }),
    ).toBe('https://api.example.test/api');
  });

  it('keeps cross-host OpenAPI server URLs on their declared protocol', () => {
    expect(
      resolveRequestBaseUrl({
        swaggerDoc: docWithServers(['http://api.example.test/api']),
        enableHost: false,
        enableHostText: '',
        origin: 'https://docs.example.test',
      }),
    ).toBe('http://api.example.test/api');
  });

  it('resolves relative server URLs from the UI origin root', () => {
    expect(normalizeRequestBaseUrl('/api/', 'http://127.0.0.1:18000')).toBe('http://127.0.0.1:18000/api');
    expect(normalizeRequestBaseUrl('api', 'http://127.0.0.1:18000')).toBe('http://127.0.0.1:18000/api');
  });

  it('keeps the explicit host override ahead of OpenAPI servers', () => {
    const swaggerDoc = docWithServerLevels({
      root: ['http://root.example.test/api'],
      path: ['http://path.example.test/api'],
      operation: ['http://operation.example.test/api'],
    });

    expect(
      resolveRequestBaseUrl({
        swaggerDoc,
        operation: petOperation(swaggerDoc),
        enableHost: true,
        enableHostText: 'http://gateway.example.test/root/',
        origin: 'http://127.0.0.1:3002',
      }),
    ).toBe('http://gateway.example.test/root');
  });

  it('keeps the explicit host override protocol unchanged', () => {
    expect(
      resolveRequestBaseUrl({
        swaggerDoc: docWithServers(['https://api.example.test/api']),
        enableHost: true,
        enableHostText: 'http://api.example.test/custom/',
        origin: 'https://api.example.test',
      }),
    ).toBe('http://api.example.test/custom');
  });

  it('prefers operation-level servers ahead of path and root servers', () => {
    const swaggerDoc = docWithServerLevels({
      root: ['http://root.example.test/api'],
      path: ['http://path.example.test/api'],
      operation: ['http://operation.example.test/api'],
    });

    expect(
      resolveRequestBaseUrl({
        swaggerDoc,
        operation: petOperation(swaggerDoc),
        enableHost: false,
        enableHostText: '',
        origin: 'http://127.0.0.1:3002',
      }),
    ).toBe('http://operation.example.test/api');
  });

  it('uses path-level servers when the operation has no usable server', () => {
    const swaggerDoc = docWithServerLevels({
      root: ['http://root.example.test/api'],
      path: ['http://path.example.test/api'],
      operation: [''],
    });

    expect(
      resolveRequestBaseUrl({
        swaggerDoc,
        operation: petOperation(swaggerDoc),
        enableHost: false,
        enableHostText: '',
        origin: 'http://127.0.0.1:3002',
      }),
    ).toBe('http://path.example.test/api');
  });

  it('falls back to root servers when operation and path servers are unavailable', () => {
    const swaggerDoc = docWithServerLevels({
      root: ['http://root.example.test/api'],
    });

    expect(
      resolveRequestBaseUrl({
        swaggerDoc,
        operation: petOperation(swaggerDoc),
        enableHost: false,
        enableHostText: '',
        origin: 'http://127.0.0.1:3002',
      }),
    ).toBe('http://root.example.test/api');
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
