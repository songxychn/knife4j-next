/**
 * OpenAPI 数据类型定义
 * 兼容 OAS3（/v3/api-docs）和 Swagger2（/v2/api-docs）
 */

export interface SwaggerGroup {
  name: string;
  url: string; // api-docs 地址
  swaggerVersion?: string;
  location?: string; // swagger-resources 格式
  contextPath?: string; // gateway / aggregation route context-path
  header?: string; // Knife4j aggregation route identifier
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
  urls?: Array<{
    name: string;
    url: string;
    contextPath?: string;
    swaggerVersion?: string;
    location?: string;
    header?: string;
  }>;
  /** tag 排序策略（例如 'alpha'） */
  tagsSorter?: string;
  /** operation 排序策略（例如 'alpha' / 'method'） */
  operationsSorter?: string;
  /** 其它 springdoc 配置字段允许透传 */
  [key: string]: unknown;
}

export interface Knife4jRuntimeConfig {
  /** Knife4j runtime config schema version. */
  schemaVersion?: string;
  /** OpenAPI discovery data used by Knife4j UI bootstrap. */
  openapi?: {
    /** 实际 api-docs 地址 */
    apiDocsUrl?: string;
    /** 实际 springdoc swagger-config 地址 */
    swaggerConfigUrl?: string;
    [key: string]: unknown;
  };
  /** 其它 Knife4j runtime config 字段允许后续扩展 */
  [key: string]: unknown;
}

export interface SwaggerContact {
  name?: string;
  url?: string;
  email?: string;
  [key: string]: unknown;
}

export interface SwaggerLicense {
  name?: string;
  url?: string;
  identifier?: string;
  [key: string]: unknown;
}

export interface SwaggerInfo {
  title: string;
  version: string;
  summary?: string;
  description?: string;
  termsOfService?: string;
  contact?: SwaggerContact;
  license?: SwaggerLicense;
  [key: string]: unknown;
}

export interface SwaggerServer {
  url: string;
  name?: string;
  description?: string;
}

export interface SwaggerTag {
  name: string;
  description?: string;
  /** Knife4j extension emitted from @ApiSupport.order. */
  'x-order'?: number | string;
}

export interface SchemaObject {
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  example?: unknown;
  examples?: unknown[];
  const?: unknown;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  $ref?: string;
  required?: string[];
  enum?: unknown[];
  prefixItems?: SchemaObject[];
  $defs?: Record<string, SchemaObject>;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  contentMediaType?: string;
  contentEncoding?: string;
  [key: string]: unknown;
}

export interface ExampleObject {
  summary?: string;
  description?: string;
  value?: unknown;
  externalValue?: string;
  $ref?: string;
}

/** OAS 3.1 Reference Object. Only these two annotation siblings are defined. */
export interface ReferenceObject {
  $ref: string;
  summary?: string;
  description?: string;
}

export interface ParameterObject {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie' | 'body' | 'formData';
  required?: boolean;
  description?: string;
  schema?: SchemaObject | boolean;
  content?: Record<
    string,
    {
      schema?: SchemaObject | boolean;
      example?: unknown;
      examples?: Record<string, ExampleObject>;
    }
  >;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
  example?: unknown;
  examples?: Record<string, ExampleObject>;
  deprecated?: boolean;
  type?: string; // OAS2
  format?: string; // OAS2
  $ref?: string;
  summary?: string;
}

export interface RequestBodyObject {
  description?: string;
  required?: boolean;
  content?: Record<
    string,
    {
      schema?: SchemaObject;
      example?: unknown;
      examples?: Record<string, ExampleObject>;
    }
  >;
  $ref?: string;
  summary?: string;
}

export interface ResponseHeaderObject {
  description?: string;
  required?: boolean;
  schema?: SchemaObject;
  example?: unknown;
  $ref?: string;
}

