import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Divider, Input, Select, Space, Spin, Table, Tabs, Tag, Typography,
} from 'antd';
import { SendOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { ParameterObject, SchemaObject } from '../../types/swagger';
import { OperationModeTabs, useCurrentOperation } from './useCurrentOperation';

const { TextArea } = Input;
const { Text, Title } = Typography;

interface ParamRow {
  key: string;
  name: string;
  value: string;
  description?: string;
  required?: boolean;
}

interface DebugResponse {
  status: number;
  statusText: string;
  duration: number;
  headers: Record<string, string>;
  body: string;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'green', POST: 'blue', PUT: 'orange', DELETE: 'red', PATCH: 'purple', HEAD: 'cyan', OPTIONS: 'default',
};

function currentOrigin() {
  return typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;
}

function schemaExample(schema?: SchemaObject): unknown {
  if (!schema) return undefined;
  if (schema.$ref) return {};
  if (schema.type === 'array') return [schemaExample(schema.items) ?? {}];
  if (schema.type === 'integer' || schema.type === 'number') return 0;
  if (schema.type === 'boolean') return true;
  if (schema.type === 'string') return schema.enum?.[0] ?? '';
  if (schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties).map(([name, prop]) => [name, schemaExample(prop)]));
  }
  return {};
}

function requestBodyExample(schema?: SchemaObject) {
  if (!schema) return '';
  return JSON.stringify(schemaExample(schema), null, 2);
}

function firstRequestSchema(content?: Record<string, { schema?: SchemaObject }>): SchemaObject | undefined {
  if (!content) return undefined;
  return content['application/json']?.schema ?? Object.values(content)[0]?.schema;
}

function parameterRows(parameters: ParameterObject[] | undefined, location: ParameterObject['in']): ParamRow[] {
  return (parameters ?? [])
    .filter((parameter) => parameter.in === location)
    .map((parameter) => ({
      key: `${parameter.in}-${parameter.name}`,
      name: parameter.name,
      value: '',
      description: parameter.description,
      required: Boolean(parameter.required),
    }));
}

function replacePathParams(path: string, params: ParamRow[]) {
  return params.reduce((url, param) => {
    if (!param.name) return url;
    return url.replace(`{${param.name}}`, encodeURIComponent(param.value));
  }, path);
}

const statusColor = (status: number) => status < 300 ? 'green' : status < 400 ? 'orange' : 'red';

