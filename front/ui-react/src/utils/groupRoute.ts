import type { SwaggerGroup } from '../types/swagger';

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

export function selectInitialGroupName(groups: SwaggerGroup[], pathname: string): string {
  const routeGroupName = groupNameFromPathname(pathname);
  if (routeGroupName && groups.some((group) => group.name === routeGroupName)) {
    return routeGroupName;
  }

  return groups[0]?.name ?? '';
}
