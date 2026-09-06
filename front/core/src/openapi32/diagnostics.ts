import { escapeJsonPointerSegment, resolveLocalJsonPointer } from '../openapi31/document';
import { getOpenApiSpecificationFeatures, getOpenApiStandardHttpMethods } from '../openapiVersion';

export const OAS32_SCHEMA_HELPER_VERSION = 'https://spec.openapis.org/oas/3.2/schema/2025-11-23';

const STANDARD_METHODS = getOpenApiStandardHttpMethods('3.2.0') ?? [];
const RESERVED_METHODS = new Set(STANDARD_METHODS.map((method) => method.toUpperCase()));
const METHOD_TOKEN = /^[a-zA-Z0-9!#$%&'*+.^_`|~-]+$/;
const RESPONSE_KEY = /^(?:default|[1-5](?:[0-9]{2}|XX))$/;
const COMPONENT_NAME = /^[a-zA-Z0-9._-]+$/;

const COMPONENT_KINDS = {
  schemas: 'schema',
  responses: 'response',
  parameters: 'parameter',
  examples: 'example',
  requestBodies: 'requestBody',
  headers: 'header',
  securitySchemes: 'securityScheme',
  links: 'link',
  callbacks: 'callback',
  pathItems: 'pathItem',
  mediaTypes: 'mediaType',
} as const;

const fields = (...names: string[]): readonly string[] => Object.freeze(names);

/**
 * Dependency-free structural projection of the pinned helper, corrected against
 * the OAS 3.2.0 normative text. This is not a JSON Schema validator. In particular:
 * - Media Type has no description field in the normative text;
 * - Discriminator.propertyName remains required;
 * - Link.parameters accepts arbitrary literal values, not just strings.
 */
export const OAS32_STRUCTURE_HELPER = Object.freeze({
  $id: OAS32_SCHEMA_HELPER_VERSION,
  objects: Object.freeze({
    document: fields(
      'openapi',
      '$self',
      'info',
      'jsonSchemaDialect',
      'servers',
      'paths',
      'webhooks',
      'components',
      'security',
      'tags',
      'externalDocs',
    ),
    info: fields('title', 'summary', 'description', 'termsOfService', 'contact', 'license', 'version'),
    contact: fields('name', 'url', 'email'),
    license: fields('name', 'identifier', 'url'),
    server: fields('url', 'name', 'description', 'variables'),
    serverVariable: fields('enum', 'default', 'description'),
    components: fields(...Object.keys(COMPONENT_KINDS)),
    pathItem: fields(
      '$ref',
      'summary',
      'description',
      'servers',
      'parameters',
      ...STANDARD_METHODS,
      'additionalOperations',
    ),
    operation: fields(
      'tags',
      'summary',
      'description',
      'externalDocs',
      'operationId',
      'parameters',
      'requestBody',
      'responses',
      'callbacks',
      'deprecated',
      'security',
      'servers',
    ),
    parameter: fields(
      'name',
      'in',
      'description',
      'required',
      'deprecated',
      'allowEmptyValue',
      'schema',
      'content',
      'style',
      'explode',
      'allowReserved',
      'example',
      'examples',
    ),
    header: fields(
      'description',
      'required',
      'deprecated',
      'schema',
      'content',
      'style',
      'explode',
      'example',
      'examples',
    ),
    requestBody: fields('description', 'content', 'required'),
    response: fields('summary', 'description', 'headers', 'content', 'links'),
    mediaType: fields('schema', 'itemSchema', 'example', 'examples', 'encoding', 'prefixEncoding', 'itemEncoding'),
    encoding: fields(
      'contentType',
      'headers',
      'encoding',
      'prefixEncoding',
      'itemEncoding',
      'style',
      'explode',
      'allowReserved',
    ),
    example: fields('summary', 'description', 'value', 'dataValue', 'serializedValue', 'externalValue'),
    link: fields('operationRef', 'operationId', 'parameters', 'requestBody', 'description', 'server'),
    securityScheme: fields(
      'type',
      'description',
      'name',
      'in',
      'scheme',
      'bearerFormat',
      'flows',
      'openIdConnectUrl',
      'oauth2MetadataUrl',
      'deprecated',
    ),
    oauthFlows: fields('implicit', 'password', 'clientCredentials', 'authorizationCode', 'deviceAuthorization'),
    oauthFlow: fields('authorizationUrl', 'deviceAuthorizationUrl', 'tokenUrl', 'refreshUrl', 'scopes'),
    tag: fields('name', 'summary', 'description', 'externalDocs', 'parent', 'kind'),
    externalDocs: fields('description', 'url'),
    discriminator: fields('propertyName', 'mapping', 'defaultMapping'),
    xml: fields('nodeType', 'name', 'namespace', 'prefix', 'attribute', 'wrapped'),
  }),
});

type RecordValue = Record<string, unknown>;
type ObjectKind = keyof typeof OAS32_STRUCTURE_HELPER.objects | 'schema' | 'callback';
type ReferenceKind = (typeof COMPONENT_KINDS)[keyof typeof COMPONENT_KINDS];
interface LocatedObject {
  value: RecordValue;
  path: string;
  kind: ObjectKind;
}
interface LocatedValue {
  value: unknown;
  path: string;
}

export type Oas32DocumentDiagnosticCode =
  | 'invalid-field-type'
  | 'invalid-field-value'
  | 'missing-required-field'
  | 'mutually-exclusive-fields'
  | 'unknown-field'
  | 'invalid-component-name'
  | 'invalid-path-key'
  | 'invalid-response-key'
  | 'invalid-http-method'
  | 'reserved-http-method'
  | 'duplicate-parameter'
  | 'query-querystring-conflict'
  | 'multiple-querystring-parameters'
  | 'duplicate-tag'
  | 'unknown-parent-tag'
  | 'tag-parent-cycle'
  | 'reference-sibling-ignored'
  | 'unresolved-local-reference'
  | 'reference-target-type-mismatch'
  | 'reference-cycle'
  | 'reference-depth-exceeded'
  | 'path-item-reference-conflict'
  | 'structure-limit-exceeded';

export interface Oas32DocumentDiagnostic {
  code: Oas32DocumentDiagnosticCode;
  path: string;
  reason: string;
}

const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const owns = (object: RecordValue, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
const child = (path: string, key: string | number): string => `${path}/${escapeJsonPointerSegment(String(key))}`;

const SCHEMA_SINGLE = fields(
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  'propertyNames',
  'items',
  'contains',
  'not',
  'if',
  'then',
  'else',
  'contentSchema',
);
const SCHEMA_ARRAY = fields('allOf', 'anyOf', 'oneOf', 'prefixItems');
const SCHEMA_MAP = fields('$defs', 'properties', 'patternProperties', 'dependentSchemas');
const REFERENCE_FIELDS = fields('$ref', 'summary', 'description');
const REFERENCE_KINDS = new Set<ObjectKind>([
  'response',
  'parameter',
  'example',
  'requestBody',
  'header',
  'securityScheme',
  'link',
  'callback',
  'mediaType',
]);

class StructureCollector {
  readonly diagnostics: Oas32DocumentDiagnostic[] = [];
  private readonly identities = new Set<string>();
  private readonly nodes = new Map<string, LocatedObject>();
  private readonly nodeKinds = new Map<string, ObjectKind>();
  private readonly references: LocatedObject[] = [];
  private readonly pathItems: LocatedObject[] = [];
  private readonly parameterLists: LocatedValue[] = [];
  private readonly active = new WeakSet<object>();
  private depth = 0;
  private visits = 0;

  constructor(private readonly document: RecordValue) {}

  collect(): Oas32DocumentDiagnostic[] {
    this.visit('document', this.document, '#');
    this.references.forEach((reference) => this.localReference(reference, reference.kind as ReferenceKind));
    this.parameterLists.forEach((list) => this.checkParameters(this.parameters(list), true));
    this.pathItems.forEach((pathItem) => this.checkEffectiveParameters(pathItem));
    this.checkTags();
    return this.diagnostics;
  }

  private add(code: Oas32DocumentDiagnosticCode, path: string, reason: string): void {
    const identity = `${code}:${path}`;
    if (this.identities.has(identity)) return;
    this.identities.add(identity);
    this.diagnostics.push({ code, path, reason });
  }

  private record(value: unknown, path: string): value is RecordValue {
    if (isRecord(value)) return true;
    this.add('invalid-field-type', path, '此规范对象必须是非数组对象');
    return false;
  }

  private scalar(object: RecordValue, path: string, key: string, type: 'string' | 'boolean', required = false): void {
    if (!owns(object, key)) {
      if (required) this.add('missing-required-field', child(path, key), `缺少必填字段 ${key}`);
    } else if (typeof object[key] !== type) {
      this.add('invalid-field-type', child(path, key), `${key} 必须是 ${type}`);
    }
  }

  private strings(object: RecordValue, path: string, names: readonly string[]): void {
    names.forEach((key) => this.scalar(object, path, key, 'string'));
  }

  private booleans(object: RecordValue, path: string, names: readonly string[]): void {
    names.forEach((key) => this.scalar(object, path, key, 'boolean'));
  }

  private enumeration(object: RecordValue, path: string, key: string, values: readonly string[]): void {
    if (owns(object, key) && typeof object[key] === 'string' && !values.includes(object[key] as string)) {
      this.add('invalid-field-value', child(path, key), `${key} 的值必须是 ${values.join('、')} 之一`);
    }
  }

  private exclusive(object: RecordValue, path: string, left: string, right: string): void {
    if (owns(object, left) && owns(object, right)) {
      this.add('mutually-exclusive-fields', path, `${left} 与 ${right} 不能同时出现`);
    }
  }

  private array(value: unknown, path: string, visit: (item: unknown, itemPath: string) => void): void {
    if (!Array.isArray(value)) {
      this.add('invalid-field-type', path, '此字段必须是数组');
      return;
    }
    value.forEach((item, index) => visit(item, child(path, index)));
  }

  private stringArray(value: unknown, path: string): void {
    this.array(value, path, (item, itemPath) => {
      if (typeof item !== 'string') this.add('invalid-field-type', itemPath, '数组成员必须是字符串');
    });
  }

  private stringMap(value: unknown, path: string): void {
    if (!this.record(value, path)) return;
    Object.entries(value).forEach(([key, item]) => {
      if (typeof item !== 'string') this.add('invalid-field-type', child(path, key), '映射值必须是字符串');
    });
  }

  /** Maps have literal user-defined keys; x-* entries in these maps are not extensions. */
  private map(value: unknown, path: string, kind: ObjectKind): void {
    if (!this.record(value, path)) return;
    Object.entries(value).forEach(([key, item]) => this.visit(kind, item, child(path, key)));
  }

  private field(object: RecordValue, path: string, key: string, kind: ObjectKind): void {
    if (owns(object, key)) this.visit(kind, object[key], child(path, key));
  }

  private mapField(object: RecordValue, path: string, key: string, kind: ObjectKind): void {
    if (owns(object, key)) this.map(object[key], child(path, key), kind);
  }

  private arrayField(object: RecordValue, path: string, key: string, kind: ObjectKind): void {
    if (owns(object, key))
      this.array(object[key], child(path, key), (item, itemPath) => this.visit(kind, item, itemPath));
  }

  private knownFields(kind: Exclude<ObjectKind, 'schema' | 'callback'>, object: RecordValue, path: string): void {
    const allowed = OAS32_STRUCTURE_HELPER.objects[kind];
    Object.keys(object).forEach((key) => {
      if (!key.startsWith('x-') && !allowed.includes(key)) {
        this.add('unknown-field', child(path, key), `${key} 不属于 OAS 3.2 ${kind} 对象；载荷不作递归解释`);
      }
    });
  }

  private visit(kind: ObjectKind, value: unknown, path: string): void {
    this.nodeKinds.set(path, kind);
    if (kind === 'schema' && typeof value === 'boolean') return;
    if (!this.record(value, path)) return;
    if (this.active.has(value) || this.depth >= 256 || ++this.visits > 100000) {
      this.add('structure-limit-exceeded', path, '结构遍历遇到循环、过深嵌套或超出对象数量预算');
      return;
    }
    this.active.add(value);
    this.depth++;
    try {
      const location = { kind, value, path };
      this.nodes.set(path, location);
      if (REFERENCE_KINDS.has(kind) && owns(value, '$ref')) {
        this.reference(location);
        return;
      }
      if (kind !== 'schema' && kind !== 'callback') this.knownFields(kind, value, path);
      this.inspect(location);
    } finally {
      this.depth--;
      this.active.delete(value);
    }
  }

  private reference(location: LocatedObject): void {
    const { value, path } = location;
    this.scalar(value, path, '$ref', 'string', true);
    this.strings(value, path, ['summary', 'description']);
    Object.keys(value).forEach((key) => {
      if (!REFERENCE_FIELDS.includes(key)) {
        this.add(
          'reference-sibling-ignored',
          child(path, key),
          'Reference Object 只定义 $ref、summary 和 description；其余载荷不参与解析',
        );
      }
    });
    this.references.push(location);
  }

  private examples(object: RecordValue, path: string): void {
    this.exclusive(object, path, 'example', 'examples');
    this.mapField(object, path, 'examples', 'example');
  }

  private encoding(object: RecordValue, path: string): void {
    this.exclusive(object, path, 'encoding', 'prefixEncoding');
    this.exclusive(object, path, 'encoding', 'itemEncoding');
    this.mapField(object, path, 'encoding', 'encoding');
    this.arrayField(object, path, 'prefixEncoding', 'encoding');
    this.field(object, path, 'itemEncoding', 'encoding');
  }

  private parameterArray(object: RecordValue, path: string): void {
    if (!owns(object, 'parameters')) return;
    const list = { value: object.parameters, path: child(path, 'parameters') };
    this.parameterLists.push(list);
    this.array(list.value, list.path, (item, itemPath) => this.visit('parameter', item, itemPath));
  }

  private security(value: unknown, path: string): void {
    this.array(value, path, (requirement, itemPath) => {
      if (!this.record(requirement, itemPath)) return;
      // Names and URIs are both permitted. No identity resolution or network access here.
      Object.entries(requirement).forEach(([key, scopes]) => this.stringArray(scopes, child(itemPath, key)));
    });
  }

  private inspect({ kind, value: object, path }: LocatedObject): void {
    switch (kind) {
      case 'document':
        // info is mandatory but deliberately not normalized or replaced.
        if (!owns(object, 'info')) this.add('missing-required-field', '#/info', 'OpenAPI 文档缺少 info');
        this.field(object, path, 'info', 'info');
        this.strings(object, path, ['$self', 'jsonSchemaDialect']);
        if (!['paths', 'components', 'webhooks'].some((key) => owns(object, key)))
          this.add('missing-required-field', '#', 'OAS 3.2 文档至少需要 paths、components 或 webhooks 之一');
        if (owns(object, 'paths') && this.record(object.paths, '#/paths')) {
          Object.entries(object.paths).forEach(([name, item]) => {
            if (name.startsWith('x-')) return;
            if (!name.startsWith('/')) this.add('invalid-path-key', child('#/paths', name), '路径字段必须以 / 开头');
            else this.visit('pathItem', item, child('#/paths', name));
          });
        }
        this.mapField(object, path, 'webhooks', 'pathItem');
        this.field(object, path, 'components', 'components');
        this.arrayField(object, path, 'tags', 'tag');
        this.arrayField(object, path, 'servers', 'server');
        this.field(object, path, 'externalDocs', 'externalDocs');
        if (owns(object, 'security')) this.security(object.security, '#/security');
        break;
      case 'info':
        this.scalar(object, path, 'title', 'string', true);
        this.scalar(object, path, 'version', 'string', true);
        this.strings(object, path, ['summary', 'description', 'termsOfService']);
        this.field(object, path, 'contact', 'contact');
        this.field(object, path, 'license', 'license');
        break;
      case 'contact':
        this.strings(object, path, ['name', 'url', 'email']);
        break;
      case 'license':
        this.scalar(object, path, 'name', 'string', true);
        this.strings(object, path, ['identifier', 'url']);
        this.exclusive(object, path, 'identifier', 'url');
        break;
      case 'server':
        this.scalar(object, path, 'url', 'string', true);
        this.strings(object, path, ['name', 'description']);
        this.mapField(object, path, 'variables', 'serverVariable');
        break;
      case 'serverVariable':
        this.scalar(object, path, 'default', 'string', true);
        this.scalar(object, path, 'description', 'string');
        if (owns(object, 'enum')) {
          this.stringArray(object.enum, child(path, 'enum'));
          if (
            Array.isArray(object.enum) &&
            (!object.enum.length || (typeof object.default === 'string' && !object.enum.includes(object.default)))
          )
            this.add('invalid-field-value', child(path, 'enum'), 'Server Variable enum 必须非空且包含 default');
        }
        break;
      case 'components':
        Object.entries(COMPONENT_KINDS).forEach(([section, target]) => {
          if (!owns(object, section)) return;
          const sectionPath = child(path, section);
          if (!this.record(object[section], sectionPath)) return;
          Object.entries(object[section] as RecordValue).forEach(([name, value]) => {
            const entryPath = child(sectionPath, name);
            if (!COMPONENT_NAME.test(name))
              this.add('invalid-component-name', entryPath, '组件名只能包含字母、数字、点、连字符和下划线');
            this.visit(target, value, entryPath);
          });
        });
        break;
      case 'pathItem':
        this.pathItems.push({ kind, value: object, path });
        this.strings(object, path, ['$ref', 'summary', 'description']);
        if (owns(object, '$ref')) this.references.push({ kind, value: object, path });
        this.parameterArray(object, path);
        this.arrayField(object, path, 'servers', 'server');
        STANDARD_METHODS.forEach((method) => this.field(object, path, method, 'operation'));
        if (
          owns(object, 'additionalOperations') &&
          this.record(object.additionalOperations, child(path, 'additionalOperations'))
        ) {
          Object.entries(object.additionalOperations).forEach(([method, operation]) => {
            const operationPath = child(child(path, 'additionalOperations'), method);
            if (!METHOD_TOKEN.test(method))
              this.add('invalid-http-method', operationPath, 'HTTP 方法必须符合 RFC 9110 token 语法');
            else if (RESERVED_METHODS.has(method))
              this.add('reserved-http-method', operationPath, `${method} 必须使用对应的固定 Path Item 字段`);
            else this.visit('operation', operation, operationPath);
          });
        }
        break;
      case 'operation':
        this.strings(object, path, ['summary', 'description', 'operationId']);
        this.booleans(object, path, ['deprecated']);
        if (owns(object, 'tags')) this.stringArray(object.tags, child(path, 'tags'));
        this.parameterArray(object, path);
        this.field(object, path, 'requestBody', 'requestBody');
        this.field(object, path, 'externalDocs', 'externalDocs');
        this.mapField(object, path, 'callbacks', 'callback');
        this.arrayField(object, path, 'servers', 'server');
        if (owns(object, 'security')) this.security(object.security, child(path, 'security'));
        if (owns(object, 'responses') && this.record(object.responses, child(path, 'responses'))) {
          const entries = Object.entries(object.responses);
          if (!entries.some(([key]) => RESPONSE_KEY.test(key)))
            this.add(
              'missing-required-field',
              child(path, 'responses'),
              '已声明的 Responses Object 至少需要一个状态码、范围或 default',
            );
          entries.forEach(([key, response]) => {
            if (key.startsWith('x-')) return;
            if (!RESPONSE_KEY.test(key))
              this.add('invalid-response-key', child(child(path, 'responses'), key), '无效的响应状态码字段');
            else this.visit('response', response, child(child(path, 'responses'), key));
          });
        }
        break;
      case 'parameter':
      case 'header':
        this.parameter(object, path, kind);
        break;
      case 'requestBody':
        this.scalar(object, path, 'description', 'string');
        this.scalar(object, path, 'required', 'boolean');
        if (!owns(object, 'content'))
          this.add('missing-required-field', child(path, 'content'), 'Request Body 缺少 content');
        this.mapField(object, path, 'content', 'mediaType');
        break;
      case 'response':
        this.strings(object, path, ['summary', 'description']);
        this.mapField(object, path, 'headers', 'header');
        this.mapField(object, path, 'content', 'mediaType');
        this.mapField(object, path, 'links', 'link');
        break;
      case 'mediaType':
        this.field(object, path, 'schema', 'schema');
        this.field(object, path, 'itemSchema', 'schema');
        this.examples(object, path);
        this.encoding(object, path);
        break;
      case 'encoding':
        this.strings(object, path, ['contentType', 'style']);
        this.booleans(object, path, ['explode', 'allowReserved']);
        this.enumeration(object, path, 'style', ['form', 'spaceDelimited', 'pipeDelimited', 'deepObject']);
        this.mapField(object, path, 'headers', 'header');
        this.encoding(object, path);
        break;
      case 'example':
        this.strings(object, path, ['summary', 'description', 'externalValue', 'serializedValue']);
        ['dataValue', 'serializedValue', 'externalValue'].forEach((key) => this.exclusive(object, path, 'value', key));
        this.exclusive(object, path, 'serializedValue', 'externalValue');
        break;
      case 'callback':
        Object.entries(object).forEach(([expression, value]) => {
          if (!expression.startsWith('x-')) this.visit('pathItem', value, child(path, expression));
        });
        break;
      case 'link':
        this.strings(object, path, ['operationRef', 'operationId', 'description']);
        this.exclusive(object, path, 'operationRef', 'operationId');
        if (owns(object, 'parameters')) this.record(object.parameters, child(path, 'parameters'));
        this.field(object, path, 'server', 'server');
        break;
      case 'securityScheme':
        this.securityScheme(object, path);
        break;
      case 'oauthFlows':
        OAS32_STRUCTURE_HELPER.objects.oauthFlows.forEach((flow) => {
          if (!owns(object, flow)) return;
          const flowPath = child(path, flow);
          this.visit('oauthFlow', object[flow], flowPath);
          const value = object[flow];
          if (!isRecord(value)) return;
          if (flow === 'implicit' || flow === 'authorizationCode')
            this.scalar(value, flowPath, 'authorizationUrl', 'string', true);
          if (flow !== 'implicit') this.scalar(value, flowPath, 'tokenUrl', 'string', true);
          if (flow === 'deviceAuthorization') this.scalar(value, flowPath, 'deviceAuthorizationUrl', 'string', true);
        });
        break;
      case 'oauthFlow':
        this.strings(object, path, ['authorizationUrl', 'deviceAuthorizationUrl', 'tokenUrl', 'refreshUrl']);
        if (!owns(object, 'scopes'))
          this.add('missing-required-field', child(path, 'scopes'), 'OAuth Flow 缺少 scopes');
        else this.stringMap(object.scopes, child(path, 'scopes'));
        break;
      case 'tag':
        this.scalar(object, path, 'name', 'string', true);
        this.strings(object, path, ['summary', 'description', 'parent', 'kind']);
        this.field(object, path, 'externalDocs', 'externalDocs');
        break;
      case 'externalDocs':
        this.scalar(object, path, 'url', 'string', true);
        this.scalar(object, path, 'description', 'string');
        break;
      case 'schema':
        this.schema(object, path);
        break;
      case 'xml':
        this.strings(object, path, ['nodeType', 'name', 'namespace', 'prefix']);
        this.booleans(object, path, ['attribute', 'wrapped']);
        this.enumeration(object, path, 'nodeType', ['element', 'attribute', 'text', 'cdata', 'none']);
        this.exclusive(object, path, 'nodeType', 'attribute');
        this.exclusive(object, path, 'nodeType', 'wrapped');
        if (typeof object.namespace === 'string' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(object.namespace))
          this.add('invalid-field-value', child(path, 'namespace'), 'XML namespace 必须是非相对 IRI');
        break;
      case 'discriminator':
        this.scalar(object, path, 'propertyName', 'string', true);
        this.scalar(object, path, 'defaultMapping', 'string');
        if (owns(object, 'mapping')) this.stringMap(object.mapping, child(path, 'mapping'));
        break;
    }
  }

  private parameter(object: RecordValue, path: string, kind: 'parameter' | 'header'): void {
    this.strings(object, path, ['description', 'style']);
    this.booleans(object, path, ['required', 'deprecated', 'explode']);
    if (kind === 'parameter') {
      this.scalar(object, path, 'allowReserved', 'boolean');
      this.scalar(object, path, 'name', 'string', true);
      this.scalar(object, path, 'in', 'string', true);
      this.scalar(object, path, 'allowEmptyValue', 'boolean');
      this.enumeration(object, path, 'in', ['path', 'query', 'querystring', 'header', 'cookie']);
      if (object.in === 'path' && object.required !== true)
        this.add('invalid-field-value', child(path, 'required'), 'Path 参数的 required 必须是 true');
      if (owns(object, 'allowEmptyValue') && object.in !== 'query')
        this.add('invalid-field-value', child(path, 'allowEmptyValue'), 'allowEmptyValue 仅适用于 query 参数');
    }
    this.exclusive(object, path, 'schema', 'content');
    if (!owns(object, 'schema') && !owns(object, 'content'))
      this.add('missing-required-field', path, 'Parameter/Header 必须提供 schema 或 content');
    if (kind === 'parameter' && object.in === 'querystring' && !owns(object, 'content'))
      this.add('missing-required-field', child(path, 'content'), 'querystring 参数必须使用 content');
    if (owns(object, 'content')) {
      this.mapField(object, path, 'content', 'mediaType');
      if (isRecord(object.content) && Object.keys(object.content).length !== 1)
        this.add('invalid-field-value', child(path, 'content'), 'Parameter/Header content 必须恰有一个媒体类型');
    }
    if (owns(object, 'content') || (kind === 'parameter' && object.in === 'querystring')) {
      ['schema', 'style', 'explode', 'allowReserved'].forEach((key) => {
        if (owns(object, key))
          this.add('invalid-field-value', child(path, key), `${key} 不能用于 content 或 querystring 参数`);
      });
    }
    const location = kind === 'header' ? 'header' : object.in;
    const styles: Record<string, string[]> = {
      path: ['matrix', 'label', 'simple'],
      query: ['form', 'spaceDelimited', 'pipeDelimited', 'deepObject'],
      header: ['simple'],
      cookie: ['form', 'cookie'],
      querystring: [],
    };
    if (typeof location === 'string' && owns(styles, location))
      this.enumeration(object, path, 'style', styles[location]);
    this.field(object, path, 'schema', 'schema');
    this.examples(object, path);
  }

  private securityScheme(object: RecordValue, path: string): void {
    this.scalar(object, path, 'type', 'string', true);
    this.strings(object, path, [
      'description',
      'name',
      'in',
      'scheme',
      'bearerFormat',
      'openIdConnectUrl',
      'oauth2MetadataUrl',
    ]);
    this.scalar(object, path, 'deprecated', 'boolean');
    this.enumeration(object, path, 'type', ['apiKey', 'http', 'mutualTLS', 'oauth2', 'openIdConnect']);
    if (object.type === 'apiKey') {
      this.scalar(object, path, 'name', 'string', true);
      this.scalar(object, path, 'in', 'string', true);
      this.enumeration(object, path, 'in', ['query', 'header', 'cookie']);
    }
    if (object.type === 'http') this.scalar(object, path, 'scheme', 'string', true);
    if (object.type === 'openIdConnect') this.scalar(object, path, 'openIdConnectUrl', 'string', true);
    if (object.type === 'oauth2' && !owns(object, 'flows'))
      this.add('missing-required-field', child(path, 'flows'), 'OAuth2 Security Scheme 缺少 flows');
    this.field(object, path, 'flows', 'oauthFlows');
  }

  private schema(object: RecordValue, path: string): void {
    // Only the known Schema positions and OAS metadata are traversed. No $ref,
    // $id, dialect resolution, instance evaluation or unknown vocabulary execution.
    this.field(object, path, 'xml', 'xml');
    this.field(object, path, 'discriminator', 'discriminator');
    this.field(object, path, 'externalDocs', 'externalDocs');
    SCHEMA_SINGLE.forEach((key) => this.field(object, path, key, 'schema'));
    SCHEMA_ARRAY.forEach((key) => {
      if (Array.isArray(object[key])) this.arrayField(object, path, key, 'schema');
    });
    SCHEMA_MAP.forEach((key) => {
      if (isRecord(object[key])) this.mapField(object, path, key, 'schema');
    });
  }

  private localReference(location: LocatedObject, kind: ReferenceKind): LocatedObject | null {
    let current = location;
    const seen = new Set<string>();
    for (let depth = 0; depth < 20; depth++) {
      if (!owns(current.value, '$ref')) return current;
      const ref = current.value.$ref;
      if (typeof ref !== 'string' || !ref.startsWith('#')) return null;
      if (seen.has(ref)) {
        this.add('reference-cycle', child(location.path, '$ref'), '本地对象引用形成循环');
        return null;
      }
      seen.add(ref);
      const target = resolveLocalJsonPointer(this.document, ref);
      if (!target.found) {
        this.add('unresolved-local-reference', child(location.path, '$ref'), '本地 JSON Pointer 非法或目标不存在');
        return null;
      }
      const pointer = (target.tokens ?? []).reduce((result, token) => child(result, token), '#');
      const indexed = this.nodes.get(pointer);
      // Do not promote a value in an example/extension/unknown payload into an OAS object.
      if (!indexed) {
        if (this.nodeKinds.has(pointer)) {
          this.add('reference-target-type-mismatch', child(location.path, '$ref'), `引用目标必须是 ${kind} 对象`);
        }
        return null;
      }
      if (indexed.kind !== kind) {
        this.add(
          'reference-target-type-mismatch',
          child(location.path, '$ref'),
          `需要 ${kind}，本地规范位置属于 ${indexed.kind}`,
        );
        return null;
      }
      current = indexed;
    }
    if (!owns(current.value, '$ref')) return current;
    this.add('reference-depth-exceeded', child(location.path, '$ref'), '本地对象引用链超过 20 层');
    return null;
  }

  private parameters(list: LocatedValue): LocatedObject[] {
    if (!Array.isArray(list.value)) return [];
    const result: LocatedObject[] = [];
    list.value.forEach((value, index) => {
      const path = child(list.path, index);
      const node = this.nodes.get(path);
      if (!isRecord(value) || node?.kind !== 'parameter') return;
      const resolved = owns(value, '$ref') ? this.localReference(node, 'parameter') : node;
      if (resolved) result.push({ ...resolved, path });
    });
    return result;
  }

  private identity(parameter: LocatedObject): string | null {
    const { name, in: location } = parameter.value;
    // Parameter declaration names are case-sensitive (4.12.2.1). HTTP header
    // field matching belongs to the consumer, not this structural identity.
    return typeof name === 'string' && typeof location === 'string' ? `${location}\u0000${name}` : null;
  }

  private checkParameters(parameters: LocatedObject[], duplicates: boolean): void {
    const seen = new Set<string>();
    parameters.forEach((parameter) => {
      const identity = this.identity(parameter);
      if (identity === null) return;
      if (duplicates && seen.has(identity))
        this.add('duplicate-parameter', parameter.path, '参数列表中重复声明相同位置和名称的参数');
      seen.add(identity);
    });
    const querystrings = parameters.filter((parameter) => parameter.value.in === 'querystring');
    querystrings
      .slice(1)
      .forEach((parameter) =>
        this.add('multiple-querystring-parameters', parameter.path, '有效参数集合最多允许一个 querystring 参数'),
      );
    if (parameters.some((parameter) => parameter.value.in === 'query')) {
      querystrings.forEach((parameter) =>
        this.add('query-querystring-conflict', parameter.path, '有效参数集合不能同时包含 query 和 querystring 参数'),
      );
    }
  }

  private pathItemFields(location: LocatedObject, seen = new Set<string>()): Record<string, LocatedValue> | null {
    const own = Object.fromEntries(
      Object.entries(location.value)
        .filter(([key]) => key !== '$ref')
        .map(([key, value]) => [key, { value, path: child(location.path, key) }]),
    );
    const ref = location.value.$ref;
    if (typeof ref !== 'string' || !ref.startsWith('#')) return own;
    if (seen.has(ref) || seen.size >= 20) return null;
    const target = resolveLocalJsonPointer(this.document, ref);
    if (!target.found) return null;
    const pointer = (target.tokens ?? []).reduce((result, token) => child(result, token), '#');
    const targetNode = this.nodes.get(pointer);
    if (targetNode?.kind !== 'pathItem') return null;
    const inherited = this.pathItemFields(targetNode, new Set([...Array.from(seen), ref]));
    if (!inherited) return null;
    const overlaps = Object.keys(own).filter((key) => Object.prototype.hasOwnProperty.call(inherited, key));
    if (overlaps.length) {
      this.add(
        'path-item-reference-conflict',
        location.path,
        `Path Item $ref 与本地字段重叠，规范未定义合并结果：${overlaps.join('、')}`,
      );
      return null;
    }
    return { ...inherited, ...own };
  }

  private checkEffectiveParameters(pathItem: LocatedObject): void {
    const fields = this.pathItemFields(pathItem);
    if (!fields) return;
    const inherited = fields.parameters ? this.parameters(fields.parameters) : [];
    const operations = STANDARD_METHODS.flatMap((method) => (fields[method] ? [fields[method]] : []));
    const additional = fields.additionalOperations;
    if (additional && isRecord(additional.value)) {
      Object.entries(additional.value).forEach(([method, value]) => {
        if (METHOD_TOKEN.test(method) && !RESERVED_METHODS.has(method))
          operations.push({ value, path: child(additional.path, method) });
      });
    }
    operations.forEach((operation) => {
      if (!isRecord(operation.value)) return;
      const parameters = this.parameters({
        value: operation.value.parameters,
        path: child(operation.path, 'parameters'),
      });
      const effective = new Map<string, LocatedObject>();
      [...inherited, ...parameters].forEach((parameter) => {
        const identity = this.identity(parameter);
        if (identity !== null) effective.set(identity, parameter);
      });
      this.checkParameters(Array.from(effective.values()), false);
    });
  }

  private checkTags(): void {
    if (!Array.isArray(this.document.tags)) return;
    const tags = new Map<string, LocatedObject>();
    this.document.tags.forEach((value, index) => {
      if (!isRecord(value) || typeof value.name !== 'string') return;
      const path = child('#/tags', index);
      if (tags.has(value.name)) this.add('duplicate-tag', child(path, 'name'), 'Tag 名称必须唯一');
      else tags.set(value.name, { kind: 'tag', value, path });
    });
    const completed = new Set<string>();
    tags.forEach((_tag, name) => {
      const chain: string[] = [];
      const positions = new Map<string, number>();
      let currentName: string | undefined = name;
      while (currentName !== undefined && !completed.has(currentName)) {
        const cycleStart = positions.get(currentName);
        if (cycleStart !== undefined) {
          chain.slice(cycleStart).forEach((cycleName) => {
            const tag = tags.get(cycleName);
            if (tag) this.add('tag-parent-cycle', child(tag.path, 'parent'), 'Tag parent 不能形成循环');
          });
          break;
        }
        const current = tags.get(currentName);
        if (!current) break;
        positions.set(currentName, chain.length);
        chain.push(currentName);
        const parent = current.value.parent;
        if (typeof parent !== 'string') break;
        if (!tags.has(parent)) {
          this.add('unknown-parent-tag', child(current.path, 'parent'), 'parent 指向的 Tag 必须存在');
          break;
        }
        currentName = parent;
      }
      chain.forEach((visited) => completed.add(visited));
    });
  }
}

/**
 * Collect synchronous OAS 3.2 structure diagnostics without normalizing input,
 * loading resources, evaluating Schemas or enabling product consumption gates.
 * An empty result means no supported structural check failed, not full conformance.
 */
export function collectOas32DocumentDiagnostics(document: unknown): Oas32DocumentDiagnostic[] {
  if (!isRecord(document)) return [];
  const valid = getOpenApiSpecificationFeatures(document.openapi)?.family === '3.2';
  const resembles = typeof document.openapi === 'string' && /^3\.2(?:[.+-]|$)/.test(document.openapi);
  if (!valid && !resembles) return [];
  const diagnostics = new StructureCollector(document).collect();
  if (!valid)
    diagnostics.unshift({
      code: 'invalid-field-value',
      path: '#/openapi',
      reason: 'openapi 必须是包含 patch 的有效 OAS 3.2 版本号',
    });
  return diagnostics;
}
