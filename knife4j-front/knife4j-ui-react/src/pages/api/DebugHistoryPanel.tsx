import { useMemo, useState, type ReactNode } from 'react';
import { Button, Empty, Space, Tag, Tooltip, Typography } from 'antd';
import { ClearOutlined, DeleteOutlined, HistoryOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { DebugHistoryEntry } from './debugHistory';

const { Text, Paragraph } = Typography;

const METHOD_COLORS: Record<string, string> = {
  GET: 'green',
  POST: 'blue',
  PUT: 'orange',
  DELETE: 'red',
  PATCH: 'purple',
  HEAD: 'cyan',
  OPTIONS: 'default',
};

const PANEL_WIDTH = 320;
const COLLAPSED_WIDTH = 36;

export interface DebugHistoryPanelProps {
  entries: DebugHistoryEntry[];
  onApply: (entry: DebugHistoryEntry) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  /** Controlled collapse; if omitted, panel manages its own collapsed state. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

function statusTagColor(entry: DebugHistoryEntry): string {
  if (entry.status === 'pending') return 'processing';
  if (entry.status === 'aborted') return 'default';
  if (entry.status === 'error') return 'error';
  if (entry.httpStatus !== undefined) {
    if (entry.httpStatus < 300) return 'success';
    if (entry.httpStatus < 400) return 'warning';
    return 'error';
  }
  return 'default';
}

function statusLabel(entry: DebugHistoryEntry, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (entry.status === 'pending') return t('apiDebug.history.status.pending');
  if (entry.status === 'aborted') return t('apiDebug.history.status.aborted');
  if (entry.status === 'error') return t('apiDebug.history.status.error');
  if (entry.httpStatus !== undefined) return String(entry.httpStatus);
  return t('apiDebug.history.status.completed');
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function SnapshotBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
        {title}
      </Text>
      {children}
    </div>
  );
}

function KvList({ data }: { data: Record<string, string> | undefined }) {
  const entries = Object.entries(data ?? {});
  if (entries.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        —
      </Text>
    );
  }
  return (
    <div style={{ fontSize: 12, lineHeight: 1.5, wordBreak: 'break-all' }}>
      {entries.map(([k, v]) => (
        <div key={k}>
          <Text code style={{ fontSize: 11 }}>
            {k}
          </Text>
          : {v}
        </div>
      ))}
    </div>
  );
}

export default function DebugHistoryPanel({
  entries,
  onApply,
  onRemove,
  onClear,
  collapsed: collapsedProp,
  onCollapsedChange,
}: DebugHistoryPanelProps) {
  const { t } = useTranslation();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const collapsed = collapsedProp ?? internalCollapsed;
  const setCollapsed = (next: boolean) => {
    onCollapsedChange?.(next);
    if (collapsedProp === undefined) {
      setInternalCollapsed(next);
    }
  };

  const selected = useMemo(() => entries.find((item) => item.id === selectedId) ?? null, [entries, selectedId]);

  if (collapsed) {
    return (
      <div
        id="knife4j-debug-history-panel"
        style={{
          width: COLLAPSED_WIDTH,
          flex: `0 0 ${COLLAPSED_WIDTH}px`,
          borderLeft: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 8,
          background: '#fafafa',
        }}
      >
        <Tooltip title={t('apiDebug.history.expand')} placement="left">
          <Button
            type="text"
            size="small"
            icon={<HistoryOutlined />}
            onClick={() => setCollapsed(false)}
            aria-label={t('apiDebug.history.expand')}
          />
        </Tooltip>
        <Text
          type="secondary"
          style={{
            writingMode: 'vertical-rl',
            marginTop: 8,
            fontSize: 12,
            letterSpacing: 2,
          }}
        >
          {t('apiDebug.history.title')}
          {entries.length > 0 ? ` (${entries.length})` : ''}
        </Text>
      </div>
    );
  }

  return (
    <div
      id="knife4j-debug-history-panel"
      style={{
        width: PANEL_WIDTH,
        flex: `0 0 ${PANEL_WIDTH}px`,
        borderLeft: '1px solid #f0f0f0',
        display: 'flex',
        flexDirection: 'column',
        background: '#fafafa',
        maxHeight: 'calc(100vh - 120px)',
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px',
          borderBottom: '1px solid #f0f0f0',
          background: '#fff',
        }}
      >
        <Space size={4}>
          <HistoryOutlined />
          <Text strong style={{ fontSize: 13 }}>
            {t('apiDebug.history.title')}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            ({entries.length})
          </Text>
        </Space>
        <Space size={0}>
          <Tooltip title={t('apiDebug.history.clear')}>
            <Button
              type="text"
              size="small"
              icon={<ClearOutlined />}
              disabled={entries.length === 0}
              onClick={onClear}
              aria-label={t('apiDebug.history.clear')}
            />
          </Tooltip>
          <Tooltip title={t('apiDebug.history.collapse')}>
            <Button
              type="text"
              size="small"
              icon={<RightOutlined />}
              onClick={() => setCollapsed(true)}
              aria-label={t('apiDebug.history.collapse')}
            />
          </Tooltip>
        </Space>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {entries.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('apiDebug.history.empty')}
            style={{ margin: '32px 0' }}
          />
        ) : (
          <div style={{ borderBottom: selected ? '1px solid #f0f0f0' : undefined }}>
            {entries.map((entry) => {
              const active = entry.id === selectedId;
              return (
                <div
                  key={entry.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(entry.id === selectedId ? null : entry.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId(entry.id === selectedId ? null : entry.id);
                    }
                  }}
                  style={{
                    padding: '8px 10px',
                    cursor: 'pointer',
                    background: active ? '#e6f4ff' : '#fff',
                    borderBottom: '1px solid #f5f5f5',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <Tag
                      color={METHOD_COLORS[entry.method.toUpperCase()] ?? 'default'}
                      style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}
                    >
                      {entry.method.toUpperCase()}
                    </Tag>
                    <Tag color={statusTagColor(entry)} style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>
                      {statusLabel(entry, t)}
                    </Tag>
                    {entry.isSse && <Tag style={{ margin: 0, fontSize: 11, lineHeight: '18px' }}>SSE</Tag>}
                  </div>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                    {formatTime(entry.createdAt)}
                    {entry.durationMs !== undefined ? ` · ${formatDuration(entry.durationMs)}` : ''}
                  </Text>
                  <Text
                    ellipsis
                    style={{ fontSize: 12, display: 'block', marginTop: 2 }}
                    title={entry.resolvedUrl || entry.path}
                  >
                    {entry.path || entry.resolvedUrl}
                  </Text>
                </div>
              );
            })}
          </div>
        )}

        {selected && (
          <div style={{ padding: 10, background: '#fff', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text strong style={{ fontSize: 13 }}>
                {t('apiDebug.history.detail')}
              </Text>
              <Button type="link" size="small" icon={<LeftOutlined />} onClick={() => setSelectedId(null)}>
                {t('apiDebug.history.backToList')}
              </Button>
            </div>

            <Space wrap style={{ marginBottom: 10 }}>
              <Button type="primary" size="small" onClick={() => onApply(selected)}>
                {t('apiDebug.history.apply')}
              </Button>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => {
                  onRemove(selected.id);
                  setSelectedId(null);
                }}
              >
                {t('apiDebug.history.delete')}
              </Button>
            </Space>

            <SnapshotBlock title={t('apiDebug.history.meta')}>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                <div>
                  {t('apiDebug.history.field.status')}: {statusLabel(selected, t)}
                  {selected.statusText ? ` ${selected.statusText}` : ''}
                </div>
                <div>
                  {t('apiDebug.history.field.time')}: {formatTime(selected.createdAt)}
                </div>
                <div>
                  {t('apiDebug.history.field.duration')}: {formatDuration(selected.durationMs)}
                </div>
                <div style={{ wordBreak: 'break-all' }}>
                  {t('apiDebug.history.field.url')}: {selected.resolvedUrl}
                </div>
                {selected.errorMessage && (
                  <div style={{ color: '#cf1322' }}>
                    {t('apiDebug.history.field.error')}: {selected.errorMessage}
                  </div>
                )}
              </div>
            </SnapshotBlock>

            <SnapshotBlock title={t('apiDebug.history.requestHeaders')}>
              <KvList data={selected.headers} />
            </SnapshotBlock>

            <SnapshotBlock title={t('apiDebug.history.requestQuery')}>
              <KvList data={selected.query} />
            </SnapshotBlock>

            <SnapshotBlock title={t('apiDebug.history.requestBody')}>
              <Paragraph
                style={{
                  fontSize: 11,
                  marginBottom: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 160,
                  overflow: 'auto',
                  background: '#f5f5f5',
                  padding: 6,
                  borderRadius: 4,
                }}
              >
                {selected.body || '—'}
              </Paragraph>
              {selected.bodyTruncated && (
                <Text type="warning" style={{ fontSize: 11 }}>
                  {t('apiDebug.history.truncated')}
                </Text>
              )}
            </SnapshotBlock>

            <SnapshotBlock title={t('apiDebug.history.responseBody')}>
              <Paragraph
                style={{
                  fontSize: 11,
                  marginBottom: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 160,
                  overflow: 'auto',
                  background: '#f5f5f5',
                  padding: 6,
                  borderRadius: 4,
                }}
              >
                {selected.responseBody || '—'}
              </Paragraph>
              {selected.responseTruncated && (
                <Text type="warning" style={{ fontSize: 11 }}>
                  {t('apiDebug.history.truncated')}
                </Text>
              )}
            </SnapshotBlock>
          </div>
        )}
      </div>
    </div>
  );
}
