import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';
import jaJP from './locales/ja-JP';
import { normalizeSupportedLanguage } from './locales/language';
import { KNIFE4J_STORAGE_KEYS } from './storage/knife4jStorage';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
      'ja-JP': { translation: jaJP },
    },
    fallbackLng: 'zh-CN',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: [],
      lookupLocalStorage: KNIFE4J_STORAGE_KEYS.language,
      convertDetectedLanguage: (language) => normalizeSupportedLanguage(language) ?? language,
    },
  });

export default i18n;
