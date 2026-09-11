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
  type Oas32ParameterEntries,
  type Oas32ParameterEntry,
  type Oas32ParameterSchemaIssue,
} from '../../schema/oas32ParameterAdapter';
import {
  collectResolvedOas32ParameterInputs,
  editableOas32ParameterEntries,
  oas32DiagnosticMessages,
  oas32PreviewDiagnostics,
  oas32QuerystringMediaType,
  oas32QuerystringParameter,
  previewOas32DisplayPath,
  restoreOas32ParameterEntries,
  serializedExampleParameterForKey,
  serializedExampleParametersFromEntries,
} from './oas32ParameterForm';
import { useOperationExampleDefaults } from '../../schema/useOperationExampleDefaults';
import { operationSchemaDocuments } from '../../schema/operationRegistry';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Checkbox,
  Divider,
  Input,
  InputNumber,
  message,
  Modal,
  Progress,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import type {
  BodyContent,
  BuiltRequest,
  DebugFormValues,
  DebugParam,
  FormBodyDiagnostic,
  FormBodyEncodingPlan,
  GlobalParamValues,
  OperationDebugModel,
  ParameterInputDiagnostic,
  ParamSource,
  QueryParamValue,
  SchemeValue,
  ValidationError,
} from 'knife4j-core';
import {
  OPENAPI_HTTP_METHODS,
  buildOperationDebugModel,
  buildRequest as coreBuildRequest,
  replacePathParams,
  replaceSerializedPathParams,
  serializeOas31Parameters,
  validateRequired,
  type Oas32ParameterDiagnostic,
  oas32FormFieldsFromInstance,
} from 'knife4j-core';
import { OperationModeLayout, useCurrentOperation } from './useCurrentOperation';
import CodeEditor, { type CodeEditorLanguage } from '../../components/CodeEditor';
import DescriptionText from '../../components/DescriptionText';
import RevealableValue from '../../components/RevealableValue';
import SchemaExampleNotice from '../../components/schema/SchemaExampleNotice';
import { useAuth } from '../../context/AuthContext';
import { useGroup } from '../../context/GroupContext';
import { useGlobalParam, type GlobalParamScope, type ScopedGlobalParamItem } from '../../context/GlobalParamContext';
import { useSchemaEngine } from '../../context/SchemaEngineContext';
import { useSettings } from '../../context/SettingsContext';
import { applyRouteProxyHeader } from '../../api/routeProxyHeader';
import ResponsePanel, { type DebugResponsePayload, type SseEvent } from './ResponsePanel';
import { COMMON_HEADER_NAMES } from '../../constants/httpHeaders';
import {
  currentOrigin,
  resolveRequestBaseUrl,
  resolveRequestServerOptions,
  type RequestServerSource,
} from './requestBaseUrl';
import {
  DEBUG_CACHE_VERSION,
  readDebugCache,
  removeDebugCache,
  writeDebugCache,
  type DebugCacheCustomParamRow,
  type DebugCacheRawMode,
  type DebugCacheState,
} from './debugCache';
import {
  DEBUG_HISTORY_MASK,
  abortEntry,
  appendPending,
  buildMultipartHistoryBody,
  buildOas31MultipartHistoryBody,
  clearHistory,
  completeEntry,
  createPendingEntry,
  isSensitiveHeaderName,
  listHistory,
  removeEntry,
  updateEntry,
  type DebugHistoryEntry,
  type DebugHistoryFormSnapshot,
} from './debugHistory';
import DebugHistoryPanel from './DebugHistoryPanel';
import { formatSseHistoryResponseBody } from './sseEventTime';
import {
  displayQueryParamValue,
  enumParamSelectMode,
  enumParamSelectOptions,
  enumParamSelectValue,
  isEnumParamSelectSupported,
  queryParamRequestValue,
  serializeEnumParamSelection,
} from './enumParamValue';
import { readDebugSessionState, removeDebugSessionState, writeDebugSessionState } from './debugSessionState';
import {
  buildRequestPreviewSafely,
  buildPreviewCurl,
  formatRequestPreviewBody,
  resolveSendPreview,
  triggerMultipartBodyDownload,
  type RequestPreviewBuild,
  type RequestPreviewBuildResult,
} from './requestPreviewBuild';
import { copyToClipboard } from '../../utils/clipboard';
import {
  EMPTY_BODY_CONTENT_DEFAULTS,
  buildBodyContentDefaults,
  buildInitialParamValues,
  extractSchemaFields,
  extraPositionalSchemaFields,
  initialBodyValueForContent,
  initialFormFieldsForContent,
  initialFormPartHeadersForContent,
  mergeCachedFormFields,
  mergeCachedFormPartHeaders,
  paramKey,
  stringifyDebugValue,
  type BodyContentDefaults,
  type ParamValueMap,
  type SchemaFieldRow,
} from './debugDefaultValues';
import { multipartPlanNeedsEncodedEnvelope, reuseMaterializedMultipartBody } from './formBodyRequest';
import { API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS, apiDebugParamTableScrollX } from './apiDebugParamTableLayout';
import { resolveApiDebugParamSelection, setApiDebugParamsEnabled } from './apiDebugParamSelection';
import {
  buildInitialParamEnabled,
  collectOas31ParameterValues,
  filterRequiredErrorsForCookieSource,
  isBrowserSessionParameter,
  isNullableOas31Parameter,
  isOas31RequiredParameterError,
} from './oas31ParameterForm';
import { effectiveCookieParameterSource, type CookieParameterSource } from './cookieParameterSource';
import { formatByteSize, readResponseBlob, type ResponseBodyProgress } from './responseBodyProgress';
import { customRowsToRecord, mergeCustomBodyParams, reservedBodyFieldNames } from './customParamRows';
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
import { isOas31SchemaDocument } from '../../schema/schemaDocumentSession';
import {
  emptyOas31BodyContentDefaults,
  sameOas31DebugExampleIdentity,
  unavailableOas31DebugBodyExamples,
  type Oas31DebugExampleIdentity,
  type Oas31DebugExampleState,
} from './oas31DebugExamples';
import { Oas31DebugDefaultHydrator, Oas31DebugExampleLoader } from './Oas31DebugExampleEffects';

const { TextArea } = Input;
const { Paragraph, Text, Title } = Typography;
const PARAM_TABLE_SCROLL = { x: apiDebugParamTableScrollX() };

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

const METHOD_COLORS: Record<string, string> = {
  GET: 'green',
  POST: 'blue',
  PUT: 'orange',
  DELETE: 'red',
  PATCH: 'purple',
  HEAD: 'cyan',
  OPTIONS: 'default',
  TRACE: 'magenta',
};

// ─── Response body classification ─────────────────────

/**
 * Map a response blob + Content-Type into a representation the
 * ResponsePanel can render directly. Text-friendly payloads are always
 * decoded into `rawText` so the Raw tab can show something even for
 * image / binary responses that choose to embed ASCII.
 */
/**
 * Parse filename from Content-Disposition header.
 * Supports both `filename*=UTF-8''...` (RFC 5987) and plain `filename=...` forms.
 */
function parseContentDispositionFilename(header: string): string | undefined {
  if (!header) return undefined;

  // RFC 5987: filename*=UTF-8''encoded%20name
  const rfc5987Match = header.match(/filename\*\s*=\s*([^']*)'[^']*'([^;,\s]+)/i);
  if (rfc5987Match) {
    try {
      return decodeURIComponent(rfc5987Match[2]);
    } catch {
      // fall through to plain filename
    }
  }

  // Plain: filename="foo.xlsx" or filename=foo.xlsx
  const plainMatch = header.match(/filename\s*=\s*"?([^";,\s]+)"?/i);
  if (plainMatch) {
    return plainMatch[1];
  }

  return undefined;
}

async function interpretResponseBlob(
  blob: Blob,
  contentType: string,
  requestUrl: string,
  contentDisposition?: string,
): Promise<{
  kind: DebugResponsePayload['kind'];
  rawText: string;
  objectUrl?: string;
  filename?: string;
}> {
  const ct = (contentType || '').toLowerCase();

  // Content-Disposition: attachment → treat as binary download regardless of content-type
  const isAttachment = contentDisposition ? /attachment/i.test(contentDisposition) : false;
  const cdFilename = contentDisposition ? parseContentDispositionFilename(contentDisposition) : undefined;

  if (isAttachment) {
    const filename = cdFilename ?? extractFilenameFromUrl(requestUrl) ?? 'download';
    return {
      kind: 'binary',
      rawText: '',
      objectUrl: URL.createObjectURL(blob),
      filename,
    };
  }

  // image/* → inline preview via object URL, keep rawText empty (binary)
  if (ct.startsWith('image/')) {
    return { kind: 'image', rawText: '', objectUrl: URL.createObjectURL(blob) };
  }

  // application/json (and *+json variants) → JSON text
  if (ct.includes('json')) {
    const rawText = await blob.text();
    return { kind: 'json', rawText };
  }

  // Anything text-like: text/plain, text/html, application/javascript, application/xml, text/xml, etc.
  if (ct.startsWith('text/') || ct.includes('javascript') || ct.includes('xml') || ct.includes('yaml')) {
    const rawText = await blob.text();
    return { kind: 'text', rawText };
  }

  // Empty Content-Type: fall back to text interpretation for robustness
  if (!ct) {
    const rawText = await blob.text();
    return { kind: rawText ? 'text' : 'binary', rawText };
  }

  // Binary payload (pdf, octet-stream, zip, xlsx, ...) → download link.
  const filename = cdFilename ?? extractFilenameFromUrl(requestUrl) ?? 'download';
  return {
    kind: 'binary',
    rawText: '',
    objectUrl: URL.createObjectURL(blob),
    filename,
  };
}

/** Best-effort filename from a URL path's last segment, dropping query/hash. */
function extractFilenameFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.href);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return last || undefined;
  } catch {
    return undefined;
  }
}

// ─── Raw mode types ───────────────────────────────────

const RAW_MODES = [
  { value: 'text', label: 'Text(text/plain)' },
  { value: 'json', label: 'JSON(application/json)' },
  { value: 'javascript', label: 'JavaScript(application/javascript)' },
  { value: 'xml', label: 'XML(application/xml)' },
  { value: 'html', label: 'HTML(text/html)' },
] as const satisfies ReadonlyArray<{ value: DebugCacheRawMode; label: string }>;

type RawMode = DebugCacheRawMode;

/** raw mode → Content-Type 映射 */
const RAW_CONTENT_TYPES: Record<RawMode, string> = {
  text: 'text/plain',
  json: 'application/json',
  javascript: 'application/javascript',
  xml: 'application/xml',
  html: 'text/html',
};

const HTML_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function formatJsonBody(value: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return undefined;
  }
}

