import React, { createContext, useContext, useState } from 'react';

const STORAGE_KEY = 'Knife4jGlobalSettings';

export interface AppSettings {
  /** 是否启用 Host 覆盖 */
  enableHost: boolean;
  /** Host 覆盖文本（enableHost=true 时替换 baseUrl） */
  enableHostText: string;
  /** 是否开启请求参数缓存 */
  enableRequestCache: boolean;
  /** 是否开启动态参数 */
  enableDynamicParameter: boolean;
  /** 是否过滤 multipart/RequestMapping 接口，只展示指定 method 类型 */
  enableFilterMultipartApis: boolean;
  /** 过滤后保留的 method 类型（默认 POST） */
  enableFilterMultipartApiMethodType: string;
  /**
   * 预留钩子：增强模式（swaggerBootstrapUi）
   * 当前版本不对接，保持 false；未来可按需启用。
   */
  enableSwaggerBootstrapUi: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  enableHost: false,
  enableHostText: '',
  enableRequestCache: true,
  enableDynamicParameter: false,
  enableFilterMultipartApis: false,
  enableFilterMultipartApiMethodType: 'POST',
  enableSwaggerBootstrapUi: false,
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // 合并默认值以兼容旧存储缺字段的情况
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore quota errors
  }
}

interface SettingsContextValue {
  settings: AppSettings;
  setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  const setSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  };

  const resetSettings = () => {
    const next = { ...DEFAULT_SETTINGS };
    saveSettings(next);
    setSettings(next);
  };

  return (
    <SettingsContext.Provider value={{ settings, setSetting, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSettings = (): SettingsContextValue => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider');
  return ctx;
};
