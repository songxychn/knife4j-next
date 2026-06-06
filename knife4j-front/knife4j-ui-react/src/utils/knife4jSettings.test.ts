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
          enableGroup: false,
          enableFooter: false,
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
      enableHomeCustom: true,
      homeCustomLocation: '# Custom Home\n\nWelcome to Knife4j.',
      enableSwaggerModels: false,
      swaggerModelName: 'Models',
      enableGroup: false,
      enableFooter: false,
      enableHost: true,
      enableHostText: 'http://localhost:9000',
      enableRequestCache: false,
    });
  });

  it('ignores invalid setting value types', () => {
    const doc = baseDoc({
      'x-openapi': {
        'x-setting': {
          enableRequestCache: 'false',
          enableHomeCustom: 'true',
          homeCustomLocation: 123,
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
