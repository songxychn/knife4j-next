import { describe, expect, it, vi } from 'vitest';

import { normalizeSupportedLanguage, synchronizeI18nLanguage } from './language';

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

describe('synchronizeI18nLanguage', () => {
  it('waits for reset completion before rerunning language detection', () => {
    const changeLanguage = vi.fn();
    const i18n = { language: 'ja-JP', changeLanguage };

    synchronizeI18nLanguage(i18n, undefined, true);
    expect(changeLanguage).not.toHaveBeenCalled();

    synchronizeI18nLanguage(i18n, undefined, false);
    expect(changeLanguage).toHaveBeenCalledOnce();
    expect(changeLanguage).toHaveBeenCalledWith();
  });

  it('applies a configured language only when it differs from the live language', () => {
    const changeLanguage = vi.fn();
    const i18n = { language: 'en-US', changeLanguage };

    synchronizeI18nLanguage(i18n, 'en-US', false);
    expect(changeLanguage).not.toHaveBeenCalled();

    synchronizeI18nLanguage(i18n, 'ja-JP', false);
    expect(changeLanguage).toHaveBeenCalledWith('ja-JP');
  });
});
