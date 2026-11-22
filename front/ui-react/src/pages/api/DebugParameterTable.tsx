import { Checkbox, Input, Space, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dispatch, SetStateAction } from 'react';
import type { DebugParam } from 'knife4j-core';
import { useTranslation } from 'react-i18next';
import DescriptionText from '../../components/DescriptionText';
import type { Oas32ParameterEntries } from '../../schema/oas32ParameterAdapter';
import { ParamInput, ParamNameCell } from './DebugParamInputs';
import { paramKey, stringifyDebugValue } from './debugDefaultValues';
import { API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS, apiDebugParamTableScrollX } from './apiDebugParamTableLayout';
import { resolveApiDebugParamSelection, setApiDebugParamsEnabled } from './apiDebugParamSelection';
import type { CookieParameterSource } from './cookieParameterSource';
import { isBrowserSessionParameter } from './oas31ParameterForm';
import { serializedExampleParameterForKey } from './oas32ParameterForm';

const { Text } = Typography;
const PARAM_TABLE_SCROLL = { x: apiDebugParamTableScrollX() };

interface DebugParameterTableProps {
  params: DebugParam[];
  paramValues: Record<string, string>;
  paramEnabled: Record<string, boolean>;
  setParamEnabled: Dispatch<SetStateAction<Record<string, boolean>>>;
  updateValue: (param: DebugParam, value: string) => void;
  effectiveCookieSource: CookieParameterSource;
  declaredCookies: boolean;
  oas32ParameterEntries: Oas32ParameterEntries;
  errorKeys: ReadonlySet<string>;
  emptyText: string;
}

export function DebugParameterTable({
  params,
  paramValues,
  paramEnabled,
  setParamEnabled,
  updateValue,
  effectiveCookieSource,
  declaredCookies,
  oas32ParameterEntries,
  errorKeys,
  emptyText,
}: DebugParameterTableProps) {
  const { t } = useTranslation();
  const browserSession = params.some((parameter) =>
    isBrowserSessionParameter(parameter, effectiveCookieSource, { declaredCookies }),
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
      dataIndex: 'value',
      key: 'value',
      width: API_DEBUG_PARAM_TABLE_COLUMN_WIDTHS.value,
      render: (_value: string, record: DebugParam) =>
        isBrowserSessionParameter(record, effectiveCookieSource, { declaredCookies }) ? (
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
  return (
    <Table
      size="small"
      dataSource={params}
      columns={browserSession ? columns.filter((column) => column.key !== 'enabled') : columns}
      pagination={false}
      rowKey={paramKey}
      tableLayout="fixed"
      scroll={PARAM_TABLE_SCROLL}
      locale={{ emptyText }}
    />
  );
}
