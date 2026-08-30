import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type {
  BodyContent,
  BuiltRequest,
  DebugFormValues,
  DebugParam,
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
  buildCurl,
  buildOperationDebugModel,
  buildRequest as coreBuildRequest,
  replacePathParams,
  replaceSerializedPathParams,
  serializeOas31Parameters,
  validateRequired,
} from 'knife4j-core';
import { OperationModeLayout, useCurrentOperation } from './useCurrentOperation';
import CodeEditor, { type CodeEditorLanguage } from '../../components/CodeEditor';
import DescriptionText from '../../components/DescriptionText';
import RevealableValue from '../../components/RevealableValue';
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
  type RequestPreviewBuild,
  type RequestPreviewBuildResult,
} from './requestPreviewBuild';
import { copyToClipboard } from '../../utils/clipboard';
import {
  EMPTY_BODY_CONTENT_DEFAULTS,
  buildBodyContentDefaults,
  buildInitialParamValues,
  extractSchemaFields,
  initialBodyValueForContent,
  initialFormFieldsForContent,
  mergeCachedFormFields,
  paramKey,
  stringifyDebugValue,
  type BodyContentDefaults,
  type ParamValueMap,
  type SchemaFieldRow,
} from './debugDefaultValues';
import { API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS, apiDebugParamTableScrollX } from './apiDebugParamTableLayout';
import { resolveApiDebugParamSelection, setApiDebugParamsEnabled } from './apiDebugParamSelection';
import { buildInitialParamEnabled, collectOas31ParameterValues, isNullableOas31Parameter } from './oas31ParameterForm';
import { formatByteSize, readResponseBlob, type ResponseBodyProgress } from './responseBodyProgress';
import { customRowsToRecord, mergeCustomBodyParams, reservedBodyFieldNames } from './customParamRows';
import { browserRequestConstraint } from './browserRequestConstraints';
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

const { TextArea } = Input;
const { Paragraph, Text, Title } = Typography;
const PARAM_TABLE_SCROLL = { x: apiDebugParamTableScrollX() };

type RequestSchemaDiagnosticIssue =
  | { readonly kind: 'invalid-json'; readonly target: 'body' }
  | ({ readonly kind: 'invalid-json'; readonly target: 'parameter' } & ParameterInputDiagnostic)
  | {
      readonly kind: 'invalid-schema';
      readonly target: 'body';
      readonly instanceLocation: string;
      readonly keyword: string;
      readonly absoluteKeywordLocation: string;
    }
  | ({ readonly kind: 'invalid-schema'; readonly target: 'parameter' } & ParameterSchemaIssue);

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

  // JSON part (encoding.contentType = application/json) → TextArea
  if (field.isJson) {
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
                      ? 'multipart/form-data'
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
  fileFieldsRef: React.MutableRefObject<Record<string, File[]>>;
}

function MultipartForm({ bodyContent, formFields, setFormFields, fileFieldsRef }: MultipartFormProps) {
  const { t } = useTranslation();
  const [fileListMap, setFileListMap] = useState<Record<string, UploadFile[]>>({});
  const fields = useMemo(() => extractSchemaFields(bodyContent), [bodyContent]);

  const updateField = (name: string, value: string) => {
    setFormFields((prev) => ({ ...prev, [name]: value }));
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
        if (record.isFile) {
          // issue #251: only enable multi-select for schemas that are actually array
          // of binary/base64. Otherwise the server endpoint is a single-file handler
          // (e.g. `@RequestPart("file") MultipartFile file`) and extra parts get
          // silently dropped, which looks like success but isn't.
          //
          // `maxCount={1}` on top of `multiple={false}` makes the UI replace the
          // previously staged file on re-select instead of appending — matches user
          // expectation for a single-file control.
          return (
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
        }
        if (record.isJson) {
          return (
            <TextArea
              size="small"
              value={formFields[record.name] ?? '{}'}
              onChange={(event) => updateField(record.name, event.target.value)}
              placeholder={t('apiDebug.body.jsonPart.placeholder')}
              autoSize={{ minRows: 3, maxRows: 8 }}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          );
        }
        return (
          <SchemaFieldInput
            field={record}
            value={formFields[record.name] ?? ''}
            onChange={(next) => updateField(record.name, next)}
          />
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
        </Space>
      ),
    },
  ];

  return <Table size="small" dataSource={fields} columns={columns} pagination={false} rowKey="name" />;
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
}

