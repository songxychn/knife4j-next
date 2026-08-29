import { Alert, Badge, Button, Space, Spin, Table, Tabs, Tag, Typography, message } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  buildSchemaFieldTree,
  dereferenceReferenceObject,
  generateApiMarkdown,
  resolveRefMeta,
  type SchemaFieldNode,
} from 'knife4j-core';
import { useTranslation } from 'react-i18next';
import type {
  ParameterObject,
  RequestBodyObject,
  ResponseHeaderObject,
  ResponseObject,
  SchemaObject,
  SwaggerDoc,
} from '../../types/swagger';
import { OperationModeLayout, useCurrentOperation } from './useCurrentOperation';
import DescriptionText from '../../components/DescriptionText';
import Markdown from '../../components/Markdown';
import { copyToClipboard } from '../../utils/clipboard';
import SchemaFieldTable, { SchemaTypeLink } from '../../components/schema/SchemaFieldTable';
import { schemaNameFromRef } from '../../components/schema/schemaUtils';
import CodeBlock from './CodeBlock';
import { operationAuthors } from './operationAuthor';
import { applyValidationGroupRequiredFields } from './validationGroups';
import { firstRequestMedia, requestBodyExample, responseExamples } from './apiDocExamples';
import { useSettings } from '../../context/SettingsContext';
import { resolveResponseOverviewVisibility } from './responseOverview';

const { Title, Text } = Typography;

interface ParamRow {
  key: string;
  name: string;
  in: string;
  type: string;
  required: boolean;
  description: string;
  refDescription?: string;
  refTitle?: string;
}

interface ResponseRow {
  key: string;
  statusCode: string;
  description: string;
  schema?: SchemaObject;
  mediaType?: string;
  headers: Array<{
    key: string;
    name: string;
    type: string;
    required: boolean;
    description: string;
    example: string;
  }>;
}

function resolveRef(ref: string, doc: Pick<SwaggerDoc, 'components' | 'definitions'>): SchemaObject | undefined {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/) ?? ref.match(/^#\/definitions\/(.+)$/);
  if (!match) return undefined;
  return (doc.components?.schemas ?? doc.definitions ?? {})[match[1]];
}

function schemaName(schema?: SchemaObject): string {
  if (!schema) return '';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? '$ref';
  const declaredTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const type = declaredTypes.find((value) => value !== 'null') ?? declaredTypes[0];
  if (type === 'array')
    return `${schemaName(schema.items) || 'object'}[]${declaredTypes.includes('null') ? ' | null' : ''}`;
  // string+byte is the OAS representation of Java Byte — display as 'byte' for clarity
  if (type === 'string' && schema.format === 'byte') return 'byte';
  return [declaredTypes.join(' | '), schema.format].filter(Boolean).join(' / ') || 'object';
}

function parameterType(parameter: ParameterObject): string {
  return schemaName(parameter.schema) || [parameter.type, parameter.format].filter(Boolean).join(' / ') || '-';
}

function firstRequestSchema(
  requestBody: RequestBodyObject | undefined,
  parameters: ParameterObject[] | undefined,
): SchemaObject | undefined {
  const bodyParameter = parameters?.find((parameter) => parameter.in === 'body')?.schema;
  const mediaEntry = firstRequestMedia(requestBody);
  if (!mediaEntry) return bodyParameter;
  return mediaEntry.mediaObj.schema ?? bodyParameter;
}

function responseSchema(response: ResponseObject): SchemaObject | undefined {
  return (
    response.content?.['application/json']?.schema ??
    response.schema ??
    Object.values(response.content ?? {})[0]?.schema
  );
}

function responseMediaType(response: ResponseObject): string | undefined {
  if (response.content?.['application/json']) return 'application/json';
  return Object.keys(response.content ?? {})[0];
}

function exampleText(value: unknown): string {
  if (value === undefined) return '-';
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
}

function schemaToFieldNodes(schema: SchemaObject, doc: SwaggerDoc): SchemaFieldNode[] {
  return buildSchemaFieldTree(schema as Record<string, unknown>, {
    doc: doc as unknown as Record<string, unknown>,
    maxDepth: 8,
  });
}

