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
          enableFooterCustom: true,
          footerCustomContent: 'Apache License 2.0 | [Knife4j](https://github.com/songxychn/knife4j-next)',
          enableHost: true,
          enableHostText: 'http://localhost:9000',
          enableRequestCache: false,
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
      enableFooterCustom: true,
      footerCustomContent: 'Apache License 2.0 | [Knife4j](https://github.com/songxychn/knife4j-next)',
      enableHost: true,
      enableHostText: 'http://localhost:9000',
      enableRequestCache: false,
    });
  });

  it('ignores invalid enableRequestCache values', () => {
    const doc = baseDoc({
      'x-openapi': {
        'x-setting': {
          enableRequestCache: 'false',
        },
      },
    });

    expect(extractKnife4jSettings(doc)).toEqual({});
  });

  it('ignores invalid custom footer values', () => {
    const doc = baseDoc({
      'x-openapi': {
        'x-setting': {
          enableFooterCustom: 'true',
          footerCustomContent: 42,
        },
      },
    });

    expect(extractKnife4jSettings(doc)).toEqual({});
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
