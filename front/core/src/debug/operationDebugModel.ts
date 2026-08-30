/**
 * OperationDebugModel — 从 OAS2/OAS3 operation 解析出统一的调试参数模型
 *
 * 职责：
 * - 将 OAS2 的 parameters[].in = body/formData 和 OAS3 的 requestBody 统一为 OperationDebugModel
 * - OAS2 的 `in=body` → bodyContents
 * - OAS2 的 `in=formData` → 根据 consumes 判断 urlencoded / multipart
 * - OAS3 的 requestBody.content → bodyContents（多种 media type）
 * - 解析 $ref 引用的参数（path-level parameters 也合并进来）
 */

import type {
  DebugParam,
  ParamIn,
  BodyContent,
  BodyContentType,
  OperationDebugModel,
  Oas31ParameterSerialization,
  ParameterDocumentDiagnostic,
  SchemaResolveContext,
  SchemaValue,
} from './types';
import { isSupportedParameterContentType } from './parameterSerialization';
import { resolveRef, dereference, dereferenceReferenceObject, normalizeAllOfSchema } from './resolveRef';
import { isOpenApi31Version, resolvePathItemOperation } from '../openapi31/document';
import { buildSchemaExample } from './schemaExample';
import { buildMediaTypeExampleValue } from './mediaTypeExample';

// ─── 内部类型 ─────────────────────────────────────────

/** OAS3 ParameterObject（简化） */
interface OAS3Param {
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: SchemaValue;
  content?: Record<
    string,
    {
      schema?: SchemaValue;
      example?: unknown;
      examples?: Record<string, unknown>;
    }
  >;
  example?: unknown;
  deprecated?: boolean;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
  $ref?: string;
}

/** OAS2 ParameterObject（简化） */
interface OAS2Param {
  name?: string;
  in?: 'query' | 'header' | 'path' | 'formData' | 'body';
  required?: boolean;
  description?: string;
  type?: string;
  format?: string;
  schema?: Record<string, unknown>;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  deprecated?: boolean;
  $ref?: string;
  items?: Record<string, unknown>;
  allowMultiple?: boolean;
}

/** OAS3 RequestBodyObject（简化） */
interface OAS3RequestBody {
  description?: string;
  required?: boolean;
  content?: Record<
    string,
    {
      schema?: Record<string, unknown>;
      example?: unknown;
      examples?: Record<string, unknown>;
      encoding?: Record<string, unknown>;
    }
  >;
  $ref?: string;
}

/** 通用 Operation（兼容 OAS2/OAS3） */
interface OperationLike {
  parameters?: Array<OAS3Param | OAS2Param>;
  requestBody?: OAS3RequestBody;
  consumes?: string[];
}

/** 通用 PathItem（包含 path-level parameters） */
interface PathItemLike {
  parameters?: Array<OAS3Param | OAS2Param>;
  get?: OperationLike;
  put?: OperationLike;
  post?: OperationLike;
  delete?: OperationLike;
  patch?: OperationLike;
  head?: OperationLike;
  options?: OperationLike;
  [key: string]: unknown;
}

/** 文档结构（最小公共接口） */
interface DocLike {
  openapi?: string;
  swagger?: string;
  paths?: Record<string, PathItemLike>;
  components?: {
    parameters?: Record<string, OAS3Param>;
    requestBodies?: Record<string, OAS3RequestBody>;
    schemas?: Record<string, unknown>;
    [key: string]: unknown;
  };
  definitions?: Record<string, unknown>;
  parameters?: Record<string, OAS2Param>;
  consumes?: string[];
  [key: string]: unknown;
}

// ─── 辅助 ─────────────────────────────────────────────

/** 从 schema 提取 type 信息 */
function extractType(param: OAS2Param | OAS3Param, schema?: SchemaValue): string {
  // OAS2 直接有 type 字段
  const directType = (param as OAS2Param).type;
  if (directType) {
    // OAS2 的 file 类型
    if (directType === 'file') return 'file';
    return directType;
  }
  if (schema && typeof schema === 'object') {
    const declaredType = schema.type;
    const t = Array.isArray(declaredType)
      ? declaredType.find((value): value is string => typeof value === 'string' && value !== 'null')
      : (declaredType as string | undefined);
    if (t === 'string') {
      const f = schema.format as string | undefined;
      if (f === 'binary') return 'file';
    }
    if (t) return t;
    // schema.type 缺失时（OAS3.1 允许省略 type，@ParameterObject 展开的字段也可能
    // 引用无 type 的 component schema），从 schema 结构推断，避免全部退化为 string
    if (schema.properties) return 'object';
    if (schema.items !== undefined) return 'array';
    if (Array.isArray(schema.enum)) {
      // 从枚举值的 JS 类型推断：全部是布尔 → boolean，全部是数字 → integer/number
      const vals = schema.enum as unknown[];
      if (vals.length > 0) {
        if (vals.every((v) => typeof v === 'boolean')) return 'boolean';
        if (vals.every((v) => typeof v === 'number'))
          return vals.every((v) => Number.isInteger(v)) ? 'integer' : 'number';
      }
    }
    return 'string';
  }
  return 'string';
}

