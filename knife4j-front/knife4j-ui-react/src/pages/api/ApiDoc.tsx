import { Alert, Badge, Button, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import type { ParameterObject, ResponseObject, SchemaObject, SwaggerDoc } from '../../types/swagger';
import { OperationModeTabs, useCurrentOperation } from './useCurrentOperation';
import Markdown from '../../components/Markdown';
import { copyToClipboard } from '../../utils/clipboard';
import { generateApiMarkdown } from 'knife4j-core';

const { Title, Text } = Typography;

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

function schemaToBodyRows(schema: SchemaObject, doc: Pick<SwaggerDoc, 'components' | 'definitions'>): BodyRow[] {
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

function firstRequestSchema(
  requestBody: { content?: Record<string, { schema?: SchemaObject }> } | undefined,
): SchemaObject | undefined {
  if (!requestBody?.content) return undefined;
  return requestBody.content['application/json']?.schema ?? Object.values(requestBody.content)[0]?.schema;
}

function responseSchema(response: ResponseObject): string {
  const schema =
    response.content?.['application/json']?.schema ??
    response.schema ??
    Object.values(response.content ?? {})[0]?.schema;
  return schemaName(schema);
}

const METHOD_COLOR: Record<string, string> = {
  GET: 'green',
  POST: 'blue',
  PUT: 'orange',
  DELETE: 'red',
  PATCH: 'cyan',
  HEAD: 'purple',
  OPTIONS: 'default',
};

export default function ApiDoc() {
  const { t } = useTranslation();
  const { loading, swaggerDoc, operation } = useCurrentOperation();

  if (loading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  if (!swaggerDoc || !operation) {
    return (
      <Alert type="warning" showIcon message={t('apiDoc.notFound.title')} description={t('apiDoc.notFound.desc')} />
    );
  }

  const method = operation.method.toUpperCase();
  const op = operation.operation;

  const handleCopyEndpoint = () => {
    copyToClipboard(
      `${method} ${operation.path}`,
      () => message.success(t('apiDoc.copy.endpoint.success')),
      () => message.error(t('apiDoc.copy.failed')),
    );
  };

  const handleCopyMarkdown = () => {
    const md = generateApiMarkdown({
      method,
      path: operation.path,
      operation: op,
      docContext: swaggerDoc,
    });
    copyToClipboard(
      md,
      () => message.success(t('apiDoc.copy.markdown.success')),
      () => message.error(t('apiDoc.copy.failed')),
    );
  };

  const handleCopyUrl = () => {
    copyToClipboard(
      window.location.href,
      () => message.success(t('apiDoc.copy.url.success')),
      () => message.error(t('apiDoc.copy.failed')),
    );
  };

  const paramColumns: ColumnsType<ParamRow> = [
    {
      dataIndex: 'name',
      width: 180,
      render: (value) => <Text code>{value}</Text>,
    },
    {
      title: t('apiDoc.col.location'),
      dataIndex: 'in',
      width: 90,
      render: (value) => {
        const colorMap: Record<string, string> = {
          path: 'blue',
          query: 'cyan',
          header: 'purple',
          cookie: 'orange',
          body: 'geekblue',
          formData: 'lime',
        };
        return <Tag color={colorMap[value] ?? 'default'}>{value}</Tag>;
      },
    },
    { title: t('apiDoc.col.type'), dataIndex: 'type', width: 130 },
    {
      title: t('apiDoc.col.required'),
      dataIndex: 'required',
      width: 80,
      render: (value) =>
        value ? (
          <Badge status="error" text={t('schema.required.yes')} />
        ) : (
          <Badge status="default" text={t('schema.required.no')} />
        ),
    },
    { title: t('apiDoc.col.description'), dataIndex: 'description' },
  ];

  const bodyColumns: ColumnsType<BodyRow> = [
    {
      title: t('schema.col.fieldName'),
      dataIndex: 'name',
      width: 180,
      render: (value) => <Text code>{value}</Text>,
    },
    { title: t('apiDoc.col.type'), dataIndex: 'type', width: 130 },
    {
      title: t('apiDoc.col.required'),
      dataIndex: 'required',
      width: 80,
      render: (value) =>
        value ? (
          <Badge status="error" text={t('schema.required.yes')} />
        ) : (
          <Badge status="default" text={t('schema.required.no')} />
        ),
    },
    { title: t('apiDoc.col.description'), dataIndex: 'description' },
  ];

  const responseColumns: ColumnsType<ResponseRow> = [
    {
      title: t('apiDoc.col.statusCode'),
      dataIndex: 'statusCode',
      width: 100,
      render: (value) => {
        const color = value.startsWith('2') ? 'success' : value.startsWith('4') ? 'warning' : 'error';
        return <Tag color={color}>{value}</Tag>;
      },
    },
    { title: t('apiDoc.col.description'), dataIndex: 'description' },
    {
      title: t('apiDoc.col.schema'),
      dataIndex: 'schema',
      width: 180,
      render: (value) => (value ? <Text code>{value}</Text> : <Text type="secondary">—</Text>),
    },
  ];

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
    <div style={{ padding: '0 24px 24px', maxWidth: 1080 }}>
      <OperationModeTabs activeKey="doc" />

      <Space style={{ marginBottom: 8 }}>
        <Button size="small" icon={<CopyOutlined />} onClick={handleCopyEndpoint}>
          {t('apiDoc.copy.endpoint')}
        </Button>
        <Button size="small" icon={<CopyOutlined />} onClick={handleCopyMarkdown}>
          {t('apiDoc.copy.markdown')}
        </Button>
        <Button size="small" icon={<CopyOutlined />} onClick={handleCopyUrl}>
          {t('apiDoc.copy.url')}
        </Button>
      </Space>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Tag color={METHOD_COLOR[method] ?? 'default'} style={{ fontSize: 14, padding: '2px 10px' }}>
          {method}
        </Tag>
        <Text code style={{ fontSize: 15 }}>
          {operation.path}
        </Text>
        {op.deprecated && <Tag color="red">{t('apiDoc.deprecated')}</Tag>}
      </div>

      <Title level={4} style={{ marginTop: 0 }}>
        {op.summary ?? operation.path}
      </Title>
      {op.description && <Markdown source={op.description} />}

      <Title level={5} style={{ marginTop: 24 }}>
        {t('apiDoc.requestParams')}
      </Title>
      <Table<ParamRow>
        columns={paramColumns}
        dataSource={parameters}
        pagination={false}
        size="small"
        bordered
        locale={{ emptyText: t('apiDoc.noParams') }}
      />

      <Title level={5} style={{ marginTop: 24 }}>
        {t('apiDoc.requestBody')}
      </Title>
      <Table<BodyRow>
        columns={bodyColumns}
        dataSource={bodyRows}
        pagination={false}
        size="small"
        bordered
        locale={{ emptyText: bodySchema ? t('apiDoc.body.notExpandable') : t('apiDoc.noBody') }}
      />

      <Title level={5} style={{ marginTop: 24 }}>
        {t('apiDoc.responseStructure')}
      </Title>
      <Table<ResponseRow> columns={responseColumns} dataSource={responses} pagination={false} size="small" bordered />
    </div>
  );
}
