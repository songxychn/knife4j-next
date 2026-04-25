import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Divider, Input, Select, Space, Spin, Table, Tabs, Tag, Typography,
} from 'antd';
import { SendOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  buildOperationDebugModel,
  buildRequest as coreBuildRequest,
  buildCurl,
  validateRequired,
} from 'knife4j-core';
import type { DebugParam, OperationDebugModel, DebugFormValues, BuiltRequest } from 'knife4j-core';
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

/** 将 knife4j-core 的 DebugParam 转为 UI 的 ParamRow */
function debugParamToRow(param: DebugParam): ParamRow {
  return {
    key: `${param.in}-${param.name}`,
    name: param.name,
    value: '',
    description: param.description,
    required: param.required,
  };
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
  const [debugModel, setDebugModel] = useState<OperationDebugModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<DebugResponse | null>(null);
  const [curlCommand, setCurlCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operation || !swaggerDoc) return;

    // 使用 knife4j-core 解析调试模型
    const model = buildOperationDebugModel({
      doc: swaggerDoc as unknown as Record<string, unknown>,
      path: operation.path,
      method: operation.method,
      isOAS2: Boolean((swaggerDoc as unknown as Record<string, unknown>).swagger),
    });
    setDebugModel(model);

    setMethod(operation.method.toUpperCase());
    setPath(operation.path);
    setPathParams(model.pathParams.map(debugParamToRow));
    setQueryParams(model.queryParams.map(debugParamToRow));

    // header：来自模型 + 自动注入 Content-Type
    const hasJsonBody = model.bodyContents.some((b) => b.category === 'json');
    setHeaderParams([
      ...model.headerParams.map(debugParamToRow),
      ...(hasJsonBody ? [{ key: 'content-type', name: 'Content-Type', value: 'application/json', description: '请求体类型', required: true }] : []),
    ]);

    // body：取第一个 bodyContent 的示例
    const firstBody = model.bodyContents[0];
    setBody(firstBody?.exampleValue ?? '');
    setResponse(null);
    setError(null);
  }, [operation, swaggerDoc]);

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

  /** 收集当前表单值为 DebugFormValues */
  const collectFormValues = (): DebugFormValues => ({
    pathParams: Object.fromEntries(
      pathParams.filter((p) => p.name && p.value).map((p) => [p.name, p.value]),
    ),
    queryParams: Object.fromEntries(
      queryParams.filter((p) => p.name && p.value).map((p) => [p.name, p.value]),
    ),
    headerParams: Object.fromEntries(
      headerParams.filter((p) => p.name && p.value).map((p) => [p.name, p.value]),
    ),
    cookieParams: {},
    body,
  });

  const handleSend = async () => {
    if (!debugModel) return;

    // 校验必填参数
    const formValues = collectFormValues();
    const validationErrors = validateRequired(debugModel, formValues);
    if (validationErrors.length > 0) {
      setError(validationErrors.map((e) => e.message).join('\n'));
      return;
    }

    // 使用 knife4j-core 构建请求
    const built: BuiltRequest = coreBuildRequest({
      baseUrl,
      path,
      method,
      debugModel,
      formValues,
    });

    // 生成 curl 命令
    setCurlCommand(buildCurl(built));

    setLoading(true);
    setError(null);
    setResponse(null);
    const start = Date.now();
    try {
      const init: RequestInit = { method: built.method, headers: built.headers };
      if (built.body !== undefined && built.body !== '') {
        init.body = built.body;
      }
      const res = await fetch(built.url, init);
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
              ...(curlCommand ? [{
                key: 'curl',
                label: 'cURL',
                children: (
                  <pre style={{ background: '#f6f8fa', padding: 12, borderRadius: 4, fontSize: 13, maxHeight: 200, overflow: 'auto', margin: 0 }}>
                    {curlCommand}
                  </pre>
                ),
              }] : []),
            ]}
          />
        </div>
      )}
    </div>
  );
}
