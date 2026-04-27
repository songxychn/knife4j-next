import { Alert, Badge, Button, Space, Spin, Table, Tag, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { buildSchemaFieldTree, type SchemaFieldNode } from 'knife4j-core';
import { useTranslation } from 'react-i18next';
import type { ParameterObject, ResponseObject, SchemaObject, SwaggerDoc } from '../../types/swagger';
import { OperationModeTabs, useCurrentOperation } from './useCurrentOperation';
import Markdown from '../../components/Markdown';
import { copyToClipboard } from '../../utils/clipboard';
import { generateApiMarkdown } from 'knife4j-core';
import SchemaFieldTable, { SchemaTypeLink } from '../../components/schema/SchemaFieldTable';
import { schemaNameFromRef } from '../../components/schema/schemaUtils';

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
  schema?: SchemaObject;
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

function firstRequestSchema(
  requestBody: { content?: Record<string, { schema?: SchemaObject }> } | undefined,
  parameters: ParameterObject[] | undefined,
): SchemaObject | undefined {
  const bodyParameter = parameters?.find((parameter) => parameter.in === 'body')?.schema;
  if (!requestBody?.content) return bodyParameter;
  return (
    requestBody.content['application/json']?.schema ?? Object.values(requestBody.content)[0]?.schema ?? bodyParameter
  );
}

function responseSchema(response: ResponseObject): SchemaObject | undefined {
  return (
    response.content?.['application/json']?.schema ??
    response.schema ??
    Object.values(response.content ?? {})[0]?.schema
  );
}

function schemaToFieldNodes(schema: SchemaObject, doc: SwaggerDoc): SchemaFieldNode[] {
  return buildSchemaFieldTree(schema as Record<string, unknown>, {
    doc: doc as unknown as Record<string, unknown>,
    maxDepth: 8,
  });
}

function schemaToTypeNode(schema: SchemaObject | undefined): SchemaFieldNode {
  if (!schema) return { name: '', type: 'unknown', required: false };
  if (schema.$ref) {
    return { name: '', type: 'object', required: false, refName: schemaNameFromRef(schema.$ref) };
  }
  if (schema.type === 'array') {
    return {
      name: '',
      type: 'array',
      required: false,
      children: schema.items ? [schemaToTypeNode(schema.items)] : undefined,
    };
  }
  return {
    name: '',
    type: schema.type ?? 'object',
    format: schema.format,
    required: false,
  };
}

function collectSchemaRefs(
  schema: SchemaObject | undefined,
  doc: Pick<SwaggerDoc, 'components' | 'definitions'>,
  refs: Set<string>,
  seenRefs = new Set<string>(),
  depth = 0,
) {
  if (!schema || depth > 12) return;
  if (schema.$ref) {
    const refName = schemaNameFromRef(schema.$ref);
    if (refName) refs.add(refName);
    if (seenRefs.has(schema.$ref)) return;
    const resolved = resolveRef(schema.$ref, doc);
    if (resolved) {
      collectSchemaRefs(resolved, doc, refs, new Set([...seenRefs, schema.$ref]), depth + 1);
    }
  }
  if (schema.items) collectSchemaRefs(schema.items, doc, refs, seenRefs, depth + 1);
  Object.values(schema.properties ?? {}).forEach((prop) => collectSchemaRefs(prop, doc, refs, seenRefs, depth + 1));

  const recordSchema = schema as Record<string, unknown>;
  const compositionKeys = ['allOf', 'oneOf', 'anyOf'] as const;
  compositionKeys.forEach((key) => {
    const parts = recordSchema[key];
    if (Array.isArray(parts)) {
      parts.forEach((part) => collectSchemaRefs(part as SchemaObject, doc, refs, seenRefs, depth + 1));
    }
  });

  const additionalProperties = recordSchema.additionalProperties;
  if (additionalProperties && typeof additionalProperties === 'object') {
    collectSchemaRefs(additionalProperties as SchemaObject, doc, refs, seenRefs, depth + 1);
  }
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
      render: (value: SchemaObject | undefined) =>
        value ? <SchemaTypeLink node={schemaToTypeNode(value)} /> : <Text type="secondary">—</Text>,
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
  const bodySchema = firstRequestSchema(op.requestBody, op.parameters);
  const bodyFields = bodySchema ? schemaToFieldNodes(bodySchema, swaggerDoc) : [];
  const responses: ResponseRow[] = Object.entries(op.responses ?? {}).map(([statusCode, response]) => ({
    key: statusCode,
    statusCode,
    description: response.description ?? '',
    schema: responseSchema(response),
  }));
  const relatedModelNames = (() => {
    const refs = new Set<string>();
    (op.parameters ?? []).forEach((parameter) => collectSchemaRefs(parameter.schema, swaggerDoc, refs));
    collectSchemaRefs(bodySchema, swaggerDoc, refs);
    Object.values(op.responses ?? {}).forEach((response) =>
      collectSchemaRefs(responseSchema(response), swaggerDoc, refs),
    );
    return Array.from(refs).filter((name) =>
      Boolean(swaggerDoc.components?.schemas?.[name] ?? swaggerDoc.definitions?.[name]),
    );
  })();

  return (
    <div style={{ padding: '0 24px 24px', maxWidth: 1080 }}>
      <OperationModeTabs activeKey="doc" />

      <Space style={{ marginBottom: 8 }}>
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

      {relatedModelNames.length > 0 && (
        <Space size={6} wrap style={{ marginTop: 4, marginBottom: 8 }}>
          <Text type="secondary">{t('apiDoc.relatedModels')}</Text>
          {relatedModelNames.map((name) => (
            <SchemaTypeLink key={name} node={{ name: '', type: 'object', required: false, refName: name }} />
          ))}
        </Space>
      )}

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
      <SchemaFieldTable
        fields={bodyFields}
        emptyText={bodySchema ? t('apiDoc.body.notExpandable') : t('apiDoc.noBody')}
      />

      <Title level={5} style={{ marginTop: 24 }}>
        {t('apiDoc.responseStructure')}
      </Title>
      <Table<ResponseRow> columns={responseColumns} dataSource={responses} pagination={false} size="small" bordered />
    </div>
  );
}