function formatTaggedBody(value: string, mode: 'xml' | 'html'): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  // For XML, use DOMParser to validate well-formedness (existing behaviour).
  // For HTML, also use DOMParser as a safety net: if the content parses as
  // HTML without a <parsererror> body child, we can safely reformat it.
  // If parsing fails, the content likely contains bare < or > in text/script/attribute
  // contexts that would be corrupted by naive tokenisation — return undefined so
  // the caller leaves the body untouched (see ChatGPT review on PR #357).
  if (typeof DOMParser !== 'undefined') {
    const mimeType = mode === 'xml' ? 'application/xml' : 'text/html';
    const doc = new DOMParser().parseFromString(trimmed, mimeType);
    if (mode === 'xml') {
      // XML mode: parsererror element indicates malformed markup.
      if (doc.getElementsByTagName('parsererror').length > 0) return undefined;
    } else {
      // HTML mode: DOMParser always succeeds, but <parsererror> in the parsed
      // body signals real parse failure for our purposes.
      const pe = doc.querySelector('parsererror');
      if (pe && pe.textContent && pe.textContent.trim().length > 0) {
        // Check whether the error is substantive (not just a warning about
        // harmless HTML quirks). A real failure means we should not reformat.
        const errorText = pe.textContent.trim();
        if (/unable to parse|fatal|syntax|error/i.test(errorText)) return undefined;
      }
    }
  }

  // Improved tokenisation: split on tag boundaries while preserving angle
  // brackets that appear inside text content (e.g. "if (a < b)" in scripts,
  // or "a > b" in attribute values). The regex matches:
  //   - complete tags:       </tag>, <tag>, <tag/>, <?...?>, <!...>
  //   - NOT bare < or > that are part of text content
  // eslint-disable-next-line no-useless-escape
  const tagSplitRe = /(<\/?[A-Za-z][^>]*>|<\?[^\?]*\?>|<!\[CDATA\[[\s\S]*?]]>)/;
  const parts = trimmed.split(tagSplitRe);

  let indent = 0;
  const lines: string[] = [];
  let currentLine = '';

  for (const part of parts) {
    if (!part) continue;

    const isClosingTag = /^<\//.test(part);
    const isDeclaration = /^<\?/.test(part) || /^<!/.test(part);
    const tagMatch = part.match(/^<([A-Za-z][^\s/>]*)/);
    const tagName = tagMatch?.[1].toLowerCase();
    const isVoidTag = mode === 'html' && tagName !== undefined && HTML_VOID_TAGS.has(tagName);
    const isSelfClosing = /\/>$/.test(part) || isVoidTag;
    const isOpeningTag = /^<[A-Za-z]/.test(part) && !isClosingTag && !isDeclaration && !isSelfClosing;

    if (isClosingTag) indent = Math.max(indent - 1, 0);

    if (isOpeningTag || isSelfClosing || isClosingTag || isDeclaration) {
      // Flush any accumulated text content before handling a tag
      if (currentLine.trim()) {
        lines.push(`${'  '.repeat(indent)}${currentLine.trim()}`);
        currentLine = '';
      }
      lines.push(`${'  '.repeat(indent)}${part}`);
      if (isOpeningTag && !isDeclaration) indent += 1;
    } else {
      // Text content: accumulate on the current line (preserves inline < >)
      currentLine += part;
    }
  }

  // Flush any remaining text content
  if (currentLine.trim()) {
    lines.push(`${'  '.repeat(indent)}${currentLine.trim()}`);
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}

function formatJavaScriptBody(value: string): string | undefined {
  const input = value.trim();
  if (!input) return input;

  let indent = 0;
  let output = '';
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let invalid = false;

  const appendIndent = () => {
    output += '  '.repeat(indent);
  };
  const appendNewline = () => {
    output = output.trimEnd();
    output += '\n';
    appendIndent();
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (lineComment) {
      output += char;
      if (char === '\n') {
        lineComment = false;
        appendIndent();
      }
      continue;
    }

    if (blockComment) {
      output += char;
      if (char === '*' && next === '/') {
        output += next;
        i += 1;
        blockComment = false;
      }
      continue;
    }

    if (quote) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      output = output.trimEnd();
      output += output.endsWith('\n') ? '//' : ' //';
      i += 1;
      lineComment = true;
      continue;
    }

    if (char === '/' && next === '*') {
      output = output.trimEnd();
      output += output.endsWith('\n') ? '/*' : ' /*';
      i += 1;
      blockComment = true;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      output += char;
      continue;
    }

    if (char === '{') {
      output = output.trimEnd();
      output += ' {\n';
      indent += 1;
      appendIndent();
      continue;
    }

    if (char === '}') {
      output = output.trimEnd();
      if (indent === 0) {
        invalid = true;
      } else {
        indent -= 1;
      }
      output += `\n${'  '.repeat(indent)}}`;
      if (next !== ';' && next !== ',' && next !== ')' && next !== undefined) {
        appendNewline();
      }
      continue;
    }

    if (char === ';') {
      output = output.trimEnd();
      output += ';';
      if (next !== undefined) appendNewline();
      continue;
    }

    if (char === ',') {
      output = output.trimEnd();
      output += ', ';
      continue;
    }

    if (/\s/.test(char)) {
      if (output && !/\s$/.test(output)) output += ' ';
      continue;
    }

    output += char;
  }

  if (invalid || quote || blockComment || indent !== 0) return undefined;

  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.trim() || index === lines.length - 1)
    .join('\n')
    .trim();
}

function formatBodyByRawMode(value: string, mode: RawMode): string | undefined {
  if (mode === 'json') return formatJsonBody(value);
  if (mode === 'xml' || mode === 'html') return formatTaggedBody(value, mode);
  if (mode === 'javascript') return formatJavaScriptBody(value);
  return undefined;
}

// ─── Custom headers section ───────────────────────────

type CustomParamRow = DebugCacheCustomParamRow;

interface CustomParamsSectionProps {
  title: string;
  addLabel: string;
  namePlaceholder: string;
  valuePlaceholder: string;
  rows: CustomParamRow[];
  onChange: (rows: CustomParamRow[]) => void;
  nameOptions?: (input: string) => Array<{ value: string; label: string }>;
}

function CustomParamsSection({
  title,
  addLabel,
  namePlaceholder,
  valuePlaceholder,
  rows,
  onChange,
  nameOptions,
}: CustomParamsSectionProps) {
  const { t } = useTranslation();

  const updateRow = (id: string, field: 'name' | 'value', val: string) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, [field]: val } : row)));
  };

  const deleteRow = (id: string) => {
    onChange(rows.filter((row) => row.id !== id));
  };

  const addRow = () => {
    onChange([...rows, { id: `custom-${Date.now()}`, name: '', value: '' }]);
  };

  return (
    <div style={{ marginTop: 16 }}>
      <Table
        bordered
        size="small"
        pagination={false}
        dataSource={rows}
        rowKey="id"
        tableLayout="fixed"
        title={() => (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text strong>{title}</Text>
            <Button size="small" icon={<PlusOutlined />} onClick={addRow}>
              {addLabel}
            </Button>
          </div>
        )}
        columns={[
          {
            title: t('apiDebug.col.paramName'),
            dataIndex: 'name',
            key: 'name',
            width: 240,
            render: (_name: string, row: CustomParamRow) => (
              <AutoComplete
                size="small"
                value={row.name}
                options={nameOptions?.(row.name)}
                onChange={(val) => updateRow(row.id, 'name', val)}
                onSelect={(val) => updateRow(row.id, 'name', val)}
                placeholder={namePlaceholder}
                style={{ width: '100%' }}
                filterOption={false}
              />
            ),
          },
          {
            title: t('apiDebug.col.value'),
            dataIndex: 'value',
            key: 'value',
            render: (_value: string, row: CustomParamRow) => (
              <Input
                size="small"
                value={row.value}
                onChange={(event) => updateRow(row.id, 'value', event.target.value)}
                placeholder={valuePlaceholder}
              />
            ),
          },
          {
            title: t('apiDebug.col.action'),
            key: 'action',
            width: 72,
            align: 'center',
            render: (_value: unknown, row: CustomParamRow) => (
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => deleteRow(row.id)} />
            ),
          },
        ]}
        locale={{ emptyText: t('apiDebug.customParams.empty') }}
      />
    </div>
  );
}

// ─── Param input dispatcher ───────────────────────────

interface ParamInputProps {
  param: DebugParam;
  value: string;
  onChange: (next: string) => void;
  hasError?: boolean;
}

function ParamInput({ param, value, onChange, hasError }: ParamInputProps) {
  const { t } = useTranslation();
  const status = hasError ? ('error' as const) : undefined;
  // enum → Select
  if (param.enum && param.enum.length > 0 && isEnumParamSelectSupported(param)) {
    return (
      <Select
        size="small"
        mode={enumParamSelectMode(param)}
        value={enumParamSelectValue(param, value)}
        onChange={(next) => onChange(serializeEnumParamSelection(param, next))}
        allowClear
        showSearch
        optionFilterProp="label"
        status={status}
        placeholder={t('apiDebug.enum.placeholder')}
        options={enumParamSelectOptions(param)}
        style={{ width: '100%' }}
      />
    );
  }

  if (param.type === 'boolean' && isNullableOas31Parameter(param)) {
    return (
      <Select
        size="small"
        value={value || undefined}
        onChange={(next) => onChange(next)}
        allowClear
        status={status}
        placeholder={t('apiDebug.enum.placeholder')}
        options={[
          { value: 'true', label: 'true' },
          { value: 'false', label: 'false' },
          { value: 'null', label: 'null' },
        ]}
        style={{ width: '100%' }}
      />
    );
  }

  // boolean → Switch（配合隐藏的字符串值 'true'/'false'）
  if (param.type === 'boolean') {
    const checked = value === 'true';
    return (
      <Space size="small">
        <Switch size="small" checked={checked} onChange={(next) => onChange(next ? 'true' : 'false')} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {checked ? 'true' : 'false'}
        </Text>
      </Space>
    );
  }

  // integer / number → Input; snowflake IDs can exceed JS safe integer precision.
  if (param.type === 'integer' || param.type === 'number') {
    return (
      <Input
        size="small"
        status={status}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={param.required ? t('apiDebug.inputNumber.required') : param.description}
        inputMode={param.type === 'integer' ? 'numeric' : 'decimal'}
        style={{ width: '100%' }}
      />
    );
  }

  // array / object → TextArea（JSON 兜底）
  if (param.type === 'array' || param.type === 'object') {
    return (
      <TextArea
        size="small"
        status={status}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`${param.type === 'array' ? t('apiDebug.json.array') : t('apiDebug.json.object')} — ${t(
          'apiDebug.json.placeholder',
        )}`}
        autoSize={{ minRows: 2, maxRows: 6 }}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      />
    );
  }

  // string / file / 其他 → Input
  // byte format → show base64 placeholder hint
  const byteHint = param.format === 'byte' ? t('apiDebug.byte.placeholder') : undefined;
  return (
    <Input
      size="small"
      status={status}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={byteHint ?? (param.required ? t('apiDebug.inputNumber.required') : (param.description ?? ''))}
      readOnly={param.readOnly}
    />
  );
}

// ─── Schema field input (for urlencoded / multipart) ──

interface SchemaFieldInputProps {
  field: SchemaFieldRow;
  value: string;
  onChange: (next: string) => void;
}

function SchemaFieldInput({ field, value, onChange }: SchemaFieldInputProps) {
  const { t } = useTranslation();

  // file → Upload
  if (field.isFile) {
    return (
      <Input
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('apiDebug.body.file.placeholder')}
      />
    );
  }

  // OAS 3.1 structured form values are authored as JSON logical instances,
  // regardless of whether their wire representation is content- or style-based.
  if (field.isJson || field.structured) {
    return (
      <Input.TextArea
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={field.description ?? 'JSON'}
        autoSize={{ minRows: 3, maxRows: 10 }}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      />
    );
  }

  // enum → Select
  if (field.enum && field.enum.length > 0) {
    return (
      <Select
        size="small"
        value={value || undefined}
        onChange={onChange}
        allowClear
        showSearch
        optionFilterProp="label"
        options={field.enum.map((item) => ({
          value: String(item),
          label: String(item),
        }))}
        style={{ width: '100%' }}
      />
    );
  }

  // boolean → Switch
  if (field.type === 'boolean') {
    const checked = value === 'true';
    return (
      <Space size="small">
        <Switch size="small" checked={checked} onChange={(next) => onChange(next ? 'true' : 'false')} />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {checked ? 'true' : 'false'}
        </Text>
      </Space>
    );
  }

  // integer / number
  if (field.type === 'integer' || field.type === 'number') {
    const numValue = value === '' ? undefined : Number(value);
    return (
      <InputNumber
        size="small"
        value={Number.isFinite(numValue) ? numValue : undefined}
        onChange={(next) => onChange(next === null || next === undefined ? '' : String(next))}
        style={{ width: '100%' }}
        step={field.type === 'integer' ? 1 : undefined}
      />
    );
  }

  // default: Input
  // byte format (string+byte, e.g. Java Byte via springdoc) → show Base64 hint
  const byteHint = field.format === 'byte' ? t('apiDebug.byte.placeholder') : undefined;
  return (
    <Input
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={byteHint ?? field.description ?? ''}
    />
  );
}

// ─── Name cell（附带 deprecated/readOnly 标记）────────

