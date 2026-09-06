import type { ContactObject, InfoObject, LicenseObject, ServerVariableObject } from '../models/openapi3/types';

/** Raw OAS 3.2 input types. These do not enable any Knife4j consumption workflow. */
export interface Oas32Extensions {
  [name: `x-${string}`]: unknown;
}

export interface Oas32ReferenceObject {
  $ref: string;
  summary?: string;
  description?: string;
}

export interface Oas32ExternalDocumentationObject extends Oas32Extensions {
  url: string;
  description?: string;
}

export interface Oas32XmlObject extends Oas32Extensions {
  nodeType?: 'element' | 'attribute' | 'text' | 'cdata' | 'none';
  name?: string;
  namespace?: string;
  prefix?: string;
  /** Deprecated; mutually exclusive with nodeType. */
  attribute?: boolean;
  /** Deprecated; mutually exclusive with nodeType. */
  wrapped?: boolean;
}

export interface Oas32DiscriminatorObject extends Oas32Extensions {
  propertyName: string;
  mapping?: Record<string, string>;
  defaultMapping?: string;
}

export type Oas32Schema = boolean | Oas32SchemaObject;

/** Additional JSON Schema vocabularies are preserved, not interpreted by the structure collector. */
export interface Oas32SchemaObject {
  [keyword: string]: unknown;
  $schema?: string;
  $id?: string;
  $ref?: string;
  $dynamicRef?: string;
  $anchor?: string;
  $dynamicAnchor?: string;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Oas32Schema>;
  patternProperties?: Record<string, Oas32Schema>;
  dependentSchemas?: Record<string, Oas32Schema>;
  $defs?: Record<string, Oas32Schema>;
  allOf?: Oas32Schema[];
  anyOf?: Oas32Schema[];
  oneOf?: Oas32Schema[];
  prefixItems?: Oas32Schema[];
  items?: Oas32Schema;
  contains?: Oas32Schema;
  additionalProperties?: Oas32Schema;
  unevaluatedProperties?: Oas32Schema;
  unevaluatedItems?: Oas32Schema;
  propertyNames?: Oas32Schema;
  not?: Oas32Schema;
  if?: Oas32Schema;
  then?: Oas32Schema;
  else?: Oas32Schema;
  contentSchema?: Oas32Schema;
  xml?: Oas32XmlObject;
  discriminator?: Oas32DiscriminatorObject;
  externalDocs?: Oas32ExternalDocumentationObject;
}

export interface Oas32ExampleObject extends Oas32Extensions {
  summary?: string;
  description?: string;
  dataValue?: unknown;
  serializedValue?: string;
  externalValue?: string;
  value?: unknown;
}

export type Oas32Examples = Record<string, Oas32ExampleObject | Oas32ReferenceObject>;
export type Oas32Content = Record<string, Oas32MediaTypeObject | Oas32ReferenceObject>;

export interface Oas32MediaTypeObject extends Oas32Extensions {
  schema?: Oas32Schema;
  itemSchema?: Oas32Schema;
  example?: unknown;
  examples?: Oas32Examples;
  encoding?: Record<string, Oas32EncodingObject>;
  prefixEncoding?: Oas32EncodingObject[];
  itemEncoding?: Oas32EncodingObject;
}

export interface Oas32EncodingObject extends Oas32Extensions {
  contentType?: string;
  headers?: Record<string, Oas32HeaderObject | Oas32ReferenceObject>;
  encoding?: Record<string, Oas32EncodingObject>;
  prefixEncoding?: Oas32EncodingObject[];
  itemEncoding?: Oas32EncodingObject;
  style?: 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject';
  explode?: boolean;
  allowReserved?: boolean;
}

export interface Oas32ParameterObject extends Oas32Extensions {
  name: string;
  in: 'path' | 'query' | 'querystring' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  /** schema/content are mutually exclusive; querystring requires content. */
  schema?: Oas32Schema;
  content?: Oas32Content;
  style?: 'matrix' | 'label' | 'simple' | 'form' | 'spaceDelimited' | 'pipeDelimited' | 'deepObject' | 'cookie';
  explode?: boolean;
  allowReserved?: boolean;
  example?: unknown;
  examples?: Oas32Examples;
}

export interface Oas32HeaderObject extends Oas32Extensions {
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema?: Oas32Schema;
  content?: Oas32Content;
  style?: 'simple';
  explode?: boolean;
  example?: unknown;
  examples?: Oas32Examples;
}

export interface Oas32RequestBodyObject extends Oas32Extensions {
  description?: string;
  content: Oas32Content;
  required?: boolean;
}

export interface Oas32LinkObject extends Oas32Extensions {
  operationRef?: string;
  operationId?: string;
  parameters?: Record<string, unknown>;
  requestBody?: unknown;
  description?: string;
  server?: Oas32ServerObject;
}

export interface Oas32ResponseObject extends Oas32Extensions {
  summary?: string;
  description?: string;
  headers?: Record<string, Oas32HeaderObject | Oas32ReferenceObject>;
  content?: Oas32Content;
  links?: Record<string, Oas32LinkObject | Oas32ReferenceObject>;
}

type StatusDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Oas32ResponseKey =
  'default' | `${1 | 2 | 3 | 4 | 5}${StatusDigit}${StatusDigit}` | `${1 | 2 | 3 | 4 | 5}XX`;
