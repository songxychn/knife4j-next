/**
 * OpenAPI 数据类型定义
 * 兼容 OAS3（/v3/api-docs）和 Swagger2（/v2/api-docs）
 */

export interface SwaggerGroup {
  name: string;
  url: string;       // api-docs 地址
  swaggerVersion?: string;
  location?: string; // swagger-resources 格式
}

export interface SwaggerInfo {
  title: string;
  version: string;
  description?: string;
}

export interface SwaggerTag {
  name: string;
  description?: string;
}

export interface SchemaObject {
  type?: string;
  format?: string;
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
  type?: string;   // OAS2
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

export interface SwaggerDoc {
  openapi?: string;   // OAS3
  swagger?: string;   // OAS2
  info: SwaggerInfo;
  tags?: SwaggerTag[];
  paths: Record<string, PathItemObject>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    securitySchemes?: Record<string, SecuritySchemeObject>;
  };
  definitions?: Record<string, SchemaObject>; // OAS2
  securityDefinitions?: Record<string, SecuritySchemeObject>; // OAS2
  /** 文档级默认 security */
  security?: Record<string, string[]>[];
}

/** 解析后的菜单项（tag + operations） */
export interface MenuOperation {
  key: string;       // e.g. "UserController/getUserById"
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
