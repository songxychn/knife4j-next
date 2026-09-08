import { collectOas32DocumentDiagnostics } from '../openapi32';

const document = (paths: unknown, servers?: unknown) => ({
  openapi: '3.2.0',
  info: { title: 'Metadata diagnostics', version: '1' },
  paths,
  ...(servers === undefined ? {} : { servers }),
});

describe('OAS 3.2 metadata diagnostics at document boundaries', () => {
  test('checks path grammar and conflicts only on entry Paths keys, leaving opaque data untouched', () => {
    const doc = document({ '/pets/{id}': {}, '/pets/{name}': {}, '/bad?query': {}, 'x-data': { '/bad#fragment': {} } });
    expect(collectOas32DocumentDiagnostics(doc).map((item) => item.code)).toEqual([
      'template-query-or-fragment',
      'identical-templated-path',
    ]);
    expect(
      collectOas32DocumentDiagnostics({
        ...document({ '/pets/{?/#%雪}': {} }),
        webhooks: { 'named?hook': { get: {} } },
        components: { examples: { Literal: { value: { servers: [{ url: '/bad?query' }] } } } },
      }),
    ).toEqual([]);
  });
  test('checks all semantic Server fields including variable substitution, without rewriting raw input', () => {
    const doc = document({}, [
      { url: '/{stage}/{stage}', variables: { stage: { default: 'v1' } } },
      { url: '/{version}', variables: { version: { default: 'v1?bad' } } },
    ]);
    const before = JSON.stringify(doc);
    const diagnostics = collectOas32DocumentDiagnostics(doc);
    expect(
      diagnostics.some((item) => item.code === 'duplicate-template-variable' && item.path === '#/servers/0/url'),
    ).toBe(true);
    expect(
      diagnostics.some((item) => item.code === 'template-query-or-fragment' && item.path === '#/servers/1/url'),
    ).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
  });
  test('diagnoses ambiguous parent connections at original declaration indexes', () => {
    const diagnostics = collectOas32DocumentDiagnostics({
      ...document({}),
      tags: [null, { name: '' }, { name: '' }, { name: 'child', parent: '' }],
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'ambiguous-parent-tag', path: '#/tags/3/parent' }),
    );
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'duplicate-tag', path: '#/tags/2/name' }));
  });
});
