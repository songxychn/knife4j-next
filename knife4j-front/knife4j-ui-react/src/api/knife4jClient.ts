/**
 * Knife4j API Client
 * 负责拉取 group 列表和 api-docs 文档
 */

import type {
  SwaggerDoc,
  SwaggerInfo,
  SwaggerGroup,
  MenuTag,
  MenuOperation,
  SwaggerUiConfig,
  Knife4jRuntimeConfig,
} from '../types/swagger';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;
const KNIFE4J_ORDER_EXTENSION = 'x-order';
const DEFAULT_SWAGGER_INFO: SwaggerInfo = { title: 'API Docs', version: '' };

export interface SwaggerDocFetchResult {
  doc: SwaggerDoc | null;
  error: string | null;
}

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
 *
 * 当用户自定义 `springdoc.api-docs.path` 时，默认 swagger-config 会移动到新路径；
 * 此时读取 Knife4j runtime config `/knife4j/config` 来发现实际 swagger-config URL。
 */
export async function fetchSwaggerUiConfig(): Promise<SwaggerUiConfig | null> {
  const defaultConfig = await fetchSwaggerUiConfigFrom('v3/api-docs/swagger-config');
  if (defaultConfig) {
    return defaultConfig;
  }

  try {
    const res = await fetch('knife4j/config');
    if (!res.ok) return null;
    const discovery = (await res.json()) as Knife4jRuntimeConfig;
    const swaggerConfigUrl = discovery.openapi?.swaggerConfigUrl;
    if (typeof swaggerConfigUrl !== 'string' || swaggerConfigUrl.length === 0) {
      return null;
    }
    return fetchSwaggerUiConfigFrom(swaggerConfigUrl);
  } catch (_) {
    return null;
  }
}

async function fetchSwaggerUiConfigFrom(url: string): Promise<SwaggerUiConfig | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as SwaggerUiConfig;
  } catch (_) {
    return null;
  }
}

/**
 * 从已获取的 SwaggerUiConfig 解析 group 列表。
 * - 有 `urls` → 多文档场景
 * - 有 `url` → 单文档场景
 * - 否则 → 单文档，固定使用 `v3/api-docs`
 */
export function parseGroupsFromConfig(config: SwaggerUiConfig): SwaggerGroup[] {
  if (config.urls && Array.isArray(config.urls) && config.urls.length > 0) {
    return config.urls.map((u) => ({ name: u.name, url: u.url }));
  }
  if (typeof config.url === 'string' && config.url.length > 0) {
    return [{ name: 'default', url: config.url }];
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
        location: g.location,
        swaggerVersion: g.swaggerVersion,
      }));
    }
  } catch (_) {
    /* ignore */
  }

  return [];
}

/** 拉取指定 group 的 api-docs，并返回可展示的诊断信息 */
export async function fetchSwaggerDocResult(url: string): Promise<SwaggerDocFetchResult> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { doc: null, error: `api-docs 请求失败：HTTP ${res.status}` };
    }
    const text = await res.text();
    return normalizeSwaggerDocResponse(text);
  } catch (_) {
    return { doc: null, error: 'api-docs 加载失败，请检查后端服务。' };
  }
}

/** 拉取指定 group 的 api-docs */
export async function fetchSwaggerDoc(url: string): Promise<SwaggerDoc | null> {
  const result = await fetchSwaggerDocResult(url);
  return result.doc;
}

function normalizeSwaggerDocResponse(text: string): SwaggerDocFetchResult {
  let payload: unknown;

  try {
    payload = JSON.parse(text);
  } catch (_) {
    if (isBase64EncodedJson(text)) {
      return { doc: null, error: base64ApiDocsError() };
    }
    return { doc: null, error: 'api-docs 响应不是有效的 JSON，请检查实际返回内容。' };
  }

  if (typeof payload === 'string') {
    if (isBase64EncodedJson(payload)) {
      return { doc: null, error: base64ApiDocsError() };
    }
    return { doc: null, error: 'api-docs 响应是字符串，不是 OpenAPI/Swagger JSON 对象。' };
  }

  if (!isSwaggerDocLike(payload)) {
    return { doc: null, error: 'api-docs 响应不是 OpenAPI/Swagger JSON 对象，请检查接口文档地址。' };
  }

  return { doc: normalizeSwaggerDoc(payload), error: null };
}

