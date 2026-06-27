import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Popover, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { buildSchemaFieldTree, type SchemaFieldNode } from 'knife4j-core';
import { Link as RouterLink } from 'react-router-dom';
import { Resizable, type ResizeCallbackData } from 'react-resizable';
import { useTranslation } from 'react-i18next';
import { useGroup } from '../../context/GroupContext';
import type { SchemaObject, SwaggerDoc } from '../../types/swagger';
import {
  SCHEMA_FIELD_COLUMN_MIN_WIDTHS,
  schemaFieldTableLayout,
  schemaFieldTableScrollX,
  type SchemaFieldTableColumnKey,
  type SchemaFieldTableColumnWidths,
} from './schemaFieldTableLayout';
import { schemaNodeRefName, schemaNodeTypeLabel } from './schemaUtils';

const { Text } = Typography;

const TYPE_COLOR: Record<string, string> = {
  integer: 'blue',
  number: 'cyan',
  string: 'green',
  boolean: 'orange',
  array: 'purple',
  object: 'geekblue',
  unknown: 'default',
};

interface SchemaFieldRow extends SchemaFieldNode {
  key: string;
  children?: SchemaFieldRow[];
}

interface SchemaTypeLinkProps {
  node: SchemaFieldNode;
}

interface SchemaFieldTableProps {
  fields: SchemaFieldNode[];
  emptyText?: string;
}

interface ResizableTitleProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  width?: number;
  minWidth?: number;
  onResize?: (event: React.SyntheticEvent<Element>, data: ResizeCallbackData) => void;
}

function toRows(fields: SchemaFieldNode[], parentKey = ''): SchemaFieldRow[] {
  return fields.map((field, index) => {
    const keyPart = field.name || field.refName || field.type || String(index);
    const key = parentKey ? `${parentKey}.${keyPart}-${index}` : `${keyPart}-${index}`;
    return {
      ...field,
      key,
      children: field.children ? toRows(field.children, key) : undefined,
    };
  });
}

function modelPreviewFields(schema: SchemaObject, swaggerDoc: SwaggerDoc): SchemaFieldNode[] {
  return buildSchemaFieldTree(schema as Record<string, unknown>, {
    doc: swaggerDoc as unknown as Record<string, unknown>,
    maxDepth: 2,
  }).slice(0, 6);
}

export function SchemaTypeLink({ node }: SchemaTypeLinkProps) {
  const { activeGroup, schemas, swaggerDoc } = useGroup();
  const { t } = useTranslation();
  const refName = schemaNodeRefName(node);
  const label = schemaNodeTypeLabel(node);
  const schema = refName ? schemas[refName] : undefined;
  const color = TYPE_COLOR[node.type] ?? 'default';

  if (!refName || !schema || !swaggerDoc) {
    return (
      <ConstraintTooltip node={node}>
        <Tag color={color}>{label}</Tag>
      </ConstraintTooltip>
    );
  }

  const previewFields = modelPreviewFields(schema, swaggerDoc);
  const content = (
    <div style={{ maxWidth: 420 }}>
      {schema.description && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {schema.description}
        </Text>
      )}
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {previewFields.map((field) => (
          <div
            key={`${field.name}-${field.refName ?? field.type}`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(90px, 1fr) minmax(90px, auto)',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <Space size={4}>
              <Text code>{field.name || 'items'}</Text>
              {field.required && <Badge status="error" />}
            </Space>
            <Text type="secondary" style={{ textAlign: 'right' }}>
              {schemaNodeTypeLabel(field)}
            </Text>
          </div>
        ))}
      </Space>
      {previewFields.length === 0 && <Text type="secondary">{t('schema.noFields')}</Text>}
    </div>
  );

  const target = `/${encodeURIComponent(activeGroup.value)}/schema/${encodeURIComponent(refName)}`;

  return (
    <ConstraintTooltip node={node}>
      <Popover title={refName} content={content} placement="right" styles={{ root: { maxWidth: 460 } }}>
        <RouterLink to={target}>
          <Tag color={color} style={{ cursor: 'pointer' }}>
            {label}
          </Tag>
        </RouterLink>
      </Popover>
    </ConstraintTooltip>
  );
}

function buildConstraintLines(node: SchemaFieldNode): string[] {
  const lines: string[] = [];
  if (node.minLength !== undefined) lines.push(`minLength: ${node.minLength}`);
  if (node.maxLength !== undefined) lines.push(`maxLength: ${node.maxLength}`);
  if (node.minimum !== undefined) lines.push(`minimum: ${node.minimum}`);
  if (node.maximum !== undefined) lines.push(`maximum: ${node.maximum}`);
  if (node.pattern !== undefined) lines.push(`pattern: ${node.pattern}`);
  if (node.enum !== undefined && node.enum.length > 0) lines.push(`enum: ${node.enum.join(', ')}`);
  return lines;
}

