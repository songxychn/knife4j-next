import { OPENAPI_HTTP_METHODS, operationHttpMethod, type BodyContent, type OperationDebugModel } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import { isOas32ExampleDocument } from '../../schema/operationExampleCatalog';
import { isOas31SchemaDocument } from '../../schema/schemaDocumentSession';
import type { DebugCacheState, DebugCacheRawMode, DebugCacheCustomParamRow } from './debugCache';
import type { CookieParameterSource } from './cookieParameterSource';
import { buildInitialParamEnabled } from './oas31ParameterForm';
import {
  buildInitialParamValues,
  initialBodyValueForContent,
  initialFormFieldsForContent,
  initialFormPartHeadersForContent,
  mergeCachedFormFields,
  mergeCachedFormPartHeaders,
  type BodyContentDefaults,
  type ParamValueMap,
} from './debugDefaultValues';

export interface InitialDebugState {
  cookieParameterSource: CookieParameterSource;
  baseUrl: string;
  method: string;
  path: string;
  paramValues: ParamValueMap;
  paramEnabled: Record<string, boolean>;
  selectedContentType: string;
  body: string;
  formFields: Record<string, string>;
  formPartHeaders: Record<string, Record<string, string>>;
  formPartContentTypes: Record<string, string>;
  rawMode: DebugCacheRawMode;
  customQueryParams: DebugCacheCustomParamRow[];
  customBodyParams: DebugCacheCustomParamRow[];
  customHeaders: DebugCacheCustomParamRow[];
  customCookies: DebugCacheCustomParamRow[];
}

export function inferRawMode(bodyContent: BodyContent | undefined): DebugCacheRawMode {
  if (bodyContent?.category === 'json') return 'json';
  if (bodyContent?.category !== 'raw') return 'text';
  const mediaType = bodyContent.mediaType;
  if (mediaType.includes('json')) return 'json';
  if (mediaType.includes('xml')) return 'xml';
  if (mediaType.includes('html')) return 'html';
  if (mediaType.includes('javascript')) return 'javascript';
  return 'text';
}

export function buildInitialDebugState(
  debugModel: OperationDebugModel,
  operation: MenuOperation,
  swaggerDoc: SwaggerDoc,
  baseUrl: string,
  bodyDefaults: BodyContentDefaults,
): InitialDebugState {
  const paramValues = buildInitialParamValues(debugModel, swaggerDoc, operation);
  const paramEnabled = buildInitialParamEnabled(debugModel, paramValues);

  const firstBody = debugModel.bodyContents[0];
  return {
    cookieParameterSource:
      isOas31SchemaDocument(swaggerDoc) || isOas32ExampleDocument(swaggerDoc) ? 'browser-session' : 'explicit',
    baseUrl,
    method: operationHttpMethod(operation),
    path: operation.path,
    paramValues,
    paramEnabled,
    selectedContentType: firstBody?.mediaType ?? '',
    body: initialBodyValueForContent(firstBody, bodyDefaults),
    formFields: initialFormFieldsForContent(firstBody, bodyDefaults),
    formPartHeaders: initialFormPartHeadersForContent(firstBody),
    formPartContentTypes: {},
    rawMode: inferRawMode(firstBody),
    customQueryParams: [],
    customBodyParams: [],
    customHeaders: [],
    customCookies: [],
  };
}

export const DEBUG_HTTP_METHODS = new Set(OPENAPI_HTTP_METHODS.map((method) => method.toUpperCase()));

function mergeCachedStringRecord(
  initial: Record<string, string>,
  cached: Record<string, string>,
): Record<string, string> {
  const next = { ...initial };
  for (const key of Object.keys(next)) {
    if (cached[key] !== undefined) {
      next[key] = cached[key];
    }
  }
  return next;
}

function mergeCachedBooleanRecord(
  initial: Record<string, boolean>,
  cached: Record<string, boolean>,
): Record<string, boolean> {
  const next = { ...initial };
  for (const key of Object.keys(next)) {
    if (cached[key] !== undefined) {
      next[key] = cached[key];
    }
  }
  return next;
}

export function restoreInitialDebugStateFromCache(
  initial: InitialDebugState,
  cached: DebugCacheState | null,
  debugModel: OperationDebugModel,
  bodyDefaults: BodyContentDefaults,
  preserveMethodCase = false,
): InitialDebugState {
  if (!cached) return initial;

  const cachedMethod = preserveMethodCase ? cached.method : cached.method.toUpperCase();
  const cachedBody = debugModel.bodyContents.find(
    (bodyContent) => bodyContent.mediaType === cached.selectedContentType,
  );
  const selectedBody = cachedBody ?? debugModel.bodyContents[0];
  const restoreCachedBody = Boolean(cachedBody);

  return {
    ...initial,
    cookieParameterSource: cached.cookieParameterSource ?? 'explicit',
    baseUrl: cached.baseUrl || initial.baseUrl,
    method: cachedMethod === initial.method || DEBUG_HTTP_METHODS.has(cachedMethod) ? cachedMethod : initial.method,
    path: cached.path || initial.path,
    paramValues: mergeCachedStringRecord(initial.paramValues, cached.paramValues),
    paramEnabled: mergeCachedBooleanRecord(initial.paramEnabled, cached.paramEnabled),
    selectedContentType: selectedBody?.mediaType ?? '',
    body: restoreCachedBody ? cached.body : initialBodyValueForContent(selectedBody, bodyDefaults),
    formFields: restoreCachedBody
      ? mergeCachedFormFields(selectedBody, cached.formFields, bodyDefaults)
      : initialFormFieldsForContent(selectedBody, bodyDefaults),
    formPartHeaders: restoreCachedBody
      ? mergeCachedFormPartHeaders(selectedBody, cached.formPartHeaders)
      : initialFormPartHeadersForContent(selectedBody),
    formPartContentTypes: restoreCachedBody ? { ...(cached.formPartContentTypes ?? {}) } : {},
    rawMode: restoreCachedBody ? cached.rawMode : inferRawMode(selectedBody),
    customQueryParams: cached.customQueryParams,
    customBodyParams: restoreCachedBody ? cached.customBodyParams : [],
    customHeaders: cached.customHeaders,
    customCookies: cached.customCookies,
  };
}
