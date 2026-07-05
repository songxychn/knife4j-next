import { describe, expect, it } from 'vitest';

import { extractKnife4jSettings, extractMarkdownFiles, getCustomHomeMarkdown } from './knife4jSettings';
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
          enableHomeCustom: true,
          homeCustomLocation: '# Custom Home\n\nWelcome to Knife4j.',
          enableSwaggerModels: false,
          swaggerModelName: 'Models',
          enableDocumentManage: false,
          enableGroup: false,
          enableFooter: false,
          enableFooterCustom: true,
          footerCustomContent: 'Apache License 2.0 | [Knife4j](https://github.com/songxychn/knife4j-next)',
          enableHost: true,
          enableHostText: 'http://localhost:9000',
          enableRequestCache: false,
          enableFilterMultipartApis: true,
          enableFilterMultipartApiMethodType: 'put',
          enableAfterScript: true,
        },
      },
    });

    expect(extractKnife4jSettings(doc)).toEqual({
      language: 'en-US',
      enableSearch: false,
      enableDebug: false,
      enableOpenApi: false,
      enableHomeCustom: true,
      homeCustomLocation: '# Custom Home\n\nWelcome to Knife4j.',
      enableSwaggerModels: false,
      swaggerModelName: 'Models',
      enableDocumentManage: false,
      enableGroup: false,
      enableFooter: false,
      enableFooterCustom: true,
      footerCustomContent: 'Apache License 2.0 | [Knife4j](https://github.com/songxychn/knife4j-next)',
      enableHost: true,
      enableHostText: 'http://localhost:9000',
      enableRequestCache: false,
      enableFilterMultipartApis: true,
      enableFilterMultipartApiMethodType: 'PUT',
    });
  });

  it('ignores invalid setting value types', () => {
    const doc = baseDoc({
      'x-openapi': {
        'x-setting': {
          enableRequestCache: 'false',
          enableHomeCustom: 'true',
          homeCustomLocation: 123,
          enableFilterMultipartApis: 'true',
          enableFilterMultipartApiMethodType: 'TRACE',
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

  it('selects custom home markdown only when enabled and non-empty', () => {
    expect(getCustomHomeMarkdown({ enableHomeCustom: true, homeCustomLocation: '# Home' })).toBe('# Home');
    expect(getCustomHomeMarkdown({ enableHomeCustom: true, homeCustomLocation: '   ' })).toBeUndefined();
    expect(getCustomHomeMarkdown({ enableHomeCustom: false, homeCustomLocation: '# Home' })).toBeUndefined();
  });
});
