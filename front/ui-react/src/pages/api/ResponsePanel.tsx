import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import Tabs from '../../components/AccessibleTabs';
import ResizableBox from '../../components/ResizableBox';
import {
  CopyOutlined,
  DownloadOutlined,
  DownOutlined,
  InfoCircleOutlined,
  StopOutlined,
  UpOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { copyToClipboard } from '../../utils/clipboard';
import { buildSchemaDescriptionMap } from '../../utils/schemaDescription';
import type { BuiltRequest } from 'knife4j-core';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import type { CookieParameterSource } from './cookieParameterSource';
import { DEBUG_PANEL_DEFAULT_MAX_HEIGHT, DEBUG_PANEL_MAX_HEIGHT, DEBUG_PANEL_MIN_HEIGHT } from './debugPanelLayout';
import { buildPreviewCurl } from './requestPreviewBuild';
import ResponseJsonViewer from './ResponseJsonViewer';
import { formatSseEventTime } from './sseEventTime';
import { formatByteSize } from './responseBodyProgress';
import {
  responseBodyInstanceLabel,
  type ResponseBodySchemaDiagnostic,
} from '../../schema/responseBodySchemaValidation';
import type { Oas32SequentialSchemaStatus, Oas32SequentialTermination } from '../../schema/oas32SequentialResponse';
import type { Oas32SequentialStreamView } from '../../schema/oas32SequentialView';

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
  /** Cookie source captured when this request was sent. */
  builtRequestCookieSource?: CookieParameterSource;
  /** current operation (for extracting response schema descriptions) */
  operation?: MenuOperation;
  /** full swagger doc (for $ref resolution) */
  swaggerDoc?: SwaggerDoc | null;
  /** SSE events received so far; non-null means SSE mode */
  sseEvents?: SseEvent[] | null;
  /** OAS 3.2 sequential media stream; non-null means sequential debug mode */
  sequentialStream?: Oas32SequentialStreamView | null;
  /** callback to abort the SSE stream */
  onSseAbort?: () => void;
  /** true while SSE stream is still open */
  sseStreaming?: boolean;
  /** non-blocking OAS 3.1 response body diagnostic for the current request */
  schemaDiagnostic?: ResponseBodySchemaDiagnostic | null;
  /** controlled custom height (px) for the response body viewer */
  bodyHeight?: number;
  /** callback invoked when the user drags or resets the response body height */
  onBodyHeightChange?: (height: number | undefined) => void;
}

function sequentialItemSchemaLabel(status: Oas32SequentialSchemaStatus): string {
  if (status.status === 'valid') return 'apiDebug.sequential.item.valid';
  if (status.status === 'invalid') return 'apiDebug.sequential.item.invalid';
  if (status.status === 'absent') return 'apiDebug.sequential.item.absent';
  return 'apiDebug.sequential.item.skipped';
}

function sequentialCompleteSchemaLabel(status: Oas32SequentialSchemaStatus): string {
  if (status.status === 'valid') return 'apiDebug.sequential.complete.valid';
  if (status.status === 'invalid') return 'apiDebug.sequential.complete.invalid';
  if (status.status === 'absent') return 'apiDebug.sequential.complete.absent';
  if (status.reason === 'truncated') return 'apiDebug.sequential.complete.truncated';
  if (status.reason === 'not-representable') return 'apiDebug.sequential.complete.not-representable';
  return 'apiDebug.sequential.complete.unavailable';
}

function sequentialSchemaColor(status: Oas32SequentialSchemaStatus): string {
  if (status.status === 'valid') return 'green';
  if (status.status === 'invalid') return 'red';
  if (status.status === 'skipped' && status.reason === 'truncated') return 'orange';
  return 'default';
}

function sequentialKindLabel(kind: Oas32SequentialStreamView['kind']): string {
  if (kind === 'sse') return 'apiDebug.sequential.kind.sse';
  if (kind === 'jsonl') return 'apiDebug.sequential.kind.jsonl';
  if (kind === 'json-seq') return 'apiDebug.sequential.kind.json-seq';
  if (kind === 'multipart') return 'apiDebug.sequential.kind.multipart';
  return 'apiDebug.sequential.kind.unknown';
}

