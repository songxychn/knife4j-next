import { useState } from 'react';
import {
    Alert,
    Button,
    message,
    Space,
    Table,
    Tabs,
    Tag,
    Typography,
} from 'antd';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

// ─── i18n fallback helper ──────────────────────────────
const FALLBACK_STRINGS: Record<string, { zh: string; en: string }> = {
    'apiDebug.response.tab.content': { zh: '内容', en: 'Content' },
    'apiDebug.response.tab.raw': { zh: 'Raw', en: 'Raw' },
    'apiDebug.response.tab.headers': { zh: 'Headers', en: 'Headers' },
    'apiDebug.response.tab.curl': { zh: 'Curl', en: 'Curl' },
    'apiDebug.response.size': { zh: '大小：', en: 'Size: ' },
    'apiDebug.response.copy': { zh: '复制原始内容', en: 'Copy Raw' },
    'apiDebug.response.copied': { zh: '已复制', en: 'Copied' },
    'apiDebug.response.copyFailed': { zh: '复制失败', en: 'Copy failed' },
    'apiDebug.response.download': { zh: '下载', en: 'Download' },
    'apiDebug.response.binaryHint': { zh: '二进制响应（非图片），点击下载', en: 'Binary response (non-image), click to download' },
    'apiDebug.response.noBlob': { zh: '无二进制数据', en: 'No binary data' },
    'apiDebug.response.emptyBody': { zh: '（空响应体）', en: '(Empty body)' },
    'apiDebug.response.copyRaw': { zh: '复制原始内容', en: 'Copy Raw' },
};

function useTWithFallback() {
    const { t, i18n } = useTranslation();
    return (key: string): string => {
        const result = t(key);
        // If translation returns the key itself, use fallback
        if (result === key && FALLBACK_STRINGS[key]) {
            const lang = i18n.language?.startsWith('zh') ? 'zh' : 'en';
            return FALLBACK_STRINGS[key][lang];
        }
        return result;
    };
}

// ─── Types ─────────────────────────────────────────────

export interface DebugResponse {
    status: number;
    statusText: string;
    duration: number;
    size: number;
    headers: Record<string, string>;
    body: string;
    /** raw bytes URL for binary download/preview, if applicable */
    blobUrl?: string;
    /** content-type from response headers */
    contentType: string;
}

// ─── Helpers ───────────────────────────────────────────

const statusColor = (status: number) =>
    status < 300 ? 'green' : status < 400 ? 'orange' : 'red';

function isJsonContentType(ct: string): boolean {
    return ct.toLowerCase().includes('json');
}

function isImageContentType(ct: string): boolean {
    return ct.toLowerCase().startsWith('image/');
}

function isBinaryContentType(ct: string): boolean {
    const lower = ct.toLowerCase();
    return (
        lower.startsWith('image/') ||
        lower.startsWith('audio/') ||
        lower.startsWith('video/') ||
        lower.startsWith('application/octet-stream') ||
        lower.startsWith('application/pdf') ||
        lower.startsWith('application/zip') ||
        lower.startsWith('application/x-') ||
        (lower.startsWith('application/') &&
            !lower.includes('json') &&
            !lower.includes('xml') &&
            !lower.includes('javascript') &&
            !lower.includes('text'))
    );
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function prettyJson(raw: string): string {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
        return raw;
    }
}

// ─── Copy helper ────────────────────────────────────────

function copyText(text: string, onSuccess: () => void, onFail: () => void) {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(onSuccess).catch(onFail);
            return;
        }
    } catch {
        // fallthrough
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        onSuccess();
    } catch {
        onFail();
    }
}

// ─── Sub-panels ─────────────────────────────────────────

const codeBoxStyle: React.CSSProperties = {
    background: '#f6f8fa',
    padding: 12,
    borderRadius: 4,
    fontSize: 13,
    maxHeight: 460,
    overflow: 'auto',
    margin: '4px 0 0 0',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    fontFamily: 'monospace',
};

interface ContentTabProps {
    response: DebugResponse;
}

