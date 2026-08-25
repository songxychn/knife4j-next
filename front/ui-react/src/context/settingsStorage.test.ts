import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../types/settings';
import { readSettingsOverrides, resolveAppSettings, SETTINGS_STORAGE_VERSION } from './settingsStorage';

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

describe('effective settings resolution', () => {
  it('defaults response status summaries to visible', () => {
    expect(resolveAppSettings({}, {}).enableResponseCode).toBe(true);
  });

  it('applies the server value and keeps a local override at higher priority', () => {
    expect(resolveAppSettings({ enableResponseCode: false }, {}).enableResponseCode).toBe(false);
    expect(resolveAppSettings({ enableResponseCode: false }, { enableResponseCode: true }).enableResponseCode).toBe(
      true,
    );
  });
});