function sequentialTerminationLabel(termination: Oas32SequentialTermination | undefined): string | undefined {
  if (!termination) return undefined;
  return `apiDebug.sequential.termination.${termination}`;
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

function diagnosticStatusAttr(
  diagnostic: ResponseBodySchemaDiagnostic,
): 'running' | 'invalid-json' | 'invalid-schema' | 'unavailable' {
  if (diagnostic.status === 'invalid') return 'invalid-schema';
  return diagnostic.status;
}

const preStyle: React.CSSProperties = {
  background: '#f6f8fa',
  padding: 12,
  borderRadius: 4,
  fontSize: 13,
  maxHeight: DEBUG_PANEL_DEFAULT_MAX_HEIGHT,
  overflow: 'auto',
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  boxSizing: 'border-box',
};

const streamLogBaseStyle: React.CSSProperties = {
  background: '#0d1117',
  borderRadius: 4,
  padding: '8px 12px',
  maxHeight: DEBUG_PANEL_DEFAULT_MAX_HEIGHT,
  overflowY: 'auto',
  fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace",
  fontSize: 12,
  lineHeight: 1.6,
  boxSizing: 'border-box',
};

export default function ResponsePanel({
  response,
  error,
  builtRequest,
  builtRequestCookieSource = 'explicit',
  operation,
  swaggerDoc,
  sseEvents,
  sequentialStream,
  onSseAbort,
  sseStreaming,
  schemaDiagnostic,
  bodyHeight,
  onBodyHeightChange,
}: ResponsePanelProps) {
  const { t } = useTranslation();
  const responseBodyId = useId();
  const [activeKey, setActiveKey] = useState<string>('content');
  const [showDescription, setShowDescription] = useState(true);
  const [diagnosticExpanded, setDiagnosticExpanded] = useState(false);
  const [responseCollapsed, setResponseCollapsed] = useState(false);
  const [uncontrolledBodyHeight, setUncontrolledBodyHeight] = useState<number | undefined>(undefined);
  const sseLogRef = useRef<HTMLDivElement>(null);
  const sequentialLogRef = useRef<HTMLDivElement>(null);

  const effectiveBodyHeight = onBodyHeightChange ? bodyHeight : uncontrolledBodyHeight;
  const handleBodyHeightChange = onBodyHeightChange ?? setUncontrolledBodyHeight;

  // When a new response arrives, reset focus back to the Content tab, re-expand the
  // response section, and keep schema diagnostics collapsed into the status bar by default.
  useEffect(() => {
    if (response) {
      setActiveKey('content');
      setResponseCollapsed(false);
      setDiagnosticExpanded(false);
    }
  }, [response]);

  useEffect(() => {
    if (!schemaDiagnostic) {
      setDiagnosticExpanded(false);
    }
  }, [schemaDiagnostic]);

  // Auto-scroll SSE log to bottom as new events arrive.
  useEffect(() => {
    if (sseEvents && sseLogRef.current) {
      sseLogRef.current.scrollTop = sseLogRef.current.scrollHeight;
    }
  }, [sseEvents]);

  useEffect(() => {
    if (sequentialStream && sequentialLogRef.current) {
      sequentialLogRef.current.scrollTop = sequentialLogRef.current.scrollHeight;
    }
  }, [sequentialStream]);

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
    const curl = buildPreviewCurl(builtRequest, builtRequestCookieSource, t('apiDebug.cookie.sessionCurl'));
    copyToClipboard(
      curl,
      () => message.success(t('apiDebug.response.copied')),
      () => message.error(t('apiDebug.response.copyFailed')),
    );
  };

  const handleCopySseEvent = (event: SseEvent) => {
    copyToClipboard(
      event.data,
      () => message.success(t('apiDebug.response.copied')),
      () => message.error(t('apiDebug.response.copyFailed')),
    );
  };

  const handleCopySequentialItem = (preview: string) => {
    copyToClipboard(
      preview,
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

  if (!response && !error && sseEvents == null && sequentialStream == null) return null;

  return (
    <div>
      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          title={t('apiDebug.error.title')}
          description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{error}</pre>}
        />
      )}

      {sequentialStream != null && (
        <div
          data-sequential-kind={sequentialStream.kind}
          data-sequential-termination={sequentialStream.termination ?? ''}
          style={{ marginBottom: 16 }}
        >
          <Space wrap style={{ marginBottom: 8 }}>
            <Tag color="blue">{t(sequentialKindLabel(sequentialStream.kind))}</Tag>
            <Tag color={sequentialStream.streaming ? 'processing' : 'default'}>
              {sequentialStream.streaming ? t('apiDebug.sequential.streaming') : t('apiDebug.sequential.done')}
            </Tag>
            <Tag>{t('apiDebug.sequential.itemCount', { count: sequentialStream.items.length })}</Tag>
            {sequentialStream.termination ? (
              <Tag>{t(sequentialTerminationLabel(sequentialStream.termination)!)}</Tag>
            ) : null}
            <Tag color={sequentialSchemaColor(sequentialStream.completeSchema)}>
              {t(sequentialCompleteSchemaLabel(sequentialStream.completeSchema))}
            </Tag>
            {sequentialStream.truncated ? <Tag color="orange">{t('apiDebug.sequential.truncated')}</Tag> : null}
            {sequentialStream.streaming && (
              <Button size="small" danger icon={<StopOutlined />} onClick={onSseAbort}>
                {t('apiDebug.sequential.abort')}
              </Button>
            )}
          </Space>
          <ResizableBox
            height={effectiveBodyHeight}
            defaultMaxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
            minHeight={DEBUG_PANEL_MIN_HEIGHT}
            maxHeight={DEBUG_PANEL_MAX_HEIGHT}
            onHeightChange={handleBodyHeightChange}
            handleLabel={t('apiDebug.response.resizeHandle')}
            resetTitle={t('apiDebug.panel.resizeResetTitle')}
          >
            <div
              ref={sequentialLogRef}
              style={
                effectiveBodyHeight !== undefined
                  ? { ...streamLogBaseStyle, height: '100%', maxHeight: 'none' }
                  : streamLogBaseStyle
              }
            >
              {sequentialStream.items.length === 0 ? (
                <span style={{ color: '#8b949e' }}>{t('apiDebug.sequential.waiting')}</span>
              ) : (
                sequentialStream.items.map((item) => (
                  <div
                    key={item.index}
                    data-sequential-item={item.index}
                    data-item-schema={item.itemSchema.status}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '44px 96px 140px minmax(0, 1fr) 28px',
                      columnGap: 12,
                      alignItems: 'start',
                      borderBottom: '1px solid #21262d',
                      padding: '2px 0',
                    }}
                  >
                    <span style={{ color: '#8b949e', textAlign: 'right', userSelect: 'none' }}>#{item.index + 1}</span>
                    <span style={{ color: '#8b949e', userSelect: 'none' }}>{formatSseEventTime(item.timestamp)}</span>
                    <Tag color={sequentialSchemaColor(item.itemSchema)} style={{ marginInlineEnd: 0 }}>
                      {t(sequentialItemSchemaLabel(item.itemSchema))}
                    </Tag>
                    <span style={{ color: '#e6edf3', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                      {item.preview}
                    </span>
                    <Tooltip title={t('apiDebug.sequential.copyItem', { index: item.index + 1 })}>
                      <Button
                        aria-label={t('apiDebug.sequential.copyItem', { index: item.index + 1 })}
                        icon={<CopyOutlined />}
                        onClick={() => handleCopySequentialItem(item.preview)}
                        size="small"
                        style={{ color: '#8b949e', height: 24, padding: 0, width: 24 }}
                        type="text"
                      />
                    </Tooltip>
                  </div>
                ))
              )}
            </div>
          </ResizableBox>
        </div>
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
          <ResizableBox
            height={effectiveBodyHeight}
            defaultMaxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
            minHeight={DEBUG_PANEL_MIN_HEIGHT}
            maxHeight={DEBUG_PANEL_MAX_HEIGHT}
            onHeightChange={handleBodyHeightChange}
            handleLabel={t('apiDebug.response.resizeHandle')}
            resetTitle={t('apiDebug.panel.resizeResetTitle')}
          >
            <div
              ref={sseLogRef}
              style={
                effectiveBodyHeight !== undefined
                  ? { ...streamLogBaseStyle, height: '100%', maxHeight: 'none' }
                  : streamLogBaseStyle
              }
            >
              {sseEvents.length === 0 ? (
                <span style={{ color: '#8b949e' }}>{t('apiDebug.sse.waiting')}</span>
              ) : (
                sseEvents.map((ev, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '44px 96px minmax(0, 1fr) 28px',
                      columnGap: 12,
                      alignItems: 'start',
                      borderBottom: '1px solid #21262d',
                      padding: '2px 0',
                    }}
                  >
                    <span style={{ color: '#8b949e', textAlign: 'right', userSelect: 'none' }}>#{i + 1}</span>
                    <span style={{ color: '#8b949e', userSelect: 'none' }}>{formatSseEventTime(ev.timestamp)}</span>
                    <span style={{ color: '#e6edf3', wordBreak: 'break-all' }}>{ev.data}</span>
                    <Tooltip title={t('apiDebug.sse.copyEvent', { index: i + 1 })}>
                      <Button
                        aria-label={t('apiDebug.sse.copyEvent', { index: i + 1 })}
                        icon={<CopyOutlined />}
                        onClick={() => handleCopySseEvent(ev)}
                        size="small"
                        style={{ color: '#8b949e', height: 24, padding: 0, width: 24 }}
                        type="text"
                      />
                    </Tooltip>
                  </div>
                ))
              )}
            </div>
          </ResizableBox>
        </div>
      )}

      {response && (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 8,
              marginBottom: responseCollapsed ? 0 : 8,
            }}
          >
            <Space wrap style={{ flex: '1 1 auto', minWidth: 0 }}>
              <Text strong>{t('apiDebug.response.status')}</Text>
              <Tag color={statusColor(response.status)} style={{ color: '#434343' }}>
                {response.status} {response.statusText}
              </Tag>
              <Tag color={METHOD_COLORS[response.method] ?? 'default'}>{response.method}</Tag>
              <Text type="secondary">
                {t('apiDebug.response.duration')}
                {response.duration} ms
              </Text>
              <Text type="secondary">
                {t('apiDebug.response.size')}
                {formatByteSize(response.size)}
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
              {schemaDiagnostic && (
                <DiagnosticStatusToggle
                  diagnostic={schemaDiagnostic}
                  expanded={diagnosticExpanded && !responseCollapsed}
                  onToggle={() => {
                    if (responseCollapsed) {
                      setResponseCollapsed(false);
                      setDiagnosticExpanded(true);
                    } else {
                      setDiagnosticExpanded((prev) => !prev);
                    }
                  }}
                />
              )}
            </Space>
            <Button
              size="small"
              type="text"
              icon={responseCollapsed ? <DownOutlined /> : <UpOutlined />}
              aria-expanded={!responseCollapsed}
              aria-controls={responseBodyId}
              data-response-collapse-toggle=""
              onClick={() => setResponseCollapsed((prev) => !prev)}
              style={{ flexShrink: 0 }}
            >
              {responseCollapsed ? t('apiDebug.response.expand') : t('apiDebug.response.collapse')}
            </Button>
          </div>

          {!responseCollapsed && (
            <div id={responseBodyId} data-response-body-section="">
              {diagnosticExpanded && (
                <ResponseSchemaDiagnosticAlert
                  diagnostic={schemaDiagnostic}
                  onCollapse={() => setDiagnosticExpanded(false)}
                />
              )}

              <Tabs
                tabListLabel={t('apiDebug.response.tabs.label')}
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
                        bodyHeight={effectiveBodyHeight}
                        onBodyHeightChange={handleBodyHeightChange}
                      />
                    ),
                  },
                  {
                    key: 'raw',
                    label: t('apiDebug.response.tab.raw'),
                    children: (
                      <ResizableBox
                        height={effectiveBodyHeight}
                        defaultMaxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
                        minHeight={DEBUG_PANEL_MIN_HEIGHT}
                        maxHeight={DEBUG_PANEL_MAX_HEIGHT}
                        onHeightChange={handleBodyHeightChange}
                        handleLabel={t('apiDebug.response.resizeHandle')}
                        resetTitle={t('apiDebug.panel.resizeResetTitle')}
                      >
                        <pre
                          style={
                            effectiveBodyHeight !== undefined
                              ? { ...preStyle, height: '100%', maxHeight: 'none' }
                              : preStyle
                          }
                        >
                          {response.rawText}
                        </pre>
                      </ResizableBox>
                    ),
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
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DiagnosticStatusToggle({
  diagnostic,
  expanded,
  onToggle,
}: {
  readonly diagnostic: ResponseBodySchemaDiagnostic;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}) {
  const { t } = useTranslation();
  const isWarning = diagnostic.status === 'invalid' || diagnostic.status === 'invalid-json';
  const label =
    diagnostic.status === 'invalid'
      ? t('apiDebug.responseSchemaValidation.toggleInvalid', { count: diagnostic.totalIssues })
      : diagnostic.status === 'invalid-json'
        ? t('apiDebug.responseSchemaValidation.toggleInvalidJson')
        : diagnostic.status === 'running'
          ? t('apiDebug.responseSchemaValidation.toggleRunning')
          : t('apiDebug.responseSchemaValidation.toggleUnavailable');

  return (
    <Button
      size="small"
      data-diagnostic-toggle=""
      data-diagnostic-status={diagnosticStatusAttr(diagnostic)}
      aria-expanded={expanded}
      aria-controls="knife4j-response-schema-diagnostics"
      icon={isWarning ? <WarningOutlined /> : <InfoCircleOutlined />}
      onClick={onToggle}
      style={
        isWarning
          ? {
              color: '#ad6800',
              borderColor: '#ffe58f',
              background: '#fffbe6',
            }
          : {
              color: '#0958d9',
              borderColor: '#91caff',
              background: '#e6f4ff',
            }
      }
    >
      {label}
    </Button>
  );
}

export function ResponseSchemaDiagnosticAlert({
  diagnostic,
  onCollapse,
}: {
  readonly diagnostic?: ResponseBodySchemaDiagnostic | null;
  readonly onCollapse?: () => void;
}) {
  const { t } = useTranslation();
  if (!diagnostic) return null;

  const collapseAction = onCollapse ? (
    <Button size="small" type="text" icon={<UpOutlined />} onClick={onCollapse}>
      {t('apiDebug.responseSchemaValidation.collapse')}
    </Button>
  ) : undefined;

  if (diagnostic.status === 'running') {
    return (
      <div id="knife4j-response-schema-diagnostics" data-diagnostic-status="running">
        <Alert
          type="info"
          showIcon
          action={collapseAction}
          style={{ marginBottom: 12 }}
          title={t('apiDebug.responseSchemaValidation.running')}
          description={t('apiDebug.responseSchemaValidation.nonBlocking')}
        />
      </div>
    );
  }

  if (diagnostic.status === 'invalid-json') {
    return (
      <div id="knife4j-response-schema-diagnostics" data-diagnostic-status="invalid-json">
        <Alert
          type="warning"
          showIcon
          action={collapseAction}
          style={{ marginBottom: 12 }}
          title={t('apiDebug.responseSchemaValidation.title')}
          description={
            <Space orientation="vertical" size={4}>
              <Text>{t('apiDebug.responseSchemaValidation.invalidJson')}</Text>
              <Text type="secondary">{t('apiDebug.responseSchemaValidation.nonBlocking')}</Text>
            </Space>
          }
        />
      </div>
    );
  }

  if (diagnostic.status === 'invalid') {
    return (
      <div id="knife4j-response-schema-diagnostics" data-diagnostic-status="invalid-schema">
        <Alert
          type="warning"
          showIcon
          action={collapseAction}
          style={{ marginBottom: 12 }}
          title={t('apiDebug.responseSchemaValidation.title')}
          description={
            <div>
              <Text type="secondary">{t('apiDebug.responseSchemaValidation.nonBlocking')}</Text>
              <ul style={{ margin: '8px 0 0', paddingInlineStart: 20 }}>
                {diagnostic.issues.map((issue) => (
                  <li key={`${issue.instanceLocation}:${issue.absoluteKeywordLocation}`} style={{ marginBottom: 4 }}>
                    <Text code>{responseBodyInstanceLabel(issue.instanceLocation)}</Text>{' '}
                    <Text>{t('apiDebug.responseSchemaValidation.issue', { keyword: issue.keyword })}</Text>
                  </li>
                ))}
              </ul>
              {diagnostic.totalIssues > diagnostic.issues.length && (
                <Text type="secondary">
                  {t('apiDebug.responseSchemaValidation.moreIssues', {
                    count: diagnostic.totalIssues - diagnostic.issues.length,
                  })}
                </Text>
              )}
            </div>
          }
        />
      </div>
    );
  }

  const reasonKey = {
    'engine-inactive': 'apiDebug.responseSchemaValidation.engineInactive',
    'engine-failed': 'apiDebug.responseSchemaValidation.engineFailed',
    'reference-unavailable': 'apiDebug.responseSchemaValidation.referenceUnavailable',
    'budget-rejected': 'apiDebug.responseSchemaValidation.budgetRejected',
    'evaluation-failed': 'apiDebug.responseSchemaValidation.evaluationFailed',
  }[diagnostic.reason];
  const reason = t(reasonKey);

  return (
    <div id="knife4j-response-schema-diagnostics" data-diagnostic-status="unavailable">
      <Alert
        type="info"
        showIcon
        action={collapseAction}
        style={{ marginBottom: 12 }}
        title={t('apiDebug.responseSchemaValidation.unavailableTitle')}
        description={
          <Space orientation="vertical" size={4}>
            <Text>{diagnostic.message ? `${reason}: ${diagnostic.message}` : reason}</Text>
            <Text type="secondary">{t('apiDebug.responseSchemaValidation.nonBlocking')}</Text>
          </Space>
        }
      />
    </div>
  );
}

/**
 * Content rendering dispatch based on the pre-classified `kind`:
 *  - `image`  → inline <img> preview using the object URL
 *  - `binary` → download link (browsers cannot display it inline)
 *  - `json`   → foldable JSON with optional schema description annotations
 *  - `text`   → plain text / html source in <pre>
 */
function ContentTab({
  response,
  descMap,
  showDescription,
  hasDescriptions,
  onToggleDescription,
  bodyHeight,
  onBodyHeightChange,
}: {
  response: DebugResponsePayload;
  descMap: Map<string, string>;
  showDescription: boolean;
  hasDescriptions: boolean;
  onToggleDescription: () => void;
  bodyHeight?: number;
  onBodyHeightChange: (height: number | undefined) => void;
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
        <ResponseJsonViewer
          response={response}
          descMap={descMap}
          showDescription={showDescription}
          bodyHeight={bodyHeight}
          onBodyHeightChange={onBodyHeightChange}
        />
      </div>
    );
  }

  // text & unknown textual fallback
  return (
    <ResizableBox
      height={bodyHeight}
      defaultMaxHeight={DEBUG_PANEL_DEFAULT_MAX_HEIGHT}
      minHeight={DEBUG_PANEL_MIN_HEIGHT}
      maxHeight={DEBUG_PANEL_MAX_HEIGHT}
      onHeightChange={onBodyHeightChange}
      handleLabel={t('apiDebug.response.resizeHandle')}
      resetTitle={t('apiDebug.panel.resizeResetTitle')}
    >
      <pre style={bodyHeight !== undefined ? { ...preStyle, height: '100%', maxHeight: 'none' } : preStyle}>
        {response.rawText}
      </pre>
    </ResizableBox>
  );
}

// TASK-120-8