export default function ApiDebug() {
  const { loading: docLoading, swaggerDoc, operation } = useCurrentOperation();
  const [baseUrl, setBaseUrl] = useState(currentOrigin());
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
  const [pathParams, setPathParams] = useState<ParamRow[]>([]);
  const [queryParams, setQueryParams] = useState<ParamRow[]>([]);
  const [headerParams, setHeaderParams] = useState<ParamRow[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<DebugResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operation) return;
    const op = operation.operation;
    const requestSchema = firstRequestSchema(op.requestBody?.content);
    const hasJsonBody = Boolean(requestSchema);
    setMethod(operation.method.toUpperCase());
    setPath(operation.path);
    setPathParams(parameterRows(op.parameters, 'path'));
    setQueryParams(parameterRows(op.parameters, 'query'));
    setHeaderParams([
      ...parameterRows(op.parameters, 'header'),
      ...(hasJsonBody ? [{ key: 'content-type', name: 'Content-Type', value: 'application/json', description: '请求体类型', required: true }] : []),
    ]);
    setBody(requestBodyExample(requestSchema));
    setResponse(null);
    setError(null);
  }, [operation]);

  const paramColumns = useMemo<ColumnsType<ParamRow>>(() => [
    { title: '参数名', dataIndex: 'name', key: 'name', width: 180, render: (value) => <Text code>{value}</Text> },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      render: (_value: string, record: ParamRow, index: number) => (
        <Input
          size="small"
          value={record.value}
          onChange={(event) => {
            const nextValue = event.target.value;
            const update = (rows: ParamRow[]) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, value: nextValue } : row);
            if (record.key.startsWith('path-')) setPathParams(update);
            else if (record.key.startsWith('query-')) setQueryParams(update);
            else setHeaderParams(update);
          }}
          placeholder={record.required ? '必填' : record.description}
        />
      ),
    },
    { title: '说明', dataIndex: 'description', key: 'description', width: 240 },
    { title: '必填', dataIndex: 'required', key: 'required', width: 70, render: (value) => value ? <Tag color="red">是</Tag> : <Tag>否</Tag> },
  ], []);

  if (docLoading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  if (!swaggerDoc || !operation) {
    return <Alert type="warning" showIcon message="未找到调试接口" description="当前路由没有匹配到 OpenAPI operation，请重新从左侧接口列表打开。" />;
  }

  const buildUrl = () => {
    const urlPath = replacePathParams(path, pathParams);
    const queryString = queryParams
      .filter((param) => param.name && param.value)
      .map((param) => `${encodeURIComponent(param.name)}=${encodeURIComponent(param.value)}`)
      .join('&');
    return `${baseUrl}${urlPath}${queryString ? `?${queryString}` : ''}`;
  };

  const handleSend = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    const start = Date.now();
    try {
      const headers: Record<string, string> = {};
      headerParams.filter((param) => param.name && param.value).forEach((param) => { headers[param.name] = param.value; });
      const init: RequestInit = { method, headers };
      if (!['GET', 'HEAD'].includes(method) && body.trim()) {
        init.body = body;
      }
      const res = await fetch(buildUrl(), init);
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => { responseHeaders[key] = value; });
      const text = await res.text();
      setResponse({ status: res.status, statusText: res.statusText, duration: Date.now() - start, headers: responseHeaders, body: text });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const prettyBody = () => {
    if (!response) return '';
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  };

  return (
    <div id="knife4j-api-debug-page" style={{ padding: '24px', maxWidth: 1080 }}>
      <OperationModeTabs activeKey="debug" />

      <Space align="center" style={{ marginBottom: 12 }}>
        <Tag color={METHOD_COLORS[method] ?? 'default'} style={{ fontSize: 14, padding: '2px 8px' }}>
          {method}
        </Tag>
        <Title level={5} style={{ margin: 0 }}>{operation.operation.summary ?? operation.path}</Title>
      </Space>

      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
        <Select
          value={method}
          onChange={setMethod}
          style={{ width: 110 }}
          options={['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].map((item) => ({ value: item, label: item }))}
        />
        <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} style={{ width: 240 }} />
        <Input value={path} onChange={(event) => setPath(event.target.value)} style={{ flex: 1 }} />
        <Button type="primary" icon={<SendOutlined />} onClick={handleSend} loading={loading}>发送</Button>
      </Space.Compact>

      <Tabs
        defaultActiveKey="path"
        size="small"
        items={[
          {
            key: 'path',
            label: `Path (${pathParams.length})`,
            children: <Table size="small" dataSource={pathParams} columns={paramColumns} pagination={false} rowKey="key" />,
          },
          {
            key: 'query',
            label: `Query (${queryParams.length})`,
            children: <Table size="small" dataSource={queryParams} columns={paramColumns} pagination={false} rowKey="key" />,
          },
          {
            key: 'header',
            label: `Header (${headerParams.length})`,
            children: <Table size="small" dataSource={headerParams} columns={paramColumns} pagination={false} rowKey="key" />,
          },
          {
            key: 'body',
            label: 'Body',
            children: (
              <TextArea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={8}
                style={{ fontFamily: 'monospace', fontSize: 13 }}
                placeholder="JSON request body"
              />
            ),
          },
        ]}
      />

      <Divider style={{ margin: '16px 0' }} />

      {loading && <Spin tip="请求中..." style={{ display: 'block', margin: '24px auto' }} />}
      {error && <Alert type="error" message="请求失败" description={error} showIcon />}
      {response && (
        <div>
          <Space style={{ marginBottom: 8 }}>
            <Text strong>响应状态：</Text>
            <Tag color={statusColor(response.status)}>{response.status} {response.statusText}</Tag>
            <Text type="secondary">耗时：{response.duration} ms</Text>
          </Space>
          <Tabs
            size="small"
            items={[
              {
                key: 'body',
                label: '响应体',
                children: (
                  <pre style={{ background: '#f6f8fa', padding: 12, borderRadius: 4, fontSize: 13, maxHeight: 400, overflow: 'auto', margin: 0 }}>
                    {prettyBody()}
                  </pre>
                ),
              },
              {
                key: 'headers',
                label: '响应 Headers',
                children: (
                  <Table
                    size="small"
                    dataSource={Object.entries(response.headers).map(([key, value]) => ({ key, name: key, value }))}
                    columns={[
                      { title: 'Header', dataIndex: 'name', key: 'name', width: 240 },
                      { title: '值', dataIndex: 'value', key: 'value' },
                    ]}
                    pagination={false}
                  />
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
