import { collectOas31CompatibilityDiagnostics, type Oas31CompatibilityDiagnosticCode } from './compatibility';
import {
  OPENAPI_HTTP_METHODS,
  dereferenceOasReferenceObject,
  escapeJsonPointerSegment,
  inferDirectComponentReferenceTargetKind,
  isOpenApi31Version,
  type ReferenceObjectTargetKind,
  resolveLocalJsonPointer,
  resolvePathItemObject,
} from './document';

export const OAS31_SCHEMA_HELPER_VERSION = 'https://spec.openapis.org/oas/3.1/schema/2025-11-23';
const COMPONENT_NAME_SOURCE = '^[a-zA-Z0-9._-]+$';

/**
 * Synchronous, dependency-free projection of the pinned official helper
 * schema's object-shape rules. Schema Object payloads are intentionally not
 * described here because the helper delegates them through `$dynamicRef` and
 * OAS 3.1 permits additional vocabularies.
 */
export const OAS31_STRUCTURE_HELPER = Object.freeze({
  $id: OAS31_SCHEMA_HELPER_VERSION,
  root: Object.freeze({
    fields: Object.freeze([
      'openapi',
      'info',
      'jsonSchemaDialect',
      'servers',
      'paths',
      'webhooks',
      'components',
      'security',
      'tags',
      'externalDocs',
    ]),
    required: Object.freeze(['openapi', 'info']),
    atLeastOne: Object.freeze(['paths', 'components', 'webhooks']),
  }),
  info: Object.freeze({
    fields: Object.freeze(['title', 'summary', 'description', 'termsOfService', 'contact', 'license', 'version']),
    required: Object.freeze(['title', 'version']),
  }),
  license: Object.freeze({
    fields: Object.freeze(['name', 'identifier', 'url']),
    required: Object.freeze(['name']),
    mutuallyExclusive: Object.freeze(['identifier', 'url']),
  }),
  components: Object.freeze({
    fields: Object.freeze([
      'schemas',
      'responses',
      'parameters',
      'examples',
      'requestBodies',
      'headers',
      'securitySchemes',
      'links',
      'callbacks',
      'pathItems',
    ]),
    namePattern: COMPONENT_NAME_SOURCE,
  }),
  pathItem: Object.freeze({
    fields: Object.freeze(['$ref', 'summary', 'description', 'servers', 'parameters', ...OPENAPI_HTTP_METHODS]),
  }),
  reference: Object.freeze({ fields: Object.freeze(['$ref', 'summary', 'description']) }),
});

export type Oas31DocumentDiagnosticCode =
  | Oas31CompatibilityDiagnosticCode
  | 'invalid-field-type'
  | 'missing-required-field'
  | 'license-fields-mutually-exclusive'
  | 'invalid-path-key'
  | 'path-item-reference-conflict'
  | 'path-item-reference-cycle'
  | 'reference-cycle'
  | 'reference-depth-exceeded'
  | 'reference-target-type-mismatch'
  | 'unresolved-local-reference'
  | 'duplicate-parameter'
  | 'reference-sibling-ignored'
  | 'invalid-component-name'
  | 'unknown-field';

export interface Oas31DocumentDiagnostic {
  code: Oas31DocumentDiagnosticCode;
  path: string;
  reason: string;
  value?: string;
}

