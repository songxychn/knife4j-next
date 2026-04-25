import { Badge, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';

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

const MOCK_OPERATION = {
  url: '/api/user/{id}',
  methodType: 'GET',
  summary: '查询用户详情',
  description: '根据用户 ID 查询用户的基本信息，包含姓名、邮箱和角色。',
  deprecated: false,
  parameters: [
    { key: '1', name: 'id', in: 'path', type: 'integer', required: true, description: '用户 ID' },
    { key: '2', name: 'Authorization', in: 'header', type: 'string', required: true, description: 'Bearer token' },
    { key: '3', name: 'fields', in: 'query', type: 'string', required: false, description: '需要返回的字段，逗号分隔' },
  ] as ParamRow[],
  responses: [
    { key: '200', statusCode: '200', description: '成功', schema: 'UserVO' },
    { key: '404', statusCode: '404', description: '用户不存在', schema: '' },
    { key: '401', statusCode: '401', description: '未授权', schema: '' },
  ] as ResponseRow[],
};

// ---- 请求参数表格 ----

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

// ---- 响应结构表格 ----

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
      <Title level={5} style={{ marginTop: 24 }}>请求参数</Title>
      <Table<ParamRow>
        columns={paramColumns}
        dataSource={op.parameters}
        pagination={false}
        size="small"
        bordered
      />

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
