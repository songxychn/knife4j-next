import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  Input,
  InputNumber,
  message,
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
import { SendOutlined, UploadOutlined } from '@ant-design/icons';
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
import { OperationModeTabs, useCurrentOperation } from './useCurrentOperation';
import { useAuth } from '../../context/AuthContext';
import { useGlobalParam } from '../../context/GlobalParamContext';
import { useSettings } from '../../context/SettingsContext';
import ResponsePanel, { type DebugResponsePayload } from './ResponsePanel';

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

function currentOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;
}

// ─── Response body classification ─────────────────────

/**
 * Map a response blob + Content-Type into a representation the
 * ResponsePanel can render directly. Text-friendly payloads are always
 * decoded into `rawText` so the Raw tab can show something even for
 * image / binary responses that choose to embed ASCII.
 */
async function interpretResponseBlob(
  blob: Blob,
  contentType: string,
  requestUrl: string,
): Promise<{ kind: DebugResponsePayload['kind']; rawText: string; objectUrl?: string; filename?: string }> {
  const ct = (contentType || '').toLowerCase();

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

  // Binary payload (pdf, octet-stream, zip, ...) → download link.
  const filename = extractFilenameFromUrl(requestUrl) ?? 'download';
  return { kind: 'binary', rawText: '', objectUrl: URL.createObjectURL(blob), filename };
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
}

/**
 * 从 BodyContent 的 schema.properties 提取字段行
 */
function extractSchemaFields(bodyContent: BodyContent): SchemaFieldRow[] {
  const schema = bodyContent.schema;
  if (!schema || schema.type !== 'object' || !schema.properties) return [];

  const props = schema.properties as Record<string, Record<string, unknown>>;
  const requiredSet = new Set<string>(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const fileFields = new Set(bodyContent.fileFields ?? []);

  return Object.entries(props).map(([name, prop]) => {
    const t = (prop.type as string) ?? 'string';
    const isFile =
      fileFields.has(name) ||
      t === 'file' ||
      (t === 'string' && prop.format === 'binary') ||
      (t === 'string' && prop.format === 'base64');

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
    };
  });
}

/** 根据 SchemaFieldRow 的类型推断初始值 */
function initialFieldValue(field: SchemaFieldRow): string {
  if (field.isFile) return '';
  if (field.example !== undefined && field.example !== null) return String(field.example);
  if (field.default !== undefined && field.default !== null) return String(field.default);
  if (field.enum && field.enum.length > 0) return String(field.enum[0]);
  if (field.type === 'boolean') return 'true';
  if (field.type === 'integer' || field.type === 'number') return '0';
  return '';
}

// ─── Raw mode types ───────────────────────────────────