const ROOT_FIELDS = new Set<string>(OAS31_STRUCTURE_HELPER.root.fields);
const INFO_FIELDS = new Set<string>(OAS31_STRUCTURE_HELPER.info.fields);
const LICENSE_FIELDS = new Set<string>(OAS31_STRUCTURE_HELPER.license.fields);
const COMPONENT_FIELDS = new Set<string>(OAS31_STRUCTURE_HELPER.components.fields);
const PATH_ITEM_FIELDS = new Set<string>(OAS31_STRUCTURE_HELPER.pathItem.fields);
const REFERENCE_FIELDS = new Set<string>(OAS31_STRUCTURE_HELPER.reference.fields);
const COMPONENT_NAME = new RegExp(OAS31_STRUCTURE_HELPER.components.namePattern);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function owns(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function childPath(path: string, key: string): string {
  return `${path}/${escapeJsonPointerSegment(key)}`;
}

/**
 * Structural OAS 3.1 diagnostics used before UI normalization. The pinned
 * official helper schema guides object-shape checks, while normative OAS text
 * remains authoritative for Reference and Path Item semantics.
 */
export function collectOas31DocumentDiagnostics(document: unknown): Oas31DocumentDiagnostic[] {
  if (!isRecord(document)) return [];
  const validOas31Version = isOpenApi31Version(document.openapi);
  const resemblesOas31 = typeof document.openapi === 'string' && /^3\.1(?:[.+-]|$)/.test(document.openapi);
  if (!validOas31Version && !resemblesOas31) return [];

  const diagnostics: Oas31DocumentDiagnostic[] = [];
  const identities = new Set<string>();

  const add = (code: Oas31DocumentDiagnosticCode, path: string, reason: string, value?: unknown) => {
    const renderedValue = typeof value === 'string' ? value : value === undefined ? undefined : JSON.stringify(value);
    const identity = `${code}:${path}:${renderedValue ?? ''}`;
    if (identities.has(identity)) return;
    identities.add(identity);
    diagnostics.push({ code, path, reason, ...(renderedValue === undefined ? {} : { value: renderedValue }) });
  };

  const validateKnownFields = (object: Record<string, unknown>, path: string, allowed: ReadonlySet<string>) => {
    Object.keys(object).forEach((key) => {
      if (!allowed.has(key) && !key.startsWith('x-')) {
        add('unknown-field', childPath(path, key), `字段 ${key} 不属于该 OpenAPI 对象`);
      }
    });
  };

  if (!validOas31Version) {
    add('invalid-field-type', '#/openapi', 'openapi 必须是包含 patch 版本的有效 OAS 3.1 语义版本号', document.openapi);
  }

  const requireRecord = (value: unknown, path: string, label: string): value is Record<string, unknown> => {
    if (isRecord(value)) return true;
    add('invalid-field-type', path, `${label} 必须是对象`, value);
    return false;
  };

  const validateString = (object: Record<string, unknown>, key: string, path: string, required = false) => {
    if (!owns(object, key)) {
      if (required) add('missing-required-field', childPath(path, key), `缺少必填字段 ${key}`);
      return;
    }
    if (typeof object[key] !== 'string') {
      add('invalid-field-type', childPath(path, key), `${key} 必须是字符串`, object[key]);
    }
  };

  const validateBoolean = (object: Record<string, unknown>, key: string, path: string) => {
    if (owns(object, key) && typeof object[key] !== 'boolean') {
      add('invalid-field-type', childPath(path, key), `${key} 必须是 boolean`, object[key]);
    }
  };

  const validateStringArray = (value: unknown, path: string, label: string) => {
    if (!Array.isArray(value)) {
      add('invalid-field-type', path, `${label} 必须是数组`, value);
      return;
    }
    value.forEach((item, index) => {
      if (typeof item !== 'string') add('invalid-field-type', `${path}/${index}`, `${label} 的成员必须是字符串`, item);
    });
  };

  const validateServer = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Server Object')) return;
    validateString(value, 'url', path, true);
    validateString(value, 'description', path);
  };

  const validateServers = (value: unknown, path: string) => {
    if (!Array.isArray(value)) {
      add('invalid-field-type', path, 'servers 必须是数组', value);
      return;
    }
    value.forEach((server, index) => validateServer(server, `${path}/${index}`));
  };

  const validateExternalDocs = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'External Documentation Object')) return;
    validateString(value, 'description', path);
    validateString(value, 'url', path, true);
  };

  const validateSecurityRequirements = (value: unknown, path: string) => {
    if (!Array.isArray(value)) {
      add('invalid-field-type', path, 'security 必须是数组', value);
      return;
    }
    value.forEach((requirement, index) => {
      const requirementPath = `${path}/${index}`;
      if (!requireRecord(requirement, requirementPath, 'Security Requirement Object')) return;
      Object.entries(requirement).forEach(([name, scopes]) =>
        validateStringArray(scopes, childPath(requirementPath, name), 'security scopes'),
      );
    });
  };

  const validateLocalReference = (reference: Record<string, unknown>, path: string) => {
    if (typeof reference.$ref !== 'string') {
      add('invalid-field-type', `${path}/$ref`, '$ref 必须是字符串', reference.$ref);
      return;
    }
    if (reference.$ref.startsWith('#')) {
      const target = resolveLocalJsonPointer(document, reference.$ref);
      if (!target.found) {
        add(
          'unresolved-local-reference',
          `${path}/$ref`,
          '同一文档内的引用目标不存在或 JSON Pointer 非法',
          reference.$ref,
        );
      }
    }
  };

  const validateReferenceObject = (
    reference: Record<string, unknown>,
    path: string,
    targetKind: ReferenceObjectTargetKind,
  ) => {
    validateLocalReference(reference, path);
    if (typeof reference.$ref === 'string' && reference.$ref.startsWith('#')) {
      const seen = new Set<string>();
      let currentRef: string | undefined = reference.$ref;
      for (let depth = 0; currentRef && depth < 20; depth++) {
        if (seen.has(currentRef)) {
          add('reference-cycle', `${path}/$ref`, 'Reference Object 的本地引用形成循环', currentRef);
          currentRef = undefined;
          break;
        }
        seen.add(currentRef);
        const inferredTargetKind = inferDirectComponentReferenceTargetKind(currentRef);
        if (inferredTargetKind && inferredTargetKind !== targetKind) {
          add(
            'reference-target-type-mismatch',
            `${path}/$ref`,
            `Reference Object 需要指向 ${targetKind}，但引用链目标属于 ${inferredTargetKind}`,
            currentRef,
          );
        }
        const target = resolveLocalJsonPointer(document, currentRef);
        if (!target.found) {
          add(
            'unresolved-local-reference',
            `${path}/$ref`,
            'Reference Object 的本地引用链包含不存在或非法的目标',
            currentRef,
          );
          currentRef = undefined;
          break;
        }
        if (!isRecord(target.value)) {
          add(
            'reference-target-type-mismatch',
            `${path}/$ref`,
            `Reference Object 需要指向 ${targetKind} 对象，但引用链目标不是对象`,
            currentRef,
          );
          currentRef = undefined;
          break;
        }
        currentRef =
          typeof target.value.$ref === 'string' && target.value.$ref.startsWith('#') ? target.value.$ref : undefined;
      }
      if (currentRef) {
        add('reference-depth-exceeded', `${path}/$ref`, 'Reference Object 的本地引用链超过安全解析深度', currentRef);
      }
    }
    Object.keys(reference).forEach((key) => {
      if (!REFERENCE_FIELDS.has(key)) {
        add(
          'reference-sibling-ignored',
          childPath(path, key),
          'OAS 3.1 Reference Object 只允许 summary 与 description 作为 $ref 的相邻字段，该字段将被忽略',
        );
      }
    });
    if (owns(reference, 'summary') && typeof reference.summary !== 'string') {
      add('invalid-field-type', `${path}/summary`, 'summary 必须是字符串', reference.summary);
    }
    if (owns(reference, 'description') && typeof reference.description !== 'string') {
      add('invalid-field-type', `${path}/description`, 'description 必须是字符串', reference.description);
    }
  };

  const isReferenceObject = (value: unknown): value is Record<string, unknown> & { $ref: unknown } =>
    isRecord(value) && owns(value, '$ref');

  const validateExample = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Example Object')) return;
    if (isReferenceObject(value)) {
      validateReferenceObject(value, path, 'example');
      return;
    }
    validateString(value, 'summary', path);
    validateString(value, 'description', path);
    validateString(value, 'externalValue', path);
  };

  const validateExamplesMap = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Examples Object')) return;
    Object.entries(value).forEach(([name, example]) => validateExample(example, childPath(path, name)));
  };

  const validateMediaType = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Media Type Object')) return;
    // Schema Objects deliberately remain opaque here: OAS 3.1 permits
    // arbitrary JSON Schema vocabularies.
    if (owns(value, 'examples')) validateExamplesMap(value.examples, `${path}/examples`);
  };

  const validateContent = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Content Object')) return;
    Object.entries(value).forEach(([mediaType, media]) => validateMediaType(media, childPath(path, mediaType)));
  };

  const validateHeader = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Header Object')) return;
    if (isReferenceObject(value)) {
      validateReferenceObject(value, path, 'header');
      return;
    }
    validateString(value, 'description', path);
    validateBoolean(value, 'required', path);
    validateBoolean(value, 'deprecated', path);
    if (owns(value, 'examples')) validateExamplesMap(value.examples, `${path}/examples`);
  };

  const validateLink = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Link Object')) return;
    if (isReferenceObject(value)) validateReferenceObject(value, path, 'link');
    else validateString(value, 'description', path);
  };

  const validateResponse = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Response Object')) return;
    if (isReferenceObject(value)) {
      validateReferenceObject(value, path, 'response');
      return;
    }
    validateString(value, 'description', path, true);
    if (owns(value, 'headers') && requireRecord(value.headers, `${path}/headers`, 'Headers Object')) {
      Object.entries(value.headers).forEach(([name, header]) =>
        validateHeader(header, childPath(`${path}/headers`, name)),
      );
    }
    if (owns(value, 'content')) validateContent(value.content, `${path}/content`);
    if (owns(value, 'links') && requireRecord(value.links, `${path}/links`, 'Links Object')) {
      Object.entries(value.links).forEach(([name, link]) => validateLink(link, childPath(`${path}/links`, name)));
    }
  };

  const validateResponses = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Responses Object')) return;
    Object.entries(value).forEach(([status, response]) => {
      if (status.startsWith('x-')) return;
      validateResponse(response, childPath(path, status));
    });
  };

  const validateParameter = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Parameter Object')) return;
    if (isReferenceObject(value)) {
      validateReferenceObject(value, path, 'parameter');
      return;
    }
    validateString(value, 'name', path, true);
    validateString(value, 'in', path, true);
    validateString(value, 'description', path);
    validateBoolean(value, 'required', path);
    validateBoolean(value, 'deprecated', path);
    if (owns(value, 'examples')) validateExamplesMap(value.examples, `${path}/examples`);
    if (owns(value, 'content')) validateContent(value.content, `${path}/content`);
  };

  const parameterIdentity = (parameter: Record<string, unknown>): string | null => {
    const resolved = dereferenceOasReferenceObject(parameter, document, 20, 'parameter');
    return typeof resolved.name === 'string' && typeof resolved.in === 'string'
      ? `${resolved.in}\u0000${resolved.name}`
      : null;
  };

  const validateParameters = (value: unknown, path: string) => {
    if (!Array.isArray(value)) {
      add('invalid-field-type', path, 'parameters 必须是数组', value);
      return;
    }
    const seen = new Set<string>();
    value.forEach((parameter, index) => {
      const parameterPath = `${path}/${index}`;
      validateParameter(parameter, parameterPath);
      if (!isRecord(parameter)) return;
      const identity = parameterIdentity(parameter);
      if (!identity) return;
      if (seen.has(identity)) {
        const [location, name] = identity.split('\u0000');
        add('duplicate-parameter', parameterPath, `同一参数列表中重复声明了 ${location}:${name}`);
      }
      seen.add(identity);
    });
  };

  const validateRequestBody = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Request Body Object')) return;
    if (isReferenceObject(value)) {
      validateReferenceObject(value, path, 'requestBody');
      return;
    }
    if (!owns(value, 'content')) add('missing-required-field', `${path}/content`, 'Request Body 缺少必填字段 content');
    else validateContent(value.content, `${path}/content`);
    validateString(value, 'description', path);
    validateBoolean(value, 'required', path);
  };

  const validateOperation = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Operation Object')) return;
    if (owns(value, 'summary') && typeof value.summary !== 'string') {
      add('invalid-field-type', `${path}/summary`, 'summary 必须是字符串', value.summary);
    }
    if (owns(value, 'description') && typeof value.description !== 'string') {
      add('invalid-field-type', `${path}/description`, 'description 必须是字符串', value.description);
    }
    if (owns(value, 'tags')) validateStringArray(value.tags, `${path}/tags`, 'tags');
    validateString(value, 'operationId', path);
    if (owns(value, 'externalDocs')) validateExternalDocs(value.externalDocs, `${path}/externalDocs`);
    if (owns(value, 'parameters')) validateParameters(value.parameters, `${path}/parameters`);
    if (owns(value, 'requestBody')) validateRequestBody(value.requestBody, `${path}/requestBody`);
    if (!owns(value, 'responses'))
      add('missing-required-field', `${path}/responses`, 'Operation 缺少必填字段 responses');
    else validateResponses(value.responses, `${path}/responses`);
    if (owns(value, 'callbacks') && requireRecord(value.callbacks, `${path}/callbacks`, 'Callbacks Object')) {
      Object.entries(value.callbacks).forEach(([name, callback]) =>
        validateCallback(callback, childPath(`${path}/callbacks`, name)),
      );
    }
    validateBoolean(value, 'deprecated', path);
    if (owns(value, 'security')) validateSecurityRequirements(value.security, `${path}/security`);
    if (owns(value, 'servers')) validateServers(value.servers, `${path}/servers`);
  };

  const validatePathItem = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Path Item Object')) return;
    validateKnownFields(value, path, PATH_ITEM_FIELDS);
    if (owns(value, '$ref')) {
      validateLocalReference(value, path);
      if (typeof value.$ref === 'string') {
        const inferredTargetKind = inferDirectComponentReferenceTargetKind(value.$ref);
        if (inferredTargetKind && inferredTargetKind !== 'pathItem') {
          add(
            'reference-target-type-mismatch',
            `${path}/$ref`,
            `Path Item $ref 需要指向 pathItem，但本地目标属于 ${inferredTargetKind}`,
            value.$ref,
          );
        }
        const resolved = resolvePathItemObject(value, document);
        if (resolved.status === 'conflict') {
          add(
            'path-item-reference-conflict',
            path,
            `Path Item 的 $ref 与本地字段重叠（${resolved.conflicts.join(', ')}），规范未定义合并结果`,
            resolved.ref,
          );
        } else if (resolved.status === 'cycle' || resolved.status === 'depth') {
          add('path-item-reference-cycle', `${path}/$ref`, 'Path Item 引用形成循环或超过安全解析深度', resolved.ref);
        }
      }
    }
    if (owns(value, 'summary') && typeof value.summary !== 'string') {
      add('invalid-field-type', `${path}/summary`, 'summary 必须是字符串', value.summary);
    }
    if (owns(value, 'description') && typeof value.description !== 'string') {
      add('invalid-field-type', `${path}/description`, 'description 必须是字符串', value.description);
    }
    if (owns(value, 'parameters')) validateParameters(value.parameters, `${path}/parameters`);
    if (owns(value, 'servers')) validateServers(value.servers, `${path}/servers`);
    OPENAPI_HTTP_METHODS.forEach((method) => {
      if (owns(value, method)) validateOperation(value[method], `${path}/${method}`);
    });
  };

  function validateCallback(value: unknown, path: string): void {
    if (!requireRecord(value, path, 'Callback Object')) return;
    if (isReferenceObject(value)) {
      validateReferenceObject(value, path, 'callback');
      return;
    }
    Object.entries(value).forEach(([expression, pathItem]) => {
      if (expression.startsWith('x-')) return;
      validatePathItem(pathItem, childPath(path, expression));
    });
  }

  const validateSecurityScheme = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Security Scheme Object')) return;
    if (isReferenceObject(value)) {
      validateReferenceObject(value, path, 'securityScheme');
      return;
    }
    validateString(value, 'type', path, true);
    validateString(value, 'description', path);
  };

  const componentValidators: Record<string, (value: unknown, path: string) => void> = {
    responses: validateResponse,
    parameters: validateParameter,
    examples: validateExample,
    requestBodies: validateRequestBody,
    headers: validateHeader,
    securitySchemes: validateSecurityScheme,
    links: validateLink,
    callbacks: validateCallback,
    pathItems: validatePathItem,
  };

  const validateComponents = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Components Object')) return;
    validateKnownFields(value, path, COMPONENT_FIELDS);
    Object.entries(value).forEach(([section, entries]) => {
      if (section.startsWith('x-') || !COMPONENT_FIELDS.has(section)) return;
      const sectionPath = childPath(path, section);
      if (!requireRecord(entries, sectionPath, `components.${section}`)) return;
      Object.entries(entries).forEach(([name, entry]) => {
        const entryPath = childPath(sectionPath, name);
        if (!COMPONENT_NAME.test(name)) {
          add('invalid-component-name', entryPath, '组件名只能包含字母、数字、点、连字符和下划线', name);
        }
        if (section === 'schemas') {
          if (typeof entry !== 'boolean' && !isRecord(entry)) {
            add('invalid-field-type', entryPath, 'Schema 必须是对象或 boolean', entry);
          }
          return;
        }
        componentValidators[section]?.(entry, entryPath);
      });
    });
  };

  const validatePaths = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Paths Object')) return;
    Object.entries(value).forEach(([name, pathItem]) => {
      const itemPath = childPath(path, name);
      if (name.startsWith('x-')) return;
      if (!name.startsWith('/')) add('invalid-path-key', itemPath, 'Paths Object 的路径字段必须以 / 开头', name);
      validatePathItem(pathItem, itemPath);
    });
  };

  const validateWebhooks = (value: unknown, path: string) => {
    if (!requireRecord(value, path, 'Webhooks Object')) return;
    Object.entries(value).forEach(([name, pathItem]) => {
      if (name.startsWith('x-')) return;
      validatePathItem(pathItem, childPath(path, name));
    });
  };

  validateKnownFields(document, '#', ROOT_FIELDS);
  if (!owns(document, 'info')) {
    add('missing-required-field', '#/info', 'OpenAPI 文档缺少必填字段 info');
  } else if (requireRecord(document.info, '#/info', 'Info Object')) {
    validateKnownFields(document.info, '#/info', INFO_FIELDS);
    validateString(document.info, 'title', '#/info', true);
    validateString(document.info, 'version', '#/info', true);
    validateString(document.info, 'summary', '#/info');
    validateString(document.info, 'description', '#/info');
    validateString(document.info, 'termsOfService', '#/info');
    if (owns(document.info, 'contact') && requireRecord(document.info.contact, '#/info/contact', 'Contact Object')) {
      validateString(document.info.contact, 'name', '#/info/contact');
      validateString(document.info.contact, 'url', '#/info/contact');
      validateString(document.info.contact, 'email', '#/info/contact');
    }
    if (owns(document.info, 'license') && requireRecord(document.info.license, '#/info/license', 'License Object')) {
      validateKnownFields(document.info.license, '#/info/license', LICENSE_FIELDS);
      validateString(document.info.license, 'name', '#/info/license', true);
      validateString(document.info.license, 'identifier', '#/info/license');
      validateString(document.info.license, 'url', '#/info/license');
      if (owns(document.info.license, 'identifier') && owns(document.info.license, 'url')) {
        add(
          'license-fields-mutually-exclusive',
          '#/info/license',
          'License Object 的 identifier 与 url 互斥，不能同时出现',
        );
      }
    }
  }

  if (!owns(document, 'paths') && !owns(document, 'components') && !owns(document, 'webhooks')) {
    add('missing-required-field', '#', 'OAS 3.1 文档至少需要 paths、components 或 webhooks 之一');
  }
  validateString(document, 'jsonSchemaDialect', '#');
  if (owns(document, 'servers')) validateServers(document.servers, '#/servers');
  if (owns(document, 'security')) validateSecurityRequirements(document.security, '#/security');
  if (owns(document, 'tags')) {
    if (!Array.isArray(document.tags)) {
      add('invalid-field-type', '#/tags', 'tags 必须是数组', document.tags);
    } else {
      document.tags.forEach((tag, index) => {
        const tagPath = `#/tags/${index}`;
        if (!requireRecord(tag, tagPath, 'Tag Object')) return;
        validateString(tag, 'name', tagPath, true);
        validateString(tag, 'description', tagPath);
        if (owns(tag, 'externalDocs')) validateExternalDocs(tag.externalDocs, `${tagPath}/externalDocs`);
      });
    }
  }
  if (owns(document, 'externalDocs')) validateExternalDocs(document.externalDocs, '#/externalDocs');
  if (owns(document, 'paths')) validatePaths(document.paths, '#/paths');
  if (owns(document, 'webhooks')) validateWebhooks(document.webhooks, '#/webhooks');
  if (owns(document, 'components')) validateComponents(document.components, '#/components');

  collectOas31CompatibilityDiagnostics(document).forEach((diagnostic) => {
    add(diagnostic.code, diagnostic.path, diagnostic.reason, diagnostic.value);
  });

  return diagnostics;
}
