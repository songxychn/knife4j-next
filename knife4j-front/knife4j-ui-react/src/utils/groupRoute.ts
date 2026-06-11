import type { SwaggerGroup } from '../types/swagger';

export function groupNameFromPathname(pathname: string): string | null {
  const rawGroupName = pathname.split('/').filter(Boolean)[0];
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
