import type { SchemeValue } from 'knife4j-core';

export interface GroupAuthSchemes {
  groupId: string;
  schemes: Record<string, SchemeValue>;
}

/**
 * 只允许针对当前已选分组、且确实属于该分组的内存快照做更新。
 * 旧闭包不会拿另一个分组的 schemes 作为合并基底。
 */
export function updateAuthSchemesForGroup(
  state: GroupAuthSchemes,
  targetGroupId: string,
  currentGroupId: string,
  update: (schemes: Record<string, SchemeValue>) => Record<string, SchemeValue>,
): GroupAuthSchemes {
  if (targetGroupId !== currentGroupId || state.groupId !== targetGroupId) {
    return state;
  }
  return { groupId: targetGroupId, schemes: update(state.schemes) };
}

/** 仅当当前 initialGroupId 对应的分组加载完成后才允许消费鉴权值。 */
export function isAuthReadyForGroup(initialGroupId: string, activeGroupId: string, loaded: boolean): boolean {
  return loaded && activeGroupId === initialGroupId;
}

/** Unwrap legacy wrapped records (`{ __knife4jAuthRecord, schemes }`) as well as plain maps. */
export function unwrapStoredAuthSchemes(data: unknown): Record<string, SchemeValue> {
  if (typeof data !== 'object' || data === null) return {};
  const candidate = data as { __knife4jAuthRecord?: unknown; schemes?: unknown };
  if (
    candidate.__knife4jAuthRecord === 1 &&
    typeof candidate.schemes === 'object' &&
    candidate.schemes !== null &&
    !Array.isArray(candidate.schemes)
  ) {
    return candidate.schemes as Record<string, SchemeValue>;
  }
  return data as Record<string, SchemeValue>;
}
