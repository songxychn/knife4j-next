import { AutoComplete, Button, Input, InputNumber, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { DebugParam } from 'knife4j-core';
import RevealableValue from '../../components/RevealableValue';
import { type DebugCacheCustomParamRow } from './debugCache';
import {
  enumParamSelectMode,
  enumParamSelectOptions,
  enumParamSelectValue,
  isEnumParamSelectSupported,
  serializeEnumParamSelection,
} from './enumParamValue';
import { type SchemaFieldRow } from './debugDefaultValues';
import { isNullableOas31Parameter } from './oas31ParameterForm';

const { TextArea } = Input;
const { Text } = Typography;

// ─── Custom headers section ───────────────────────────

export type CustomParamRow = DebugCacheCustomParamRow;

interface CustomParamsSectionProps {
  title: string;
  addLabel: string;
  namePlaceholder: string;
  valuePlaceholder: string;
  rows: CustomParamRow[];
  onChange: (rows: CustomParamRow[]) => void;
  nameOptions?: (input: string) => Array<{ value: string; label: string }>;
}

export function CustomParamsSection({
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

export function ParamInput({ param, value, onChange, hasError }: ParamInputProps) {
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

export function SchemaFieldInput({ field, value, onChange }: SchemaFieldInputProps) {
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

export function ParamNameCell({ param }: { param: DebugParam }) {
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

export interface InjectedGlobalParamRow {
  key: string;
  name: string;
  value: string;
  masked: boolean;
  source: 'application' | 'global';
}

export function InjectedGlobalParamsSection({ rows }: { rows: InjectedGlobalParamRow[] }) {
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