export interface ResponseObject {
  description?: string;
  headers?: Record<string, ResponseHeaderObject>;
  content?: Record<
    string,
    {
      schema?: SchemaObject;
      example?: unknown;
      examples?: Record<string, ExampleObject>;
    }
  >;
  schema?: SchemaObject; // OAS2
  $ref?: string;
  summary?: string;
}

export interface LinkObject {
  operationRef?: string;
  operationId?: string;
  parameters?: Record<string, unknown>;
  requestBody?: unknown;
  description?: string;
  server?: SwaggerServer;
}

export type CallbackObject = Record<string, PathItemObject | ReferenceObject>;

/** OpenAPI securityScheme 定义（OAS3 components.securitySchemes / OAS2 securityDefinitions） */
export interface SecuritySchemeObject {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS';
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
  callbacks?: Record<string, CallbackObject | ReferenceObject>;
  deprecated?: boolean;
  /** operation 级别的 security 声明，每项是 `{ [schemeName]: string[] } */
  security?: Record<string, string[]>[];
  /** OAS3 operation 级 servers */
  servers?: SwaggerServer[];
  /** Knife4j extension emitted from @ApiOperationSupport.order. */
  'x-order'?: number | string;
  /** Knife4j extension emitted from @ApiOperationSupport.author/authors. */
  'x-author'?: string;
  /** Knife4j extension mapping validation group name to required request body fields. */
  'x-validation-groups'?: Record<string, string[]>;
}

export interface PathItemObject {
  $ref?: string;
  summary?: string;
  description?: string;
  parameters?: ParameterObject[];
  /** OAS3 path item 级 servers */
  servers?: SwaggerServer[];
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  delete?: OperationObject;
  patch?: OperationObject;
  head?: OperationObject;
  options?: OperationObject;
  trace?: OperationObject;
  [key: string]: unknown;
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
  paths?: Record<string, PathItemObject>;
  /** OAS 3.1 inbound webhook definitions. */
  webhooks?: Record<string, PathItemObject | ReferenceObject>;
  /** OAS 3.1 default JSON Schema dialect. */
  jsonSchemaDialect?: string;
  /** OAS3 servers */
  servers?: SwaggerServer[];
  /** OAS2 host / basePath / schemes */
  host?: string;
  basePath?: string;
  schemes?: string[];
  components?: {
    schemas?: Record<string, SchemaObject>;
    examples?: Record<string, ExampleObject | ReferenceObject>;
    headers?: Record<string, ResponseHeaderObject | ReferenceObject>;
    parameters?: Record<string, ParameterObject | ReferenceObject>;
    requestBodies?: Record<string, RequestBodyObject | ReferenceObject>;
    responses?: Record<string, ResponseObject | ReferenceObject>;
    pathItems?: Record<string, PathItemObject | ReferenceObject>;
    securitySchemes?: Record<string, SecuritySchemeObject | ReferenceObject>;
    links?: Record<string, LinkObject | ReferenceObject>;
    callbacks?: Record<string, CallbackObject | ReferenceObject>;
  };
  definitions?: Record<string, SchemaObject>; // OAS2
  securityDefinitions?: Record<string, SecuritySchemeObject>; // OAS2
  /** 文档级默认 security */
  security?: Record<string, string[]>[];
  /** knife4j OpenAPI3 extension emitted by the Java starter. */
  'x-openapi'?: {
    'x-setting'?: Record<string, unknown>;
    'x-markdownFiles'?: MarkdownFileGroup[];
    [key: string]: unknown;
  };
  /** Legacy/direct fallback for knife4j custom Markdown docs. */
  'x-markdownFiles'?: MarkdownFileGroup[];
  /** Legacy/direct fallback for knife4j setting extension. */
  'x-setting'?: Record<string, unknown>;
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
  /** Path operations are executable; webhook operations are read-only inbound contracts. */
  source?: 'path' | 'webhook';
  /** Collision-safe identity used in the operation route. */
  routeId?: string;
}

export interface MenuTag {
  tag: string;
  description?: string;
  operations: MenuOperation[];
}
