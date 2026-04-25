import { Alert, Badge, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ParameterObject, ResponseObject, SchemaObject, SwaggerDoc } from '../../types/swagger';
import { OperationModeTabs, useCurrentOperation } from './useCurrentOperation';

const { Title, Paragraph, Text } = Typography;

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

function resolveRef(ref: string, doc: Pick<SwaggerDoc, 'components' | 'definitions'>): SchemaObject | undefined {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/) ?? ref.match(/^#\/definitions\/(.+)$/);
  if (!match) return undefined;
  return (doc.components?.schemas ?? doc.definitions ?? {})[match[1]];
}

function schemaName(schema?: SchemaObject): string {
  if (!schema) return '';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? '$ref';
  if (schema.type === 'array') return `${schemaName(schema.items) || 'object'}[]`;
  return [schema.type, schema.format].filter(Boolean).join(' / ') || 'object';
}

function parameterType(parameter: ParameterObject): string {
  return schemaName(parameter.schema) || [parameter.type, parameter.format].filter(Boolean).join(' / ') || '-';
}

function schemaToBodyRows(
  schema: SchemaObject,
  doc: Pick<SwaggerDoc, 'components' | 'definitions'>,
): BodyRow[] {
  const resolved = schema.$ref ? resolveRef(schema.$ref, doc) : schema;
  if (!resolved?.properties) return [];
  const requiredSet = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties).map(([name, prop]) => ({
    key: name,
    name,
    type: schemaName(prop),
    required: requiredSet.has(name),
    description: prop.description ?? '',
  }));
}

function firstRequestSchema(requestBody: { content?: Record<string, { schema?: SchemaObject }> } | undefined): SchemaObject | undefined {
  if (!requestBody?.content) return undefined;
  return requestBody.content['application/json']?.schema ?? Object.values(requestBody.content)[0]?.schema;
}

function responseSchema(response: ResponseObject): string {
  const schema = response.content?.['application/json']?.schema ?? response.schema ?? Object.values(response.content ?? {})[0]?.schema;
  return schemaName(schema);
}

const paramColumns: ColumnsType<ParamRow> = [
  {
    title: '参数名',
    dataIndex: 'name',
    width: 180,
    render: (value) => <Text code>{value}</Text>,
  },
  {
    title: '位置',
    dataIndex: 'in',
    width: 90,
    render: (value) => {
      const colorMap: Record<string, string> = {
        path: 'blue', query: 'cyan', header: 'purple', cookie: 'orange', body: 'geekblue', formData: 'lime',
      };
      return <Tag color={colorMap[value] ?? 'default'}>{value}</Tag>;
    },
  },
  { title: '类型', dataIndex: 'type', width: 130 },
  {
    title: '必填',
    dataIndex: 'required',
    width: 80,
    render: (value) => value ? <Badge status="error" text="是" /> : <Badge status="default" text="否" />,
  },
  { title: '说明', dataIndex: 'description' },
];

const bodyColumns: ColumnsType<BodyRow> = [
  {
    title: '字段名',
    dataIndex: 'name',
    width: 180,
    render: (value) => <Text code>{value}</Text>,
  },
  { title: '类型', dataIndex: 'type', width: 130 },
  {
    title: '必填',
    dataIndex: 'required',
    width: 80,
    render: (value) => value ? <Badge status="error" text="是" /> : <Badge status="default" text="否" />,
  },
  { title: '说明', dataIndex: 'description' },
];

const responseColumns: ColumnsType<ResponseRow> = [
  {
    title: '状态码',
    dataIndex: 'statusCode',
    width: 100,
    render: (value) => {
      const color = value.startsWith('2') ? 'success' : value.startsWith('4') ? 'warning' : 'error';
      return <Tag color={color}>{value}</Tag>;
    },
  },
  { title: '说明', dataIndex: 'description' },
  {
    title: 'Schema',
    dataIndex: 'schema',
    width: 180,
    render: (value) => value ? <Text code>{value}</Text> : <Text type="secondary">—</Text>,
  },
];

const METHOD_COLOR: Record<string, string> = {
  GET: 'green', POST: 'blue', PUT: 'orange', DELETE: 'red', PATCH: 'cyan', HEAD: 'purple', OPTIONS: 'default',
};

export default function ApiDoc() {
  const { loading, swaggerDoc, operation } = useCurrentOperation();

  if (loading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  if (!swaggerDoc || !operation) {
    return <Alert type="warning" showIcon message="未找到接口文档" description="当前路由没有匹配到 OpenAPI operation，请重新从左侧接口列表打开。" />;
  }

  const method = operation.method.toUpperCase();
  const op = operation.operation;
  const parameters: ParamRow[] = (op.parameters ?? []).map((parameter, index) => ({
    key: `${parameter.in}-${parameter.name}-${index}`,
    name: parameter.name,
    in: parameter.in,
    type: parameterType(parameter),
    required: Boolean(parameter.required),
    description: parameter.description ?? '',
  }));
  const bodySchema = firstRequestSchema(op.requestBody);
  const bodyRows = bodySchema ? schemaToBodyRows(bodySchema, swaggerDoc) : [];
  const responses: ResponseRow[] = Object.entries(op.responses ?? {}).map(([statusCode, response]) => ({
    key: statusCode,
    statusCode,
    description: response.description ?? '',
    schema: responseSchema(response),
  }));

  return (
    <div style={{ padding: '24px', maxWidth: 1080 }}>
      <OperationModeTabs activeKey="doc" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Tag color={METHOD_COLOR[method] ?? 'default'} style={{ fontSize: 14, padding: '2px 10px' }}>
          {method}
        </Tag>
        <Text code style={{ fontSize: 15 }}>{operation.path}</Text>
        {op.deprecated && <Tag color="red">已废弃</Tag>}
      </div>

      <Title level={4} style={{ marginTop: 0 }}>{op.summary ?? operation.path}</Title>
      {op.description && <Paragraph type="secondary">{op.description}</Paragraph>}

      <Title level={5} style={{ marginTop: 24 }}>请求参数</Title>
      <Table<ParamRow>
        columns={paramColumns}
        dataSource={parameters}
        pagination={false}
        size="small"
        bordered
        locale={{ emptyText: '无请求参数' }}
      />

      <Title level={5} style={{ marginTop: 24 }}>请求体</Title>
      <Table<BodyRow>
        columns={bodyColumns}
        dataSource={bodyRows}
        pagination={false}
        size="small"
        bordered
        locale={{ emptyText: bodySchema ? '当前请求体暂不支持字段展开' : '无请求体' }}
      />

      <Title level={5} style={{ marginTop: 24 }}>响应结构</Title>
      <Table<ResponseRow>
        columns={responseColumns}
        dataSource={responses}
        pagination={false}
        size="small"
        bordered
      />
    </div>
  );
}
