import { executeDebugRequest } from './executeDebugRequest';
import {
  DEBUG_HTTP_METHODS,
  buildInitialDebugState,
  inferRawMode,
  restoreInitialDebugStateFromCache,
  type InitialDebugState,
} from './debugFormState';
import { useDebugFormState, type DebugFormState } from './useDebugFormState';
import { parseOas32UrlTemplate } from 'knife4j-core';
import { oas32MetadataDiagnostics } from '../../schema/oas32MetadataDiagnostics';
import Oas32ServerDetails from '../../components/Oas32ServerDetails';
import { useOas32ServerSelection } from './useOas32ServerSelection';
import { operationHttpMethod } from 'knife4j-core';
import OperationExamplePicker from '../../components/schema/OperationExamplePicker';
import {
  exampleDebugModel,
  isOas32ExampleDocument,
  locateOperationExampleCatalog,
  type OperationExampleResult,
} from '../../schema/operationExampleCatalog';
import {
  evaluateOas32ParameterPlan,
  oas32ExampleParameterEntry,
  oas32ParameterContext,
  type Oas32ParameterEntry,
  type Oas32ParameterSchemaIssue,
} from '../../schema/oas32ParameterAdapter';
import {
  editableOas32ParameterEntries,
  oas32DiagnosticMessages,
  oas32QuerystringMediaType,
  oas32QuerystringParameter,
  previewOas32DisplayPath,
  restoreOas32ParameterEntries,
  serializedExampleParametersFromEntries,
} from './oas32ParameterForm';
import { useOperationExampleDefaults } from '../../schema/useOperationExampleDefaults';
import { operationSchemaDocuments } from '../../schema/operationRegistry';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Checkbox,
  Collapse,
  Divider,
  Input,
  message,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { DownOutlined, ReloadOutlined, SendOutlined, UpOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type {
  BuiltRequest,
  DebugParam,
  FormBodyDiagnostic,
  OperationDebugModel,
  ParameterInputDiagnostic,
  ParamSource,
  SchemeValue,
  ValidationError,
} from 'knife4j-core';
import {
  buildOperationDebugModel,
  replacePathParams,
  replaceSerializedPathParams,
  serializeOas31Parameters,
  validateRequired,
  oas32FormFieldsFromInstance,
} from 'knife4j-core';
import { OperationModeLayout, useCurrentOperation } from './useCurrentOperation';
import Tabs from '../../components/AccessibleTabs';
import CodeEditor from '../../components/CodeEditor';
import ResizableBox from '../../components/ResizableBox';
import SchemaExampleNotice from '../../components/schema/SchemaExampleNotice';
import { useAuth } from '../../context/AuthContext';
import { useGroup } from '../../context/GroupContext';
import { useGlobalParam, type ScopedGlobalParamItem } from '../../context/GlobalParamContext';
import { globalParamIdentity } from '../../context/globalParamState';
import { projectAndPlanOas32Security } from '../../auth/oas32SecurityUi';
import { useSchemaEngine, useExternalResources } from '../../context/SchemaEngineContext';
import { useSettings } from '../../context/SettingsContext';
import type { DebugResponsePayload, SseEvent } from './ResponsePanel';
import { DebugResponseSection } from './DebugResponseSection';
import { DebugResponseExtractionPanel } from './DebugResponseExtractionPanel';
import {
  evaluateResponseExtraction,
  isCrossOriginUrl,
  summarizeResponseExtractionLog,
  type ResponseExtractionInput,
  type ResponseExtractionRule,
  type ResponseExtractionRunLog,
} from './responseExtraction';
import { readResponseExtractionRules, writeResponseExtractionRules } from './responseExtractionStorage';
import { COMMON_HEADER_NAMES } from '../../constants/httpHeaders';
import {
  currentOrigin,
  resolveRequestBaseUrl,
  resolveRequestServerOptions,
  type RequestServerSource,
} from './requestBaseUrl';
import { DEBUG_CACHE_VERSION, readDebugCache, removeDebugCache, writeDebugCache } from './debugCache';
import {
  DEBUG_HISTORY_MASK,
  appendPending,
  buildMultipartHistoryBody,
  buildOas31MultipartHistoryBody,
  clearHistory,
  createPendingEntry,
  isSensitiveHeaderName,
  listHistory,
  removeEntry,
  updateEntry,
  type DebugHistoryEntry,
  type DebugHistoryFormSnapshot,
} from './debugHistory';
import DebugHistoryPanel from './DebugHistoryPanel';
import { displayQueryParamValue } from './enumParamValue';
import { readDebugSessionState, removeDebugSessionState, writeDebugSessionState } from './debugSessionState';
import { resolveSendPreview, triggerMultipartBodyDownload, type RequestPreviewBuild } from './requestPreviewBuild';
import { copyToClipboard } from '../../utils/clipboard';
import {
  EMPTY_BODY_CONTENT_DEFAULTS,
  buildBodyContentDefaults,
  mergeCachedFormPartHeaders,
  paramKey,
} from './debugDefaultValues';
import {
  collectOas31ParameterValues,
  filterRequiredErrorsForCookieSource,
  isOas31RequiredParameterError,
} from './oas31ParameterForm';
import { effectiveCookieParameterSource, type CookieParameterSource } from './cookieParameterSource';
import type { ResponseBodyProgress } from './responseBodyProgress';
import { browserRequestConstraint } from './browserRequestConstraints';
import {
  discardUnsentDebugResponse,
  inspectUnsentBrowserSendFailure,
  unsentBrowserSendFailureTab,
} from './apiDebugBrowserSend';
import {
  consumeRequestBodySchemaOverride,
  effectiveRequestContentType,
  evaluateRequestBodySchema,
  prepareRequestBodySchemaEvaluation,
  requestBodyInstanceLabel,
} from '../../schema/requestBodySchemaValidation';
import {
  evaluateParameterSchemas,
  parameterInstanceLabel,
  prepareParameterSchemaEvaluation,
  type ParameterSchemaIssue,
} from '../../schema/parameterSchemaValidation';
import {
  evaluateResponseBodySchema,
  isResponseBodySchemaEvaluationAborted,
  prepareResponseBodySchemaEvaluation,
  responseBodySchemaFailureDiagnostic,
  responseBodySchemaResultIsCurrent,
  type ResponseBodySchemaDiagnostic,
} from '../../schema/responseBodySchemaValidation';
import type { Oas32SequentialStreamView } from '../../schema/oas32SequentialView';
import { isOas31SchemaDocument } from '../../schema/schemaDocumentSession';
import {
  emptyOas31BodyContentDefaults,
  sameOas31DebugExampleIdentity,
  unavailableOas31DebugBodyExamples,
  type Oas31DebugExampleIdentity,
  type Oas31DebugExampleState,
} from './oas31DebugExamples';
import { useOas31DebugDefaultHydrator, useOas31DebugExampleLoader } from './useOas31DebugExamples';
import { CustomParamsSection, InjectedGlobalParamsSection, type InjectedGlobalParamRow } from './DebugParamInputs';
import { BodyTab } from './DebugBodyEditor';
import {
  DEBUG_PANEL_DEFAULT_MAX_HEIGHT,
  DEBUG_PANEL_MAX_HEIGHT,
  DEBUG_PANEL_MIN_HEIGHT,
  readDebugPanelLayout,
  writeDebugPanelLayout,
  type DebugPanelLayout,
} from './debugPanelLayout';
import { PreviewTabPanel } from './DebugRequestPreview';
import { DebugParameterTable } from './DebugParameterTable';
import { globalParamValuesForScope, METHOD_COLORS } from './apiDebugShared';

import { effectiveDebugContentType, useDebugRequestPreview } from './useDebugRequestPreview';

const { Paragraph, Text, Title } = Typography;

type ParameterInputRequestSchemaDiagnosticIssue =
  | (Omit<ParameterInputDiagnostic, 'kind'> & {
      readonly kind: 'invalid-json';
      readonly target: 'parameter';
    })
  | (Omit<ParameterInputDiagnostic, 'kind'> & {
      readonly kind: 'unsafe-number';
      readonly target: 'parameter';
    });

type FormBodyRequestSchemaDiagnosticIssue = FormBodyDiagnostic & {
  readonly kind: 'form-body';
  readonly target: 'body';
};

type RequestSchemaDiagnosticIssue =
  | { readonly kind: 'invalid-json'; readonly target: 'body' }
  | (ValidationError & { readonly kind: 'required-parameter'; readonly target: 'parameter' })
  | FormBodyRequestSchemaDiagnosticIssue
  | ParameterInputRequestSchemaDiagnosticIssue
  | {
      readonly kind: 'invalid-schema';
      readonly target: 'body';
      readonly instanceLocation: string;
      readonly keyword: string;
      readonly absoluteKeywordLocation: string;
    }
  | ({ readonly kind: 'invalid-schema'; readonly target: 'parameter' } & ParameterSchemaIssue)
  | ({ readonly kind: 'invalid-schema'; readonly target: 'parameter' } & Oas32ParameterSchemaIssue);

type PendingSchemaOverride = {
  readonly preview: RequestPreviewBuild;
  readonly debugCacheKey: string | null;
  readonly revision: number;
  readonly issues: readonly RequestSchemaDiagnosticIssue[];
  readonly totalIssues: number;
};

interface HandleSendOptions {
  readonly prepared?: RequestPreviewBuild;
  readonly skipSchemaValidation?: boolean;
  readonly validationRevision?: number;
  readonly validationDebugCacheKey?: string | null;
}

function requestServerSourceLabel(source: RequestServerSource, t: ReturnType<typeof useTranslation>['t']): string {
  if (source === 'gateway') return t('apiDebug.baseUrl.source.gateway');
  if (source === 'operation') return t('apiDebug.baseUrl.source.operation');
  if (source === 'path') return t('apiDebug.baseUrl.source.path');
  return t('apiDebug.baseUrl.source.document');
}

// ─── 主组件 ────────────────────────────────────────────

export default function ApiDebug() {
  const { t } = useTranslation();
  const { group, tag, operaterId } = useParams();
  const { loading: docLoading, swaggerDoc, operation } = useCurrentOperation();
  const { activeSwaggerGroup, operationRetrievalUri, routeGroupReady } = useGroup();
  const { settings } = useSettings();
  const { effectiveParams, cookieSession, upsertParams } = useGlobalParam();
  const schemaEngine = useSchemaEngine();
  const resources = useExternalResources();
  const groupContextPath = activeSwaggerGroup?.contextPath;
  const isOas32 = isOas32ExampleDocument(swaggerDoc);
  const server32 = useOas32ServerSelection({
    document: isOas32 ? swaggerDoc : null,
    operation,
    retrievalUri: operationRetrievalUri,
    session: schemaEngine.session,
    enableHost: settings.enableHost,
    host: settings.enableHostText,
    contextPath: groupContextPath,
  });
  const operationMethod = operation?.method;
  const operationPath = operation?.path;
  const debugCacheKey = useMemo(() => {
    if (!group || !tag || !operaterId || !operationMethod || !operationPath) return null;
    return operation?.identity
      ? JSON.stringify([group, operation.identity.identity])
      : [group, tag, operaterId, operationMethod, operationPath].join('|');
  }, [group, operaterId, operationMethod, operationPath, tag, operation]);
  const defaultBaseUrl = useMemo(
    () =>
      resolveRequestBaseUrl({
        swaggerDoc,
        operation,
        enableHost: settings.enableHost,
        enableHostText: settings.enableHostText,
        groupContextPath,
        origin: currentOrigin(),
      }),
    [groupContextPath, operation, settings.enableHost, settings.enableHostText, swaggerDoc],
  );
  const requestServerSelectOptions = useMemo(
    () =>
      resolveRequestServerOptions({
        swaggerDoc,
        operation,
        groupContextPath,
        origin: currentOrigin(),
      }).map((server) => {
        const source = requestServerSourceLabel(server.source, t);
        const description = server.description?.trim();
        return {
          value: server.url,
          label: description ? `${server.url} - ${description} (${source})` : `${server.url} (${source})`,
        };
      }),
    [groupContextPath, operation, swaggerDoc, t],
  );
  const { form, actions: formActions } = useDebugFormState(defaultBaseUrl);
  const {
    baseUrl: legacyBaseUrl,
    method,
    path,
    paramValues,
    paramEnabled,
    body,
    customQueryParams,
    customBodyParams,
    customHeaders,
    customCookies,
    cookieParameterSource,
    oas32ParameterEntries,
    serializedBodyMedia32,
    selectedContentType,
    formFields,
    formPartHeaders,
    formPartContentTypes,
    rawMode,
  } = form;
  const {
    setBaseUrl,
    setMethod,
    setPath,
    setParamValues,
    setParamEnabled,
    setBody,
    setCustomQueryParams,
    setCustomBodyParams,
    setCustomHeaders,
    setCustomCookies,
    setCookieParameterSource,
    setOas32ParameterEntries,
    setSerializedBodyMedia32,
    setSelectedContentType,
    setFormFields,
    setFormPartHeaders,
    setFormPartContentTypes,
    setRawMode,
    replaceForm,
  } = formActions;
  const baseUrl = isOas32 ? server32.baseUrl : legacyBaseUrl;
  const pathDiagnostics32 = useMemo(
    () =>
      isOas32 && operation
        ? [
            ...oas32MetadataDiagnostics(swaggerDoc, [{ tag: '', operations: [operation] }]),
            ...(operation.source === 'path'
              ? parseOas32UrlTemplate(path, 'path', {
                  ownerRetrievalUri: operation.identity?.ownerRetrievalUri ?? '',
                  pointer: operation.identity?.mountPointer ?? '',
                }).diagnostics.map((diagnostic) => ({
                  code: diagnostic.code,
                  path: diagnostic.pointer,
                  reason: diagnostic.reason,
                }))
              : []),
          ]
        : [],
    [isOas32, swaggerDoc, operation, path],
  );
  const serverOrPathUnavailable32 = !server32.executable || pathDiagnostics32.length > 0;
  // enabled state: keyed by paramKey; empty optional OAS 3.1 params start omitted.
  const exampleCatalog32 = useMemo(
    () => (isOas32 && swaggerDoc && operation ? locateOperationExampleCatalog(swaggerDoc, operation) : null),
    [isOas32, swaggerDoc, operation],
  );
  const exampleSession32 = isOas32 && schemaEngine.status === 'ready' ? schemaEngine.session : undefined;
  const defaults32 = useOperationExampleDefaults(exampleCatalog32, exampleSession32);
  const serializedParams32 = useMemo(
    () => serializedExampleParametersFromEntries(oas32ParameterEntries),
    [oas32ParameterEntries],
  );
  const appliedDefaults32 = useRef<ReadonlyMap<string, OperationExampleResult> | null>(null);
  const debugModel = useMemo<OperationDebugModel | null>(() => {
    if (!operation || !swaggerDoc) return null;
    const model = buildOperationDebugModel({
      doc: swaggerDoc as unknown as Record<string, unknown>,
      operationDocuments: operation.identity ? operationSchemaDocuments(swaggerDoc, operation) : undefined,
      operationIdentity: operation.identity,
      parameterContext: isOas32 ? oas32ParameterContext(operation) : undefined,
      path: operation.path,
      method: operation.method,
      isOAS2: Boolean((swaggerDoc as unknown as Record<string, unknown>).swagger),
    });
    return exampleCatalog32 ? exampleDebugModel(model, exampleCatalog32) : model;
  }, [exampleCatalog32, isOas32, operation, swaggerDoc]);
  const isOas31 = isOas31SchemaDocument(swaggerDoc);
  const cookieSessionEnabled = isOas31 || isOas32;
  const effectiveCookieSource = effectiveCookieParameterSource(cookieSessionEnabled, cookieParameterSource);
  const synchronousBodyDefaults = useMemo(
    () =>
      !isOas31 && !isOas32 && swaggerDoc && operation && debugModel
        ? buildBodyContentDefaults(swaggerDoc, operation, debugModel)
        : EMPTY_BODY_CONTENT_DEFAULTS,
    [debugModel, isOas31, isOas32, operation, swaggerDoc],
  );
  const emptyOas31Defaults = useMemo(() => emptyOas31BodyContentDefaults(debugModel), [debugModel]);
  const initialBodyDefaults = isOas31 || isOas32 ? emptyOas31Defaults : synchronousBodyDefaults;
  const oas31ExampleIdentity = useMemo<Oas31DebugExampleIdentity | null>(
    () =>
      isOas31 && schemaEngine.status === 'ready' && operation && swaggerDoc
        ? {
            document: swaggerDoc,
            session: schemaEngine.session,
            retrievalUri: schemaEngine.retrievalUri,
            operationKey: operation.routeId ?? operation.key,
          }
        : null,
    [isOas31, operation, schemaEngine, swaggerDoc],
  );
  const [oas31ExampleState, setOas31ExampleState] = useState<Oas31DebugExampleState>({ status: 'idle' });
  const activeOas31Examples = useMemo(() => {
    if (
      oas31ExampleState.status === 'ready' &&
      sameOas31DebugExampleIdentity(oas31ExampleState.identity, oas31ExampleIdentity)
    ) {
      return oas31ExampleState.examples;
    }
    const generationError =
      oas31ExampleState.status === 'error' &&
      sameOas31DebugExampleIdentity(oas31ExampleState.identity, oas31ExampleIdentity)
        ? oas31ExampleState.message
        : undefined;
    const unavailableMessage =
      generationError ?? (schemaEngine.status === 'error' ? schemaEngine.error.message : undefined);
    if (isOas31 && unavailableMessage !== undefined && swaggerDoc && operation && debugModel) {
      return unavailableOas31DebugBodyExamples(swaggerDoc, operation, debugModel, unavailableMessage);
    }
    return null;
  }, [debugModel, isOas31, oas31ExampleIdentity, oas31ExampleState, operation, schemaEngine, swaggerDoc]);
  const bodyDefaults = useMemo(
    () =>
      defaults32
        ? {
            bodyByMediaType: Object.fromEntries(
              [...defaults32.values()]
                .filter((value) => value.target.group.startsWith('body:'))
                .map((value) => [value.target.mediaType!, value.representation.text ?? '']),
            ),
            formFieldsByMediaType: emptyOas31Defaults.formFieldsByMediaType,
          }
        : (activeOas31Examples?.defaults ?? initialBodyDefaults),
    [defaults32, emptyOas31Defaults, activeOas31Examples, initialBodyDefaults],
  );
  const [loading, setLoading] = useState(false);
  const [responseProgress, setResponseProgress] = useState<ResponseBodyProgress | null>(null);
  const [response, setResponse] = useState<DebugResponsePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [builtRequest, setBuiltRequest] = useState<BuiltRequest | null>(null);
  const [builtRequestCookieSource, setBuiltRequestCookieSource] = useState<CookieParameterSource>('explicit');
  const [sseEvents, setSseEvents] = useState<SseEvent[] | null>(null);
  const [sseStreaming, setSseStreaming] = useState(false);
  const [sequentialStream, setSequentialStream] = useState<Oas32SequentialStreamView | null>(null);
  const [extractionRules, setExtractionRules] = useState<ResponseExtractionRule[]>([]);
  const extractionRulesRef = useRef<ResponseExtractionRule[]>([]);
  const [extractionPersistenceFailed, setExtractionPersistenceFailed] = useState(false);
  const [extractionLog, setExtractionLog] = useState<ResponseExtractionRunLog | null>(null);
  const sseAbortRef = useRef<AbortController | null>(null);
  const activeDebugCacheKeyRef = useRef<string | null>(null);
  const currentSchemaEngineRef = useRef(schemaEngine);
  const requestSeqRef = useRef(0);
  const schemaValidationRevisionRef = useRef(0);
  const schemaValidationAbortRef = useRef<AbortController | null>(null);
  const [schemaValidating, setSchemaValidating] = useState(false);
  const [pendingSchemaOverride, setPendingSchemaOverride] = useState<PendingSchemaOverride | null>(null);
  const responseSchemaValidationAbortRef = useRef<AbortController | null>(null);
  const [responseSchemaDiagnostic, setResponseSchemaDiagnostic] = useState<ResponseBodySchemaDiagnostic | null>(null);
  /** Pending history entry id for the in-flight request (strategy C). */
  const pendingHistoryIdRef = useRef<string | null>(null);
  const pendingHistoryCacheKeyRef = useRef<string | null>(null);

  // ── requestBody 多内容类型状态 ──
  const [fileFields, setFileFields] = useState<Record<string, File[]>>({});
  const [binaryBodyFile, setBinaryBodyFile] = useState<File | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [hydratedDebugCacheKey, setHydratedDebugCacheKey] = useState<string | null>(null);
  const skipNextDebugCacheWriteRef = useRef(false);
  const [historyEntries, setHistoryEntries] = useState<DebugHistoryEntry[]>([]);
  const debugDefaultEditRevisionRef = useRef(0);
  const [debugDefaultEditRevision, setRenderedDebugDefaultEditRevision] = useState(0);
  const setDebugDefaultEditRevision = useCallback((next: number) => {
    debugDefaultEditRevisionRef.current = next;
    setRenderedDebugDefaultEditRevision(next);
  }, []);
  const markDebugDefaultEdited = useCallback(() => {
    setDebugDefaultEditRevision(debugDefaultEditRevisionRef.current + 1);
  }, [setDebugDefaultEditRevision]);
  const appliedOas31ExampleIdentityRef = useRef<Oas31DebugExampleIdentity | null>(null);

  // ── TASK-028: 校验错误与预览 ──
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);
  const requestSectionId = useId();
  const [requestCollapsed, setRequestCollapsed] = useState(false);
  const [panelLayout, setPanelLayout] = useState<DebugPanelLayout>(() => readDebugPanelLayout());

  const handleRequestBodyHeightChange = useCallback((height: number | undefined) => {
    setPanelLayout((prev) => {
      const next: DebugPanelLayout = { ...prev, requestBodyHeight: height };
      writeDebugPanelLayout(next);
      return next;
    });
  }, []);

  const handleResponseBodyHeightChange = useCallback((height: number | undefined) => {
    setPanelLayout((prev) => {
      const next: DebugPanelLayout = { ...prev, responseBodyHeight: height };
      writeDebugPanelLayout(next);
      return next;
    });
  }, []);

  /** 当前缺失必填的 key 集合（统一 `${in}:${name}` 或 `body:requestBody`） */
  const errorKeys = useMemo(() => new Set(validationErrors.map((e) => e.key)), [validationErrors]);

  const initialDebugState = useMemo(() => {
    if (!debugModel || !operation || !swaggerDoc) return null;
    return buildInitialDebugState(debugModel, operation, swaggerDoc, defaultBaseUrl, initialBodyDefaults);
  }, [debugModel, operation, swaggerDoc, defaultBaseUrl, initialBodyDefaults]);

  useLayoutEffect(() => {
    activeDebugCacheKeyRef.current = debugCacheKey;
    currentSchemaEngineRef.current = schemaEngine;
    schemaValidationRevisionRef.current += 1;
    schemaValidationAbortRef.current?.abort();
    schemaValidationAbortRef.current = null;
    setSchemaValidating(false);
    setPendingSchemaOverride(null);
    responseSchemaValidationAbortRef.current?.abort();
    responseSchemaValidationAbortRef.current = null;
    setResponseSchemaDiagnostic(null);
  }, [debugCacheKey, schemaEngine, effectiveCookieSource, cookieSession.credentials]);

  useEffect(
    () => () => {
      schemaValidationAbortRef.current?.abort();
      responseSchemaValidationAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!settings.enableRequestHistory || debugCacheKey === null) {
      setHistoryEntries([]);
      return;
    }
    setHistoryEntries(listHistory(debugCacheKey));
  }, [debugCacheKey, settings.enableRequestHistory]);

  const applyInitialDebugState = useCallback(
    (
      initial: InitialDebugState & Partial<Pick<DebugFormState, 'oas32ParameterEntries' | 'serializedBodyMedia32'>>,
      options: { resetActiveTab?: boolean } = {},
    ) => {
      replaceForm(initial, initial.oas32ParameterEntries, initial.serializedBodyMedia32);
      appliedDefaults32.current = null;
      setFileFields({});
      setBinaryBodyFile(null);
      setBuiltRequest(null);
      setBuiltRequestCookieSource('explicit');
      setSseEvents(null);
      setSequentialStream(null);
      setSseStreaming(false);
      setResponseProgress(null);
      setValidationErrors([]);
      if (options.resetActiveTab) {
        setActiveTab(undefined);
        setRequestCollapsed(false);
      }
      setResetNonce((value) => value + 1);
    },
    [replaceForm],
  );

  // 当 debugModel 变化时，同步初始化表单状态
  useEffect(() => {
    if (!initialDebugState || !debugModel) return;
    const cached = settings.enableRequestCache && debugCacheKey !== null ? readDebugCache(debugCacheKey) : null;
    const nextInitial = restoreInitialDebugStateFromCache(
      initialDebugState,
      cached,
      debugModel,
      initialBodyDefaults,
      Boolean(operation?.identity),
    );
    skipNextDebugCacheWriteRef.current = true;
    setDebugDefaultEditRevision(cached === null ? 0 : 1);
    appliedOas31ExampleIdentityRef.current = null;
    requestSeqRef.current += 1;
    sseAbortRef.current?.abort();
    sseAbortRef.current = null;
    setSseStreaming(false);
    const cachedSession = debugCacheKey !== null ? readDebugSessionState(debugCacheKey) : null;
    applyInitialDebugState(
      {
        ...nextInitial,
        ...(isOas32 && cached
          ? {
              oas32ParameterEntries: restoreOas32ParameterEntries(
                cached.oas32ParameterEntries,
                cached.serializedExampleParameters,
              ),
              serializedBodyMedia32: cached.serializedExampleBodyMediaType,
            }
          : {}),
      },
      { resetActiveTab: true },
    );
    setLoading(false);
    setResponse(cachedSession?.response ?? null);
    setError(cachedSession?.error ?? null);
    setBuiltRequest(cachedSession?.builtRequest ?? null);
    setBuiltRequestCookieSource(cachedSession?.builtRequestCookieSource ?? 'explicit');
    setSseEvents(cachedSession?.sseEvents ?? null);
    setSequentialStream(
      cachedSession?.sequentialStream ? { ...cachedSession.sequentialStream, streaming: false } : null,
    );
    setExtractionLog(cachedSession?.extractionLog ?? null);
    const loadedRules = debugCacheKey !== null ? readResponseExtractionRules(debugCacheKey) : [];
    extractionRulesRef.current = loadedRules;
    setExtractionRules(loadedRules);
    setExtractionPersistenceFailed(false);
    setHydratedDebugCacheKey(debugCacheKey);
  }, [
    applyInitialDebugState,
    debugCacheKey,
    debugModel,
    initialBodyDefaults,
    initialDebugState,
    settings.enableRequestCache,
    operation?.identity,
    isOas32,
    setDebugDefaultEditRevision,
  ]);

  useEffect(() => {
    if (debugCacheKey === null || hydratedDebugCacheKey !== debugCacheKey) return;
    if (
      !response &&
      !error &&
      !builtRequest &&
      sseEvents === null &&
      sequentialStream === null &&
      extractionLog === null
    ) {
      removeDebugSessionState(debugCacheKey);
      return;
    }
    writeDebugSessionState(debugCacheKey, {
      response,
      error,
      builtRequest,
      builtRequestCookieSource,
      sseEvents,
      sequentialStream: sequentialStream ? { ...sequentialStream, streaming: false } : sequentialStream,
      extractionLog,
    });
  }, [
    builtRequest,
    builtRequestCookieSource,
    debugCacheKey,
    error,
    extractionLog,
    hydratedDebugCacheKey,
    response,
    sseEvents,
    sequentialStream,
  ]);

  const pendingDebugCacheWriteRef = useRef<{ key: string; payload: Parameters<typeof writeDebugCache>[1] } | null>(
    null,
  );

  useEffect(
    () => () => {
      const pending = pendingDebugCacheWriteRef.current;
      if (pending) {
        pendingDebugCacheWriteRef.current = null;
        writeDebugCache(pending.key, pending.payload);
      }
    },
    [debugCacheKey],
  );

  useEffect(() => {
    if (!settings.enableRequestCache || debugCacheKey === null || hydratedDebugCacheKey !== debugCacheKey) {
      return;
    }
    if (skipNextDebugCacheWriteRef.current) {
      skipNextDebugCacheWriteRef.current = false;
      return;
    }
    const payload: Parameters<typeof writeDebugCache>[1] = {
      version: DEBUG_CACHE_VERSION,
      cookieParameterSource: effectiveCookieSource,
      ...(isOas32
        ? {
            serializedExampleParameters: serializedParams32,
            oas32ParameterEntries: editableOas32ParameterEntries(oas32ParameterEntries),
            serializedExampleBodyMediaType: serializedBodyMedia32,
          }
        : {}),
      baseUrl,
      method,
      path,
      paramValues,
      paramEnabled,
      selectedContentType,
      body,
      formFields,
      formPartHeaders,
      formPartContentTypes,
      rawMode,
      customQueryParams,
      customBodyParams,
      customHeaders,
      customCookies,
    };
    pendingDebugCacheWriteRef.current = { key: debugCacheKey, payload };
    const timer = window.setTimeout(() => {
      const pending = pendingDebugCacheWriteRef.current;
      if (pending && pending.key === debugCacheKey) {
        pendingDebugCacheWriteRef.current = null;
        writeDebugCache(pending.key, pending.payload);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    baseUrl,
    body,
    customBodyParams,
    customCookies,
    customHeaders,
    customQueryParams,
    effectiveCookieSource,
    debugCacheKey,
    formFields,
    formPartHeaders,
    formPartContentTypes,
    method,
    paramEnabled,
    paramValues,
    path,
    rawMode,
    selectedContentType,
    settings.enableRequestCache,
    hydratedDebugCacheKey,
    isOas32,
    serializedParams32,
    serializedBodyMedia32,
    oas32ParameterEntries,
  ]);

  useEffect(() => {
    if (
      !defaults32 ||
      appliedDefaults32.current === defaults32 ||
      debugDefaultEditRevisionRef.current !== 0 ||
      hydratedDebugCacheKey !== debugCacheKey
    )
      return;
    const entries: Record<string, (typeof oas32ParameterEntries)[string]> = Object.create(null);
    const values: Record<string, string> = {};
    const enabled: Record<string, boolean> = {};
    for (const result of defaults32.values()) {
      if (result.target.parameterKey) {
        const entry = oas32ExampleParameterEntry(result, debugDefaultEditRevisionRef.current);
        if (entry) {
          entries[result.target.parameterKey] = entry;
          values[result.target.parameterKey] = entry.text;
          enabled[result.target.parameterKey] = true;
        }
      } else if (
        result.target.mediaType === selectedContentType &&
        result.target.context.bodyContent?.category === 'multipart' &&
        result.representation.data !== undefined &&
        result.target.context.bodyContent.oas32Form &&
        result.representation.serialization !== 'invalid' &&
        !result.representation.external
      ) {
        setSerializedBodyMedia32(undefined);
        setFormFields(
          oas32FormFieldsFromInstance(result.target.context.bodyContent.oas32Form, result.representation.data),
        );
      } else if (
        result.target.mediaType === selectedContentType &&
        result.representation.text !== undefined &&
        result.representation.serialization !== 'invalid' &&
        !result.representation.external &&
        !result.target.context.bodyContent?.binary &&
        result.target.context.bodyContent?.category !== 'multipart'
      ) {
        setBody(result.representation.text);
        setSerializedBodyMedia32(selectedContentType);
      }
    }
    setOas32ParameterEntries(entries);
    setParamValues((previous) => ({ ...previous, ...values }));
    setParamEnabled((previous) => ({ ...previous, ...enabled }));
    appliedDefaults32.current = defaults32;
  }, [
    defaults32,
    hydratedDebugCacheKey,
    debugCacheKey,
    selectedContentType,
    resetNonce,
    setBody,
    setFormFields,
    setOas32ParameterEntries,
    setParamEnabled,
    setParamValues,
    setSerializedBodyMedia32,
  ]);

  const setBodyFromUser = useCallback(
    (next: string) => {
      markDebugDefaultEdited();
      setBody(next);
    },
    [markDebugDefaultEdited, setBody],
  );

  const setFormFieldsFromUser = useCallback(
    (next: React.SetStateAction<Record<string, string>>) => {
      markDebugDefaultEdited();
      setFormFields(next);
    },
    [markDebugDefaultEdited, setFormFields],
  );

  const setFormPartHeadersFromUser = useCallback(
    (next: React.SetStateAction<Record<string, Record<string, string>>>) => {
      markDebugDefaultEdited();
      setFormPartHeaders(next);
    },
    [markDebugDefaultEdited, setFormPartHeaders],
  );

  const setFormPartContentTypesFromUser = useCallback(
    (next: React.SetStateAction<Record<string, string>>) => {
      markDebugDefaultEdited();
      setFormPartContentTypes(next);
    },
    [markDebugDefaultEdited, setFormPartContentTypes],
  );

  const updateValue = (param: DebugParam, next: string) => {
    markDebugDefaultEdited();
    const key = paramKey(param);
    setOas32ParameterEntries((previous) => {
      const current = previous[key];
      return {
        ...previous,
        [key]: {
          kind: current?.kind ?? 'editor',
          text: next,
          enabled: paramEnabled[key] !== false,
          ...(current && 'data' in current ? { data: current.data } : {}),
        },
      };
    });
    setParamValues((prev) => ({ ...prev, [paramKey(param)]: next }));
  };

  // ── Path 参数实时回写到 URL 显示 ──
  // originalPathTemplate 始终保存 OpenAPI 里的模板路径（如 /users/{id}），供 buildRequest 使用
  const originalPathTemplate = operation?.path ?? '/';
  const displayPath = useMemo(() => {
    if (!debugModel) return path;
    const pathParamValues: Record<string, string> = {};
    for (const p of debugModel.pathParams) {
      if (p.parameterSerialization) continue;
      const v = paramValues[paramKey(p)];
      if (v !== undefined && v !== '') pathParamValues[p.name] = v;
    }
    // 如果 path 还包含 {xxx} 占位符，说明用户没有手动覆盖 URL，用 replacePathParams 实时替换
    // 如果 path 已不包含任何占位符，说明用户手动编辑了 URL，直接显示
    const hasPlaceholders = debugModel.pathParams.some((p) => path.includes(`{${p.name}}`));
    if (!hasPlaceholders) return path;
    if (debugModel.oas32Parameters) {
      return previewOas32DisplayPath(
        path,
        debugModel.oas32Parameters,
        oas32ParameterEntries,
        paramValues,
        paramEnabled,
        effectiveCookieSource,
        debugDefaultEditRevision,
      );
    }
    const legacyPath = replacePathParams(path, pathParamValues);
    try {
      const oas31Values = collectOas31ParameterValues(debugModel, paramValues, paramEnabled, effectiveCookieSource);
      const serializedPath = serializeOas31Parameters(
        debugModel,
        oas31Values,
        Object.fromEntries(Object.entries(serializedParams32).filter(([key]) => paramEnabled[key] !== false)),
      ).path;
      return replaceSerializedPathParams(legacyPath, serializedPath);
    } catch {
      // The canonical preview reports the precise serialization diagnostic.
      // Keep the editable URL field usable while the value is incomplete.
      return legacyPath;
    }
  }, [
    path,
    debugModel,
    paramEnabled,
    paramValues,
    effectiveCookieSource,
    serializedParams32,
    oas32ParameterEntries,
    debugDefaultEditRevision,
  ]);

  /** 用户在 URL 输入框中修改路径时，反向同步到对应的 path 参数值 */
  const handlePathInputChange = (newPath: string) => {
    setPath(newPath);
    if (!debugModel) return;
    // 逐个 path 参数检测：基于模板路径结构，从 newPath 中提取占位符对应位置的实际值
    for (const p of debugModel.pathParams) {
      const placeholder = `{${p.name}}`;
      // 如果 newPath 仍然包含占位符，说明用户只是在编辑非 path 参数部分，跳过反向同步
      if (newPath.includes(placeholder)) continue;
      const placeholderIdx = originalPathTemplate.indexOf(placeholder);
      if (placeholderIdx === -1) continue;
      // 模板中占位符后面紧跟的分隔符（如 / 或 ? 或末尾）
      const afterPlaceholder = originalPathTemplate.slice(placeholderIdx + placeholder.length);
      const nextDelimIdx = afterPlaceholder.length > 0 ? newPath.indexOf(afterPlaceholder, placeholderIdx) : -1;
      const valueEnd = nextDelimIdx === -1 ? newPath.length : nextDelimIdx;
      const extractedValue = newPath.slice(placeholderIdx, valueEnd);
      try {
        const decoded = decodeURIComponent(extractedValue);
        setParamValues((prev) => ({ ...prev, [paramKey(p)]: decoded }));
      } catch {
        setParamValues((prev) => ({ ...prev, [paramKey(p)]: extractedValue }));
      }
    }
  };

  // ── 所有 hooks 必须在 early return 之前 ──

  // ── 从 AuthContext 获取鉴权数据 ──
  const { schemes: authSchemes, ready: authReady } = useAuth();
  const authValues = useMemo(() => {
    const bySecurityKey: Record<string, SchemeValue> = {};
    let hasAny = false;
    for (const [key, val] of Object.entries(authSchemes)) {
      if (val) {
        bySecurityKey[key] = val;
        hasAny = true;
      }
    }
    if (!hasAny) return undefined;
    return { bySecurityKey };
  }, [authSchemes]);

  // ── 从 operation.security 推导 securityKeys ──
  const securityKeys = useMemo(() => {
    const opSecurity = operation?.operation?.security;
    if (!opSecurity || !Array.isArray(opSecurity) || opSecurity.length === 0) return undefined;
    const keys: string[] = [];
    for (const item of opSecurity) {
      for (const key of Object.keys(item)) {
        if (!keys.includes(key)) keys.push(key);
      }
    }
    return keys.length > 0 ? keys : undefined;
  }, [operation]);

  const [securityBranchIndex, setSecurityBranchIndex] = useState<number | undefined>();
  useEffect(() => {
    setSecurityBranchIndex(undefined);
  }, [operation?.identity?.identity]);
  const security32 = useMemo(
    () =>
      isOas32 ? projectAndPlanOas32Security(resources.snapshot, operation, authValues, securityBranchIndex) : null,
    [authValues, isOas32, operation, resources.snapshot, securityBranchIndex],
  );

  // ── 从 GlobalParamContext 转换为应用级与当前分组参数 ──
  const applicationParamValues = useMemo(
    () => globalParamValuesForScope(effectiveParams, 'application'),
    [effectiveParams],
  );
  const globalParamValues = useMemo(() => globalParamValuesForScope(effectiveParams, 'group'), [effectiveParams]);

  const findEffectiveParam = (
    location: ScopedGlobalParamItem['in'],
    name: string,
    source: ParamSource | undefined,
  ): ScopedGlobalParamItem | undefined => {
    const scope = source === 'application' ? 'application' : source === 'global' ? 'group' : undefined;
    if (!scope) return undefined;
    return effectiveParams.find(
      (param) =>
        param.scope === scope &&
        param.in === location &&
        (location === 'header' ? param.name.toLowerCase() === name.toLowerCase() : param.name === name),
    );
  };

  useOas31DebugExampleLoader({
    enabled: isOas31 && !docLoading && authReady && routeGroupReady,
    document: swaggerDoc,
    operation: operation ?? null,
    debugModel,
    session: schemaEngine.status === 'ready' ? schemaEngine.session : null,
    identity: oas31ExampleIdentity,
    setState: setOas31ExampleState,
  });
  useOas31DebugDefaultHydrator({
    activeExamples: activeOas31Examples,
    state: oas31ExampleState,
    identity: oas31ExampleIdentity,
    editRevisionRef: debugDefaultEditRevisionRef,
    appliedIdentityRef: appliedOas31ExampleIdentityRef,
    hydratedDebugCacheKey,
    currentDebugCacheKey: debugCacheKey,
    selectedBody: debugModel?.bodyContents.find((content) => content.mediaType === selectedContentType),
    setBody,
    setFormFields,
  });

  const previewResult = useDebugRequestPreview({
    enabled: !docLoading && authReady && routeGroupReady && Boolean(swaggerDoc && operation),
    baseUrl,
    form,
    debugModel,
    preserveMethodCase: Boolean(operation?.identity),
    isOas32: Boolean(isOas32),
    enableDynamicParameter: settings.enableDynamicParameter,
    serverUnavailable: serverOrPathUnavailable32,
    serverUnavailableMessage: t('oas32.server.unavailable'),
    unrepresentableMultipartMessage: t('apiDebug.formDiagnostic.FORMDATA_UNREPRESENTABLE'),
    auth: authValues,
    securityKeys,
    securityPlan: security32?.plan,
    applicationParams: applicationParamValues,
    globalParams: globalParamValues,
    effectiveCookieSource,
    credentials: cookieSession.credentials,
    sessionCurlNote: t('apiDebug.cookie.sessionCurl'),
    fileFields,
    binaryBodyFile,
    editRevision: debugDefaultEditRevision,
    exampleSession32,
    proxyHeader: activeSwaggerGroup?.header,
    proxyOrigin: currentOrigin(),
    proxyContextPath: groupContextPath,
  });

  const handleExtractionRulesChange = useCallback(
    (nextRules: ResponseExtractionRule[]) => {
      extractionRulesRef.current = nextRules;
      setExtractionRules(nextRules);
      if (debugCacheKey !== null) {
        const persisted = writeResponseExtractionRules(debugCacheKey, nextRules);
        setExtractionPersistenceFailed(!persisted);
      }
    },
    [debugCacheKey],
  );

  const runResponseExtraction = useCallback(
    (
      input: ResponseExtractionInput,
      mode: 'auto' | 'dry-run',
      applyMutations: boolean,
      rulesOverride?: readonly ResponseExtractionRule[],
    ) => {
      const rules = rulesOverride ?? extractionRulesRef.current;
      const evaluation = evaluateResponseExtraction(rules, input, { mode });
      if (evaluation.log.status === 'skipped' && evaluation.log.skipReason === 'no-enabled-rules') {
        if (mode === 'dry-run') {
          setExtractionLog(evaluation.log);
        } else {
          setExtractionLog(null);
        }
        return;
      }

      if (applyMutations && evaluation.mutations.length > 0) {
        const { shadowedApplicationIdentities } = upsertParams(evaluation.mutations);
        const annotatedItems = evaluation.log.items.map((item) => {
          if (item.status !== 'updated' || item.targetScope !== 'application') return item;
          const identity = globalParamIdentity({ in: item.targetIn, name: item.targetName });
          return shadowedApplicationIdentities.has(identity) ? { ...item, shadowedByGroup: true } : item;
        });
        setExtractionLog({ ...evaluation.log, items: annotatedItems });
        return;
      }

      setExtractionLog(evaluation.log);
    },
    [upsertParams],
  );

  const currentResponseExtractionInput = useMemo<ResponseExtractionInput | null>(() => {
    if (sseEvents !== null || sequentialStream !== null) {
      return {
        status: response?.status ?? 200,
        headers: response?.headers ?? {},
        rawText: response?.rawText ?? '',
        kind: response?.kind ?? 'text',
        isStreaming: true,
      };
    }
    if (!response) return null;
    return {
      status: response.status,
      headers: response.headers,
      rawText: response.rawText,
      kind: response.kind,
      isCrossOrigin: isCrossOriginUrl(builtRequest?.url, currentOrigin()),
    };
  }, [builtRequest?.url, response, sequentialStream, sseEvents]);

  const handleApplyExtractionNow = useCallback(
    (rulesOverride?: readonly ResponseExtractionRule[]) => {
      if (!currentResponseExtractionInput) return;
      runResponseExtraction(currentResponseExtractionInput, 'auto', true, rulesOverride);
      void message.success(t('apiDebug.extract.applied'));
    },
    [currentResponseExtractionInput, runResponseExtraction, t],
  );

  if (docLoading || !authReady || !routeGroupReady) {
    return (
      <OperationModeLayout activeKey="debug">
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      </OperationModeLayout>
    );
  }

  if (!swaggerDoc || !operation || !debugModel) {
    return (
      <OperationModeLayout activeKey="debug">
        <Alert type="warning" showIcon title={t('apiDebug.notFound.title')} description={t('apiDebug.notFound.desc')} />
      </OperationModeLayout>
    );
  }

  const bodyCategory =
    debugModel.bodyContents.find((body) => body.mediaType === selectedContentType)?.category ?? 'raw';
  const effectiveContentType = effectiveDebugContentType(debugModel, form, Boolean(isOas32));

  const buildHistoryFormSnapshot = (): DebugHistoryFormSnapshot => {
    const fileFieldNames: Record<string, string[]> = {};
    for (const [name, fileList] of Object.entries(fileFields)) {
      if (fileList.length > 0) {
        fileFieldNames[name] = fileList.map((file) => file.name);
      }
    }
    if (binaryBodyFile) fileFieldNames['$body'] = [binaryBodyFile.name];
    const hasFileFields = Object.keys(fileFieldNames).length > 0;
    return {
      baseUrl,
      method,
      path,
      cookieParameterSource: effectiveCookieSource,
      ...(isOas32
        ? {
            serializedExampleParameters: serializedParams32,
            oas32ParameterEntries: editableOas32ParameterEntries(oas32ParameterEntries),
            serializedExampleBodyMediaType: serializedBodyMedia32,
          }
        : {}),
      paramValues: { ...paramValues },
      paramEnabled: { ...paramEnabled },
      selectedContentType,
      body,
      formFields: { ...formFields },
      formPartHeaders: Object.fromEntries(
        Object.entries(formPartHeaders).map(([fieldName, headers]) => [fieldName, { ...headers }]),
      ),
      formPartContentTypes: { ...formPartContentTypes },
      rawMode,
      customQueryParams: customQueryParams.map((row) => ({ ...row })),
      customBodyParams: customBodyParams.map((row) => ({ ...row })),
      customHeaders: customHeaders.map((row) => ({ ...row })),
      customCookies: customCookies.map((row) => ({ ...row })),
      fileFieldNames: hasFileFields ? fileFieldNames : undefined,
      hasFileFields,
    };
  };

  const refreshHistoryEntries = (cacheKey: string | null) => {
    if (!cacheKey || !settings.enableRequestHistory) {
      setHistoryEntries([]);
      return;
    }
    if (activeDebugCacheKeyRef.current === cacheKey) {
      setHistoryEntries(listHistory(cacheKey));
    }
  };

  const finalizeHistoryEntry = (
    cacheKey: string | null,
    entryId: string | null,
    updater: (entry: DebugHistoryEntry) => DebugHistoryEntry,
  ) => {
    // Only requires an id: if a pending row was written, always complete it even if the
    // setting is toggled off mid-flight (switch only controls new writes + panel visibility).
    if (!cacheKey || !entryId) return;
    updateEntry(cacheKey, entryId, updater);
    if (pendingHistoryIdRef.current === entryId) {
      pendingHistoryIdRef.current = null;
      pendingHistoryCacheKeyRef.current = null;
    }
    refreshHistoryEntries(cacheKey);
  };

  const handleApplyHistory = (entry: DebugHistoryEntry) => {
    markDebugDefaultEdited();
    const snap = entry.formSnapshot;
    if (snap) {
      if (isOas32) server32.restoreOverride(snap.baseUrl);
      const snapshotBodyContent = debugModel.bodyContents.find(
        (candidate) => candidate.mediaType === snap.selectedContentType,
      );
      const restoredPartHeaders = Object.fromEntries(
        Object.entries(snap.formPartHeaders ?? {}).map(([fieldName, headers]) => [
          fieldName,
          Object.fromEntries(
            Object.entries(headers).filter(
              ([name, value]) => value !== DEBUG_HISTORY_MASK && !isSensitiveHeaderName(name),
            ),
          ),
        ]),
      );
      const restoredHeaders = snap.customHeaders.filter(
        (row) => row.value !== DEBUG_HISTORY_MASK && !isSensitiveHeaderName(row.name),
      );
      const restoredCookies = snap.customCookies.filter(
        (row) => row.value !== DEBUG_HISTORY_MASK && !isSensitiveHeaderName(row.name),
      );
      replaceForm(
        {
          baseUrl: isOas32 ? legacyBaseUrl : snap.baseUrl,
          method: snap.method,
          path: snap.path,
          cookieParameterSource: snap.cookieParameterSource ?? 'explicit',
          paramValues: snap.paramValues,
          paramEnabled: snap.paramEnabled,
          selectedContentType: snap.selectedContentType,
          body: snap.body,
          formFields: snap.formFields,
          formPartHeaders: mergeCachedFormPartHeaders(snapshotBodyContent, restoredPartHeaders),
          formPartContentTypes: { ...(snap.formPartContentTypes ?? {}) },
          rawMode: snap.rawMode,
          customQueryParams: snap.customQueryParams,
          customBodyParams: snap.customBodyParams,
          customHeaders: restoredHeaders,
          customCookies: restoredCookies,
        },
        restoreOas32ParameterEntries(snap.oas32ParameterEntries, snap.serializedExampleParameters),
        snap.serializedExampleBodyMediaType,
      );
      setFileFields({});
      setBinaryBodyFile(null);
      setResetNonce((value) => value + 1);
      void message.success(t('apiDebug.history.applied'));
      if (snap.hasFileFields) {
        void message.warning(t('apiDebug.history.reselectFiles'));
      }
      const hadSensitive =
        snap.customHeaders.some((row) => row.value === DEBUG_HISTORY_MASK || isSensitiveHeaderName(row.name)) ||
        snap.customCookies.some((row) => row.value === DEBUG_HISTORY_MASK || isSensitiveHeaderName(row.name)) ||
        Object.values(snap.formPartHeaders ?? {}).some((headers) =>
          Object.entries(headers).some(([name, value]) => value === DEBUG_HISTORY_MASK || isSensitiveHeaderName(name)),
        );
      if (hadSensitive) {
        void message.info(t('apiDebug.history.sensitiveSkipped'));
      }
      return;
    }

    setOas32ParameterEntries({});
    setSerializedBodyMedia32(undefined);
    if (isOas32) server32.restoreOverride(entry.baseUrl);
    else setBaseUrl(entry.baseUrl);
    setCookieParameterSource('explicit');
    setMethod(entry.method);
    setPath(entry.path);
    if (entry.body !== undefined) setBody(entry.body);
    if (entry.contentType) setSelectedContentType(entry.contentType);
    void message.success(t('apiDebug.history.applied'));
  };

  const handleRemoveHistory = (id: string) => {
    if (debugCacheKey === null) return;
    setHistoryEntries(removeEntry(debugCacheKey, id));
  };

  const handleClearHistory = () => {
    if (debugCacheKey === null) return;
    clearHistory(debugCacheKey);
    setHistoryEntries([]);
  };

  const handleSend = async (options: HandleSendOptions = {}) => {
    if (!previewResult) return;
    const failWithoutFetch = (message: string, tab?: string) => {
      if (tab) {
        setActiveTab(tab);
        setRequestCollapsed(false);
      }
      discardUnsentDebugResponse(response);
      sseAbortRef.current?.abort();
      sseAbortRef.current = null;
      setSseStreaming(false);
      setResponse(null);
      setSseEvents(null);
      setSequentialStream(null);
      setResponseSchemaDiagnostic(null);
      setError(message);
    };
    if (isOas32 && serverOrPathUnavailable32) {
      failWithoutFetch(t('oas32.server.unavailable'));
      return;
    }
    setError(null);
    if (isOas32 && options.prepared) {
      const current = previewResult;
      if (
        !current.ok ||
        current.value.built.url !== options.prepared.built.url ||
        current.value.built.method !== options.prepared.built.method
      ) {
        failWithoutFetch(t('oas32.server.changed'));
        return;
      }
    }

    const requestPreview = resolveSendPreview(options.prepared, previewResult);
    if (!requestPreview.ok) {
      setValidationErrors([]);
      failWithoutFetch(requestPreview.error, debugModel.parameterDiagnostics?.[0]?.in ?? 'query');
      return;
    }
    const {
      formValues,
      built,
      cookieParameterSource: requestCookieSource = 'explicit',
      credentials = 'same-origin',
      materializedMultipart: preparedMultipart,
      binaryFile,
    } = requestPreview.value;

    // required 校验 — 用 core 侧统一校验，并携带定位 key
    const errors = filterRequiredErrorsForCookieSource(
      debugModel,
      validateRequired(debugModel, formValues, built.parameterPresence),
      requestCookieSource,
      { declaredCookies: isOas32 },
    );
    const requiredParameterErrors = isOas31SchemaDocument(swaggerDoc)
      ? errors.filter((error) => isOas31RequiredParameterError(debugModel, error))
      : [];
    const blockingRequiredErrors = errors.filter((error) => !requiredParameterErrors.includes(error));
    setValidationErrors(errors);
    if (blockingRequiredErrors.length > 0) {
      const first = blockingRequiredErrors[0];
      failWithoutFetch(
        blockingRequiredErrors.map((e) => e.message).join('\n'),
        first.in === 'body' ? 'body' : first.in,
      );
      return;
    }

    // From here on, use only the immutable preview snapshot. A schema override
    // must not pick up fields/files/header values edited after diagnostics ran.
    const snapshotContentType = formValues.selectedContentType ?? built.contentType;
    const activeBodyContent = debugModel.bodyContents.find((item) => item.mediaType === snapshotContentType);
    const category = activeBodyContent?.category ?? 'raw';
    const multipartPlan = built.formBodyPlan?.kind === 'multipart' ? built.formBodyPlan : undefined;
    const isMultipart = Boolean(multipartPlan) || category === 'multipart';
    const isBinaryBody = Boolean(activeBodyContent?.binary);
    // core 的 multipart built.body 是已经按发送规则过滤后的文本 part 映射，
    // 历史、cURL 和真实 FormData 共用它，避免在 UI 层维护第二套过滤逻辑。
    const multipartTextFields =
      isMultipart && multipartPlan?.wire !== 'authored'
        ? (() => {
            try {
              return JSON.parse(built.body ?? '{}') as Record<string, string>;
            } catch {
              return {};
            }
          })()
        : {};
    const multipartFiles = (formValues.fileFields ?? {}) as Record<string, File[]>;
    const hasMultipartFile = Object.values(multipartFiles).some((files) => files.length > 0);
    const hasBodyInput = isMultipart
      ? multipartPlan?.wire === 'authored'
        ? Boolean(multipartPlan.authoredBody)
        : (multipartPlan?.parts.length ?? Object.keys(multipartTextFields).length) > 0 || hasMultipartFile
      : isBinaryBody
        ? binaryFile != null
        : built.body !== undefined && (built.body !== '' || built.explicitExampleBody === true);
    const hardFailure = inspectUnsentBrowserSendFailure({
      built,
      hasBodyInput,
      cookieSessionCapable: isOas31 || isOas32,
      isOas32,
    });
    if (hardFailure) {
      let message: string;
      switch (hardFailure.kind) {
        case 'unsupported-method':
          message = t('apiDebug.method.browserUnsupported', { method: built.method });
          break;
        case 'normalized-method':
          message = t('apiDebug.method.browserNormalized', {
            method: built.method,
            normalized: built.method.toUpperCase(),
          });
          break;
        case 'unsupported-body':
          message = t('apiDebug.body.browserMethodUnsupported', { method: built.method });
          break;
        case 'unsupported-cookie':
          message = t('apiDebug.cookie.browserUnsupported');
          break;
        case 'oas32-browser':
          message = oas32DiagnosticMessages(hardFailure.diagnostics);
          break;
      }
      failWithoutFetch(message, unsentBrowserSendFailureTab(hardFailure));
      return;
    }

    if (options.skipSchemaValidation) {
      if (
        !options.prepared ||
        options.validationRevision !== schemaValidationRevisionRef.current ||
        options.validationDebugCacheKey !== activeDebugCacheKeyRef.current
      ) {
        return;
      }
    } else {
      schemaValidationAbortRef.current?.abort();
      schemaValidationAbortRef.current = null;
      setSchemaValidating(false);
      const validationRevision = schemaValidationRevisionRef.current + 1;
      schemaValidationRevisionRef.current = validationRevision;
      const validationDebugCacheKey = debugCacheKey;
      const isCurrentValidation = () =>
        schemaValidationRevisionRef.current === validationRevision &&
        activeDebugCacheKeyRef.current === validationDebugCacheKey;
      setPendingSchemaOverride(null);

      const diagnosticIssues: RequestSchemaDiagnosticIssue[] =
        built.parameterInputDiagnostics?.map((issue): ParameterInputRequestSchemaDiagnosticIssue =>
          issue.kind === 'invalid-json'
            ? { ...issue, kind: 'invalid-json', target: 'parameter' }
            : { ...issue, kind: 'unsafe-number', target: 'parameter' },
        ) ?? [];
      diagnosticIssues.push(
        ...requiredParameterErrors.map((issue): RequestSchemaDiagnosticIssue => ({
          ...issue,
          kind: 'required-parameter',
          target: 'parameter',
        })),
        ...(built.formBodyPlan?.diagnostics.map((issue): FormBodyRequestSchemaDiagnosticIssue => ({
          ...issue,
          kind: 'form-body',
          target: 'body',
        })) ?? []),
      );
      let totalDiagnosticIssues = diagnosticIssues.length;
      const bodyPreparation = prepareRequestBodySchemaEvaluation({
        document: swaggerDoc,
        operation,
        schemaMediaType: selectedContentType,
        effectiveContentType: effectiveRequestContentType(built.headers, built.contentType),
        body: built.body,
        formBodyPlan: built.formBodyPlan,
      });
      const parameterPreparation = prepareParameterSchemaEvaluation({
        document: swaggerDoc,
        operation,
        instances: built.parameterInstances,
      });

      if (bodyPreparation.status === 'invalid-json') {
        diagnosticIssues.push({ kind: 'invalid-json', target: 'body' });
        totalDiagnosticIssues += 1;
      }
      if (bodyPreparation.status === 'unavailable') {
        void message.warning(t('apiDebug.schemaValidation.unavailable'));
      }
      if (parameterPreparation.status === 'ready' && parameterPreparation.unavailable.length > 0) {
        void message.warning(
          t('apiDebug.schemaValidation.parameterUnavailable', {
            count: parameterPreparation.unavailable.length,
          }),
        );
      }

      const shouldEvaluateBody = bodyPreparation.status === 'ready';
      const shouldEvaluateParameters =
        parameterPreparation.status === 'ready' && parameterPreparation.evaluations.length > 0;
      if (shouldEvaluateBody || shouldEvaluateParameters) {
        if (schemaEngine.status !== 'ready') {
          const detail =
            schemaEngine.status === 'error'
              ? schemaEngine.error.message
              : t('apiDebug.schemaValidation.engineNotReady');
          void message.warning(t('apiDebug.schemaValidation.engineFailed', { message: detail }));
        } else {
          const controller = new AbortController();
          schemaValidationAbortRef.current = controller;
          setSchemaValidating(true);
          try {
            if (shouldEvaluateBody) {
              const evaluation = await evaluateRequestBodySchema(schemaEngine.session, bodyPreparation, {
                signal: controller.signal,
              });
              if (!isCurrentValidation()) return;
              if (evaluation.status === 'invalid') {
                totalDiagnosticIssues += evaluation.totalIssues;
                diagnosticIssues.push(
                  ...evaluation.issues.map((issue) => ({
                    ...issue,
                    kind: 'invalid-schema' as const,
                    target: 'body' as const,
                  })),
                );
              }
            }
            if (shouldEvaluateParameters) {
              const evaluation = await evaluateParameterSchemas(schemaEngine.session, parameterPreparation, {
                signal: controller.signal,
              });
              if (!isCurrentValidation()) return;
              if (evaluation.status === 'invalid') {
                totalDiagnosticIssues += evaluation.totalIssues;
                diagnosticIssues.push(
                  ...evaluation.issues.map((issue) => ({
                    ...issue,
                    kind: 'invalid-schema' as const,
                    target: 'parameter' as const,
                  })),
                );
              }
            }
          } catch (reason: unknown) {
            const code =
              reason && typeof reason === 'object' && 'code' in reason
                ? (reason as { code?: unknown }).code
                : undefined;
            if (controller.signal.aborted || code === 'OPERATION_ABORTED' || !isCurrentValidation()) return;
            const detail = reason instanceof Error ? reason.message : String(reason);
            void message.warning(t('apiDebug.schemaValidation.engineFailed', { message: detail }));
          } finally {
            if (schemaValidationAbortRef.current === controller) {
              schemaValidationAbortRef.current = null;
              setSchemaValidating(false);
            }
          }
          if (!isCurrentValidation()) return;
        }
      }

      if (isOas32 && built.oas32ParameterPlan && exampleSession32) {
        const controller = new AbortController();
        schemaValidationAbortRef.current = controller;
        setSchemaValidating(true);
        try {
          const planIssues = await evaluateOas32ParameterPlan(
            built.oas32ParameterPlan,
            exampleSession32,
            controller.signal,
          );
          if (!isCurrentValidation()) return;
          if (planIssues.length > 0) {
            totalDiagnosticIssues += planIssues.length;
            diagnosticIssues.push(
              ...planIssues.map((issue): RequestSchemaDiagnosticIssue => ({
                ...issue,
                kind: 'invalid-schema',
                target: 'parameter',
              })),
            );
          }
        } catch (reason) {
          const code =
            reason && typeof reason === 'object' && 'code' in reason
              ? String((reason as { code?: string }).code)
              : undefined;
          if (controller.signal.aborted || code === 'OPERATION_ABORTED' || !isCurrentValidation()) return;
          const detail = reason instanceof Error ? reason.message : String(reason);
          void message.warning(t('apiDebug.schemaValidation.engineFailed', { message: detail }));
        } finally {
          if (schemaValidationAbortRef.current === controller) {
            schemaValidationAbortRef.current = null;
            setSchemaValidating(false);
          }
        }
        if (!isCurrentValidation()) return;
      } else if (isOas32 && built.oas32ParameterPlan && schemaEngine.status !== 'ready') {
        const detail =
          schemaEngine.status === 'error' ? schemaEngine.error.message : t('apiDebug.schemaValidation.engineNotReady');
        void message.warning(t('apiDebug.schemaValidation.engineFailed', { message: detail }));
      }

      if (diagnosticIssues.length > 0) {
        const first = diagnosticIssues[0];
        setActiveTab(first.target === 'body' ? 'body' : first.in === 'querystring' ? 'querystring' : first.in);
        setRequestCollapsed(false);
        setPendingSchemaOverride({
          preview: requestPreview.value,
          debugCacheKey: validationDebugCacheKey,
          revision: validationRevision,
          issues: diagnosticIssues.slice(0, 8),
          totalIssues: totalDiagnosticIssues,
        });
        return;
      }
    }

    const requestDebugCacheKey = debugCacheKey;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    responseSchemaValidationAbortRef.current?.abort();
    responseSchemaValidationAbortRef.current = null;
    setResponseSchemaDiagnostic(null);
    const isCurrentDebugRequest = () =>
      activeDebugCacheKeyRef.current === requestDebugCacheKey && requestSeqRef.current === requestSeq;

    const historyEnabled = settings.enableRequestHistory && requestDebugCacheKey !== null;
    let pendingHistoryId: string | null = null;
    if (historyEnabled && requestDebugCacheKey) {
      // multipart: built.body only represents text fields and cannot carry filenames.
      // Persist the sent text parts + filename/size placeholders (binary content is never stored).
      const historyBody = isMultipart
        ? multipartPlan?.wire === 'authored'
          ? multipartPlan.authoredBody
          : multipartPlan
            ? buildOas31MultipartHistoryBody(multipartPlan)
            : buildMultipartHistoryBody(
                multipartTextFields,
                Object.fromEntries(
                  Object.entries(multipartFiles).map(([name, fileList]) => [
                    name,
                    fileList.map((file) => ({ name: file.name, size: file.size })),
                  ]),
                ),
              )
        : isBinaryBody && binaryFile
          ? JSON.stringify({ file: binaryFile.name, size: binaryFile.size })
          : built.body;
      const pending = createPendingEntry({
        method: built.method,
        path,
        baseUrl,
        resolvedUrl: built.url,
        headers: built.headers,
        query: Object.fromEntries(
          Object.entries(built.query).map(([name, value]) => [name, displayQueryParamValue(value)]),
        ),
        maskedHeaders: Object.keys(built.headers).filter(
          (name) => findEffectiveParam('header', name, built.sourceMap?.headers[name])?.masked === true,
        ),
        maskedQuery: Object.keys(built.query).filter(
          (name) => findEffectiveParam('query', name, built.sourceMap?.query[name])?.masked === true,
        ),
        body: historyBody,
        contentType: built.contentType || effectiveContentType,
        groupName: group,
        operationId: operaterId,
        formSnapshot: { ...buildHistoryFormSnapshot(), cookieParameterSource: requestCookieSource },
      });
      pendingHistoryId = pending.id;
      pendingHistoryIdRef.current = pending.id;
      pendingHistoryCacheKeyRef.current = requestDebugCacheKey;
      setHistoryEntries(appendPending(requestDebugCacheKey, pending));
    }

    setLoading(true);
    setResponseProgress(null);
    // Revoke any previous object URL to avoid memory leaks across consecutive sends.
    if (response?.objectUrl) {
      try {
        URL.revokeObjectURL(response.objectUrl);
      } catch {
        /* ignore */
      }
    }
    setResponse(null);
    setSseEvents(null);
    setSequentialStream(null);
    setSseStreaming(false);
    setExtractionLog(null);
    setBuiltRequest(built);
    setBuiltRequestCookieSource(requestCookieSource);
    const requestIsCrossOrigin = isCrossOriginUrl(built.url, currentOrigin());
    await executeDebugRequest({
      request: {
        built,
        formValues,
        activeBodyContent,
        multipartTextFields,
        preparedMultipart,
        binaryFile: binaryFile ?? null,
        credentials,
        isOas32: Boolean(isOas32),
        unrepresentableMessage: t('apiDebug.formDiagnostic.FORMDATA_UNREPRESENTABLE'),
      },
      swaggerDoc,
      operation,
      abortRef: sseAbortRef,
      isCurrentDebugRequest,
      getSchemaSession: () =>
        currentSchemaEngineRef.current.status === 'ready' ? currentSchemaEngineRef.current.session : undefined,
      finalizeHistory: (update) => finalizeHistoryEntry(requestDebugCacheKey, pendingHistoryId, update),
      onResponseCompleted: (completedResponse) => {
        if (!settings.enableAfterScript) return;
        runResponseExtraction(
          {
            status: completedResponse.status,
            headers: completedResponse.headers,
            rawText: completedResponse.rawText,
            kind: completedResponse.kind,
            isCrossOrigin: requestIsCrossOrigin,
          },
          'auto',
          true,
        );
      },
      onStreamingResponseCompleted: (status) => {
        if (!settings.enableAfterScript) return;
        runResponseExtraction(
          {
            status,
            headers: {},
            rawText: '',
            kind: 'text',
            isStreaming: true,
          },
          'auto',
          false,
        );
      },
      diagnoseResponse: (completedResponse) => {
        const responseSchemaPreparation = prepareResponseBodySchemaEvaluation({
          document: swaggerDoc,
          operation,
          statusCode: completedResponse.status,
          contentType: completedResponse.contentType,
          body: completedResponse.rawText,
          session:
            currentSchemaEngineRef.current.status === 'ready' ? currentSchemaEngineRef.current.session : undefined,
        });
        if (responseSchemaPreparation.status === 'invalid-json') {
          setResponseSchemaDiagnostic({ status: 'invalid-json' });
        } else if (responseSchemaPreparation.status === 'unavailable') {
          setResponseSchemaDiagnostic({ status: 'unavailable', reason: 'reference-unavailable' });
        } else if (responseSchemaPreparation.status === 'ready') {
          const currentSchemaEngine = currentSchemaEngineRef.current;
          if (currentSchemaEngine.status !== 'ready') {
            setResponseSchemaDiagnostic(
              currentSchemaEngine.status === 'error'
                ? { status: 'unavailable', reason: 'engine-failed', message: currentSchemaEngine.error.message }
                : { status: 'unavailable', reason: 'engine-inactive' },
            );
          } else {
            const responseSchemaSession = currentSchemaEngine.session;
            const responseSchemaController = new AbortController();
            responseSchemaValidationAbortRef.current = responseSchemaController;
            setResponseSchemaDiagnostic({ status: 'running' });
            const isCurrentResponseSchemaEvaluation = () => {
              const latestSchemaEngine = currentSchemaEngineRef.current;
              return (
                !responseSchemaController.signal.aborted &&
                responseBodySchemaResultIsCurrent(
                  requestSeq,
                  requestSeqRef.current,
                  requestDebugCacheKey,
                  activeDebugCacheKeyRef.current,
                  responseSchemaSession,
                  latestSchemaEngine.status === 'ready' ? latestSchemaEngine.session : null,
                )
              );
            };

            void evaluateResponseBodySchema(responseSchemaSession, responseSchemaPreparation, {
              signal: responseSchemaController.signal,
            })
              .then((evaluation) => {
                if (!isCurrentResponseSchemaEvaluation()) return;
                setResponseSchemaDiagnostic(
                  evaluation.status === 'valid'
                    ? null
                    : {
                        status: 'invalid',
                        issues: evaluation.issues,
                        totalIssues: evaluation.totalIssues,
                      },
                );
              })
              .catch((reason: unknown) => {
                if (
                  isResponseBodySchemaEvaluationAborted(reason, responseSchemaController.signal) ||
                  !isCurrentResponseSchemaEvaluation()
                ) {
                  return;
                }
                setResponseSchemaDiagnostic(responseBodySchemaFailureDiagnostic(reason));
              })
              .finally(() => {
                if (responseSchemaValidationAbortRef.current === responseSchemaController) {
                  responseSchemaValidationAbortRef.current = null;
                }
              });
          }
        }
      },
      updates: {
        setLoading,
        setResponseProgress,
        setResponse,
        setError,
        setSseEvents,
        setSseStreaming,
        setSequentialStream,
      },
    });
  };

  const handleSseAbort = () => {
    sseAbortRef.current?.abort();
    sseAbortRef.current = null;
    setSseStreaming(false);
    setSequentialStream((previous) => (previous ? { ...previous, streaming: false } : previous));
  };

  const handleReset = () => {
    if (!initialDebugState || !debugModel || !operation || !swaggerDoc) return;
    schemaValidationRevisionRef.current += 1;
    schemaValidationAbortRef.current?.abort();
    schemaValidationAbortRef.current = null;
    setSchemaValidating(false);
    setPendingSchemaOverride(null);
    responseSchemaValidationAbortRef.current?.abort();
    responseSchemaValidationAbortRef.current = null;
    setResponseSchemaDiagnostic(null);
    handleSseAbort();
    if (settings.enableRequestCache && debugCacheKey !== null) {
      removeDebugCache(debugCacheKey);
      skipNextDebugCacheWriteRef.current = true;
    }
    if (debugCacheKey !== null) {
      removeDebugSessionState(debugCacheKey);
    }
    if (response?.objectUrl) {
      try {
        URL.revokeObjectURL(response.objectUrl);
      } catch {
        /* ignore */
      }
    }
    setDebugDefaultEditRevision(0);
    const resetState = buildInitialDebugState(debugModel, operation, swaggerDoc, defaultBaseUrl, bodyDefaults);
    applyInitialDebugState(resetState);
    appliedOas31ExampleIdentityRef.current = activeOas31Examples ? oas31ExampleIdentity : null;
    setLoading(false);
    setResponseProgress(null);
    setResponse(null);
    setError(null);
    setExtractionLog(null);
  };

  /** 复制请求预览内容到剪贴板 */
  const handleCopyPreviewText = (text: string) => {
    const done = () => message.success(t('apiDebug.preview.copied'));
    const fail = () => message.error(t('apiDebug.preview.copyFailed'));
    copyToClipboard(text, done, fail);
  };

  const headerNameOptions = (input: string) =>
    COMMON_HEADER_NAMES.filter((headerName) => headerName.toLowerCase().includes(input.toLowerCase())).map(
      (headerName) => ({
        value: headerName,
        label: headerName,
      }),
    );

  const previewBuilt = previewResult?.ok ? previewResult.value.built : undefined;
  const methodConstraint = operation.identity ? browserRequestConstraint(method, false) : null;
  const methodConstraintMessage =
    methodConstraint === 'normalized-method'
      ? t('apiDebug.method.browserNormalized', { method, normalized: method.toUpperCase() })
      : methodConstraint === 'unsupported-method'
        ? t('apiDebug.method.browserUnsupported', { method })
        : null;
  const injectedGlobalHeaders: InjectedGlobalParamRow[] = previewBuilt
    ? Object.entries(previewBuilt.headers)
        .filter(([name]) => {
          const source = previewBuilt.sourceMap?.headers[name];
          return source === 'application' || source === 'global';
        })
        .map(([name, value]) => ({
          key: `header:${name}`,
          name,
          value,
          source: previewBuilt.sourceMap!.headers[name] as 'application' | 'global',
          masked: findEffectiveParam('header', name, previewBuilt.sourceMap?.headers[name])?.masked === true,
        }))
    : [];
  const injectedGlobalQueries: InjectedGlobalParamRow[] = previewBuilt
    ? Object.entries(previewBuilt.query)
        .filter(([name]) => {
          const source = previewBuilt.sourceMap?.query[name];
          return source === 'application' || source === 'global';
        })
        .map(([name, value]) => ({
          key: `query:${name}`,
          name,
          value: displayQueryParamValue(value),
          source: previewBuilt.sourceMap!.query[name] as 'application' | 'global',
          masked: findEffectiveParam('query', name, previewBuilt.sourceMap?.query[name])?.masked === true,
        }))
    : [];

  // body tab 的标签含当前 content-type
  const bodyLabel =
    debugModel.bodyContents.length > 0 ? `${t('apiDebug.tab.body')} (${effectiveContentType})` : t('apiDebug.tab.body');
  const currentBodyExampleResult = activeOas31Examples?.resultByMediaType[selectedContentType];
  const bodyExampleLoading =
    isOas31 &&
    debugModel.bodyContents.length > 0 &&
    activeOas31Examples === null &&
    (schemaEngine.status === 'loading' ||
      (oas31ExampleState.status === 'loading' &&
        sameOas31DebugExampleIdentity(oas31ExampleState.identity, oas31ExampleIdentity)));

  const applyExample32 = (result: OperationExampleResult, revision: number) => {
    if (
      revision !== debugDefaultEditRevisionRef.current ||
      result.session !== exampleSession32 ||
      !exampleCatalog32 ||
      result.target.generation !== exampleCatalog32.generation ||
      !exampleCatalog32.targets.includes(result.target)
    )
      return;
    markDebugDefaultEdited();
    const key = result.target.parameterKey;
    if (key) {
      const entry = oas32ExampleParameterEntry(result, debugDefaultEditRevisionRef.current);
      setOas32ParameterEntries((previous) => {
        const next = { ...previous };
        if (entry) next[key] = entry;
        else delete next[key];
        return next;
      });
      setParamValues((previous) => ({ ...previous, [key]: entry?.text ?? '' }));
      setParamEnabled((previous) => ({ ...previous, [key]: !!entry }));
    } else if (result.target.group.startsWith('body:')) {
      const bodyContent = result.target.context.bodyContent;
      const isMultipartBody = bodyContent?.category === 'multipart';
      const authoredMultipart =
        Boolean(isOas32) &&
        isMultipartBody &&
        result.representation.fields.serializedValue &&
        result.representation.text !== undefined &&
        !result.representation.external &&
        result.representation.serialization !== 'invalid';
      const usable =
        result.representation.text !== undefined &&
        !result.representation.external &&
        result.representation.serialization !== 'invalid' &&
        !bodyContent?.binary &&
        !isMultipartBody;
      setSelectedContentType(result.target.mediaType ?? '');
      setFormPartContentTypes({});
      if (authoredMultipart) {
        setSerializedBodyMedia32(result.target.mediaType);
        setBody(result.representation.text!);
        setFormFields({});
      } else if (usable) {
        setSerializedBodyMedia32(result.target.mediaType);
        setBody(result.representation.text!);
        setFormFields({});
      } else if (isOas32 && isMultipartBody && result.representation.data !== undefined && bodyContent?.oas32Form) {
        setSerializedBodyMedia32(undefined);
        setBody('');
        setFormFields(oas32FormFieldsFromInstance(bodyContent.oas32Form, result.representation.data));
      } else {
        setSerializedBodyMedia32(undefined);
        setBody('');
        setFormFields({});
      }
      setRawMode(inferRawMode(bodyContent));
    }
  };
  const renderExamplePickers32 = (location: string) =>
    !exampleCatalog32
      ? null
      : [
          ...new Set(
            exampleCatalog32.targets
              .filter(
                (target) =>
                  target.direction === 'request' &&
                  (location === 'body'
                    ? target.group === `body:${selectedContentType}`
                    : target.parameterKey?.startsWith(`${location}:`)),
              )
              .map((target) => target.group),
          ),
        ].map((group) => (
          <OperationExamplePicker
            key={group}
            targets={exampleCatalog32.targets.filter((target) => target.group === group)}
            session={exampleSession32}
            snapshot={operation?.resourceSnapshot}
            operationToken={operation?.identity?.identity ?? operation?.key}
            onApply={applyExample32}
            editRevision={() => debugDefaultEditRevisionRef.current}
          />
        ));

  const pathParams = debugModel.pathParams.filter((param) => !param.readOnly);
  const queryParams = debugModel.queryParams.filter((param) => !param.readOnly);
  const headerParams = debugModel.headerParams.filter((param) => !param.readOnly);
  const cookieParams = debugModel.cookieParams.filter((param) => !param.readOnly);
  const querystringParameter = oas32QuerystringParameter(debugModel.oas32Parameters);
  const querystringMediaType = oas32QuerystringMediaType(querystringParameter);
  const querystringEntry = querystringParameter ? oas32ParameterEntries[querystringParameter.key] : undefined;
  const querystringKind = querystringEntry?.kind ?? (querystringMediaType?.includes('json') ? 'data' : 'media');
  const updateQuerystringEntry = (patch: Partial<Oas32ParameterEntry>) => {
    if (!querystringParameter) return;
    markDebugDefaultEdited();
    setOas32ParameterEntries((previous) => {
      const current = previous[querystringParameter.key];
      return {
        ...previous,
        [querystringParameter.key]: {
          kind: patch.kind ?? current?.kind ?? querystringKind,
          text: patch.text ?? current?.text ?? '',
          enabled: patch.enabled ?? current?.enabled ?? true,
          ...(current && 'data' in current ? { data: current.data } : {}),
        },
      };
    });
  };
  const querystringConflict =
    (previewResult?.ok === false && /querystring|QUERYSTRING_SOURCE_CONFLICT/i.test(previewResult.error)) ||
    (previewBuilt?.oas32ParameterPlan?.diagnostics.some(
      (diagnostic) => diagnostic.code === 'QUERYSTRING_SOURCE_CONFLICT',
    ) ??
      false);

  const parameterTableProps = {
    paramValues,
    paramEnabled,
    setParamEnabled: (next: React.SetStateAction<Record<string, boolean>>) => {
      markDebugDefaultEdited();
      setParamEnabled(next);
    },
    updateValue,
    effectiveCookieSource,
    declaredCookies: Boolean(isOas32),
    oas32ParameterEntries,
    errorKeys,
  };
  const tabItems = [
    {
      key: 'path',
      label: `${t('apiDebug.tab.path')} (${debugModel.pathParams.length})`,
      disabled: false,
      children: (
        <>
          {renderExamplePickers32('path')}
          <DebugParameterTable {...parameterTableProps} params={pathParams} emptyText={t('apiDebug.noPathParams')} />
        </>
      ),
    },
    {
      key: 'query',
      label: `${t('apiDebug.tab.query')} (${
        debugModel.queryParams.length +
        customQueryParams.filter((row) => row.name.trim()).length +
        injectedGlobalQueries.length
      })`,
      disabled: false,
      children: (
        <>
          {renderExamplePickers32('query')}
          {(queryParams.length > 0 || injectedGlobalQueries.length === 0) && (
            <DebugParameterTable
              {...parameterTableProps}
              params={queryParams}
              emptyText={t('apiDebug.noQueryParams')}
            />
          )}
          <InjectedGlobalParamsSection rows={injectedGlobalQueries} />
          <CustomParamsSection
            title={t('apiDebug.customQuery.title')}
            addLabel={t('apiDebug.customParams.add')}
            namePlaceholder={t('apiDebug.customQuery.namePlaceholder')}
            valuePlaceholder={t('apiDebug.customParams.valuePlaceholder')}
            rows={customQueryParams}
            onChange={setCustomQueryParams}
          />
          {querystringParameter && querystringConflict && (
            <Alert type="error" showIcon title={t('apiDebug.querystring.conflict')} style={{ marginTop: 12 }} />
          )}
        </>
      ),
    },
    ...(querystringParameter
      ? [
          {
            key: 'querystring',
            label: `${t('apiDebug.tab.querystring')} (1)`,
            disabled: false,
            children: (
              <Space orientation="vertical" style={{ width: '100%' }} size={12}>
                {renderExamplePickers32('querystring')}
                {querystringConflict && <Alert type="error" showIcon title={t('apiDebug.querystring.conflict')} />}
                <Space wrap>
                  <Checkbox
                    checked={querystringEntry?.enabled !== false}
                    onChange={(event) => updateQuerystringEntry({ enabled: event.target.checked })}
                  >
                    {t('apiDebug.querystring.title')}
                  </Checkbox>
                  {querystringMediaType && (
                    <Text type="secondary">
                      {t('apiDebug.querystring.mediaType', { mediaType: querystringMediaType })}
                    </Text>
                  )}
                </Space>
                <Alert type="info" showIcon title={t('apiDebug.querystring.emptyHint')} />
                <Radio.Group
                  value={querystringKind}
                  optionType="button"
                  options={[
                    { value: 'data', label: t('apiDebug.querystring.kind.data') },
                    { value: 'media', label: t('apiDebug.querystring.kind.media') },
                    { value: 'parameter', label: t('apiDebug.querystring.kind.parameter') },
                  ]}
                  onChange={(event) =>
                    updateQuerystringEntry({ kind: event.target.value as Oas32ParameterEntry['kind'] })
                  }
                />
                {querystringKind === 'data' ? (
                  <CodeEditor
                    ariaLabel={t('apiDebug.querystring.title')}
                    value={querystringEntry?.text ?? ''}
                    onChange={(next) => updateQuerystringEntry({ text: next, kind: 'data', enabled: true })}
                    language="json"
                  />
                ) : (
                  <Input.TextArea
                    aria-label={t('apiDebug.querystring.title')}
                    value={querystringEntry?.text ?? ''}
                    placeholder={t('apiDebug.querystring.placeholder.media')}
                    autoSize={{ minRows: 3, maxRows: 10 }}
                    onChange={(event) =>
                      updateQuerystringEntry({
                        text: event.target.value,
                        kind: querystringKind,
                        enabled: true,
                      })
                    }
                  />
                )}
              </Space>
            ),
          },
        ]
      : []),
    {
      key: 'header',
      label: `${t('apiDebug.tab.header')} (${
        debugModel.headerParams.length +
        customHeaders.filter((r) => r.name.trim()).length +
        injectedGlobalHeaders.length
      })`,
      disabled: false,
      children: (
        <>
          {renderExamplePickers32('header')}
          {(headerParams.length > 0 || injectedGlobalHeaders.length === 0) && (
            <DebugParameterTable
              {...parameterTableProps}
              params={headerParams}
              emptyText={
                debugModel.bodyContents.length > 0 ? t('apiDebug.header.autoInject') : t('apiDebug.noHeaderParams')
              }
            />
          )}
          <InjectedGlobalParamsSection rows={injectedGlobalHeaders} />
          <CustomParamsSection
            title={t('apiDebug.customHeaders.title')}
            addLabel={t('apiDebug.customParams.add')}
            namePlaceholder={t('apiDebug.customHeaders.namePlaceholder')}
            valuePlaceholder={t('apiDebug.customParams.valuePlaceholder')}
            rows={customHeaders}
            onChange={setCustomHeaders}
            nameOptions={headerNameOptions}
          />
        </>
      ),
    },
    {
      key: 'cookie',
      label: `${t('apiDebug.tab.cookie')} (${
        debugModel.cookieParams.length + customCookies.filter((row) => row.name.trim()).length
      })`,
      disabled: false,
      children: (
        <>
          {renderExamplePickers32('cookie')}
          {cookieSessionEnabled && (
            <Space orientation="vertical" style={{ width: '100%', marginBottom: 12 }}>
              <Space wrap>
                <Text strong>{t('apiDebug.cookie.source')}</Text>
                <Radio.Group
                  value={effectiveCookieSource}
                  optionType="button"
                  options={[
                    { value: 'browser-session', label: t('apiDebug.cookie.source.session') },
                    { value: 'explicit', label: t('apiDebug.cookie.source.explicit') },
                  ]}
                  onChange={(event) => {
                    setCookieParameterSource(event.target.value as CookieParameterSource);
                    setValidationErrors([]);
                    setError(null);
                  }}
                />
                <Link to={`/${encodeURIComponent(group ?? '')}/cookieSession`}>
                  {t('apiDebug.cookie.configureSession')}
                </Link>
                <Tag>
                  {t(
                    cookieSession.credentials === 'include'
                      ? 'globalParam.cookie.include'
                      : 'globalParam.cookie.sameOrigin',
                  )}
                </Tag>
              </Space>
              <Alert
                type="info"
                showIcon
                title={t(
                  effectiveCookieSource === 'browser-session'
                    ? 'apiDebug.cookie.sessionTip'
                    : 'apiDebug.cookie.explicitTip',
                )}
              />
            </Space>
          )}
          <DebugParameterTable
            {...parameterTableProps}
            params={cookieParams}
            emptyText={t('apiDebug.noCookieParams')}
          />
          {effectiveCookieSource !== 'browser-session' && (
            <CustomParamsSection
              title={t('apiDebug.customCookie.title')}
              addLabel={t('apiDebug.customParams.add')}
              namePlaceholder={t('apiDebug.customCookie.namePlaceholder')}
              valuePlaceholder={t('apiDebug.customParams.valuePlaceholder')}
              rows={customCookies}
              onChange={setCustomCookies}
            />
          )}
        </>
      ),
    },
    {
      key: 'body',
      label: bodyLabel,
      disabled: false,
      children: (
        <>
          {renderExamplePickers32('body')}
          {bodyExampleLoading && (
            <Alert
              type="info"
              showIcon
              title={t('schema.example.loading.title')}
              description={t('schema.example.loading.description')}
              style={{ marginBottom: 12 }}
            />
          )}
          {currentBodyExampleResult && (
            <SchemaExampleNotice result={currentBodyExampleResult} style={{ marginBottom: 12 }} />
          )}
          {serializedBodyMedia32 === selectedContentType ? (
            <Space orientation="vertical" style={{ width: '100%' }}>
              <Space>
                <Select
                  aria-label={t('apiDebug.body.contentType')}
                  value={selectedContentType}
                  options={debugModel.bodyContents.map((content) => ({
                    value: content.mediaType,
                    label: content.mediaType,
                  }))}
                  onChange={(media) => {
                    markDebugDefaultEdited();
                    setSelectedContentType(media);
                    const next = defaults32?.get(`body:${media}`);
                    const usable =
                      next?.representation.text !== undefined &&
                      next.representation.serialization !== 'invalid' &&
                      !next.representation.external &&
                      !next.target.context.bodyContent?.binary &&
                      next.target.context.bodyContent?.category !== 'multipart';
                    setSerializedBodyMedia32(usable ? media : undefined);
                    setBody(usable ? next.representation.text! : '');
                    setRawMode(inferRawMode(debugModel.bodyContents.find((content) => content.mediaType === media)));
                  }}
                />
                <Button
                  onClick={() => {
                    markDebugDefaultEdited();
                    setSerializedBodyMedia32(undefined);
                  }}
                >
                  {t('schema.example32.editFields')}
                </Button>
              </Space>
              <Typography.Text>{t('schema.example32.serialized')}</Typography.Text>
              <ResizableBox
                height={panelLayout.requestBodyHeight}
                defaultMaxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
                minHeight={DEBUG_PANEL_MIN_HEIGHT}
                maxHeight={DEBUG_PANEL_MAX_HEIGHT}
                onHeightChange={handleRequestBodyHeightChange}
                handleLabel={t('apiDebug.request.resizeHandle')}
                resetTitle={t('apiDebug.panel.resizeResetTitle')}
              >
                <CodeEditor
                  ariaLabel={t('apiDoc.requestBody')}
                  value={body}
                  onChange={setBodyFromUser}
                  language={bodyCategory === 'json' ? 'json' : 'text'}
                  height={panelLayout.requestBodyHeight !== undefined ? '100%' : undefined}
                  minHeight={DEBUG_PANEL_MIN_HEIGHT}
                  maxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
                />
              </ResizableBox>
            </Space>
          ) : (
            <BodyTab
              key={`${debugCacheKey}:${resetNonce}`}
              debugModel={debugModel}
              bodyDefaults={bodyDefaults}
              body={body}
              setBody={setBodyFromUser}
              selectedContentType={selectedContentType}
              setSelectedContentType={(media) => {
                markDebugDefaultEdited();
                setSelectedContentType(media);
                const next = defaults32?.get(`body:${media}`);
                if (
                  next?.representation.text !== undefined &&
                  next.representation.serialization !== 'invalid' &&
                  !next.representation.external &&
                  !next.target.context.bodyContent?.binary &&
                  next.target.context.bodyContent?.category !== 'multipart'
                )
                  setBody(next.representation.text);
                setSerializedBodyMedia32(
                  next?.representation.text !== undefined &&
                    next.representation.serialization !== 'invalid' &&
                    !next.representation.external &&
                    !next.target.context.bodyContent?.binary &&
                    next.target.context.bodyContent?.category !== 'multipart'
                    ? media
                    : undefined,
                );
              }}
              formFields={formFields}
              setFormFields={setFormFieldsFromUser}
              formPartHeaders={formPartHeaders}
              setFormPartHeaders={setFormPartHeadersFromUser}
              formPartContentTypes={formPartContentTypes}
              setFormPartContentTypes={setFormPartContentTypesFromUser}
              enableDynamicParameter={settings.enableDynamicParameter}
              customBodyParams={customBodyParams}
              setCustomBodyParams={setCustomBodyParams}
              setFileFields={setFileFields}
              setBinaryBodyFile={setBinaryBodyFile}
              rawMode={rawMode}
              setRawMode={setRawMode}
              bodyHeight={panelLayout.requestBodyHeight}
              onBodyHeightChange={handleRequestBodyHeightChange}
            />
          )}
        </>
      ),
    },
    {
      key: 'preview',
      label: t('apiDebug.tab.preview'),
      disabled: false,
      children: previewResult && (
        <PreviewTabPanel
          result={previewResult}
          onCopyText={handleCopyPreviewText}
          onDownloadMultipartBody={triggerMultipartBodyDownload}
        />
      ),
    },
    ...(settings.enableAfterScript
      ? [
          {
            key: 'extract',
            label: `${t('apiDebug.tab.extract')} (${extractionRules.filter((rule) => rule.enabled).length})`,
            disabled: false,
            children: (
              <DebugResponseExtractionPanel
                rules={extractionRules}
                persistenceFailed={extractionPersistenceFailed}
                currentResponseInput={currentResponseExtractionInput}
                extractionLog={extractionLog}
                onRulesChange={handleExtractionRulesChange}
                onApplyCurrentResponse={handleApplyExtractionNow}
              />
            ),
          },
        ]
      : []),
  ];

  const defaultTab =
    debugModel.pathParams.length > 0
      ? 'path'
      : querystringParameter
        ? 'querystring'
        : debugModel.queryParams.length > 0 || injectedGlobalQueries.length > 0
          ? 'query'
          : debugModel.headerParams.length > 0 || injectedGlobalHeaders.length > 0
            ? 'header'
            : debugModel.cookieParams.length > 0
              ? 'cookie'
              : debugModel.bodyContents.length > 0
                ? 'body'
                : 'preview';
  const currentActiveTab =
    activeTab && (activeTab !== 'extract' || settings.enableAfterScript) ? activeTab : defaultTab;
  const extractionSummary =
    settings.enableAfterScript && extractionLog ? summarizeResponseExtractionLog(extractionLog) : null;

  return (
    <OperationModeLayout activeKey="debug">
      <Modal
        open={pendingSchemaOverride !== null}
        title={t('apiDebug.schemaValidation.title')}
        okText={t('apiDebug.schemaValidation.stillSend')}
        cancelText={t('apiDebug.schemaValidation.backToEdit')}
        okButtonProps={{ danger: true }}
        onCancel={() => {
          schemaValidationRevisionRef.current += 1;
          const first = pendingSchemaOverride?.issues[0];
          setPendingSchemaOverride(null);
          if (first) {
            setActiveTab(first.target === 'body' ? 'body' : first.in === 'querystring' ? 'querystring' : first.in);
            setRequestCollapsed(false);
          }
        }}
        onOk={() => {
          const pending = pendingSchemaOverride;
          if (!pending) return;
          const consumedRevision = consumeRequestBodySchemaOverride(
            pending.revision,
            schemaValidationRevisionRef.current,
            pending.debugCacheKey,
            activeDebugCacheKeyRef.current,
          );
          if (consumedRevision === null) {
            setPendingSchemaOverride(null);
            return;
          }
          // Consume the confirmation before dispatch so a repeated click cannot
          // reuse the same one-shot override.
          schemaValidationRevisionRef.current = consumedRevision;
          setPendingSchemaOverride(null);
          void handleSend({
            prepared: pending.preview,
            skipSchemaValidation: true,
            validationRevision: consumedRevision,
            validationDebugCacheKey: pending.debugCacheKey,
          });
        }}
      >
        <div id="knife4j-schema-validation-dialog">
          <Paragraph>{t('apiDebug.schemaValidation.description')}</Paragraph>
          {pendingSchemaOverride ? (
            <>
              <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                {pendingSchemaOverride.issues.map((issue, index) => {
                  const location = issue.target === 'body' ? 'requestBody' : `${issue.in}:${issue.name}`;
                  if (issue.kind === 'required-parameter') {
                    return (
                      <li key={`required:${location}:${index}`} style={{ marginBottom: 6 }}>
                        <Text code>{location}</Text>{' '}
                        <Text>{t('apiDebug.schemaValidation.issue', { keyword: 'required' })}</Text>
                      </li>
                    );
                  }
                  if (issue.kind === 'invalid-json') {
                    return (
                      <li key={`${issue.target}:${location}:json:${index}`} style={{ marginBottom: 6 }}>
                        <Text code>{location}</Text>{' '}
                        <Text>
                          {issue.target === 'body'
                            ? t('apiDebug.schemaValidation.invalidJson')
                            : t('apiDebug.schemaValidation.parameterInvalidJson')}
                        </Text>
                      </li>
                    );
                  }
                  if (issue.kind === 'unsafe-number') {
                    return (
                      <li key={`${issue.target}:${location}:number:${index}`} style={{ marginBottom: 6 }}>
                        <Text code>{location}</Text> <Text>{t('apiDebug.schemaValidation.parameterUnsafeNumber')}</Text>
                      </li>
                    );
                  }
                  if (issue.kind === 'form-body') {
                    const formLocation =
                      [issue.fieldName, issue.headerName].filter(Boolean).join(' / ') || 'requestBody';
                    return (
                      <li key={`body:${formLocation}:${issue.code}:${index}`} style={{ marginBottom: 6 }}>
                        <Text code>{formLocation}</Text> <Text>{t(`apiDebug.formDiagnostic.${issue.code}`)}</Text>
                      </li>
                    );
                  }
                  const instanceLocation =
                    issue.target === 'body'
                      ? requestBodyInstanceLabel(issue.instanceLocation)
                      : parameterInstanceLabel(issue.instanceLocation);
                  return (
                    <li
                      key={`${issue.target}:${location}:${issue.instanceLocation}:${issue.absoluteKeywordLocation}:${index}`}
                      style={{ marginBottom: 6 }}
                    >
                      <Text code>{location}</Text> <Text code>{instanceLocation}</Text>{' '}
                      <Text>{t('apiDebug.schemaValidation.issue', { keyword: issue.keyword })}</Text>
                    </li>
                  );
                })}
              </ul>
              {pendingSchemaOverride.totalIssues > pendingSchemaOverride.issues.length && (
                <Text type="secondary">
                  {t('apiDebug.schemaValidation.moreIssues', {
                    count: pendingSchemaOverride.totalIssues - pendingSchemaOverride.issues.length,
                  })}
                </Text>
              )}
            </>
          ) : null}
        </div>
      </Modal>
      {/* Peer columns: main debug + history share one surface (no floating overlay). */}
      <div
        id="knife4j-api-debug-page"
        style={{
          display: 'flex',
          alignItems: 'stretch',
        }}
      >
        <div
          className="knife4j-api-debug-main"
          style={{ flex: 1, minWidth: 0, paddingRight: settings.enableRequestHistory ? 16 : 0 }}
        >
          <Space align="center" className="knife4j-debug-heading">
            <Tag color={METHOD_COLORS[method] ?? 'default'} style={{ fontSize: 14, padding: '2px 8px' }}>
              {method}
            </Tag>
            <Title level={1} style={{ margin: 0, fontSize: 16 }}>
              {operation.operation.summary ?? operation.path}
            </Title>
          </Space>

          {pathDiagnostics32.map((diagnostic) => (
            <Alert
              key={`${diagnostic.code}:${diagnostic.path}`}
              type="warning"
              title={diagnostic.code}
              description={`${diagnostic.path}: ${diagnostic.reason}`}
              style={{ marginBottom: 8 }}
            />
          ))}
          {methodConstraintMessage && (
            <Alert type="warning" showIcon title={methodConstraintMessage} style={{ marginBottom: 12 }} />
          )}
          {isOas32 && (
            <div className="knife4j-server-selection">
              <Select
                aria-label={t('oas32.server.select')}
                value={server32.key || undefined}
                onChange={server32.select}
                style={{ width: '100%' }}
                options={[
                  ...(server32.declarations?.resolutions.map((server, index) => ({
                    value: server.source.key,
                    label: `${server.name ?? `Server ${index + 1}`} · ${server.rawUrl ?? t('oas32.server.unavailable')}`,
                  })) ?? []),
                  ...server32.overrides.map((override) => ({
                    value: override.key,
                    label: t(`oas32.server.override.${override.source}`),
                  })),
                ]}
              />
              {server32.override === 'custom' && (
                <Input
                  aria-label={t('oas32.server.customUrl')}
                  value={server32.custom}
                  onChange={(event) => server32.setCustom(event.target.value)}
                />
              )}
              {!server32.override &&
                server32.resolved?.variables.map((variable) => (
                  <label className="knife4j-server-variable" key={variable.name}>
                    <span>{variable.name}</span>
                    {variable.enum ? (
                      <Select
                        aria-label={variable.name}
                        value={variable.value}
                        options={variable.enum.map((value) => ({ value, label: value }))}
                        onChange={(value) => server32.setVariable(variable.name, value)}
                      />
                    ) : (
                      <Input
                        aria-label={variable.name}
                        value={variable.value ?? ''}
                        onChange={(event) => server32.setVariable(variable.name, event.target.value)}
                      />
                    )}
                  </label>
                ))}
              {server32.resolved ? (
                <Collapse
                  ghost
                  size="small"
                  defaultActiveKey={server32.resolved.diagnostics.length > 0 ? ['details'] : []}
                  items={[
                    {
                      key: 'details',
                      label: t('oas32.server.details'),
                      children: <Oas32ServerDetails server={server32.resolved} override={server32.override} />,
                    },
                  ]}
                />
              ) : (
                <Alert
                  type="warning"
                  title={t('oas32.server.unavailable')}
                  description={server32.declarations?.diagnostics
                    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.reason}`)
                    .join('; ')}
                />
              )}
            </div>
          )}
          {isOas32 && security32 && (
            <div style={{ marginBottom: 12 }}>
              {security32.plan.branches.length > 1 && (
                <Radio.Group
                  value={security32.plan.selectedIndex ?? 0}
                  onChange={(event) => setSecurityBranchIndex(Number(event.target.value))}
                  style={{ marginBottom: 8 }}
                >
                  {security32.plan.branches.map((branch) => (
                    <Radio.Button key={branch.index} value={branch.index}>
                      {branch.anonymous
                        ? t('apiDebug.security.anonymous')
                        : t('apiDebug.security.branch', { n: branch.index + 1 })}
                    </Radio.Button>
                  ))}
                </Radio.Group>
              )}
              <Alert
                type={
                  security32.projection.status !== 'ready' ? 'error' : security32.plan.complete ? 'info' : 'warning'
                }
                showIcon
                title={
                  security32.projection.status !== 'ready'
                    ? t('apiDebug.security.unavailable')
                    : security32.projection.declaration === 'empty'
                      ? t('apiDebug.security.empty')
                      : security32.plan.branches[security32.plan.selectedIndex ?? 0]?.anonymous
                        ? t('apiDebug.security.anonymousSelected')
                        : security32.plan.complete
                          ? t('apiDebug.security.selected')
                          : t('apiDebug.security.incomplete')
                }
              />
            </div>
          )}
          <Space.Compact className="knife4j-debug-request" style={{ width: '100%', display: 'flex' }}>
            <Select
              aria-label={t('apiDebug.requestMethod')}
              value={method}
              onChange={setMethod}
              style={{ width: 110, flex: '0 0 110px' }}
              options={Array.from(
                new Set([
                  ...(operation.identity ? [operationHttpMethod(operation), 'QUERY'] : []),
                  ...DEBUG_HTTP_METHODS,
                ]),
              ).map((item) => ({
                value: item,
                label: item,
              }))}
            />
            {isOas32 ? (
              <Input
                aria-label={t('oas32.server.request')}
                value={baseUrl}
                readOnly
                style={{ flex: '0 1 420px', minWidth: 0 }}
              />
            ) : (
              <AutoComplete
                aria-label={t('oas32.server.request')}
                value={baseUrl}
                title={baseUrl}
                onChange={setBaseUrl}
                options={requestServerSelectOptions}
                filterOption={false}
                style={{ flex: '0 1 420px', minWidth: 0 }}
              />
            )}
            <Input
              aria-label={t('apiDebug.requestPath')}
              value={displayPath}
              title={displayPath}
              onChange={(event) => handlePathInputChange(event.target.value)}
              style={{ flex: '1 1 220px', minWidth: 0 }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => void handleSend()}
              disabled={!previewResult || Boolean(methodConstraintMessage) || (isOas32 && serverOrPathUnavailable32)}
              loading={loading || schemaValidating}
            >
              {t('apiDebug.send')}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                if (isOas32) server32.reset();
                handleReset();
              }}
            >
              {t('apiDebug.reset')}
            </Button>
          </Space.Compact>

          {requestCollapsed ? (
            <div
              data-request-collapsed-bar=""
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '6px 12px',
                background: '#fafafa',
                border: '1px solid #f0f0f0',
                borderRadius: 6,
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('apiDebug.request.collapsedSummary')}
              </Text>
              <Button
                size="small"
                type="text"
                icon={<DownOutlined />}
                aria-expanded={false}
                aria-controls={requestSectionId}
                data-request-collapse-toggle=""
                onClick={() => setRequestCollapsed(false)}
                style={{ flexShrink: 0 }}
              >
                {t('apiDebug.request.expand')}
              </Button>
            </div>
          ) : (
            <div id={requestSectionId} data-request-section="">
              <Tabs
                tabListLabel={t('apiDebug.tabs.label')}
                activeKey={currentActiveTab}
                defaultActiveKey={defaultTab}
                onChange={(key) => setActiveTab(key)}
                size="small"
                tabBarExtraContent={{
                  right: (
                    <Button
                      size="small"
                      type="text"
                      icon={<UpOutlined />}
                      aria-expanded={true}
                      aria-controls={requestSectionId}
                      data-request-collapse-toggle=""
                      onClick={() => setRequestCollapsed(true)}
                    >
                      {t('apiDebug.request.collapse')}
                    </Button>
                  ),
                }}
                items={tabItems}
              />
            </div>
          )}

          <Divider style={{ margin: '12px 0' }} />

          {extractionSummary && (currentActiveTab !== 'extract' || requestCollapsed) && (
            <Alert
              type={extractionSummary.type}
              showIcon
              title={t(extractionSummary.key, extractionSummary.params)}
              action={
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    setRequestCollapsed(false);
                    setActiveTab('extract');
                  }}
                >
                  {t('apiDebug.extract.viewLog')}
                </Button>
              }
              style={{ marginBottom: 12 }}
            />
          )}

          <DebugResponseSection
            loading={loading}
            responseProgress={responseProgress}
            response={response}
            error={error}
            builtRequest={builtRequest}
            builtRequestCookieSource={builtRequestCookieSource}
            operation={operation}
            swaggerDoc={swaggerDoc}
            sseEvents={sseEvents}
            sequentialStream={sequentialStream}
            onSseAbort={handleSseAbort}
            sseStreaming={sseStreaming}
            schemaDiagnostic={responseSchemaDiagnostic}
            bodyHeight={panelLayout.responseBodyHeight}
            onBodyHeightChange={handleResponseBodyHeightChange}
          />
        </div>

        {settings.enableRequestHistory && (
          <DebugHistoryPanel
            entries={historyEntries}
            onApply={handleApplyHistory}
            onRemove={handleRemoveHistory}
            onClear={handleClearHistory}
          />
        )}
      </div>
    </OperationModeLayout>
  );
}

// TASK-120-16
