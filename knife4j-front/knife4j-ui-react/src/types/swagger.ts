/**
 * OpenAPI 数据类型定义
 * 兼容 OAS3（/v3/api-docs）和 Swagger2（/v2/api-docs）
 */

export interface SwaggerGroup {
  name: string;
  url: string; // api-docs 地址
  swaggerVersion?: string;
  location?: string; // swagger-resources 格式
}

/**
 * springdoc / swagger-ui 配置，对应 `/v3/api-docs/swagger-config` 响应。
 * 我们只使用其中与排序相关的字段；其余字段保留原始语义便于后续接入。
 *
 * 说明：
 * - `tagsSorter` / `operationsSorter`：和 springdoc 一致，取值为 `'alpha'` 时按字母序排序；
 *   `operationsSorter` 还可取 `'method'` 按 HTTP method 排序；其他值一律保持原序。
 */
export interface SwaggerUiConfig {
  /** 单文档 api-docs 地址（springdoc 单文档场景） */
  url?: string;
  /** 分组列表（springdoc 多文档场景） */
  urls?: Array<{ name: string; url: string }>;
  /** Knife4j 固定 discovery 端点返回的实际 swagger-config 地址 */
  swaggerConfigUrl?: string;
  /** tag 排序策略（例如 'alpha'） */
  tagsSorter?: string;
  /** operation 排序策略（例如 'alpha' / 'method'） */
  operationsSorter?: string;
  /** 其它 springdoc 配置字段允许透传 */
  [key: string]: unknown;
}

export interface SwaggerContact {
  name?: string;
  url?: string;
  email?: string;
}

export interface SwaggerLicense {
  name?: string;
  url?: string;
}

export interface SwaggerInfo {
  title: string;
  version: string;
  description?: string;
  termsOfService?: string;
  contact?: SwaggerContact;
  license?: SwaggerLicense;
}

export interface SwaggerServer {
  url: string;
  description?: string;
}

export interface SwaggerTag {
  name: string;
  description?: string;
}

export interface SchemaObject {
  type?: string;
  format?: string;
  title?: string;
  description?: string;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  $ref?: string;
  required?: string[];
  enum?: unknown[];
}

export interface ParameterObject {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie' | 'body' | 'formData';
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
  type?: string; // OAS2
  format?: string; // OAS2
}

export interface RequestBodyObject {
  description?: string;
  required?: boolean;
  content?: Record<string, { schema?: SchemaObject }>;
}

export interface ResponseObject {
  description?: string;
  content?: Record<string, { schema?: SchemaObject }>;
  schema?: SchemaObject; // OAS2
}

/** OpenAPI securityScheme 定义（OAS3 components.securitySchemes / OAS2 securityDefinitions） */
export interface SecuritySchemeObject {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect';
  description?: string;
  // apiKey
  in?: 'query' | 'header' | 'cookie';
  name?: string;
  // http
  scheme?: string;
  bearerFormat?: string;
  // oauth2
  flows?: {
    implicit?: OAuth2Flow;
    password?: OAuth2Flow;
    clientCredentials?: OAuth2Flow;
    authorizationCode?: OAuth2Flow;
  };
  // openIdConnect
  openIdConnectUrl?: string;
}

/** OAuth2 flow 配置 */
export interface OAuth2Flow {
  authorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes?: Record<string, string>;
}

export interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
  deprecated?: boolean;
  /** operation 级别的 security 声明，每项是 `{ [schemeName]: string[] } */
  security?: Record<string, string[]>[];
}

export interface PathItemObject {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  delete?: OperationObject;
  patch?: OperationObject;
  head?: OperationObject;
  options?: OperationObject;
}

/** 自定义 Markdown 文档子项（对应 x-markdownFiles[].children[]） */
export interface MarkdownFileItem {
  title: string;
  content?: string;
}

/** 自定义 Markdown 文档分组（对应 x-markdownFiles[]） */
export interface MarkdownFileGroup {
  group?: string;
  name: string;
  children?: MarkdownFileItem[];
}

export interface SwaggerDoc {
  openapi?: string; // OAS3
  swagger?: string; // OAS2
  info: SwaggerInfo;
  tags?: SwaggerTag[];
  paths: Record<string, PathItemObject>;
  /** OAS3 servers */
  servers?: SwaggerServer[];
  /** OAS2 host / basePath / schemes */
  host?: string;
  basePath?: string;
  schemes?: string[];
  components?: {
    schemas?: Record<string, SchemaObject>;
    securitySchemes?: Record<string, SecuritySchemeObject>;
  };
  definitions?: Record<string, SchemaObject>; // OAS2
  securityDefinitions?: Record<string, SecuritySchemeObject>; // OAS2
  /** 文档级默认 security */
  security?: Record<string, string[]>[];
  /** knife4j 自定义 Markdown 文档扩展 */
  'x-markdownFiles'?: MarkdownFileGroup[];
}

/** 解析后的菜单项（tag + operations） */
export interface MenuOperation {
  key: string; // e.g. "UserController/getUserById"
  path: string;
  method: string;
  summary: string;
  operationId?: string;
  deprecated?: boolean;
  operation: OperationObject;
}

export interface MenuTag {
  tag: string;
  description?: string;
  operations: MenuOperation[];
}
