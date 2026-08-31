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
  QueryParamValue,
  ValidationError,
} from './types';
import { replaceSerializedPathParams, serializeOas31Parameters } from './parameterSerialization';
import { serializeOas31FormBody } from './formBodyEncoding';

// ─── URL 构建 ─────────────────────────────────────────

/** 替换 path 参数：{id} → 实际值 */
export function replacePathParams(path: string, pathParams: Record<string, string>): string {
  let result = path;
  for (const [name, value] of Object.entries(pathParams)) {
    if (!name) continue;
    // 替换 {name} 和 {+name}（RFC 6570 简单展开）
    result = result.replace(new RegExp(`\\{\\+?${escapeRegExp(name)}\\}`, 'g'), encodeURIComponent(value));
  }
  return result;
}

export interface QueryParamEncoding {
  style?: string;
  explode?: boolean;
}

/** 按 OAS3 query 数组参数的 style / explode 规则拼接 query 字符串。 */
export function buildQueryString(
  queryParams: Record<string, QueryParamValue>,
  encodings: Record<string, QueryParamEncoding> = {},
): string {
  const pairs: string[] = [];
  for (const [name, value] of Object.entries(queryParams)) {
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      const encoding = encodings[name];
      const style = encoding?.style ?? 'form';
      const explode = encoding?.explode ?? style === 'form';
      const encodedName = encodeURIComponent(name);
      const encodedItems = value.map((item) => encodeURIComponent(item));
      if (style === 'form' && explode) {
        for (let index = 0; index < value.length; index++) {
          const item = value[index];
          if (!name && !item) continue;
          pairs.push(`${encodedName}=${encodedItems[index]}`);
        }
        continue;
      }
      if (style === 'form' && !explode) {
        pairs.push(`${encodedName}=${encodedItems.join(',')}`);
        continue;
      }
      if (style === 'spaceDelimited' && !explode) {
        pairs.push(`${encodedName}=${encodedItems.join('%20')}`);
        continue;
      }
      if (style === 'pipeDelimited' && !explode) {
        pairs.push(`${encodedName}=${encodedItems.join('%7C')}`);
        continue;
      }
      throw new Error(
        `Unsupported OAS3 query array serialization for "${name}": style=${style}, explode=${String(explode)}`,
      );
    }
    if (!name && !value) continue;
    pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  }
  return pairs.join('&');
}

// ─── Header 合并 ──────────────────────────────────────

interface HeaderLayer {
  values: Record<string, string> | undefined;
  source?: ParamSource;
  includeEmpty?: boolean;
}

/**
 * 多来源 headers 合并，后者覆盖前者。
 *
 * HTTP header 名大小写不敏感；被更高优先级的来源覆盖时，同时使用
 * 高优先级来源提供的 key 大小写，避免最终请求出现语义重复的 header。
 */
function mergeHeaderLayers(layers: HeaderLayer[]): {
  headers: Record<string, string>;
  sources: Record<string, ParamSource>;
} {
  const result: Record<string, string> = {};
  const resultSources: Record<string, ParamSource> = {};
  const keysByLowercase = new Map<string, string>();

  for (const layer of layers) {
    if (!layer.values) continue;
    for (const [key, value] of Object.entries(layer.values)) {
      if (value !== undefined && (value !== '' || layer.includeEmpty)) {
        const normalizedKey = key.toLowerCase();
        const previousKey = keysByLowercase.get(normalizedKey);
        if (previousKey !== undefined && previousKey !== key) {
          delete result[previousKey];
          delete resultSources[previousKey];
        }
        result[key] = value;
        keysByLowercase.set(normalizedKey, key);
        if (layer.source !== undefined) {
          resultSources[key] = layer.source;
        }
      }
    }
  }
  return { headers: result, sources: resultSources };
}

export function mergeHeaders(...sources: Array<Record<string, string> | undefined>): Record<string, string> {
  return mergeHeaderLayers(sources.map((values) => ({ values }))).headers;
}

/** 大小写不敏感地查找 header，返回命中的原 key。 */
function findHeaderKey(headers: Record<string, string>, name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalizedName) return key;
  }
  return undefined;
}

