import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchSwaggerUiConfig, parseGroupsFromConfig } from '../../front/ui-react/src/api/knife4jClient.ts';
import { resolveRequestBaseUrl } from '../../front/ui-react/src/pages/api/requestBaseUrl.ts';

const root = resolve(import.meta.dir, '../..');
for (const name of ['multiservice', 'static']) {
  const payload = JSON.parse(await readFile(resolve(root, `docs/snippets/deployment/${name}.json`), 'utf8'));
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
  };
  const config = await fetchSwaggerUiConfig();
  if (!config) throw new Error(`${name}: discovery failed`);
  const groups = parseGroupsFromConfig(config);
  if (groups.length !== 2 || JSON.stringify(calls) !== '["v3/api-docs/swagger-config"]') {
    throw new Error(`${name}: documented discovery must expose two groups at the default discovery URL`);
  }
  for (let index = 0; index < groups.length; index++) {
    if (groups[index].url !== payload.urls[index].url || groups[index].name !== payload.urls[index].name) {
      throw new Error(`${name}: group metadata lost`);
    }
    if (name === 'multiservice') {
      const baseUrl = resolveRequestBaseUrl({
        swaggerDoc: { openapi: '3.0.3', info: { title: 'test', version: '1' }, paths: {}, servers: [{ url: 'http://internal.invalid' }] },
        enableHost: false, enableHostText: '', groupContextPath: groups[index].contextPath, origin: 'https://docs.example.test',
      });
      if (baseUrl !== `https://docs.example.test${payload.urls[index].contextPath}`) {
        throw new Error(`${name}: documented gateway prefix does not control the actual request base URL`);
      }
    }
  }
}
console.log('Documented JSON discovery and request prefixes match the actual React implementation');
