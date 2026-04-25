import {useEffect, useMemo, useState} from 'react';
import {Alert, Button, Space, Table, Tabs, Tag, Typography, message} from 'antd';
import {CopyOutlined} from '@ant-design/icons';
import {useTranslation} from 'react-i18next';

const {Text} = Typography;

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
}

const statusColor = (status: number) => (status < 300 ? 'green' : status < 400 ? 'orange' : 'red');

const METHOD_COLORS: Record<string, string> = {
  GET: 'green', POST: 'blue', PUT: 'orange', DELETE: 'red', PATCH: 'purple', HEAD: 'cyan', OPTIONS: 'default',
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

/**
 * Copies text via navigator.clipboard, with a hidden-textarea fallback
 * for older browsers / non-secure contexts. Mirrors the copy helper
 * already used by the request preview panel.
 */
function copyToClipboard(text: string, onDone: () => void, onFail: () => void): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onDone).catch(onFail);
      return;
    }
  } catch {
    // fall through to textarea fallback
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    onDone();
  } catch {
    onFail();
  }
}

export default function ResponsePanel({response, error}: ResponsePanelProps) {
  const {t} = useTranslation();
  const [activeKey, setActiveKey] = useState<string>('content');

  // When a new response arrives, reset focus back to the Content tab so
  // the user sees the decoded body first.
  useEffect(() => {
    if (response) setActiveKey('content');
  }, [response]);

  const handleCopyRaw = () => {
    if (!response) return;
    copyToClipboard(
      response.rawText,
      () => message.success(t('apiDebug.response.copied')),
      () => message.error(t('apiDebug.response.copyFailed')),
    );
  };

  const headerRows = useMemo(
    () => (response ? Object.entries(response.headers).map(([k, v]) => ({key: k, name: k, value: v})) : []),
    [response],
  );

  if (!response && !error) return null;

  return (
    <div>
      {error && (
        <Alert
          type="error"
          showIcon
          style={{marginBottom: 12}}
          message={t('apiDebug.error.title')}
          description={<pre style={{margin: 0, whiteSpace: 'pre-wrap'}}>{error}</pre>}
        />
      )}

      {response && (
        <>
          <Space wrap style={{marginBottom: 8}}>
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
          </Space>

          <Tabs
            size="small"
            activeKey={activeKey}
            onChange={setActiveKey}
            items={[
              {
                key: 'content',
                label: t('apiDebug.response.tab.content'),
                children: <ContentTab response={response} />,
              },
              {
                key: 'raw',
                label: t('apiDebug.response.tab.raw'),
                children: (
                  <div>
                    <div style={{marginBottom: 8}}>
                      <Button size="small" icon={<CopyOutlined />} onClick={handleCopyRaw}>
                        {t('apiDebug.response.copyRaw')}
                      </Button>
                    </div>
                    <pre style={preStyle}>{response.rawText}</pre>
                  </div>
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
                      {title: t('apiDebug.col.header'), dataIndex: 'name', key: 'name', width: 240},
                      {title: t('apiDebug.col.headerValue'), dataIndex: 'value', key: 'value'},
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
 *  - `json`   → pretty-printed JSON (JSON.stringify on parse), textual fallback
 *  - `text`   → plain text / html source in <pre>
 */
function ContentTab({response}: {response: DebugResponsePayload}) {
  const {t} = useTranslation();

  if (response.kind === 'image' && response.objectUrl) {
    return (
      <div>
        <Text type="secondary" style={{display: 'block', marginBottom: 8}}>
          {t('apiDebug.response.imagePreview')}
        </Text>
        <img
          src={response.objectUrl}
          alt="response"
          style={{maxWidth: '100%', borderRadius: 4, border: '1px solid #e8e8e8'}}
        />
      </div>
    );
  }

  if (response.kind === 'binary' && response.objectUrl) {
    return (
      <div>
        <Text type="secondary" style={{display: 'block', marginBottom: 8}}>
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
    return <pre style={preStyle}>{prettyJson(response.rawText)}</pre>;
  }

  // text & unknown textual fallback
  return <pre style={preStyle}>{response.rawText}</pre>;
}

