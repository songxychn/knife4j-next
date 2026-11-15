import { oas32PreviewDiagnostics } from './oas32ParameterForm';
import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { FormBodyEncodingPlan, ParamSource, QueryParamValue } from 'knife4j-core';
import { type Oas32ParameterDiagnostic } from 'knife4j-core';
import CodeBlock from './CodeBlock';
import { displayQueryParamValue } from './enumParamValue';
import { formatRequestPreviewBody, type RequestPreviewBuildResult } from './requestPreviewBuild';

import { METHOD_COLORS } from './apiDebugShared';

const { Paragraph, Text } = Typography;

// ─── Preview Tab (TASK-028) ───────────────────────────
interface PreviewTabPanelProps {
  result: RequestPreviewBuildResult;
  onCopyText: (text: string) => void;
  onDownloadMultipartBody?: (body: Blob) => void;
}

function formatMultipartPlanBody(plan: Extract<FormBodyEncodingPlan, { kind: 'multipart' }>): string {
  const formatPart = (part: (typeof plan.parts)[number]): Record<string, unknown> => {
    if (part.kind === 'nested') {
      return {
        name: part.name,
        contentType: part.contentType,
        headers: part.headers,
        parts: part.parts.map(formatPart),
      };
    }
    return part.kind === 'file'
      ? {
          name: part.name,
          file: part.fileName,
          ...(part.fileSize === undefined ? {} : { size: part.fileSize }),
          contentType: part.contentType,
          headers: part.headers,
        }
      : {
          name: part.name,
          value: part.value,
          contentType: part.contentType,
          headers: part.headers,
        };
  };
  if (plan.wire === 'authored') {
    return plan.authoredBody ?? '';
  }
  return JSON.stringify(plan.parts.map(formatPart), null, 2);
}

function oas32PreviewDiagnosticAlertType(diagnostic: Oas32ParameterDiagnostic): 'error' | 'warning' | 'info' {
  if (diagnostic.blocks === 'all') return 'error';
  if (diagnostic.blocks === 'browser') return 'warning';
  return 'info';
}

function oas32PreviewDiagnosticTitle(diagnostic: Oas32ParameterDiagnostic): string {
  if (diagnostic.blocks === 'all') return 'apiDebug.preview.diagnosticsBlocked';
  if (diagnostic.blocks === 'browser') return 'apiDebug.preview.diagnosticsBrowser';
  return 'apiDebug.preview.diagnosticsInfo';
}

