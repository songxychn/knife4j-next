import { inferRawMode } from './debugFormState';
import { useBodyBeautify } from './useBodyBeautify';
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Input,
  message,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import { useTranslation } from 'react-i18next';
import type { BodyContent, OperationDebugModel } from 'knife4j-core';
import CodeEditor, { type CodeEditorHandle, type CodeEditorLanguage } from '../../components/CodeEditor';
import DescriptionText from '../../components/DescriptionText';
import ResizableBox from '../../components/ResizableBox';
import { DEBUG_PANEL_DEFAULT_MAX_HEIGHT, DEBUG_PANEL_MAX_HEIGHT, DEBUG_PANEL_MIN_HEIGHT } from './debugPanelLayout';
import { type DebugCacheRawMode } from './debugCache';
import {
  extractSchemaFields,
  extraPositionalSchemaFields,
  initialBodyValueForContent,
  initialFormFieldsForContent,
  initialFormPartHeadersForContent,
  stringifyDebugValue,
  type BodyContentDefaults,
  type SchemaFieldRow,
} from './debugDefaultValues';
import { CustomParamsSection, SchemaFieldInput, type CustomParamRow } from './DebugParamInputs';

import { RAW_CONTENT_TYPES, type RawMode } from './apiDebugShared';

const { TextArea } = Input;
const { Text } = Typography;

// ─── Raw mode types ───────────────────────────────────

const RAW_MODES = [
  { value: 'text', label: 'Text(text/plain)' },
  { value: 'json', label: 'JSON(application/json)' },
  { value: 'javascript', label: 'JavaScript(application/javascript)' },
  { value: 'xml', label: 'XML(application/xml)' },
  { value: 'html', label: 'HTML(text/html)' },
] as const satisfies ReadonlyArray<{ value: DebugCacheRawMode; label: string }>;

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
  setFileFields: React.Dispatch<React.SetStateAction<Record<string, File[]>>>;
  setBinaryBodyFile: (file: File | null) => void;
  rawMode: RawMode;
  setRawMode: (v: RawMode) => void;
  bodyHeight?: number;
  onBodyHeightChange?: (height: number | undefined) => void;
}

export function BodyTab({
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
  setFileFields,
  setBinaryBodyFile,
  rawMode,
  setRawMode,
  bodyHeight,
  onBodyHeightChange,
}: BodyTabProps) {
  const { t } = useTranslation();
  const bodyContents = debugModel.bodyContents;
  const handleBeautify = useBodyBeautify({
    body,
    rawMode,
    identity: debugModel,
    contentType: selectedContentType,
    onFormatted: setBody,
    onFailure: () =>
      message.warning(
        rawMode === 'xml' || rawMode === 'html'
          ? t('apiDebug.body.markupBeautifyUnsupported')
          : t('apiDebug.body.beautifyFailed', { contentType: RAW_CONTENT_TYPES[rawMode] }),
      ),
  });

  if (bodyContents.length === 0) {
    return <Alert type="info" title={t('apiDebug.noBody')} showIcon />;
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
      setFileFields({});
      setBinaryBodyFile(null);

      // 更新 body 文本
      if (target.category === 'json') {
        setBody(initialBodyValueForContent(target, bodyDefaults));
      } else if (target.category === 'raw') {
        setBody(initialBodyValueForContent(target, bodyDefaults));
      }
      setRawMode(inferRawMode(target));
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
          bodyHeight={bodyHeight}
          onBodyHeightChange={onBodyHeightChange}
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
          setFileFields={setFileFields}
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
        <BinaryBodyInput key={currentBody.mediaType} contentType={currentBody.mediaType} setFile={setBinaryBodyFile} />
      )}

      {category === 'raw' && !currentBody.binary && (
        <RawEditor
          body={body}
          setBody={setBody}
          rawMode={rawMode}
          setRawMode={setRawMode}
          onBeautify={handleBeautify}
          bodyHeight={bodyHeight}
          onBodyHeightChange={onBodyHeightChange}
        />
      )}
    </div>
  );
}

