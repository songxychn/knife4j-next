import type { SupportedLang } from '../types/settings';

export const DEFAULT_LANGUAGE: SupportedLang = 'zh-CN';

/**
 * Convert browser and backend language variants to the resource tags supported
 * by the React UI. Unknown languages stay undefined so callers can preserve
 * i18next's normal fallback behavior.
 */
export function normalizeSupportedLanguage(value: unknown): SupportedLang | undefined {
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  const language = normalized.split('-', 1)[0];

  if (language === 'zh') return 'zh-CN';
  if (language === 'en') return 'en-US';
  if (language === 'ja') return 'ja-JP';
  return undefined;
}

export interface I18nLanguageController {
  readonly language: string;
  changeLanguage(language?: string): unknown;
}

/** Keep the live i18next language aligned with settings and completed storage resets. */
export function synchronizeI18nLanguage(
  i18n: I18nLanguageController,
  configuredLanguage: SupportedLang | undefined,
  resetActive: boolean,
): void {
  if (resetActive) return;
  if (configuredLanguage) {
    if (normalizeSupportedLanguage(i18n.language) !== configuredLanguage) {
      void i18n.changeLanguage(configuredLanguage);
    }
    return;
  }

  // Calling without a language reruns i18next-browser-languagedetector. This
  // restores the navigator/default language after reset removed the override.
  void i18n.changeLanguage();
}