/** Recursively filter field nodes by access mode. */
function filterFieldNodes(nodes: SchemaFieldNode[], mode: 'request' | 'response'): SchemaFieldNode[] {
  return nodes
    .filter((node) => {
      if (mode === 'request' && node.readOnly) return false;
      if (mode === 'response' && node.writeOnly) return false;
      return true;
    })
    .map((node) => (node.children ? { ...node, children: filterFieldNodes(node.children, mode) } : node));
}

function schemaToTypeNode(schema: SchemaObject | undefined): SchemaFieldNode {
  if (!schema) return { name: '', type: 'unknown', required: false };
  if (schema.$ref) {
    return {
      name: '',
      type: 'object',
      required: false,
      refName: schemaNameFromRef(schema.$ref),
    };
  }
  const declaredTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const type = declaredTypes.find((value) => value !== 'null') ?? declaredTypes[0];
  if (type === 'array') {
    return {
      name: '',
      type: 'array',
      types: declaredTypes.length > 1 ? declaredTypes : undefined,
      required: false,
      children: schema.items ? [schemaToTypeNode(schema.items)] : undefined,
    };
  }
  return {
    name: '',
    type: type ?? 'object',
    types: declaredTypes.length > 1 ? declaredTypes : undefined,
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
  TRACE: 'magenta',
};

export default function ApiDoc() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const { loading, swaggerDoc, operation } = useCurrentOperation();

  if (loading) {
    return (
      <OperationModeLayout activeKey="doc">
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      </OperationModeLayout>
    );
  }

  if (!swaggerDoc || !operation) {
    return (
      <OperationModeLayout activeKey="doc">
        <Alert type="warning" showIcon message={t('apiDoc.notFound.title')} description={t('apiDoc.notFound.desc')} />
      </OperationModeLayout>
    );
  }

  const method = operation.method.toUpperCase();
  const rawOperation = operation.operation;
  const resolveReference = <T extends object>(value: T): T =>
    '$ref' in value && typeof (value as { $ref?: unknown }).$ref === 'string'
      ? (dereferenceReferenceObject(
          value as Record<string, unknown>,
          swaggerDoc as unknown as Record<string, unknown>,
        ) as T)
      : value;
  const resolvedParameters = (rawOperation.parameters ?? []).map(resolveReference);
  const resolvedRequestBody = rawOperation.requestBody ? resolveReference(rawOperation.requestBody) : undefined;
  const resolvedResponses = Object.fromEntries(
    Object.entries(rawOperation.responses ?? {}).map(([status, response]) => [status, resolveReference(response)]),
  );
  const op = {
    ...rawOperation,
    parameters: resolvedParameters,
    requestBody: resolvedRequestBody,
    responses: resolvedResponses,
  };

  const handleCopyMarkdown = () => {
    const md = generateApiMarkdown({
      method,
      path: operation.path,
      operation: op,
      docContext: swaggerDoc,
      labels: {
        deprecated: t('apiDoc.markdown.deprecated'),
        requestParameters: t('apiDoc.requestParams'),
        noRequestParameters: t('apiDoc.noParams'),
        requestBody: t('apiDoc.requestBody'),
        noRequestBody: t('apiDoc.noBody'),
        requestBodyNotExpandable: t('apiDoc.body.notExpandable'),
        responseStructure: t('apiDoc.responseStructure'),
        noResponse: t('apiDoc.noResponse'),
        name: t('apiDoc.col.paramName'),
        location: t('apiDoc.col.location'),
        type: t('apiDoc.col.type'),
        required: t('apiDoc.col.required'),
        description: t('apiDoc.col.description'),
        field: t('apiDoc.col.fieldName'),
        yes: t('schema.required.yes'),
        no: t('schema.required.no'),
        status: t('apiDoc.col.statusCode'),
        schema: t('apiDoc.col.schema'),
      },
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
    {
      title: t('apiDoc.col.description'),
      dataIndex: 'description',
      render: (value: string, record: ParamRow) => (
        <Space size={4} direction="vertical" style={{ width: '100%' }}>
          {value ? <DescriptionText>{value}</DescriptionText> : <Text type="secondary">-</Text>}
          {record.refDescription && record.refDescription !== value && (
            <DescriptionText type="secondary" style={{ fontSize: 12 }}>
              {record.refTitle ? `[${record.refTitle}] ` : ''}
              {record.refDescription}
            </DescriptionText>
          )}
        </Space>
      ),
    },
  ];
  const responseHeaderColumns: ColumnsType<ResponseRow['headers'][number]> = [
    {
      title: t('apiDebug.col.header'),
      dataIndex: 'name',
      width: 220,
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
    { title: t('apiDebug.col.headerValue'), dataIndex: 'example' },
  ];

  const parameters: ParamRow[] = (op.parameters ?? []).map((parameter, index) => {
    const ref = (parameter as ParameterObject & { $ref?: string }).$ref ?? parameter.schema?.$ref;
    const { refDescription, refTitle } = ref
      ? resolveRefMeta(ref, swaggerDoc as unknown as Record<string, unknown>)
      : {};
    return {
      key: `${parameter.in}-${parameter.name}-${index}`,
      name: parameter.name,
      in: parameter.in,
      type: parameterType(parameter),
      required: Boolean(parameter.required),
      description: parameter.description ?? '',
      refDescription: refDescription !== parameter.description ? refDescription : undefined,
      refTitle,
    };
  });
  const bodySchema = firstRequestSchema(op.requestBody, op.parameters);
  const bodyFields = bodySchema
    ? filterFieldNodes(applyValidationGroupRequiredFields(schemaToFieldNodes(bodySchema, swaggerDoc), op), 'request')
    : [];
  const responses: ResponseRow[] = Object.entries(op.responses ?? {}).map(([statusCode, response]) => {
    const headers = Object.entries(response.headers ?? {}).map(([name, header]) => {
      const resolvedHeader = header.$ref
        ? (dereferenceReferenceObject(
            header as unknown as Record<string, unknown>,
            swaggerDoc as unknown as Record<string, unknown>,
          ) as ResponseHeaderObject)
        : header;
      return {
        key: name,
        name,
        type: schemaName(resolvedHeader.schema) || '-',
        required: Boolean(resolvedHeader.required),
        description: resolvedHeader.description ?? '',
        example: exampleText(resolvedHeader.example ?? resolvedHeader.schema?.example),
      };
    });
    return {
      key: statusCode,
      statusCode,
      description: response.description ?? '',
      schema: responseSchema(response),
      mediaType: responseMediaType(response),
      headers,
    };
  });
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

  const requestExample = requestBodyExample(op.requestBody, bodySchema, swaggerDoc);
  const respExamples = responseExamples(op.responses, swaggerDoc);
  const responseOverviewVisibility = resolveResponseOverviewVisibility(settings.enableResponseCode, responses.length);
  const authors = operationAuthors(op);

  return (
    <OperationModeLayout activeKey="doc">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 4,
        }}
      >
        <Title level={4} style={{ margin: 0 }}>
          {op.summary ?? operation.path}
        </Title>
        <Space>
          <Button size="small" icon={<CopyOutlined />} onClick={handleCopyMarkdown}>
            {t('apiDoc.copy.markdown')}
          </Button>
          <Button size="small" icon={<CopyOutlined />} onClick={handleCopyUrl}>
            {t('apiDoc.copy.url')}
          </Button>
        </Space>
      </div>

      {operation.source === 'webhook' && (
        <Alert type="info" showIcon message={t('apiDoc.webhook.readOnly')} style={{ marginBottom: 8 }} />
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 8,
        }}
      >
        <Tag color={METHOD_COLOR[method] ?? 'default'} style={{ fontSize: 14, padding: '2px 10px' }}>
          {method}
        </Tag>
        {operation.source === 'webhook' && <Tag color="purple">WEBHOOK</Tag>}
        <Text code style={{ fontSize: 15, wordBreak: 'break-all' }}>
          {operation.path}
        </Text>
        {op.deprecated && <Tag color="red">{t('apiDoc.deprecated')}</Tag>}
        {authors.length > 0 && (
          <Space size={4} wrap style={{ minWidth: 0 }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t('apiDoc.author')}
            </Text>
            {authors.map((author, index) => (
              <Tag
                key={`${author}-${index}`}
                color="geekblue"
                style={{
                  marginInlineEnd: 0,
                  maxWidth: 280,
                  overflowWrap: 'anywhere',
                  whiteSpace: 'normal',
                }}
                title={author}
              >
                {author}
              </Tag>
            ))}
          </Space>
        )}
      </div>
      {op.description && <Markdown source={op.description} preserveLineBreaks />}

      {relatedModelNames.length > 0 && (
        <Space size={6} wrap style={{ marginTop: 4, marginBottom: 8 }}>
          <Text type="secondary">{t('apiDoc.relatedModels')}</Text>
          {relatedModelNames.map((name) => (
            <SchemaTypeLink
              key={name}
              node={{
                name: '',
                type: 'object',
                required: false,
                refName: name,
              }}
            />
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
      {op.requestBody?.description && (
        <div style={{ marginBottom: 8 }}>
          <Markdown source={op.requestBody.description} preserveLineBreaks />
        </div>
      )}
      {bodySchema || requestExample !== null ? (
        <Tabs
          size="small"
          items={[
            {
              key: 'schema',
              label: t('apiDoc.tab.schema'),
              children: <SchemaFieldTable fields={bodyFields} emptyText={t('apiDoc.body.notExpandable')} />,
            },
            ...(requestExample !== null
              ? [
                  {
                    key: 'example',
                    label: t('apiDoc.tab.requestExample'),
                    children: (
                      <CodeBlock
                        code={requestExample}
                        onCopy={() =>
                          copyToClipboard(
                            requestExample,
                            () => message.success(t('apiDoc.example.copied')),
                            () => message.error(t('apiDoc.copy.failed')),
                          )
                        }
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      ) : (
        <SchemaFieldTable fields={[]} emptyText={t('apiDoc.noBody')} />
      )}

      <Title level={5} style={{ marginTop: 24 }}>
        {t('apiDoc.responseStructure')}
      </Title>
      <Tabs
        size="small"
        items={[
          {
            key: 'schema',
            label: t('apiDoc.tab.schema'),
            children: (
              <div>
                {responses.length === 0 ? (
                  <SchemaFieldTable fields={[]} emptyText={t('apiDoc.noResponse')} />
                ) : (
                  responses.map((row) => {
                    const color = row.statusCode.startsWith('2')
                      ? 'success'
                      : row.statusCode.startsWith('4')
                        ? 'warning'
                        : 'error';
                    const fields = row.schema
                      ? filterFieldNodes(schemaToFieldNodes(row.schema, swaggerDoc), 'response')
                      : [];
                    return (
                      <div key={row.key} style={{ marginBottom: 16 }}>
                        {(responseOverviewVisibility.showStatusCode || responseOverviewVisibility.showDetails) && (
                          <Space size={8} wrap style={{ marginBottom: 6 }}>
                            {responseOverviewVisibility.showStatusCode && <Tag color={color}>{row.statusCode}</Tag>}
                            {responseOverviewVisibility.showDetails && (
                              <>
                                {row.description && (
                                  <DescriptionText type="secondary" style={{ fontSize: 13 }}>
                                    {row.description}
                                  </DescriptionText>
                                )}
                                {row.schema && <SchemaTypeLink node={schemaToTypeNode(row.schema)} />}
                                {row.mediaType && <Tag>{row.mediaType}</Tag>}
                              </>
                            )}
                          </Space>
                        )}
                        <SchemaFieldTable fields={fields} emptyText={t('apiDoc.response.notExpandable')} />
                        {row.headers.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <Text strong>{t('apiDebug.response.headers')}</Text>
                            <Table
                              columns={responseHeaderColumns}
                              dataSource={row.headers}
                              pagination={false}
                              size="small"
                              bordered
                              style={{ marginTop: 6 }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ),
          },
          ...respExamples.map(({ statusCode, example }) => ({
            key: `resp-${statusCode}`,
            label: `${t('apiDoc.tab.responseExample')} ${statusCode}`,
            children: (
              <CodeBlock
                code={example}
                onCopy={() =>
                  copyToClipboard(
                    example,
                    () => message.success(t('apiDoc.example.copied')),
                    () => message.error(t('apiDoc.copy.failed')),
                  )
                }
              />
            ),
          })),
        ]}
      />
    </OperationModeLayout>
  );
}