function ParamNameCell({ param }: { param: DebugParam }) {
  const { t } = useTranslation();
  const deprecated = param.deprecated;
  const readOnly = param.readOnly;
  return (
    <Space size={4} wrap>
      <Text
        code
        style={{
          textDecoration: deprecated ? 'line-through' : undefined,
          color: deprecated ? '#8c8c8c' : undefined,
        }}
      >
        {param.name}
      </Text>
      {param.required && (
        <Tag color="red" style={{ marginInlineEnd: 0 }}>
          {t('apiDebug.tag.required')}
        </Tag>
      )}
      {deprecated && (
        <Tooltip title={t('apiDebug.tooltip.deprecated')}>
          <Tag color="default" style={{ marginInlineEnd: 0 }}>
            {t('apiDebug.tag.deprecated')}
          </Tag>
        </Tooltip>
      )}
      {readOnly && (
        <Tooltip title={t('apiDebug.tooltip.readOnly')}>
          <Tag color="warning" style={{ marginInlineEnd: 0 }}>
            {t('apiDebug.tag.readOnly')}
          </Tag>
        </Tooltip>
      )}
    </Space>
  );
}

// ─── Body Tab 组件 ────────────────────────────────────

interface BodyTabProps {
  debugModel: OperationDebugModel;
  bodyDefaults: BodyContentDefaults;
  body: string;
  setBody: (v: string) => void;
  selectedContentType: string;
  setSelectedContentType: (v: string) => void;
  formFields: Record<string, string>;
  setFormFields: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  formPartHeaders: Record<string, Record<string, string>>;
  setFormPartHeaders: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  formPartContentTypes: Record<string, string>;
  setFormPartContentTypes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  enableDynamicParameter: boolean;
  customBodyParams: CustomParamRow[];
  setCustomBodyParams: (rows: CustomParamRow[]) => void;
  fileFieldsRef: React.MutableRefObject<Record<string, File[]>>;
  binaryBodyFileRef: React.MutableRefObject<File | null>;
  rawMode: RawMode;
  setRawMode: (v: RawMode) => void;
}

function BodyTab({
  debugModel,
  bodyDefaults,
  body,
  setBody,
  selectedContentType,
  setSelectedContentType,
  formFields,
  setFormFields,
  formPartHeaders,
  setFormPartHeaders,
  formPartContentTypes,
  setFormPartContentTypes,
  enableDynamicParameter,
  customBodyParams,
  setCustomBodyParams,
  fileFieldsRef,
  binaryBodyFileRef,
  rawMode,
  setRawMode,
}: BodyTabProps) {
  const { t } = useTranslation();
  const bodyContents = debugModel.bodyContents;

  if (bodyContents.length === 0) {
    return <Alert type="info" message={t('apiDebug.noBody')} showIcon />;
  }

  // 当前选中的 BodyContent
  const currentBody = bodyContents.find((b) => b.mediaType === selectedContentType) ?? bodyContents[0];
  const category = currentBody.category;

  // ── 切换 content-type 时重置 formFields ──
  const handleContentTypeChange = (mediaType: string) => {
    setSelectedContentType(mediaType);
    const target = bodyContents.find((b) => b.mediaType === mediaType);
    if (target) {
      setFormFields(initialFormFieldsForContent(target, bodyDefaults));
      setFormPartHeaders(initialFormPartHeadersForContent(target));
      setFormPartContentTypes({});
      setCustomBodyParams([]);
      // 重置 fileFields
      fileFieldsRef.current = {};
      binaryBodyFileRef.current = null;

      // 更新 body 文本
      if (target.category === 'json') {
        setBody(initialBodyValueForContent(target, bodyDefaults));
      } else if (target.category === 'raw') {
        setBody(initialBodyValueForContent(target, bodyDefaults));
      }
      setRawMode(inferRawMode(target));
    }
  };

  // ── Body Beautify ──
  const handleBeautify = () => {
    const formatted = formatBodyByRawMode(body, rawMode);
    if (formatted !== undefined) {
      setBody(formatted);
      return;
    }
    message.warning(t('apiDebug.body.beautifyFailed', { contentType: RAW_CONTENT_TYPES[rawMode] }));
  };

  return (
    <div>
      {/* Content-Type 选择 */}
      {bodyContents.length > 1 && (
        <div style={{ marginBottom: 12 }}>
          <Radio.Group
            value={selectedContentType}
            onChange={(e) => handleContentTypeChange(e.target.value)}
            size="small"
          >
            {bodyContents.map((bc) => (
              <Radio.Button key={bc.mediaType} value={bc.mediaType}>
                {bc.category === 'json'
                  ? 'JSON'
                  : bc.category === 'urlencoded'
                    ? 'x-www-form-urlencoded'
                    : bc.category === 'multipart'
                      ? bc.mediaType.split(';', 1)[0].trim() || 'multipart'
                      : bc.binary
                        ? 'binary'
                        : 'raw'}
              </Radio.Button>
            ))}
          </Radio.Group>
        </div>
      )}

      {/* 根据分类渲染不同的表单 */}
      {category === 'json' && (
        <RawEditor
          body={body}
          setBody={setBody}
          rawMode={rawMode}
          setRawMode={setRawMode}
          onBeautify={handleBeautify}
        />
      )}

      {category === 'urlencoded' && (
        <UrlencodedForm bodyContent={currentBody} formFields={formFields} setFormFields={setFormFields} />
      )}

      {category === 'multipart' && (
        <MultipartForm
          bodyContent={currentBody}
          formFields={formFields}
          setFormFields={setFormFields}
          formPartHeaders={formPartHeaders}
          setFormPartHeaders={setFormPartHeaders}
          formPartContentTypes={formPartContentTypes}
          setFormPartContentTypes={setFormPartContentTypes}
          fileFieldsRef={fileFieldsRef}
        />
      )}

      {enableDynamicParameter && (category === 'urlencoded' || category === 'multipart') && (
        <CustomParamsSection
          title={t('apiDebug.customBody.title')}
          addLabel={t('apiDebug.customParams.add')}
          namePlaceholder={t('apiDebug.customBody.namePlaceholder')}
          valuePlaceholder={t('apiDebug.customParams.valuePlaceholder')}
          rows={customBodyParams}
          onChange={setCustomBodyParams}
        />
      )}

      {category === 'raw' && currentBody.binary && (
        <BinaryBodyInput key={currentBody.mediaType} contentType={currentBody.mediaType} fileRef={binaryBodyFileRef} />
      )}

      {category === 'raw' && !currentBody.binary && (
        <RawEditor
          body={body}
          setBody={setBody}
          rawMode={rawMode}
          setRawMode={setRawMode}
          onBeautify={handleBeautify}
        />
      )}
    </div>
  );
}

interface BinaryBodyInputProps {
  contentType: string;
  fileRef: React.MutableRefObject<File | null>;
}

function BinaryBodyInput({ contentType, fileRef }: BinaryBodyInputProps) {
  const { t } = useTranslation();
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const handleChange = (info: { fileList: UploadFile[] }) => {
    const nextList = info.fileList.slice(-1);
    setFileList(nextList);
    fileRef.current = nextList[0]?.originFileObj ?? null;
  };

  return (
    <Space direction="vertical" size={8}>
      <Text type="secondary">{t('apiDebug.body.binaryHint', { contentType })}</Text>
      <Upload beforeUpload={() => false} multiple={false} maxCount={1} fileList={fileList} onChange={handleChange}>
        <Button size="small" icon={<UploadOutlined />}>
          {t('apiDebug.body.selectFile')}
        </Button>
      </Upload>
    </Space>
  );
}

// ─── Urlencoded Form ──────────────────────────────────

