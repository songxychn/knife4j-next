import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Divider, Input, InputNumber, Select, Space, Spin, Switch, Table, Tabs, Tag, Tooltip, Typography,
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

// ─── Helper: form value shape ─────────────────────────
// Key by `${in}:${name}` to avoid cross-location name collisions
type ParamValueMap = Record<string, string>;

function paramKey(param: DebugParam): string {
  return `${param.in}:${param.name}`;
}

function currentOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;
}

const statusColor = (status: number) => (status < 300 ? 'green' : status < 400 ? 'orange' : 'red');

// ─── Initial value derivation ─────────────────────────

/**
 * 按优先级取参数的初始值：example > default > 类型空值
 * 返回始终是字符串（<Input> / JSON 字符串 / enum 选中值）。
 */
function initialValueFor(param: DebugParam): string {
  if (param.example !== undefined && param.example !== null) {
    return stringify(param.example, param.type);
  }
  if (param.default !== undefined && param.default !== null) {
    return stringify(param.default, param.type);
  }
  // 按类型生成空值
  switch (param.type) {
    case 'array':
    case 'object':
      return ''; // TextArea 占位；空字符串让 requestBuilder 走默认分支
    case 'boolean':
      return '';
    case 'integer':
    case 'number':
      return '';
    default:
      return '';
  }
}

