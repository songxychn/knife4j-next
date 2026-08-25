import { describe, expect, it, vi } from 'vitest';
import type { SchemeValue } from 'knife4j-core';

// AuthProvider is compiled by the front build. These tests exercise the pure
// readiness contract without coupling to React or IndexedDB test shims.
vi.mock('react', () => ({
  default: {},
  createContext: () => ({}),
  useCallback: vi.fn(),
  useContext: vi.fn(),
  useEffect: vi.fn(),
  useRef: vi.fn(),
  useState: vi.fn(),
}));

import {
  authRecordBelongsToWrite,
  invalidateAuthSchemesForReset,
  isAuthReadyForGroup,
  updateAuthSchemesForGroup,
} from './AuthContext';

describe('AuthContext readiness', () => {
  it('stays pending until the initial group finishes loading', () => {
    expect(isAuthReadyForGroup('group-a', 'group-a', false)).toBe(false);
    expect(isAuthReadyForGroup('group-a', 'group-a', true)).toBe(true);
  });

  it('becomes pending immediately while switching from group A to group B', () => {
    expect(isAuthReadyForGroup('group-a', 'group-a', true)).toBe(true);

    // initialGroupId 已更新，但同步 activeGroupId 的 effect 尚未执行。
    expect(isAuthReadyForGroup('group-b', 'group-a', true)).toBe(false);
    // activeGroupId 已切换，但 B 分组的 IndexedDB 数据尚未返回。
    expect(isAuthReadyForGroup('group-b', 'group-b', false)).toBe(false);
    expect(isAuthReadyForGroup('group-b', 'group-b', true)).toBe(true);
  });
});

describe('AuthContext group-scoped mutations', () => {
  it('rolls back only the auth record created by the stale write', () => {
    const staleRecord = {
      __knife4jAuthRecord: 1,
      writeId: 'stale-write',
      schemes: { bearer: { type: 'http', scheme: 'bearer', token: 'stale-token' } },
    };
    const newerRecord = {
      __knife4jAuthRecord: 1,
      writeId: 'newer-write',
      schemes: { bearer: { type: 'http', scheme: 'bearer', token: 'newer-token' } },
    };

    expect(authRecordBelongsToWrite(staleRecord, 'stale-write')).toBe(true);
    expect(authRecordBelongsToWrite(newerRecord, 'stale-write')).toBe(false);
    expect(authRecordBelongsToWrite(newerRecord.schemes, 'stale-write')).toBe(false);
  });

  it('rejects a stale group A closure instead of merging group B memory into A', () => {
    const lingeringGroupAState = {
      groupId: 'group-a',
      resetGeneration: 'reset-before-switch',
      schemes: {
        groupAExisting: { type: 'http', scheme: 'bearer', token: 'old-group-a-token' } as const,
      },
    };
    const groupBState = {
      groupId: 'group-b',
      resetGeneration: 'reset-before-switch',
      schemes: {
        groupBAuth: { type: 'http', scheme: 'bearer', token: 'group-b-token' } as const,
      },
    };
    const lateUpdate = (schemes: Record<string, SchemeValue>) => ({
      ...schemes,
      groupAAuth: { type: 'oauth2' as const, accessToken: 'late-group-a-token', tokenType: 'Bearer' },
    });

    const afterRouteSwitch = updateAuthSchemesForGroup(
      lingeringGroupAState,
      'group-a',
      'group-b',
      'reset-before-switch',
      lateUpdate,
    );
    const afterGroupBLoad = updateAuthSchemesForGroup(
      groupBState,
      'group-a',
      'group-a',
      'reset-before-switch',
      lateUpdate,
    );

    expect(afterRouteSwitch).toBe(lingeringGroupAState);
    expect(afterGroupBLoad).toBe(groupBState);
    expect(afterGroupBLoad.schemes).toEqual(groupBState.schemes);
  });

  it('updates only a snapshot owned by the current target group', () => {
    const groupAState = { groupId: 'group-a', resetGeneration: 'current-reset', schemes: {} };

    const result = updateAuthSchemesForGroup(groupAState, 'group-a', 'group-a', 'current-reset', (schemes) => ({
      ...schemes,
      groupAAuth: { type: 'oauth2', accessToken: 'group-a-token', tokenType: 'Bearer' },
    }));

    expect(result).not.toBe(groupAState);
    expect(result).toEqual({
      groupId: 'group-a',
      resetGeneration: 'current-reset',
      schemes: {
        groupAAuth: { type: 'oauth2', accessToken: 'group-a-token', tokenType: 'Bearer' },
      },
    });
  });

  it('invalidates credentials loaded before a cross-tab reset and rejects the stale edit', () => {
    const staleState = {
      groupId: 'group-a',
      resetGeneration: 'reset-before',
      schemes: {
        bearer: { type: 'http', scheme: 'bearer', token: 'cleared-token' } as const,
        basic: { type: 'http', scheme: 'basic', username: 'old-user', password: 'old-password' } as const,
      },
    };
    const resetSnapshot = { generation: 'reset-after', active: false };

    const staleEdit = updateAuthSchemesForGroup(
      staleState,
      'group-a',
      'group-a',
      resetSnapshot.generation,
      (schemes) => ({
        ...schemes,
        bearer: { type: 'http', scheme: 'bearer', token: 'new-token' },
      }),
    );
    const invalidated = invalidateAuthSchemesForReset(staleState, resetSnapshot);

    expect(staleEdit).toBe(staleState);
    expect(invalidated).toEqual({ groupId: 'group-a', resetGeneration: 'reset-after', schemes: {} });
  });

  it('keeps auth memory empty while a full reset is active', () => {
    const currentState = {
      groupId: 'group-a',
      resetGeneration: 'reset-active',
      schemes: {
        bearer: { type: 'http', scheme: 'bearer', token: 'stale-token' } as const,
      },
    };

    expect(invalidateAuthSchemesForReset(currentState, { generation: 'reset-active', active: true })).toEqual({
      groupId: 'group-a',
      resetGeneration: 'reset-active',
      schemes: {},
    });
  });
});