/** Remove names claimed by an explicitly supplied OAS 3.1 header parameter. */
function omitHeaderNames(headers: Record<string, string>, names: readonly string[]): Record<string, string> {
  if (names.length === 0) return headers;
  const omitted = new Set(names.map((name) => name.toLowerCase()));
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !omitted.has(name.toLowerCase())));
}

/** 将 cookie params 追加到 headers 的 Cookie 头，大小写不敏感地合并。 */
function appendCookieParams(
  headers: Record<string, string>,
  cookieParams: Record<string, string>,
): Record<string, string> {
  const pairs = Object.entries(cookieParams)
    .filter(([name, value]) => name !== '' && value !== '')
    .map(([name, value]) => `${name}=${value}`);
  if (pairs.length === 0) return headers;
  const existingKey = findHeaderKey(headers, 'Cookie');
  if (existingKey) {
    return {
      ...headers,
      [existingKey]: `${headers[existingKey]}; ${pairs.join('; ')}`,
    };
  }
  return {
    ...headers,
    Cookie: pairs.join('; '),
  };
}

function appendSerializedCookieParams(
  headers: Record<string, string>,
  cookieParams: readonly { readonly name: string; readonly value: string }[],
): Record<string, string> {
  const pairs = cookieParams.filter((item) => item.name !== '').map((item) => `${item.name}=${item.value}`);
  if (pairs.length === 0) return headers;
  const existingKey = findHeaderKey(headers, 'Cookie');
  if (existingKey) {
    return {
      ...headers,
      [existingKey]: `${headers[existingKey]}; ${pairs.join('; ')}`,
    };
  }
  return { ...headers, Cookie: pairs.join('; ') };
}

function appendQueryPreviewValue(query: Record<string, QueryParamValue>, name: string, value: string): void {
  const current = query[name];
  if (current === undefined) query[name] = value;
  else if (Array.isArray(current)) current.push(value);
  else query[name] = [current, value];
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
    headers['Authorization'] = `Bearer ${auth.bearerToken}`;
  }
  if (auth.basicCredentials) {
    headers['Authorization'] = `Basic ${auth.basicCredentials}`;
  }
  if (auth.apiKeys) {
    for (const [name, value] of Object.entries(auth.apiKeys)) {
      if (value) headers[name] = value;
    }
  }

  // ── 2. bySecurityKey 按 securityKeys 筛选 ──
  if (auth.bySecurityKey) {
    const entries = Object.entries(auth.bySecurityKey);
    const filtered = securityKeys === undefined ? entries : entries.filter(([key]) => securityKeys.includes(key));

    for (const [, scheme] of filtered) {
      if (!scheme) continue;
      if (scheme.type === 'apiKey') {
        if (!scheme.name || !scheme.value) continue;
        if (scheme.in === 'header') {
          headers[scheme.name] = scheme.value;
        } else if (scheme.in === 'query') {
          queries[scheme.name] = scheme.value;
        } else if (scheme.in === 'cookie') {
          const pair = `${scheme.name}=${scheme.value}`;
          const existingKey = findHeaderKey(headers, 'Cookie');
          if (existingKey) {
            headers[existingKey] = `${headers[existingKey]}; ${pair}`;
          } else {
            headers['Cookie'] = pair;
          }
        }
      } else if (scheme.type === 'http' && scheme.scheme === 'bearer') {
        if (scheme.token) {
          headers['Authorization'] = `Bearer ${scheme.token}`;
        }
      } else if (scheme.type === 'http' && scheme.scheme === 'basic') {
        if (scheme.username || scheme.password) {
          const raw = `${scheme.username ?? ''}:${scheme.password ?? ''}`;
          const encoded = base64Encode(raw);
          headers['Authorization'] = `Basic ${encoded}`;
        }
      } else if (scheme.type === 'oauth2') {
        if (scheme.accessToken) {
          const tokenType = scheme.tokenType ?? 'Bearer';
          headers['Authorization'] = `${tokenType} ${scheme.accessToken}`;
        }
      }
    }
  }

  return { headers, queries };
}