interface UrlencodedFormProps {
  bodyContent: BodyContent;
  formFields: Record<string, string>;
  setFormFields: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

function UrlencodedForm({ bodyContent, formFields, setFormFields }: UrlencodedFormProps) {
  const { t } = useTranslation();
  const fields = useMemo(() => extractSchemaFields(bodyContent), [bodyContent]);

  const updateField = (name: string, value: string) => {
    setFormFields((prev) => ({ ...prev, [name]: value }));
  };

  const columns: ColumnsType<SchemaFieldRow> = [
    {
      title: t('apiDebug.col.paramName'),
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (_value: string, record: SchemaFieldRow) => (
        <Space size={4}>
          <Text code>{record.name}</Text>
          {record.required && (
            <Tag color="red" style={{ marginInlineEnd: 0 }}>
              {t('apiDebug.tag.required')}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: t('apiDebug.col.type'),
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (_value: string, record: SchemaFieldRow) => (
        <Space size={2} direction="vertical" style={{ lineHeight: 1.3 }}>
          <Text code style={{ fontSize: 12 }}>
            {record.type}
          </Text>
          {record.format && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {record.format}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: t('apiDebug.col.value'),
      key: 'value',
      render: (_value, record: SchemaFieldRow) => (
        <SchemaFieldInput
          field={record}
          value={formFields[record.name] ?? ''}
          onChange={(next) => updateField(record.name, next)}
        />
      ),
    },
    {
      title: t('apiDebug.col.description'),
      key: 'description',
      width: 240,
      render: (_value, record: SchemaFieldRow) => (
        <Space size={2} direction="vertical" style={{ lineHeight: 1.35, fontSize: 12 }}>
          {record.description && <DescriptionText style={{ fontSize: 12 }}>{record.description}</DescriptionText>}
          {record.default !== undefined && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('apiDebug.desc.default')}
              <Text code style={{ fontSize: 11 }}>
                {stringifyDebugValue(record.default, record.type)}
              </Text>
            </Text>
          )}
          {record.example !== undefined && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('apiDebug.desc.example')}
              <Text code style={{ fontSize: 11 }}>
                {stringifyDebugValue(record.example, record.type)}
              </Text>
            </Text>
          )}
        </Space>
      ),
    },
  ];

  return <Table size="small" dataSource={fields} columns={columns} pagination={false} rowKey="name" />;
}

// ─── Multipart Form ───────────────────────────────────

interface MultipartFormProps {
  bodyContent: BodyContent;
  formFields: Record<string, string>;
  setFormFields: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  formPartHeaders: Record<string, Record<string, string>>;
  setFormPartHeaders: React.Dispatch<React.SetStateAction<Record<string, Record<string, string>>>>;
  formPartContentTypes: Record<string, string>;
  setFormPartContentTypes: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  fileFieldsRef: React.MutableRefObject<Record<string, File[]>>;
}

function MultipartForm({
  bodyContent,
  formFields,
  setFormFields,
  formPartHeaders,
  setFormPartHeaders,
  formPartContentTypes,
  setFormPartContentTypes,
  fileFieldsRef,
}: MultipartFormProps) {
  const { t } = useTranslation();
  const [fileListMap, setFileListMap] = useState<Record<string, UploadFile[]>>({});
  const declaredFields = useMemo(() => extractSchemaFields(bodyContent), [bodyContent]);
  const extraFields = useMemo(
    () =>
      extraPositionalSchemaFields(bodyContent, [
        ...Object.keys(formFields),
        ...Object.keys(fileListMap),
        ...Object.keys(formPartContentTypes),
      ]),
    [bodyContent, formFields, fileListMap, formPartContentTypes],
  );
  const fields = useMemo(() => {
    const seen = new Set(declaredFields.map((field) => field.name));
    return [...declaredFields, ...extraFields.filter((field) => !seen.has(field.name))];
  }, [declaredFields, extraFields]);

  const updateField = (name: string, value: string) => {
    setFormFields((prev) => ({ ...prev, [name]: value }));
  };

  const updatePartHeader = (fieldName: string, headerName: string, value: string) => {
    setFormPartHeaders((prev) => ({
      ...prev,
      [fieldName]: { ...(prev[fieldName] ?? {}), [headerName]: value },
    }));
  };

  const handleFileChange = (name: string, info: { fileList: UploadFile[] }) => {
    setFileListMap((prev) => ({ ...prev, [name]: info.fileList }));
    // 提取原始 File 对象存入 ref（originFileObj 是 RcFile，extends File）
    const files: File[] = [];
    for (const f of info.fileList) {
      if (f.originFileObj) files.push(f.originFileObj);
    }
    fileFieldsRef.current[name] = files;
  };

  const addExtraPart = () => {
    const prefixCount = bodyContent.oas32Form?.fields.length ?? 0;
    const present = [...Object.keys(formFields), ...Object.keys(fileListMap), ...Object.keys(formPartContentTypes)]
      .filter((name) => /^\d+$/.test(name))
      .map(Number)
      .filter((index) => index >= prefixCount);
    const next = present.length > 0 ? Math.max(...present) + 1 : prefixCount;
    const name = String(next);
    setFormFields((prev) => ({ ...prev, [name]: prev[name] ?? '' }));
  };

  const updatePartContentType = (name: string, value: string) => {
    setFormPartContentTypes((prev) => ({ ...prev, [name]: value }));
  };

  const columns: ColumnsType<SchemaFieldRow> = [
    {
      title: t('apiDebug.col.paramName'),
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (_value: string, record: SchemaFieldRow) => (
        <Space size={4}>
          <Text code>{record.name}</Text>
          {record.required && (
            <Tag color="red" style={{ marginInlineEnd: 0 }}>
              {t('apiDebug.tag.required')}
            </Tag>
          )}
          {record.isFile && (
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              {t('apiDebug.body.file')}
            </Tag>
          )}
          {record.isJson && (
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>
              JSON
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: t('apiDebug.col.type'),
      dataIndex: 'type',
      key: 'type',
      width: 80,
      render: (_value: string, record: SchemaFieldRow) => (
        <Text code style={{ fontSize: 12 }}>
          {record.isFile ? 'file' : record.type}
        </Text>
      ),
    },
    {
      title: t('apiDebug.col.value'),
      key: 'value',
      render: (_value, record: SchemaFieldRow) => {
        let editor: React.ReactNode;
        if (record.isFile) {
          // issue #251: only enable multi-select for schemas that are actually array
          // of binary/base64. Otherwise the server endpoint is a single-file handler
          // (e.g. `@RequestPart("file") MultipartFile file`) and extra parts get
          // silently dropped, which looks like success but isn't.
          //
          // `maxCount={1}` on top of `multiple={false}` makes the UI replace the
          // previously staged file on re-select instead of appending — matches user
          // expectation for a single-file control.
          editor = (
            <Upload
              beforeUpload={() => false} // 阻止自动上传
              multiple={record.isMultipleFile}
              maxCount={record.isMultipleFile ? undefined : 1}
              fileList={fileListMap[record.name] ?? []}
              onChange={(info) => handleFileChange(record.name, info)}
            >
              <Button size="small" icon={<UploadOutlined />}>
                {t('apiDebug.body.selectFile')}
              </Button>
            </Upload>
          );
        } else if (record.isJson || record.structured) {
          editor = (
            <TextArea
              size="small"
              value={formFields[record.name] ?? '{}'}
              onChange={(event) => updateField(record.name, event.target.value)}
              placeholder={t('apiDebug.body.jsonPart.placeholder')}
              autoSize={{ minRows: 3, maxRows: 8 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          );
        } else {
          editor = (
            <SchemaFieldInput
              field={record}
              value={formFields[record.name] ?? ''}
              onChange={(next) => updateField(record.name, next)}
            />
          );
        }

        return (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {editor}
            {record.contentTypeRequiresChoice && (
              <AutoComplete
                size="small"
                value={formPartContentTypes[record.name] ?? ''}
                options={record.contentTypes
                  .filter((mediaType) => !mediaType.includes('*'))
                  .map((mediaType) => ({ value: mediaType }))}
                onChange={(value) => updatePartContentType(record.name, value)}
                placeholder={t('apiDebug.body.choosePartContentType.placeholder')}
                aria-label={t('apiDebug.body.choosePartContentType')}
                style={{ width: '100%' }}
              />
            )}
            {record.partHeaders.map((header) => (
              <Input
                key={header.name}
                size="small"
                value={formPartHeaders[record.name]?.[header.name] ?? ''}
                onChange={(event) => updatePartHeader(record.name, header.name, event.target.value)}
                placeholder={header.description ?? t('apiDebug.body.partHeader.placeholder')}
                prefix={
                  <Space size={4}>
                    <Text code style={{ fontSize: 11 }}>
                      {header.name}
                    </Text>
                    {header.required && <Text type="danger">*</Text>}
                  </Space>
                }
                aria-label={t('apiDebug.body.partHeader.ariaLabel', {
                  field: record.name,
                  header: header.name,
                })}
              />
            ))}
          </Space>
        );
      },
    },
    {
      title: t('apiDebug.col.description'),
      key: 'description',
      width: 240,
      render: (_value, record: SchemaFieldRow) => (
        <Space size={2} direction="vertical" style={{ lineHeight: 1.35, fontSize: 12 }}>
          {record.description && <DescriptionText style={{ fontSize: 12 }}>{record.description}</DescriptionText>}
          {record.contentTypes.length > 0 && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('apiDebug.body.partContentType', { contentType: record.contentTypes.join(', ') })}
            </Text>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Table size="small" dataSource={fields} columns={columns} pagination={false} rowKey="name" />
      {bodyContent.oas32Form?.extraItemTemplate && (
        <Button size="small" icon={<PlusOutlined />} onClick={addExtraPart}>
          {t('apiDebug.body.addPart')}
        </Button>
      )}
    </Space>
  );
}

// ─── Raw Editor ───────────────────────────────────────

interface RawEditorProps {
  body: string;
  setBody: (v: string) => void;
  rawMode: RawMode;
  setRawMode: (v: RawMode) => void;
  onBeautify: () => void;
}

const RAW_MODE_LANGUAGE: Record<RawMode, CodeEditorLanguage> = {
  json: 'json',
  xml: 'xml',
  text: 'text',
  javascript: 'text',
  html: 'text',
};

function RawEditor({ body, setBody, rawMode, setRawMode, onBeautify }: RawEditorProps) {
  const { t } = useTranslation();
  const useCodeEditor = rawMode === 'json' || rawMode === 'xml';
  const canBeautify = rawMode !== 'text';

  return (
    <div>
      <div
        style={{
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Space size={8} wrap>
          <Select
            size="small"
            value={rawMode}
            onChange={(value) => setRawMode(value as RawMode)}
            options={RAW_MODES.map((m) => ({
              value: m.value,
              label: m.label,
            }))}
            style={{ minWidth: 240 }}
          />
          {canBeautify && (
            <Button size="small" type="primary" onClick={onBeautify}>
              {t('apiDebug.body.beautify')}
            </Button>
          )}
        </Space>
      </div>
      {useCodeEditor ? (
        <CodeEditor
          value={body}
          onChange={setBody}
          language={RAW_MODE_LANGUAGE[rawMode]}
          placeholderText={`${RAW_CONTENT_TYPES[rawMode]} request body`}
        />
      ) : (
        <TextArea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={10}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
          placeholder={`${RAW_CONTENT_TYPES[rawMode]} request body`}
        />
      )}
    </div>
  );
}

// ─── Preview Tab (TASK-028) ───────────────────────────

interface InjectedGlobalParamRow {
  key: string;
  name: string;
  value: string;
  masked: boolean;
  source: 'application' | 'global';
}

function globalParamValuesForScope(
  params: ScopedGlobalParamItem[],
  scope: GlobalParamScope,
): GlobalParamValues | undefined {
  const headers: Record<string, string> = {};
  const queries: Record<string, string> = {};
  for (const param of params) {
    if (param.scope !== scope || !param.enabled || param.value === undefined || param.value === '') continue;
    if (param.in === 'header') headers[param.name] = param.value;
    else if (param.in === 'query') queries[param.name] = param.value;
  }
  if (Object.keys(headers).length === 0 && Object.keys(queries).length === 0) return undefined;
  return { headers, queries };
}

function InjectedGlobalParamsSection({ rows }: { rows: InjectedGlobalParamRow[] }) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <Space size={8} style={{ marginBottom: 8 }}>
        <Text strong>{t('globalParam.title')}</Text>
        <Text type="secondary">{t('apiDebug.globalParams.readOnly')}</Text>
      </Space>
      <Table
        bordered
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          {
            title: t('apiDebug.col.paramName'),
            dataIndex: 'name',
            key: 'name',
            width: 240,
            render: (name: string, record: InjectedGlobalParamRow) => (
              <Space size={4}>
                <Text code>{name}</Text>
                <Tag color={record.source === 'application' ? 'purple' : 'green'}>
                  {t(`apiDebug.preview.source.${record.source}`)}
                </Tag>
              </Space>
            ),
          },
          {
            title: t('apiDebug.col.value'),
            dataIndex: 'value',
            key: 'value',
            render: (value: string, record: InjectedGlobalParamRow) => (
              <RevealableValue value={value} masked={record.masked} />
            ),
          },
        ]}
        rowKey="key"
      />
    </div>
  );
}

interface PreviewTabPanelProps {
  result: RequestPreviewBuildResult;
  onCopyText: (text: string) => void;
  onDownloadMultipartBody?: (body: Blob) => void;
}

function formatMultipartPlanBody(plan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }>): string {
  const formatPart = (part: (typeof plan.parts)[number]): Record<string, unknown> => {
    if (part.kind === 'nested') {
      return {
        name: part.name,
        contentType: part.contentType,
        headers: part.headers,
        parts: part.parts.map(formatPart),
      };
    }
    return part.kind === 'file'
      ? {
          name: part.name,
          file: part.fileName,
          ...(part.fileSize === undefined ? {} : { size: part.fileSize }),
          contentType: part.contentType,
          headers: part.headers,
        }
      : {
          name: part.name,
          value: part.value,
          contentType: part.contentType,
          headers: part.headers,
        };
  };
  if (plan.wire === 'authored') {
    return plan.authoredBody ?? '';
  }
  return JSON.stringify(plan.parts.map(formatPart), null, 2);
}

function applyMaterializedMultipartContentType(headers: Record<string, string>, contentType: string | undefined): void {
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'content-type') delete headers[name];
  }
  if (contentType) headers['Content-Type'] = contentType;
}

function oas32PreviewDiagnosticAlertType(diagnostic: Oas32ParameterDiagnostic): 'error' | 'warning' | 'info' {
  if (diagnostic.blocks === 'all') return 'error';
  if (diagnostic.blocks === 'browser') return 'warning';
  return 'info';
}

function oas32PreviewDiagnosticTitle(diagnostic: Oas32ParameterDiagnostic): string {
  if (diagnostic.blocks === 'all') return 'apiDebug.preview.diagnosticsBlocked';
  if (diagnostic.blocks === 'browser') return 'apiDebug.preview.diagnosticsBrowser';
  return 'apiDebug.preview.diagnosticsInfo';
}

function PreviewTabPanel({ result, onCopyText, onDownloadMultipartBody }: PreviewTabPanelProps) {
  const { t } = useTranslation();
  const [wireText, setWireText] = useState<string>();
  const materialized = result.ok ? result.value.materializedMultipart : undefined;
  useEffect(() => {
    if (!result.ok || materialized?.mode !== 'encoded' || !(materialized.body instanceof Blob)) {
      setWireText(undefined);
      return;
    }
    let cancelled = false;
    void materialized.body.text().then((value) => {
      if (!cancelled) setWireText(value);
    });
    return () => {
      cancelled = true;
    };
  }, [result, materialized]);
  if (!result.ok) {
    return <Alert type="error" showIcon message={t('apiDebug.error.title')} description={result.error} />;
  }
  const { built, curl, cookieParameterSource } = result.value;
  const multipartPlan = built.formBodyPlan?.kind === 'multipart' ? built.formBodyPlan : undefined;
  const encodedMultipart = materialized?.mode === 'encoded';
  const isMultipart = Boolean(multipartPlan) || built.contentType.toLowerCase().includes('multipart/');
  const previewBody = encodedMultipart
    ? (wireText ?? '')
    : multipartPlan
      ? formatMultipartPlanBody(multipartPlan)
      : built.body;
  const hasBody =
    encodedMultipart || (previewBody !== undefined && (previewBody !== '' || built.explicitExampleBody === true));
  const parameterDiagnostics = oas32PreviewDiagnostics(built);

  const headerPairs = Object.entries(built.headers);
  const queryPairs = Object.entries(built.query);
  const hasContentType = headerPairs.some(([k]) => k.toLowerCase() === 'content-type');

  const sourceTag = (source: ParamSource | undefined) => {
    if (!source) return null;
    const colorMap: Record<ParamSource, string> = {
      interface: 'blue',
      application: 'purple',
      global: 'green',
      auth: 'orange',
    };
    return (
      <Tag color={colorMap[source]} style={{ marginInlineEnd: 0 }}>
        {t(`apiDebug.preview.source.${source}`)}
      </Tag>
    );
  };

  const renderPreviewValue = (value: QueryParamValue) => {
    const displayValue = displayQueryParamValue(value);
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, minWidth: 0 }}>
        <Paragraph
          key={displayValue}
          ellipsis={{
            rows: 2,
            expandable: 'collapsible',
            symbol: (expanded) => t(expanded ? 'apiDebug.preview.collapseValue' : 'apiDebug.preview.expandValue'),
          }}
          style={{ flex: 1, minWidth: 0, marginBottom: 0, wordBreak: 'break-all' }}
        >
          {displayValue}
        </Paragraph>
        {displayValue && (
          <Tooltip title={t('apiDebug.preview.copyValue')}>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => onCopyText(displayValue)}
              aria-label={t('apiDebug.preview.copyValue')}
              style={{ flex: 'none' }}
            />
          </Tooltip>
        )}
      </div>
    );
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={14}>
      {/* URL + method */}
      <div>
        <Space size={8}>
          <Text type="secondary">{t('apiDebug.preview.method')}</Text>
          <Tag color={METHOD_COLORS[built.method] ?? 'default'}>{built.method}</Tag>
          <Text type="secondary">{t('apiDebug.preview.url')}</Text>
        </Space>
        <pre style={previewBoxStyle}>{built.url}</pre>
      </div>

      {parameterDiagnostics.length > 0 && (
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Text strong>{t('apiDebug.preview.diagnostics')}</Text>
          {parameterDiagnostics.map((diagnostic, index) => (
            <Alert
              key={`${diagnostic.code}:${diagnostic.key ?? ''}:${index}`}
              type={oas32PreviewDiagnosticAlertType(diagnostic)}
              showIcon
              message={t(oas32PreviewDiagnosticTitle(diagnostic))}
              description={`${diagnostic.code}: ${diagnostic.message}`}
            />
          ))}
        </Space>
      )}

      {/* Headers */}
      <div>
        <Text strong>{t('apiDebug.preview.headers')}</Text>
        {!hasContentType && hasBody && !isMultipart && (
          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {t('apiDebug.preview.autoContentType')}
          </Text>
        )}
        {headerPairs.length > 0 ? (
          <Table
            size="small"
            tableLayout="fixed"
            pagination={false}
            dataSource={headerPairs.map(([key, value]) => ({
              key,
              name: key,
              value,
              source: built.sourceMap?.headers[key],
            }))}
            columns={[
              {
                title: t('apiDebug.col.header'),
                dataIndex: 'name',
                key: 'name',
                width: 240,
                render: (name: string, record: { source?: ParamSource }) => (
                  <Space size={4}>
                    <Text code>{name}</Text>
                    {sourceTag(record.source)}
                  </Space>
                ),
              },
              {
                title: t('apiDebug.col.headerValue'),
                dataIndex: 'value',
                key: 'value',
                render: renderPreviewValue,
              },
            ]}
            style={{ marginTop: 4 }}
          />
        ) : (
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            —
          </Text>
        )}
      </div>

      {/* Query */}
      <div>
        <Text strong>{t('apiDebug.preview.query')}</Text>
        {queryPairs.length > 0 ? (
          <Table
            size="small"
            tableLayout="fixed"
            pagination={false}
            dataSource={queryPairs.map(([key, value]) => ({
              key,
              name: key,
              value,
              source: built.sourceMap?.query[key],
            }))}
            columns={[
              {
                title: t('apiDebug.col.paramName'),
                dataIndex: 'name',
                key: 'name',
                width: 240,
                render: (name: string, record: { source?: ParamSource }) => (
                  <Space size={4}>
                    <Text code>{name}</Text>
                    {sourceTag(record.source)}
                  </Space>
                ),
              },
              {
                title: t('apiDebug.col.value'),
                dataIndex: 'value',
                key: 'value',
                render: renderPreviewValue,
              },
            ]}
            style={{ marginTop: 4 }}
          />
        ) : (
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            —
          </Text>
        )}
      </div>

      {/* Body */}
      <div>
        <Text strong>
          {encodedMultipart
            ? t('apiDebug.preview.multipartWire')
            : isMultipart
              ? t('apiDebug.preview.bodyMultipart')
              : t('apiDebug.preview.body')}
        </Text>
        {hasBody ? (
          <pre style={previewBoxStyle}>
            {encodedMultipart
              ? (wireText ?? '')
              : formatRequestPreviewBody(previewBody ?? '', built.contentType, built.explicitExampleBody)}
          </pre>
        ) : (
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            {t('apiDebug.preview.noBody')}
          </Text>
        )}
      </div>

      {/* Curl */}
      <div>
        {cookieParameterSource === 'browser-session' && (
          <Alert
            type="info"
            showIcon
            message={t('apiDebug.cookie.sessionPreview')}
            description={t('apiDebug.cookie.sessionCurl')}
            style={{ marginBottom: 8 }}
          />
        )}
        {encodedMultipart && (
          <Alert type="info" showIcon message={t('apiDebug.preview.multipartBodyFile')} style={{ marginBottom: 8 }} />
        )}
        <Space style={{ marginBottom: 4 }}>
          <Text strong>{t('apiDebug.preview.curl')}</Text>
          <Button size="small" onClick={() => onCopyText(curl)}>
            {t('apiDebug.preview.copyCurl')}
          </Button>
          {encodedMultipart && materialized?.body instanceof Blob && (
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => onDownloadMultipartBody?.(materialized.body as Blob)}
            >
              {t('apiDebug.preview.downloadMultipartBody')}
            </Button>
          )}
        </Space>
        <pre style={{ ...previewBoxStyle, maxHeight: 260 }}>{curl}</pre>
      </div>
    </Space>
  );
}

