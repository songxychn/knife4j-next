import { describe, expect, it } from 'vitest';

import { extractKnife4jSettings, extractMarkdownFiles } from './knife4jSettings';
import type { SwaggerDoc } from '../types/swagger';

function baseDoc(extra: Record<string, unknown>): SwaggerDoc {
  return {
    openapi: '3.0.0',
    info: { title: 'Demo', version: '1.0.0' },
    paths: {},
    ...extra,
  };
}

describe('knife4j setting extraction', () => {
  it('reads supported settings from x-openapi.x-setting', () => {
    const doc = baseDoc({
      'x-openapi': {
        'x-setting': {
          language: 'EN',
          enableSearch: false,
          enableDebug: false,
          enableOpenApi: false,
          enableSwaggerModels: false,
          swaggerModelName: 'Models',
          enableGroup: false,
          enableFooter: false,
          enableHost: true,
          enableHostText: 'http://localhost:9000',
          enableAfterScript: true,
        },
      },
    });

    expect(extractKnife4jSettings(doc)).toEqual({
      language: 'en-US',
      enableSearch: false,
      enableDebug: false,
      enableOpenApi: false,
      enableSwaggerModels: false,
      swaggerModelName: 'Models',
      enableGroup: false,
      enableFooter: false,
      enableHost: true,
      enableHostText: 'http://localhost:9000',
    });
  });

  it('keeps custom markdown docs compatible with nested and direct shapes', () => {
    expect(
      extractMarkdownFiles(
        baseDoc({
          'x-openapi': {
            'x-markdownFiles': [{ name: 'nested', children: [{ title: 'Nested' }] }],
          },
        }),
      ),
    ).toEqual([{ name: 'nested', children: [{ title: 'Nested' }] }]);

    expect(extractMarkdownFiles(baseDoc({ 'x-markdownFiles': [{ name: 'direct' }] }))).toEqual([{ name: 'direct' }]);
  });
});
