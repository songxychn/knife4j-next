import { describe, expect, it } from 'vitest';

import { normalizeSupportedLanguage } from './language';

describe('normalizeSupportedLanguage', () => {
  it.each([
    ['zh', 'zh-CN'],
    ['zh-CN', 'zh-CN'],
    ['ZH_cn', 'zh-CN'],
    ['zh-TW', 'zh-CN'],
    ['en', 'en-US'],
    ['en-US', 'en-US'],
    ['en_GB', 'en-US'],
    ['ja', 'ja-JP'],
    ['ja-JP', 'ja-JP'],
    ['ja_JP', 'ja-JP'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeSupportedLanguage(input)).toBe(expected);
  });

  it('leaves unsupported and invalid values unresolved', () => {
    expect(normalizeSupportedLanguage('fr-FR')).toBeUndefined();
    expect(normalizeSupportedLanguage('')).toBeUndefined();
    expect(normalizeSupportedLanguage(undefined)).toBeUndefined();
  });
});
