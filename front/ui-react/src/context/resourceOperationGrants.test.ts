import { describe, expect, test } from 'vitest';
import { sha256Hex } from '../apiChange/apiChangeTracker';
import { ExternalResourceLoader } from '../schema/externalResourceGraph';
import { resourceGrantsForOperation } from './resourceOperationGrants';

describe('external resource operation grants', () => {
  test('does not carry a load-once grant into the next operation', () => {
    const scope = 'document-scope';
    const remembered = new Set<string>();

    expect(resourceGrantsForOperation(scope, remembered, ['resource-a'])).toEqual([
      { documentScope: scope, resourceKey: 'resource-a', scope: 'generation' },
    ]);
    expect(resourceGrantsForOperation(scope, remembered, ['resource-b'])).toEqual([
      { documentScope: scope, resourceKey: 'resource-b', scope: 'generation' },
    ]);
  });

  test('keeps remembered grants separate and gives them document scope', () => {
    const scope = 'document-scope';

    expect(resourceGrantsForOperation(scope, new Set(['resource-a']), ['resource-a', 'resource-b'])).toEqual([
      { documentScope: scope, resourceKey: 'resource-a', scope: 'document' },
      { documentScope: scope, resourceKey: 'resource-b', scope: 'generation' },
    ]);
  });

  test('requests only the resource selected by each load-once operation', async () => {
    const entryUri = 'https://docs.knife4j.example/v3/api-docs';
    const a = 'https://schemas.example.test/a.json';
    const b = 'https://schemas.example.test/b.json';
    const requested: string[] = [];
    const loader = new ExternalResourceLoader(
      {
        openapi: '3.1.1',
        info: { title: 'Grant fixture', version: '1' },
        paths: {},
        components: { schemas: { A: { $ref: a }, B: { $ref: b } } },
      },
      entryUri,
      {
        pageUri: 'https://docs.knife4j.example/doc.html',
        fetchImpl: async (input) => {
          requested.push(String(input));
          return new Response('{"type":"string"}', {
            headers: { 'content-type': 'application/schema+json' },
          });
        },
      },
    );
    const remembered = new Set<string>();

    await loader.load(resourceGrantsForOperation(loader.documentScope, remembered, [sha256Hex(a)]));
    await loader.load(resourceGrantsForOperation(loader.documentScope, remembered, [sha256Hex(b)]));

    expect(requested).toEqual([a, b]);
  });
});
