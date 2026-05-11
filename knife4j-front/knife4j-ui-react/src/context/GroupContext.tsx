import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  fetchSwaggerDoc,
  fetchSwaggerUiConfig,
  getSchemas,
  normalizeOperationsSorter,
  normalizeTagsSorter,
  parseGroupsFromConfig,
  parseMenuTags,
  type OperationsSorter,
  type TagsSorter,
} from '../api/knife4jClient';
import type { MenuTag, SchemaObject, SwaggerDoc, SwaggerGroup, SwaggerUiConfig } from '../types/swagger';
import { extractKnife4jSettings, extractMarkdownFiles } from '../utils/knife4jSettings';
import { useSettings } from './SettingsContext';

// ---- 兼容旧接口的 ApiItem / ApiGroup 类型 ----

export interface ApiItem {
  key: string;
  method: string;
  path: string;
  summary: string;
  tag: string;
  operationId?: string;
  deprecated?: boolean;
}

export interface ApiGroup {
  value: string;
  label: string;
  apis: ApiItem[];
}

export interface MarkdownDocItem {
  key: string;
  title: string;
  content: string;
  groupName?: string;
  folderName?: string;
}

// ---- mock fallback（真实接口不可用时降级） ----

// ---- context 类型 ----

interface GroupContextValue {
  // group 列表（兼容旧接口）
  groups: ApiGroup[];
  activeGroup: ApiGroup;
  setActiveGroupValue: (value: string) => void;

  // 真实数据
  swaggerDoc: SwaggerDoc | null;
  swaggerUiConfig: SwaggerUiConfig | null;
  menuTags: MenuTag[];
  markdownDocs: MarkdownDocItem[];
  schemas: Record<string, SchemaObject>;
  loading: boolean;
  usingMock: boolean;
  /** 当前激活 group 的加载错误信息，null 表示无错误 */
  groupError: string | null;
}

const GroupContext = createContext<GroupContextValue | null>(null);

