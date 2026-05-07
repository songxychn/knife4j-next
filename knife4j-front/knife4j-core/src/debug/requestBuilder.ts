/**
 * requestBuilder — 纯函数，构造请求对象 + curl 命令
 *
 * 输入：operation 信息 + 用户填写值 + 全局参数 + 鉴权
 * 输出：{ url, method, headers, query, body, contentType } + curl 字符串
 *
 * 不依赖浏览器 API，不依赖框架。
 */

import type {
  AuthValues,
  BuiltRequest,
  BuiltRequestSourceMap,
  DebugFormValues,
  GlobalParamValues,
  OperationDebugModel,
  ParamIn,
  ParamSource,
  ValidationError,
} from "./types";

// ─── URL 构建 ─────────────────────────────────────────

/** 替换 path 参数：{id} → 实际值 */
export function replacePathParams(
  path: string,
  pathParams: Record<string, string>,
): string {
  let result = path;
  for (const [name, value] of Object.entries(pathParams)) {
    if (!name) continue;
    // 替换 {name} 和 {+name}（RFC 6570 简单展开）
    result = result.replace(
      new RegExp(`\\{\\+?${escapeRegExp(name)}\\}`, "g"),
      encodeURIComponent(value),
    );
  }
  return result;
}

/** 拼接 query 字符串 */
export function buildQueryString(queryParams: Record<string, string>): string {
  const pairs: string[] = [];
  for (const [name, value] of Object.entries(queryParams)) {
    if (!name && !value) continue;
    pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  }
  return pairs.join("&");
}

// ─── Header 合并 ──────────────────────────────────────

/** 多来源 headers 合并，后者覆盖前者 */
export function mergeHeaders(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [key, value] of Object.entries(src)) {
      if (value !== undefined && value !== "") {
        result[key] = value;
      }
    }
  }
  return result;
}

// ─── 鉴权 → headers + query ──────────────────────────

/**
 * 将鉴权信息转化为 headers 和 query 参数。
 *
 * 处理顺序：
 * 1. 顶层 legacy 字段（`bearerToken` / `basicCredentials` / `apiKeys`）—— 保留 TASK-031 之前的行为
 * 2. `bySecurityKey` 中按 `securityKeys` 筛选的 scheme 值（若 `securityKeys` 为 undefined，则注入全部）
 *
 * `securityKeys` 里出现但 `bySecurityKey` 中缺失 / 未填写的项会被忽略，不抛错。
 * cookie 位置的 apiKey 会写入 `Cookie` 头：`name=value`；已有的 Cookie 头会以 `; ` 追加。
 */
export function authToHeaders(
  auth: AuthValues | undefined,
  securityKeys?: string[],
): { headers: Record<string, string>; queries: Record<string, string> } {
  const headers: Record<string, string> = {};
  const queries: Record<string, string> = {};
  if (!auth) return { headers, queries };

  // ── 1. Legacy 顶层字段 ──
  if (auth.bearerToken) {
    headers["Authorization"] = `Bearer ${auth.bearerToken}`;
  }
  if (auth.basicCredentials) {
    headers["Authorization"] = `Basic ${auth.basicCredentials}`;
  }
  if (auth.apiKeys) {
    for (const [name, value] of Object.entries(auth.apiKeys)) {
      if (value) headers[name] = value;
    }
  }

  // ── 2. bySecurityKey 按 securityKeys 筛选 ──
  if (auth.bySecurityKey) {
    const entries = Object.entries(auth.bySecurityKey);
    const filtered =
      securityKeys === undefined
        ? entries
        : entries.filter(([key]) => securityKeys.includes(key));

    for (const [, scheme] of filtered) {
      if (!scheme) continue;
      if (scheme.type === "apiKey") {
        if (!scheme.name || !scheme.value) continue;
        if (scheme.in === "header") {
          headers[scheme.name] = scheme.value;
        } else if (scheme.in === "query") {
          queries[scheme.name] = scheme.value;
        } else if (scheme.in === "cookie") {
          const pair = `${scheme.name}=${scheme.value}`;
          headers["Cookie"] = headers["Cookie"]
            ? `${headers["Cookie"]}; ${pair}`
            : pair;
        }
      } else if (scheme.type === "http" && scheme.scheme === "bearer") {
        if (scheme.token) {
          headers["Authorization"] = `Bearer ${scheme.token}`;
        }
      } else if (scheme.type === "http" && scheme.scheme === "basic") {
        if (scheme.username || scheme.password) {
          const raw = `${scheme.username ?? ""}:${scheme.password ?? ""}`;
          const encoded = base64Encode(raw);
          headers["Authorization"] = `Basic ${encoded}`;
        }
      } else if (scheme.type === "oauth2") {
        if (scheme.accessToken) {
          const tokenType = scheme.tokenType ?? "Bearer";
          headers["Authorization"] = `${tokenType} ${scheme.accessToken}`;
        }
      }
    }
  }

  return { headers, queries };
}