export type Oas32ResponsesObject = Partial<Record<Oas32ResponseKey, Oas32ResponseObject | Oas32ReferenceObject>> &
  Oas32Extensions;
/** Callback expressions have arbitrary keys; the collector distinguishes them from x-* extension payloads. */
export type Oas32CallbackObject = Record<string, unknown>;
export type Oas32SecurityRequirementObject = Record<string, string[]>;

export interface Oas32OAuthFlowObject extends Oas32Extensions {
  authorizationUrl?: string;
  deviceAuthorizationUrl?: string;
  tokenUrl?: string;
  refreshUrl?: string;
  scopes: Record<string, string>;
}

export interface Oas32OAuthFlowsObject extends Oas32Extensions {
  implicit?: Oas32OAuthFlowObject & { authorizationUrl: string };
  password?: Oas32OAuthFlowObject & { tokenUrl: string };
  clientCredentials?: Oas32OAuthFlowObject & { tokenUrl: string };
  authorizationCode?: Oas32OAuthFlowObject & { authorizationUrl: string; tokenUrl: string };
  deviceAuthorization?: Oas32OAuthFlowObject & { deviceAuthorizationUrl: string; tokenUrl: string };
}

export interface Oas32SecuritySchemeObject extends Oas32Extensions {
  type: 'apiKey' | 'http' | 'mutualTLS' | 'oauth2' | 'openIdConnect';
  description?: string;
  name?: string;
  in?: 'query' | 'header' | 'cookie';
  scheme?: string;
  bearerFormat?: string;
  flows?: Oas32OAuthFlowsObject;
  openIdConnectUrl?: string;
  oauth2MetadataUrl?: string;
  deprecated?: boolean;
}

export interface Oas32ServerObject extends Oas32Extensions {
  url: string;
  name?: string;
  description?: string;
  variables?: Record<string, ServerVariableObject & Oas32Extensions>;
}

export interface Oas32TagObject extends Oas32Extensions {
  name: string;
  summary?: string;
  description?: string;
  parent?: string;
  kind?: string;
  externalDocs?: Oas32ExternalDocumentationObject;
}

export interface Oas32OperationObject extends Oas32Extensions {
  tags?: string[];
  summary?: string;
  description?: string;
  externalDocs?: Oas32ExternalDocumentationObject;
  operationId?: string;
  parameters?: Array<Oas32ParameterObject | Oas32ReferenceObject>;
  requestBody?: Oas32RequestBodyObject | Oas32ReferenceObject;
  /** Optional in OAS 3.2; an explicitly supplied Responses Object cannot be empty. */
  responses?: Oas32ResponsesObject;
  callbacks?: Record<string, Oas32CallbackObject | Oas32ReferenceObject>;
  deprecated?: boolean;
  security?: Oas32SecurityRequirementObject[];
  servers?: Oas32ServerObject[];
}

export interface Oas32PathItemObject extends Oas32Extensions {
  $ref?: string;
  summary?: string;
  description?: string;
  get?: Oas32OperationObject;
  put?: Oas32OperationObject;
  post?: Oas32OperationObject;
  delete?: Oas32OperationObject;
  options?: Oas32OperationObject;
  head?: Oas32OperationObject;
  patch?: Oas32OperationObject;
  trace?: Oas32OperationObject;
  query?: Oas32OperationObject;
  additionalOperations?: Record<string, Oas32OperationObject>;
  parameters?: Array<Oas32ParameterObject | Oas32ReferenceObject>;
  servers?: Oas32ServerObject[];
}

export interface Oas32ComponentsObject extends Oas32Extensions {
  schemas?: Record<string, Oas32Schema>;
  responses?: Record<string, Oas32ResponseObject | Oas32ReferenceObject>;
  parameters?: Record<string, Oas32ParameterObject | Oas32ReferenceObject>;
  examples?: Oas32Examples;
  requestBodies?: Record<string, Oas32RequestBodyObject | Oas32ReferenceObject>;
  headers?: Record<string, Oas32HeaderObject | Oas32ReferenceObject>;
  securitySchemes?: Record<string, Oas32SecuritySchemeObject | Oas32ReferenceObject>;
  links?: Record<string, Oas32LinkObject | Oas32ReferenceObject>;
  callbacks?: Record<string, Oas32CallbackObject | Oas32ReferenceObject>;
  pathItems?: Record<string, Oas32PathItemObject>;
  mediaTypes?: Oas32Content;
}

export interface Oas32Document extends Oas32Extensions {
  openapi: string;
  $self?: string;
  info: Omit<InfoObject, 'contact' | 'license'> &
    Oas32Extensions & {
      contact?: ContactObject & Oas32Extensions;
      license?: LicenseObject & Oas32Extensions;
    };
  jsonSchemaDialect?: string;
  servers?: Oas32ServerObject[];
  paths?: { [path: `/${string}`]: Oas32PathItemObject } & Oas32Extensions;
  webhooks?: Record<string, Oas32PathItemObject>;
  components?: Oas32ComponentsObject;
  security?: Oas32SecurityRequirementObject[];
  tags?: Oas32TagObject[];
  externalDocs?: Oas32ExternalDocumentationObject;
}
