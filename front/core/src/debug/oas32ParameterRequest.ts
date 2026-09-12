import { parameterOwn } from './oas32ParameterModel';
import { oas32CookiePairs, serializeOas32Parameters, validateOas32Header } from './oas32ParameterSerialization';
import type {
  Oas32ParameterCollection,
  Oas32ParameterDiagnostic,
  Oas32ParameterInput,
  Oas32ParameterPlan,
} from './oas32ParameterTypes';
import type { BuiltRequest, DebugFormValues, QueryParamValue, ValidationError } from './types';
import type { BuildRequestOptions } from './requestBuilder';

/** Hard request failures retain structured provenance; Schema override cannot catch-and-send a fallback. */
export class Oas32ParameterRequestError extends Error {
  constructor(readonly diagnostics: readonly Oas32ParameterDiagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
    Object.setPrototypeOf(this, Oas32ParameterRequestError.prototype);
    this.name = 'Oas32ParameterRequestError';
  }
}

/** Single-pass exact names. A '+' is part of an OAS parameter name, not a URI-template operator. */
export function replaceOas32PathParameters(path: string, values: Readonly<Record<string, string>>): string {
  return path.replace(/\{([^}]+)\}/g, (match, name: string) => (parameterOwn(values, name) ? values[name] : match));
}

/** Temporary G/editor bridge. New consumers should provide oas32ParameterInputs directly. */
export function oas32ParameterInputs(
  collection: Oas32ParameterCollection,
  form: DebugFormValues,
): Readonly<Record<string, Oas32ParameterInput>> {
  const inputs: Record<string, Oas32ParameterInput> = Object.create(null) as Record<string, Oas32ParameterInput>;
  for (const parameter of collection.parameters) {
    const key = parameter.key;
    if (form.oas32ParameterInputs && parameterOwn(form.oas32ParameterInputs, key))
      inputs[key] = form.oas32ParameterInputs[key];
    else if (form.serializedExampleParameters && parameterOwn(form.serializedExampleParameters, key)) {
      const example = form.serializedExampleParameters[key];
      inputs[key] = {
        kind: example.layer,
        text: example.text,
        ...(parameterOwn(example, 'instance') ? { data: example.instance } : {}),
      };
    } else if (form.oas31ParameterValues && parameterOwn(form.oas31ParameterValues, key))
      inputs[key] = { kind: 'editor', text: form.oas31ParameterValues[key] };
    else if (parameter.in !== 'querystring') {
      const source =
        parameter.in === 'path'
          ? form.pathParams
          : parameter.in === 'query'
            ? form.queryParams
            : parameter.in === 'header'
              ? form.headerParams
              : form.cookieParams;
      if (parameterOwn(source, parameter.name)) {
        const value = source[parameter.name];
        inputs[key] = Array.isArray(value) ? { kind: 'data', value } : { kind: 'editor', text: value };
      }
    }
  }
  return inputs;
}

export function validateOas32Required(
  collection: Oas32ParameterCollection,
  plan: Oas32ParameterPlan,
): ValidationError[] {
  return collection.parameters
    .filter((parameter) => parameter.required && plan.presence[parameter.key] === false)
    .map((parameter) => ({
      name: parameter.name,
      in: parameter.in,
      key: parameter.key,
      message: `参数 ${parameter.name} 为必填项`,
    }));
}

const forbiddenHeaders = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);
/** Fetch-only restrictions are previewable and cannot be waived by the Schema-negative request switch. */
export function oas32BrowserRequestDiagnostics(
  request: Pick<BuiltRequest, 'url' | 'method' | 'headers' | 'body' | 'binaryBodyFileName' | 'explicitExampleBody'>,
): Oas32ParameterDiagnostic[] {
  const diagnostics: Oas32ParameterDiagnostic[] = [];
  const add = (code: string, message: string, name?: string) =>
    diagnostics.push({ phase: 'browser', code, message, name, blocks: 'browser' });
  const method = request.method.toUpperCase();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(request.method) || ['CONNECT', 'TRACE', 'TRACK'].includes(method))
    add('FETCH_METHOD_UNAVAILABLE', 'Fetch does not permit this request method.');
  if (['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'].includes(method) && method !== request.method)
    add('FETCH_METHOD_NORMALIZATION', 'Fetch would normalize the author method name.');
  if (
    ['GET', 'HEAD'].includes(method) &&
    ((request.body !== undefined && (request.body !== '' || request.explicitExampleBody)) || request.binaryBodyFileName)
  )
    add('FETCH_BODY_UNAVAILABLE', 'Fetch does not permit a body for GET or HEAD.');
  for (const [name, value] of Object.entries(request.headers)) {
    const lower = name.toLowerCase();
    if (
      forbiddenHeaders.has(lower) ||
      lower.startsWith('proxy-') ||
      lower.startsWith('sec-') ||
      (['x-http-method', 'x-http-method-override', 'x-method-override'].includes(lower) &&
        value.split(',').some((method) => ['CONNECT', 'TRACE', 'TRACK'].includes(method.trim().toUpperCase())))
    )
      add('FETCH_HEADER_UNAVAILABLE', `Fetch controls or forbids header ${name}.`, name);
    if (value.trim() !== value || Array.from(value).some((character) => character.charCodeAt(0) > 255))
      add('FETCH_HEADER_REPRESENTATION', `Fetch cannot preserve this header value exactly: ${name}.`, name);
  }
  try {
    const url = new URL(request.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      add('FETCH_URL_UNAVAILABLE', 'Fetch requires an HTTP(S) URL without embedded credentials.');
    if (url.href !== request.url || url.hash)
      add('FETCH_URL_NORMALIZATION', 'Fetch would normalize or omit part of the constructed request URL.');
  } catch {
    add('FETCH_URL_UNAVAILABLE', 'The constructed request URL cannot be parsed.');
  }
  return diagnostics;
}