// ─── 全局参数 → headers + query ───────────────────────

/** 全局参数按位置拆分 */
export function splitGlobalParams(globalParams: GlobalParamValues | undefined): {
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
export function validateRequired(model: OperationDebugModel, form: DebugFormValues): ValidationError[] {
  const errors: ValidationError[] = [];

  const check = (params: typeof model.pathParams, values: Record<string, QueryParamValue>, in_: ParamIn) => {
    for (const param of params) {
      if (!param.required) continue;
      if (param.parameterSerialization && form.oas31ParameterValues) {
        if (Object.prototype.hasOwnProperty.call(form.oas31ParameterValues, `${param.in}:${param.name}`)) continue;
      }
      const value = values[param.name];
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
        errors.push({
          name: param.name,
          in: in_,
          message: `参数 ${param.name} 为必填项`,
          key: `${in_}:${param.name}`,
        });
      }
    }
  };

  check(model.pathParams, form.pathParams, 'path');
  check(model.queryParams, form.queryParams, 'query');
  check(model.headerParams, form.headerParams, 'header');
  check(model.cookieParams, form.cookieParams, 'cookie');

  const selected = form.selectedContentType ?? model.bodyContents[0]?.mediaType;
  const current = model.bodyContents.find((body) => body.mediaType === selected) ?? model.bodyContents[0];
  let hasMissingRequiredFile = false;

  // OAS 3.1 form files use the shared encoding plan so missing/cardinality
  // diagnostics participate in the same one-shot override as Schema issues.
  // Keep the historical hard-required behavior for OAS 3.0/OAS2.
  if (current?.category === 'multipart' && current.schema && !current.oas31Form) {
    const requiredFields = Array.isArray(current.schema.required) ? current.schema.required : [];
    const properties = current.schema.properties as Record<string, Record<string, unknown>> | undefined;
    const fileFields = new Set(current.fileFields ?? []);

    for (const name of requiredFields) {
      if (typeof name !== 'string' || !fileFields.has(name) || properties?.[name]?.readOnly) continue;
      const value = form.fileFields?.[name];
      if (!Array.isArray(value) || value.length === 0) {
        errors.push({
          name,
          in: 'body',
          message: `参数 ${name} 为必填项`,
          key: `body:${name}`,
        });
        hasMissingRequiredFile = true;
      }
    }
  }

  // body required — 根据当前选中的 content-type 决定从哪个字段判断
  if (model.bodyRequired && current && !current.oas31Form) {
    const category = current.category;

    let bodyMissing = false;
    if (current.binary) {
      bodyMissing = !form.binaryBodyFileName;
    } else if (category === 'json' || category === 'raw') {
      bodyMissing = !form.body || form.body.trim() === '';
    } else if (category === 'urlencoded' || category === 'multipart') {
      const hasFormField = form.formFields
        ? Object.keys(formFieldsForRequest(form.formFields, form.formFieldNamesToIncludeWhenEmpty)).length > 0
        : false;
      const hasFile = form.fileFields
        ? Object.values(form.fileFields).some((v) => Array.isArray(v) && v.length > 0)
        : false;
      bodyMissing = !hasFormField && !hasFile;
    }

    if (bodyMissing && !hasMissingRequiredFile) {
      errors.push({
        name: 'requestBody',
        in: 'body',
        message: '请求体为必填项',
        key: 'body:requestBody',
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
  /** 当前分组的全局参数 */
  globalParams?: GlobalParamValues;
  /** 当前文档应用下，所有分组共享的参数 */
  applicationParams?: GlobalParamValues;
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
  const { baseUrl, path, method, debugModel, formValues, globalParams, applicationParams, auth, securityKeys } =
    options;

  const parameterDiagnostic = debugModel.parameterDiagnostics?.[0];
  if (parameterDiagnostic) throw new Error(parameterDiagnostic.message);
  const serializedParameters = serializeOas31Parameters(debugModel, formValues.oas31ParameterValues);

  // 1. path 替换
  const resolvedPath = replacePathParams(
    replaceSerializedPathParams(path, serializedParameters.path),
    formValues.pathParams,
  );

  // 2. 参数拆分：application 为所有分组共享，global 为当前分组
  const application = splitGlobalParams(applicationParams);
  const gp = splitGlobalParams(globalParams);

  // 3. headers 合并（接口级 > 当前分组 > 鉴权 > 所有分组共享）
  const authResult = authToHeaders(auth, securityKeys);
  const consumedHeaderNames = serializedParameters.consumedHeaderNames;
  const headerMerge = mergeHeaderLayers([
    { values: omitHeaderNames(application.headers, consumedHeaderNames), source: 'application' },
    { values: omitHeaderNames(authResult.headers, consumedHeaderNames), source: 'auth' },
    { values: omitHeaderNames(gp.headers, consumedHeaderNames), source: 'global' },
    { values: omitHeaderNames(formValues.headerParams, consumedHeaderNames), source: 'interface' },
    // OAS 3.1 distinguishes an explicitly included empty value from an
    // omitted parameter. Keep legacy empty-header omission unchanged.
    { values: serializedParameters.headers, source: 'interface', includeEmpty: true },
  ]);
  const mergedHeaders = headerMerge.headers;
  const legacyCookieParams = { ...formValues.cookieParams };
  for (const name of serializedParameters.consumedCookieNames) delete legacyCookieParams[name];
  const headersWithCookies = appendSerializedCookieParams(
    appendCookieParams(mergedHeaders, legacyCookieParams),
    serializedParameters.cookies,
  );
  // query 参数合并（所有分组共享 < 鉴权 < 当前分组 < 接口级）。query 名大小写敏感。
  const mergedQuery: Record<string, QueryParamValue> = {
    ...application.queries,
    ...authResult.queries,
    ...gp.queries,
    ...formValues.queryParams,
  };
  for (const name of serializedParameters.consumedQueryNames) delete mergedQuery[name];

  // 3.5 sourceMap 追踪（仅当存在 applicationParams、auth 或 globalParams 时生成）
  const hasMultiSource = applicationParams !== undefined || auth !== undefined || globalParams !== undefined;
  let sourceMap: BuiltRequestSourceMap | undefined;
  if (hasMultiSource) {
    const headerSource = headerMerge.sources;
    const querySource: Record<string, ParamSource> = {};

    // query 保持大小写敏感的精确 key，按合并优先级同步覆盖来源。
    for (const key of Object.keys(application.queries)) {
      querySource[key] = 'application';
    }
    for (const key of Object.keys(authResult.queries)) {
      querySource[key] = 'auth';
    }
    for (const key of Object.keys(gp.queries)) {
      querySource[key] = 'global';
    }
    for (const key of Object.keys(formValues.queryParams)) {
      const value = formValues.queryParams[key];
      if (value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)) {
        querySource[key] = 'interface';
      }
    }
    for (const name of serializedParameters.consumedQueryNames) delete querySource[name];
    for (const parameter of serializedParameters.query) {
      querySource[parameter.name] = 'interface';
    }

    sourceMap = { headers: headerSource, query: querySource };
  }

  // 4. Content-Type + body 构建
  const selectedContentType =
    formValues.selectedContentType ?? (debugModel.bodyContents.length > 0 ? debugModel.bodyContents[0].mediaType : '');

  let body: string | undefined = undefined;
  const currentBody =
    debugModel.bodyContents.find((candidate) => candidate.mediaType === selectedContentType) ??
    debugModel.bodyContents[0];
  const category = currentBody?.category ?? 'raw';
  const formBodyPlan =
    currentBody?.oas31Form && (category === 'urlencoded' || category === 'multipart')
      ? serializeOas31FormBody(currentBody, {
          formFields: formValues.formFields,
          formFieldNamesToIncludeWhenEmpty: formValues.formFieldNamesToIncludeWhenEmpty,
          fileFields: formValues.fileFields as Record<string, readonly unknown[]> | undefined,
          partHeaders: formValues.formPartHeaders,
          bodyRequired: debugModel.bodyRequired,
        })
      : undefined;

  // Keep explicit request bodies for every HTTP method in the pure model and
  // generated cURL. Browser callers reject GET / HEAD bodies before Fetch.
  if (formBodyPlan?.kind === 'urlencoded') {
    body = formBodyPlan.body;
    if (findHeaderKey(headersWithCookies, 'Content-Type') === undefined) {
      headersWithCookies['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  } else if (formBodyPlan?.kind === 'multipart') {
    body = JSON.stringify(
      formFieldsForRequest(formValues.formFields ?? {}, formValues.formFieldNamesToIncludeWhenEmpty),
    );
  } else if (category === 'urlencoded' && formValues.formFields) {
    // application/x-www-form-urlencoded: 从 formFields 序列化
    body = buildUrlencodedBodyForRequest(formValues.formFields, formValues.formFieldNamesToIncludeWhenEmpty);
    if (findHeaderKey(headersWithCookies, 'Content-Type') === undefined) {
      headersWithCookies['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  } else if (category === 'multipart') {
    // multipart/form-data: 纯函数只拼文本字段；
    // UI 层需要用 fileFields 构建 FormData 后替换 body
    // 这里输出 JSON 占位（文本字段序列化），UI 层自行组装 FormData
    body = JSON.stringify(
      formFieldsForRequest(formValues.formFields ?? {}, formValues.formFieldNamesToIncludeWhenEmpty),
    );
    // multipart 不设 Content-Type（浏览器自动设 boundary）
  } else {
    // json / raw: 直接用 body 文本
    body = formValues.body;
    if (selectedContentType && findHeaderKey(headersWithCookies, 'Content-Type') === undefined) {
      headersWithCookies['Content-Type'] = selectedContentType;
    }
  }

  // 5. URL
  const queryEncodings = Object.fromEntries(
    debugModel.queryParams.map((param) => [param.name, { style: param.style, explode: param.explode }]),
  );
  const legacyQueryString = buildQueryString(mergedQuery, queryEncodings);
  const parameterQueryString = serializedParameters.query
    .map((parameter) => `${parameter.encodedName}=${parameter.encodedValue}`)
    .join('&');
  const queryString = [legacyQueryString, parameterQueryString].filter(Boolean).join('&');
  const url = `${baseUrl}${resolvedPath}${queryString ? `?${queryString}` : ''}`;
  const previewQuery: Record<string, QueryParamValue> = { ...mergedQuery };
  for (const parameter of serializedParameters.query) {
    appendQueryPreviewValue(previewQuery, parameter.name, parameter.value);
  }

  return {
    url,
    method: method.toUpperCase(),
    headers: headersWithCookies,
    query: previewQuery,
    body,
    binaryBodyFileName: formValues.binaryBodyFileName,
    contentType: selectedContentType,
    sourceMap,
    jsonFields: formValues.jsonFields,
    ...(serializedParameters.instances.length > 0 ? { parameterInstances: serializedParameters.instances } : {}),
    ...(serializedParameters.diagnostics.length > 0
      ? { parameterInputDiagnostics: serializedParameters.diagnostics }
      : {}),
    ...(serializedParameters.cookies.some((parameter) => parameter.name !== '')
      ? { hasExplicitCookieParameters: true }
      : {}),
    ...(formBodyPlan ? { formBodyPlan } : {}),
  };
}

// ─── Curl 生成 ────────────────────────────────────────

/** Quote one dynamic argument for POSIX-compatible shells. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * 从 BuiltRequest 生成等价 curl 命令
 *
 * 注意：multipart/form-data 场景因文件不可序列化为字符串，输出占位 `-F` 行，
 * 让用户自行补全文件路径（`-F field=@/path/to/file`）。
 */
export function buildCurl(req: BuiltRequest): string {
  const parts: string[] = [];

  parts.push('curl');
  parts.push('-X', req.method);

  const isMultipart =
    req.formBodyPlan?.kind === 'multipart' ||
    (typeof req.contentType === 'string' && req.contentType.toLowerCase().startsWith('multipart/'));

  // headers（multipart 不带 Content-Type，让 curl 自动生成 boundary）
  for (const [key, value] of Object.entries(req.headers)) {
    if (isMultipart && key.toLowerCase() === 'content-type') continue;
    parts.push('-H', shellQuote(`${key}: ${value}`));
  }

  if (req.formBodyPlan?.kind === 'multipart') {
    for (const part of req.formBodyPlan.parts) {
      const attributes = [`${curlFormQuoted(part.name)}=`];
      if (part.kind === 'file') {
        attributes[0] += `@${curlFormQuoted(`/path/to/${part.fileName}`)}`;
      } else {
        attributes[0] += curlFormQuoted(part.value);
      }
      if (part.contentType) attributes.push(`type=${part.contentType}`);
      for (const [name, value] of Object.entries(part.headers)) {
        attributes.push(`headers=${curlFormQuoted(`${name}: ${value}`)}`);
      }
      parts.push('-F', shellQuote(attributes.join(';')));
    }
  } else if (isMultipart) {
    // multipart：尝试从 body（若为 JSON 字段映射）拆出字段，否则给占位注释
    let fieldObj: Record<string, unknown> | null = null;
    if (typeof req.body === 'string' && req.body !== '') {
      try {
        const parsed: unknown = JSON.parse(req.body);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          fieldObj = parsed as Record<string, unknown>;
        }
      } catch {
        fieldObj = null;
      }
    }
    const jsonFieldSet = new Set(req.jsonFields ?? []);
    if (fieldObj && Object.keys(fieldObj).length > 0) {
      for (const [name, value] of Object.entries(fieldObj)) {
        if (value === undefined) continue;
        if (jsonFieldSet.has(name)) {
          // JSON-encoded part: append ;type=application/json
          parts.push('-F', shellQuote(`${name}=${String(value)};type=application/json`));
        } else {
          parts.push('-F', shellQuote(`${name}=${String(value)}`));
        }
      }
    }
    // 文件字段占位（UI 层调用方会在 body 外通过 curlFileFields 注入，
    // 若没有注入则仅提示用户手动追加 -F field=@/path/to/file）
    parts.push('# TODO append file fields via: -F field=@/path/to/file');
  } else if (req.binaryBodyFileName) {
    parts.push('--data-binary', shellQuote(`@/path/to/${req.binaryBodyFileName}`));
  } else if (req.body !== undefined && req.body !== '') {
    // 对 body 中的特殊字符做 shell 转义（单引号包裹，内部单引号转义）
    parts.push('-d', shellQuote(req.body));
  }

  // URL（用单引号包裹防止 shell 解析）
  parts.push(shellQuote(req.url));

  return parts.join(' \\\n  ');
}

/** Quote a value inside curl's multipart MIME mini-language. */
function curlFormQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ─── Urlencoded 序列化 ────────────────────────────────

/**
 * 将 formFields 序列化为 application/x-www-form-urlencoded 格式
 */
export function buildUrlencodedBody(fields: Record<string, string>): string {
  return buildUrlencodedBodyForRequest(fields);
}

function formFieldsForRequest(
  fields: Record<string, string>,
  formFieldNamesToIncludeWhenEmpty: readonly string[] = [],
): Record<string, string> {
  const includeWhenEmpty = new Set(formFieldNamesToIncludeWhenEmpty);
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([name, value]) => value !== undefined && (value !== '' || includeWhenEmpty.has(name)),
    ),
  );
}

function buildUrlencodedBodyForRequest(
  fields: Record<string, string>,
  formFieldNamesToIncludeWhenEmpty: readonly string[] = [],
): string {
  const pairs: string[] = [];
  for (const [name, value] of Object.entries(formFieldsForRequest(fields, formFieldNamesToIncludeWhenEmpty))) {
    pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
  }
  return pairs.join('&');
}

// ─── 工具 ─────────────────────────────────────────────

/** 纯 JS base64 编码（不依赖 btoa / Buffer） */
function base64Encode(str: string): string {
  const bytes: Uint8Array = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 正则特殊字符转义 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
