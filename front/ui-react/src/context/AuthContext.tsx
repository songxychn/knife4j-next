import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { get, set, del } from 'idb-keyval';
import type { SchemeValue } from 'knife4j-core';
import {
  KNIFE4J_STORAGE_KEYS,
  KNIFE4J_STORAGE_PREFIXES,
  setKnife4jStorageItem,
  trackKnife4jStorageWrite,
} from '../storage/knife4jStorage';

// ─── Types ─────────────────────────────────────────────

/** 旧版 localStorage 存储结构（用于一次性迁移） */
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

export interface GroupAuthSchemes {
  groupId: string;
  schemes: Record<string, SchemeValue>;
}

/**
 * 只允许针对当前已选分组、且确实属于该分组的内存快照做更新。
 * 旧闭包不会拿另一个分组的 schemes 作为合并基底。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function updateAuthSchemesForGroup(
  state: GroupAuthSchemes,
  targetGroupId: string,
  currentGroupId: string,
  update: (schemes: Record<string, SchemeValue>) => Record<string, SchemeValue>,
): GroupAuthSchemes {
  if (targetGroupId !== currentGroupId || state.groupId !== targetGroupId) return state;
  return { groupId: targetGroupId, schemes: update(state.schemes) };
}

// ─── IndexedDB helpers ─────────────────────────────────

function idbKey(groupId: string): string {
  return `${KNIFE4J_STORAGE_PREFIXES.authIndexedDb}${groupId}`;
}

/** 仅当当前 initialGroupId 对应的分组加载完成后才允许消费鉴权值。 */
// eslint-disable-next-line react-refresh/only-export-components
export function isAuthReadyForGroup(initialGroupId: string, activeGroupId: string, loaded: boolean): boolean {
  return loaded && activeGroupId === initialGroupId;
}

/** 从 IndexedDB 加载单个 group */
async function loadGroup(groupId: string): Promise<Record<string, SchemeValue>> {
  try {
    const data = await get<Record<string, SchemeValue>>(idbKey(groupId));
    return data ?? {};
  } catch {
    return {};
  }
}

/** 写入单个 group */
async function saveGroup(groupId: string, schemes: Record<string, SchemeValue>): Promise<void> {
  const key = idbKey(groupId);
  await trackKnife4jStorageWrite(async (canWrite) => {
    if (!canWrite()) return;
    await set(key, schemes);
    if (!canWrite()) await del(key);
  });
}

/** 删除单个 group */
async function deleteGroup(groupId: string): Promise<void> {
  await trackKnife4jStorageWrite(async (canWrite) => {
    if (canWrite()) await del(idbKey(groupId));
  });
}

/**
 * 一次性迁移：若 IndexedDB 中无数据，但 localStorage 有旧 `knife4j_auth`，
 * 则把旧数据转为 bearer/basic SchemeValue 写入默认 group，然后清除 localStorage。
 */
async function migrateLegacyOnce(defaultGroupId: string): Promise<void> {
  await trackKnife4jStorageWrite(async (canWrite) => {
    try {
      if (!canWrite()) return;
      const raw = localStorage.getItem(KNIFE4J_STORAGE_KEYS.legacyAuth);
      if (!raw) return;
      // 检查是否已迁移过（标记 key）
      const migrated = localStorage.getItem(KNIFE4J_STORAGE_KEYS.legacyAuthMigrated);
      if (migrated) return;

      const legacy: LegacyAuthConfig | null = JSON.parse(raw) as LegacyAuthConfig | null;
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

      const key = idbKey(defaultGroupId);
      if (schemeValue) {
        const existing = await loadGroup(defaultGroupId);
        if (!canWrite()) return;
        existing['legacy'] = schemeValue;
        await set(key, existing);
        if (!canWrite()) {
          await del(key);
          return;
        }
      }

      // 标记已迁移
      if (!canWrite()) {
        if (schemeValue) await del(key);
        return;
      }
      const marked = setKnife4jStorageItem(localStorage, KNIFE4J_STORAGE_KEYS.legacyAuthMigrated, '1');
      if (!marked || !canWrite()) {
        localStorage.removeItem(KNIFE4J_STORAGE_KEYS.legacyAuthMigrated);
        if (schemeValue) await del(key);
        return;
      }
      localStorage.removeItem(KNIFE4J_STORAGE_KEYS.legacyAuth);
    } catch {
      // 迁移失败静默忽略
    }
  });
}

/**
 * 清理旧的 IndexedDB 条目（如果 groupId 变了）。
 * 不自动删除，只在用户手动 clearGroup 时删。
 */

// ─── Context ───────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{
  children: React.ReactNode;
  /** 初始 groupId（默认 'default'） */
  initialGroupId?: string;
}> = ({ children, initialGroupId = 'default' }) => {
  const [activeGroupId, setActiveGroupIdState] = useState(initialGroupId);
  const [groupSchemes, setGroupSchemes] = useState<GroupAuthSchemes>({ groupId: initialGroupId, schemes: {} });
  const [loaded, setLoaded] = useState(false);
  const currentGroupIdRef = useRef(initialGroupId);
  currentGroupIdRef.current = initialGroupId;

  useEffect(() => {
    setLoaded(false);
    setActiveGroupIdState(initialGroupId);
  }, [initialGroupId]);

  // 加载 + 迁移
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateLegacyOnce(activeGroupId);
      const data = await loadGroup(activeGroupId);
      if (!cancelled) {
        setGroupSchemes({ groupId: activeGroupId, schemes: data });
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeGroupId]);

  const setScheme = useCallback(
    (securityKey: string, value: SchemeValue) => {
      const targetGroupId = activeGroupId;
      setGroupSchemes((prev) => {
        const next = updateAuthSchemesForGroup(prev, targetGroupId, currentGroupIdRef.current, (schemes) => ({
          ...schemes,
          [securityKey]: value,
        }));
        if (next !== prev) {
          // 异步持久化
          saveGroup(targetGroupId, next.schemes).catch(() => {});
        }
        return next;
      });
    },
    [activeGroupId],
  );

  const removeScheme = useCallback(
    (securityKey: string) => {
      const targetGroupId = activeGroupId;
      setGroupSchemes((prev) => {
        const next = updateAuthSchemesForGroup(prev, targetGroupId, currentGroupIdRef.current, (schemes) => {
          const updated = { ...schemes };
          delete updated[securityKey];
          return updated;
        });
        if (next !== prev) {
          saveGroup(targetGroupId, next.schemes).catch(() => {});
        }
        return next;
      });
    },
    [activeGroupId],
  );

  const clearGroup = useCallback(() => {
    const targetGroupId = activeGroupId;
    setGroupSchemes((prev) => {
      const next = updateAuthSchemesForGroup(prev, targetGroupId, currentGroupIdRef.current, () => ({}));
      if (next !== prev) {
        deleteGroup(targetGroupId).catch(() => {});
      }
      return next;
    });
  }, [activeGroupId]);

  const setActiveGroupId = useCallback((groupId: string) => {
    setActiveGroupIdState(groupId);
  }, []);

  const ready = isAuthReadyForGroup(initialGroupId, activeGroupId, loaded) && groupSchemes.groupId === activeGroupId;
  const activeSchemes = ready ? groupSchemes.schemes : {};

  return (
    <AuthContext.Provider
      value={{ schemes: activeSchemes, ready, setScheme, removeScheme, clearGroup, activeGroupId, setActiveGroupId }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
