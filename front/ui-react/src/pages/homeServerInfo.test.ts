import { describe, expect, it } from 'vitest';
import type { SwaggerDoc } from '../types/swagger';
import { normalizeHomeHost, resolveHomeHostLabel, resolveHomeServers } from './homeServerInfo';

function docWithServers(urls: Array<{ url: string; description?: string }>): SwaggerDoc {
  return {
    openapi: '3.0.1',
    info: { title: 'test', version: '1.0.0' },
    paths: {},
    servers: urls,
  };
}

describe('home server info', () => {
  it('keeps the HTTPS origin protocol and port for same-host generated server URLs', () => {
    const origin = 'https://mini.xxx.com:27000';
    const swaggerDoc = docWithServers([{ url: 'http://mini.xxx.com', description: 'Generated server url' }]);

    const servers = resolveHomeServers(swaggerDoc, origin);

    expect(servers).toEqual([{ url: 'https://mini.xxx.com:27000', description: 'Generated server url' }]);
    expect(resolveHomeHostLabel(swaggerDoc, servers, origin)).toBe('mini.xxx.com:27000');
  });

  it('preserves explicit same-host server ports while upgrading protocol', () => {
    const servers = resolveHomeServers(
      docWithServers([{ url: 'http://mini.xxx.com:18080/api' }]),
      'https://mini.xxx.com:27000',
    );

    expect(servers[0].url).toBe('https://mini.xxx.com:18080/api');
  });

  it('does not replace explicit same-host default server ports with the HTTPS origin port', () => {
    const servers = resolveHomeServers(
      docWithServers([{ url: 'http://mini.xxx.com:443/api' }, { url: 'https://mini.xxx.com:443/api' }]),
      'https://mini.xxx.com:27000',
    );

    expect(servers.map((server) => server.url)).toEqual(['https://mini.xxx.com/api', 'https://mini.xxx.com/api']);
  });

  it('keeps cross-host server URLs unchanged', () => {
    const servers = resolveHomeServers(docWithServers([{ url: 'http://api.xxx.com' }]), 'https://mini.xxx.com:27000');

    expect(servers[0].url).toBe('http://api.xxx.com');
    expect(resolveHomeHostLabel(null, servers, 'https://mini.xxx.com:27000')).toBe('api.xxx.com');
  });

  it('adds the HTTPS origin port to same-host legacy Host labels when the port is missing', () => {
    expect(normalizeHomeHost('mini.xxx.com', 'https://mini.xxx.com:27000')).toBe('mini.xxx.com:27000');
  });

  it('keeps explicit same-host default legacy Host label ports', () => {
    expect(normalizeHomeHost('mini.xxx.com:443', 'https://mini.xxx.com:27000')).toBe('mini.xxx.com:443');
  });
});
