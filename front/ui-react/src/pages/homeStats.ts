import type { MenuTag, PathItemObject, SwaggerDoc } from '../types/swagger';

export const HOME_HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;

export type HomeHttpMethod = (typeof HOME_HTTP_METHODS)[number];

export interface HomeTagStats {
  tag: string;
  count: number;
  deprecated: number;
}

export interface HomeStats {
  total: number;
  counts: Record<HomeHttpMethod, number>;
  deprecatedCount: number;
  pathCount: number;
  topTags: HomeTagStats[];
}

function createEmptyMethodCounts(): Record<HomeHttpMethod, number> {
  return {
    get: 0,
    post: 0,
    put: 0,
    delete: 0,
    patch: 0,
    head: 0,
    options: 0,
  };
}

export function buildHomeStats(swaggerDoc: SwaggerDoc | null | undefined, menuTags: MenuTag[]): HomeStats {
  const counts = createEmptyMethodCounts();

  if (!swaggerDoc) {
    return {
      total: 0,
      counts,
      deprecatedCount: 0,
      pathCount: 0,
      topTags: [],
    };
  }

  let total = 0;
  let deprecatedCount = 0;
  let pathCount = 0;

  for (const pathItem of Object.values(swaggerDoc.paths ?? {})) {
    let pathHasOp = false;
    for (const method of HOME_HTTP_METHODS) {
      const op = (pathItem as PathItemObject)[method];
      if (op) {
        counts[method]++;
        total++;
        pathHasOp = true;
        if (op.deprecated) deprecatedCount++;
      }
    }
    if (pathHasOp) pathCount++;
  }

  const topTags = menuTags
    .filter((m) => m.operations.length > 0)
    .map((m) => ({
      tag: m.tag,
      count: m.operations.length,
      deprecated: m.operations.filter((op) => op.deprecated).length,
    }))
    .sort((a, b) => b.count - a.count);

  return { total, counts, deprecatedCount, pathCount, topTags };
}
