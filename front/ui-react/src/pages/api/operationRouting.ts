import type { MenuOperation, MenuTag } from '../../types/swagger';

export type OperationModeKey = 'doc' | 'debug' | 'openapi' | 'script';

const OPERATION_MODE_KEYS: OperationModeKey[] = ['doc', 'debug', 'openapi', 'script'];

export function findMenuOperation(
  menuTags: MenuTag[],
  encodedTag: string | undefined,
  encodedOperationId: string | undefined,
): MenuOperation | undefined {
  if (!encodedTag || !encodedOperationId) return undefined;
  const routeTag = decodeURIComponent(encodedTag);
  const routeOperationId = decodeURIComponent(encodedOperationId);
  const menuTag = menuTags.find((item) => item.tag === routeTag);
  const exactMatch = menuTag?.operations.find((item) => {
    const routeId = item.routeId ?? item.operationId ?? item.path;
    return (
      routeId === routeOperationId ||
      item.key === `${encodeURIComponent(routeTag)}/${encodeURIComponent(routeOperationId)}`
    );
  });
  if (exactMatch) return exactMatch;

  // Preserve old bookmarks that used the bare path before method-qualified
  // fallback routes were introduced for ambiguous operations, as well as old
  // operationId routes that now need a source-qualified identity.
  return menuTag?.operations.find(
    (item) =>
      item.operationId === routeOperationId ||
      (item.source !== 'webhook' && !item.operationId && item.path === routeOperationId),
  );
}

export function visibleOperationModeKeys(
  source: MenuOperation['source'],
  enableDebug: boolean,
  enableOpenApi: boolean,
): OperationModeKey[] {
  return OPERATION_MODE_KEYS.filter((key) => {
    if (source === 'webhook' && (key === 'debug' || key === 'script')) return false;
    if (key === 'debug') return enableDebug;
    if (key === 'openapi') return enableOpenApi;
    return true;
  });
}