export function PreviewTabPanel({ result, onCopyText, onDownloadMultipartBody }: PreviewTabPanelProps) {
  const { t } = useTranslation();
  const [wireText, setWireText] = useState<string>();
  const materialized = result.ok ? result.value.materializedMultipart : undefined;
  useEffect(() => {
    if (!result.ok || materialized?.mode !== 'encoded' || !(materialized.body instanceof Blob)) {
      setWireText(undefined);
      return;
    }
    let cancelled = false;
    void materialized.body.text().then((value) => {
      if (!cancelled) setWireText(value);
    });
    return () => {
      cancelled = true;
    };
  }, [result, materialized]);
  if (!result.ok) {
    return <Alert type="error" showIcon title={t('apiDebug.error.title')} description={result.error} />;
  }
  const { built, curl, cookieParameterSource } = result.value;
  const multipartPlan = built.formBodyPlan?.kind === 'multipart' ? built.formBodyPlan : undefined;
  const encodedMultipart = materialized?.mode === 'encoded';
  const isMultipart = Boolean(multipartPlan) || built.contentType.toLowerCase().includes('multipart/');
  const previewBody = encodedMultipart
    ? (wireText ?? '')
    : multipartPlan
      ? formatMultipartPlanBody(multipartPlan)
      : built.body;
  const hasBody =
    encodedMultipart || (previewBody !== undefined && (previewBody !== '' || built.explicitExampleBody === true));
  const parameterDiagnostics = oas32PreviewDiagnostics(built);

  const headerPairs = Object.entries(built.headers);
  const queryPairs = Object.entries(built.query);
  const hasContentType = headerPairs.some(([k]) => k.toLowerCase() === 'content-type');

  const sourceTag = (source: ParamSource | undefined) => {
    if (!source) return null;
    const colorMap: Record<ParamSource, string> = {
      interface: 'blue',
      application: 'purple',
      global: 'green',
      auth: 'orange',
    };
    return (
      <Tag color={colorMap[source]} style={{ marginInlineEnd: 0 }}>
        {t(`apiDebug.preview.source.${source}`)}
      </Tag>
    );
  };

  const renderPreviewValue = (value: QueryParamValue) => {
    const displayValue = displayQueryParamValue(value);
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, minWidth: 0 }}>
        <Paragraph
          key={displayValue}
          ellipsis={{
            rows: 2,
            expandable: 'collapsible',
            symbol: (expanded) => t(expanded ? 'apiDebug.preview.collapseValue' : 'apiDebug.preview.expandValue'),
          }}
          style={{ flex: 1, minWidth: 0, marginBottom: 0, wordBreak: 'break-all' }}
        >
          {displayValue}
        </Paragraph>
        {displayValue && (
          <Tooltip title={t('apiDebug.preview.copyValue')}>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => onCopyText(displayValue)}
              aria-label={t('apiDebug.preview.copyValue')}
              style={{ flex: 'none' }}
            />
          </Tooltip>
        )}
      </div>
    );
  };

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size={14}>
      {/* URL + method */}
      <div>
        <Space size={8}>
          <Text type="secondary">{t('apiDebug.preview.method')}</Text>
          <Tag color={METHOD_COLORS[built.method] ?? 'default'}>{built.method}</Tag>
          <Text type="secondary">{t('apiDebug.preview.url')}</Text>
        </Space>
        <pre style={previewBoxStyle}>{built.url}</pre>
      </div>

      {parameterDiagnostics.length > 0 && (
        <Space orientation="vertical" style={{ width: '100%' }} size={8}>
          <Text strong>{t('apiDebug.preview.diagnostics')}</Text>
          {parameterDiagnostics.map((diagnostic, index) => (
            <Alert
              key={`${diagnostic.code}:${diagnostic.key ?? ''}:${index}`}
              type={oas32PreviewDiagnosticAlertType(diagnostic)}
              showIcon
              title={t(oas32PreviewDiagnosticTitle(diagnostic))}
              description={`${diagnostic.code}: ${diagnostic.message}`}
            />
          ))}
        </Space>
      )}

      {/* Headers */}
      <div>
        <Text strong>{t('apiDebug.preview.headers')}</Text>
        {!hasContentType && hasBody && !isMultipart && (
          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {t('apiDebug.preview.autoContentType')}
          </Text>
        )}
        {headerPairs.length > 0 ? (
          <Table
            size="small"
            tableLayout="fixed"
            pagination={false}
            dataSource={headerPairs.map(([key, value]) => ({
              key,
              name: key,
              value,
              source: built.sourceMap?.headers[key],
            }))}
            columns={[
              {
                title: t('apiDebug.col.header'),
                dataIndex: 'name',
                key: 'name',
                width: 240,
                render: (name: string, record: { source?: ParamSource }) => (
                  <Space size={4}>
                    <Text code>{name}</Text>
                    {sourceTag(record.source)}
                  </Space>
                ),
              },
              {
                title: t('apiDebug.col.headerValue'),
                dataIndex: 'value',
                key: 'value',
                render: renderPreviewValue,
              },
            ]}
            style={{ marginTop: 4 }}
          />
        ) : (
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            —
          </Text>
        )}
      </div>

      {/* Query */}
      <div>
        <Text strong>{t('apiDebug.preview.query')}</Text>
        {queryPairs.length > 0 ? (
          <Table
            size="small"
            tableLayout="fixed"
            pagination={false}
            dataSource={queryPairs.map(([key, value]) => ({
              key,
              name: key,
              value,
              source: built.sourceMap?.query[key],
            }))}
            columns={[
              {
                title: t('apiDebug.col.paramName'),
                dataIndex: 'name',
                key: 'name',
                width: 240,
                render: (name: string, record: { source?: ParamSource }) => (
                  <Space size={4}>
                    <Text code>{name}</Text>
                    {sourceTag(record.source)}
                  </Space>
                ),
              },
              {
                title: t('apiDebug.col.value'),
                dataIndex: 'value',
                key: 'value',
                render: renderPreviewValue,
              },
            ]}
            style={{ marginTop: 4 }}
          />
        ) : (
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            —
          </Text>
        )}
      </div>

      {/* Body */}
      <div>
        <Text strong>
          {encodedMultipart
            ? t('apiDebug.preview.multipartWire')
            : isMultipart
              ? t('apiDebug.preview.bodyMultipart')
              : t('apiDebug.preview.body')}
        </Text>
        {hasBody ? (
          encodedMultipart || !built.contentType.includes('json') ? (
            <pre style={previewBoxStyle}>{encodedMultipart ? (wireText ?? '') : (previewBody ?? '')}</pre>
          ) : (
            <CodeBlock
              code={formatRequestPreviewBody(previewBody ?? '', built.contentType, built.explicitExampleBody)}
              preserveText
              maxHeight={320}
            />
          )
        ) : (
          <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
            {t('apiDebug.preview.noBody')}
          </Text>
        )}
      </div>

      {/* Curl */}
      <div>
        {cookieParameterSource === 'browser-session' && (
          <Alert
            type="info"
            showIcon
            title={t('apiDebug.cookie.sessionPreview')}
            description={t('apiDebug.cookie.sessionCurl')}
            style={{ marginBottom: 8 }}
          />
        )}
        {encodedMultipart && (
          <Alert type="info" showIcon title={t('apiDebug.preview.multipartBodyFile')} style={{ marginBottom: 8 }} />
        )}
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'curl',
              label: <Text strong>{t('apiDebug.preview.curl')}</Text>,
              styles: { header: { padding: 0 }, body: { padding: '8px 0 0' } },
              extra: (
                <Space onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                  <Button size="small" onClick={() => onCopyText(curl)}>
                    {t('apiDebug.preview.copyCurl')}
                  </Button>
                  {encodedMultipart && materialized?.body instanceof Blob && (
                    <Button
                      size="small"
                      icon={<DownloadOutlined />}
                      onClick={() => onDownloadMultipartBody?.(materialized.body as Blob)}
                    >
                      {t('apiDebug.preview.downloadMultipartBody')}
                    </Button>
                  )}
                </Space>
              ),
              children: <pre style={{ ...previewBoxStyle, lineHeight: '20px', maxHeight: 144 }}>{curl}</pre>,
            },
          ]}
        />
      </div>
    </Space>
  );
}

const previewBoxStyle: React.CSSProperties = {
  background: '#f6f8fa',
  padding: 12,
  borderRadius: 4,
  fontSize: 13,
  maxHeight: 320,
  overflow: 'auto',
  margin: '4px 0 0 0',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
};
