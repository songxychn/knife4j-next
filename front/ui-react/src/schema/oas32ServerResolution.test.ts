import { describe, expect, it } from 'vitest';
import { resolveOas32Server, selectOas32Servers } from './oas32ServerResolution';

const root = (value?: unknown) => ({
  ownerRetrievalUri: 'https://entry.test/spec/openapi.json',
  pointer: '#/servers',
  value,
});
const pathItem = (value: unknown) => ({
  ownerRetrievalUri: 'https://path.test/definitions/path.json',
  pointer: '#/components/pathItems/Pets/servers',
  value,
});
const operation = (value: unknown) => ({
  ownerRetrievalUri: 'http://operation.test/objects/operation.json',
  pointer: '#/query/servers',
  value,
});
const resolve = (url: string, variables?: unknown, values?: Record<string, unknown>) =>
  resolveOas32Server(selectOas32Servers({ root: root([{ url, variables }]) }).servers[0], values);

describe('OAS 3.2 effective Server lists with physical owners', () => {
  it('uses operation > Path Item > root without merging or deduplicating identical URLs', () => {
    const first = Object.freeze({ name: 'first', url: './v1' });
    const second = Object.freeze({ name: 'second', url: './v1' });
    const sources = {
      root: root([{ name: 'root', url: '/root' }]),
      pathItem: pathItem([{ name: 'path', url: '/path' }]),
      operation: operation([first, second]),
    };
    const selected = selectOas32Servers(sources);
    expect(selected.level).toBe('operation');
    expect(selected.source).toBe(sources.operation);
    expect(selected.servers).toHaveLength(2);
    expect(selected.servers[0].value).toBe(first);
    expect(selected.servers[1].value).toBe(second);
    expect(selected.servers[0].key).not.toBe(selected.servers[1].key);
    expect(selected.servers[0].pointer).toBe('#/query/servers/0');
    expect(selectOas32Servers({ root: sources.root, pathItem: sources.pathItem }).level).toBe('path-item');
    expect(selectOas32Servers({ root: sources.root }).level).toBe('root');
  });

  it('defaults only absent/empty root servers to / and retains explicit empty operation/path overrides', () => {
    for (const source of [root(), root([])]) {
      const selected = selectOas32Servers({ root: source });
      expect(selected.level).toBe('default');
      expect(selected.servers).toHaveLength(1);
      expect(resolveOas32Server(selected.servers[0])).toMatchObject({
        rawUrl: '/',
        resolvedUrl: 'https://entry.test/',
        executable: true,
      });
    }
    expect(selectOas32Servers({ root: root([{ url: '/root' }]), operation: operation([]) })).toMatchObject({
      level: 'operation',
      servers: [],
      diagnostics: [],
    });
    expect(selectOas32Servers({ root: root([{ url: '/root' }]), pathItem: pathItem([]) })).toMatchObject({
      level: 'path-item',
      servers: [],
      diagnostics: [],
    });
  });

  it('does not fall back after invalid highest-priority input', () => {
    const selected = selectOas32Servers({ root: root([{ url: '/root' }]), operation: operation(null) });
    expect(selected).toMatchObject({ level: 'operation', servers: [] });
    expect(selected.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-server-list', pointer: '#/query/servers' }),
    );
    const invalid = selectOas32Servers({ root: root([{ url: '/root' }]), operation: operation([{ url: '/bad?' }]) });
    expect(resolveOas32Server(invalid.servers[0])).toMatchObject({ valid: false, executable: false, rawUrl: '/bad?' });
    expect(resolveOas32Server(invalid.servers[0]).resolvedUrl).toBeUndefined();
  });

  it('resolves against each Server actual owner and does not implicitly upgrade HTTP', () => {
    const selected = selectOas32Servers({ root: root(), operation: operation([{ name: 'op', url: './v1' }]) });
    expect(resolveOas32Server(selected.servers[0])).toMatchObject({
      name: 'op',
      resolvedUrl: 'http://operation.test/objects/v1',
      requestUrl: 'http://operation.test/objects/v1',
      executable: true,
    });
    const fromPath = selectOas32Servers({ root: root(), pathItem: pathItem([{ url: './v1' }]) });
    expect(resolveOas32Server(fromPath.servers[0]).resolvedUrl).toBe('https://path.test/definitions/v1');
    // The caller passes E's actual owner; neither a $self URI nor a UI origin is accepted as another input.
    const named = { url: './test', name: 'same document', variables: { unused: { default: 'preserved' } } };
    const physical = selectOas32Servers({
      root: { ...root([named]), ownerRetrievalUri: 'https://device1.example.com' },
    });
    expect(resolveOas32Server(physical.servers[0]).resolvedUrl).toBe('https://device1.example.com/test');
    expect(physical.servers[0].value).toBe(named);
  });

  it('retains invalid entries and original diagnostics instead of filtering the list', () => {
    const raw = [{ url: ' /bad' }, { url: './good' }, null, { name: 'missing URL' }];
    const selected = selectOas32Servers({ root: root(raw) });
    expect(selected.servers).toHaveLength(4);
    expect(selected.servers.map((server) => resolveOas32Server(server)).map((result) => result.valid)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    expect(resolveOas32Server(selected.servers[2]).diagnostics[0]).toMatchObject({
      code: 'invalid-server-object',
      pointer: '#/servers/2',
    });
  });
});

describe('Server URL validity and browser execution are separate', () => {
  it('keeps raw template/defaults separate from substituted and resolved URLs', () => {
    const vars = {
      'tenant?name#': { default: 'api' },
      port: { default: '8443', enum: ['8443', '443'] },
      base: { default: 'v1' },
    };
    const result = resolve('https://{tenant?name#}.example.test:{port}/{base}', vars, { port: '443' });
    expect(result).toMatchObject({
      valid: true,
      executable: true,
      rawUrl: 'https://{tenant?name#}.example.test:{port}/{base}',
      substitutedUrl: 'https://api.example.test:443/v1',
      resolvedUrl: 'https://api.example.test:443/v1',
      requestUrl: 'https://api.example.test/v1',
    });
    expect(result.variables[0].definition).toBe(vars['tenant?name#']);
    expect(result.variables[1]).toMatchObject({ value: '443', valueSource: 'user' });
    expect(vars.port.default).toBe('8443');
  });

  it.each([
    'https://host?',
    'https://host#',
    'https://host/a?x=1',
    'https://host/#x',
    'https://host/%no',
    'https://host/has space',
    'https:\\host\\path',
    'http:host/path',
    'http:/host/path',
    'http:///path',
    'https://host:abc',
    'https://[invalid]/',
  ])('rejects %j before browser normalization can turn it into a URL', (url) => {
    const result = resolve(url);
    expect(result.valid).toBe(false);
    expect(result.executable).toBe(false);
    expect(result.rawUrl).toBe(url);
    expect(result.requestUrl).toBeUndefined();
  });

  it('allows legal percent encoding and Unicode literals without decoding reserved delimiters', () => {
    const encoded = resolve('https://host.test/v1/%3F%23%2F');
    expect(encoded).toMatchObject({
      valid: true,
      executable: true,
      substitutedUrl: 'https://host.test/v1/%3F%23%2F',
      resolvedUrl: 'https://host.test/v1/%3F%23%2F',
    });
    const unicode = resolve('https://例子.test/中文🧭');
    expect(unicode.valid).toBe(true);
    expect(unicode.executable).toBe(true);
    expect(unicode.substitutedUrl).toBe('https://例子.test/中文🧭');
    expect(unicode.requestUrl).toBe('https://xn--fsqu00a.test/%E4%B8%AD%E6%96%87%F0%9F%A7%AD');
  });

  it('uses a supplied whole-URL variable but never expands braces in a replacement again', () => {
    expect(resolve('{base}', { base: { default: 'http://host.test/v1' } })).toMatchObject({
      valid: true,
      resolvedUrl: 'http://host.test/v1',
    });
    expect(resolve('/{base}', { base: { default: '{nested}' }, nested: { default: 'v1' } }).valid).toBe(false);
    expect(resolve('/{base}', { base: { default: 'path?' } }).valid).toBe(false);
  });

  it('reports missing actual retrieval separately and still resolves an absolute Server', () => {
    const options = selectOas32Servers({
      root: { ...root([{ url: './v1' }, { url: 'https://host.test/v1' }]), ownerRetrievalUri: '' },
    });
    const relative = resolveOas32Server(options.servers[0]);
    expect(relative.valid).toBe(true);
    expect(relative.executable).toBe(false);
    expect(relative.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'server-retrieval-unavailable', category: 'unavailable' }),
    );
    expect(resolveOas32Server(options.servers[1]).executable).toBe(true);
  });

  it('preserves syntactically valid unsupported URLs with an explicit execution boundary', () => {
    for (const url of ['ftp://host.test/v1', 'https://user:pass@host.test/v1', 'https://host.test:99999/v1']) {
      const result = resolve(url);
      expect(result.valid).toBe(true);
      expect(result.resolvedUrl).toBeDefined();
      expect(result.executable).toBe(false);
      expect(result.requestUrl).toBeUndefined();
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ category: 'unsupported' }));
    }
  });
});
