import React, { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { i18n as I18n } from 'i18next';
import enUS from './locales/en-US';
import jaJP from './locales/ja-JP';
import zhCN from './locales/zh-CN';
import { normalizeSupportedLanguage, synchronizeI18nLanguage } from './locales/language';
import { KNIFE4J_STORAGE_KEYS } from './storage/knife4jStorage';
import type { SupportedLang } from './types/settings';

const resources = { 'zh-CN': zhCN, 'en-US': enUS, 'ja-JP': jaJP };
const originalLanguages = Object.getOwnPropertyDescriptor(navigator, 'languages');
let instance: I18n;
let initialLanguage: string | undefined;
let root: Root | undefined;
let container: HTMLDivElement | undefined;

function setBrowserLanguage(language: string) {
  Object.defineProperty(navigator, 'languages', { configurable: true, value: [language] });
}

beforeAll(async () => {
  localStorage.clear();
  setBrowserLanguage('ja-JP');
  localStorage.setItem(KNIFE4J_STORAGE_KEYS.language, 'en-US');
  instance = (await import('./i18n')).default;
  if (!instance.isInitialized) {
    await new Promise<void>((resolve) => {
      const initialized = () => {
        instance.off('initialized', initialized);
        resolve();
      };
      instance.on('initialized', initialized);
    });
  }
  initialLanguage = instance.resolvedLanguage;
});

beforeEach(async () => {
  localStorage.clear();
  setBrowserLanguage('ja-JP');
  await instance.changeLanguage('zh-CN');
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
  localStorage.clear();
});

afterAll(() => {
  if (originalLanguages) Object.defineProperty(navigator, 'languages', originalLanguages);
  else Reflect.deleteProperty(navigator, 'languages');
});

describe('real i18n resources and detection', () => {
  it('initializes from the existing stored preference before navigator', () => {
    expect(initialLanguage).toBe('en-US');
  });

  it.each([
    ['en_GB', 'ja-JP', 'en-US'],
    ['ZH_tw', 'en-US', 'zh-CN'],
    [null, 'ja-JP', 'ja-JP'],
    [null, 'en-GB', 'en-US'],
    [null, 'fr-FR', 'zh-CN'],
  ])('detects stored %s and navigator %s without writing a preference', async (stored, browser, expected) => {
    if (stored) localStorage.setItem(KNIFE4J_STORAGE_KEYS.language, stored);
    setBrowserLanguage(browser);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    await instance.changeLanguage();
    expect(instance.resolvedLanguage).toBe(expected);
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.language)).toBe(stored);
    expect(writes.mock.calls.some(([key]) => key === KNIFE4J_STORAGE_KEYS.language || key === 'i18nextLng')).toBe(
      false,
    );
  });

  it.each(Object.keys(resources) as SupportedLang[])(
    'preserves all static translations and interpolation in %s',
    async (language) => {
      await instance.changeLanguage(language);
      for (const [key, value] of Object.entries(resources[language])) {
        // Dynamic messages have dedicated interpolation assertions below; static strings must remain exact.
        if (!value.includes('{{')) expect(instance.t(key)).toBe(value);
      }
      const name = '<name>&';
      expect(instance.t('schema.example32.helpLabel', { name })).toBe(
        resources[language]['schema.example32.helpLabel'].replace('{{name}}', name),
      );
      expect(instance.t('missing.contract.key', { defaultValue: 'Fallback {{name}}', name })).toBe('Fallback <name>&');
    },
  );

  it('falls back to the existing Chinese resources for an unsupported language', async () => {
    await instance.changeLanguage('fr-FR');
    expect(instance.t('app.tab.home')).toBe(zhCN['app.tab.home']);
    expect(instance.resolvedLanguage).toBe('zh-CN');
  });
});

it('cleans up real subscriptions and settles language synchronization across StrictMode mounts, switches and reset', async () => {
  const listeners = new Set<Parameters<I18n['on']>[1]>();
  const on = instance.on.bind(instance);
  const off = instance.off.bind(instance);
  vi.spyOn(instance, 'on').mockImplementation((events, listener) => {
    if (events.split(' ').includes('languageChanged')) listeners.add(listener);
    return on(events, listener);
  });
  vi.spyOn(instance, 'off').mockImplementation((events, listener) => {
    if (events.split(' ').includes('languageChanged')) {
      if (listener) listeners.delete(listener);
      else listeners.clear();
    }
    return off(events, listener);
  });
  const synchronize = vi.fn(synchronizeI18nLanguage);
  let renders = 0;

  function Consumer({
    language,
    active = false,
    generation = 0,
  }: {
    language?: SupportedLang;
    active?: boolean;
    generation?: number;
  }) {
    const { t, i18n } = useTranslation();
    renders += 1;
    // Exercise App's existing dependencies against the real hook, including its returned instance identity.
    useEffect(() => {
      synchronize(i18n, language, active);
    }, [i18n, language, active, generation]);
    return <span lang={normalizeSupportedLanguage(i18n.language)}>{t('app.tab.home')}</span>;
  }

  const render = async (language?: SupportedLang, active = false, generation = 0) => {
    await act(async () =>
      root?.render(
        <StrictMode>
          <Consumer language={language} active={active} generation={generation} />
        </StrictMode>,
      ),
    );
  };

  for (let mount = 0; mount < 3; mount += 1) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    for (let round = 0; round < 3; round += 1) {
      for (const language of ['zh-CN', 'en-US', 'ja-JP'] as const) {
        localStorage.setItem(KNIFE4J_STORAGE_KEYS.language, language);
        await render(language);
        expect(container.querySelector('span')?.lang).toBe(language);
        expect(container.textContent).toBe(resources[language]['app.tab.home']);
        expect(listeners.size).toBe(1);
      }
    }
    await render(undefined, true, mount + 1);
    localStorage.removeItem(KNIFE4J_STORAGE_KEYS.language);
    setBrowserLanguage('en-GB');
    expect(instance.resolvedLanguage).toBe('ja-JP');
    await render(undefined, false, mount + 1);
    expect(instance.resolvedLanguage).toBe('en-US');
    expect(container.querySelector('span')?.lang).toBe('en-US');
    expect(container.textContent).toBe(enUS['app.tab.home']);
    expect(localStorage.getItem(KNIFE4J_STORAGE_KEYS.language)).toBeNull();
    expect(listeners.size).toBe(1);
    const settled = { renders, effects: synchronize.mock.calls.length };
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect({ renders, effects: synchronize.mock.calls.length }).toEqual(settled);

    await act(async () => root?.unmount());
    root = undefined;
    container.remove();
    container = undefined;
    expect(listeners.size).toBe(0);
    const unmountedRenders = renders;
    await act(async () => {
      await instance.changeLanguage('zh-CN');
    });
    expect(renders).toBe(unmountedRenders);
  }
});
