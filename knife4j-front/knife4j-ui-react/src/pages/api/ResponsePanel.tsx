import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { CopyOutlined, DownloadOutlined, StopOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { copyToClipboard } from '../../utils/clipboard';
import { buildSchemaDescriptionMap, annotateJsonWithDescriptions } from '../../utils/schemaDescription';
import type { BuiltRequest } from 'knife4j-core';
import { buildCurl } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import CodeBlock from './CodeBlock';

const { Text } = Typography;

/**
 * A single SSE event received from a text/event-stream response.
 */
export interface SseEvent {
  data: string;
  timestamp: number;
}

/**
 * Shape of a completed debug response (success or failure w/ payload).
 * The body payload is exposed in multiple forms so every sub-tab can
 * choose the cheapest representation without re-reading the network
 * stream.
 */
export interface DebugResponsePayload {
  status: number;
  statusText: string;
  method: string;
  duration: number;
  /** raw Content-Type header, e.g. `application/json; charset=utf-8` */
  contentType: string;
  /** response size in bytes, from `blob.size` */
  size: number;
  /** response headers as a plain map */
  headers: Record<string, string>;
  /** best-effort decoded text; empty string for pure binary payloads */
  rawText: string;
  /** object URL for binary (image / download) payloads; caller owns cleanup */
  objectUrl?: string;
  /** suggested filename when offering a download link */
  filename?: string;
  /** parsed from Content-Type: 'json' | 'image' | 'text' | 'binary' */
  kind: 'json' | 'image' | 'text' | 'binary';
}

interface ResponsePanelProps {
  /** completed response payload; `null` means no response yet */
  response: DebugResponsePayload | null;
  /** network / validation error to surface above the tabs */
  error: string | null;
  /** built request for generating cURL command */
  builtRequest: BuiltRequest | null;
  /** current operation (for extracting response schema descriptions) */
  operation?: MenuOperation;
  /** full swagger doc (for $ref resolution) */
  swaggerDoc?: SwaggerDoc | null;
  /** SSE events received so far; non-null means SSE mode */
  sseEvents?: SseEvent[] | null;
  /** callback to abort the SSE stream */
  onSseAbort?: () => void;
  /** true while SSE stream is still open */
  sseStreaming?: boolean;
}

const statusColor = (status: number) => (status < 300 ? 'green' : status < 400 ? 'orange' : 'red');

const METHOD_COLORS: Record<string, string> = {
  GET: 'green',
  POST: 'blue',
  PUT: 'orange',
  DELETE: 'red',
  PATCH: 'purple',
  HEAD: 'cyan',
  OPTIONS: 'default',
};

/** Human-readable byte size, matching Vue2 DebugResponse.vue logic. */
function formatSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const kb = size / 1024;
  const mb = kb / 1024;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  if (kb >= 1) return `${kb.toFixed(2)} KB`;
  return `${size} B`;
}

/** Try to pretty-print JSON; fall back to raw text on parse failure. */
function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Extract the schema of the first 2xx response from the operation. */
function firstSuccessResponseSchema(
  operation?: MenuOperation,
): { schema: import('../../types/swagger').SchemaObject; mediaType: string } | null {
  if (!operation?.operation?.responses) return null;
  const responses = operation.operation.responses;

  // Try 2xx codes first (200, 201, 204, etc.)
  const statusCodes = Object.keys(responses).sort();
  const successCode = statusCodes.find((c) => c.startsWith('2')) ?? statusCodes[0];
  if (!successCode) return null;

  const resp = responses[successCode];
  if (!resp) return null;

  // OAS3: content → mediaType → schema
  if (resp.content) {
    const mediaType = Object.keys(resp.content).find((mt) => mt.includes('json')) ?? Object.keys(resp.content)[0];
    const schema = resp.content[mediaType]?.schema;
    if (schema) return { schema, mediaType };
  }

  // OAS2: schema directly on response
  if (resp.schema) return { schema: resp.schema, mediaType: 'application/json' };

  return null;
}

const preStyle: React.CSSProperties = {
  background: '#f6f8fa',
  padding: 12,
  borderRadius: 4,
  fontSize: 13,
  maxHeight: 400,
  overflow: 'auto',
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};

const annotatedJsonPreStyle: React.CSSProperties = {
  ...preStyle,
  whiteSpace: 'pre',
  wordBreak: 'normal',
  lineHeight: 1.55,
};

const jsonLineStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 56ch) minmax(180px, 320px)',
  alignItems: 'stretch',
  minWidth: 'calc(56ch + 260px)',
};

/** Monospace, normal color — matches the surrounding <pre>. */
const jsonCodeStyle: React.CSSProperties = {
  fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace",
  color: '#24292e',
  whiteSpace: 'pre',
  paddingRight: 14,
  minWidth: 0,
};

