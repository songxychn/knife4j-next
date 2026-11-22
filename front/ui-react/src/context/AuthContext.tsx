import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  isAuthReadyForGroup,
  unwrapStoredAuthSchemes,
  updateAuthSchemesForGroup,
  type GroupAuthSchemes,
} from './authGroupState';
import { del, get, set } from 'idb-keyval';
import type { SchemeValue } from 'knife4j-core';
import { KNIFE4J_STORAGE_KEYS, KNIFE4J_STORAGE_PREFIXES, getKnife4jStorageItem } from '../storage/knife4jStorage';

interface LegacyAuthConfig {
  type: 'bearer' | 'basic';
  token?: string;
  username?: string;
  password?: string;
}

interface AuthContextValue {
  /** 当前 groupId 下的 scheme 值映射 */
  schemes: Record<string, SchemeValue>;
  /** 当前 initialGroupId 的 scheme 已从 IndexedDB 加载完成 */
  ready: boolean;
  /** 更新当前 groupId 下某个 securityKey 的值 */
  setScheme: (securityKey: string, value: SchemeValue) => void;
  /** 删除当前 groupId 下某个 securityKey */
  removeScheme: (securityKey: string) => void;
  /** 清除当前 groupId 下所有 scheme */
  clearGroup: () => void;
  /** 跨 groupId 切换时调用，触发从 IndexedDB 重新加载 */
  activeGroupId: string;
  setActiveGroupId: (groupId: string) => void;
}

function idbKey(groupId: string): string {
  return `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}${groupId}`;
}

async function loadGroup(groupId: string): Promise<Record<string, SchemeValue>> {
  try {
    const data = await get<unknown>(idbKey(groupId));
    return unwrapStoredAuthSchemes(data);
  } catch {
    return {};
  }
}

async function saveGroup(groupId: string, schemes: Record<string, SchemeValue>): Promise<void> {
  try {
    await set(idbKey(groupId), schemes);
  } catch {
    // IndexedDB may be disabled in private browsing; keep in-memory state working.
  }
}

async function deleteGroup(groupId: string): Promise<void> {
  try {
    await del(idbKey(groupId));
  } catch {
    // ignore storage failures
  }
}

/**
 * 一次性迁移：若 localStorage 有旧 `knife4j_auth`，
 * 则把旧数据转为 bearer/basic SchemeValue 写入默认 group，然后清除 localStorage。
 */
async function migrateLegacyOnce(defaultGroupId: string): Promise<void> {
  try {
    const raw = getKnife4jStorageItem(localStorage, KNIFE4J_STORAGE_KEYS.legacyAuth);
    if (!raw) return;
    if (getKnife4jStorageItem(localStorage, KNIFE4J_STORAGE_KEYS.legacyAuthMigrated)) return;

    const legacy = JSON.parse(raw) as LegacyAuthConfig | null;
    if (!legacy) return;

    let schemeValue: SchemeValue | undefined;
    if (legacy.type === 'bearer' && legacy.token) {
      schemeValue = { type: 'http', scheme: 'bearer', token: legacy.token };
    } else if (legacy.type === 'basic' && (legacy.username || legacy.password)) {
      schemeValue = {
        type: 'http',
        scheme: 'basic',
        username: legacy.username ?? '',
        password: legacy.password ?? '',
      };
    }

    if (schemeValue) {
      const existing = await loadGroup(defaultGroupId);
      existing['legacy'] = schemeValue;
      await saveGroup(defaultGroupId, existing);
    }

    localStorage.setItem(KNIFE4J_STORAGE_KEYS.legacyAuthMigrated, '1');
    localStorage.removeItem(KNIFE4J_STORAGE_KEYS.legacyAuth);
  } catch {
    // 迁移失败静默忽略
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{
  children: React.ReactNode;
  /** 初始 groupId（默认 'default'） */
  initialGroupId?: string;
}> = ({ children, initialGroupId = 'default' }) => {
  const [activeGroupId, setActiveGroupIdState] = useState(initialGroupId);
  const [groupSchemes, setGroupSchemesState] = useState<GroupAuthSchemes>({
    groupId: initialGroupId,
    schemes: {},
  });
  const [loaded, setLoaded] = useState(false);
  const currentGroupIdRef = useRef(initialGroupId);
  const groupSchemesRef = useRef(groupSchemes);
  currentGroupIdRef.current = initialGroupId;

  useEffect(() => {
    setLoaded(false);
    setActiveGroupIdState(initialGroupId);
  }, [initialGroupId]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void (async () => {
      await migrateLegacyOnce(activeGroupId);
      const data = await loadGroup(activeGroupId);
      if (cancelled) return;
      const next: GroupAuthSchemes = { groupId: activeGroupId, schemes: data };
      groupSchemesRef.current = next;
      setGroupSchemesState(next);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeGroupId]);

  const setScheme = useCallback(
    (securityKey: string, value: SchemeValue) => {
      const prev = groupSchemesRef.current;
      const next = updateAuthSchemesForGroup(prev, activeGroupId, currentGroupIdRef.current, (schemes) => ({
        ...schemes,
        [securityKey]: value,
      }));
      if (next === prev) return;
      groupSchemesRef.current = next;
      setGroupSchemesState(next);
      void saveGroup(activeGroupId, next.schemes);
    },
    [activeGroupId],
  );

  const removeScheme = useCallback(
    (securityKey: string) => {
      const prev = groupSchemesRef.current;
      const next = updateAuthSchemesForGroup(prev, activeGroupId, currentGroupIdRef.current, (schemes) => {
        const updated = { ...schemes };
        delete updated[securityKey];
        return updated;
      });
      if (next === prev) return;
      groupSchemesRef.current = next;
      setGroupSchemesState(next);
      void saveGroup(activeGroupId, next.schemes);
    },
    [activeGroupId],
  );

  const clearGroup = useCallback(() => {
    const prev = groupSchemesRef.current;
    const next = updateAuthSchemesForGroup(prev, activeGroupId, currentGroupIdRef.current, () => ({}));
    if (next === prev) return;
    groupSchemesRef.current = next;
    setGroupSchemesState(next);
    void deleteGroup(activeGroupId);
  }, [activeGroupId]);

  const setActiveGroupId = useCallback((groupId: string) => {
    setActiveGroupIdState(groupId);
  }, []);

  const ready = isAuthReadyForGroup(initialGroupId, activeGroupId, loaded) && groupSchemes.groupId === activeGroupId;

  const value = useMemo<AuthContextValue>(
    () => ({
      schemes: ready ? groupSchemes.schemes : {},
      ready,
      setScheme,
      removeScheme,
      clearGroup,
      activeGroupId,
      setActiveGroupId,
    }),
    [ready, groupSchemes.schemes, setScheme, removeScheme, clearGroup, activeGroupId, setActiveGroupId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
