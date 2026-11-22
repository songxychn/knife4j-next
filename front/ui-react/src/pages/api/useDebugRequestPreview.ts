import {
  buildRequest,
  type BuildRequestOptions,
  type DebugFormValues,
  type DebugParam,
  type OperationDebugModel,
  type QueryParamValue,
} from 'knife4j-core';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { applyRouteProxyHeader } from '../../api/routeProxyHeader';
import { debugAuthFromOas32Plan } from '../../auth/oas32SecurityUi';
import { collectResolvedOas32ParameterInputs, serializedExampleParametersFromEntries } from './oas32ParameterForm';
import { RAW_CONTENT_TYPES } from './apiDebugShared';
import { type CookieParameterSource } from './cookieParameterSource';
import { customRowsToRecord, mergeCustomBodyParams, reservedBodyFieldNames } from './customParamRows';
import { paramKey } from './debugDefaultValues';
import { inferRawMode } from './debugFormState';
import { applyMaterializedMultipartContentType } from './debugHttpRequest';
import { queryParamRequestValue } from './enumParamValue';
import { multipartPlanNeedsEncodedEnvelope, reuseMaterializedMultipartBody } from './formBodyRequest';
import { collectOas31ParameterValues } from './oas31ParameterForm';
import { buildPreviewCurl, buildRequestPreviewSafely, type RequestPreviewBuildResult } from './requestPreviewBuild';
import type { DebugFormState } from './useDebugFormState';

type BodyFiles = Record<string, File[]>;

interface DebugRequestPreviewOptions extends Pick<
  BuildRequestOptions,
  'applicationParams' | 'auth' | 'globalParams' | 'securityKeys'
> {
  enabled: boolean;
  baseUrl: string;
  form: DebugFormState;
  debugModel: OperationDebugModel | null;
  preserveMethodCase: boolean;
  isOas32: boolean;
  enableDynamicParameter: boolean;
  serverUnavailable: boolean;
  serverUnavailableMessage: string;
  unrepresentableMultipartMessage: string;
  securityPlan?: Parameters<typeof debugAuthFromOas32Plan>[0];
  effectiveCookieSource: CookieParameterSource;
  credentials: 'same-origin' | 'include';
  sessionCurlNote: string;
  fileFields: BodyFiles;
  binaryBodyFile: File | null;
  editRevision: number;
  exampleSession32: Parameters<typeof collectResolvedOas32ParameterInputs>[6];
  proxyHeader?: string;
  proxyOrigin: string;
  proxyContextPath?: string;
}

export function effectiveDebugContentType(
  debugModel: OperationDebugModel | null,
  form: DebugFormState,
  isOas32: boolean,
): string {
  const { selectedContentType, serializedBodyMedia32, rawMode } = form;
  if (isOas32 && serializedBodyMedia32 === selectedContentType) return selectedContentType;
  const currentBody = debugModel?.bodyContents.find((b) => b.mediaType === selectedContentType);
  const category = currentBody?.category ?? 'raw';
  if (category === 'json') {
    return rawMode === 'json' ? selectedContentType || RAW_CONTENT_TYPES.json : RAW_CONTENT_TYPES[rawMode];
  }
  if (category === 'raw') {
    if (currentBody?.binary) return selectedContentType || currentBody.mediaType;
    const inferredMode = inferRawMode(currentBody);
    if (rawMode === inferredMode && selectedContentType) return selectedContentType;
    return RAW_CONTENT_TYPES[rawMode];
  }
  if (selectedContentType) return selectedContentType;
  return debugModel?.bodyContents[0]?.mediaType ?? '';
}

type DebugRequestFormOptions = Pick<
  DebugRequestPreviewOptions,
  | 'form'
  | 'isOas32'
  | 'effectiveCookieSource'
  | 'enableDynamicParameter'
  | 'fileFields'
  | 'binaryBodyFile'
  | 'editRevision'
  | 'exampleSession32'
> & { debugModel: OperationDebugModel };