const RAW_MODES = [
  { value: 'text', label: 'Text' },
  { value: 'json', label: 'JSON' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'xml', label: 'XML' },
  { value: 'html', label: 'HTML' },
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
        options={param.enum.map((item) => ({ value: String(item), label: String(item) }))}
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
        placeholder={`${param.type === 'array' ? t('apiDebug.json.array') : t('apiDebug.json.object')} — ${t('apiDebug.json.placeholder')}`}
        autoSize={{ minRows: 2, maxRows: 6 }}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      />
    );
  }

  // string / file / 其他 → Input
  return (
    <Input
      size="small"
      status={status}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={param.required ? t('apiDebug.inputNumber.required') : (param.description ?? '')}
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

  // enum → Select
  if (field.enum && field.enum.length > 0) {
    return (
      <Select
        size="small"
        value={value || undefined}
        onChange={onChange}
        allowClear
        options={field.enum.map((item) => ({ value: String(item), label: String(item) }))}
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
  return (
    <Input
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={field.description ?? ''}
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
    }
  };

  // ── JSON Beautify ──
  const handleBeautify = () => {
    try {
      const parsed = JSON.parse(body);
      setBody(JSON.stringify(parsed, null, 2));
    } catch {
      // 无效 JSON，不处理
    }
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
        <div>
          <div style={{ marginBottom: 4, textAlign: 'right' }}>
            <Button size="small" onClick={handleBeautify}>
              {t('apiDebug.body.beautify')}
            </Button>
          </div>
          <TextArea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={10}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
            placeholder={`${currentBody.mediaType} request body`}
          />
        </div>
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
          return (
            <Upload
              beforeUpload={() => false} // 阻止自动上传
              multiple
              fileList={fileListMap[record.name] ?? []}
              onChange={(info) => handleFileChange(record.name, info)}
            >
              <Button size="small" icon={<UploadOutlined />}>
                {t('apiDebug.body.selectFile')}
              </Button>
            </Upload>
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

function RawEditor({ body, setBody, rawMode, setRawMode, onBeautify }: RawEditorProps) {
  const { t } = useTranslation();

  return (
    <div>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Radio.Group
          value={rawMode}
          onChange={(e) => setRawMode(e.target.value)}
          size="small"
          optionType="button"
          buttonStyle="solid"
        >
          {RAW_MODES.map((m) => (
            <Radio.Button key={m.value} value={m.value}>
              {m.label}
            </Radio.Button>
          ))}
        </Radio.Group>
        {rawMode === 'json' && (
          <Button size="small" onClick={onBeautify}>
            {t('apiDebug.body.beautify')}
          </Button>
        )}
      </div>
      <TextArea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={10}
        style={{ fontFamily: 'monospace', fontSize: 13 }}
        placeholder={`${RAW_CONTENT_TYPES[rawMode]} request body`}
      />
    </div>
  );
}

// ─── Preview Tab (TASK-028) ───────────────────────────

interface PreviewTabPanelProps {
  build: () => { formValues: DebugFormValues; built: BuiltRequest; curl: string };
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
    const colorMap: Record<ParamSource, string> = { interface: 'blue', global: 'green', auth: 'orange' };
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
              { title: t('apiDebug.col.headerValue'), dataIndex: 'value', key: 'value' },
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
              { title: t('apiDebug.col.value'), dataIndex: 'value', key: 'value' },
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

// ─── 主组件 ────────────────────────────────────────────

export default function ApiDebug() {
  const { t } = useTranslation();
  const { loading: docLoading, swaggerDoc, operation } = useCurrentOperation();
  const { settings } = useSettings();
  const [baseUrl, setBaseUrl] = useState(() =>
    settings.enableHost && settings.enableHostText.trim()
      ? settings.enableHostText.trim()
      : currentOrigin(),
  );
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
  const [paramValues, setParamValues] = useState<ParamValueMap>({});
  const [body, setBody] = useState('');
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
  const [response, setResponse] = useState<DebugResponsePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── requestBody 多内容类型状态 ──
  const [selectedContentType, setSelectedContentType] = useState('');
  const [formFields, setFormFields] = useState<Record<string, string>>({});
  const fileFieldsRef = useRef<Record<string, File[]>>({});
  const [rawMode, setRawMode] = useState<RawMode>('text');

  // ── TASK-028: 校验错误与预览 ──
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);

  /** 当前缺失必填的 key 集合（统一 `${in}:${name}` 或 `body:requestBody`） */
  const errorKeys = useMemo(() => new Set(validationErrors.map((e) => e.key)), [validationErrors]);

  // 当 debugModel 变化时，同步初始化表单状态
  useEffect(() => {
    if (!debugModel || !operation) return;

    setMethod(operation.method.toUpperCase());
    setPath(operation.path);

    // 初始化参数值
    const initial: ParamValueMap = {};
    const allParams = [
      ...debugModel.pathParams,
      ...debugModel.queryParams,
      ...debugModel.headerParams,
      ...debugModel.cookieParams,
    ];
    for (const p of allParams) {
      initial[paramKey(p)] = initialValueFor(p);
    }
    setParamValues(initial);

    // body 初始值
    const firstBody = debugModel.bodyContents[0];
    const firstMediaType = firstBody?.mediaType ?? '';
    setSelectedContentType(firstMediaType);
    setBody(firstBody?.exampleValue ?? '');

    // 初始化 formFields
    if (firstBody && (firstBody.category === 'urlencoded' || firstBody.category === 'multipart')) {
      const fields = extractSchemaFields(firstBody);
      const initialForm: Record<string, string> = {};
      for (const f of fields) {
        initialForm[f.name] = initialFieldValue(f);
      }
      setFormFields(initialForm);
    } else {
      setFormFields({});
    }

    // 重置文件字段
    fileFieldsRef.current = {};

    // raw mode 初始推断
    if (firstBody?.category === 'raw') {
      if (firstMediaType.includes('json')) setRawMode('json');
      else if (firstMediaType.includes('xml')) setRawMode('xml');
      else if (firstMediaType.includes('html')) setRawMode('html');
      else if (firstMediaType.includes('javascript')) setRawMode('javascript');
      else setRawMode('text');
    } else {
      setRawMode('text');
    }

    setResponse(null);
    setError(null);
    setValidationErrors([]);
    setActiveTab(undefined);
  }, [debugModel, operation]);

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
    [paramValues, t, errorKeys],
  );

  if (docLoading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  if (!swaggerDoc || !operation || !debugModel) {
    return (
      <Alert type="warning" showIcon message={t('apiDebug.notFound.title')} description={t('apiDebug.notFound.desc')} />
    );
  }

  /** 按 in 过滤已填值 */
  const collectForIn = (params: DebugParam[]): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const p of params) {
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
    if (selectedContentType) return selectedContentType;
    // raw mode fallback
    if (getCurrentCategory() === 'raw') return RAW_CONTENT_TYPES[rawMode];
    return debugModel.bodyContents[0]?.mediaType ?? '';
  };

  const collectFormValues = (): DebugFormValues => {
    const category = getCurrentCategory();
    return {
      pathParams: collectForIn(debugModel.pathParams),
      queryParams: collectForIn(debugModel.queryParams),
      headerParams: collectForIn(debugModel.headerParams),
      cookieParams: collectForIn(debugModel.cookieParams),
      selectedContentType: getEffectiveContentType(),
      body: category === 'json' || category === 'raw' ? body : undefined,
      formFields: category === 'urlencoded' || category === 'multipart' ? formFields : undefined,
      fileFields: category === 'multipart' ? fileFieldsRef.current : undefined,
    };
  };

  /** 基于当前表单构建 BuiltRequest（不发请求，仅用于预览/curl/发送共用） */
  const buildPreview = (): { formValues: DebugFormValues; built: BuiltRequest; curl: string } => {
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
    const start = Date.now();
    try {
      const init: RequestInit = { method: built.method, headers: built.headers };

      if (isMultipart) {
        // 构建 FormData
        const fd = new FormData();
        // 添加普通字段
        for (const [name, value] of Object.entries(formFields)) {
          if (value !== undefined && value !== '') {
            fd.append(name, value);
          }
        }
        // 添加文件字段
        const files = fileFieldsRef.current;
        for (const [name, fileList] of Object.entries(files)) {
          for (const file of fileList) {
            fd.append(name, file);
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

      // Read once as blob so we can branch by content-type without draining the stream twice.
      const blob = await res.blob();
      const contentType = responseHeaders['content-type'] ?? blob.type ?? '';
      const { kind, rawText, objectUrl, filename } = await interpretResponseBlob(blob, contentType, built.url);

      setResponse({
        status: res.status,
        statusText: res.statusText,
        method: built.method,
        duration: Date.now() - start,
        contentType,
        size: blob.size,
        headers: responseHeaders,
        rawText,
        objectUrl,
        filename,
        kind,
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
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

  // body tab 的标签含当前 content-type
  const bodyLabel =
    debugModel.bodyContents.length > 0
      ? `${t('apiDebug.tab.body')} (${selectedContentType || debugModel.bodyContents[0].mediaType})`
      : t('apiDebug.tab.body');

  const tabItems = [
    {
      key: 'path',
      label: `${t('apiDebug.tab.path')} (${debugModel.pathParams.length})`,
      disabled: debugModel.pathParams.length === 0,
      children: (
        <Table
          size="small"
          dataSource={debugModel.pathParams}
          columns={paramColumns}
          pagination={false}
          rowKey={paramKey}
        />
      ),
    },
    {
      key: 'query',
      label: `${t('apiDebug.tab.query')} (${debugModel.queryParams.length})`,
      disabled: debugModel.queryParams.length === 0,
      children: (
        <Table
          size="small"
          dataSource={debugModel.queryParams}
          columns={paramColumns}
          pagination={false}
          rowKey={paramKey}
        />
      ),
    },
    {
      key: 'header',
      label: `${t('apiDebug.tab.header')} (${debugModel.headerParams.length})`,
      disabled: debugModel.headerParams.length === 0 && debugModel.bodyContents.length === 0,
      children: (
        <Table
          size="small"
          dataSource={debugModel.headerParams}
          columns={paramColumns}
          pagination={false}
          rowKey={paramKey}
          locale={{
            emptyText:
              debugModel.bodyContents.length > 0 ? t('apiDebug.header.autoInject') : t('apiDebug.noHeaderParams'),
          }}
        />
      ),
    },
    {
      key: 'cookie',
      label: `${t('apiDebug.tab.cookie')} (${debugModel.cookieParams.length})`,
      disabled: debugModel.cookieParams.length === 0,
      children: (
        <Table
          size="small"
          dataSource={debugModel.cookieParams}
          columns={paramColumns}
          pagination={false}
          rowKey={paramKey}
        />
      ),
    },
    {
      key: 'body',
      label: bodyLabel,
      disabled: debugModel.bodyContents.length === 0,
      children: (
        <BodyTab
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

  // 找到第一个非空 Tab 作为默认
  const defaultTab = tabItems.find((t) => !t.disabled)?.key ?? 'query';
  const currentActiveTab = activeTab ?? defaultTab;

  return (
    <div id="knife4j-api-debug-page" style={{ padding: '0 24px 24px', maxWidth: 1080 }}>
      <OperationModeTabs activeKey="debug" />

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
      <ResponsePanel response={response} error={error} />
    </div>
  );
}
