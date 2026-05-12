import { useEffect, useMemo, useRef, useState } from 'react';
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
import { SendOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import { useTranslation } from 'react-i18next';
import type {
  BodyContent,
  BuiltRequest,
  DebugFormValues,
  DebugParam,
  GlobalParamValues,
  OperationDebugModel,
  ParamSource,
  SchemeValue,
  ValidationError,
} from 'knife4j-core';
import {
  buildCurl,
  buildOperationDebugModel,
  buildRequest as coreBuildRequest,
  replacePathParams,
  validateRequired,
} from 'knife4j-core';
import { OperationModeLayout, useCurrentOperation } from './useCurrentOperation';
import CodeEditor, { type CodeEditorLanguage } from '../../components/CodeEditor';
import { useAuth } from '../../context/AuthContext';
import { useGlobalParam } from '../../context/GlobalParamContext';
import { useSettings } from '../../context/SettingsContext';
import ResponsePanel, { type DebugResponsePayload, type SseEvent } from './ResponsePanel';
import Authorize from '../Authorize';
import { COMMON_HEADER_NAMES } from '../../constants/httpHeaders';
import { currentOrigin, resolveRequestBaseUrl } from './requestBaseUrl';

const { TextArea } = Input;
const { Text, Title } = Typography;

const METHOD_COLORS: Record<string, string> = {
  GET: 'green',
  POST: 'blue',
  PUT: 'orange',
  DELETE: 'red',
  PATCH: 'purple',
  HEAD: 'cyan',
  OPTIONS: 'default',
};

// ─── Helper: form value shape ─────────────────────────
// Key by `${in}:${name}` to avoid cross-location name collisions
type ParamValueMap = Record<string, string>;

function paramKey(param: DebugParam): string {
  return `${param.in}:${param.name}`;
}

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

// ─── Initial value derivation ─────────────────────────

/**
 * 按优先级取参数的初始值：example > default > 类型空值
 * 返回始终是字符串（<Input> / JSON 字符串 / enum 选中值）。
 */
function initialValueFor(param: DebugParam): string {
  if (param.example !== undefined && param.example !== null) {
    return stringify(param.example, param.type);
  }
  if (param.default !== undefined && param.default !== null) {
    return stringify(param.default, param.type);
  }
  // 按类型生成空值
  switch (param.type) {
    case 'array':
    case 'object':
      return ''; // TextArea 占位；空字符串让 requestBuilder 走默认分支
    case 'boolean':
      return '';
    case 'integer':
    case 'number':
      return '';
    default:
      return '';
  }
}

function stringify(value: unknown, type: string): string {
  if (value === undefined || value === null) return '';
  if (type === 'array' || type === 'object') {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// ─── Schema property → field row for urlencoded / multipart ──────

interface SchemaFieldRow {
  name: string;
  type: string;
  format?: string;
  required: boolean;
  description?: string;
  default?: unknown;
  example?: unknown;
  enum?: unknown[];
  isFile: boolean;
  /**
   * File field backed by an array schema (`type:"array"` + `items.format:"binary"|"base64"`)
   * — the UI renders `<Upload multiple />` and the send handler appends every file
   * as a separate part. When `false`, the field is a single-file upload and **must**
   * only send one part even if the user somehow staged more (issue #251).
   */
  isMultipleFile: boolean;
  /** encoding.contentType=application/json — render as JSON TextArea */
  isJson: boolean;
}

/**
 * 从 BodyContent 的 schema.properties 提取字段行，过滤 readOnly 字段（请求不应包含只读字段）
 */
function extractSchemaFields(bodyContent: BodyContent): SchemaFieldRow[] {
  const schema = bodyContent.schema;
  if (!schema || schema.type !== 'object' || !schema.properties) return [];

  const props = schema.properties as Record<string, Record<string, unknown>>;
  const requiredSet = new Set<string>(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const fileFields = new Set(bodyContent.fileFields ?? []);
  // issue #251: multi-file field names are a subset of fileFields, derived from
  // `type:"array"` + `items.format:"binary"|"base64"`. This set is what lets us
  // distinguish MultipartFile / FilePart (single) from MultipartFile[] / Flux<FilePart>.
  const multipleFileFields = new Set(bodyContent.fileFieldsMultiple ?? []);
  const jsonFields = new Set(bodyContent.jsonFields ?? []);

  return Object.entries(props)
    .filter(([, prop]) => !prop.readOnly)
    .map(([name, prop]) => {
      const t = (prop.type as string) ?? 'string';
      const isFile =
        fileFields.has(name) ||
        t === 'file' ||
        (t === 'string' && prop.format === 'binary') ||
        (t === 'string' && prop.format === 'base64');

      // A field is considered multi-file if either (a) knife4j-core marked it in
      // fileFieldsMultiple, or (b) it has the explicit array-of-binary/base64 shape.
      // (b) is a defence-in-depth: older documents produced before fileFieldsMultiple
      // existed still render correctly.
      //
      // Important: springdoc 2.x (OAS 3.1) drops `type:"string"` from items, emitting
      // `{ items: { format: "binary", description: ... } }` for @ArraySchema(schema=
      // @Schema(type="string", format="binary")). So the fallback must NOT require
      // items.type === 'string'; only the format matters. Matches knife4j-core's
      // isBinaryItems() (issue #251 live repro against knife4j-demo).
      let isMultipleFile = false;
      if (isFile) {
        if (multipleFileFields.has(name)) {
          isMultipleFile = true;
        } else if (t === 'array' && prop.items && typeof prop.items === 'object') {
          const items = prop.items as Record<string, unknown>;
          const hasBinaryFormat = items.format === 'binary' || items.format === 'base64';
          const typeOk = items.type === undefined || items.type === 'string';
          if (hasBinaryFormat && typeOk) {
            isMultipleFile = true;
          }
        }
      }

      return {
        name,
        type: isFile ? 'file' : t,
        format: typeof prop.format === 'string' ? prop.format : undefined,
        required: requiredSet.has(name),
        description: typeof prop.description === 'string' ? prop.description : undefined,
        default: prop.default,
        example: prop.example,
        enum: Array.isArray(prop.enum) ? prop.enum : undefined,
        isFile,
        isMultipleFile,
        isJson: !isFile && jsonFields.has(name),
      };
    });
}

/** 根据 SchemaFieldRow 的类型推断初始值 */
function initialFieldValue(field: SchemaFieldRow): string {
  if (field.isFile) return '';
  if (field.isJson) return field.example !== undefined ? JSON.stringify(field.example, null, 2) : '{}';
  if (field.example !== undefined && field.example !== null) return String(field.example);
  if (field.default !== undefined && field.default !== null) return String(field.default);
  if (field.enum && field.enum.length > 0) return String(field.enum[0]);
  if (field.type === 'boolean') return 'true';
  if (field.type === 'integer' || field.type === 'number') return '0';
  return '';
}

// ─── Raw mode types ───────────────────────────────────

const RAW_MODES = [
  { value: 'text', label: 'Text(text/plain)' },
  { value: 'json', label: 'JSON(application/json)' },
  { value: 'javascript', label: 'JavaScript(application/javascript)' },
  { value: 'xml', label: 'XML(application/xml)' },
  { value: 'html', label: 'HTML(text/html)' },
] as const;

type RawMode = (typeof RAW_MODES)[number]['value'];

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

interface CustomParamRow {
  id: string;
  name: string;
  value: string;
}

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
    <div style={{ marginTop: 8 }}>
      <Space style={{ marginBottom: 4 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {title}
        </Text>
        <Button size="small" icon={<PlusOutlined />} onClick={addRow}>
          {addLabel}
        </Button>
      </Space>
      {rows.map((row) => (
        <Space key={row.id} style={{ display: 'flex', marginBottom: 4 }} align="center">
          <AutoComplete
            size="small"
            value={row.name}
            options={nameOptions?.(row.name)}
            onChange={(val) => updateRow(row.id, 'name', val)}
            onSelect={(val) => updateRow(row.id, 'name', val)}
            placeholder={namePlaceholder}
            style={{ width: 200 }}
            filterOption={false}
          />
          <Input
            size="small"
            value={row.value}
            onChange={(e) => updateRow(row.id, 'value', e.target.value)}
            placeholder={valuePlaceholder}
            style={{ width: 260 }}
          />
          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => deleteRow(row.id)} />
        </Space>
      ))}
    </div>
  );
}

function customRowsToRecord(rows: CustomParamRow[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const row of rows) {
    if (row.name.trim() && row.value.trim()) {
      values[row.name.trim()] = row.value.trim();
    }
  }
  return values;
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
  if (param.enum && param.enum.length > 0) {
    return (
      <Select
        size="small"
        value={value || undefined}
        onChange={onChange}
        allowClear
        status={status}
        placeholder={param.description ?? t('apiDebug.enum.placeholder')}
        options={param.enum.map((item) => ({
          value: String(item),
          label: String(item),
        }))}
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

  // integer / number → InputNumber
  if (param.type === 'integer' || param.type === 'number') {
    const numValue = value === '' ? undefined : Number(value);
    return (
      <InputNumber
        size="small"
        status={status}
        value={Number.isFinite(numValue) ? numValue : undefined}
        onChange={(next) => onChange(next === null || next === undefined ? '' : String(next))}
        placeholder={param.required ? t('apiDebug.inputNumber.required') : param.description}
        style={{ width: '100%' }}
        step={param.type === 'integer' ? 1 : undefined}
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
  body: string;
  setBody: (v: string) => void;
  selectedContentType: string;
  setSelectedContentType: (v: string) => void;
  formFields: Record<string, string>;
  setFormFields: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  fileFieldsRef: React.MutableRefObject<Record<string, File[]>>;
  rawMode: RawMode;
  setRawMode: (v: RawMode) => void;
}

function BodyTab({
  debugModel,
  body,
  setBody,
  selectedContentType,
  setSelectedContentType,
  formFields,
  setFormFields,
  fileFieldsRef,
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
      // 初始化 formFields
      const fields = extractSchemaFields(target);
      const initial: Record<string, string> = {};
      for (const f of fields) {
        initial[f.name] = initialFieldValue(f);
      }
      setFormFields(initial);
      // 重置 fileFields
      fileFieldsRef.current = {};

      // 更新 body 文本
      if (target.category === 'json') {
        setBody(target.exampleValue ?? '');
      } else if (target.category === 'raw') {
        setBody(target.exampleValue ?? '');
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

      {category === 'raw' && (
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
          {record.description && <Text style={{ fontSize: 12 }}>{record.description}</Text>}
          {record.default !== undefined && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('apiDebug.desc.default')}
              <Text code style={{ fontSize: 11 }}>
                {String(record.default)}
              </Text>
            </Text>
          )}
          {record.example !== undefined && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('apiDebug.desc.example')}
              <Text code style={{ fontSize: 11 }}>
                {String(record.example)}
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
          {record.description && <Text style={{ fontSize: 12 }}>{record.description}</Text>}
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

interface PreviewTabPanelProps {
  build: () => {
    formValues: DebugFormValues;
    built: BuiltRequest;
    curl: string;
  };
  onCopyCurl: (curl: string) => void;
}

function PreviewTabPanel({ build, onCopyCurl }: PreviewTabPanelProps) {
  const { t } = useTranslation();
  // 每次渲染都实时重建一次，保证与当前表单同步（避免额外状态）
  const { built, curl } = build();
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
      global: 'green',
      auth: 'orange',
    };
    return (
      <Tag color={colorMap[source]} style={{ marginInlineEnd: 0 }}>
        {t(`apiDebug.preview.source.${source}`)}
      </Tag>
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
          <Button size="small" onClick={() => onCopyCurl(curl)}>
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

function initialFormFieldsFor(bodyContent: BodyContent | undefined): Record<string, string> {
  if (!bodyContent || (bodyContent.category !== 'urlencoded' && bodyContent.category !== 'multipart')) return {};
  const initial: Record<string, string> = {};
  for (const field of extractSchemaFields(bodyContent)) {
    initial[field.name] = initialFieldValue(field);
  }
  return initial;
}

function buildInitialDebugState(
  debugModel: OperationDebugModel,
  operation: NonNullable<ReturnType<typeof useCurrentOperation>['operation']>,
  baseUrl: string,
): InitialDebugState {
  const allParams = [
    ...debugModel.pathParams,
    ...debugModel.queryParams,
    ...debugModel.headerParams,
    ...debugModel.cookieParams,
  ];
  const paramValues: ParamValueMap = {};
  const paramEnabled: Record<string, boolean> = {};
  for (const param of allParams) {
    paramValues[paramKey(param)] = initialValueFor(param);
    paramEnabled[paramKey(param)] = true;
  }

  const firstBody = debugModel.bodyContents[0];
  return {
    baseUrl,
    method: operation.method.toUpperCase(),
    path: operation.path,
    paramValues,
    paramEnabled,
    selectedContentType: firstBody?.mediaType ?? '',
    body: firstBody?.exampleValue ?? '',
    formFields: initialFormFieldsFor(firstBody),
    rawMode: inferRawMode(firstBody),
  };
}

// ─── 主组件 ────────────────────────────────────────────

export default function ApiDebug() {
  const { t } = useTranslation();
  const { loading: docLoading, swaggerDoc, operation } = useCurrentOperation();
  const { settings } = useSettings();
  const defaultBaseUrl = useMemo(
    () =>
      resolveRequestBaseUrl({
        swaggerDoc,
        operation,
        enableHost: settings.enableHost,
        enableHostText: settings.enableHostText,
        origin: currentOrigin(),
      }),
    [operation, settings.enableHost, settings.enableHostText, swaggerDoc],
  );
  const [baseUrl, setBaseUrl] = useState(defaultBaseUrl);
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
  const [paramValues, setParamValues] = useState<ParamValueMap>({});
  // enabled state: keyed by paramKey; GET/DELETE query params default true, all others also true
  const [paramEnabled, setParamEnabled] = useState<Record<string, boolean>>({});
  const [body, setBody] = useState('');
  const [customQueryParams, setCustomQueryParams] = useState<CustomParamRow[]>([]);
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
  const [loading, setLoading] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [response, setResponse] = useState<DebugResponsePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [builtRequest, setBuiltRequest] = useState<BuiltRequest | null>(null);
  const [sseEvents, setSseEvents] = useState<SseEvent[] | null>(null);
  const sseAbortRef = useRef<AbortController | null>(null);

  // ── requestBody 多内容类型状态 ──
  const [selectedContentType, setSelectedContentType] = useState('');
  const [formFields, setFormFields] = useState<Record<string, string>>({});
  const fileFieldsRef = useRef<Record<string, File[]>>({});
  const [rawMode, setRawMode] = useState<RawMode>('text');
  const [resetNonce, setResetNonce] = useState(0);

  // ── TASK-028: 校验错误与预览 ──
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);

  /** 当前缺失必填的 key 集合（统一 `${in}:${name}` 或 `body:requestBody`） */
  const errorKeys = useMemo(() => new Set(validationErrors.map((e) => e.key)), [validationErrors]);

  const initialDebugState = useMemo(() => {
    if (!debugModel || !operation) return null;
    return buildInitialDebugState(debugModel, operation, defaultBaseUrl);
  }, [debugModel, operation, defaultBaseUrl]);

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
    setRawMode(initial.rawMode);
    setCustomQueryParams([]);
    setCustomHeaders([]);
    setCustomCookies([]);
    setBuiltRequest(null);
    setSseEvents(null);
    setValidationErrors([]);
    if (options.resetActiveTab) {
      setActiveTab(undefined);
    }
    setAuthModalOpen(false);
    setResetNonce((value) => value + 1);
  };

  // 当 debugModel 变化时，同步初始化表单状态
  useEffect(() => {
    if (!initialDebugState) return;
    applyInitialDebugState(initialDebugState, { resetActiveTab: true });
    setResponse(null);
    setError(null);
  }, [initialDebugState]);

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
      const v = paramValues[paramKey(p)];
      if (v !== undefined && v !== '') pathParamValues[p.name] = v;
    }
    // 如果 path 还包含 {xxx} 占位符，说明用户没有手动覆盖 URL，用 replacePathParams 实时替换
    // 如果 path 已不包含任何占位符，说明用户手动编辑了 URL，直接显示
    const hasPlaceholders = debugModel.pathParams.some((p) => path.includes(`{${p.name}}`));
    return hasPlaceholders ? replacePathParams(path, pathParamValues) : path;
  }, [path, debugModel, paramValues]);

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
  const { schemes: authSchemes } = useAuth();
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

  // ── 从 GlobalParamContext 转换为 GlobalParamValues ──
  const { params: globalParamItems } = useGlobalParam();
  const globalParamValues: GlobalParamValues | undefined = useMemo(() => {
    if (!globalParamItems || globalParamItems.length === 0) return undefined;
    const headers: Record<string, string> = {};
    const queries: Record<string, string> = {};
    for (const p of globalParamItems) {
      if (p.value !== undefined && p.value !== '') {
        if (p.in === 'header') headers[p.name] = p.value;
        else if (p.in === 'query') queries[p.name] = p.value;
      }
    }
    return { headers, queries };
  }, [globalParamItems]);

  const paramColumns = useMemo<ColumnsType<DebugParam>>(
    () => [
      {
        title: t('apiDebug.col.enabled'),
        key: 'enabled',
        width: 48,
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
        width: 220,
        render: (_value: string, record: DebugParam) => <ParamNameCell param={record} />,
      },
      {
        title: t('apiDebug.col.type'),
        dataIndex: 'type',
        key: 'type',
        width: 110,
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
        width: 280,
        render: (_value, record: DebugParam) => (
          <Space size={2} direction="vertical" style={{ lineHeight: 1.35, fontSize: 12 }}>
            {record.description && <Text style={{ fontSize: 12 }}>{record.description}</Text>}
            {record.default !== undefined && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('apiDebug.desc.default')}
                <Text code style={{ fontSize: 11 }}>
                  {stringify(record.default, record.type)}
                </Text>
              </Text>
            )}
            {record.example !== undefined && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('apiDebug.desc.example')}
                <Text code style={{ fontSize: 11 }}>
                  {stringify(record.example, record.type)}
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
    ],
    [paramValues, paramEnabled, t, errorKeys],
  );

  if (docLoading) {
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
      if (paramEnabled[paramKey(p)] === false) continue;
      const v = paramValues[paramKey(p)];
      if (v !== undefined && v !== '') result[p.name] = v;
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
    const specQueryParams = collectForIn(debugModel.queryParams);
    const specHeaders = collectForIn(debugModel.headerParams);
    const specCookieParams = collectForIn(debugModel.cookieParams);
    const extraQueryParams = customRowsToRecord(customQueryParams);
    const extraHeaders = customRowsToRecord(customHeaders);
    const extraCookieParams = customRowsToRecord(customCookies);

    return {
      pathParams: collectForIn(debugModel.pathParams),
      queryParams: { ...extraQueryParams, ...specQueryParams },
      headerParams: { ...extraHeaders, ...specHeaders },
      cookieParams: { ...extraCookieParams, ...specCookieParams },
      selectedContentType: getEffectiveContentType(),
      body: category === 'json' || category === 'raw' ? body : undefined,
      formFields: category === 'urlencoded' || category === 'multipart' ? formFields : undefined,
      fileFields: category === 'multipart' ? fileFieldsRef.current : undefined,
      jsonFields: category === 'multipart' ? (currentBody?.jsonFields ?? []) : undefined,
    };
  };

  /** 基于当前表单构建 BuiltRequest（不发请求，仅用于预览/curl/发送共用） */
  const buildPreview = (): {
    formValues: DebugFormValues;
    built: BuiltRequest;
    curl: string;
  } => {
    const formValues = collectFormValues();
    const built = coreBuildRequest({
      baseUrl,
      path,
      method,
      debugModel,
      formValues,
      auth: authValues,
      globalParams: globalParamValues,
      securityKeys,
    });
    const curl = buildCurl(built);
    return { formValues, built, curl };
  };

  const handleSend = async () => {
    if (!debugModel) return;
    setError(null);

    const { formValues, built } = buildPreview();

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

    setLoading(true);
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
    setBuiltRequest(built);
    const start = Date.now();
    try {
      const abortController = new AbortController();
      sseAbortRef.current = abortController;

      const init: RequestInit = {
        method: built.method,
        headers: built.headers,
        signal: abortController.signal,
      };

      if (isMultipart) {
        // 构建 FormData
        const fd = new FormData();
        const jsonFieldSet = new Set(formValues.jsonFields ?? []);
        // 添加普通字段（非 JSON part）
        for (const [name, value] of Object.entries(formFields)) {
          if (value !== undefined && value !== '') {
            if (jsonFieldSet.has(name)) {
              // JSON-encoded part: append as Blob with application/json content type
              fd.append(name, new Blob([value], { type: 'application/json' }), `${name}.json`);
            } else {
              fd.append(name, value);
            }
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
        const currentBody = debugModel.bodyContents.find((b) => b.mediaType === selectedContentType);
        const multipleFileNames = new Set(currentBody?.fileFieldsMultiple ?? []);
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

      // 401 check must come before SSE/non-SSE branching:
      // a 401 response typically has Content-Type: application/json or text/html,
      // so it would never enter the SSE branch and the modal would never open.
      if (res.status === 401) {
        setAuthModalOpen(true);
        setLoading(false);
        return;
      }

      // SSE path: text/event-stream → stream via ReadableStream reader
      if (contentType.toLowerCase().includes('text/event-stream')) {
        setLoading(false);
        if (!res.body) {
          setError('SSE response has no body');
          sseAbortRef.current = null;
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        setSseEvents([]);

        const processChunk = (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trimEnd();
            if (trimmed.startsWith('data:')) {
              const data = trimmed.slice(5).trimStart();
              setSseEvents((prev) => [...(prev ?? []), { data, timestamp: Date.now() }]);
            }
          }
        };

        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            processChunk(decoder.decode(value, { stream: true }));
          }
          // flush remaining buffer
          if (buffer.trim().startsWith('data:')) {
            const data = buffer.trim().slice(5).trimStart();
            if (data) setSseEvents((prev) => [...(prev ?? []), { data, timestamp: Date.now() }]);
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') {
            // user aborted — not an error
          } else {
            setError(err instanceof Error ? err.message : String(err));
          }
        } finally {
          sseAbortRef.current = null;
        }
        return;
      }

      // Non-SSE path: read once as blob so we can branch by content-type without draining the stream twice.
      const blob = await res.blob();
      const blobContentType = contentType || blob.type;
      const contentDisposition = responseHeaders['content-disposition'];
      const { kind, rawText, objectUrl, filename } = await interpretResponseBlob(
        blob,
        blobContentType,
        built.url,
        contentDisposition,
      );

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
      if (!(reason instanceof Error && reason.name === 'AbortError')) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      setLoading(false);
      sseAbortRef.current = null;
    }
  };

  const handleSseAbort = () => {
    sseAbortRef.current?.abort();
    sseAbortRef.current = null;
  };

  const handleReset = () => {
    if (!initialDebugState) return;
    handleSseAbort();
    if (response?.objectUrl) {
      try {
        URL.revokeObjectURL(response.objectUrl);
      } catch {
        /* ignore */
      }
    }
    applyInitialDebugState(initialDebugState);
    setLoading(false);
    setResponse(null);
    setError(null);
  };

  /** 复制 curl 命令到剪贴板 */
  const handleCopyCurl = (curl: string) => {
    const done = () => message.success(t('apiDebug.preview.copied'));
    const fail = () => message.error(t('apiDebug.preview.copyFailed'));
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(curl).then(done).catch(fail);
        return;
      }
    } catch {
      // ignore
    }
    // 兜底：用临时 textarea
    try {
      const ta = document.createElement('textarea');
      ta.value = curl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch {
      fail();
    }
  };

  const headerNameOptions = (input: string) =>
    COMMON_HEADER_NAMES.filter((headerName) => headerName.toLowerCase().includes(input.toLowerCase())).map(
      (headerName) => ({
        value: headerName,
        label: headerName,
      }),
    );

  // body tab 的标签含当前 content-type
  const bodyLabel =
    debugModel.bodyContents.length > 0
      ? `${t('apiDebug.tab.body')} (${getEffectiveContentType()})`
      : t('apiDebug.tab.body');

  const tabItems = [
    {
      key: 'path',
      label: `${t('apiDebug.tab.path')} (${debugModel.pathParams.length})`,
      disabled: false,
      children: (
        <Table
          size="small"
          dataSource={debugModel.pathParams.filter((p) => !p.readOnly)}
          columns={paramColumns}
          pagination={false}
          rowKey={paramKey}
          locale={{ emptyText: t('apiDebug.noPathParams') }}
        />
      ),
    },
    {
      key: 'query',
      label: `${t('apiDebug.tab.query')} (${
        debugModel.queryParams.length + customQueryParams.filter((row) => row.name.trim()).length
      })`,
      disabled: false,
      children: (
        <>
          <Table
            size="small"
            dataSource={debugModel.queryParams.filter((p) => !p.readOnly)}
            columns={paramColumns}
            pagination={false}
            rowKey={paramKey}
            locale={{ emptyText: t('apiDebug.noQueryParams') }}
          />
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
        debugModel.headerParams.length + customHeaders.filter((r) => r.name.trim()).length
      })`,
      disabled: false,
      children: (
        <>
          <Table
            size="small"
            dataSource={debugModel.headerParams.filter((p) => !p.readOnly)}
            columns={paramColumns}
            pagination={false}
            rowKey={paramKey}
            locale={{
              emptyText:
                debugModel.bodyContents.length > 0 ? t('apiDebug.header.autoInject') : t('apiDebug.noHeaderParams'),
            }}
          />
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
            dataSource={debugModel.cookieParams.filter((p) => !p.readOnly)}
            columns={paramColumns}
            pagination={false}
            rowKey={paramKey}
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
          body={body}
          setBody={setBody}
          selectedContentType={selectedContentType}
          setSelectedContentType={setSelectedContentType}
          formFields={formFields}
          setFormFields={setFormFields}
          fileFieldsRef={fileFieldsRef}
          rawMode={rawMode}
          setRawMode={setRawMode}
        />
      ),
    },
    {
      key: 'preview',
      label: t('apiDebug.tab.preview'),
      disabled: false,
      children: <PreviewTabPanel build={buildPreview} onCopyCurl={handleCopyCurl} />,
    },
  ];

  const defaultTab =
    debugModel.pathParams.length > 0
      ? 'path'
      : debugModel.queryParams.length > 0
        ? 'query'
        : debugModel.headerParams.length > 0
          ? 'header'
          : debugModel.cookieParams.length > 0
            ? 'cookie'
            : debugModel.bodyContents.length > 0
              ? 'body'
              : 'preview';
  const currentActiveTab = activeTab ?? defaultTab;

  return (
    <OperationModeLayout activeKey="debug">
      <div id="knife4j-api-debug-page">
        <Space align="center" style={{ marginBottom: 12 }}>
          <Tag color={METHOD_COLORS[method] ?? 'default'} style={{ fontSize: 14, padding: '2px 8px' }}>
            {method}
          </Tag>
          <Title level={5} style={{ margin: 0 }}>
            {operation.operation.summary ?? operation.path}
          </Title>
        </Space>

        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Select
            value={method}
            onChange={setMethod}
            style={{ width: 110 }}
            options={['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].map((item) => ({
              value: item,
              label: item,
            }))}
          />
          <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} style={{ width: 240 }} />
          <Input
            value={displayPath}
            onChange={(event) => handlePathInputChange(event.target.value)}
            style={{ flex: 1 }}
          />
          <Button type="primary" icon={<SendOutlined />} onClick={handleSend} loading={loading}>
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

        {loading && <Spin tip={t('apiDebug.sending')} style={{ display: 'block', margin: '24px auto' }} />}
        <ResponsePanel
          response={response}
          error={error}
          builtRequest={builtRequest}
          operation={operation}
          swaggerDoc={swaggerDoc}
          sseEvents={sseEvents}
          onSseAbort={handleSseAbort}
          sseStreaming={sseAbortRef.current !== null}
        />
        <Modal
          open={authModalOpen}
          onCancel={() => setAuthModalOpen(false)}
          title={t('auth.modal401.title')}
          footer={[
            <Button
              key="resend"
              type="primary"
              onClick={() => {
                setAuthModalOpen(false);
                void handleSend();
              }}
            >
              {t('auth.modal401.resend')}
            </Button>,
            <Button key="close" onClick={() => setAuthModalOpen(false)}>
              {t('auth.modal401.close')}
            </Button>,
          ]}
          width={680}
          destroyOnClose
        >
          <p style={{ marginBottom: 16, color: 'rgba(0,0,0,0.65)' }}>{t('auth.modal401.description')}</p>
          <Authorize />
        </Modal>
      </div>
    </OperationModeLayout>
  );
}

// TASK-120-16