function collectRequestFormValues({
  debugModel,
  form,
  isOas32,
  effectiveCookieSource,
  enableDynamicParameter,
  fileFields,
  binaryBodyFile,
  editRevision,
  exampleSession32,
}: DebugRequestFormOptions): DebugFormValues {
  const {
    paramEnabled,
    paramValues,
    selectedContentType,
    body,
    customQueryParams,
    customBodyParams,
    customHeaders,
    customCookies,
    formFields,
    formPartHeaders,
    formPartContentTypes,
    oas32ParameterEntries,
    serializedBodyMedia32,
  } = form;
  const contentType = effectiveDebugContentType(debugModel, form, isOas32);

  /** 按 in 过滤已填值，跳过 enabled=false 的参数 */
  const collectForIn = (params: DebugParam[]): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const p of params) {
      if (p.parameterSerialization) continue;
      if (paramEnabled[paramKey(p)] === false) continue;
      const v = paramValues[paramKey(p)];
      if (v !== undefined && v !== '') result[p.name] = v;
    }
    return result;
  };

  const collectQueryParams = (): Record<string, QueryParamValue> => {
    const result: Record<string, QueryParamValue> = {};
    for (const param of debugModel.queryParams) {
      if (param.parameterSerialization) continue;
      if (paramEnabled[paramKey(param)] === false) continue;
      const value = paramValues[paramKey(param)];
      if (value !== undefined && value !== '') result[param.name] = queryParamRequestValue(param, value);
    }
    return result;
  };

  /** 获取当前选中的 body content 分类 */
  const currentBody = debugModel.bodyContents.find((b) => b.mediaType === selectedContentType);
  const category = currentBody?.category ?? 'raw';
  const specQueryParams = collectQueryParams();
  const specHeaders = collectForIn(debugModel.headerParams);
  const specCookieParams = collectForIn(debugModel.cookieParams);
  const extraQueryParams = customRowsToRecord(customQueryParams);
  const extraHeaders = customRowsToRecord(customHeaders);
  const extraCookieParams = customRowsToRecord(customCookies);
  const structuredForm =
    category === 'urlencoded' || category === 'multipart'
      ? mergeCustomBodyParams(formFields, customBodyParams, enableDynamicParameter, reservedBodyFieldNames(currentBody))
      : undefined;
  const formFieldNamesToIncludeWhenEmpty = structuredForm?.formFieldNamesToIncludeWhenEmpty ?? [];
  const oas31ParameterValues = collectOas31ParameterValues(
    debugModel,
    paramValues,
    paramEnabled,
    effectiveCookieSource,
  );
  const fileSnapshot =
    category === 'multipart'
      ? Object.fromEntries(Object.entries(fileFields).map(([name, files]) => [name, [...files]]))
      : undefined;
  const partHeaderSnapshot = Object.fromEntries(
    Object.entries(formPartHeaders).map(([fieldName, headers]) => [fieldName, { ...headers }]),
  );
  const partContentTypeSnapshot = { ...formPartContentTypes };

  return {
    pathParams: collectForIn(debugModel.pathParams),
    queryParams: { ...extraQueryParams, ...specQueryParams },
    headerParams: { ...extraHeaders, ...specHeaders },
    cookieParams: effectiveCookieSource === 'browser-session' ? {} : { ...extraCookieParams, ...specCookieParams },
    ...(Object.keys(oas31ParameterValues).length > 0 ? { oas31ParameterValues } : {}),
    ...(isOas32 && debugModel.oas32Parameters
      ? {
          oas32ParameterInputs: collectResolvedOas32ParameterInputs(
            debugModel.oas32Parameters,
            oas32ParameterEntries,
            paramValues,
            paramEnabled,
            effectiveCookieSource,
            editRevision,
            exampleSession32,
          ),
          ...(serializedBodyMedia32 === selectedContentType
            ? { serializedExampleBody: { mediaType: contentType, text: body } }
            : {}),
        }
      : isOas32
        ? {
            serializedExampleParameters: Object.fromEntries(
              Object.entries(serializedExampleParametersFromEntries(oas32ParameterEntries)).filter(
                ([key]) => paramEnabled[key] !== false,
              ),
            ),
            ...(serializedBodyMedia32 === selectedContentType
              ? { serializedExampleBody: { mediaType: contentType, text: body } }
              : {}),
          }
        : {}),
    selectedContentType: contentType,
    body: category === 'json' || category === 'raw' ? body : undefined,
    binaryBodyFileName: currentBody?.binary ? binaryBodyFile?.name : undefined,
    formFields: structuredForm?.formFields,
    ...(formFieldNamesToIncludeWhenEmpty.length > 0 ? { formFieldNamesToIncludeWhenEmpty } : {}),
    fileFields: fileSnapshot,
    jsonFields: category === 'multipart' ? (currentBody?.jsonFields ?? []) : undefined,
    formPartHeaders: category === 'multipart' ? partHeaderSnapshot : undefined,
    formPartContentTypes: category === 'multipart' ? partContentTypeSnapshot : undefined,
  };
}

