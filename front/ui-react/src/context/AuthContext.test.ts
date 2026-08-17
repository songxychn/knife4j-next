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

import { isAuthReadyForGroup, updateAuthSchemesForGroup } from './AuthContext';

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
  it('rejects a stale group A closure instead of merging group B memory into A', () => {
    const lingeringGroupAState = {
      groupId: 'group-a',
      schemes: {
        groupAExisting: { type: 'http', scheme: 'bearer', token: 'old-group-a-token' } as const,
      },
    };
    const groupBState = {
      groupId: 'group-b',
      schemes: {
        groupBAuth: { type: 'http', scheme: 'bearer', token: 'group-b-token' } as const,
      },
    };
    const lateUpdate = (schemes: Record<string, SchemeValue>) => ({
      ...schemes,
      groupAAuth: { type: 'oauth2' as const, accessToken: 'late-group-a-token', tokenType: 'Bearer' },
    });

    const afterRouteSwitch = updateAuthSchemesForGroup(lingeringGroupAState, 'group-a', 'group-b', lateUpdate);
    const afterGroupBLoad = updateAuthSchemesForGroup(groupBState, 'group-a', 'group-a', lateUpdate);

    expect(afterRouteSwitch).toBe(lingeringGroupAState);
    expect(afterGroupBLoad).toBe(groupBState);
    expect(afterGroupBLoad.schemes).toEqual(groupBState.schemes);
  });

  it('updates only a snapshot owned by the current target group', () => {
    const groupAState = { groupId: 'group-a', schemes: {} };

    const result = updateAuthSchemesForGroup(groupAState, 'group-a', 'group-a', (schemes) => ({
      ...schemes,
      groupAAuth: { type: 'oauth2', accessToken: 'group-a-token', tokenType: 'Bearer' },
    }));

    expect(result).not.toBe(groupAState);
    expect(result).toEqual({
      groupId: 'group-a',
      schemes: {
        groupAAuth: { type: 'oauth2', accessToken: 'group-a-token', tokenType: 'Bearer' },
      },
    });
  });
});