function extractEnum(
  param: OAS2Param | OAS3Param,
  schema: SchemaValue | undefined,
  type: string,
  doc: DocLike,
  isOAS2: boolean,
): unknown[] | undefined {
  const schemaRecord = schema && typeof schema === 'object' ? schema : undefined;
  const schemaEnum = schemaRecord?.enum;
  if (type === 'array') {
    // OAS3 的 schema.enum 约束整个数组实例；只有 items.enum 才表示元素候选值。
    // OAS2 保留本 PR 之前的顶层 enum 行为，不在 React/OAS3 任务中扩展 OAS2。
    if (isOAS2) {
      if (Array.isArray(schemaEnum)) return schemaEnum as unknown[];
      return (param as OAS2Param).enum;
    }

    const items = schemaRecord?.items;
    if (!items || typeof items !== 'object' || Array.isArray(items)) return undefined;
    return extractArrayItemEnum(items as Record<string, unknown>, doc);
  }
  if (Array.isArray(schemaEnum)) return schemaEnum as unknown[];
  return (param as OAS2Param).enum;
}

function supportsSchemaRefSiblings(doc: DocLike): boolean {
  if (isOpenApi31Version(doc.openapi)) return true;
  // Keep the pre-existing behavior for later, out-of-scope OAS versions while
  // requiring a complete patch version before enabling the 3.1 contract.
  const [majorText, minorText] = (doc.openapi ?? '').split('.');
  const major = Number(majorText);
  const minor = Number(minorText);
  return major > 3 || (major === 3 && minor > 1);
}

function schemaDeclaresType(schema: Record<string, unknown>, expected: string): boolean {
  return schema.type === expected || (Array.isArray(schema.type) && schema.type.includes(expected));
}