// ─── 全局参数 → headers + query ───────────────────────

/** 全局参数按位置拆分 */
export function splitGlobalParams(
  globalParams: GlobalParamValues | undefined,
): {
  headers: Record<string, string>;
  queries: Record<string, string>;
} {
  return {
    headers: globalParams?.headers ?? {},
    queries: globalParams?.queries ?? {},
  };
}

// ─── Required 校验 ────────────────────────────────────

/** 校验必填参数，返回缺失列表 */
export function validateRequired(
  model: OperationDebugModel,
  form: DebugFormValues,
): ValidationError[] {
  const errors: ValidationError[] = [];

  const check = (
    params: typeof model.pathParams,
    values: Record<string, string>,
    in_: ParamIn,
  ) => {
    for (const param of params) {
      if (!param.required) continue;
      const value = values[param.name];
      if (value === undefined || value === "") {
        errors.push({
          name: param.name,
          in: in_,
          message: `参数 ${param.name} 为必填项`,
          key: `${in_}:${param.name}`,
        });
      }
    }
  };

  check(model.pathParams, form.pathParams, "path");
  check(model.queryParams, form.queryParams, "query");
  check(model.headerParams, form.headerParams, "header");
  check(model.cookieParams, form.cookieParams, "cookie");

  // body required — 根据当前选中的 content-type 决定从哪个字段判断
  if (model.bodyRequired && model.bodyContents.length > 0) {
    const selected =
      form.selectedContentType ?? model.bodyContents[0].mediaType;
    const current =
      model.bodyContents.find((b) => b.mediaType === selected) ??
      model.bodyContents[0];
    const category = current.category;

    let bodyMissing = false;
    if (category === "json" || category === "raw") {
      bodyMissing = !form.body || form.body.trim() === "";
    } else if (category === "urlencoded" || category === "multipart") {
      const hasFormField = form.formFields
        ? Object.values(form.formFields).some(
            (v) => v !== undefined && v !== "",
          )
        : false;
      const hasFile = form.fileFields
        ? Object.values(form.fileFields).some(
            (v) => Array.isArray(v) && v.length > 0,
          )
        : false;
      bodyMissing = !hasFormField && !hasFile;
    }

    if (bodyMissing) {
      errors.push({
        name: "requestBody",
        in: "body",
        message: "请求体为必填项",
        key: "body:requestBody",
      });
    }
  }

  return errors;
}

// ─── 主函数 ───────────────────────────────────────────

export interface BuildRequestOptions {
  /** 基础 URL（如 http://localhost:8080） */
  baseUrl: string;
  /** URL path（如 /api/users/{id}） */
  path: string;
  /** HTTP 方法 */
  method: string;
  /** 解析后的调试模型 */
  debugModel: OperationDebugModel;
  /** 用户填写的表单值 */
  formValues: DebugFormValues;
  /** 全局参数 */
  globalParams?: GlobalParamValues;
  /** 鉴权信息 */
  auth?: AuthValues;
  /**
   * 当前 operation 生效的 security key 列表（来自 OpenAPI operation.security）。
   *
   * 传入则按此筛选 `auth.bySecurityKey` 只注入命中的 scheme；
   * 传 undefined 保持旧行为（注入顶层 legacy 字段 + 所有 `bySecurityKey`）。
   */
  securityKeys?: string[];
}

