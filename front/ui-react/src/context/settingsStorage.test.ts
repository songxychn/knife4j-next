import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../types/settings';
import { readSettingsOverrides, SETTINGS_STORAGE_VERSION } from './settingsStorage';

describe('stored settings language', () => {
  it.each([
    ['current', { version: SETTINGS_STORAGE_VERSION, overrides: { language: 'fr-FR' } }],
    ['legacy', { language: 'fr-FR' }],
  ])('drops an unsupported %s language override', (_format, stored) => {
    expect(readSettingsOverrides(stored).language).toBeUndefined();
  });

  it.each([
    ['current', { version: SETTINGS_STORAGE_VERSION, overrides: { language: 'ja_JP' } }],
    ['legacy', { language: 'ja_JP' }],
  ])('canonicalizes a supported %s language alias', (_format, stored) => {
    expect(readSettingsOverrides(stored).language).toBe('ja-JP');
  });

  it('does not turn the legacy default language into an explicit override', () => {
    expect(readSettingsOverrides({ ...DEFAULT_SETTINGS, language: 'zh-CN' })).toEqual({});
  });
});
