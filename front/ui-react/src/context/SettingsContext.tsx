import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { AppSettings } from '../types/settings';
import {
  readSettingsOverrides,
  resolveAppSettings,
  SETTINGS_STORAGE_VERSION,
  type SettingsOverrides,
} from './settingsStorage';

const STORAGE_KEY = 'Knife4jGlobalSettings';

interface StoredSettings {
  version: typeof SETTINGS_STORAGE_VERSION;
  overrides: SettingsOverrides;
}

function loadOverrides(): SettingsOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return readSettingsOverrides(parsed);
  } catch {
    return {};
  }
}

function saveOverrides(overrides: SettingsOverrides): void {
  try {
    const payload: StoredSettings = { version: SETTINGS_STORAGE_VERSION, overrides };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
}

function shallowEqualSettings(a: SettingsOverrides, b: SettingsOverrides): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const typedKey = key as keyof AppSettings;
    if (a[typedKey] !== b[typedKey]) return false;
  }
  return true;
}

interface SettingsContextValue {
  settings: AppSettings;
  userSettings: Partial<AppSettings>;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  resetSettings: () => void;
  setServerSettings: (settings: SettingsOverrides) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [serverSettings, setServerSettingsState] = useState<SettingsOverrides>({});
  const [userOverrides, setUserOverrides] = useState<SettingsOverrides>(loadOverrides);

  const settings = useMemo(() => resolveAppSettings(serverSettings, userOverrides), [serverSettings, userOverrides]);

  const setSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setUserOverrides((prev) => {
      const next = { ...prev, [key]: value };
      saveOverrides(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    saveOverrides({});
    setUserOverrides({});
  }, []);

  const setServerSettings = useCallback((next: SettingsOverrides) => {
    setServerSettingsState((prev) => (shallowEqualSettings(prev, next) ? prev : next));
  }, []);

  const value = useMemo(
    () => ({ settings, userSettings: userOverrides, setSetting, resetSettings, setServerSettings }),
    [settings, userOverrides, setSetting, resetSettings, setServerSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSettings = (): SettingsContextValue => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
};