function ConstraintTooltip({ node, children }: { node: SchemaFieldNode; children: React.ReactNode }) {
  const lines = buildConstraintLines(node);
  if (lines.length === 0) return <>{children}</>;
  const title = (
    <div>
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
  return (
    <Tooltip title={title} placement="top">
      <span>{children}</span>
    </Tooltip>
  );
}

function ResizableTitle({ width, minWidth, onResize, children, ...restProps }: ResizableTitleProps) {
  if (!width || !onResize) {
    return <th {...restProps}>{children}</th>;
  }

  return (
    <Resizable
      width={width}
      height={0}
      resizeHandles={['e']}
      minConstraints={[minWidth ?? 80, 0]}
      draggableOpts={{ enableUserSelectHack: false }}
      handle={
        <span
          className="knife4j-schema-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整列宽"
          onClick={(event) => event.stopPropagation()}
        />
      }
      onResize={onResize}
    >
      <th {...restProps} style={{ ...restProps.style, width }}>
        {children}
      </th>
    </Resizable>
  );
}

export default function SchemaFieldTable({ fields, emptyText }: SchemaFieldTableProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => toRows(fields), [fields]);
  const tableLayout = useMemo(() => schemaFieldTableLayout(fields), [fields]);
  const defaultColumnWidths = tableLayout.columnWidths;
  const [columnWidths, setColumnWidths] = useState<SchemaFieldTableColumnWidths>(defaultColumnWidths);

  useEffect(() => {
    setColumnWidths(defaultColumnWidths);
  }, [defaultColumnWidths]);

  const handleResize = useCallback(
    (columnKey: SchemaFieldTableColumnKey) =>
      (_event: React.SyntheticEvent<Element>, { size }: ResizeCallbackData) => {
        setColumnWidths((current) => ({
          ...current,
          [columnKey]: Math.max(SCHEMA_FIELD_COLUMN_MIN_WIDTHS[columnKey], Math.round(size.width)),
        }));
      },
    [],
  );

  const resizableHeader = useCallback(
    (columnKey: SchemaFieldTableColumnKey) =>
      ({
        width: columnWidths[columnKey],
        minWidth: SCHEMA_FIELD_COLUMN_MIN_WIDTHS[columnKey],
        onResize: handleResize(columnKey),
      }) as unknown as React.HTMLAttributes<HTMLTableCellElement>,
    [columnWidths, handleResize],
  );

  const columns: ColumnsType<SchemaFieldRow> = [
    {
      title: t('schema.col.fieldName'),
      dataIndex: 'name',
      width: columnWidths.fieldName,
      onHeaderCell: () => resizableHeader('fieldName'),
      render: (value) => (
        <Text
          code
          title={value || 'items'}
          style={{
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            lineHeight: '20px',
          }}
        >
          {value || 'items'}
        </Text>
      ),
    },
    {
      title: t('schema.col.type'),
      width: columnWidths.type,
      onHeaderCell: () => resizableHeader('type'),
      render: (_, record) => <SchemaTypeLink node={record} />,
    },
    {
      title: t('schema.col.required'),
      dataIndex: 'required',
      width: columnWidths.required,
      onHeaderCell: () => resizableHeader('required'),
      render: (value) =>
        value ? (
          <Badge status="error" text={t('schema.required.yes')} />
        ) : (
          <Badge status="default" text={t('schema.required.no')} />
        ),
    },
    {
      title: t('schema.col.description'),
      dataIndex: 'description',
      width: columnWidths.description,
      onHeaderCell: () => resizableHeader('description'),
      render: (value, record) => (
        <Space size={6} wrap>
          {value ? <span>{value}</span> : <Text type="secondary">-</Text>}
          {record.refDescription && record.refDescription !== value && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.refTitle ? `[${record.refTitle}] ` : ''}
              {record.refDescription}
            </Text>
          )}
          {record.deprecated && <Tag color="red">{t('schema.flag.deprecated')}</Tag>}
          {record.readOnly && <Tag color="default">{t('schema.flag.readOnly')}</Tag>}
          {record.writeOnly && <Tag color="default">{t('schema.flag.writeOnly')}</Tag>}
          {record.truncated && <Tag color="warning">{t('schema.flag.truncated')}</Tag>}
        </Space>
      ),
    },
  ];

  return (
    <Table<SchemaFieldRow>
      columns={columns}
      components={{
        header: {
          cell: ResizableTitle,
        },
      }}
      dataSource={rows}
      pagination={false}
      size="small"
      bordered
      expandable={{
        childrenColumnName: 'children',
        defaultExpandAllRows: true,
      }}
      scroll={{ x: schemaFieldTableScrollX(columnWidths) }}
      locale={{ emptyText: emptyText ?? t('schema.noFields') }}
    />
  );
}