function isObjectSchemaShape(schema: Record<string, unknown>): boolean {
  return (
    schemaDeclaresType(schema, 'object') ||
    (schema.type === undefined &&
      schema.properties !== null &&
      typeof schema.properties === 'object' &&
      !Array.isArray(schema.properties))
  );
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonValuesEqual(item, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) && jsonValuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function intersectEnums(left: unknown[] | undefined, right: unknown[]): unknown[] {
  if (!left) return [...right];
  return left.filter((candidate) => right.some((value) => jsonValuesEqual(candidate, value)));
}

/**
 * 提取 OAS3 数组元素的 enum 约束。
 *
 * OAS 3.0 的 `items.$ref` 是 Reference Object，普通相邻字段不生效；OAS 3.1+
 * 的 Schema Object 采用 JSON Schema 语义，`$ref` 与相邻关键字共同约束实例。
 * 因此 3.1+ 中多个 enum 约束必须取交集，而不能用任一侧覆盖另一侧。
 */
function extractArrayItemEnum(items: Record<string, unknown>, doc: DocLike): unknown[] | undefined {
  const allowRefSiblings = supportsSchemaRefSiblings(doc);
  const seenRefs = new Set<string>();
  let current = items;
  let candidates: unknown[] | undefined;

  for (let depth = 0; depth < 10; depth++) {
    const ref = typeof current.$ref === 'string' ? current.$ref : undefined;
    const currentEnum = current.enum;
    if ((!ref || allowRefSiblings) && Array.isArray(currentEnum)) {
      candidates = intersectEnums(candidates, currentEnum);
    }
    if (!ref || seenRefs.has(ref)) break;
    seenRefs.add(ref);
    const resolved = resolveRef(ref, doc as Record<string, unknown>);
    if (!resolved) break;
    current = resolved;
  }

  return candidates;
}

/** 分类 content-type */
function classifyContentType(mediaType: string): BodyContentType {
  if (mediaType.includes('json')) return 'json';
  if (mediaType.includes('x-www-form-urlencoded')) return 'urlencoded';
  if (mediaType.includes('multipart')) return 'multipart';
  return 'raw';
}

function isOas31(doc: DocLike): boolean {
  return isOpenApi31Version(doc.openapi);
}

const OAS31_IGNORED_HEADER_PARAMETER_NAMES = new Set(['accept', 'content-type', 'authorization']);

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function schemaRecord(schema: SchemaValue | undefined): Record<string, unknown> | undefined {
  return schema && typeof schema === 'object' ? schema : undefined;
}

function normalizeParameterSchema(
  schema: SchemaValue | undefined,
  doc: DocLike,
  maxDepth: number,
): SchemaValue | undefined {
  if (typeof schema === 'boolean') return schema;
  return schema ? normalizeAllOfSchema(schema, doc as Record<string, unknown>, maxDepth) : undefined;
}

function parameterDiagnostic(
  param: OAS3Param,
  paramIn: ParamIn,
  code: ParameterDocumentDiagnostic['code'],
  message: string,
): ParameterDocumentDiagnostic {
  const name = param.name ?? '';
  return { key: `${paramIn}:${name}`, name, in: paramIn, code, message };
}

interface Oas31ParameterAnalysis {
  readonly schema?: SchemaValue;
  readonly example?: unknown;
  readonly serialization?: Oas31ParameterSerialization;
  readonly diagnostic?: ParameterDocumentDiagnostic;
}

function analyzeOas31Parameter(
  param: OAS3Param,
  paramIn: ParamIn,
  doc: DocLike,
  maxDepth: number,
): Oas31ParameterAnalysis {
  const hasSchema = hasOwn(param, 'schema');
  const hasContent = hasOwn(param, 'content');

  if (hasSchema && hasContent) {
    return {
      schema: normalizeParameterSchema(param.schema, doc, maxDepth),
      diagnostic: parameterDiagnostic(
        param,
        paramIn,
        'SCHEMA_CONTENT_CONFLICT',
        `OAS 3.1 parameter ${paramIn}:${param.name ?? ''} must use either schema or content, not both.`,
      ),
    };
  }
  if (!hasSchema && !hasContent) {
    return {
      diagnostic: parameterDiagnostic(
        param,
        paramIn,
        'PARAMETER_ENCODING_MISSING',
        `OAS 3.1 parameter ${paramIn}:${param.name ?? ''} must define schema or content.`,
      ),
    };
  }

  if (hasContent) {
    const entries = param.content && typeof param.content === 'object' ? Object.entries(param.content) : [];
    if (entries.length !== 1) {
      return {
        diagnostic: parameterDiagnostic(
          param,
          paramIn,
          'CONTENT_CARDINALITY',
          `OAS 3.1 parameter ${paramIn}:${param.name ?? ''} content must contain exactly one media type.`,
        ),
      };
    }
    if (param.style !== undefined || param.explode !== undefined || param.allowReserved !== undefined) {
      return {
        diagnostic: parameterDiagnostic(
          param,
          paramIn,
          'CONTENT_STYLE_CONFLICT',
          `OAS 3.1 parameter ${paramIn}:${param.name ?? ''} cannot combine content with style, explode, or allowReserved.`,
        ),
      };
    }
    const [mediaType, mediaObject] = entries[0];
    const schema = normalizeParameterSchema(mediaObject?.schema, doc, maxDepth);
    if (!isSupportedParameterContentType(mediaType)) {
      return {
        schema,
        example: mediaObject?.example,
        diagnostic: parameterDiagnostic(
          param,
          paramIn,
          'UNSUPPORTED_CONTENT_TYPE',
          `Knife4j cannot safely serialize OAS parameter content media type ${mediaType}.`,
        ),
      };
    }
    return {
      schema,
      example: mediaObject?.example,
      serialization: { kind: 'content', mediaType },
    };
  }

  const defaultStyle: Record<ParamIn, string> = {
    path: 'simple',
    query: 'form',
    header: 'simple',
    cookie: 'form',
  };
  const allowedStyles: Record<ParamIn, readonly string[]> = {
    path: ['simple', 'label', 'matrix'],
    query: ['form', 'spaceDelimited', 'pipeDelimited', 'deepObject'],
    header: ['simple'],
    cookie: ['form'],
  };
  const style = param.style ?? defaultStyle[paramIn];
  const explode = param.explode ?? style === 'form';
  const allowReserved = paramIn === 'query' && param.allowReserved === true;

  if (!allowedStyles[paramIn].includes(style)) {
    return {
      schema: normalizeParameterSchema(param.schema, doc, maxDepth),
      diagnostic: parameterDiagnostic(
        param,
        paramIn,
        'UNSUPPORTED_STYLE',
        `OAS parameter style ${style} is not defined for ${paramIn}:${param.name ?? ''}.`,
      ),
    };
  }
  if (((style === 'spaceDelimited' || style === 'pipeDelimited') && explode) || (style === 'deepObject' && !explode)) {
    return {
      schema: normalizeParameterSchema(param.schema, doc, maxDepth),
      diagnostic: parameterDiagnostic(
        param,
        paramIn,
        'UNDEFINED_STYLE_COMBINATION',
        `OAS parameter ${paramIn}:${param.name ?? ''} uses an undefined style/explode combination (${style}, explode=${String(explode)}).`,
      ),
    };
  }

  return {
    schema: normalizeParameterSchema(param.schema, doc, maxDepth),
    serialization: { kind: 'schema', style, explode, allowReserved },
  };
}

function isBinaryMediaType(mediaType: string | undefined): boolean {
  if (!mediaType) return false;
  const normalized = mediaType.split(';', 1)[0].trim().toLowerCase();
  if (/^(image|audio|video|font)\//.test(normalized)) return true;
  return [
    'application/octet-stream',
    'application/pdf',
    'application/zip',
    'application/gzip',
    'application/wasm',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/x-protobuf',
  ].includes(normalized);
}

function effectiveContentMediaType(
  transportMediaType: string | undefined,
  schemaMediaType: unknown,
): string | undefined {
  const transport = transportMediaType?.split(';', 1)[0].trim().toLowerCase();
  const schema = typeof schemaMediaType === 'string' ? schemaMediaType.trim().toLowerCase() : undefined;
  if (!transport || transport === '*/*') return schema ?? transport;
  if (transport.endsWith('/*')) {
    return schema?.startsWith(`${transport.slice(0, -1)}`) ? schema : transport;
  }
  return transport;
}

function isOas31RawBinarySchema(
  schema: Record<string, unknown> | undefined,
  transportMediaType: string | undefined,
): boolean {
  if (typeof schema?.contentEncoding === 'string' && schema.contentEncoding.length > 0) return false;
  if (schema?.format === 'binary') return true;
  // OAS 3.1 raw binary is outside JSON Schema's type system. A declared type
  // therefore describes a serialized value rather than a file payload.
  if (schema?.type !== undefined) return false;
  if (
    schema &&
    (typeof schema.$ref === 'string' ||
      typeof schema.$dynamicRef === 'string' ||
      schema.properties !== undefined ||
      schema.items !== undefined ||
      schema.prefixItems !== undefined ||
      schema.allOf !== undefined ||
      schema.oneOf !== undefined ||
      schema.anyOf !== undefined)
  ) {
    return false;
  }
  return isBinaryMediaType(effectiveContentMediaType(transportMediaType, schema?.contentMediaType));
}

function encodingContentType(encoding: Record<string, unknown> | undefined, fieldName: string): string | undefined {
  const fieldEncoding = encoding?.[fieldName];
  if (!fieldEncoding || typeof fieldEncoding !== 'object' || Array.isArray(fieldEncoding)) return undefined;
  const contentType = (fieldEncoding as Record<string, unknown>).contentType;
  return typeof contentType === 'string' ? contentType.split(',', 1)[0].trim() : undefined;
}

/**
 * 判断某个 `items` schema 是否代表二进制文件。
 *
 * springdoc 2.x（OAS 3.1）对 `@ArraySchema(schema=@Schema(type="string", format="binary"))`
 * 会 **丢掉 items 里的 `type:"string"`**，实际吐出的是
 * `{ items: { format: "binary", description: "..." } }`（真实请求参见
 * `boot3-jakarta-app` 的 `shouldExposeArrayOfBinarySchemaForMultipartArrayUpload`
 * smoke test 正则，以及 issue #251 的 live 复现）。
 *
 * 因此这里只看 `format` 是否为 `binary` / `base64`，不强求 `type === "string"`——
 * 否则 React UI 会把实际的文件数组字段渲染成普通文本输入框。
 */
function isBinaryItems(items: Record<string, unknown>, allowOas31Binary: boolean): boolean {
  if (allowOas31Binary && typeof items.contentEncoding === 'string' && items.contentEncoding.length > 0) {
    return false;
  }
  if (items.format !== 'binary' && items.format !== 'base64') return false;
  // 如果 items.type 存在但显式不是 'string'，说明是其他数组（例如 number[]），不算文件。
  // 没有 type 字段 / type === 'string' 都接受。
  return items.type === undefined || schemaDeclaresType(items, 'string');
}

/** 从 OAS3 requestBody 中提取 file 字段名 */
function extractFileFields(
  schema: Record<string, unknown> | undefined,
  encoding: Record<string, unknown> | undefined,
  allowOas31Binary: boolean,
  doc: DocLike,
): string[] {
  if (!schema || !isObjectSchemaShape(schema) || !schema.properties) return [];
  const props = schema.properties as Record<string, Record<string, unknown>>;
  const files: string[] = [];
  for (const [name, prop] of Object.entries(props)) {
    const normalizedProp =
      prop && typeof prop === 'object' && !Array.isArray(prop)
        ? normalizeAllOfSchema(prop, doc as Record<string, unknown>)
        : undefined;
    if (!normalizedProp) continue;
    const fieldContentType = encodingContentType(encoding, name);
    const legacyFile =
      schemaDeclaresType(normalizedProp, 'string') &&
      (normalizedProp.format === 'binary' || normalizedProp.format === 'base64') &&
      !(
        allowOas31Binary &&
        typeof normalizedProp.contentEncoding === 'string' &&
        normalizedProp.contentEncoding.length > 0
      );
    if (
      legacyFile ||
      (allowOas31Binary &&
        isOas31RawBinarySchema(
          normalizedProp,
          fieldContentType ?? (normalizedProp.type === undefined ? 'application/octet-stream' : undefined),
        ))
    ) {
      files.push(name);
    }
    if (
      schemaDeclaresType(normalizedProp, 'array') &&
      normalizedProp.items &&
      typeof normalizedProp.items === 'object'
    ) {
      const normalizedItems = normalizeAllOfSchema(
        normalizedProp.items as Record<string, unknown>,
        doc as Record<string, unknown>,
      );
      if (
        isBinaryItems(normalizedItems, allowOas31Binary) ||
        (allowOas31Binary &&
          isOas31RawBinarySchema(
            normalizedItems,
            fieldContentType ?? (normalizedItems.type === undefined ? 'application/octet-stream' : undefined),
          ))
      ) {
        files.push(name);
      }
    }
    if (prop.type === 'file') {
      files.push(name);
    }
  }
  return files;
}

/**
 * 从 OAS3 requestBody 中提取「允许多文件」的字段名子集（`fileFields` 的真子集）。
 *
 * 识别规则：`type:"array"` 且 `items.format` 为 `"binary"` 或 `"base64"`。这正是
 * springdoc 为后端 `MultipartFile[]` 和 WebFlux `Flux<FilePart>` 发射的 schema
 * 形状（参考 boot3-jakarta-app 的 `shouldExposeArrayOfBinarySchemaForMultipartArrayUpload`
 * smoke 测试）。不在此列表内的文件字段即单文件，UI 层应按 `<Upload multiple={false}>`
 * 渲染，并在 FormData 组装时只追加 1 份 part。
 *
 * 上游参考：xiaoymin/knife4j#733；本仓 issue #227、#251。
 */
function extractMultipleFileFields(
  schema: Record<string, unknown> | undefined,
  encoding: Record<string, unknown> | undefined,
  allowOas31Binary: boolean,
  doc: DocLike,
): string[] {
  if (!schema || !isObjectSchemaShape(schema) || !schema.properties) return [];
  const props = schema.properties as Record<string, Record<string, unknown>>;
  const multiple: string[] = [];
  for (const [name, prop] of Object.entries(props)) {
    const normalizedProp =
      prop && typeof prop === 'object' && !Array.isArray(prop)
        ? normalizeAllOfSchema(prop, doc as Record<string, unknown>)
        : undefined;
    if (
      normalizedProp &&
      schemaDeclaresType(normalizedProp, 'array') &&
      normalizedProp.items &&
      typeof normalizedProp.items === 'object'
    ) {
      const normalizedItems = normalizeAllOfSchema(
        normalizedProp.items as Record<string, unknown>,
        doc as Record<string, unknown>,
      );
      if (
        isBinaryItems(normalizedItems, allowOas31Binary) ||
        (allowOas31Binary &&
          isOas31RawBinarySchema(
            normalizedItems,
            encodingContentType(encoding, name) ??
              (normalizedItems.type === undefined ? 'application/octet-stream' : undefined),
          ))
      ) {
        multiple.push(name);
      }
    }
  }
  return multiple;
}

/**
 * 判断非 multipart requestBody 是否实际描述了文件上传字段。
 *
 * springdoc 在 `@PostMapping` 未显式声明 consumes 时，可能把
 * `@RequestParam MultipartFile file` 暴露为 `application/json` body：
 * `{ file: { type: "string", format: "binary" } }`。Swagger UI 仍按文件上传
 * 渲染，调试页也应把这种形状归一为 multipart，而不是显示 JSON 编辑器。
 *
 * 这里只接受 `format: "binary"`，不把 JSON 中的 base64/byte 字符串自动改成
 * 文件上传，以避免误伤真正的 JSON 文本字段。
 */
function hasBinaryUploadField(
  schema: Record<string, unknown> | undefined,
  allowOas31Binary: boolean,
  doc: DocLike,
): boolean {
  if (!schema || !isObjectSchemaShape(schema) || !schema.properties) return false;
  const props = schema.properties as Record<string, Record<string, unknown>>;
  for (const prop of Object.values(props)) {
    const normalizedProp =
      prop && typeof prop === 'object' && !Array.isArray(prop)
        ? normalizeAllOfSchema(prop, doc as Record<string, unknown>)
        : undefined;
    if (!normalizedProp) continue;
    if (normalizedProp.type === 'file') return true;
    if (
      schemaDeclaresType(normalizedProp, 'string') &&
      normalizedProp.format === 'binary' &&
      !(
        allowOas31Binary &&
        typeof normalizedProp.contentEncoding === 'string' &&
        normalizedProp.contentEncoding.length > 0
      )
    ) {
      return true;
    }
    if (
      schemaDeclaresType(normalizedProp, 'array') &&
      normalizedProp.items &&
      typeof normalizedProp.items === 'object'
    ) {
      const items = normalizeAllOfSchema(
        normalizedProp.items as Record<string, unknown>,
        doc as Record<string, unknown>,
      );
      const typeOk = items.type === undefined || schemaDeclaresType(items, 'string');
      const encoded = allowOas31Binary && typeof items.contentEncoding === 'string' && items.contentEncoding.length > 0;
      if (items.format === 'binary' && typeOk && !encoded) return true;
    }
  }
  return false;
}

/** 从 OAS3 requestBody encoding 中提取 contentType=application/json 的字段名 */
function extractJsonEncodingFields(encoding: Record<string, unknown> | undefined): string[] {
  if (!encoding) return [];
  const jsonFields: string[] = [];
  for (const [fieldName, enc] of Object.entries(encoding)) {
    if (enc && typeof enc === 'object') {
      const ct = (enc as Record<string, unknown>).contentType;
      if (typeof ct === 'string' && ct.toLowerCase().includes('application/json')) {
        jsonFields.push(fieldName);
      }
    }
  }
  return jsonFields;
}

/** 解析 $ref 参数 */
function resolveParameter(param: OAS3Param | OAS2Param, doc: DocLike): OAS3Param | OAS2Param {
  if (!param.$ref) return param;
  return dereferenceReferenceObject(param as Record<string, unknown>, doc as Record<string, unknown>) as
    OAS3Param | OAS2Param;
}

/** 将参数合并到结果列表（去重：同 name+in 不重复添加） */
function mergeParam(list: DebugParam[], param: DebugParam): void {
  const exists = list.some((p) => p.name === param.name && p.in === param.in);
  if (!exists) list.push(param);
}

// ─── 主函数 ───────────────────────────────────────────

export interface BuildDebugModelOptions {
  /** 完整 OpenAPI 文档 */
  doc: DocLike;
  /** URL path（如 /api/users/{id}） */
  path: string;
  /** HTTP 方法（小写） */
  method: string;
  /** 是否 OAS2 */
  isOAS2?: boolean;
  /** schema 解析上下文（maxDepth 等） */
  schemaCtx?: SchemaResolveContext;
}

/**
 * 从 OpenAPI operation 解析出统一的调试参数模型
 */
export function buildOperationDebugModel(options: BuildDebugModelOptions): OperationDebugModel {
  const { doc, path, method, isOAS2 = Boolean(doc.swagger), schemaCtx } = options;
  const useOas31ParameterPath = !isOAS2 && isOas31(doc);

  // 定位 PathItem 和 Operation
  const rawPathItem = doc.paths?.[path];
  const useOas31PathResolution = !isOAS2 && isOpenApi31Version(doc.openapi);
  const resolvedPathOperation =
    useOas31PathResolution && rawPathItem
      ? resolvePathItemOperation(
          rawPathItem as unknown as Record<string, unknown>,
          method.toLowerCase() as Parameters<typeof resolvePathItemOperation>[1],
          doc as Record<string, unknown>,
        )
      : null;
  const pathItem = useOas31PathResolution
    ? (resolvedPathOperation?.pathItem as PathItemLike | undefined)
    : rawPathItem
      ? (dereference(rawPathItem as unknown as Record<string, unknown>, doc as Record<string, unknown>) as PathItemLike)
      : undefined;
  if (!pathItem) {
    return {
      pathParams: [],
      queryParams: [],
      headerParams: [],
      cookieParams: [],
      bodyContents: [],
      bodyRequired: false,
    };
  }

  const operation = resolvedPathOperation
    ? (resolvedPathOperation.operation as OperationLike)
    : (pathItem[method] as OperationLike | undefined);
  if (!operation) {
    return {
      pathParams: [],
      queryParams: [],
      headerParams: [],
      cookieParams: [],
      bodyContents: [],
      bodyRequired: false,
    };
  }

  const ctx: SchemaResolveContext = schemaCtx ?? { doc: doc as Record<string, unknown>, maxDepth: 8 };

  // 合并 path-level parameters + operation-level parameters
  // operation 级参数覆盖 path 级（按 name+in 去重）
  const allRawParams: Array<OAS3Param | OAS2Param> = (
    resolvedPathOperation
      ? (operation.parameters ?? [])
      : [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
  ).map((parameter) => resolveParameter(parameter, doc));

  // 去重（同名同位置，后者覆盖前者）
  const paramMap = new Map<string, OAS3Param | OAS2Param>();
  for (const p of allRawParams) {
    const name = p.name ?? '';
    const in_ = p.in ?? '';
    paramMap.set(`${in_}:${name}`, p);
  }
  const uniqueParams = Array.from(paramMap.values());

  // 分组
  const pathParams: DebugParam[] = [];
  const queryParams: DebugParam[] = [];
  const headerParams: DebugParam[] = [];
  const cookieParams: DebugParam[] = [];
  const bodyContents: BodyContent[] = [];
  const parameterDiagnostics: ParameterDocumentDiagnostic[] = [];
  let bodyRequired = false;

  for (const raw of uniqueParams) {
    const in_ = raw.in ?? '';

    // OAS2: in=body → 走 requestBody 逻辑
    if (isOAS2 && in_ === 'body') {
      const schema =
        raw.schema && typeof raw.schema === 'object'
          ? dereference(raw.schema, doc as Record<string, unknown>)
          : undefined;
      const consumes = operation.consumes ?? doc.consumes ?? ['application/json'];
      const mediaType = consumes[0] ?? 'application/json';

      bodyContents.push({
        mediaType,
        category: classifyContentType(mediaType),
        schema,
        exampleValue: schema ? JSON.stringify(buildSchemaExample(schema, ctx), null, 2) : undefined,
      });
      bodyRequired = Boolean(raw.required);
      continue;
    }

    // OAS2: in=formData → 走 urlencoded/multipart 逻辑
    if (isOAS2 && in_ === 'formData') {
      // 累积 formData 参数到 bodyContents 中
      // 如果还没有 formData 类型的 bodyContent，创建一个
      const consumes = operation.consumes ?? doc.consumes ?? ['application/x-www-form-urlencoded'];
      const mediaType = consumes.includes('multipart/form-data')
        ? 'multipart/form-data'
        : (consumes[0] ?? 'application/x-www-form-urlencoded');
      const category = classifyContentType(mediaType);

      let existingBody = bodyContents.find((b) => b.category === category);
      if (!existingBody) {
        existingBody = {
          mediaType,
          category,
          schema: {
            type: 'object',
            properties: {},
            required: [],
          },
          fileFields: [],
        };
        bodyContents.push(existingBody);
      }

      // 将 formData 参数添加到 schema.properties
      const schemaObj = existingBody.schema as Record<string, unknown>;
      const props = (schemaObj.properties ?? {}) as Record<string, Record<string, unknown>>;
      const fieldName = raw.name ?? '';
      const fieldType = (raw as OAS2Param).type ?? 'string';

      props[fieldName] = {
        type: fieldType === 'file' ? 'string' : fieldType,
        format: fieldType === 'file' ? 'binary' : (raw as OAS2Param).format,
        description: raw.description,
        default: (raw as OAS2Param).default,
        enum: (raw as OAS2Param).enum,
        example: raw.example,
      };
      schemaObj.properties = props;

      // file 字段标记
      if (fieldType === 'file') {
        if (!existingBody.fileFields) existingBody.fileFields = [];
        existingBody.fileFields.push(fieldName);
      }

      // required
      if (raw.required) {
        const reqList = schemaObj.required as string[] | undefined;
        if (reqList) reqList.push(fieldName);
      }

      continue;
    }

    // 普通参数（path / query / header / cookie）
    const paramIn = in_ as ParamIn;
    if (!['path', 'query', 'header', 'cookie'].includes(paramIn)) continue;
    if (
      useOas31ParameterPath &&
      paramIn === 'header' &&
      OAS31_IGNORED_HEADER_PARAMETER_NAMES.has((raw.name ?? '').toLowerCase())
    ) {
      continue;
    }

    const oas31Analysis = useOas31ParameterPath
      ? analyzeOas31Parameter(raw as OAS3Param, paramIn, doc, ctx.maxDepth ?? 8)
      : undefined;
    if (oas31Analysis?.diagnostic) parameterDiagnostics.push(oas31Analysis.diagnostic);
    const rawSchema = raw.schema;
    const schema = oas31Analysis
      ? oas31Analysis.schema
      : rawSchema && typeof rawSchema === 'object'
        ? isOAS2
          ? dereference(rawSchema, doc as Record<string, unknown>)
          : normalizeAllOfSchema(rawSchema, doc as Record<string, unknown>, ctx.maxDepth ?? 8)
        : undefined;
    const schemaObject = schemaRecord(schema);
    const type = extractType(raw, schema);
    const parameterDefault = oas31Analysis
      ? schemaObject?.default !== undefined
        ? schemaObject.default
        : (raw as OAS2Param).default
      : (schemaObject?.default ?? (raw as OAS2Param).default);
    const parameterExample = oas31Analysis
      ? oas31Analysis.example !== undefined
        ? oas31Analysis.example
        : schemaObject?.example !== undefined
          ? schemaObject.example
          : raw.example
      : (schemaObject?.example ?? raw.example);
    const debugParam: DebugParam = {
      name: raw.name ?? '',
      in: paramIn,
      required: paramIn === 'path' ? true : Boolean(raw.required), // path 参数始终 required
      description: raw.description,
      type,
      format: (schemaObject?.format as string | undefined) ?? (raw as OAS2Param).format,
      default: parameterDefault,
      example: parameterExample,
      enum: extractEnum(raw, schema, type, doc, isOAS2),
      deprecated: raw.deprecated,
      readOnly: schemaObject?.readOnly as boolean | undefined,
      schema,
      style: isOAS2 ? undefined : (raw as OAS3Param).style,
      explode: isOAS2 ? undefined : (raw as OAS3Param).explode,
      allowReserved: isOAS2 ? undefined : (raw as OAS3Param).allowReserved,
      parameterSerialization: oas31Analysis?.serialization,
    };

    switch (paramIn) {
      case 'path':
        mergeParam(pathParams, debugParam);
        break;
      case 'query':
        mergeParam(queryParams, debugParam);
        break;
      case 'header':
        mergeParam(headerParams, debugParam);
        break;
      case 'cookie':
        mergeParam(cookieParams, debugParam);
        break;
    }
  }

  // OAS3: requestBody
  if (!isOAS2 && operation.requestBody) {
    const rb = operation.requestBody.$ref
      ? (dereferenceReferenceObject(
          operation.requestBody as Record<string, unknown>,
          doc as Record<string, unknown>,
        ) as unknown as OAS3RequestBody)
      : operation.requestBody;

    bodyRequired = Boolean(rb.required);

    if (rb.content) {
      const hasDeclaredMultipart = Object.keys(rb.content).some(
        (mediaType) => classifyContentType(mediaType) === 'multipart',
      );

      for (const [mediaType, mediaObj] of Object.entries(rb.content)) {
        const schema = mediaObj.schema ? normalizeAllOfSchema(mediaObj.schema, ctx.doc, ctx.maxDepth ?? 8) : undefined;
        const declaredCategory = classifyContentType(mediaType);
        const allowOas31Binary = isOas31(doc);
        const isMultipartFallback =
          !hasDeclaredMultipart &&
          declaredCategory !== 'multipart' &&
          hasBinaryUploadField(schema, allowOas31Binary, doc);
        const effectiveMediaType = isMultipartFallback ? 'multipart/form-data' : mediaType;
        const effectiveCategory: BodyContentType = isMultipartFallback ? 'multipart' : declaredCategory;
        const isMultipart = effectiveCategory === 'multipart';
        const encoding = mediaObj.encoding;
        const binary =
          effectiveCategory === 'raw' &&
          ((schema?.format === 'binary' &&
            schemaDeclaresType(schema, 'string') &&
            !(allowOas31Binary && typeof schema.contentEncoding === 'string' && schema.contentEncoding.length > 0)) ||
            (allowOas31Binary && isOas31RawBinarySchema(schema, mediaType)));

        bodyContents.push({
          mediaType: effectiveMediaType,
          category: effectiveCategory,
          schema,
          exampleValue: binary ? undefined : buildMediaTypeExampleValue(mediaObj, schema, ctx, { mediaType }),
          binary: binary || undefined,
          fileFields: isMultipart ? extractFileFields(schema, encoding, allowOas31Binary, doc) : undefined,
          // 区分「单文件」与「多文件」语义（issue #251）：
          // fileFields 记录所有文件字段（兼容老消费方），fileFieldsMultiple 仅记录
          // 其中允许多选的子集。UI 层据此决定 `<Upload multiple>` 和 FormData
          // 组装时 append 几次。
          fileFieldsMultiple: isMultipart
            ? extractMultipleFileFields(schema, encoding, allowOas31Binary, doc)
            : undefined,
          jsonFields: isMultipart ? extractJsonEncodingFields(encoding) : undefined,
        });
      }
    }
  }

  // ── 兜底：从 path 模板中提取未声明的 path 参数 ──
  // 某些 OpenAPI 文档（如 Springdoc 在特定配置下）可能遗漏 path 参数声明，
  // 但 URL 模板中存在 {xxx} 占位符。为避免调试页所有 tab 全部灰掉，
  // 我们从 path 模板自动补充缺失的 path 参数。
  const existingPathNames = new Set(pathParams.map((p) => p.name));
  const templateParamRe = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = templateParamRe.exec(path)) !== null) {
    const name = match[1];
    if (!existingPathNames.has(name)) {
      pathParams.push({
        name,
        in: 'path',
        required: true,
        description: undefined,
        type: 'string',
      });
      existingPathNames.add(name);
    }
  }

  return {
    pathParams,
    queryParams,
    headerParams,
    cookieParams,
    bodyContents,
    bodyRequired,
    ...(parameterDiagnostics.length > 0 ? { parameterDiagnostics } : {}),
  };
}