function stringify(value: unknown, type: string): string {
  if (value === undefined || value === null) return '';
  if (type === 'array' || type === 'object') {
    try {
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// ─── Param input dispatcher ───────────────────────────

interface ParamInputProps {
  param: DebugParam;
  value: string;
  onChange: (next: string) => void;
}

function ParamInput({ param, value, onChange }: ParamInputProps) {
  // enum → Select
  if (param.enum && param.enum.length > 0) {
    return (
      <Select
        size="small"
        value={value || undefined}
        onChange={onChange}
        allowClear
        placeholder={param.description ?? '选择一个枚举值'}
        options={param.enum.map((item) => ({ value: String(item), label: String(item) }))}
        style={{ width: '100%' }}
      />
    );
  }

  // boolean → Switch（配合隐藏的字符串值 'true'/'false'）
  if (param.type === 'boolean') {
    const checked = value === 'true';
    return (
      <Space size="small">
        <Switch
          size="small"
          checked={checked}
          onChange={(next) => onChange(next ? 'true' : 'false')}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>{checked ? 'true' : 'false'}</Text>
      </Space>
    );
  }

  // integer / number → InputNumber
  if (param.type === 'integer' || param.type === 'number') {
    const numValue = value === '' ? undefined : Number(value);
    return (
      <InputNumber
        size="small"
        value={Number.isFinite(numValue) ? numValue : undefined}
        onChange={(next) => onChange(next === null || next === undefined ? '' : String(next))}
        placeholder={param.required ? '必填' : param.description}
        style={{ width: '100%' }}
        step={param.type === 'integer' ? 1 : undefined}
      />
    );
  }

  // array / object → TextArea（JSON 兜底）
  if (param.type === 'array' || param.type === 'object') {
    return (
      <TextArea
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`${param.type === 'array' ? '数组' : '对象'} — 请输入 JSON`}
        autoSize={{ minRows: 2, maxRows: 6 }}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
      />
    );
  }

  // string / file / 其他 → Input
  return (
    <Input
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={param.required ? '必填' : (param.description ?? '')}
      readOnly={param.readOnly}
    />
  );
}

// ─── Name cell（附带 deprecated/readOnly 标记）────────

function ParamNameCell({ param }: { param: DebugParam }) {
  const deprecated = param.deprecated;
  const readOnly = param.readOnly;
  return (
    <Space size={4} wrap>
      <Text
        code
        style={{
          textDecoration: deprecated ? 'line-through' : undefined,
          color: deprecated ? '#8c8c8c' : undefined,
        }}
      >
        {param.name}
      </Text>
      {param.required && <Tag color="red" style={{ marginInlineEnd: 0 }}>必填</Tag>}
      {deprecated && (
        <Tooltip title="该参数已废弃，但仍可填写">
          <Tag color="default" style={{ marginInlineEnd: 0 }}>已废弃</Tag>
        </Tooltip>
      )}
      {readOnly && (
        <Tooltip title="readOnly 参数通常不需要客户端传入">
          <Tag color="warning" style={{ marginInlineEnd: 0 }}>只读</Tag>
        </Tooltip>
      )}
    </Space>
  );
}

// ─── 主组件 ────────────────────────────────────────────

export default function ApiDebug() {
  const { loading: docLoading, swaggerDoc, operation } = useCurrentOperation();
  const [baseUrl, setBaseUrl] = useState(currentOrigin());
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
  const [paramValues, setParamValues] = useState<ParamValueMap>({});
  const [body, setBody] = useState('');
  const [debugModel, setDebugModel] = useState<OperationDebugModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<DebugResponse | null>(null);
  const [curlCommand, setCurlCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operation || !swaggerDoc) return;

    const model = buildOperationDebugModel({
      doc: swaggerDoc as unknown as Record<string, unknown>,
      path: operation.path,
      method: operation.method,
      isOAS2: Boolean((swaggerDoc as unknown as Record<string, unknown>).swagger),
    });
    setDebugModel(model);

    setMethod(operation.method.toUpperCase());
    setPath(operation.path);

    // 初始化参数值
    const initial: ParamValueMap = {};
    const allParams = [...model.pathParams, ...model.queryParams, ...model.headerParams, ...model.cookieParams];
    for (const p of allParams) {
      initial[paramKey(p)] = initialValueFor(p);
    }
    setParamValues(initial);

    // body 初始值：取第一个 bodyContent 的示例
    const firstBody = model.bodyContents[0];
    setBody(firstBody?.exampleValue ?? '');
    setResponse(null);
    setError(null);
    setCurlCommand(null);
  }, [operation, swaggerDoc]);

  const updateValue = (param: DebugParam, next: string) => {
    setParamValues((prev) => ({ ...prev, [paramKey(param)]: next }));
  };

  const paramColumns = useMemo<ColumnsType<DebugParam>>(() => [
    {
      title: '参数名',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      render: (_value: string, record: DebugParam) => <ParamNameCell param={record} />,
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 110,
      render: (_value: string, record: DebugParam) => (
        <Space size={2} direction="vertical" style={{ lineHeight: 1.3 }}>
          <Text code style={{ fontSize: 12 }}>{record.type}</Text>
          {record.format && <Text type="secondary" style={{ fontSize: 11 }}>{record.format}</Text>}
        </Space>
      ),
    },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      render: (_value: string, record: DebugParam) => (
        <ParamInput
          param={record}
          value={paramValues[paramKey(record)] ?? ''}
          onChange={(next) => updateValue(record, next)}
        />
      ),
    },
    {
      title: '说明',
      key: 'description',
      width: 280,
      render: (_value, record: DebugParam) => (
        <Space size={2} direction="vertical" style={{ lineHeight: 1.35, fontSize: 12 }}>
          {record.description && <Text style={{ fontSize: 12 }}>{record.description}</Text>}
          {record.default !== undefined && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              默认：<Text code style={{ fontSize: 11 }}>{stringify(record.default, record.type)}</Text>
            </Text>
          )}
          {record.example !== undefined && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              示例：<Text code style={{ fontSize: 11 }}>{stringify(record.example, record.type)}</Text>
            </Text>
          )}
          {record.enum && record.enum.length > 0 && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              枚举：{record.enum.slice(0, 3).map((item) => String(item)).join(', ')}
              {record.enum.length > 3 ? '…' : ''}
            </Text>
          )}
        </Space>
      ),
    },
  ], [paramValues]);

  if (docLoading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  if (!swaggerDoc || !operation || !debugModel) {
    return <Alert type="warning" showIcon message="未找到调试接口" description="当前路由没有匹配到 OpenAPI operation，请重新从左侧接口列表打开。" />;
  }

  /** 按 in 过滤已填值 */
  const collectForIn = (params: DebugParam[]): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const p of params) {
      const v = paramValues[paramKey(p)];
      if (v !== undefined && v !== '') result[p.name] = v;
    }
    return result;
  };

  const collectFormValues = (): DebugFormValues => ({
    pathParams: collectForIn(debugModel.pathParams),
    queryParams: collectForIn(debugModel.queryParams),
    headerParams: collectForIn(debugModel.headerParams),
    cookieParams: collectForIn(debugModel.cookieParams),
    body,
  });

  const handleSend = async () => {
    if (!debugModel) return;
    setError(null);

    const formValues = collectFormValues();

    // required 校验
    const validationErrors = validateRequired(debugModel, formValues);
    if (validationErrors.length > 0) {
      setError(validationErrors.map((e) => e.message).join('\n'));
      return;
    }

    // 构建请求
    const built: BuiltRequest = coreBuildRequest({
      baseUrl,
      path,
      method,
      debugModel,
      formValues,
    });
    setCurlCommand(buildCurl(built));

    setLoading(true);
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

  const tabItems = [
    {
      key: 'path',
      label: `Path (${debugModel.pathParams.length})`,
      disabled: debugModel.pathParams.length === 0,
      children: (
        <Table size="small" dataSource={debugModel.pathParams} columns={paramColumns} pagination={false} rowKey={paramKey} />
      ),
    },
    {
      key: 'query',
      label: `Query (${debugModel.queryParams.length})`,
      disabled: debugModel.queryParams.length === 0,
      children: (
        <Table size="small" dataSource={debugModel.queryParams} columns={paramColumns} pagination={false} rowKey={paramKey} />
      ),
    },
    {
      key: 'header',
      label: `Header (${debugModel.headerParams.length})`,
      disabled: debugModel.headerParams.length === 0 && debugModel.bodyContents.length === 0,
      children: (
        <Table
          size="small"
          dataSource={debugModel.headerParams}
          columns={paramColumns}
          pagination={false}
          rowKey={paramKey}
          locale={{
            emptyText: debugModel.bodyContents.length > 0
              ? 'Content-Type 由所选 Body 类型自动注入（在发送时可见于 cURL）'
              : '无 header 参数',
          }}
        />
      ),
    },
    {
      key: 'cookie',
      label: `Cookie (${debugModel.cookieParams.length})`,
      disabled: debugModel.cookieParams.length === 0,
      children: (
        <Table size="small" dataSource={debugModel.cookieParams} columns={paramColumns} pagination={false} rowKey={paramKey} />
      ),
    },
    {
      key: 'body',
      label: `Body${debugModel.bodyContents.length > 0 ? ` (${debugModel.bodyContents[0].mediaType})` : ''}`,
      disabled: debugModel.bodyContents.length === 0,
      children: (
        <TextArea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={10}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
          placeholder={
            debugModel.bodyContents.length > 0
              ? `${debugModel.bodyContents[0].mediaType} request body`
              : '该接口无请求体'
          }
          disabled={debugModel.bodyContents.length === 0}
        />
      ),
    },
  ];

  // 找到第一个非空 Tab 作为默认
  const defaultTab = tabItems.find((t) => !t.disabled)?.key ?? 'query';

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

      <Tabs defaultActiveKey={defaultTab} size="small" items={tabItems} />

      <Divider style={{ margin: '16px 0' }} />

      {loading && <Spin tip="请求中..." style={{ display: 'block', margin: '24px auto' }} />}
      {error && <Alert type="error" message="请求失败" description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{error}</pre>} showIcon />}
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
