import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createStore, del, get, promisifyRequest, set } from 'idb-keyval';
import type { SchemeValue } from 'knife4j-core';
import {
  KNIFE4J_STORAGE_KEYS,
  KNIFE4J_STORAGE_PREFIXES,
  getKnife4jStorageResetSnapshot,
  setKnife4jStorageItem,
  subscribeKnife4jStorageReset,
  trackKnife4jStorageWrite,
  type Knife4jStorageResetSnapshot,
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
  resetGeneration: string;
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
  resetGeneration: string,
  update: (schemes: Record<string, SchemeValue>) => Record<string, SchemeValue>,
): GroupAuthSchemes {
  if (
    targetGroupId !== currentGroupId ||
    state.groupId !== targetGroupId ||
    state.resetGeneration !== resetGeneration
  ) {
    return state;
  }
  return { groupId: targetGroupId, resetGeneration, schemes: update(state.schemes) };
}

/** A new or active full reset invalidates every credential held in memory. */
// eslint-disable-next-line react-refresh/only-export-components
export function invalidateAuthSchemesForReset(
  state: GroupAuthSchemes,
  snapshot: Knife4jStorageResetSnapshot,
): GroupAuthSchemes {
  if (!snapshot.active && state.resetGeneration === snapshot.generation) return state;
  return { groupId: state.groupId, resetGeneration: snapshot.generation, schemes: {} };
}

// ─── IndexedDB helpers ─────────────────────────────────

const AUTH_RECORD_VERSION = 1;
// idb-keyval's documented default store, declared explicitly so rollback can compare and delete atomically.
const authIndexedDbStore = createStore('keyval-store', 'keyval');

interface PersistedAuthRecord {
  __knife4jAuthRecord: typeof AUTH_RECORD_VERSION;
  writeId: string;
  schemes: Record<string, SchemeValue>;
}

function createAuthWriteId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // Fall back to a non-security-sensitive unique value.
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isPersistedAuthRecord(value: unknown): value is PersistedAuthRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PersistedAuthRecord>;
  return (
    candidate.__knife4jAuthRecord === AUTH_RECORD_VERSION &&
    typeof candidate.writeId === 'string' &&
    candidate.writeId.length > 0 &&
    typeof candidate.schemes === 'object' &&
    candidate.schemes !== null
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function authRecordBelongsToWrite(value: unknown, writeId: string): boolean {
  return isPersistedAuthRecord(value) && value.writeId === writeId;
}

function createPersistedAuthRecord(schemes: Record<string, SchemeValue>): PersistedAuthRecord {
  return {
    __knife4jAuthRecord: AUTH_RECORD_VERSION,
    writeId: createAuthWriteId(),
    schemes,
  };
}

/** Delete only the value written by this operation, in the same transaction as the ownership check. */
async function rollbackAuthWrite(key: string, writeId: string): Promise<void> {
  await authIndexedDbStore(
    'readwrite',
    (store) =>
      new Promise<void>((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            if (authRecordBelongsToWrite(request.result, writeId)) store.delete(key);
            resolve(promisifyRequest(store.transaction));
          } catch (error) {
            reject(error);
          }
        };
        request.onerror = () => reject(request.error);
      }),
  );
}

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
    const data = await get<Record<string, SchemeValue> | PersistedAuthRecord>(idbKey(groupId), authIndexedDbStore);
    if (isPersistedAuthRecord(data)) return data.schemes;
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
    const record = createPersistedAuthRecord(schemes);
    await set(key, record, authIndexedDbStore);
    if (!canWrite()) await rollbackAuthWrite(key, record.writeId);
  });
}

