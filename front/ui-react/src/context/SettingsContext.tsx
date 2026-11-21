import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { AppSettings } from '../types/settings';
import { KNIFE4J_STORAGE_KEYS, getKnife4jStorageItem, setKnife4jStorageItem } from '../storage/knife4jStorage';
import {
  readSettingsOverrides,
  resolveAppSettings,
  SETTINGS_STORAGE_VERSION,
  type SettingsOverrides,
} from './settingsStorage';

interface StoredSettings {
  version: typeof SETTINGS_STORAGE_VERSION;
  overrides: SettingsOverrides;
}

function loadOverrides(): SettingsOverrides {
  try {
    const raw = getKnife4jStorageItem(localStorage, KNIFE4J_STORAGE_KEYS.settings);
    if (!raw) return {};
    return readSettingsOverrides(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

function saveOverrides(overrides: SettingsOverrides): boolean {
  try {
    const payload: StoredSettings = { version: SETTINGS_STORAGE_VERSION, overrides };
    return setKnife4jStorageItem(localStorage, KNIFE4J_STORAGE_KEYS.settings, JSON.stringify(payload));
  } catch {
    return false;
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
  persistenceFailed: boolean;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  resetSettings: () => void;
  setServerSettings: (settings: SettingsOverrides) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [serverSettings, setServerSettingsState] = useState<SettingsOverrides>({});
  const [overrides, setOverridesState] = useState<SettingsOverrides>(() => loadOverrides());
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const overridesRef = useRef(overrides);

  const settings = useMemo(() => resolveAppSettings(serverSettings, overrides), [serverSettings, overrides]);

  const setSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next: SettingsOverrides = { ...overridesRef.current, [key]: value };
    overridesRef.current = next;
    setOverridesState(next);
    setPersistenceFailed(!saveOverrides(next));
  }, []);

  const resetSettings = useCallback(() => {
    const next: SettingsOverrides = {};
    overridesRef.current = next;
    setOverridesState(next);
    setPersistenceFailed(!saveOverrides(next));
  }, []);

  const setServerSettings = useCallback((next: SettingsOverrides) => {
    setServerSettingsState((prev) => (shallowEqualSettings(prev, next) ? prev : next));
  }, []);

  const value = useMemo(
    () => ({
      settings,
      userSettings: overrides,
      persistenceFailed,
      setSetting,
      resetSettings,
      setServerSettings,
    }),
    [settings, overrides, persistenceFailed, setSetting, resetSettings, setServerSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSettings = (): SettingsContextValue => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
};