export function assertOas32BrowserRequest(request: BuiltRequest): void {
  const diagnostics = [
    ...(request.oas32ParameterPlan?.diagnostics ?? []),
    ...oas32BrowserRequestDiagnostics(request),
  ].filter((diagnostic) => diagnostic.blocks !== 'none');
  if (diagnostics.length) throw new Oas32ParameterRequestError(diagnostics);
}

export function buildRequestWithOas32Parameters(
  options: BuildRequestOptions,
  buildLegacy: (options: BuildRequestOptions) => BuiltRequest,
): BuiltRequest {
  const collection = options.debugModel.oas32Parameters;
  if (!collection) throw new Error('An OAS 3.2 parameter collection is required.');
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(options.method))
    throw new Oas32ParameterRequestError([
      {
        phase: 'input',
        code: 'HTTP_METHOD_INVALID',
        message: 'The HTTP method must be a token without controls or separators.',
        blocks: 'all',
      },
    ]);
  const input = oas32ParameterInputs(collection, options.formValues);
  const plan = serializeOas32Parameters(collection, input);
  const failures = plan.diagnostics.filter((diagnostic) => diagnostic.blocks === 'all');
  const customQuery = Object.fromEntries(
    Object.entries(options.formValues.queryParams).filter(
      ([name]) => !collection.parameters.some((parameter) => parameter.in === 'query' && parameter.name === name),
    ),
  );
  if (plan.wholeQuery) {
    const sources: Array<{
      source: Oas32ParameterDiagnostic['source'];
      values?: Readonly<Record<string, QueryParamValue>>;
    }> = [
      { source: 'application', values: options.applicationParams?.queries },
      { source: 'global', values: options.globalParams?.queries },
      { source: 'custom', values: customQuery },
    ];
    for (const { source, values } of sources)
      for (const [name, value] of Object.entries(values ?? {})) {
        if (Array.isArray(value) && value.length === 0) continue;
        failures.push({
          phase: 'input',
          code: 'QUERYSTRING_SOURCE_CONFLICT',
          message: `Whole querystring conflicts with ${String(source)} query source ${name}.`,
          key: plan.wholeQuery.key,
          name,
          source,
          blocks: 'all',
        });
      }
    // Inspect actual selected values before legacy Record materialization can lose special property names.
    for (const [securityKey, scheme] of Object.entries(options.auth?.bySecurityKey ?? {})) {
      if (options.securityKeys && !options.securityKeys.includes(securityKey)) continue;
      if (scheme.type === 'apiKey' && scheme.in === 'query' && scheme.value)
        failures.push({
          phase: 'input',
          code: 'QUERYSTRING_SOURCE_CONFLICT',
          message: `Whole querystring conflicts with auth query source ${scheme.name}.`,
          key: plan.wholeQuery.key,
          source: 'auth',
          name: scheme.name,
          blocks: 'all',
        });
    }
  }
  if (/[?#]/.test(options.baseUrl))
    failures.push({
      phase: 'input',
      code: 'BASE_URL_COMPONENT_CONFLICT',
      message: 'The request base URL contains a query or fragment component.',
      source: 'base-url',
      blocks: 'all',
    });
  if (failures.length) throw new Oas32ParameterRequestError(failures);
  const resolvedPath = replaceOas32PathParameters(options.path, plan.path);
  if (/\{[^}]+\}/.test(resolvedPath))
    throw new Oas32ParameterRequestError([
      {
        phase: 'input',
        code: 'PATH_VALUE_MISSING',
        message: 'A path parameter has no serialized value.',
        blocks: 'all',
      },
    ]);
  const declaredHeaderNames = new Set(plan.headers.map((header) => header.name.toLowerCase()));
  const removeHeaders = (headers: Record<string, string>) =>
    Object.fromEntries(Object.entries(headers).filter(([name]) => !declaredHeaderNames.has(name.toLowerCase())));
  const form = options.formValues;
  const remainder = buildLegacy({
    ...options,
    path: resolvedPath,
    debugModel: {
      ...options.debugModel,
      oas32Parameters: undefined,
      pathParams: [],
      queryParams: [],
      headerParams: [],
      cookieParams: [],
      parameterDiagnostics: undefined,
    },
    formValues: {
      ...form,
      pathParams: {},
      queryParams: customQuery,
      headerParams: removeHeaders(form.headerParams),
      cookieParams: Object.fromEntries(
        Object.entries(form.cookieParams).filter(
          ([name]) => !collection.parameters.some((parameter) => parameter.in === 'cookie' && parameter.name === name),
        ),
      ),
      oas31ParameterValues: undefined,
      serializedExampleParameters: undefined,
      oas32ParameterInputs: undefined,
    },
  });
  const headerMap: Record<string, string> = Object.assign(
    Object.create(null) as Record<string, string>,
    removeHeaders(remainder.headers),
  );
  for (const header of plan.headers) headerMap[header.name] = header.value;
  const cookieKey = Object.keys(headerMap).find((name) => name.toLowerCase() === 'cookie');
  if (plan.cookieText)
    headerMap[cookieKey ?? 'Cookie'] =
      cookieKey && headerMap[cookieKey] ? `${headerMap[cookieKey]}; ${plan.cookieText}` : plan.cookieText;
  for (const [name, value] of Object.entries(headerMap)) validateOas32Header(name, value);
  const consumedQuery = new Set([
    ...plan.query.map((pair) => pair.name),
    ...collection.parameters
      .filter((parameter) => parameter.in === 'query' && parameterOwn(input, parameter.key))
      .map((parameter) => parameter.name),
  ]);
  const query: Record<string, QueryParamValue> = Object.assign(
    Object.create(null) as Record<string, QueryParamValue>,
    Object.fromEntries(Object.entries(remainder.query).filter(([name]) => !consumedQuery.has(name))),
  );
  const extraQueryText = Object.entries(query)
    .flatMap(([name, value]) =>
      (Array.isArray(value) ? value : [value]).map((item) => `${encodeURIComponent(name)}=${encodeURIComponent(item)}`),
    )
    .join('&');
  const queryText = [
    extraQueryText,
    plan.query.map((pair) => `${pair.encodedName}${pair.hasEquals === false ? '' : '='}${pair.encodedValue}`).join('&'),
  ]
    .filter(Boolean)
    .join('&');
  const url = `${options.baseUrl}${resolvedPath}${plan.wholeQuery ? (plan.wholeQuery.present ? `?${plan.wholeQuery.component ?? ''}` : '') : queryText ? `?${queryText}` : ''}`;
  for (const pair of plan.query) {
    const previous = parameterOwn(query, pair.name) ? query[pair.name] : undefined;
    query[pair.name] =
      previous === undefined
        ? pair.value
        : Array.isArray(previous)
          ? [...previous, pair.value]
          : [previous, pair.value];
  }
  const diagnostics = [...plan.diagnostics];
  const finalCookie = Object.entries(headerMap).find(([name]) => name.toLowerCase() === 'cookie');
  if (finalCookie && !oas32CookiePairs(finalCookie[1], 'custom').valid)
    diagnostics.push({
      phase: 'transport',
      code: 'COOKIE_FIELD_SYNTAX',
      message: 'The final Cookie field is not valid RFC6265 syntax.',
      blocks: 'browser',
    });
  const request: BuiltRequest = {
    ...remainder,
    url,
    headers: headerMap,
    query,
    oas32ParameterPlan: { ...plan, diagnostics },
    curlPreserveUrl: true,
    hasExplicitCookieParameters: !!finalCookie,
    parameterPresence: Object.fromEntries(
      Object.entries(plan.presence).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
    ),
  };
  if (request.sourceMap) {
    for (const name of Array.from(consumedQuery)) delete request.sourceMap.query[name];
    for (const pair of plan.query) request.sourceMap.query[pair.name] = 'interface';
    for (const name of Object.keys(request.sourceMap.headers))
      if (declaredHeaderNames.has(name.toLowerCase())) delete request.sourceMap.headers[name];
    for (const header of plan.headers) request.sourceMap.headers[header.name] = 'interface';
  }
  return {
    ...request,
    oas32ParameterPlan: { ...plan, diagnostics: [...diagnostics, ...oas32BrowserRequestDiagnostics(request)] },
  };
}