/** 删除单个 group */
async function deleteGroup(groupId: string): Promise<void> {
  await trackKnife4jStorageWrite(async (canWrite) => {
    if (canWrite()) await del(idbKey(groupId), authIndexedDbStore);
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
      let migratedRecord: PersistedAuthRecord | null = null;
      if (schemeValue) {
        const existing = await loadGroup(defaultGroupId);
        if (!canWrite()) return;
        existing['legacy'] = schemeValue;
        migratedRecord = createPersistedAuthRecord(existing);
        await set(key, migratedRecord, authIndexedDbStore);
        if (!canWrite()) {
          await rollbackAuthWrite(key, migratedRecord.writeId);
          return;
        }
      }

      // 标记已迁移
      if (!canWrite()) {
        if (migratedRecord) await rollbackAuthWrite(key, migratedRecord.writeId);
        return;
      }
      const marked = setKnife4jStorageItem(localStorage, KNIFE4J_STORAGE_KEYS.legacyAuthMigrated, '1');
      if (!marked || !canWrite()) {
        localStorage.removeItem(KNIFE4J_STORAGE_KEYS.legacyAuthMigrated);
        if (migratedRecord) await rollbackAuthWrite(key, migratedRecord.writeId);
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
  const initialResetSnapshotRef = useRef<Knife4jStorageResetSnapshot | null>(null);
  if (initialResetSnapshotRef.current === null) {
    initialResetSnapshotRef.current = getKnife4jStorageResetSnapshot();
  }
  const initialResetSnapshot = initialResetSnapshotRef.current;
  const [activeGroupId, setActiveGroupIdState] = useState(initialGroupId);
  const [resetSnapshot, setResetSnapshot] = useState(initialResetSnapshot);
  const [groupSchemes, setGroupSchemes] = useState<GroupAuthSchemes>({
    groupId: initialGroupId,
    resetGeneration: initialResetSnapshot.generation,
    schemes: {},
  });
  const [loaded, setLoaded] = useState(false);
  const currentGroupIdRef = useRef(initialGroupId);
  const resetSnapshotRef = useRef(initialResetSnapshot);
  currentGroupIdRef.current = initialGroupId;

  useEffect(() => {
    setLoaded(false);
    setActiveGroupIdState(initialGroupId);
  }, [initialGroupId]);

  useEffect(() => {
    const handleResetSnapshot = (snapshot: Knife4jStorageResetSnapshot) => {
      const previous = resetSnapshotRef.current;
      if (previous.generation === snapshot.generation && previous.active === snapshot.active) return;
      resetSnapshotRef.current = snapshot;
      setResetSnapshot(snapshot);
      setGroupSchemes((state) => invalidateAuthSchemesForReset(state, snapshot));
      setLoaded(false);
    };

    const unsubscribe = subscribeKnife4jStorageReset(handleResetSnapshot);
    handleResetSnapshot(getKnife4jStorageResetSnapshot());
    return unsubscribe;
  }, []);

  // 加载 + 迁移
  useEffect(() => {
    let cancelled = false;
    if (resetSnapshot.active) {
      setLoaded(false);
      return () => {
        cancelled = true;
      };
    }

    setLoaded(false);
    (async () => {
      await migrateLegacyOnce(activeGroupId);
      const data = await loadGroup(activeGroupId);
      if (cancelled) return;

      const latestResetSnapshot = getKnife4jStorageResetSnapshot();
      if (latestResetSnapshot.active || latestResetSnapshot.generation !== resetSnapshot.generation) {
        resetSnapshotRef.current = latestResetSnapshot;
        setResetSnapshot(latestResetSnapshot);
        setGroupSchemes((state) => invalidateAuthSchemesForReset(state, latestResetSnapshot));
        setLoaded(false);
        return;
      }

      setGroupSchemes({
        groupId: activeGroupId,
        resetGeneration: resetSnapshot.generation,
        schemes: data,
      });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeGroupId, resetSnapshot]);

  const setScheme = useCallback(
    (securityKey: string, value: SchemeValue) => {
      const targetGroupId = activeGroupId;
      const latestResetSnapshot = getKnife4jStorageResetSnapshot();
      if (latestResetSnapshot !== resetSnapshotRef.current) {
        resetSnapshotRef.current = latestResetSnapshot;
        setResetSnapshot(latestResetSnapshot);
        setLoaded(false);
      }
      setGroupSchemes((prev) => {
        const invalidated = invalidateAuthSchemesForReset(prev, latestResetSnapshot);
        if (latestResetSnapshot.active || invalidated !== prev) return invalidated;
        const next = updateAuthSchemesForGroup(
          prev,
          targetGroupId,
          currentGroupIdRef.current,
          latestResetSnapshot.generation,
          (schemes) => ({
            ...schemes,
            [securityKey]: value,
          }),
        );
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
      const latestResetSnapshot = getKnife4jStorageResetSnapshot();
      if (latestResetSnapshot !== resetSnapshotRef.current) {
        resetSnapshotRef.current = latestResetSnapshot;
        setResetSnapshot(latestResetSnapshot);
        setLoaded(false);
      }
      setGroupSchemes((prev) => {
        const invalidated = invalidateAuthSchemesForReset(prev, latestResetSnapshot);
        if (latestResetSnapshot.active || invalidated !== prev) return invalidated;
        const next = updateAuthSchemesForGroup(
          prev,
          targetGroupId,
          currentGroupIdRef.current,
          latestResetSnapshot.generation,
          (schemes) => {
            const updated = { ...schemes };
            delete updated[securityKey];
            return updated;
          },
        );
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
    const latestResetSnapshot = getKnife4jStorageResetSnapshot();
    if (latestResetSnapshot !== resetSnapshotRef.current) {
      resetSnapshotRef.current = latestResetSnapshot;
      setResetSnapshot(latestResetSnapshot);
      setLoaded(false);
    }
    setGroupSchemes((prev) => {
      const invalidated = invalidateAuthSchemesForReset(prev, latestResetSnapshot);
      if (latestResetSnapshot.active || invalidated !== prev) return invalidated;
      const next = updateAuthSchemesForGroup(
        prev,
        targetGroupId,
        currentGroupIdRef.current,
        latestResetSnapshot.generation,
        () => ({}),
      );
      if (next !== prev) {
        deleteGroup(targetGroupId).catch(() => {});
      }
      return next;
    });
  }, [activeGroupId]);

  const setActiveGroupId = useCallback((groupId: string) => {
    setActiveGroupIdState(groupId);
  }, []);

  const ready =
    isAuthReadyForGroup(initialGroupId, activeGroupId, loaded) &&
    !resetSnapshot.active &&
    groupSchemes.groupId === activeGroupId &&
    groupSchemes.resetGeneration === resetSnapshot.generation;
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
