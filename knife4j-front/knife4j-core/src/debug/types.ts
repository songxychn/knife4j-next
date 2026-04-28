/**
 * 调试模型统一类型定义
 *
 * 设计原则：
 * - 兼容 OAS2（parameters[].in=body/formData + type/format）和 OAS3（requestBody + schema）
 * - 调用方不感知规范差异
 * - 纯数据，无框架依赖、无浏览器 API
 */

// ─── 参数模型 ─────────────────────────────────────────

/** 参数位置（统一 OAS2 + OAS3） */
export type ParamIn = 'path' | 'query' | 'header' | 'cookie';

/** 调试参数 — 从 OpenAPI 参数解析后的统一结构 */
export interface DebugParam {
  /** 参数名 */
  name: string;
  /** 参数位置 */
  in: ParamIn;
  /** 是否必填 */
  required: boolean;
  /** 参数描述 */
  description?: string;
  /** 参数类型（string / integer / number / boolean / array / object / file / binary） */
  type: string;
  /** 格式修饰（date-time / int64 / double / binary …） */
  format?: string;
  /** 默认值 */
  default?: unknown;
  /** 示例值 */
  example?: unknown;
  /** 可选枚举值 */
  enum?: unknown[];
  /** 是否已废弃 */
  deprecated?: boolean;
  /** 是否只读（写回时不发） */
  readOnly?: boolean;
  /** 原始 schema 引用（可用于深层字段树展开） */
  schema?: Record<string, unknown>;
}

// ─── RequestBody 模型 ─────────────────────────────────

/** requestBody 内容分类 */
export type BodyContentType = 'json' | 'urlencoded' | 'multipart' | 'raw';

/** 单个 content-type 对应的 body 结构 */
export interface BodyContent {
  /** 原始 MIME 类型 */
  mediaType: string;
  /** 分类 */
  category: BodyContentType;
  /** 对应的 schema（可能含 $ref，需要 resolveRef 展开） */
  schema?: Record<string, unknown>;
  /** 初始示例值（JSON 字符串，由 schemaExample 生成） */
  exampleValue?: string;
  /** multipart 场景中标记哪些字段是 file / binary */
  fileFields?: string[];
  /**
   * multipart 场景中标记哪些字段的 encoding.contentType = application/json，
   * 这些字段在 UI 中以 JSON 文本框形式提交，发送时作为独立 JSON part 附加。
   */
  jsonFields?: string[];
}

// ─── OperationDebugModel ──────────────────────────────

/** 从一个 operation 解析出的调试模型 */
export interface OperationDebugModel {
  /** path 参数 */
  pathParams: DebugParam[];
  /** query 参数 */
  queryParams: DebugParam[];
  /** header 参数 */
  headerParams: DebugParam[];
  /** cookie 参数 */
  cookieParams: DebugParam[];
  /** requestBody 内容列表（可能含多种 content-type） */
  bodyContents: BodyContent[];
  /** requestBody 是否必填 */
  bodyRequired: boolean;
}

// ─── RequestBuilder 输入/输出 ─────────────────────────

/** requestBuilder 的用户填写输入 */
export interface DebugFormValues {
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  headerParams: Record<string, string>;
  cookieParams: Record<string, string>;
  /** 当前选中的 content-type */
  selectedContentType?: string;
  /** body 文本（已序列化，用于 json/raw 模式） */
  body?: string;
  /** urlencoded / multipart 字段表单值 { fieldName: value }（纯字符串值） */
  formFields?: Record<string, string>;
  /** multipart 文件字段 { fieldName: File[] } — 由 UI 层处理，不序列化进纯函数 */
  fileFields?: Record<string, unknown>;
  /**
   * multipart 场景中 encoding.contentType=application/json 的字段名列表。
   * 用于 buildCurl 输出 `-F 'field=...;type=application/json'`。
   */
  jsonFields?: string[];
}

/** 全局参数来源 */
export interface GlobalParamValues {
  headers: Record<string, string>;
  queries: Record<string, string>;
}

/** 参数来源标签（用于请求预览中标记优先级） */
export type ParamSource = 'interface' | 'global' | 'auth';

/** 请求参数来源映射 */
export interface BuiltRequestSourceMap {
  headers: Record<string, ParamSource>;
  query: Record<string, ParamSource>;
}

/**
 * 单个 securityScheme 的已填写值（按 scheme 类型区分）。
 *
 * - apiKey: `{ type: 'apiKey', in: 'header'|'query'|'cookie', name, value }`
 * - http-bearer: `{ type: 'http', scheme: 'bearer', token }`
 * - http-basic: `{ type: 'http', scheme: 'basic', username, password }`
 * - oauth2: `{ type: 'oauth2', accessToken, tokenType? }`（UI 侧拿到 token 后写回）
 */
