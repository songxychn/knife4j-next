import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { fetchGroups, fetchSwaggerDoc, parseMenuTags, getSchemas } from '../api/knife4jClient';
import type { SwaggerGroup, SwaggerDoc, MenuTag, SchemaObject } from '../types/swagger';

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

// ---- mock fallback（真实接口不可用时降级） ----

import { MOCK_GROUPS } from '../data/mockGroups';

// ---- context 类型 ----

interface GroupContextValue {
  // group 列表（兼容旧接口）
  groups: ApiGroup[];
  activeGroup: ApiGroup;
  setActiveGroupValue: (value: string) => void;

  // 真实数据
  swaggerDoc: SwaggerDoc | null;
  menuTags: MenuTag[];
  schemas: Record<string, SchemaObject>;
  loading: boolean;
  usingMock: boolean;
}

const GroupContext = createContext<GroupContextValue | null>(null);

export const GroupProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [rawGroups, setRawGroups] = useState<SwaggerGroup[]>([]);
  const [activeGroupValue, setActiveGroupValue] = useState<string>('');
  const [swaggerDoc, setSwaggerDoc] = useState<SwaggerDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);

  // 初始化：拉取 group 列表
  useEffect(() => {
    fetchGroups().then((groups) => {
      if (groups.length > 0) {
        setRawGroups(groups);
        setActiveGroupValue(groups[0].name);
      } else {
        setUsingMock(true);
        setLoading(false);
      }
    });
  }, []);

  // 切换 group 时拉取对应 api-docs
  useEffect(() => {
    if (usingMock || !activeGroupValue) return;
    const group = rawGroups.find((g) => g.name === activeGroupValue);
    if (!group) return;

    setLoading(true);
    fetchSwaggerDoc(group.url).then((doc) => {
      if (doc) {
        setSwaggerDoc(doc);
      } else {
        setUsingMock(true);
      }
      setLoading(false);
    });
  }, [activeGroupValue, rawGroups, usingMock]);

  // 派生数据
  const menuTags: MenuTag[] = swaggerDoc ? parseMenuTags(swaggerDoc) : [];
  const schemas: Record<string, SchemaObject> = swaggerDoc ? getSchemas(swaggerDoc) : {};

  // 兼容旧接口：将真实数据转换为 ApiGroup[]
  const groups: ApiGroup[] =
    usingMock || !swaggerDoc
      ? MOCK_GROUPS
      : rawGroups.map((g) => {
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
        });

  const activeGroup = groups.find((g) => g.value === activeGroupValue) ?? groups[0] ?? MOCK_GROUPS[0];

  const handleSetActiveGroup = useCallback((value: string) => {
    setActiveGroupValue(value);
  }, []);

  return (
    <GroupContext.Provider
      value={{
        groups,
        activeGroup,
        setActiveGroupValue: handleSetActiveGroup,
        swaggerDoc,
        menuTags,
        schemas,
        loading,
        usingMock,
      }}
    >
      {children}
    </GroupContext.Provider>
  );
};

export const useGroup = (): GroupContextValue => {
  const ctx = useContext(GroupContext);
  if (!ctx) throw new Error('useGroup must be used inside GroupProvider');
  return ctx;
};
