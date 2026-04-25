/**
 * Knife4j API Client
 * 负责拉取 group 列表和 api-docs 文档
 */

import type { SwaggerDoc, SwaggerGroup, MenuTag, MenuOperation } from '../types/swagger';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;

/** 拉取 group 列表（兼容 springfox / springdoc） */
export async function fetchGroups(): Promise<SwaggerGroup[]> {
  // 优先尝试 springdoc: v3/api-docs/swagger-config
  try {
    const res = await fetch('v3/api-docs/swagger-config');
    if (res.ok) {
      const data = await res.json();
      // springdoc 格式: { urls: [{name, url}] } 或单文档
      if (data.urls && Array.isArray(data.urls)) {
        return data.urls.map((u: { name: string; url: string }) => ({
          name: u.name,
          url: u.url,
        }));
      }
      // 单文档，无分组
      return [{ name: 'default', url: 'v3/api-docs' }];
    }
  } catch (_) { /* ignore */ }

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
  } catch (_) { /* ignore */ }

  return [];
}

/** 拉取指定 group 的 api-docs */
export async function fetchSwaggerDoc(url: string): Promise<SwaggerDoc | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as SwaggerDoc;
  } catch (_) {
    return null;
  }
}

/** 将 SwaggerDoc 解析为侧边栏菜单结构 */
export function parseMenuTags(doc: SwaggerDoc): MenuTag[] {
  const tagMap = new Map<string, MenuTag>();

  // 初始化 tag 列表（保持顺序）
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

  return Array.from(tagMap.values());
}

/** 获取 components.schemas（OAS3）或 definitions（OAS2） */
export function getSchemas(doc: SwaggerDoc): Record<string, import('../types/swagger').SchemaObject> {
  return doc.components?.schemas ?? doc.definitions ?? {};
}
