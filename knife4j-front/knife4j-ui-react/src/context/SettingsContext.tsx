import React, { createContext, useContext, useState } from "react";

const STORAGE_KEY = "Knife4jGlobalSettings";

/**
 * 前端覆盖的 tag 排序策略。
 * - 'auto'：不覆盖，跟随后端 `/v3/api-docs/swagger-config` 的 `tagsSorter`；后端未配置时保持原序。
 * - 'alpha'：按字母序排序。
 * - 'preserve'：强制保持 OpenAPI JSON 的原始顺序（即使后端配置了 alpha）。
 */
export type TagsSorterOverride = "auto" | "alpha" | "preserve";
/**
 * 前端覆盖的 operation 排序策略。
 * - 'auto'：跟随后端 `operationsSorter`；后端未配置时保持原序。
 * - 'alpha'：按路径字母序。
 * - 'method'：按 HTTP method 顺序。
 * - 'preserve'：强制保持原序。
 */
export type OperationsSorterOverride = "auto" | "alpha" | "method" | "preserve";

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
  /** tag 排序覆盖（默认 'auto'：跟随 springdoc.swagger-ui.tags-sorter） */
  tagsSorter: TagsSorterOverride;
  /** operation 排序覆盖（默认 'auto'：跟随 springdoc.swagger-ui.operations-sorter） */
  operationsSorter: OperationsSorterOverride;
  /**
   * 预留钩子：增强模式（swaggerBootstrapUi）
   * 当前版本不对接，保持 false；未来可按需启用。
   */
  enableSwaggerBootstrapUi: boolean;
  /** 是否显示底部 Footer（false 时完全隐藏） */
  footerEnabled: boolean;
  /** 自定义 Footer 内容（非空时替换默认版权文本） */
  footerCustomContent: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  enableHost: false,
  enableHostText: "",
  enableRequestCache: true,
  enableDynamicParameter: false,
  enableFilterMultipartApis: false,
  enableFilterMultipartApiMethodType: "POST",
  tagsSorter: "auto",
  operationsSorter: "auto",
  enableSwaggerBootstrapUi: false,
  footerEnabled: true,
  footerCustomContent: "",
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
  setSetting: <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  const setSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
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
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
};
