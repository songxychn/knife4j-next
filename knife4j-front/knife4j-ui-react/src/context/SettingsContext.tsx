import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DEFAULT_SETTINGS, type AppSettings } from '../types/settings';

const STORAGE_KEY = 'Knife4jGlobalSettings';
const STORAGE_VERSION = 2;

type SettingsOverrides = Partial<AppSettings>;

interface StoredSettings {
  version: typeof STORAGE_VERSION;
  overrides: SettingsOverrides;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function migrateLegacyOverrides(parsed: unknown): SettingsOverrides {
  if (!isRecord(parsed)) return {};
  const overrides: SettingsOverrides = {};
  (Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>).forEach((key) => {
    const value = parsed[key];
    if (value !== undefined && value !== DEFAULT_SETTINGS[key]) {
      overrides[key] = value as never;
    }
  });
  return overrides;
}

function loadOverrides(): SettingsOverrides {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed) && parsed.version === STORAGE_VERSION && isRecord(parsed.overrides)) {
      return parsed.overrides as SettingsOverrides;
    }
    return migrateLegacyOverrides(parsed);
  } catch {
    return {};
  }
}

function saveOverrides(overrides: SettingsOverrides): void {
  try {
    const payload: StoredSettings = { version: STORAGE_VERSION, overrides };
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
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  resetSettings: () => void;
  setServerSettings: (settings: SettingsOverrides) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [serverSettings, setServerSettingsState] = useState<SettingsOverrides>({});
  const [userOverrides, setUserOverrides] = useState<SettingsOverrides>(loadOverrides);

  const settings = useMemo(
    () => ({ ...DEFAULT_SETTINGS, ...serverSettings, ...userOverrides }),
    [serverSettings, userOverrides],
  );

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
    () => ({ settings, setSetting, resetSettings, setServerSettings }),
    [settings, setSetting, resetSettings, setServerSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSettings = (): SettingsContextValue => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
};