/**
 * 构建最终请求对象
 */
export function buildRequest(options: BuildRequestOptions): BuiltRequest {
  const {
    baseUrl,
    path,
    method,
    debugModel,
    formValues,
    globalParams,
    auth,
    securityKeys,
  } = options;

  // 1. path 替换
  const resolvedPath = replacePathParams(path, formValues.pathParams);

  // 2. 拆分全局参数
  const gp = splitGlobalParams(globalParams);

  // 3. headers 合并（全局参数 > Authorize 鉴权 > 接口级）
  // 优先级从低到高：接口级表单 < Authorize 鉴权 < 全局参数
  // 全局参数（GlobalParam 页面）始终能覆盖接口级默认值，避免全局 Authorization 丢失
  // （issue #275 / upstream #902）
  const authResult = authToHeaders(auth, securityKeys);
  const mergedHeaders = mergeHeaders(
    formValues.headerParams, // 接口级最低
    authResult.headers, // Authorize 鉴权
    gp.headers, // 全局参数最高
  );
  // query 参数合并（接口级 < 鉴权 < 全局参数）
  const mergedQuery: Record<string, string> = {
    ...formValues.queryParams,
    ...authResult.queries,
    ...gp.queries,
  };

  // 3.5 sourceMap 追踪（仅当存在 auth 或 globalParams 时生成）
  const hasMultiSource = auth !== undefined || globalParams !== undefined;
  let sourceMap: BuiltRequestSourceMap | undefined;
  if (hasMultiSource) {
    const headerSource: Record<string, ParamSource> = {};
    const querySource: Record<string, ParamSource> = {};

    // 先标记接口级来源（最低优先级）
    for (const key of Object.keys(formValues.headerParams)) {
      if (
        formValues.headerParams[key] !== undefined &&
        formValues.headerParams[key] !== ""
      ) {
        headerSource[key] = "interface";
      }
    }
    for (const key of Object.keys(formValues.queryParams)) {
      if (
        formValues.queryParams[key] !== undefined &&
        formValues.queryParams[key] !== ""
      ) {
        querySource[key] = "interface";
      }
    }
    // auth 覆盖接口级
    for (const key of Object.keys(authResult.headers)) {
      headerSource[key] = "auth";
    }
    for (const key of Object.keys(authResult.queries)) {
      querySource[key] = "auth";
    }
    // 全局参数覆盖 auth（最高优先级）
    for (const key of Object.keys(gp.headers)) {
      headerSource[key] = "global";
    }
    for (const key of Object.keys(gp.queries)) {
      querySource[key] = "global";
    }

    sourceMap = { headers: headerSource, query: querySource };
  }

  // 4. Content-Type + body 构建
  const selectedContentType =
    formValues.selectedContentType ??
    (debugModel.bodyContents.length > 0
      ? debugModel.bodyContents[0].mediaType
      : "");

  const hasBody = !["GET", "HEAD"].includes(method.toUpperCase());
  let body: string | undefined = undefined;

  if (hasBody) {
    const category =
      debugModel.bodyContents.find((b) => b.mediaType === selectedContentType)
        ?.category ?? "raw";

    if (category === "urlencoded" && formValues.formFields) {
      // application/x-www-form-urlencoded: 从 formFields 序列化
      body = buildUrlencodedBody(formValues.formFields);
      if (!mergedHeaders["Content-Type"]) {
        mergedHeaders["Content-Type"] = "application/x-www-form-urlencoded";
      }
    } else if (category === "multipart") {
      // multipart/form-data: 纯函数只拼文本字段；
      // UI 层需要用 fileFields 构建 FormData 后替换 body
      // 这里输出 JSON 占位（文本字段序列化），UI 层自行组装 FormData
      body = JSON.stringify(formValues.formFields ?? {});
      // multipart 不设 Content-Type（浏览器自动设 boundary）
    } else {
      // json / raw: 直接用 body 文本
      body = formValues.body;
      if (selectedContentType && !mergedHeaders["Content-Type"]) {
        mergedHeaders["Content-Type"] = selectedContentType;
      }
    }
  }

  // 5. URL
  const queryString = buildQueryString(mergedQuery);
  const url = `${baseUrl}${resolvedPath}${queryString ? `?${queryString}` : ""}`;

  return {
    url,
    method: method.toUpperCase(),
    headers: mergedHeaders,
    query: mergedQuery,
    body,
    contentType: selectedContentType,
    sourceMap,
    jsonFields: formValues.jsonFields,
  };
}