export const GroupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [rawGroups, setRawGroups] = useState<SwaggerGroup[]>([]);
  const [swaggerUiConfig, setSwaggerUiConfig] = useState<SwaggerUiConfig | null>(null);
  const [activeGroupValue, setActiveGroupValue] = useState<string>('');
  const [swaggerDoc, setSwaggerDoc] = useState<SwaggerDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const { settings, setServerSettings } = useSettings();

  // 初始化：优先拉取 swagger-config（拿到 tagsSorter / operationsSorter），失败回退到 swagger-resources
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const config = await fetchSwaggerUiConfig();
      if (cancelled) return;

      if (config) {
        setSwaggerUiConfig(config);
        const groups = parseGroupsFromConfig(config);
        if (groups.length > 0) {
          setRawGroups(groups);
          setActiveGroupValue(groups[0].name);
          return;
        }
      }

      // swagger-config 不可用 → 回退 springfox swagger-resources
      try {
        const res = await fetch('swagger-resources');
        if (res.ok) {
          const data: Array<{ name: string; location: string; swaggerVersion?: string }> = await res.json();
          const groups: SwaggerGroup[] = data.map((g) => ({
            name: g.name,
            url: g.location,
            swaggerVersion: g.swaggerVersion,
          }));
          if (groups.length > 0) {
            setRawGroups(groups);
            setActiveGroupValue(groups[0].name);
            return;
          }
        }
      } catch {
        /* ignore */
      }

      // 完全拿不到 → mock
      setUsingMock(true);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 切换 group 时拉取对应 api-docs
  useEffect(() => {
    if (usingMock || !activeGroupValue) return;
    const group = rawGroups.find((g) => g.name === activeGroupValue);
    if (!group) return;

    setLoading(true);
    setGroupError(null);
    fetchSwaggerDoc(group.url).then((doc) => {
      if (doc) {
        setSwaggerDoc(doc);
      } else {
        // 单个 provider 加载失败：保留其他 group 可用，仅标记当前 group 错误
        setSwaggerDoc(null);
        setGroupError('加载失败，请检查后端服务');
      }
      setLoading(false);
    });
  }, [activeGroupValue, rawGroups, usingMock]);

  useEffect(() => {
    setServerSettings(extractKnife4jSettings(swaggerDoc));
  }, [setServerSettings, swaggerDoc]);

  // 计算最终生效的排序策略：用户显式覆盖优先，否则跟随后端 swagger-config
  const effectiveTagsSorter: TagsSorter = useMemo(() => {
    if (settings.tagsSorter === 'alpha') return 'alpha';
    if (settings.tagsSorter === 'preserve') return 'preserve';
    // 'auto' → 跟随后端
    return normalizeTagsSorter(swaggerUiConfig?.tagsSorter);
  }, [settings.tagsSorter, swaggerUiConfig]);

  const effectiveOperationsSorter: OperationsSorter = useMemo(() => {
    if (settings.operationsSorter === 'alpha') return 'alpha';
    if (settings.operationsSorter === 'method') return 'method';
    if (settings.operationsSorter === 'preserve') return 'preserve';
    // 'auto' → 跟随后端
    return normalizeOperationsSorter(swaggerUiConfig?.operationsSorter);
  }, [settings.operationsSorter, swaggerUiConfig]);

  // 派生数据
  const menuTags: MenuTag[] = useMemo(
    () =>
      swaggerDoc
        ? parseMenuTags(swaggerDoc, {
            tagsSorter: effectiveTagsSorter,
            operationsSorter: effectiveOperationsSorter,
          })
        : [],
    [swaggerDoc, effectiveTagsSorter, effectiveOperationsSorter],
  );
  const schemas: Record<string, SchemaObject> = swaggerDoc ? getSchemas(swaggerDoc) : {};

  const markdownDocs: MarkdownDocItem[] = useMemo(() => {
    const markdownGroups = extractMarkdownFiles(swaggerDoc);
    return markdownGroups.flatMap((group, groupIndex) =>
      (group.children ?? []).map((item, itemIndex) => ({
        key: `/${activeGroupValue}/markdown/${groupIndex}/${itemIndex}`,
        title: item.title,
        content: item.content ?? '',
        groupName: group.group,
        folderName: group.name,
      })),
    );
  }, [activeGroupValue, swaggerDoc]);

  // 兼容旧接口：将真实数据转换为 ApiGroup[]
  // loading 期间 swaggerDoc 为 null → 返回空数组，让 UI 显示 loading
  const groups: ApiGroup[] = swaggerDoc
    ? rawGroups.map((g) => {
        const isActive = g.name === activeGroupValue;
        const apis: ApiItem[] = isActive
          ? menuTags.flatMap((t) =>
              t.operations.map((op) => ({
                key: `/${activeGroupValue}/${op.key}`,
                method: op.method.toUpperCase(),
                path: op.path,
                summary: op.summary,
                tag: t.tag,
                operationId: op.operationId,
                deprecated: op.deprecated,
              })),
            )
          : [];
        return { value: g.name, label: g.name, apis };
      })
    : [];

  // loading 期间 groups 为空，提供一个空占位对象，避免下游 .apis 报错
  const EMPTY_GROUP: ApiGroup = { value: '', label: '', apis: [] };
  const activeGroup = groups.find((g) => g.value === activeGroupValue) ?? groups[0] ?? EMPTY_GROUP;

  const handleSetActiveGroup = useCallback((value: string) => {
    setGroupError(null);
    setActiveGroupValue(value);
  }, []);

  return (
    <GroupContext.Provider
      value={{
        groups,
        activeGroup,
        setActiveGroupValue: handleSetActiveGroup,
        swaggerDoc,
        swaggerUiConfig,
        menuTags,
        markdownDocs,
        schemas,
        loading,
        usingMock,
        groupError,
      }}
    >
      {children}
    </GroupContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useGroup = (): GroupContextValue => {
  const ctx = useContext(GroupContext);
  if (!ctx) throw new Error('useGroup must be used inside GroupProvider');
  return ctx;
};