export type SchemeValue =
  | {
      type: 'apiKey';
      in: 'header' | 'query' | 'cookie';
      name: string;
      value: string;
    }
  | {
      type: 'http';
      scheme: 'bearer';
      token: string;
    }
  | {
      type: 'http';
      scheme: 'basic';
      username: string;
      password: string;
    }
  | {
      type: 'oauth2';
      accessToken: string;
      tokenType?: string;
    };

/** 鉴权信息 */
export interface AuthValues {
  /**
   * @deprecated TASK-033 起建议使用 `bySecurityKey`；保留用于向后兼容。
   * bearer token（顶层 fallback）
   */
  bearerToken?: string;
  /**
   * @deprecated TASK-033 起建议使用 `bySecurityKey`；保留用于向后兼容。
   * basic auth: base64("user:pass")
   */
  basicCredentials?: string;
  /**
   * @deprecated TASK-033 起建议使用 `bySecurityKey`；保留用于向后兼容。
   * apiKey 头/查询值
   */
  apiKeys?: Record<string, string>;
  /**
   * 按 OpenAPI `components.securitySchemes` / `securityDefinitions` 的 key 组织的已填值。
   * 配合 buildRequest 的 `securityKeys` 选项筛选。
   */
  bySecurityKey?: Record<string, SchemeValue>;
}

/** requestBuilder 输出 */
export interface BuiltRequest {
  /** 最终请求 URL（已替换 path 参数、已拼接 query） */
  url: string;
  /** HTTP 方法 */
  method: string;
  /** 合并后的 headers */
  headers: Record<string, string>;
  /** query 参数（解码后，用于预览） */
  query: Record<string, string>;
  /** 请求体（原始字符串，或 FormData 引用 — 后者由 UI 层处理） */
  body?: string;
  /** Content-Type */
  contentType: string;
  /** 参数来源映射（仅在存在 auth / globalParams 时生成） */
  sourceMap?: BuiltRequestSourceMap;
  /**
   * multipart 场景中 encoding.contentType=application/json 的字段名列表。
   * buildCurl 用此输出 `-F 'field=...;type=application/json'`。
   */
  jsonFields?: string[];
}

/** required 校验结果 */
export interface ValidationError {
  /** 参数名 */
  name: string;
  /** 参数位置 */
  in: ParamIn | 'body';
  /** 错误信息 */
  message: string;
  /**
   * 表单定位 key，统一格式 `${in}:${name}`；body 错误时为 `body:requestBody`，
   * UI 层可用它高亮或聚焦对应输入项。
   */
  key: string;
}

// ─── Schema 示例/字段树 ───────────────────────────────

/** schema 递归展开上下文 */
export interface SchemaResolveContext {
  /** 当前 OpenAPI 文档（OAS2 或 OAS3） */
  doc: Record<string, unknown>;
  /** 最大递归深度，默认 8 */
  maxDepth?: number;
}

/** 字段树节点（用于文档展示） */
export interface SchemaFieldNode {
  /** 字段名；根节点或 array 元素可能为空字符串 */
  name: string;
  /** 归一化后的类型：string / integer / number / boolean / array / object / unknown */
  type: string;
  /** 格式修饰（如 int64 / date-time / binary） */
  format?: string;
  /** 是否必填（由父 schema 的 required 列表决定） */
  required: boolean;
  /** 描述 */
  description?: string;
  /** 默认值 */
  default?: unknown;
  /** 显式 example */
  example?: unknown;
  /** 枚举值 */
  enum?: unknown[];
  /** 是否只读 */
  readOnly?: boolean;
  /** 是否只写 */
  writeOnly?: boolean;
  /** 是否已废弃 */
  deprecated?: boolean;
  /** 当 type 为 $ref 指向的具名类型时，保留类型名便于 UI 提示 */
  refName?: string;
  /** $ref 目标 schema 的 description（不覆盖字段自身 description，用于二级展示） */
  refDescription?: string;
  /** $ref 目标 schema 的 title（不覆盖字段自身 description，用于二级展示） */
  refTitle?: string;
  /** 因循环引用或达到最大深度被截断时标记 */
  truncated?: boolean;
  /** 子字段（object.properties 或 array.items） */
  children?: SchemaFieldNode[];
}

/**
 * 根据 schema 生成 JSON 示例值（纯数据）。
 *
 * 支持：$ref / object / array / enum / example / default / allOf（浅合并） /
 * oneOf / anyOf（取第一个可解析分支） / 循环引用截断 / maxDepth 保护。
 */
export type BuildSchemaExampleFn = (schema: Record<string, unknown> | undefined, ctx: SchemaResolveContext) => unknown;

/**
 * 根据 schema 生成字段树（用于文档展示）。
 *
 * 返回值为 SchemaFieldNode 数组：object 展开 properties，array 以伪节点暴露 items。
 * 循环引用以 `truncated=true` 截断，不会死循环。
 */
export type BuildSchemaFieldTreeFn = (
  schema: Record<string, unknown> | undefined,
  ctx: SchemaResolveContext,
) => SchemaFieldNode[];