function PreviewTabPanel({ result, onCopyText }: PreviewTabPanelProps) {
  const { t } = useTranslation();
  if (!result.ok) {
    return <Alert type="error" showIcon message={t('apiDebug.error.title')} description={result.error} />;
  }
  const { built, curl } = result.value;
  const isMultipart = built.contentType.toLowerCase().includes('multipart/form-data');
  const hasBody = built.body !== undefined && built.body !== '';

  const prettyJson = (raw: string): string => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  };

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
        <Text strong>{isMultipart ? t('apiDebug.preview.bodyMultipart') : t('apiDebug.preview.body')}</Text>
        {hasBody ? (
          <pre style={previewBoxStyle}>
            {built.contentType.includes('json') ? prettyJson(built.body ?? '') : (built.body ?? '')}
          </pre>
        ) : (
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            {t('apiDebug.preview.noBody')}
          </Text>
        )}
      </div>

      {/* Curl */}
      <div>
        <Space style={{ marginBottom: 4 }}>
          <Text strong>{t('apiDebug.preview.curl')}</Text>
          <Button size="small" onClick={() => onCopyText(curl)}>
            {t('apiDebug.preview.copyCurl')}
          </Button>
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
  baseUrl: string;
  method: string;
  path: string;
  paramValues: ParamValueMap;
  paramEnabled: Record<string, boolean>;
  selectedContentType: string;
  body: string;
  formFields: Record<string, string>;
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
    baseUrl,
    method: operation.method.toUpperCase(),
    path: operation.path,
    paramValues,
    paramEnabled,
    selectedContentType: firstBody?.mediaType ?? '',
    body: initialBodyValueForContent(firstBody, bodyDefaults),
    formFields: initialFormFieldsForContent(firstBody, bodyDefaults),
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
): InitialDebugState {
  if (!cached) return initial;

  const cachedMethod = cached.method.toUpperCase();
  const cachedBody = debugModel.bodyContents.find(
    (bodyContent) => bodyContent.mediaType === cached.selectedContentType,
  );
  const selectedBody = cachedBody ?? debugModel.bodyContents[0];
  const restoreCachedBody = Boolean(cachedBody);

  return {
    ...initial,
    baseUrl: cached.baseUrl || initial.baseUrl,
    method: DEBUG_HTTP_METHODS.has(cachedMethod) ? cachedMethod : initial.method,
    path: cached.path || initial.path,
    paramValues: mergeCachedStringRecord(initial.paramValues, cached.paramValues),
    paramEnabled: mergeCachedBooleanRecord(initial.paramEnabled, cached.paramEnabled),
    selectedContentType: selectedBody?.mediaType ?? '',
    body: restoreCachedBody ? cached.body : initialBodyValueForContent(selectedBody, bodyDefaults),
    formFields: restoreCachedBody
      ? mergeCachedFormFields(selectedBody, cached.formFields, bodyDefaults)
      : initialFormFieldsForContent(selectedBody, bodyDefaults),
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
  const { activeSwaggerGroup, routeGroupReady } = useGroup();
  const { settings } = useSettings();
  const schemaEngine = useSchemaEngine();
  const groupContextPath = activeSwaggerGroup?.contextPath;
  const operationMethod = operation?.method;
  const operationPath = operation?.path;
  const debugCacheKey = useMemo(() => {
    if (!group || !tag || !operaterId || !operationMethod || !operationPath) return null;
    return [group, tag, operaterId, operationMethod, operationPath].join('|');
  }, [group, operaterId, operationMethod, operationPath, tag]);
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
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
  const [paramValues, setParamValues] = useState<ParamValueMap>({});
  // enabled state: keyed by paramKey; empty optional OAS 3.1 params start omitted.
  const [paramEnabled, setParamEnabled] = useState<Record<string, boolean>>({});
  const [body, setBody] = useState('');
  const [customQueryParams, setCustomQueryParams] = useState<CustomParamRow[]>([]);
  const [customBodyParams, setCustomBodyParams] = useState<CustomParamRow[]>([]);
  const [customHeaders, setCustomHeaders] = useState<CustomParamRow[]>([]);
  const [customCookies, setCustomCookies] = useState<CustomParamRow[]>([]);
  const debugModel = useMemo<OperationDebugModel | null>(() => {
    if (!operation || !swaggerDoc) return null;
    return buildOperationDebugModel({
      doc: swaggerDoc as unknown as Record<string, unknown>,
      path: operation.path,
      method: operation.method,
      isOAS2: Boolean((swaggerDoc as unknown as Record<string, unknown>).swagger),
    });
  }, [operation, swaggerDoc]);
  const bodyDefaults = useMemo(
    () =>
      swaggerDoc && operation && debugModel
        ? buildBodyContentDefaults(swaggerDoc, operation, debugModel)
        : EMPTY_BODY_CONTENT_DEFAULTS,
    [debugModel, operation, swaggerDoc],
  );
  const [loading, setLoading] = useState(false);
  const [responseProgress, setResponseProgress] = useState<ResponseBodyProgress | null>(null);
  const [response, setResponse] = useState<DebugResponsePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [builtRequest, setBuiltRequest] = useState<BuiltRequest | null>(null);
  const [sseEvents, setSseEvents] = useState<SseEvent[] | null>(null);
  const [sseStreaming, setSseStreaming] = useState(false);
  const sseAbortRef = useRef<AbortController | null>(null);
  const activeDebugCacheKeyRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const schemaValidationRevisionRef = useRef(0);
  const schemaValidationAbortRef = useRef<AbortController | null>(null);
  const [schemaValidating, setSchemaValidating] = useState(false);
  const [pendingSchemaOverride, setPendingSchemaOverride] = useState<PendingSchemaOverride | null>(null);
  /** Pending history entry id for the in-flight request (strategy C). */
  const pendingHistoryIdRef = useRef<string | null>(null);
  const pendingHistoryCacheKeyRef = useRef<string | null>(null);

  // ── requestBody 多内容类型状态 ──
  const [selectedContentType, setSelectedContentType] = useState('');
  const [formFields, setFormFields] = useState<Record<string, string>>({});
  const fileFieldsRef = useRef<Record<string, File[]>>({});
  const binaryBodyFileRef = useRef<File | null>(null);
  const [rawMode, setRawMode] = useState<RawMode>('text');
  const [resetNonce, setResetNonce] = useState(0);
  const [hydratedDebugCacheKey, setHydratedDebugCacheKey] = useState<string | null>(null);
  const skipNextDebugCacheWriteRef = useRef(false);
  const [historyEntries, setHistoryEntries] = useState<DebugHistoryEntry[]>([]);

  // ── TASK-028: 校验错误与预览 ──
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);

  /** 当前缺失必填的 key 集合（统一 `${in}:${name}` 或 `body:requestBody`） */
  const errorKeys = useMemo(() => new Set(validationErrors.map((e) => e.key)), [validationErrors]);

  const initialDebugState = useMemo(() => {
    if (!debugModel || !operation || !swaggerDoc) return null;
    return buildInitialDebugState(debugModel, operation, swaggerDoc, defaultBaseUrl, bodyDefaults);
  }, [bodyDefaults, debugModel, operation, swaggerDoc, defaultBaseUrl]);

  useLayoutEffect(() => {
    activeDebugCacheKeyRef.current = debugCacheKey;
  }, [debugCacheKey]);

  useEffect(() => {
    schemaValidationRevisionRef.current += 1;
    schemaValidationAbortRef.current?.abort();
    schemaValidationAbortRef.current = null;
    setSchemaValidating(false);
    setPendingSchemaOverride(null);
  }, [debugCacheKey, schemaEngine]);

  useEffect(
    () => () => {
      schemaValidationAbortRef.current?.abort();
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
    setBaseUrl(initial.baseUrl);
    setMethod(initial.method);
    setPath(initial.path);
    setParamValues(initial.paramValues);
    setParamEnabled(initial.paramEnabled);
    setSelectedContentType(initial.selectedContentType);
    setBody(initial.body);
    setFormFields(initial.formFields);
    fileFieldsRef.current = {};
    binaryBodyFileRef.current = null;
    setRawMode(initial.rawMode);
    setCustomQueryParams(initial.customQueryParams);
    setCustomBodyParams(initial.customBodyParams);
    setCustomHeaders(initial.customHeaders);
    setCustomCookies(initial.customCookies);
    setBuiltRequest(null);
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
    const nextInitial = restoreInitialDebugStateFromCache(initialDebugState, cached, debugModel, bodyDefaults);
    skipNextDebugCacheWriteRef.current = true;
    requestSeqRef.current += 1;
    sseAbortRef.current?.abort();
    sseAbortRef.current = null;
    setSseStreaming(false);
    const cachedSession = debugCacheKey !== null ? readDebugSessionState(debugCacheKey) : null;
    applyInitialDebugState(nextInitial, { resetActiveTab: true });
    setLoading(false);
    setResponse(cachedSession?.response ?? null);
    setError(cachedSession?.error ?? null);
    setBuiltRequest(cachedSession?.builtRequest ?? null);
    setSseEvents(cachedSession?.sseEvents ?? null);
    setHydratedDebugCacheKey(debugCacheKey);
  }, [bodyDefaults, debugCacheKey, debugModel, initialDebugState, settings.enableRequestCache]);

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
      sseEvents,
    });
  }, [builtRequest, debugCacheKey, error, hydratedDebugCacheKey, response, sseEvents]);

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
      baseUrl,
      method,
      path,
      paramValues,
      paramEnabled,
      selectedContentType,
      body,
      formFields,
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
    debugCacheKey,
    formFields,
    method,
    paramEnabled,
    paramValues,
    path,
    rawMode,
    selectedContentType,
    settings.enableRequestCache,
    hydratedDebugCacheKey,
  ]);

  const updateValue = (param: DebugParam, next: string) => {
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
    const legacyPath = replacePathParams(path, pathParamValues);
    try {
      const oas31Values = collectOas31ParameterValues(debugModel, paramValues, paramEnabled);
      const serializedPath = serializeOas31Parameters(debugModel, oas31Values).path;
      return replaceSerializedPathParams(legacyPath, serializedPath);
    } catch {
      // The canonical preview reports the precise serialization diagnostic.
      // Keep the editable URL field usable while the value is incomplete.
      return legacyPath;
    }
  }, [path, debugModel, paramEnabled, paramValues]);

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
  const { effectiveParams, cookieSession } = useGlobalParam();
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
    const paramKeys = params.map(paramKey);
    const selection = resolveApiDebugParamSelection(paramKeys, paramEnabled);
    const selectAllLabel = t(selection.checked ? 'apiDebug.params.deselectAll' : 'apiDebug.params.selectAll');

    return [
      {
        title: (
          <Tooltip title={selectAllLabel}>
            <Checkbox
              aria-label={selectAllLabel}
              checked={selection.checked}
              indeterminate={selection.indeterminate}
              disabled={paramKeys.length === 0}
              onChange={(event) =>
                setParamEnabled((current) => setApiDebugParamsEnabled(current, paramKeys, event.target.checked))
              }
            />
          </Tooltip>
        ),
        key: 'enabled',
        width: API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS.enabled,
        render: (_value: unknown, record: DebugParam) => (
          <Checkbox
            checked={paramEnabled[paramKey(record)] !== false}
            onChange={(e) =>
              setParamEnabled((prev) => ({
                ...prev,
                [paramKey(record)]: e.target.checked,
              }))
            }
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
        render: (_value: string, record: DebugParam) => (
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
    const oas31ParameterValues = collectOas31ParameterValues(debugModel, paramValues, paramEnabled);

    return {
      pathParams: collectForIn(debugModel.pathParams),
      queryParams: { ...extraQueryParams, ...specQueryParams },
      headerParams: { ...extraHeaders, ...specHeaders },
      cookieParams: { ...extraCookieParams, ...specCookieParams },
      ...(Object.keys(oas31ParameterValues).length > 0 ? { oas31ParameterValues } : {}),
      selectedContentType: getEffectiveContentType(),
      body: category === 'json' || category === 'raw' ? body : undefined,
      binaryBodyFileName: currentBody?.binary ? binaryBodyFileRef.current?.name : undefined,
      formFields: structuredForm?.formFields,
      ...(formFieldNamesToIncludeWhenEmpty.length > 0 ? { formFieldNamesToIncludeWhenEmpty } : {}),
      fileFields: category === 'multipart' ? fileFieldsRef.current : undefined,
      jsonFields: category === 'multipart' ? (currentBody?.jsonFields ?? []) : undefined,
    };
  };

  /** 基于当前表单构建 BuiltRequest（不发请求，仅用于预览/curl/发送共用） */
  const buildPreview = (): RequestPreviewBuild => {
    const formValues = collectFormValues();
    const built = applyRouteProxyHeader(
      coreBuildRequest({
        baseUrl,
        path,
        method,
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
    const curl = buildCurl(built);
    return { formValues, built, curl };
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
      paramValues: { ...paramValues },
      paramEnabled: { ...paramEnabled },
      selectedContentType,
      body,
      formFields: { ...formFields },
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
    const snap = entry.formSnapshot;
    if (snap) {
      setBaseUrl(snap.baseUrl);
      setMethod(snap.method);
      setPath(snap.path);
      setParamValues(snap.paramValues);
      setParamEnabled(snap.paramEnabled);
      setSelectedContentType(snap.selectedContentType);
      setBody(snap.body);
      setFormFields(snap.formFields);
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
        snap.customCookies.some((row) => row.value === DEBUG_HISTORY_MASK || isSensitiveHeaderName(row.name));
      if (hadSensitive) {
        void message.info(t('apiDebug.history.sensitiveSkipped'));
      }
      return;
    }

    setBaseUrl(entry.baseUrl);
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
    setError(null);

    const previewResult: RequestPreviewBuildResult = options.prepared
      ? { ok: true, value: options.prepared }
      : buildRequestPreviewSafely(buildPreview);
    if (!previewResult.ok) {
      setValidationErrors([]);
      setActiveTab(debugModel.parameterDiagnostics?.[0]?.in ?? 'query');
      setError(previewResult.error);
      return;
    }
    const { formValues, built } = previewResult.value;

    // required 校验 — 用 core 侧统一校验，并携带定位 key
    const errors = validateRequired(debugModel, formValues);
    setValidationErrors(errors);
    if (errors.length > 0) {
      // 定位到第一个错误所在 Tab
      const first = errors[0];
      const nextTab = first.in === 'body' ? 'body' : first.in;
      setActiveTab(nextTab);
      setError(errors.map((e) => e.message).join('\n'));
      return;
    }

    // multipart 场景：需要手动构建 FormData（requestBuilder 只处理文本字段）
    const category = getCurrentCategory();
    const isMultipart = category === 'multipart';
    const activeBodyContent = debugModel.bodyContents.find((item) => item.mediaType === selectedContentType);
    const isBinaryBody = Boolean(activeBodyContent?.binary);
    // core 的 multipart built.body 是已经按发送规则过滤后的文本 part 映射，
    // 历史、cURL 和真实 FormData 共用它，避免在 UI 层维护第二套过滤逻辑。
    const multipartTextFields = isMultipart ? (JSON.parse(built.body ?? '{}') as Record<string, string>) : {};
    const hasMultipartFile = Object.values(fileFieldsRef.current).some((files) => files.length > 0);
    const hasBodyInput = isMultipart
      ? Object.keys(multipartTextFields).length > 0 || hasMultipartFile
      : isBinaryBody
        ? binaryBodyFileRef.current !== null
        : built.body !== undefined && built.body !== '';
    const browserConstraint = browserRequestConstraint(built.method, hasBodyInput);
    if (browserConstraint === 'unsupported-method') {
      setActiveTab('preview');
      setError(t('apiDebug.method.browserUnsupported', { method: built.method }));
      return;
    }
    if (browserConstraint === 'unsupported-body') {
      setActiveTab('body');
      setError(t('apiDebug.body.browserMethodUnsupported', { method: built.method }));
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
        built.parameterInputDiagnostics?.map((issue) => ({ ...issue, kind: 'invalid-json', target: 'parameter' })) ??
        [];
      let totalDiagnosticIssues = diagnosticIssues.length;
      const bodyPreparation = prepareRequestBodySchemaEvaluation({
        document: swaggerDoc,
        operation,
        schemaMediaType: selectedContentType,
        effectiveContentType: effectiveRequestContentType(built.headers, built.contentType),
        body: built.body,
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

      if (diagnosticIssues.length > 0) {
        const first = diagnosticIssues[0];
        setActiveTab(first.target === 'body' ? 'body' : first.in);
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
    const isCurrentDebugRequest = () =>
      activeDebugCacheKeyRef.current === requestDebugCacheKey && requestSeqRef.current === requestSeq;

    const historyEnabled = settings.enableRequestHistory && requestDebugCacheKey !== null;
    let pendingHistoryId: string | null = null;
    if (historyEnabled && requestDebugCacheKey) {
      // multipart: built.body only represents text fields and cannot carry filenames.
      // Persist the sent text parts + filename/size placeholders (binary content is never stored).
      const historyBody = isMultipart
        ? buildMultipartHistoryBody(
            multipartTextFields,
            Object.fromEntries(
              Object.entries(fileFieldsRef.current).map(([name, fileList]) => [
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
        formSnapshot: buildHistoryFormSnapshot(),
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
        credentials: cookieSession.credentials,
        signal: abortController.signal,
      };

      if (isMultipart) {
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
        const files = fileFieldsRef.current;
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
        if (built.body !== undefined && built.body !== '') {
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

      setResponse({
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
      });
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
    if (!initialDebugState) return;
    schemaValidationRevisionRef.current += 1;
    schemaValidationAbortRef.current?.abort();
    schemaValidationAbortRef.current = null;
    setSchemaValidating(false);
    setPendingSchemaOverride(null);
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
    applyInitialDebugState(initialDebugState);
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
  const previewBuilt = previewResult.ok ? previewResult.value.built : undefined;
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

  const pathParams = debugModel.pathParams.filter((param) => !param.readOnly);
  const queryParams = debugModel.queryParams.filter((param) => !param.readOnly);
  const headerParams = debugModel.headerParams.filter((param) => !param.readOnly);
  const cookieParams = debugModel.cookieParams.filter((param) => !param.readOnly);

  const tabItems = [
    {
      key: 'path',
      label: `${t('apiDebug.tab.path')} (${debugModel.pathParams.length})`,
      disabled: false,
      children: (
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
        </>
      ),
    },
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
          <CustomParamsSection
            title={t('apiDebug.customCookie.title')}
            addLabel={t('apiDebug.customParams.add')}
            namePlaceholder={t('apiDebug.customCookie.namePlaceholder')}
            valuePlaceholder={t('apiDebug.customParams.valuePlaceholder')}
            rows={customCookies}
            onChange={setCustomCookies}
          />
        </>
      ),
    },
    {
      key: 'body',
      label: bodyLabel,
      disabled: false,
      children: (
        <BodyTab
          key={resetNonce}
          debugModel={debugModel}
          bodyDefaults={bodyDefaults}
          body={body}
          setBody={setBody}
          selectedContentType={selectedContentType}
          setSelectedContentType={setSelectedContentType}
          formFields={formFields}
          setFormFields={setFormFields}
          enableDynamicParameter={settings.enableDynamicParameter}
          customBodyParams={customBodyParams}
          setCustomBodyParams={setCustomBodyParams}
          fileFieldsRef={fileFieldsRef}
          binaryBodyFileRef={binaryBodyFileRef}
          rawMode={rawMode}
          setRawMode={setRawMode}
        />
      ),
    },
    {
      key: 'preview',
      label: t('apiDebug.tab.preview'),
      disabled: false,
      children: <PreviewTabPanel result={previewResult} onCopyText={handleCopyPreviewText} />,
    },
  ];

  const defaultTab =
    debugModel.pathParams.length > 0
      ? 'path'
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
          if (first) setActiveTab(first.target === 'body' ? 'body' : first.in);
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

          <Space.Compact style={{ width: '100%', marginBottom: 16, display: 'flex' }}>
            <Select
              value={method}
              onChange={setMethod}
              style={{ width: 110, flex: '0 0 110px' }}
              options={Array.from(DEBUG_HTTP_METHODS).map((item) => ({
                value: item,
                label: item,
              }))}
            />
            <AutoComplete
              value={baseUrl}
              title={baseUrl}
              onChange={setBaseUrl}
              options={requestServerSelectOptions}
              filterOption={false}
              style={{ flex: '0 1 420px', minWidth: 320 }}
            />
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
              loading={loading || schemaValidating}
            >
              {t('apiDebug.send')}
            </Button>
            <Button icon={<ReloadOutlined />} onClick={handleReset}>
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
            operation={operation}
            swaggerDoc={swaggerDoc}
            sseEvents={sseEvents}
            onSseAbort={handleSseAbort}
            sseStreaming={sseStreaming}
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