const previewBoxStyle: React.CSSProperties = {
  background: '#f6f8fa',
  padding: 12,
  borderRadius: 4,
  fontSize: 13,
  maxHeight: 320,
  overflow: 'auto',
  margin: '4px 0 0 0',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

interface InitialDebugState {
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
  rawMode: RawMode;
  customQueryParams: CustomParamRow[];
  customBodyParams: CustomParamRow[];
  customHeaders: CustomParamRow[];
  customCookies: CustomParamRow[];
}

function inferRawMode(bodyContent: BodyContent | undefined): RawMode {
  if (bodyContent?.category === 'json') return 'json';
  if (bodyContent?.category !== 'raw') return 'text';
  const mediaType = bodyContent.mediaType;
  if (mediaType.includes('json')) return 'json';
  if (mediaType.includes('xml')) return 'xml';
  if (mediaType.includes('html')) return 'html';
  if (mediaType.includes('javascript')) return 'javascript';
  return 'text';
}

function buildInitialDebugState(
  debugModel: OperationDebugModel,
  operation: NonNullable<ReturnType<typeof useCurrentOperation>['operation']>,
  swaggerDoc: NonNullable<ReturnType<typeof useCurrentOperation>['swaggerDoc']>,
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

const DEBUG_HTTP_METHODS = new Set(OPENAPI_HTTP_METHODS.map((method) => method.toUpperCase()));

function requestServerSourceLabel(source: RequestServerSource, t: ReturnType<typeof useTranslation>['t']): string {
  if (source === 'gateway') return t('apiDebug.baseUrl.source.gateway');
  if (source === 'operation') return t('apiDebug.baseUrl.source.operation');
  if (source === 'path') return t('apiDebug.baseUrl.source.path');
  return t('apiDebug.baseUrl.source.document');
}

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

function restoreInitialDebugStateFromCache(
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

// ─── 主组件 ────────────────────────────────────────────

export default function ApiDebug() {
  const { t } = useTranslation();
  const { group, tag, operaterId } = useParams();
  const { loading: docLoading, swaggerDoc, operation } = useCurrentOperation();
  const { activeSwaggerGroup, operationRetrievalUri, routeGroupReady } = useGroup();
  const { settings } = useSettings();
  const { effectiveParams, cookieSession } = useGlobalParam();
  const schemaEngine = useSchemaEngine();
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
  const [legacyBaseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const baseUrl = isOas32 ? server32.baseUrl : legacyBaseUrl;
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
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
  const [paramValues, setParamValues] = useState<ParamValueMap>({});
  // enabled state: keyed by paramKey; empty optional OAS 3.1 params start omitted.
  const [paramEnabled, setParamEnabled] = useState<Record<string, boolean>>({});
  const [body, setBody] = useState('');
  const [customQueryParams, setCustomQueryParams] = useState<CustomParamRow[]>([]);
  const [customBodyParams, setCustomBodyParams] = useState<CustomParamRow[]>([]);
  const [customHeaders, setCustomHeaders] = useState<CustomParamRow[]>([]);
  const [customCookies, setCustomCookies] = useState<CustomParamRow[]>([]);
  const [cookieParameterSource, setCookieParameterSource] = useState<CookieParameterSource>('explicit');
  const exampleCatalog32 = useMemo(
    () => (isOas32 && swaggerDoc && operation ? locateOperationExampleCatalog(swaggerDoc, operation) : null),
    [isOas32, swaggerDoc, operation],
  );
  const exampleSession32 = isOas32 && schemaEngine.status === 'ready' ? schemaEngine.session : undefined;
  const defaults32 = useOperationExampleDefaults(exampleCatalog32, exampleSession32);
  const [oas32ParameterEntries, setOas32ParameterEntries] = useState<Oas32ParameterEntries>({});
  const serializedParams32 = useMemo(
    () => serializedExampleParametersFromEntries(oas32ParameterEntries),
    [oas32ParameterEntries],
  );
  const [serializedBodyMedia32, setSerializedBodyMedia32] = useState<string>();
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
  const [selectedContentType, setSelectedContentType] = useState('');
  const [formFields, setFormFields] = useState<Record<string, string>>({});
  const [formPartHeaders, setFormPartHeaders] = useState<Record<string, Record<string, string>>>({});
  const [formPartContentTypes, setFormPartContentTypes] = useState<Record<string, string>>({});
  const fileFieldsRef = useRef<Record<string, File[]>>({});
  const binaryBodyFileRef = useRef<File | null>(null);
  const displayedPreviewRef = useRef<RequestPreviewBuildResult | null>(null);
  const multipartMaterializationRef = useRef<{
    key: string;
    value: NonNullable<RequestPreviewBuild['materializedMultipart']>;
  } | null>(null);
  const [rawMode, setRawMode] = useState<RawMode>('text');
  const [resetNonce, setResetNonce] = useState(0);
  const [hydratedDebugCacheKey, setHydratedDebugCacheKey] = useState<string | null>(null);
  const skipNextDebugCacheWriteRef = useRef(false);
  const [historyEntries, setHistoryEntries] = useState<DebugHistoryEntry[]>([]);
  const debugDefaultEditRevisionRef = useRef(0);
  const appliedOas31ExampleIdentityRef = useRef<Oas31DebugExampleIdentity | null>(null);

  // ── TASK-028: 校验错误与预览 ──
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);

  /** 当前缺失必填的 key 集合（统一 `${in}:${name}` 或 `body:requestBody`） */
  const errorKeys = useMemo(() => new Set(validationErrors.map((e) => e.key)), [validationErrors]);

  const initialDebugState = useMemo(() => {
    if (!debugModel || !operation || !swaggerDoc) return null;
    return buildInitialDebugState(debugModel, operation, swaggerDoc, defaultBaseUrl, initialBodyDefaults);
  }, [debugModel, operation, swaggerDoc, defaultBaseUrl, initialBodyDefaults]);

  useLayoutEffect(() => {
    activeDebugCacheKeyRef.current = debugCacheKey;
  }, [debugCacheKey]);

  useLayoutEffect(() => {
    currentSchemaEngineRef.current = schemaEngine;
  }, [schemaEngine]);

  useLayoutEffect(() => {
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

  const applyInitialDebugState = (initial: InitialDebugState, options: { resetActiveTab?: boolean } = {}) => {
    setOas32ParameterEntries({});
    setSerializedBodyMedia32(undefined);
    appliedDefaults32.current = null;
    setCookieParameterSource(initial.cookieParameterSource);
    setBaseUrl(initial.baseUrl);
    setMethod(initial.method);
    setPath(initial.path);
    setParamValues(initial.paramValues);
    setParamEnabled(initial.paramEnabled);
    setSelectedContentType(initial.selectedContentType);
    setBody(initial.body);
    setFormFields(initial.formFields);
    setFormPartHeaders(initial.formPartHeaders);
    setFormPartContentTypes(initial.formPartContentTypes);
    fileFieldsRef.current = {};
    binaryBodyFileRef.current = null;
    setRawMode(initial.rawMode);
    setCustomQueryParams(initial.customQueryParams);
    setCustomBodyParams(initial.customBodyParams);
    setCustomHeaders(initial.customHeaders);
    setCustomCookies(initial.customCookies);
    setBuiltRequest(null);
    setBuiltRequestCookieSource('explicit');
    setSseEvents(null);
    setSseStreaming(false);
    setResponseProgress(null);
    setValidationErrors([]);
    if (options.resetActiveTab) {
      setActiveTab(undefined);
    }
    setResetNonce((value) => value + 1);
  };

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
    debugDefaultEditRevisionRef.current = cached === null ? 0 : 1;
    appliedOas31ExampleIdentityRef.current = null;
    requestSeqRef.current += 1;
    sseAbortRef.current?.abort();
    sseAbortRef.current = null;
    setSseStreaming(false);
    const cachedSession = debugCacheKey !== null ? readDebugSessionState(debugCacheKey) : null;
    applyInitialDebugState(nextInitial, { resetActiveTab: true });
    if (isOas32 && cached) {
      setOas32ParameterEntries(
        restoreOas32ParameterEntries(cached.oas32ParameterEntries, cached.serializedExampleParameters),
      );
      setSerializedBodyMedia32(cached.serializedExampleBodyMediaType);
    }
    setLoading(false);
    setResponse(cachedSession?.response ?? null);
    setError(cachedSession?.error ?? null);
    setBuiltRequest(cachedSession?.builtRequest ?? null);
    setBuiltRequestCookieSource(cachedSession?.builtRequestCookieSource ?? 'explicit');
    setSseEvents(cachedSession?.sseEvents ?? null);
    setHydratedDebugCacheKey(debugCacheKey);
  }, [
    debugCacheKey,
    debugModel,
    initialBodyDefaults,
    initialDebugState,
    settings.enableRequestCache,
    operation?.identity,
    isOas32,
  ]);

  useEffect(() => {
    if (debugCacheKey === null || hydratedDebugCacheKey !== debugCacheKey) return;
    if (!response && !error && !builtRequest && sseEvents === null) {
      removeDebugSessionState(debugCacheKey);
      return;
    }
    writeDebugSessionState(debugCacheKey, {
      response,
      error,
      builtRequest,
      builtRequestCookieSource,
      sseEvents,
    });
  }, [builtRequest, builtRequestCookieSource, debugCacheKey, error, hydratedDebugCacheKey, response, sseEvents]);

  useEffect(() => {
    if (!settings.enableRequestCache || debugCacheKey === null || hydratedDebugCacheKey !== debugCacheKey) {
      return;
    }
    if (skipNextDebugCacheWriteRef.current) {
      skipNextDebugCacheWriteRef.current = false;
      return;
    }
    writeDebugCache(debugCacheKey, {
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
    });
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
  }, [defaults32, hydratedDebugCacheKey, debugCacheKey, selectedContentType, resetNonce]);

  const setBodyFromUser = useCallback((next: string) => {
    debugDefaultEditRevisionRef.current += 1;
    setBody(next);
  }, []);

  const setFormFieldsFromUser = useCallback((next: React.SetStateAction<Record<string, string>>) => {
    debugDefaultEditRevisionRef.current += 1;
    setFormFields(next);
  }, []);

  const setFormPartHeadersFromUser = useCallback(
    (next: React.SetStateAction<Record<string, Record<string, string>>>) => {
      debugDefaultEditRevisionRef.current += 1;
      setFormPartHeaders(next);
    },
    [],
  );

  const setFormPartContentTypesFromUser = useCallback((next: React.SetStateAction<Record<string, string>>) => {
    debugDefaultEditRevisionRef.current += 1;
    setFormPartContentTypes(next);
  }, []);

  const updateValue = (param: DebugParam, next: string) => {
    debugDefaultEditRevisionRef.current += 1;
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
        debugDefaultEditRevisionRef.current,
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
  }, [path, debugModel, paramEnabled, paramValues, effectiveCookieSource, serializedParams32, oas32ParameterEntries]);

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

  const paramColumnsFor = (params: DebugParam[]): ColumnsType<DebugParam> => {
    const browserSession = params.some((parameter) =>
      isBrowserSessionParameter(parameter, effectiveCookieSource, { declaredCookies: isOas32 }),
    );
    const paramKeys = params.map(paramKey);
    const selection = resolveApiDebugParamSelection(paramKeys, paramEnabled);
    const selectAllLabel = t(selection.checked ? 'apiDebug.params.deselectAll' : 'apiDebug.params.selectAll');

    const columns: ColumnsType<DebugParam> = [
      {
        title: (
          <Tooltip title={selectAllLabel}>
            <Checkbox
              aria-label={selectAllLabel}
              checked={selection.checked}
              indeterminate={selection.indeterminate}
              disabled={paramKeys.length === 0}
              onChange={(event) => {
                debugDefaultEditRevisionRef.current += 1;
                setParamEnabled((current) => setApiDebugParamsEnabled(current, paramKeys, event.target.checked));
              }}
            />
          </Tooltip>
        ),
        key: 'enabled',
        width: API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS.enabled,
        render: (_value: unknown, record: DebugParam) => (
          <Checkbox
            checked={paramEnabled[paramKey(record)] !== false}
            onChange={(e) => {
              debugDefaultEditRevisionRef.current += 1;
              setParamEnabled((prev) => ({
                ...prev,
                [paramKey(record)]: e.target.checked,
              }));
            }}
          />
        ),
      },
      {
        title: t('apiDebug.col.paramName'),
        dataIndex: 'name',
        key: 'name',
        width: API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS.paramName,
        render: (_value: string, record: DebugParam) => <ParamNameCell param={record} />,
      },
      {
        title: t('apiDebug.col.type'),
        dataIndex: 'type',
        key: 'type',
        width: API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS.type,
        render: (_value: string, record: DebugParam) => (
          <Space size={2} direction="vertical" style={{ lineHeight: 1.3 }}>
            <Text code style={{ fontSize: 12 }}>
              {record.type}
            </Text>
            {record.format && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {record.format}
              </Text>
            )}
          </Space>
        ),
      },
      {
        title: t('apiDebug.col.value'),
        dataIndex: 'value',
        key: 'value',
        width: API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS.value,
        render: (_value: string, record: DebugParam) =>
          isBrowserSessionParameter(record, effectiveCookieSource, { declaredCookies: isOas32 }) ? (
            <Text type="secondary">{t('apiDebug.cookie.sessionValue')}</Text>
          ) : serializedExampleParameterForKey(oas32ParameterEntries, paramKey(record)) ? (
            <Input.TextArea
              aria-label={`${record.name} serializedValue`}
              value={paramValues[paramKey(record)] ?? ''}
              onChange={(event) => updateValue(record, event.target.value)}
              autoSize={{ minRows: 1, maxRows: 4 }}
            />
          ) : (
            <ParamInput
              param={record}
              value={paramValues[paramKey(record)] ?? ''}
              onChange={(next) => updateValue(record, next)}
              hasError={errorKeys.has(paramKey(record))}
            />
          ),
      },
      {
        title: t('apiDebug.col.description'),
        key: 'description',
        width: API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS.description,
        render: (_value, record: DebugParam) => (
          <Space size={2} direction="vertical" style={{ lineHeight: 1.35, fontSize: 12 }}>
            {record.description && <DescriptionText style={{ fontSize: 12 }}>{record.description}</DescriptionText>}
            {record.default !== undefined && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('apiDebug.desc.default')}
                <Text code style={{ fontSize: 11 }}>
                  {stringifyDebugValue(record.default, record.type)}
                </Text>
              </Text>
            )}
            {record.example !== undefined && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('apiDebug.desc.example')}
                <Text code style={{ fontSize: 11 }}>
                  {stringifyDebugValue(record.example, record.type)}
                </Text>
              </Text>
            )}
            {record.enum && record.enum.length > 0 && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('apiDebug.desc.enum')}
                {record.enum
                  .slice(0, 3)
                  .map((item) => String(item))
                  .join(', ')}
                {record.enum.length > 3 ? '…' : ''}
              </Text>
            )}
          </Space>
        ),
      },
    ];
    return browserSession ? columns.filter((column) => column.key !== 'enabled') : columns;
  };

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
        <Alert
          type="warning"
          showIcon
          message={t('apiDebug.notFound.title')}
          description={t('apiDebug.notFound.desc')}
        />
      </OperationModeLayout>
    );
  }

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
  const getCurrentCategory = (): string => {
    const bc = debugModel.bodyContents.find((b) => b.mediaType === selectedContentType);
    return bc?.category ?? 'raw';
  };

  /** 获取最终 effective content-type */
  const getEffectiveContentType = (): string => {
    if (isOas32 && serializedBodyMedia32 === selectedContentType) return selectedContentType;
    const category = getCurrentCategory();
    const currentBody = debugModel.bodyContents.find((b) => b.mediaType === selectedContentType);
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
    return debugModel.bodyContents[0]?.mediaType ?? '';
  };

  const collectFormValues = (): DebugFormValues => {
    const category = getCurrentCategory();
    const currentBody = debugModel.bodyContents.find((b) => b.mediaType === selectedContentType);
    const specQueryParams = collectQueryParams();
    const specHeaders = collectForIn(debugModel.headerParams);
    const specCookieParams = collectForIn(debugModel.cookieParams);
    const extraQueryParams = customRowsToRecord(customQueryParams);
    const extraHeaders = customRowsToRecord(customHeaders);
    const extraCookieParams = customRowsToRecord(customCookies);
    const structuredForm =
      category === 'urlencoded' || category === 'multipart'
        ? mergeCustomBodyParams(
            formFields,
            customBodyParams,
            settings.enableDynamicParameter,
            reservedBodyFieldNames(currentBody),
          )
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
        ? Object.fromEntries(Object.entries(fileFieldsRef.current).map(([name, files]) => [name, [...files]]))
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
              debugDefaultEditRevisionRef.current,
              exampleSession32,
            ),
            ...(serializedBodyMedia32 === selectedContentType
              ? { serializedExampleBody: { mediaType: getEffectiveContentType(), text: body } }
              : {}),
          }
        : isOas32
          ? {
              serializedExampleParameters: Object.fromEntries(
                Object.entries(serializedParams32).filter(([key]) => paramEnabled[key] !== false),
              ),
              ...(serializedBodyMedia32 === selectedContentType
                ? { serializedExampleBody: { mediaType: getEffectiveContentType(), text: body } }
                : {}),
            }
          : {}),
      selectedContentType: getEffectiveContentType(),
      body: category === 'json' || category === 'raw' ? body : undefined,
      binaryBodyFileName: currentBody?.binary ? binaryBodyFileRef.current?.name : undefined,
      formFields: structuredForm?.formFields,
      ...(formFieldNamesToIncludeWhenEmpty.length > 0 ? { formFieldNamesToIncludeWhenEmpty } : {}),
      fileFields: fileSnapshot,
      jsonFields: category === 'multipart' ? (currentBody?.jsonFields ?? []) : undefined,
      formPartHeaders: category === 'multipart' ? partHeaderSnapshot : undefined,
      formPartContentTypes: category === 'multipart' ? partContentTypeSnapshot : undefined,
    };
  };

  /** 基于当前表单构建 BuiltRequest（不发请求，仅用于预览/curl/发送共用） */
  const buildPreview = (): RequestPreviewBuild => {
    if (isOas32 && serverOrPathUnavailable32) throw new Error(t('oas32.server.unavailable'));
    const formValues = collectFormValues();
    const built = applyRouteProxyHeader(
      coreBuildRequest({
        baseUrl,
        path,
        method,
        preserveMethodCase: Boolean(operation.identity),
        debugModel,
        formValues,
        auth: authValues,
        applicationParams: applicationParamValues,
        globalParams: globalParamValues,
        securityKeys,
      }),
      activeSwaggerGroup?.header,
      {
        origin: currentOrigin(),
        contextPath: groupContextPath,
      },
    );
    const curlWithoutEnvelope = buildPreviewCurl(built, effectiveCookieSource, t('apiDebug.cookie.sessionCurl'));
    const multipartPlan = built.formBodyPlan?.kind === 'multipart' ? built.formBodyPlan : undefined;
    if (isOas32 && getCurrentCategory() === 'multipart' && !multipartPlan) {
      throw new Error(t('apiDebug.formDiagnostic.FORMDATA_UNREPRESENTABLE'));
    }
    const files = (formValues.fileFields ?? {}) as Record<string, File[]>;
    const materializedMultipart =
      multipartPlan && (isOas32 || multipartPlanNeedsEncodedEnvelope(multipartPlan))
        ? (multipartMaterializationRef.current = reuseMaterializedMultipartBody(
            multipartMaterializationRef.current,
            multipartPlan,
            files,
          )).value
        : undefined;
    if (materializedMultipart?.contentType) {
      applyMaterializedMultipartContentType(built.headers, materializedMultipart.contentType);
      built.contentType = materializedMultipart.contentType;
    }
    const curl = materializedMultipart
      ? buildPreviewCurl(built, effectiveCookieSource, t('apiDebug.cookie.sessionCurl'))
      : curlWithoutEnvelope;
    return {
      formValues,
      built,
      curl,
      cookieParameterSource: effectiveCookieSource,
      credentials: cookieSession.credentials,
      materializedMultipart,
    };
  };

  const buildHistoryFormSnapshot = (): DebugHistoryFormSnapshot => {
    const fileFieldNames: Record<string, string[]> = {};
    for (const [name, fileList] of Object.entries(fileFieldsRef.current)) {
      if (fileList.length > 0) {
        fileFieldNames[name] = fileList.map((file) => file.name);
      }
    }
    if (binaryBodyFileRef.current) fileFieldNames['$body'] = [binaryBodyFileRef.current.name];
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
    debugDefaultEditRevisionRef.current += 1;
    const snap = entry.formSnapshot;
    if (snap) {
      setOas32ParameterEntries(
        restoreOas32ParameterEntries(snap.oas32ParameterEntries, snap.serializedExampleParameters),
      );
      setSerializedBodyMedia32(snap.serializedExampleBodyMediaType);
      setCookieParameterSource(snap.cookieParameterSource ?? 'explicit');
      if (isOas32) server32.restoreOverride(snap.baseUrl);
      else setBaseUrl(snap.baseUrl);
      setMethod(snap.method);
      setPath(snap.path);
      setParamValues(snap.paramValues);
      setParamEnabled(snap.paramEnabled);
      setSelectedContentType(snap.selectedContentType);
      setBody(snap.body);
      setFormFields(snap.formFields);
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
      setFormPartHeaders(mergeCachedFormPartHeaders(snapshotBodyContent, restoredPartHeaders));
      setFormPartContentTypes({ ...(snap.formPartContentTypes ?? {}) });
      setRawMode(snap.rawMode);
      setCustomQueryParams(snap.customQueryParams);
      setCustomBodyParams(snap.customBodyParams);
      const restoredHeaders = snap.customHeaders.filter(
        (row) => row.value !== DEBUG_HISTORY_MASK && !isSensitiveHeaderName(row.name),
      );
      const restoredCookies = snap.customCookies.filter(
        (row) => row.value !== DEBUG_HISTORY_MASK && !isSensitiveHeaderName(row.name),
      );
      setCustomHeaders(restoredHeaders);
      setCustomCookies(restoredCookies);
      fileFieldsRef.current = {};
      binaryBodyFileRef.current = null;
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
    if (!debugModel) return;
    const failWithoutFetch = (message: string, tab?: string) => {
      if (tab) setActiveTab(tab);
      discardUnsentDebugResponse(response);
      sseAbortRef.current?.abort();
      sseAbortRef.current = null;
      setSseStreaming(false);
      setResponse(null);
      setSseEvents(null);
      setResponseSchemaDiagnostic(null);
      setError(message);
    };
    if (isOas32 && serverOrPathUnavailable32) {
      failWithoutFetch(t('oas32.server.unavailable'));
      return;
    }
    setError(null);
    if (isOas32 && options.prepared) {
      const current = buildRequestPreviewSafely(buildPreview);
      if (
        !current.ok ||
        current.value.built.url !== options.prepared.built.url ||
        current.value.built.method !== options.prepared.built.method
      ) {
        failWithoutFetch(t('oas32.server.changed'));
        return;
      }
    }

    const previewResult: RequestPreviewBuildResult = resolveSendPreview(
      options.prepared,
      displayedPreviewRef.current,
      buildPreview,
    );
    if (!previewResult.ok) {
      setValidationErrors([]);
      failWithoutFetch(previewResult.error, debugModel.parameterDiagnostics?.[0]?.in ?? 'query');
      return;
    }
    const {
      formValues,
      built,
      cookieParameterSource: requestCookieSource = 'explicit',
      credentials = 'same-origin',
      materializedMultipart: preparedMultipart,
    } = previewResult.value;

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
        ? binaryBodyFileRef.current !== null
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
        setPendingSchemaOverride({
          preview: previewResult.value,
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
        : isBinaryBody && binaryBodyFileRef.current
          ? JSON.stringify({ file: binaryBodyFileRef.current.name, size: binaryBodyFileRef.current.size })
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
        contentType: built.contentType || getEffectiveContentType(),
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
    setSseStreaming(false);
    setBuiltRequest(built);
    setBuiltRequestCookieSource(requestCookieSource);
    const start = Date.now();
    let abortController: AbortController | null = null;
    /** Accumulated SSE payloads for history (mirrors UI events, independent of React state). */
    const sseCollected: SseEvent[] = [];
    try {
      abortController = new AbortController();
      sseAbortRef.current = abortController;

      const init: RequestInit = {
        method: built.method,
        headers: built.headers,
        credentials,
        signal: abortController.signal,
      };

      if (isOas32 && isMultipart && !preparedMultipart && !multipartPlan) {
        throw new Error(t('apiDebug.formDiagnostic.FORMDATA_UNREPRESENTABLE'));
      }
      if (preparedMultipart) {
        init.body = preparedMultipart.body;
        applyMaterializedMultipartContentType(init.headers as Record<string, string>, preparedMultipart.contentType);
      } else if (multipartPlan && (isOas32 || multipartPlanNeedsEncodedEnvelope(multipartPlan))) {
        throw new Error(t('apiDebug.formDiagnostic.FORMDATA_UNREPRESENTABLE'));
      } else if (isMultipart) {
        // 构建 FormData
        const fd = new FormData();
        const jsonFieldSet = new Set(formValues.jsonFields ?? []);
        // 添加普通字段（非 JSON part）
        for (const [name, value] of Object.entries(multipartTextFields)) {
          if (jsonFieldSet.has(name)) {
            // JSON-encoded part: append as Blob with application/json content type
            fd.append(name, new Blob([value], { type: 'application/json' }), `${name}.json`);
          } else {
            fd.append(name, value);
          }
        }
        // 添加文件字段
        //
        // issue #251: single-file fields must only append ONE part even if the user
        // (or a Upload control bug) staged multiple. The server-side contract for
        // `@RequestPart("file") MultipartFile file` binds to the first part and
        // silently drops the rest, which is an invisible data-loss bug. We use
        // `fileFieldsMultiple` from knife4j-core to decide, matching the UI control
        // rendered in MultipartForm.
        const multipleFileNames = new Set(activeBodyContent?.fileFieldsMultiple ?? []);
        const files = multipartFiles;
        for (const [name, fileList] of Object.entries(files)) {
          if (fileList.length === 0) continue;
          if (multipleFileNames.has(name)) {
            for (const file of fileList) {
              fd.append(name, file);
            }
          } else {
            // Single-file: only the first staged file is sent. Belt-and-braces alongside
            // <Upload maxCount={1}>.
            fd.append(name, fileList[0]);
          }
        }
        init.body = fd;
        // 不设 Content-Type，让浏览器自动设 boundary
        delete (init.headers as Record<string, string>)['Content-Type'];
      } else if (isBinaryBody && binaryBodyFileRef.current) {
        init.body = binaryBodyFileRef.current;
      } else {
        if (built.body !== undefined && (built.body !== '' || built.explicitExampleBody === true)) {
          init.body = built.body;
        }
      }

      const res = await fetch(built.url, init);
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const contentType = responseHeaders['content-type'] ?? '';
      const durationMs = Date.now() - start;

      // SSE path: text/event-stream → stream via ReadableStream reader
      if (contentType.toLowerCase().includes('text/event-stream')) {
        if (!isCurrentDebugRequest()) {
          // Still record that SSE started and was superseded.
          finalizeHistoryEntry(requestDebugCacheKey, pendingHistoryId, (entry) =>
            completeEntry(entry, {
              status: 'completed',
              httpStatus: res.status,
              statusText: res.statusText,
              durationMs,
              isSse: true,
              responseBody: '[SSE] superseded by another request',
            }),
          );
          return;
        }
        setLoading(false);
        if (!res.body) {
          finalizeHistoryEntry(requestDebugCacheKey, pendingHistoryId, (entry) =>
            completeEntry(entry, {
              status: 'error',
              httpStatus: res.status,
              statusText: res.statusText,
              durationMs,
              isSse: true,
              errorMessage: 'SSE response has no body',
            }),
          );
          setError('SSE response has no body');
          sseAbortRef.current = null;
          setSseStreaming(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        setSseEvents([]);
        setSseStreaming(true);

        const pushSseEvent = (data: string) => {
          const event: SseEvent = { data, timestamp: Date.now() };
          sseCollected.push(event);
          setSseEvents((prev) => [...(prev ?? []), event]);
        };

        const sseHistoryBody = () => formatSseHistoryResponseBody(sseCollected);

        const processChunk = (chunk: string) => {
          if (!isCurrentDebugRequest()) return;
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trimEnd();
            if (trimmed.startsWith('data:')) {
              pushSseEvent(trimmed.slice(5).trimStart());
            }
          }
        };

        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!isCurrentDebugRequest()) {
              finalizeHistoryEntry(requestDebugCacheKey, pendingHistoryId, (entry) => ({
                ...abortEntry(entry, { durationMs: Date.now() - start }),
                isSse: true,
                httpStatus: res.status,
                statusText: res.statusText,
                responseBody: sseHistoryBody() || undefined,
              }));
              return;
            }
            processChunk(decoder.decode(value, { stream: true }));
          }
          // flush remaining buffer
          if (buffer.trim().startsWith('data:')) {
            const data = buffer.trim().slice(5).trimStart();
            if (data && isCurrentDebugRequest()) {
              pushSseEvent(data);
            }
          }
          finalizeHistoryEntry(requestDebugCacheKey, pendingHistoryId, (entry) =>
            completeEntry(entry, {
              status: 'completed',
              httpStatus: res.status,
              statusText: res.statusText,
              durationMs: Date.now() - start,
              isSse: true,
              // Full event payloads (truncated by debugHistory completeEntry if over 64KB).
              responseBody: sseHistoryBody() || undefined,
            }),
          );
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') {
            finalizeHistoryEntry(requestDebugCacheKey, pendingHistoryId, (entry) => ({
              ...abortEntry(entry, { durationMs: Date.now() - start }),
              isSse: true,
              httpStatus: res.status,
              statusText: res.statusText,
              // Keep partial stream so history is still useful after cancel.
              responseBody: sseHistoryBody() || undefined,
            }));
            if (!isCurrentDebugRequest()) {
              return;
            }
            // user aborted — not an error
          } else if (!isCurrentDebugRequest()) {
            finalizeHistoryEntry(requestDebugCacheKey, pendingHistoryId, (entry) =>
              completeEntry(entry, {
                status: 'error',
                durationMs: Date.now() - start,
                isSse: true,
                errorMessage: err instanceof Error ? err.message : String(err),
                responseBody: sseHistoryBody() || undefined,
              }),
            );
            return;
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            finalizeHistoryEntry(requestDebugCacheKey, pendingHistoryId, (entry) =>
              completeEntry(entry, {
                status: 'error',
                httpStatus: res.status,
                statusText: res.statusText,
                durationMs: Date.now() - start,
                isSse: true,
                errorMessage: msg,
                responseBody: sseHistoryBody() || undefined,
              }),
            );
            setError(msg);
          }
        } finally {
          if (sseAbortRef.current === abortController) {
            sseAbortRef.current = null;
          }
          setSseStreaming(false);
        }
        return;
      }

      // Non-SSE path: read once as blob so we can branch by content-type without draining the stream twice.
      const blob = await readResponseBlob(res, (progress) => {
        if (isCurrentDebugRequest()) setResponseProgress(progress);
      });
      const blobContentType = contentType || blob.type;
      const contentDisposition = responseHeaders['content-disposition'];
      const { kind, rawText, objectUrl, filename } = await interpretResponseBlob(
        blob,
        blobContentType,
        built.url,
        contentDisposition,
      );

      finalizeHistoryEntry(requestDebugCacheKey, pendingHistoryId, (entry) =>
        completeEntry(entry, {
          status: 'completed',
          httpStatus: res.status,
          statusText: res.statusText,
          durationMs: Date.now() - start,
          responseBody: rawText,
        }),
      );

      if (!isCurrentDebugRequest()) {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
        }
        return;
      }

      const completedResponse: DebugResponsePayload = {
        status: res.status,
        statusText: res.statusText,
        method: built.method,
        duration: Date.now() - start,
        contentType: blobContentType,
        size: blob.size,
        headers: responseHeaders,
        rawText,
        objectUrl,
        filename,
        kind,
      };
      setResponse(completedResponse);

      const responseSchemaPreparation = prepareResponseBodySchemaEvaluation({
        document: swaggerDoc,
        operation,
        statusCode: res.status,
        contentType: blobContentType,
        body: rawText,
        session: currentSchemaEngineRef.current.status === 'ready' ? currentSchemaEngineRef.current.session : undefined,
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
    } catch (reason: unknown) {
      if (reason instanceof Error && reason.name === 'AbortError') {
        finalizeHistoryEntry(requestDebugCacheKey, pendingHistoryId, (entry) =>
          abortEntry(entry, { durationMs: Date.now() - start }),
        );
        if (!isCurrentDebugRequest()) return;
      } else {
        const msg = reason instanceof Error ? reason.message : String(reason);
        finalizeHistoryEntry(requestDebugCacheKey, pendingHistoryId, (entry) =>
          completeEntry(entry, {
            status: 'error',
            durationMs: Date.now() - start,
            errorMessage: msg,
          }),
        );
        if (!isCurrentDebugRequest()) return;
        setError(msg);
      }
    } finally {
      if (isCurrentDebugRequest()) {
        setLoading(false);
        setResponseProgress(null);
      }
      if (sseAbortRef.current === abortController) {
        sseAbortRef.current = null;
      }
    }
  };

  const handleSseAbort = () => {
    sseAbortRef.current?.abort();
    sseAbortRef.current = null;
    setSseStreaming(false);
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
    debugDefaultEditRevisionRef.current = 0;
    const resetState = buildInitialDebugState(debugModel, operation, swaggerDoc, defaultBaseUrl, bodyDefaults);
    applyInitialDebugState(resetState);
    appliedOas31ExampleIdentityRef.current = activeOas31Examples ? oas31ExampleIdentity : null;
    setLoading(false);
    setResponseProgress(null);
    setResponse(null);
    setError(null);
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

  // 每次渲染都实时重建一次，保证预览与当前表单同步；非法规范组合转成可见错误。
  const previewResult = buildRequestPreviewSafely(buildPreview);
  displayedPreviewRef.current = previewResult;
  const previewBuilt = previewResult.ok ? previewResult.value.built : undefined;
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
    debugModel.bodyContents.length > 0
      ? `${t('apiDebug.tab.body')} (${getEffectiveContentType()})`
      : t('apiDebug.tab.body');
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
    debugDefaultEditRevisionRef.current += 1;
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
    debugDefaultEditRevisionRef.current += 1;
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
    (!previewResult.ok && /querystring|QUERYSTRING_SOURCE_CONFLICT/i.test(previewResult.error)) ||
    (previewBuilt?.oas32ParameterPlan?.diagnostics.some(
      (diagnostic) => diagnostic.code === 'QUERYSTRING_SOURCE_CONFLICT',
    ) ??
      false);

  const tabItems = [
    {
      key: 'path',
      label: `${t('apiDebug.tab.path')} (${debugModel.pathParams.length})`,
      disabled: false,
      children: (
        <>
          {renderExamplePickers32('path')}
          <Table
            size="small"
            dataSource={pathParams}
            columns={paramColumnsFor(pathParams)}
            pagination={false}
            rowKey={paramKey}
            tableLayout="fixed"
            scroll={PARAM_TABLE_SCROLL}
            locale={{ emptyText: t('apiDebug.noPathParams') }}
          />
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
            <Table
              size="small"
              dataSource={queryParams}
              columns={paramColumnsFor(queryParams)}
              pagination={false}
              rowKey={paramKey}
              tableLayout="fixed"
              scroll={PARAM_TABLE_SCROLL}
              locale={{ emptyText: t('apiDebug.noQueryParams') }}
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
            <Alert type="error" showIcon message={t('apiDebug.querystring.conflict')} style={{ marginTop: 12 }} />
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
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                {renderExamplePickers32('querystring')}
                {querystringConflict && <Alert type="error" showIcon message={t('apiDebug.querystring.conflict')} />}
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
                <Alert type="info" showIcon message={t('apiDebug.querystring.emptyHint')} />
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
            <Table
              size="small"
              dataSource={headerParams}
              columns={paramColumnsFor(headerParams)}
              pagination={false}
              rowKey={paramKey}
              tableLayout="fixed"
              scroll={PARAM_TABLE_SCROLL}
              locale={{
                emptyText:
                  debugModel.bodyContents.length > 0 ? t('apiDebug.header.autoInject') : t('apiDebug.noHeaderParams'),
              }}
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
            <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
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
                message={t(
                  effectiveCookieSource === 'browser-session'
                    ? 'apiDebug.cookie.sessionTip'
                    : 'apiDebug.cookie.explicitTip',
                )}
              />
            </Space>
          )}
          <Table
            size="small"
            dataSource={cookieParams}
            columns={paramColumnsFor(cookieParams)}
            pagination={false}
            rowKey={paramKey}
            tableLayout="fixed"
            scroll={PARAM_TABLE_SCROLL}
            locale={{ emptyText: t('apiDebug.noCookieParams') }}
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
              message={t('schema.example.loading.title')}
              description={t('schema.example.loading.description')}
              style={{ marginBottom: 12 }}
            />
          )}
          {currentBodyExampleResult && (
            <SchemaExampleNotice result={currentBodyExampleResult} style={{ marginBottom: 12 }} />
          )}
          {serializedBodyMedia32 === selectedContentType ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space>
                <Select
                  aria-label={t('apiDebug.body.contentType')}
                  value={selectedContentType}
                  options={debugModel.bodyContents.map((content) => ({
                    value: content.mediaType,
                    label: content.mediaType,
                  }))}
                  onChange={(media) => {
                    debugDefaultEditRevisionRef.current += 1;
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
                    debugDefaultEditRevisionRef.current += 1;
                    setSerializedBodyMedia32(undefined);
                  }}
                >
                  {t('schema.example32.editFields')}
                </Button>
              </Space>
              <Typography.Text>{t('schema.example32.serialized')}</Typography.Text>
              <CodeEditor
                value={body}
                onChange={setBodyFromUser}
                language={getCurrentCategory() === 'json' ? 'json' : 'text'}
              />
            </Space>
          ) : (
            <BodyTab
              key={resetNonce}
              debugModel={debugModel}
              bodyDefaults={bodyDefaults}
              body={body}
              setBody={setBodyFromUser}
              selectedContentType={selectedContentType}
              setSelectedContentType={(media) => {
                debugDefaultEditRevisionRef.current += 1;
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
              fileFieldsRef={fileFieldsRef}
              binaryBodyFileRef={binaryBodyFileRef}
              rawMode={rawMode}
              setRawMode={setRawMode}
            />
          )}
        </>
      ),
    },
    {
      key: 'preview',
      label: t('apiDebug.tab.preview'),
      disabled: false,
      children: (
        <PreviewTabPanel
          result={previewResult}
          onCopyText={handleCopyPreviewText}
          onDownloadMultipartBody={triggerMultipartBodyDownload}
        />
      ),
    },
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
  const currentActiveTab = activeTab ?? defaultTab;
  const responsePercent =
    responseProgress?.totalBytes === null || responseProgress === null
      ? null
      : Math.min(99, Math.floor((responseProgress.receivedBytes / responseProgress.totalBytes) * 100));

  return (
    <OperationModeLayout activeKey="debug">
      <Oas31DebugExampleLoader
        enabled={isOas31}
        document={swaggerDoc}
        operation={operation}
        debugModel={debugModel}
        session={schemaEngine.status === 'ready' ? schemaEngine.session : null}
        identity={oas31ExampleIdentity}
        setState={setOas31ExampleState}
      />
      <Oas31DebugDefaultHydrator
        activeExamples={activeOas31Examples}
        state={oas31ExampleState}
        identity={oas31ExampleIdentity}
        editRevisionRef={debugDefaultEditRevisionRef}
        appliedIdentityRef={appliedOas31ExampleIdentityRef}
        hydratedDebugCacheKey={hydratedDebugCacheKey}
        currentDebugCacheKey={debugCacheKey}
        selectedBody={debugModel.bodyContents.find((content) => content.mediaType === selectedContentType)}
        setBody={setBody}
        setFormFields={setFormFields}
      />
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
          if (first)
            setActiveTab(first.target === 'body' ? 'body' : first.in === 'querystring' ? 'querystring' : first.in);
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
          <Space align="center" style={{ marginBottom: 12 }}>
            <Tag color={METHOD_COLORS[method] ?? 'default'} style={{ fontSize: 14, padding: '2px 8px' }}>
              {method}
            </Tag>
            <Title level={5} style={{ margin: 0 }}>
              {operation.operation.summary ?? operation.path}
            </Title>
          </Space>

          {pathDiagnostics32.map((diagnostic) => (
            <Alert
              key={`${diagnostic.code}:${diagnostic.path}`}
              type="warning"
              message={diagnostic.code}
              description={`${diagnostic.path}: ${diagnostic.reason}`}
              style={{ marginBottom: 8 }}
            />
          ))}
          {methodConstraintMessage && (
            <Alert type="warning" showIcon message={methodConstraintMessage} style={{ marginBottom: 12 }} />
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
                <Oas32ServerDetails server={server32.resolved} override={server32.override} />
              ) : (
                <Alert
                  type="warning"
                  message={t('oas32.server.unavailable')}
                  description={server32.declarations?.diagnostics
                    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.reason}`)
                    .join('; ')}
                />
              )}
            </div>
          )}
          <Space.Compact style={{ width: '100%', marginBottom: 16, display: 'flex' }}>
            <Select
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
                value={baseUrl}
                title={baseUrl}
                onChange={setBaseUrl}
                options={requestServerSelectOptions}
                filterOption={false}
                style={{ flex: '0 1 420px', minWidth: 320 }}
              />
            )}
            <Input
              value={displayPath}
              title={displayPath}
              onChange={(event) => handlePathInputChange(event.target.value)}
              style={{ flex: '1 1 220px', minWidth: 0 }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={() => void handleSend()}
              disabled={Boolean(methodConstraintMessage) || (isOas32 && serverOrPathUnavailable32)}
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

          <Tabs
            activeKey={currentActiveTab}
            defaultActiveKey={defaultTab}
            onChange={(key) => setActiveTab(key)}
            size="small"
            items={tabItems}
          />

          <Divider style={{ margin: '16px 0' }} />

          {loading &&
            (responseProgress === null ? (
              <Spin tip={t('apiDebug.sending')} style={{ display: 'block', margin: '24px auto' }} />
            ) : responsePercent === null ? (
              <div style={{ margin: '24px auto', textAlign: 'center' }}>
                <Spin />
                <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                  {t('apiDebug.receiving', { received: formatByteSize(responseProgress.receivedBytes) })}
                </Text>
              </div>
            ) : (
              <div style={{ maxWidth: 480, margin: '24px auto', textAlign: 'center' }}>
                <Progress percent={responsePercent} status="active" />
                <Text type="secondary">
                  {t('apiDebug.receivingOf', {
                    received: formatByteSize(responseProgress.receivedBytes),
                    total: formatByteSize(responseProgress.totalBytes!),
                  })}
                </Text>
              </div>
            ))}
          <ResponsePanel
            response={response}
            error={error}
            builtRequest={builtRequest}
            builtRequestCookieSource={builtRequestCookieSource}
            operation={operation}
            swaggerDoc={swaggerDoc}
            sseEvents={sseEvents}
            onSseAbort={handleSseAbort}
            sseStreaming={sseStreaming}
            schemaDiagnostic={responseSchemaDiagnostic}
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
