import { Badge, Collapse, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { useGroup } from '../context/GroupContext';
import type { SchemaObject } from '../types/swagger';

const { Title, Text } = Typography;

// ---- 类型定义 ----

interface SchemaField {
  key: string;
  name: string;
  type: string;
  format?: string;
  required: boolean;
  description: string;
  children?: SchemaField[];
}

interface ModelDef {
  name: string;
  description?: string;
  fields: SchemaField[];
}

// ---- 将 SchemaObject 转换为字段列表 ----

function schemaToFields(schema: SchemaObject, requiredSet: Set<string>): SchemaField[] {
  const props = schema.properties ?? {};
  return Object.entries(props).map(([name, prop]) => {
    const field: SchemaField = {
      key: name,
      name,
      type: prop.type ?? (prop.$ref ? 'object' : 'string'),
      format: prop.format,
      required: requiredSet.has(name),
      description: prop.description ?? '',
    };
    if (prop.type === 'object' && prop.properties) {
      field.children = schemaToFields(prop, new Set(prop.required ?? []));
    }
    return field;
  });
}

function schemasToModels(schemas: Record<string, SchemaObject>): ModelDef[] {
  return Object.entries(schemas).map(([name, schema]) => ({
    name,
    description: schema.description,
    fields: schemaToFields(schema, new Set(schema.required ?? [])),
  }));
}

// ---- 类型颜色映射 ----

const TYPE_COLOR: Record<string, string> = {
  integer: 'blue',
  number: 'cyan',
  string: 'green',
  boolean: 'orange',
  array: 'purple',
  object: 'geekblue',
};

// ---- 页面 ----

export default function Schema() {
  const { t } = useTranslation();
  const { schemas, loading } = useGroup();
  // loading 期间 schemas 为空对象，不展示 mock，让 Spin 占位；数据加载完后用真实 schemas
  const models: ModelDef[] = loading ? [] : schemasToModels(schemas);

  const fieldColumns: ColumnsType<SchemaField> = [
    {
      title: t('schema.col.fieldName'),
      dataIndex: 'name',
      width: 180,
      render: (v) => <Text code>{v}</Text>,
    },
    {
      title: t('schema.col.type'),
      dataIndex: 'type',
      width: 100,
      render: (v) => <Tag color={TYPE_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: t('schema.col.format'),
      dataIndex: 'format',
      width: 110,
      render: (v) => (v ? <Text type="secondary">{v}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: t('schema.col.required'),
      dataIndex: 'required',
      width: 70,
      render: (v) =>
        v ? (
          <Badge status="error" text={t('schema.required.yes')} />
        ) : (
          <Badge status="default" text={t('schema.required.no')} />
        ),
    },
    {
      title: t('schema.col.description'),
      dataIndex: 'description',
    },
  ];

  const collapseItems = models.map((model) => ({
    key: model.name,
    label: (
      <span>
        <Text strong style={{ fontSize: 14 }}>
          {model.name}
        </Text>
        {model.description && (
          <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
            {model.description}
          </Text>
        )}
        <Tag style={{ marginLeft: 12 }} color="default">
          {model.fields.length} {t('schema.fields')}
        </Tag>
      </span>
    ),
    children: (
      <Table<SchemaField>
        columns={fieldColumns}
        dataSource={model.fields}
        pagination={false}
        size="small"
        bordered
        expandable={{
          childrenColumnName: 'children',
          defaultExpandAllRows: true,
        }}
      />
    ),
  }));

  return (
    <div style={{ padding: '24px', maxWidth: 1100 }}>
      <Title level={4} style={{ marginBottom: 16 }}>
        {t('schema.title')}
      </Title>
      {loading ? <Spin /> : <Collapse items={collapseItems} defaultActiveKey={models.map((m) => m.name)} />}
    </div>
  );
}
