import type { SwaggerGroup } from '../types/swagger';

export interface RouteApiGroup<TApi = unknown> {
  value: string;
  label: string;
  apis: TApi[];
}

const HOME_ROUTE_SEGMENTS = ['group', 'home'];

export function groupNameFromPathname(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (
    segments.length === HOME_ROUTE_SEGMENTS.length &&
    segments.every((segment, index) => segment === HOME_ROUTE_SEGMENTS[index])
  ) {
    return null;
  }

  const rawGroupName = segments[0];
  if (!rawGroupName) return null;

  try {
    return decodeURIComponent(rawGroupName);
  } catch {
    return rawGroupName;
  }
}

export function isRouteGroupReady(routeGroupName: string | null, activeGroupName: string): boolean {
  return routeGroupName === null || routeGroupName === activeGroupName;
}

/** spec 尚未加载或加载失败时，仍保留已知分组身份，避免配置作用域退回 default。 */
export function resolveActiveRouteGroup<TApi>(
  loadedGroups: RouteApiGroup<TApi>[],
  knownGroupNames: string[],
  activeGroupName: string,
): RouteApiGroup<TApi> {
  const loadedGroup = loadedGroups.find((group) => group.value === activeGroupName);
  if (loadedGroup) return loadedGroup;
  if (activeGroupName && knownGroupNames.includes(activeGroupName)) {
    return { value: activeGroupName, label: activeGroupName, apis: [] };
  }
  return loadedGroups[0] ?? { value: '', label: '', apis: [] };
}

export function selectInitialGroupName(groups: SwaggerGroup[], pathname: string): string {
  const routeGroupName = groupNameFromPathname(pathname);
  if (routeGroupName && groups.some((group) => group.name === routeGroupName)) {
    return routeGroupName;
  }

  return groups[0]?.name ?? '';
}