interface BinaryBodyInputProps {
  contentType: string;
  setFile: (file: File | null) => void;
}

function BinaryBodyInput({ contentType, setFile }: BinaryBodyInputProps) {
  const { t } = useTranslation();
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const handleChange = (info: { fileList: UploadFile[] }) => {
    const nextList = info.fileList.slice(-1);
    setFileList(nextList);
    setFile(nextList[0]?.originFileObj ?? null);
  };

  return (
    <Space orientation="vertical" size={8}>
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
        <Space size={2} orientation="vertical" style={{ lineHeight: 1.3 }}>
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
        <Space size={2} orientation="vertical" style={{ lineHeight: 1.35, fontSize: 12 }}>
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
  setFileFields: React.Dispatch<React.SetStateAction<Record<string, File[]>>>;
}

function MultipartForm({
  bodyContent,
  formFields,
  setFormFields,
  formPartHeaders,
  setFormPartHeaders,
  formPartContentTypes,
  setFormPartContentTypes,
  setFileFields,
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
    const files: File[] = [];
    for (const f of info.fileList) {
      if (f.originFileObj) files.push(f.originFileObj);
    }
    setFileFields((previous) => ({ ...previous, [name]: files }));
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
          <Space orientation="vertical" size={6} style={{ width: '100%' }}>
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
        <Space size={2} orientation="vertical" style={{ lineHeight: 1.35, fontSize: 12 }}>
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
    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
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
  bodyHeight?: number;
  onBodyHeightChange?: (height: number | undefined) => void;
}

const RAW_MODE_LANGUAGE: Record<RawMode, CodeEditorLanguage> = {
  json: 'json',
  xml: 'xml',
  text: 'text',
  javascript: 'text',
  html: 'text',
};

function RawEditor({ body, setBody, rawMode, setRawMode, onBeautify, bodyHeight, onBodyHeightChange }: RawEditorProps) {
  const { t } = useTranslation();
  const editorRef = useRef<CodeEditorHandle>(null);
  const [uncontrolledHeight, setUncontrolledHeight] = useState<number | undefined>(undefined);
  const effectiveHeight = onBodyHeightChange ? bodyHeight : uncontrolledHeight;
  const handleHeightChange = onBodyHeightChange ?? setUncontrolledHeight;
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
            aria-label={t('apiDebug.body.contentType')}
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
          {rawMode === 'json' && (
            <>
              <Button size="small" onClick={() => editorRef.current?.expandAll()}>
                {t('json.expandAll')}
              </Button>
              <Button size="small" onClick={() => editorRef.current?.collapseToFirstLevel()}>
                {t('json.collapseToFirstLevel')}
              </Button>
            </>
          )}
        </Space>
      </div>
      <ResizableBox
        height={effectiveHeight}
        defaultMaxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
        minHeight={DEBUG_PANEL_MIN_HEIGHT}
        maxHeight={DEBUG_PANEL_MAX_HEIGHT}
        onHeightChange={handleHeightChange}
        handleLabel={t('apiDebug.request.resizeHandle')}
        resetTitle={t('apiDebug.panel.resizeResetTitle')}
      >
        {useCodeEditor ? (
          <CodeEditor
            ref={editorRef}
            ariaLabel={t('apiDoc.requestBody')}
            value={body}
            onChange={setBody}
            language={RAW_MODE_LANGUAGE[rawMode]}
            height={effectiveHeight !== undefined ? '100%' : undefined}
            minHeight={DEBUG_PANEL_MIN_HEIGHT}
            maxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
            placeholderText={`${RAW_CONTENT_TYPES[rawMode]} request body`}
          />
        ) : (
          <TextArea
            aria-label={t('apiDoc.requestBody')}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={effectiveHeight !== undefined ? undefined : 10}
            style={{
              fontFamily: 'monospace',
              fontSize: 13,
              resize: 'none',
              ...(effectiveHeight !== undefined ? { height: '100%' } : {}),
            }}
            placeholder={`${RAW_CONTENT_TYPES[rawMode]} request body`}
          />
        )}
      </ResizableBox>
    </div>
  );
}
