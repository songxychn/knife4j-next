/**
 * Knife4j API Client
 * 负责拉取 group 列表和 api-docs 文档
 */

import type { SwaggerDoc, SwaggerGroup, MenuTag, MenuOperation, SwaggerUiConfig } from '../types/swagger';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;

/** HTTP method 在 swagger-ui 'method' sorter 下的固定顺序 */
const METHOD_ORDER: Record<string, number> = {
  get: 0,
  post: 1,
  put: 2,
  delete: 3,
  patch: 4,
  head: 5,
  options: 6,
};

/** tag 排序策略 */
export type TagsSorter = 'alpha' | 'preserve';
/** operation 排序策略 */
export type OperationsSorter = 'alpha' | 'method' | 'preserve';

/**
 * 拉取 springdoc / swagger-ui 的聚合配置：`/v3/api-docs/swagger-config`。
 * 返回 `null` 表示端点不存在或返回异常（例如 springfox 场景）。
 */
export async function fetchSwaggerUiConfig(): Promise<SwaggerUiConfig | null> {
  try {
    const res = await fetch('v3/api-docs/swagger-config');
    if (!res.ok) return null;
    return (await res.json()) as SwaggerUiConfig;
  } catch (_) {
    return null;
  }
}

/**
 * 从已获取的 SwaggerUiConfig 解析 group 列表。
 * - 有 `urls` → 多文档场景
 * - 否则 → 单文档，固定使用 `v3/api-docs`
 */
export function parseGroupsFromConfig(config: SwaggerUiConfig): SwaggerGroup[] {
  if (config.urls && Array.isArray(config.urls)) {
    return config.urls.map((u) => ({ name: u.name, url: u.url }));
  }
  return [{ name: 'default', url: 'v3/api-docs' }];
}

/** 拉取 group 列表（兼容 springfox / springdoc） */
export async function fetchGroups(): Promise<SwaggerGroup[]> {
  // 优先尝试 springdoc: v3/api-docs/swagger-config
  const config = await fetchSwaggerUiConfig();
  if (config) {
    return parseGroupsFromConfig(config);
  }

  // fallback: springfox swagger-resources
  try {
    const res = await fetch('swagger-resources');
    if (res.ok) {
      const data: Array<{ name: string; location: string; swaggerVersion?: string }> = await res.json();
      return data.map((g) => ({
        name: g.name,
        url: g.location,
        swaggerVersion: g.swaggerVersion,
      }));
    }
  } catch (_) {
    /* ignore */
  }

  return [];
}

/** 拉取指定 group 的 api-docs */
export async function fetchSwaggerDoc(url: string): Promise<SwaggerDoc | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as SwaggerDoc;
  } catch (_) {
    return null;
  }
}

/** 将外部传入的字符串归一化为 TagsSorter；无法识别的值一律视为 'preserve'（保持原序） */
export function normalizeTagsSorter(value: unknown): TagsSorter {
  return value === 'alpha' ? 'alpha' : 'preserve';
}

/** 将外部传入的字符串归一化为 OperationsSorter */
export function normalizeOperationsSorter(value: unknown): OperationsSorter {
  if (value === 'alpha') return 'alpha';
  if (value === 'method') return 'method';
  return 'preserve';
}

/** 排序选项（供 parseMenuTags 使用） */
export interface MenuSortOptions {
  tagsSorter?: TagsSorter;
  operationsSorter?: OperationsSorter;
}

function sortOperations(ops: MenuOperation[], sorter: OperationsSorter): MenuOperation[] {
  if (sorter === 'preserve') return ops;
  const sorted = [...ops];
  if (sorter === 'alpha') {
    sorted.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  } else if (sorter === 'method') {
    sorted.sort((a, b) => {
      const ma = METHOD_ORDER[a.method] ?? 99;
      const mb = METHOD_ORDER[b.method] ?? 99;
      if (ma !== mb) return ma - mb;
      return a.path.localeCompare(b.path);
    });
  }
  return sorted;
}

/** 将 SwaggerDoc 解析为侧边栏菜单结构 */
export function parseMenuTags(doc: SwaggerDoc, options: MenuSortOptions = {}): MenuTag[] {
  const tagsSorter = options.tagsSorter ?? 'preserve';
  const operationsSorter = options.operationsSorter ?? 'preserve';

  const tagMap = new Map<string, MenuTag>();

  // 初始化 tag 列表（保持 doc.tags 原始顺序）
  (doc.tags ?? []).forEach((t) => {
    tagMap.set(t.name, { tag: t.name, description: t.description, operations: [] });
  });

  Object.entries(doc.paths ?? {}).forEach(([path, pathItem]) => {
    HTTP_METHODS.forEach((method) => {
      const op = pathItem[method];
      if (!op) return;

      const tags = op.tags?.length ? op.tags : ['default'];
      tags.forEach((tag) => {
        if (!tagMap.has(tag)) {
          tagMap.set(tag, { tag, operations: [] });
        }
        const menuOp: MenuOperation = {
          key: `${tag}/${op.operationId ?? path}`,
          path,
          method,
          summary: op.summary ?? path,
          operationId: op.operationId,
          deprecated: op.deprecated,
          operation: op,
        };
        tagMap.get(tag)!.operations.push(menuOp);
      });
    });
  });

  let tags = Array.from(tagMap.values());

  // 按策略对 operations 排序
  if (operationsSorter !== 'preserve') {
    tags = tags.map((t) => ({ ...t, operations: sortOperations(t.operations, operationsSorter) }));
  }

  // 按策略对 tag 排序
  if (tagsSorter === 'alpha') {
    tags = [...tags].sort((a, b) => a.tag.localeCompare(b.tag));
  }

  return tags;
}

/** 获取 components.schemas（OAS3）或 definitions（OAS2） */
export function getSchemas(doc: SwaggerDoc): Record<string, import('../types/swagger').SchemaObject> {
  return doc.components?.schemas ?? doc.definitions ?? {};
}
