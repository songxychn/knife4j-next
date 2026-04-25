import { Badge, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { SchemaObject, SwaggerDoc } from '../../types/swagger';

const { Title, Paragraph, Text } = Typography;

// ---- mock 数据（对标 knife4j-core Knife4jPathItemObject 结构）----

interface ParamRow {
  key: string;
  name: string;
  in: string;
  type: string;
  required: boolean;
  description: string;
}

interface ResponseRow {
  key: string;
  statusCode: string;
  description: string;
  schema: string;
}

interface BodyRow {
  key: string;
  name: string;
  type: string;
  required: boolean;
  description: string;
}

const MOCK_OPERATION = {
  url: '/api/user',
  methodType: 'POST',
  summary: '创建用户',
  description: '创建一个新用户，请求体包含用户基本信息。',
  deprecated: false,
  parameters: [
    { key: '1', name: 'Authorization', in: 'header', type: 'string', required: true, description: 'Bearer token' },
  ] as ParamRow[],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          $ref: '#/components/schemas/CreateUserRequest',
        },
      },
    },
  },
  responses: [
    { key: '200', statusCode: '200', description: '成功', schema: 'UserVO' },
    { key: '400', statusCode: '400', description: '参数错误', schema: '' },
    { key: '401', statusCode: '401', description: '未授权', schema: '' },
  ] as ResponseRow[],
};

const MOCK_SWAGGER_DOC: Pick<SwaggerDoc, 'components'> = {
  components: {
    schemas: {
      CreateUserRequest: {
        type: 'object',
        required: ['username', 'email'],
        properties: {
          username: { type: 'string', description: '用户名，3-20 个字符' },
          email: { type: 'string', format: 'email', description: '邮箱地址' },
          role: { type: 'string', description: '角色，默认 user', enum: ['user', 'admin'] },
          age: { type: 'integer', description: '年龄' },
        },
      },
    },
  },
};

// ---- $ref 解析 ----

function resolveRef(ref: string, doc: Pick<SwaggerDoc, 'components'>): SchemaObject | undefined {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/) ?? ref.match(/^#\/definitions\/(.+)$/);
  if (!match) return undefined;
  return (doc.components?.schemas ?? {})[match[1]];
}

function schemaToBodyRows(
  schema: SchemaObject,
  doc: Pick<SwaggerDoc, 'components'>,
): BodyRow[] {
  const resolved = schema.$ref ? resolveRef(schema.$ref, doc) : schema;
  if (!resolved?.properties) return [];
  const requiredSet = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties).map(([name, prop]) => ({
    key: name,
    name,
    type: prop.type ?? (prop.$ref ? (prop.$ref.split('/').pop() ?? '$ref') : 'object'),
    required: requiredSet.has(name),
    description: prop.description ?? '',
  }));
}

// ---- 请求参数表格列 ----

const paramColumns: ColumnsType<ParamRow> = [
  {
    title: '参数名',
    dataIndex: 'name',
    width: 160,
    render: (v) => <Text code>{v}</Text>,
  },
  {
    title: '位置',
    dataIndex: 'in',
    width: 90,
    render: (v) => {
      const colorMap: Record<string, string> = {
        path: 'blue', query: 'cyan', header: 'purple', cookie: 'orange',
      };
      return <Tag color={colorMap[v] ?? 'default'}>{v}</Tag>;
    },
  },
  { title: '类型', dataIndex: 'type', width: 100 },
  {
    title: '必填',
    dataIndex: 'required',
    width: 70,
    render: (v) => v ? <Badge status="error" text="是" /> : <Badge status="default" text="否" />,
  },
  { title: '说明', dataIndex: 'description' },
];

// ---- 请求体字段表格列 ----

const bodyColumns: ColumnsType<BodyRow> = [
  {
    title: '字段名',
    dataIndex: 'name',
    width: 160,
    render: (v) => <Text code>{v}</Text>,
  },
  { title: '类型', dataIndex: 'type', width: 100 },
  {
    title: '必填',
    dataIndex: 'required',
    width: 70,
    render: (v) => v ? <Badge status="error" text="是" /> : <Badge status="default" text="否" />,
  },
  { title: '说明', dataIndex: 'description' },
];

// ---- 响应结构表格列 ----

const responseColumns: ColumnsType<ResponseRow> = [
  {
    title: '状态码',
    dataIndex: 'statusCode',
    width: 90,
    render: (v) => {
      const color = v.startsWith('2') ? 'success' : v.startsWith('4') ? 'warning' : 'error';
      return <Tag color={color}>{v}</Tag>;
    },
  },
  { title: '说明', dataIndex: 'description' },
  {
    title: 'Schema',
    dataIndex: 'schema',
    render: (v) => v ? <Text code>{v}</Text> : <Text type="secondary">—</Text>,
  },
];

// ---- 方法颜色 ----

const METHOD_COLOR: Record<string, string> = {
  GET: 'green', POST: 'blue', PUT: 'orange', DELETE: 'red',
  PATCH: 'cyan', HEAD: 'purple', OPTIONS: 'default',
};

export default function ApiDoc() {
  const op = MOCK_OPERATION;
  const doc = MOCK_SWAGGER_DOC;

  const bodyRows: BodyRow[] = (() => {
    const rb = op.requestBody;
    if (!rb) return [];
    const jsonContent = rb.content?.['application/json'];
    if (!jsonContent?.schema) return [];
    return schemaToBodyRows(jsonContent.schema as SchemaObject, doc);
  })();

  return (
    <div style={{ padding: '24px', maxWidth: 960 }}>
      {/* 接口标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Tag color={METHOD_COLOR[op.methodType] ?? 'default'} style={{ fontSize: 14, padding: '2px 10px' }}>
          {op.methodType}
        </Tag>
        <Text code style={{ fontSize: 15 }}>{op.url}</Text>
        {op.deprecated && <Tag color="red">已废弃</Tag>}
      </div>

      <Title level={4} style={{ marginTop: 0 }}>{op.summary}</Title>
      {op.description && <Paragraph type="secondary">{op.description}</Paragraph>}

      {/* 请求参数 */}
      {op.parameters.length > 0 && (
        <>
          <Title level={5} style={{ marginTop: 24 }}>请求参数</Title>
          <Table<ParamRow>
            columns={paramColumns}
            dataSource={op.parameters}
            pagination={false}
            size="small"
            bordered
          />
        </>
      )}

      {/* 请求体 */}
      {bodyRows.length > 0 && (
        <>
          <Title level={5} style={{ marginTop: 24 }}>请求体（application/json）</Title>
          <Table<BodyRow>
            columns={bodyColumns}
            dataSource={bodyRows}
            pagination={false}
            size="small"
            bordered
          />
        </>
      )}

      {/* 响应结构 */}
      <Title level={5} style={{ marginTop: 24 }}>响应结构</Title>
      <Table<ResponseRow>
        columns={responseColumns}
        dataSource={op.responses}
        pagination={false}
        size="small"
        bordered
      />
    </div>
  );
}
