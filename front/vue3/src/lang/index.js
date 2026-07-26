import { createI18n } from 'vue-i18n'
import enLocale from './en';
import zhLocale from './zh';
import jpLocale from './jp';

export const messages = {
  'zh-CN': zhLocale,
  'en-US': enLocale,
  'ja-JP': jpLocale,
}

export const DEFAULT_LANGUAGE = 'zh-CN'
export const SUPPORTED_LANGUAGES = Object.freeze(Object.keys(messages))

export function normalizeLanguage(language) {
  return SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE
}

const i18n = createI18n({
  globalInjection: true, //全局生效$t
  locale: DEFAULT_LANGUAGE,
  messages,
  legacy: false,
})

export function setupI18n(app) {
  app.use(i18n)
}
