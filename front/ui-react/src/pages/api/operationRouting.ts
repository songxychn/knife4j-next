import type { MenuOperation, MenuTag } from '../../types/swagger';

export type OperationModeKey = 'doc' | 'debug' | 'openapi' | 'script';

const OPERATION_MODE_KEYS: OperationModeKey[] = ['doc', 'debug', 'openapi', 'script'];

export function findMenuOperation(
  menuTags: MenuTag[],
  routeTag: string | undefined,
  routeOperationId: string | undefined,
): MenuOperation | undefined {
  // React Router has decoded path parameters once. A literal % or %41 is data here.
  if (!routeTag || !routeOperationId) return undefined;
  const menuTag = menuTags.find((item) => (item.routeId ?? item.tag) === routeTag);
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
      (!item.identity && item.source !== 'webhook' && !item.operationId && item.path === routeOperationId),
  );
}

export function visibleOperationModeKeys(
  source: MenuOperation['source'],
  enableDebug: boolean,
  enableOpenApi: boolean,
): OperationModeKey[] {
  return OPERATION_MODE_KEYS.filter((key) => {
    if (source && source !== 'path' && (key === 'debug' || key === 'script')) return false;
    if (key === 'debug') return enableDebug;
    if (key === 'openapi') return enableOpenApi;
    return true;
  });
}
