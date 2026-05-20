const OPERATION_MODE_SUFFIXES = ['/doc', '/debug', '/openapi', '/script'] as const;

/**
 * Strip the trailing operation mode segment from a route key to obtain the
 * corresponding sidebar menu key.
 */
export const routeKeyToMenuKey = (key: string) =>
  key.endsWith('/doc')
    ? key.slice(0, -4)
    : key.endsWith('/debug')
      ? key.slice(0, -6)
      : key.endsWith('/openapi')
        ? key.slice(0, -8)
        : key.endsWith('/script')
          ? key.slice(0, -7)
          : key.includes('/schema')
            ? key.replace(/\/schema\/.*$/, '/schema')
            : key;

export function isOperationRouteKey(key: string): boolean {
  return OPERATION_MODE_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

export function findOperationRouteKey(items: Array<{ key: string }>, menuKey: string): string | null {
  return items.find((item) => isOperationRouteKey(item.key) && routeKeyToMenuKey(item.key) === menuKey)?.key ?? null;
}

export function upsertOperationRoutePane<T extends { key: string; label: string }>(
  items: T[],
  routeKey: string,
  label: string,
  createPane: (key: string, label: string) => T,
): T[] {
  const existingRouteIndex = items.findIndex((item) => item.key === routeKey);
  if (existingRouteIndex >= 0) {
    const existingRoutePane = items[existingRouteIndex];
    if (existingRoutePane.label === label) return items;
    return items.map((item, index) => (index === existingRouteIndex ? ({ ...item, label } as T) : item));
  }

  const menuKey = routeKeyToMenuKey(routeKey);
  const operationRouteIndex = items.findIndex(
    (item) => isOperationRouteKey(item.key) && routeKeyToMenuKey(item.key) === menuKey,
  );

  if (operationRouteIndex >= 0) {
    return items.map((item, index) =>
      index === operationRouteIndex ? ({ ...item, key: routeKey, label } as T) : item,
    );
  }

  return [...items, createPane(routeKey, label)];
}
