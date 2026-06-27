import { describe, expect, it } from 'vitest';

import { buildAcceptLanguageHeader } from './acceptLanguage';

describe('acceptLanguage', () => {
  it('keeps the browser default when no language is explicitly selected', () => {
    expect(buildAcceptLanguageHeader(undefined, ['zh-CN', 'en-US'])).toBeUndefined();
  });

  it('puts the selected language before the browser language order', () => {
    expect(buildAcceptLanguageHeader('en-US', ['zh-CN', 'en-US', 'ja-JP'])).toBe('en-US,zh-CN;q=0.9,ja-JP;q=0.8');
  });

  it('deduplicates language tags case-insensitively and ignores invalid tags', () => {
    expect(buildAcceptLanguageHeader('en-US', ['EN-us', 'zh-CN', 'zh-CN\r\nX-Debug: true', ''])).toBe(
      'en-US,zh-CN;q=0.9',
    );
  });
});
