import { describe, expect, it } from 'vitest';
import type { SchemeValue } from 'knife4j-core';

import { isAuthReadyForGroup, unwrapStoredAuthSchemes, updateAuthSchemesForGroup } from './authGroupState';

describe('AuthContext readiness', () => {
  it('stays pending until the initial group finishes loading', () => {
    expect(isAuthReadyForGroup('group-a', 'group-a', false)).toBe(false);
    expect(isAuthReadyForGroup('group-a', 'group-a', true)).toBe(true);
  });

  it('becomes pending immediately while switching from group A to group B', () => {
    expect(isAuthReadyForGroup('group-a', 'group-a', true)).toBe(true);
    expect(isAuthReadyForGroup('group-b', 'group-a', true)).toBe(false);
    expect(isAuthReadyForGroup('group-b', 'group-b', false)).toBe(false);
    expect(isAuthReadyForGroup('group-b', 'group-b', true)).toBe(true);
  });
});

describe('AuthContext group-scoped mutations and legacy record compatibility', () => {
  it('unwraps both plain maps and legacy wrapped IndexedDB records', () => {
    const plain = { bearer: { type: 'http', scheme: 'bearer', token: 'abc' } as const };
    const wrapped = { __knife4jAuthRecord: 1, writeId: 'w1', schemes: plain };
    expect(unwrapStoredAuthSchemes(plain)).toEqual(plain);
    expect(unwrapStoredAuthSchemes(wrapped)).toEqual(plain);
    expect(unwrapStoredAuthSchemes(undefined)).toEqual({});
  });

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