function ContentTab({ response }: ContentTabProps) {
    const tf = useTWithFallback();
    const ct = response.contentType;

    if (isBinaryContentType(ct)) {
        if (isImageContentType(ct)) {
            // Image preview
            return (
                <div style={{ padding: '12px 0' }}>
                    {response.blobUrl ? (
                        <img
                            src={response.blobUrl}
                            alt="response"
                            style={{ maxWidth: '100%', maxHeight: 400, objectFit: 'contain' }}
                        />
                    ) : (
                        <Text type="secondary">{tf('apiDebug.response.noBlob')}</Text>
                    )}
                </div>
            );
        }
        // Other binary: show download link
        return (
            <Space direction="vertical" style={{ padding: '12px 0' }}>
                <Text type="secondary">{tf('apiDebug.response.binaryHint')}</Text>
                {response.blobUrl && (
                    <Button
                        icon={<DownloadOutlined />}
                        href={response.blobUrl}
                        download="response"
                        target="_blank"
                    >
                        {tf('apiDebug.response.download')}
                    </Button>
                )}
            </Space>
        );
    }

    // JSON: pretty-print
    if (isJsonContentType(ct)) {
        return <pre style={codeBoxStyle}>{prettyJson(response.body)}</pre>;
    }

    // Text fallback
    return <pre style={codeBoxStyle}>{response.body || tf('apiDebug.response.emptyBody')}</pre>;
}

interface RawTabProps {
    response: DebugResponse;
}

function RawTab({ response }: RawTabProps) {
    const tf = useTWithFallback();

    const handleCopy = () => {
        copyText(
            response.body,
            () => void message.success(tf('apiDebug.preview.copied')),
            () => void message.error(tf('apiDebug.preview.copyFailed')),
        );
    };

    return (
        <div>
            <div style={{ textAlign: 'right', marginBottom: 4 }}>
                <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>
                    {tf('apiDebug.response.copyRaw')}
                </Button>
            </div>
            <pre style={codeBoxStyle}>{response.body || tf('apiDebug.response.emptyBody')}</pre>
        </div>
    );
}

interface HeadersTabProps {
    response: DebugResponse;
}

function HeadersTab({ response }: HeadersTabProps) {
    const { t } = useTranslation();
    const data = Object.entries(response.headers).map(([key, value]) => ({ key, name: key, value }));
    return (
        <Table
            size="small"
            dataSource={data}
            columns={[
                { title: t('apiDebug.col.header'), dataIndex: 'name', key: 'name', width: 260 },
                { title: t('apiDebug.col.headerValue'), dataIndex: 'value', key: 'value' },
            ]}
            pagination={false}
        />
    );
}

interface CurlTabProps {
    curl: string;
}

function CurlTab({ curl }: CurlTabProps) {
    const tf = useTWithFallback();

    const handleCopy = () => {
        copyText(
            curl,
            () => void message.success(tf('apiDebug.preview.copied')),
            () => void message.error(tf('apiDebug.preview.copyFailed')),
        );
    };

    return (
        <div>
            <div style={{ textAlign: 'right', marginBottom: 4 }}>
                <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>
                    {tf('apiDebug.preview.copyCurl')}
                </Button>
            </div>
            <pre style={{ ...codeBoxStyle, maxHeight: 300 }}>{curl}</pre>
        </div>
    );
}

// ─── DebugResponsePanel ─────────────────────────────────

interface DebugResponsePanelProps {
    response: DebugResponse;
    curl: string;
    error?: string | null;
}

export function DebugResponsePanel({ response, curl, error }: DebugResponsePanelProps) {
    const { t } = useTranslation();
    const tf = useTWithFallback();
    const [activeTab, setActiveTab] = useState('content');

    return (
        <div>
            {/* Status bar */}
            <Space wrap style={{ marginBottom: 8 }}>
                <Text strong>{t('apiDebug.response.status')}</Text>
                <Tag color={statusColor(response.status)}>
                    {response.status} {response.statusText}
                </Tag>
                <Text type="secondary">
                    {t('apiDebug.response.duration')}{response.duration} ms
                </Text>
                <Text type="secondary">
                    {tf('apiDebug.response.size')}{formatBytes(response.size)}
                </Text>
            </Space>

            {error && (
                <Alert
                    type="error"
                    message={t('apiDebug.error.title')}
                    description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{error}</pre>}
                    showIcon
                    style={{ marginBottom: 8 }}
                />
            )}

            {/* Response sub-tabs: Content / Raw / Headers / Curl */}
            <Tabs
                size="small"
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    {
                        key: 'content',
                        label: tf('apiDebug.response.tab.content'),
                        children: <ContentTab response={response} />,
                    },
                    {
                        key: 'raw',
                        label: tf('apiDebug.response.tab.raw'),
                        children: <RawTab response={response} />,
                    },
                    {
                        key: 'headers',
                        label: `${tf('apiDebug.response.tab.headers')} (${Object.keys(response.headers).length})`,
                        children: <HeadersTab response={response} />,
                    },
                    {
                        key: 'curl',
                        label: tf('apiDebug.response.tab.curl'),
                        children: <CurlTab curl={curl} />,
                    },
                ]}
            />
        </div>
    );
}
