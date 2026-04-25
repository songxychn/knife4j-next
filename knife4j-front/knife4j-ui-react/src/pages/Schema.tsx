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

// ---- mock 数据 fallback ----

const MOCK_SCHEMAS: ModelDef[] = [
  {
    name: 'UserVO',
    description: '用户视图对象',
    fields: [
      { key: 'id', name: 'id', type: 'integer', format: 'int64', required: true, description: '用户 ID' },
      { key: 'username', name: 'username', type: 'string', required: true, description: '用户名' },
      { key: 'email', name: 'email', type: 'string', format: 'email', required: false, description: '邮箱地址' },
      { key: 'role', name: 'role', type: 'string', required: false, description: '角色，枚举：ADMIN / USER' },
      { key: 'createdAt', name: 'createdAt', type: 'string', format: 'date-time', required: false, description: '创建时间' },
    ],
  },
  {
    name: 'PageResult',
    description: '分页结果包装',
    fields: [
      { key: 'total', name: 'total', type: 'integer', format: 'int64', required: true, description: '总记录数' },
      { key: 'pageNum', name: 'pageNum', type: 'integer', format: 'int32', required: true, description: '当前页码' },
      { key: 'pageSize', name: 'pageSize', type: 'integer', format: 'int32', required: true, description: '每页大小' },
      {
        key: 'list', name: 'list', type: 'array', required: false, description: '数据列表',
        children: [
          { key: 'list.item', name: 'item', type: 'object', required: false, description: '列表元素' },
        ],
      },
    ],
  },
  {
    name: 'ApiResponse',
    description: '统一响应结构',
    fields: [
      { key: 'code', name: 'code', type: 'integer', format: 'int32', required: true, description: '业务状态码' },
      { key: 'message', name: 'message', type: 'string', required: false, description: '提示信息' },
      { key: 'data', name: 'data', type: 'object', required: false, description: '响应数据' },
      { key: 'timestamp', name: 'timestamp', type: 'integer', format: 'int64', required: false, description: '响应时间戳' },
    ],
  },
  {
    name: 'CreateUserRequest',
    description: '创建用户请求体',
    fields: [
      { key: 'username', name: 'username', type: 'string', required: true, description: '用户名，3-32 字符' },
      { key: 'password', name: 'password', type: 'string', format: 'password', required: true, description: '密码，至少 8 位' },
      { key: 'email', name: 'email', type: 'string', format: 'email', required: false, description: '邮箱' },
      { key: 'role', name: 'role', type: 'string', required: false, description: '角色，默认 USER' },
    ],
  },
];

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
  const { schemas, loading, usingMock } = useGroup();
  const models: ModelDef[] = usingMock || Object.keys(schemas).length === 0
    ? MOCK_SCHEMAS
    : schemasToModels(schemas);

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
      render: (v) => v ? <Text type="secondary">{v}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: t('schema.col.required'),
      dataIndex: 'required',
      width: 70,
      render: (v) => v
        ? <Badge status="error" text={t('schema.required.yes')} />
        : <Badge status="default" text={t('schema.required.no')} />,
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
        <Text strong style={{ fontSize: 14 }}>{model.name}</Text>
        {model.description && (
          <Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
            {model.description}
          </Text>
        )}
        <Tag style={{ marginLeft: 12 }} color="default">{model.fields.length} {t('schema.fields')}</Tag>
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
        {usingMock && <Tag color="orange" style={{ marginLeft: 8, fontSize: 11 }}>{t('schema.tag.mock')}</Tag>}
      </Title>
      {loading ? (
        <Spin />
      ) : (
        <Collapse
          items={collapseItems}
          defaultActiveKey={models.map((m) => m.name)}
        />
      )}
    </div>
  );
}