function normalizeSwaggerDoc(doc: Record<string, unknown>): SwaggerDoc {
  return {
    ...doc,
    info: normalizeSwaggerInfo(doc.info),
  } as SwaggerDoc;
}

function normalizeSwaggerInfo(value: unknown): SwaggerInfo {
  if (!isRecord(value)) {
    return { ...DEFAULT_SWAGGER_INFO };
  }

  const title = typeof value.title === 'string' ? value.title : DEFAULT_SWAGGER_INFO.title;
  const version =
    typeof value.version === 'string' || typeof value.version === 'number'
      ? String(value.version)
      : DEFAULT_SWAGGER_INFO.version;

  return { ...value, title, version } as SwaggerInfo;
}

function isSwaggerDocLike(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (typeof value.openapi === 'string' || typeof value.swagger === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBase64EncodedJson(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length % 4 === 1) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return false;

  try {
    const padded = trimmed.padEnd(trimmed.length + ((4 - (trimmed.length % 4)) % 4), '=');
    const decoded = atob(padded).trim();
    return decoded.startsWith('{') && (decoded.includes('"openapi"') || decoded.includes('"swagger"'));
  } catch (_) {
    return false;
  }
}

function base64ApiDocsError(): string {
  return [
    'api-docs 响应是 Base64 字符串，不是 OpenAPI/Swagger JSON 对象。',
    '请检查 Spring HttpMessageConverter 配置，避免 Jackson JSON converter 接管 byte[] 或 String 响应。',
  ].join('\n');
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

function parseKnife4jOrder(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const order = Number(value);
    return Number.isFinite(order) ? order : null;
  }
  return null;
}

function sortByKnife4jOrder<T>(items: T[], getOrder: (item: T) => unknown): T[] | null {
  const indexed = items.map((item, index) => ({
    item,
    index,
    order: parseKnife4jOrder(getOrder(item)),
  }));

  if (!indexed.some((entry) => entry.order !== null)) {
    return null;
  }

  return indexed
    .sort((a, b) => {
      if (a.order !== null && b.order !== null && a.order !== b.order) {
        return a.order - b.order;
      }
      if (a.order !== null && b.order === null) return -1;
      if (a.order === null && b.order !== null) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/** 将 SwaggerDoc 解析为侧边栏菜单结构 */
export function parseMenuTags(doc: SwaggerDoc, options: MenuSortOptions = {}): MenuTag[] {
  const tagsSorter = options.tagsSorter ?? 'preserve';
  const operationsSorter = options.operationsSorter ?? 'preserve';

  const tagMap = new Map<string, MenuTag>();
  const tagOrders = new Map<string, unknown>();

  // 初始化 tag 列表（保持 doc.tags 原始顺序）
  (doc.tags ?? []).forEach((t) => {
    tagOrders.set(t.name, t[KNIFE4J_ORDER_EXTENSION]);
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
          key: `${encodeURIComponent(tag)}/${encodeURIComponent(op.operationId ?? path)}`,
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

  // 优先按 Knife4j 扩展字段排序；未提供时回落到现有 springdoc / 用户 sorter 策略。
  tags = tags.map((t) => {
    const orderedOperations = sortByKnife4jOrder(t.operations, (op) => op.operation[KNIFE4J_ORDER_EXTENSION]);
    if (orderedOperations) {
      return { ...t, operations: orderedOperations };
    }
    if (operationsSorter !== 'preserve') {
      return { ...t, operations: sortOperations(t.operations, operationsSorter) };
    }
    return t;
  });

  // 优先按 Knife4j 扩展字段排序；未提供时回落到现有 springdoc / 用户 sorter 策略。
  const orderedTags = sortByKnife4jOrder(tags, (t) => tagOrders.get(t.tag));
  if (orderedTags) {
    tags = orderedTags;
  } else if (tagsSorter === 'alpha') {
    tags = [...tags].sort((a, b) => a.tag.localeCompare(b.tag));
  }

  return tags;
}

/** 获取 components.schemas（OAS3）或 definitions（OAS2） */
export function getSchemas(doc: SwaggerDoc): Record<string, import('../types/swagger').SchemaObject> {
  return doc.components?.schemas ?? doc.definitions ?? {};
}