/**
 * Schema description annotation — rendered in a fixed column to the right of
 * a separator, similar to the Vue/Ace print-margin placement.
 */
const jsonDescStyle: React.CSSProperties = {
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', Helvetica, Arial, sans-serif",
  fontSize: 12,
  color: '#8c8c8c',
  userSelect: 'none',
  borderLeft: '1px solid #d9d9d9',
  paddingLeft: 12,
  minHeight: '1.55em',
  lineHeight: 1.55,
  whiteSpace: 'normal',
};

export default function ResponsePanel({
  response,
  error,
  builtRequest,
  operation,
  swaggerDoc,
  sseEvents,
  onSseAbort,
  sseStreaming,
}: ResponsePanelProps) {
  const { t } = useTranslation();
  const [activeKey, setActiveKey] = useState<string>('content');
  const [showDescription, setShowDescription] = useState(true);
  const sseLogRef = useRef<HTMLDivElement>(null);

  // When a new response arrives, reset focus back to the Content tab so
  // the user sees the decoded body first.
  useEffect(() => {
    if (response) setActiveKey('content');
  }, [response]);

  // Auto-scroll SSE log to bottom as new events arrive.
  useEffect(() => {
    if (sseEvents && sseLogRef.current) {
      sseLogRef.current.scrollTop = sseLogRef.current.scrollHeight;
    }
  }, [sseEvents]);

  const handleCopyRaw = () => {
    if (!response) return;
    copyToClipboard(
      response.rawText,
      () => message.success(t('apiDebug.response.copied')),
      () => message.error(t('apiDebug.response.copyFailed')),
    );
  };

  const handleCopyCurl = () => {
    if (!builtRequest) return;
    const curl = buildCurl(builtRequest);
    copyToClipboard(
      curl,
      () => message.success(t('apiDebug.response.copied')),
      () => message.error(t('apiDebug.response.copyFailed')),
    );
  };

  const handleDownload = () => {
    if (!response) return;
    let url: string;
    let needsRevoke = false;
    if (response.objectUrl) {
      // Binary/image: use the pre-created object URL directly to avoid re-encoding corruption
      url = response.objectUrl;
    } else {
      // Text payloads: create a temporary object URL from rawText
      const blob = new Blob([response.rawText], { type: response.contentType || 'text/plain' });
      url = URL.createObjectURL(blob);
      needsRevoke = true;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = response.filename || 'response.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (needsRevoke) URL.revokeObjectURL(url);
  };

  // Build schema description map from operation response schema
  const descMap = useMemo(() => {
    if (!operation || !swaggerDoc) return new Map<string, string>();
    const result = firstSuccessResponseSchema(operation);
    if (!result) return new Map<string, string>();
    return buildSchemaDescriptionMap(result.schema, swaggerDoc);
  }, [operation, swaggerDoc]);

  const hasDescriptions = descMap.size > 0;

  const headerRows = useMemo(
    () => (response ? Object.entries(response.headers).map(([k, v]) => ({ key: k, name: k, value: v })) : []),
    [response],
  );

  if (!response && !error && sseEvents == null) return null;

  return (
    <div>
      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('apiDebug.error.title')}
          description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{error}</pre>}
        />
      )}

      {sseEvents != null && (
        <div style={{ marginBottom: 16 }}>
          <Space style={{ marginBottom: 8 }}>
            <Tag color="blue">text/event-stream</Tag>
            <Tag color={sseStreaming ? 'processing' : 'default'}>
              {sseStreaming ? t('apiDebug.sse.streaming') : t('apiDebug.sse.done')}
            </Tag>
            <Tag>{t('apiDebug.sse.eventCount', { count: sseEvents.length })}</Tag>
            {sseStreaming && (
              <Button size="small" danger icon={<StopOutlined />} onClick={onSseAbort}>
                {t('apiDebug.sse.abort')}
              </Button>
            )}
          </Space>
          <div
            ref={sseLogRef}
            style={{
              background: '#0d1117',
              borderRadius: 4,
              padding: '8px 12px',
              maxHeight: 400,
              overflowY: 'auto',
              fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {sseEvents.length === 0 ? (
              <span style={{ color: '#8b949e' }}>{t('apiDebug.sse.waiting')}</span>
            ) : (
              sseEvents.map((ev, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, borderBottom: '1px solid #21262d', padding: '2px 0' }}>
                  <span style={{ color: '#8b949e', flexShrink: 0, userSelect: 'none' }}>
                    {new Date(ev.timestamp).toISOString().slice(11, 23)}
                  </span>
                  <span style={{ color: '#e6edf3', wordBreak: 'break-all' }}>{ev.data}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {response && (
        <>
          <Space wrap style={{ marginBottom: 8 }}>
            <Text strong>{t('apiDebug.response.status')}</Text>
            <Tag color={statusColor(response.status)}>
              {response.status} {response.statusText}
            </Tag>
            <Tag color={METHOD_COLORS[response.method] ?? 'default'}>{response.method}</Tag>
            <Text type="secondary">
              {t('apiDebug.response.duration')}
              {response.duration} ms
            </Text>
            <Text type="secondary">
              {t('apiDebug.response.size')}
              {formatSize(response.size)}
            </Text>
            <Button size="small" icon={<CopyOutlined />} onClick={handleCopyRaw}>
              {t('apiDebug.response.copyRaw')}
            </Button>
            <Button size="small" icon={<CopyOutlined />} onClick={handleCopyCurl} disabled={!builtRequest}>
              {t('apiDebug.response.copyCurl')}
            </Button>
            <Button size="small" icon={<DownloadOutlined />} onClick={handleDownload}>
              {t('apiDebug.response.download')}
            </Button>
          </Space>

          <Tabs
            size="small"
            activeKey={activeKey}
            onChange={setActiveKey}
            items={[
              {
                key: 'content',
                label: t('apiDebug.response.tab.content'),
                children: (
                  <ContentTab
                    response={response}
                    descMap={descMap}
                    showDescription={showDescription && hasDescriptions}
                    hasDescriptions={hasDescriptions}
                    onToggleDescription={() => setShowDescription((v) => !v)}
                  />
                ),
              },
              {
                key: 'raw',
                label: t('apiDebug.response.tab.raw'),
                children: <pre style={preStyle}>{response.rawText}</pre>,
              },
              {
                key: 'headers',
                label: t('apiDebug.response.tab.headers'),
                children: (
                  <Table
                    size="small"
                    dataSource={headerRows}
                    columns={[
                      { title: t('apiDebug.col.header'), dataIndex: 'name', key: 'name', width: 240 },
                      { title: t('apiDebug.col.headerValue'), dataIndex: 'value', key: 'value' },
                    ]}
                    pagination={false}
                  />
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}

/**
 * Content rendering dispatch based on the pre-classified `kind`:
 *  - `image`  → inline <img> preview using the object URL
 *  - `binary` → download link (browsers cannot display it inline)
 *  - `json`   → syntax-highlighted JSON via CodeBlock with optional schema description annotations
 *  - `text`   → plain text / html source in <pre>
 */
function ContentTab({
  response,
  descMap,
  showDescription,
  hasDescriptions,
  onToggleDescription,
}: {
  response: DebugResponsePayload;
  descMap: Map<string, string>;
  showDescription: boolean;
  hasDescriptions: boolean;
  onToggleDescription: () => void;
}) {
  const { t } = useTranslation();

  if (response.kind === 'image' && response.objectUrl) {
    return (
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {t('apiDebug.response.imagePreview')}
        </Text>
        <img
          src={response.objectUrl}
          alt="response"
          style={{ maxWidth: '100%', borderRadius: 4, border: '1px solid #e8e8e8' }}
        />
      </div>
    );
  }

  if (response.kind === 'binary' && response.objectUrl) {
    return (
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {response.contentType || 'application/octet-stream'}
        </Text>
        <Button type="primary">
          <a href={response.objectUrl} download={response.filename ?? 'download'}>
            {t('apiDebug.response.download')}
          </a>
        </Button>
      </div>
    );
  }

  if (response.kind === 'json') {
    const pretty = prettyJson(response.rawText);
    const lines = showDescription ? annotateJsonWithDescriptions(pretty, descMap) : null;

    // When description annotations are active, fall back to the annotated <pre> renderer
    // so inline comments can be styled differently from the JSON code.
    if (lines) {
      return (
        <div>
          {hasDescriptions && (
            <div style={{ marginBottom: 6 }}>
              <Checkbox checked={showDescription} onChange={onToggleDescription}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('apiDebug.response.showDescription')}
                </Text>
              </Checkbox>
            </div>
          )}
          <pre style={annotatedJsonPreStyle}>
            {lines.map((line, i) => (
              <span key={i} style={jsonLineStyle}>
                <span style={jsonCodeStyle}>{line.code}</span>
                <span style={jsonDescStyle}>{line.description ?? ''}</span>
                {i < lines.length - 1 ? '\n' : ''}
              </span>
            ))}
          </pre>
        </div>
      );
    }

    return (
      <div>
        {hasDescriptions && (
          <div style={{ marginBottom: 6 }}>
            <Checkbox checked={showDescription} onChange={onToggleDescription}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('apiDebug.response.showDescription')}
              </Text>
            </Checkbox>
          </div>
        )}
        <CodeBlock code={pretty} />
      </div>
    );
  }

  // text & unknown textual fallback
  return <pre style={preStyle}>{response.rawText}</pre>;
}

// TASK-120-8
