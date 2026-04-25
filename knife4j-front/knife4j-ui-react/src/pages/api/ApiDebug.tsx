import { useState } from 'react';
import {
  Button, Input, Select, Tabs, Table, Typography, Space,
  Tag, Spin, Alert, Divider
} from 'antd';
import { SendOutlined } from '@ant-design/icons';

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

// Mock operation metadata — in production this would come from GroupContext / knife4j-core
const MOCK_OPERATION = {
  method: 'POST',
  path: '/api/user/login',
  summary: '用户登录',
  queryParams: [] as ParamRow[],
  headerParams: [
    { key: '1', name: 'Content-Type', value: 'application/json', description: '请求类型', required: true },
  ] as ParamRow[],
  bodyExample: JSON.stringify({ username: 'admin', password: '123456' }, null, 2),
};

const METHOD_COLORS: Record<string, string> = {
  GET: 'green', POST: 'blue', PUT: 'orange', DELETE: 'red',
  PATCH: 'purple', HEAD: 'cyan', OPTIONS: 'default',
};

const paramColumns = [
  { title: '参数名', dataIndex: 'name', key: 'name', width: 160 },
  {
    title: '值',
    dataIndex: 'value',
    key: 'value',
    render: (_: string, record: ParamRow) => (
      <Input
        size="small"
        defaultValue={record.value}
        onChange={(e) => { record.value = e.target.value; }}
        placeholder={record.description}
      />
    ),
  },
  { title: '说明', dataIndex: 'description', key: 'description', width: 200 },
  {
    title: '必填',
    dataIndex: 'required',
    key: 'required',
    width: 60,
    render: (v: boolean) => v ? <Tag color="red">是</Tag> : <Tag>否</Tag>,
  },
];

export default function ApiDebug() {
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080');
  const [method, setMethod] = useState(MOCK_OPERATION.method);
  const [path, setPath] = useState(MOCK_OPERATION.path);
  const [queryParams, setQueryParams] = useState<ParamRow[]>(MOCK_OPERATION.queryParams);
  const [headerParams, setHeaderParams] = useState<ParamRow[]>(MOCK_OPERATION.headerParams);
  const [body, setBody] = useState(MOCK_OPERATION.bodyExample);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<DebugResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildUrl = () => {
    const qs = queryParams
      .filter(p => p.name && p.value)
      .map(p => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
      .join('&');
    return `${baseUrl}${path}${qs ? '?' + qs : ''}`;
  };

  const handleSend = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    const start = Date.now();
    try {
      const headers: Record<string, string> = {};
      headerParams.filter(p => p.name).forEach(p => { headers[p.name] = p.value; });

      const init: RequestInit = { method, headers };
      if (!['GET', 'HEAD'].includes(method) && body.trim()) {
        init.body = body;
      }

      const res = await fetch(buildUrl(), init);
      const duration = Date.now() - start;
      const resHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => { resHeaders[k] = v; });
      const text = await res.text();
      setResponse({ status: res.status, statusText: res.statusText, duration, headers: resHeaders, body: text });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const addQueryParam = () =>
    setQueryParams(prev => [...prev, { key: String(Date.now()), name: '', value: '', description: '' }]);

  const addHeaderParam = () =>
    setHeaderParams(prev => [...prev, { key: String(Date.now()), name: '', value: '', description: '' }]);

  const prettyBody = () => {
    if (!response) return '';
    try { return JSON.stringify(JSON.parse(response.body), null, 2); } catch { return response.body; }
  };

  const statusColor = (s: number) => s < 300 ? 'success' : s < 400 ? 'warning' : 'error';

  return (
    <div id="knife4j-api-debug-page" style={{ padding: '16px 24px' }}>
      <Space align="center" style={{ marginBottom: 12 }}>
        <Tag color={METHOD_COLORS[method] ?? 'default'} style={{ fontSize: 14, padding: '2px 8px' }}>
          {method}
        </Tag>
        <Title level={5} style={{ margin: 0 }}>{MOCK_OPERATION.summary}</Title>
      </Space>

      {/* URL bar */}
      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
        <Select
          value={method}
          onChange={setMethod}
          style={{ width: 110 }}
          options={['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => ({ value: m, label: m }))}
        />
        <Input
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          style={{ width: 220 }}
          placeholder="http://localhost:8080"
        />
        <Input
          value={path}
          onChange={e => setPath(e.target.value)}
          style={{ flex: 1 }}
          placeholder="/api/path"
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={loading}
        >
          发送
        </Button>
      </Space.Compact>

      {/* Params tabs */}
      <Tabs
        defaultActiveKey="query"
        size="small"
        items={[
          {
            key: 'query',
            label: `Query (${queryParams.length})`,
            children: (
              <>
                <Table
                  size="small"
                  dataSource={queryParams}
                  columns={paramColumns}
                  pagination={false}
                  rowKey="key"
                />
                <Button size="small" style={{ marginTop: 8 }} onClick={addQueryParam}>+ 添加参数</Button>
              </>
            ),
          },
          {
            key: 'header',
            label: `Header (${headerParams.length})`,
            children: (
              <>
                <Table
                  size="small"
                  dataSource={headerParams}
                  columns={paramColumns}
                  pagination={false}
                  rowKey="key"
                />
                <Button size="small" style={{ marginTop: 8 }} onClick={addHeaderParam}>+ 添加 Header</Button>
              </>
            ),
          },
          {
            key: 'body',
            label: 'Body',
            children: (
              <TextArea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={8}
                style={{ fontFamily: 'monospace', fontSize: 13 }}
                placeholder="JSON request body"
              />
            ),
          },
        ]}
      />

      <Divider style={{ margin: '16px 0' }} />

      {/* Response */}
      {loading && <Spin tip="请求中..." style={{ display: 'block', margin: '24px auto' }} />}
      {error && <Alert type="error" message="请求失败" description={error} showIcon />}
      {response && (
        <div>
          <Space style={{ marginBottom: 8 }}>
            <Text strong>响应状态：</Text>
            <Tag color={statusColor(response.status) === 'success' ? 'green' : statusColor(response.status) === 'warning' ? 'orange' : 'red'}>
              {response.status} {response.statusText}
            </Tag>
            <Text type="secondary">耗时：{response.duration} ms</Text>
          </Space>
          <Tabs
            size="small"
            items={[
              {
                key: 'body',
                label: '响应体',
                children: (
                  <pre style={{
                    background: '#f6f8fa', padding: 12, borderRadius: 4,
                    fontSize: 13, maxHeight: 400, overflow: 'auto', margin: 0,
                  }}>
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
                    dataSource={Object.entries(response.headers).map(([k, v]) => ({ key: k, name: k, value: v }))}
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
