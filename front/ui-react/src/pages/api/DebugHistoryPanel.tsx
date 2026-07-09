import { useMemo, useState, type ReactNode } from 'react';
import { Button, Empty, Modal, Segmented, Space, Tag, Tooltip, Typography, message } from 'antd';
import {
  ClearOutlined,
  CopyOutlined,
  HistoryOutlined,
  RightOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { DebugHistoryEntry } from './debugHistory';
import { copyToClipboard } from '../../utils/clipboard';

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

const PANEL_WIDTH = 280;
const COLLAPSED_WIDTH = 36;

type HistorySortOrder = 'desc' | 'asc';

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

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** Format timestamp as yyyy-MM-dd HH:mm:ss (local time). */
function formatTime(ts: number): string {
  try {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return String(ts);
    const yyyy = date.getFullYear();
    const MM = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    const HH = pad2(date.getHours());
    const mm = pad2(date.getMinutes());
    const ss = pad2(date.getSeconds());
    return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
  } catch {
    return String(ts);
  }
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function SnapshotBlock({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <Text strong style={{ fontSize: 13 }}>
          {title}
        </Text>
        {extra}
      </div>
      {children}
    </div>
  );
}

function KvList({ data }: { data: Record<string, string> | undefined }) {
  const items = Object.entries(data ?? {});
  if (items.length === 0) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        —
      </Text>
    );
  }
  return (
    <div style={{ fontSize: 12, lineHeight: 1.6, wordBreak: 'break-all' }}>
      {items.map(([k, v]) => (
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

function BodyBlock({
  text,
  truncated,
  truncatedLabel,
  copyLabel,
  copiedLabel,
  copyFailedLabel,
}: {
  text?: string;
  truncated?: boolean;
  truncatedLabel: string;
  copyLabel: string;
  copiedLabel: string;
  copyFailedLabel: string;
}) {
  const content = text ?? '';
  const canCopy = content.length > 0;

  const handleCopy = () => {
    if (!canCopy) return;
    copyToClipboard(
      content,
      () => {
        void message.success(copiedLabel);
      },
      () => {
        void message.error(copyFailedLabel);
      },
    );
  };

  return (
    <>
      <div style={{ position: 'relative' }}>
        <Paragraph
          style={{
            fontSize: 12,
            marginBottom: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 240,
            overflow: 'auto',
            background: '#f5f5f5',
            padding: 10,
            paddingRight: canCopy ? 40 : 10,
            borderRadius: 4,
          }}
        >
          {content || '—'}
        </Paragraph>
        {canCopy && (
          <Tooltip title={copyLabel}>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={handleCopy}
              aria-label={copyLabel}
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                color: 'rgba(0,0,0,0.45)',
              }}
            />
          </Tooltip>
        )}
      </div>
      {truncated && (
        <Text type="warning" style={{ fontSize: 12 }}>
          {truncatedLabel}
        </Text>
      )}
    </>
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
  const [sortOrder, setSortOrder] = useState<HistorySortOrder>('desc');

  const collapsed = collapsedProp ?? internalCollapsed;
  const setCollapsed = (next: boolean) => {
    onCollapsedChange?.(next);
    if (collapsedProp === undefined) {
      setInternalCollapsed(next);
    }
  };

  const sortedEntries = useMemo(() => {
    const list = [...entries];
    list.sort((a, b) => {
      const delta = a.createdAt - b.createdAt;
      return sortOrder === 'desc' ? -delta : delta;
    });
    return list;
  }, [entries, sortOrder]);

  const selected = useMemo(
    () => sortedEntries.find((item) => item.id === selectedId) ?? null,
    [sortedEntries, selectedId],
  );

  const closeDetail = () => setSelectedId(null);

  // Peer column (same stacking level as the debug form): no fixed/shadow/z-index.
  const columnStyle = {
    flex: `0 0 ${collapsed ? COLLAPSED_WIDTH : PANEL_WIDTH}px`,
    width: collapsed ? COLLAPSED_WIDTH : PANEL_WIDTH,
    minWidth: collapsed ? COLLAPSED_WIDTH : PANEL_WIDTH,
    boxSizing: 'border-box' as const,
    borderLeft: '1px solid #f0f0f0',
    background: 'transparent',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    alignSelf: 'stretch' as const,
    minHeight: 0,
  };

  const bodyCopyProps = {
    truncatedLabel: t('apiDebug.history.truncated'),
    copyLabel: t('apiDebug.history.copy'),
    copiedLabel: t('apiDebug.history.copied'),
    copyFailedLabel: t('apiDebug.history.copyFailed'),
  };

  const detailModal = (
    <Modal
      open={selected !== null}
      onCancel={closeDetail}
      title={
        selected ? (
          <Space size={8} wrap>
            <HistoryOutlined />
            <span>{t('apiDebug.history.detail')}</span>
            <Tag color={METHOD_COLORS[selected.method.toUpperCase()] ?? 'default'} style={{ margin: 0 }}>
              {selected.method.toUpperCase()}
            </Tag>
            <Tag color={statusTagColor(selected)} style={{ margin: 0 }}>
              {statusLabel(selected, t)}
            </Tag>
            {selected.isSse && <Tag style={{ margin: 0 }}>SSE</Tag>}
          </Space>
        ) : (
          t('apiDebug.history.detail')
        )
      }
      width={720}
      destroyOnHidden
      footer={
        selected
          ? [
              <Button
                key="delete"
                danger
                onClick={() => {
                  onRemove(selected.id);
                  closeDetail();
                }}
              >
                {t('apiDebug.history.delete')}
              </Button>,
              <Button key="close" onClick={closeDetail}>
                {t('apiDebug.history.close')}
              </Button>,
              <Button
                key="apply"
                type="primary"
                onClick={() => {
                  onApply(selected);
                  closeDetail();
                }}
              >
                {t('apiDebug.history.apply')}
              </Button>,
            ]
          : null
      }
    >
      {selected && (
        <div>
          <SnapshotBlock title={t('apiDebug.history.meta')}>
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
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
            <BodyBlock text={selected.body} truncated={selected.bodyTruncated} {...bodyCopyProps} />
          </SnapshotBlock>

          <SnapshotBlock title={t('apiDebug.history.responseBody')}>
            <BodyBlock text={selected.responseBody} truncated={selected.responseTruncated} {...bodyCopyProps} />
          </SnapshotBlock>
        </div>
      )}
    </Modal>
  );

  if (collapsed) {
    return (
      <>
        <div id="knife4j-debug-history-panel" style={{ ...columnStyle, alignItems: 'center', paddingTop: 8 }}>
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
        {detailModal}
      </>
    );
  }

  return (
    <>
      <div id="knife4j-debug-history-panel" style={columnStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
            borderBottom: '1px solid #f0f0f0',
            flex: '0 0 auto',
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

        <div
          style={{
            padding: '6px 10px',
            borderBottom: '1px solid #f0f0f0',
            flex: '0 0 auto',
          }}
        >
          <Segmented
            size="small"
            block
            value={sortOrder}
            onChange={(value) => setSortOrder(value as HistorySortOrder)}
            options={[
              {
                value: 'desc',
                icon: <SortDescendingOutlined />,
                label: t('apiDebug.history.sort.desc'),
              },
              {
                value: 'asc',
                icon: <SortAscendingOutlined />,
                label: t('apiDebug.history.sort.asc'),
              },
            ]}
          />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {sortedEntries.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('apiDebug.history.empty')}
              style={{ margin: '32px 0' }}
            />
          ) : (
            sortedEntries.map((entry) => (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(entry.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedId(entry.id);
                  }
                }}
                style={{
                  padding: '8px 10px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f5f5f5',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = '#fafafa';
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = 'transparent';
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
            ))
          )}
        </div>
      </div>
      {detailModal}
    </>
  );
}