export function useDebugRequestPreview({
  enabled,
  baseUrl,
  form,
  debugModel,
  preserveMethodCase,
  isOas32,
  enableDynamicParameter,
  serverUnavailable,
  serverUnavailableMessage,
  unrepresentableMultipartMessage,
  auth,
  securityKeys,
  securityPlan,
  applicationParams,
  globalParams,
  effectiveCookieSource,
  credentials,
  sessionCurlNote,
  fileFields,
  binaryBodyFile,
  editRevision,
  exampleSession32,
  proxyHeader,
  proxyOrigin,
  proxyContextPath,
}: DebugRequestPreviewOptions): RequestPreviewBuildResult | null {
  const source = useMemo(() => {
    if (!enabled || !debugModel) return null;
    return buildRequestPreviewSafely(() => {
      if (isOas32 && serverUnavailable) throw new Error(serverUnavailableMessage);
      const formValues = collectRequestFormValues({
        debugModel,
        form,
        isOas32,
        effectiveCookieSource,
        enableDynamicParameter,
        fileFields,
        binaryBodyFile,
        editRevision,
        exampleSession32,
      });
      const auth32 = isOas32 ? debugAuthFromOas32Plan(securityPlan) : null;
      const built = applyRouteProxyHeader(
        buildRequest({
          baseUrl,
          path: form.path,
          method: form.method,
          preserveMethodCase,
          debugModel,
          formValues,
          auth: auth32 ? auth32.auth : auth,
          applicationParams,
          globalParams,
          securityKeys: auth32 ? auth32.securityKeys : securityKeys,
        }),
        proxyHeader,
        { origin: proxyOrigin, contextPath: proxyContextPath },
      );
      const selectedBody = debugModel.bodyContents.find((body) => body.mediaType === form.selectedContentType);
      if (isOas32 && selectedBody?.category === 'multipart' && built.formBodyPlan?.kind !== 'multipart') {
        throw new Error(unrepresentableMultipartMessage);
      }
      return {
        formValues,
        built,
        curl: buildPreviewCurl(built, effectiveCookieSource, sessionCurlNote),
        cookieParameterSource: effectiveCookieSource,
        credentials,
        binaryFile: selectedBody?.binary ? binaryBodyFile : null,
      };
    });
  }, [
    enabled,
    baseUrl,
    form,
    debugModel,
    preserveMethodCase,
    isOas32,
    enableDynamicParameter,
    serverUnavailable,
    serverUnavailableMessage,
    unrepresentableMultipartMessage,
    auth,
    securityKeys,
    securityPlan,
    applicationParams,
    globalParams,
    effectiveCookieSource,
    credentials,
    sessionCurlNote,
    fileFields,
    binaryBodyFile,
    editRevision,
    exampleSession32,
    proxyHeader,
    proxyOrigin,
    proxyContextPath,
  ]);

  const cacheRef = useRef<{
    files: BodyFiles;
    entry: ReturnType<typeof reuseMaterializedMultipartBody>;
  } | null>(null);
  const [committed, setCommitted] = useState<{
    source: RequestPreviewBuildResult;
    result: RequestPreviewBuildResult;
  } | null>(null);
  const multipartPlan =
    source?.ok && source.value.built.formBodyPlan?.kind === 'multipart' ? source.value.built.formBodyPlan : null;
  const needsMaterialization = multipartPlan !== null && (isOas32 || multipartPlanNeedsEncodedEnvelope(multipartPlan));

  // The generated MIME boundary and Blob belong to the committed preview. A
  // layout effect publishes them before the preview or send action can be used.
  useLayoutEffect(() => {
    if (!needsMaterialization || !source?.ok || !multipartPlan) return;
    const result = buildRequestPreviewSafely(() => {
      const files = (source.value.formValues.fileFields ?? {}) as BodyFiles;
      const cached = cacheRef.current?.files === fileFields ? cacheRef.current.entry : null;
      const entry = reuseMaterializedMultipartBody(cached, multipartPlan, files);
      cacheRef.current = { files: fileFields, entry };
      const { contentType } = entry.value;
      const built = { ...source.value.built, headers: { ...source.value.built.headers } };
      if (contentType) {
        applyMaterializedMultipartContentType(built.headers, contentType);
        built.contentType = contentType;
      }
      return {
        ...source.value,
        built,
        curl: buildPreviewCurl(built, effectiveCookieSource, sessionCurlNote),
        materializedMultipart: entry.value,
      };
    });
    setCommitted({ source, result });
  }, [source, multipartPlan, needsMaterialization, fileFields, effectiveCookieSource, sessionCurlNote]);

  return needsMaterialization ? (committed?.source === source ? committed.result : null) : source;
}
