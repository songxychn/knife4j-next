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
  SchemaResolveContext,
} from './types';
import { resolveRef, dereference } from './resolveRef';
import { buildSchemaExample } from './schemaExample';

// ─── 内部类型 ─────────────────────────────────────────

/** OAS3 ParameterObject（简化） */
interface OAS3Param {
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
  example?: unknown;
  deprecated?: boolean;
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
function extractType(param: OAS2Param | OAS3Param, schema?: Record<string, unknown>): string {
  // OAS2 直接有 type 字段
  const directType = (param as OAS2Param).type;
  if (directType) {
    // OAS2 的 file 类型
    if (directType === 'file') return 'file';
    return directType;
  }
  if (schema) {
    const t = schema.type as string | undefined;
    if (t === 'string') {
      const f = schema.format as string | undefined;
      if (f === 'binary') return 'file';
    }
    return t ?? 'string';
  }
  return 'string';
}

/** 分类 content-type */
function classifyContentType(mediaType: string): BodyContentType {
  if (mediaType.includes('json')) return 'json';
  if (mediaType.includes('x-www-form-urlencoded')) return 'urlencoded';
  if (mediaType.includes('multipart')) return 'multipart';
  return 'raw';
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
function isBinaryItems(items: Record<string, unknown>): boolean {
  if (items.format !== 'binary' && items.format !== 'base64') return false;
  // 如果 items.type 存在但显式不是 'string'，说明是其他数组（例如 number[]），不算文件。
  // 没有 type 字段 / type === 'string' 都接受。
  return items.type === undefined || items.type === 'string';
}

/** 从 OAS3 requestBody 中提取 file 字段名 */
function extractFileFields(schema: Record<string, unknown> | undefined): string[] {
  if (!schema || schema.type !== 'object' || !schema.properties) return [];
  const props = schema.properties as Record<string, Record<string, unknown>>;
  const files: string[] = [];
  for (const [name, prop] of Object.entries(props)) {
    if (prop.type === 'string' && (prop.format === 'binary' || prop.format === 'base64')) {
      files.push(name);
    }
    if (prop.type === 'array' && prop.items && typeof prop.items === 'object') {
      if (isBinaryItems(prop.items as Record<string, unknown>)) {
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
function extractMultipleFileFields(schema: Record<string, unknown> | undefined): string[] {
  if (!schema || schema.type !== 'object' || !schema.properties) return [];
  const props = schema.properties as Record<string, Record<string, unknown>>;
  const multiple: string[] = [];
  for (const [name, prop] of Object.entries(props)) {
    if (prop.type === 'array' && prop.items && typeof prop.items === 'object') {
      if (isBinaryItems(prop.items as Record<string, unknown>)) {
        multiple.push(name);
      }
    }
  }
  return multiple;
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
  const resolved = resolveRef(param.$ref, doc as Record<string, unknown>);
  return resolved ? (resolved as OAS3Param | OAS2Param) : param;
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

  // 定位 PathItem 和 Operation
  const pathItem = doc.paths?.[path];
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

  const operation = pathItem[method] as OperationLike | undefined;
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
  const allRawParams: Array<OAS3Param | OAS2Param> = [
    ...(pathItem.parameters ?? []).map((p) => resolveParameter(p, doc)),
    ...(operation.parameters ?? []).map((p) => resolveParameter(p, doc)),
  ];

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
  let bodyRequired = false;

  for (const raw of uniqueParams) {
    const in_ = raw.in ?? '';

    // OAS2: in=body → 走 requestBody 逻辑
    if (isOAS2 && in_ === 'body') {
      const schema = raw.schema ? dereference(raw.schema, doc as Record<string, unknown>) : undefined;
      const consumes = operation.consumes ?? doc.consumes ?? ['application/json'];
      const mediaType = consumes[0] ?? 'application/json';

      bodyContents.push({
        mediaType,
        category: classifyContentType(mediaType),
        schema: schema ?? raw.schema,
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

    const schema = raw.schema ? dereference(raw.schema, doc as Record<string, unknown>) : undefined;
    const debugParam: DebugParam = {
      name: raw.name ?? '',
      in: paramIn,
      required: paramIn === 'path' ? true : Boolean(raw.required), // path 参数始终 required
      description: raw.description,
      type: extractType(raw, schema),
      format: (schema?.format as string | undefined) ?? (raw as OAS2Param).format,
      default: schema?.default ?? (raw as OAS2Param).default,
      example: schema?.example ?? raw.example,
      enum: (schema?.enum as unknown[] | undefined) ?? (raw as OAS2Param).enum,
      deprecated: raw.deprecated,
      readOnly: schema?.readOnly as boolean | undefined,
      schema: schema ?? (raw.schema ? { ...raw.schema } : undefined),
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
      ? (dereference(
          operation.requestBody as Record<string, unknown>,
          doc as Record<string, unknown>,
        ) as unknown as OAS3RequestBody)
      : operation.requestBody;

    bodyRequired = Boolean(rb.required);

    if (rb.content) {
      for (const [mediaType, mediaObj] of Object.entries(rb.content)) {
        const schema = mediaObj.schema ? dereference(mediaObj.schema, doc as Record<string, unknown>) : undefined;
        const isMultipart = classifyContentType(mediaType) === 'multipart';
        const encoding = mediaObj.encoding;

        bodyContents.push({
          mediaType,
          category: classifyContentType(mediaType),
          schema,
          exampleValue: schema
            ? JSON.stringify(buildSchemaExample(schema, ctx), null, 2)
            : mediaObj.example
              ? JSON.stringify(mediaObj.example, null, 2)
              : undefined,
          fileFields: isMultipart ? extractFileFields(schema) : undefined,
          // 区分「单文件」与「多文件」语义（issue #251）：
          // fileFields 记录所有文件字段（兼容老消费方），fileFieldsMultiple 仅记录
          // 其中允许多选的子集。UI 层据此决定 `<Upload multiple>` 和 FormData
          // 组装时 append 几次。
          fileFieldsMultiple: isMultipart ? extractMultipleFileFields(schema) : undefined,
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
  };
}
