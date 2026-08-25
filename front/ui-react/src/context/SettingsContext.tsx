import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings } from '../types/settings';
import {
  KNIFE4J_STORAGE_KEYS,
  getKnife4jStorageItem,
  getKnife4jStorageResetSnapshot,
  setKnife4jStorageItem,
  subscribeKnife4jStorageReset,
  type Knife4jStorageResetSnapshot,
} from '../storage/knife4jStorage';
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
    const parsed = JSON.parse(raw) as unknown;
    return readSettingsOverrides(parsed);
  } catch {
    return {};
  }
}

function saveOverrides(overrides: SettingsOverrides): void {
  try {
    const payload: StoredSettings = { version: SETTINGS_STORAGE_VERSION, overrides };
    void setKnife4jStorageItem(localStorage, KNIFE4J_STORAGE_KEYS.settings, JSON.stringify(payload));
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
  storageResetSnapshot: Knife4jStorageResetSnapshot;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  resetSettings: () => void;
  setServerSettings: (settings: SettingsOverrides) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export interface SettingsMemoryState {
  resetGeneration: string;
  resetActive: boolean;
  overrides: SettingsOverrides;
}

// eslint-disable-next-line react-refresh/only-export-components
export function invalidateSettingsMemoryForReset(
  state: SettingsMemoryState,
  snapshot: Knife4jStorageResetSnapshot,
): SettingsMemoryState {
  if (state.resetGeneration === snapshot.generation && state.resetActive === snapshot.active) return state;
  if (state.resetGeneration !== snapshot.generation || snapshot.active) {
    return { resetGeneration: snapshot.generation, resetActive: snapshot.active, overrides: {} };
  }
  return { ...state, resetActive: false };
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const initialResetSnapshotRef = useRef<Knife4jStorageResetSnapshot | null>(null);
  if (initialResetSnapshotRef.current === null) {
    initialResetSnapshotRef.current = getKnife4jStorageResetSnapshot();
  }
  const initialResetSnapshot = initialResetSnapshotRef.current;
  const [serverSettings, setServerSettingsState] = useState<SettingsOverrides>({});
  const [userMemory, setUserMemory] = useState<SettingsMemoryState>(() => ({
    resetGeneration: initialResetSnapshot.generation,
    resetActive: initialResetSnapshot.active,
    overrides: initialResetSnapshot.active ? {} : loadOverrides(),
  }));

  const settings = useMemo(
    () => resolveAppSettings(serverSettings, userMemory.overrides),
    [serverSettings, userMemory.overrides],
  );
  const storageResetSnapshot = useMemo<Knife4jStorageResetSnapshot>(
    () => ({ generation: userMemory.resetGeneration, active: userMemory.resetActive }),
    [userMemory.resetActive, userMemory.resetGeneration],
  );

  useEffect(() => {
    const handleResetSnapshot = (snapshot: Knife4jStorageResetSnapshot) => {
      setUserMemory((current) => invalidateSettingsMemoryForReset(current, snapshot));
    };
    const unsubscribe = subscribeKnife4jStorageReset(handleResetSnapshot);
    handleResetSnapshot(getKnife4jStorageResetSnapshot());
    return unsubscribe;
  }, []);

  const setSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const snapshot = getKnife4jStorageResetSnapshot();
    setUserMemory((current) => {
      const invalidated = invalidateSettingsMemoryForReset(current, snapshot);
      if (snapshot.active || invalidated !== current) return invalidated;
      const next = { ...current.overrides, [key]: value };
      saveOverrides(next);
      return { ...current, overrides: next };
    });
  }, []);

  const resetSettings = useCallback(() => {
    const snapshot = getKnife4jStorageResetSnapshot();
    setUserMemory((current) => {
      const invalidated = invalidateSettingsMemoryForReset(current, snapshot);
      if (snapshot.active || invalidated !== current) return invalidated;
      saveOverrides({});
      return { ...current, overrides: {} };
    });
  }, []);

  const setServerSettings = useCallback((next: SettingsOverrides) => {
    setServerSettingsState((prev) => (shallowEqualSettings(prev, next) ? prev : next));
  }, []);

  const value = useMemo(
    () => ({
      settings,
      userSettings: userMemory.overrides,
      storageResetSnapshot,
      setSetting,
      resetSettings,
      setServerSettings,
    }),
    [settings, userMemory.overrides, storageResetSnapshot, setSetting, resetSettings, setServerSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSettings = (): SettingsContextValue => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
};
