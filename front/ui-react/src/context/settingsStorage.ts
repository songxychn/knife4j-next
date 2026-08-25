import { DEFAULT_LANGUAGE, normalizeSupportedLanguage } from '../locales/language';
import { DEFAULT_SETTINGS, type AppSettings } from '../types/settings';

export const SETTINGS_STORAGE_VERSION = 2;

export type SettingsOverrides = Partial<AppSettings>;

export function resolveAppSettings(serverSettings: SettingsOverrides, userOverrides: SettingsOverrides): AppSettings {
  return { ...DEFAULT_SETTINGS, ...serverSettings, ...userOverrides };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeOverrides(value: unknown): SettingsOverrides {
  if (!isRecord(value)) return {};

  const overrides = { ...value } as SettingsOverrides;
  const language = normalizeSupportedLanguage(value.language);
  if (language) {
    overrides.language = language;
  } else {
    delete overrides.language;
  }
  return overrides;
}

function migrateLegacyOverrides(value: unknown): SettingsOverrides {
  if (!isRecord(value)) return {};

  const sanitized = sanitizeOverrides(value);
  const overrides: SettingsOverrides = {};
  if (sanitized.language && sanitized.language !== DEFAULT_LANGUAGE) {
    overrides.language = sanitized.language;
  }

  (Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>).forEach((key) => {
    const setting = sanitized[key];
    if (setting !== undefined && setting !== DEFAULT_SETTINGS[key]) {
      overrides[key] = setting as never;
    }
  });
  return overrides;
}

export function readSettingsOverrides(value: unknown): SettingsOverrides {
  if (isRecord(value) && value.version === SETTINGS_STORAGE_VERSION && isRecord(value.overrides)) {
    return sanitizeOverrides(value.overrides);
  }
  return migrateLegacyOverrides(value);
}