// ─── Curl 生成 ────────────────────────────────────────

/**
 * 从 BuiltRequest 生成等价 curl 命令
 *
 * 注意：multipart/form-data 场景因文件不可序列化为字符串，输出占位 `-F` 行，
 * 让用户自行补全文件路径（`-F field=@/path/to/file`）。
 */
export function buildCurl(req: BuiltRequest): string {
  const parts: string[] = [];

  parts.push("curl");
  parts.push("-X", req.method);

  const isMultipart =
    typeof req.contentType === "string" &&
    req.contentType.toLowerCase().includes("multipart/form-data");

  // headers（multipart 不带 Content-Type，让 curl 自动生成 boundary）
  for (const [key, value] of Object.entries(req.headers)) {
    if (isMultipart && key.toLowerCase() === "content-type") continue;
    parts.push("-H", `${key}: ${value}`);
  }

  if (isMultipart) {
    // multipart：尝试从 body（若为 JSON 字段映射）拆出字段，否则给占位注释
    let fieldObj: Record<string, unknown> | null = null;
    if (typeof req.body === "string" && req.body !== "") {
      try {
        const parsed: unknown = JSON.parse(req.body);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          fieldObj = parsed as Record<string, unknown>;
        }
      } catch {
        fieldObj = null;
      }
    }
    const jsonFieldSet = new Set(req.jsonFields ?? []);
    if (fieldObj && Object.keys(fieldObj).length > 0) {
      for (const [name, value] of Object.entries(fieldObj)) {
        if (value === undefined || value === "") continue;
        const escaped = String(value).replace(/'/g, "'\\''");
        if (jsonFieldSet.has(name)) {
          // JSON-encoded part: append ;type=application/json
          parts.push("-F", `'${name}=${escaped};type=application/json'`);
        } else {
          parts.push("-F", `'${name}=${escaped}'`);
        }
      }
    }
    // 文件字段占位（UI 层调用方会在 body 外通过 curlFileFields 注入，
    // 若没有注入则仅提示用户手动追加 -F field=@/path/to/file）
    parts.push("# TODO append file fields via: -F field=@/path/to/file");
  } else if (req.body !== undefined && req.body !== "") {
    // 对 body 中的特殊字符做 shell 转义（单引号包裹，内部单引号转义）
    const escapedBody = req.body.replace(/'/g, "'\\''");
    parts.push("-d", `'${escapedBody}'`);
  }

  // URL（用单引号包裹防止 shell 解析）
  parts.push(`'${req.url}'`);

  return parts.join(" \\\n  ");
}

// ─── Urlencoded 序列化 ────────────────────────────────

/**
 * 将 formFields 序列化为 application/x-www-form-urlencoded 格式
 */
export function buildUrlencodedBody(fields: Record<string, string>): string {
  const pairs: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === "") continue;
    pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  }
  return pairs.join("&");
}

// ─── 工具 ─────────────────────────────────────────────

/** 纯 JS base64 编码（不依赖 btoa / Buffer） */
function base64Encode(str: string): string {
  const bytes: Uint8Array = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 正则特殊字符转义 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
