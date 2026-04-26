import { Button, Space, Typography, Alert } from 'antd';
import { FileTextOutlined, FileWordOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useGroup } from '../../context/GroupContext';
import type { SwaggerDoc, MenuTag, OperationObject, ParameterObject, SchemaObject } from '../../types/swagger';

const { Title, Paragraph } = Typography;

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'document';
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function escapeHtml(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function methodColor(method: string): string {
  const map: Record<string, string> = {
    GET: '#61affe',
    POST: '#49cc90',
    PUT: '#fca130',
    DELETE: '#f93e3e',
    PATCH: '#50e3c2',
    HEAD: '#9012fe',
    OPTIONS: '#0d5aa7',
  };
  return map[method.toUpperCase()] ?? '#999';
}

function renderParamTable(params: ParameterObject[]): string {
  if (!params.length) return '';
  const rows = params
    .map(
      (p) => `
    <tr>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.name)}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.in)}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${p.required ? 'Yes' : 'No'}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.schema?.type ?? p.type ?? '')}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.description)}</td>
    </tr>`,
    )
    .join('');
  return `
    <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:13px;">
      <thead><tr style="background:#f5f5f5;">
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">Name</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">In</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">Required</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">Type</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">Description</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function resolveRef(ref: string, doc: SwaggerDoc): SchemaObject | undefined {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/) ?? ref.match(/^#\/definitions\/(.+)$/);
  if (!match) return undefined;
  return (doc.components?.schemas ?? (doc.definitions as Record<string, SchemaObject> | undefined) ?? {})[match[1]];
}

function renderRequestBodyTable(op: OperationObject, doc: SwaggerDoc, borderStyle: string): string {
  const rb = op.requestBody;
  if (!rb) return '';
  const jsonContent = rb.content?.['application/json'];
  if (!jsonContent?.schema) return '';
  let schema = jsonContent.schema;
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) return '';
    schema = resolved;
  }
  if (!schema.properties) return '';
  const requiredSet = new Set(schema.required ?? []);
  const rows = Object.entries(schema.properties)
    .map(([name, prop]) => {
      const type = prop.type ?? (prop.$ref ? prop.$ref.split('/').pop() ?? '$ref' : 'object');
      return `
    <tr>
      <td style="${borderStyle}">${escapeHtml(name)}</td>
      <td style="${borderStyle}">${escapeHtml(type)}</td>
      <td style="${borderStyle}">${requiredSet.has(name) ? 'Yes' : 'No'}</td>
      <td style="${borderStyle}">${escapeHtml(prop.description)}</td>
    </tr>`;
    })
    .join('');
  return `
    <p style="margin:6px 0 2px;font-size:13px;font-weight:600;">Request Body (application/json)</p>
    <table style="width:100%;border-collapse:collapse;margin:4px 0;font-size:13px;">
      <thead><tr style="background:#f5f5f5;">
        <th style="${borderStyle}text-align:left;">Field</th>
        <th style="${borderStyle}text-align:left;">Type</th>
        <th style="${borderStyle}text-align:left;">Required</th>
        <th style="${borderStyle}text-align:left;">Description</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderOperation(path: string, method: string, op: OperationObject, doc: SwaggerDoc): string {
  const color = methodColor(method);
  const params = op.parameters ?? [];
  const bodyHtml = renderRequestBodyTable(op, doc, 'border:1px solid #ddd;padding:5px 8px;');
  return `
    <div style="margin:14px 0;border:1px solid #e8e8e8;border-radius:4px;overflow:hidden;">
      <div style="padding:8px 12px;background:#fafafa;display:flex;align-items:center;gap:10px;">
        <span style="background:${color};color:#fff;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:600;min-width:56px;text-align:center;">${escapeHtml(
    method.toUpperCase(),
  )}</span>
        <span style="font-family:monospace;font-size:14px;">${escapeHtml(path)}</span>
        ${op.deprecated ? '<span style="color:#f93e3e;font-size:12px;margin-left:8px;">[Deprecated]</span>' : ''}
      </div>
      ${op.summary ? `<div style="padding:5px 12px;font-size:14px;">${escapeHtml(op.summary)}</div>` : ''}
      ${
        op.description
          ? `<div style="padding:3px 12px;font-size:13px;color:#666;">${escapeHtml(op.description)}</div>`
          : ''
      }
      ${params.length ? `<div style="padding:5px 12px;">${renderParamTable(params)}</div>` : ''}
      ${bodyHtml ? `<div style="padding:5px 12px;">${bodyHtml}</div>` : ''}
    </div>`;
}

function buildHtmlDoc(doc: SwaggerDoc, tags: MenuTag[]): string {
  const sections = tags
    .map((t) => {
      const ops = t.operations.map((op) => renderOperation(op.path, op.method, op.operation, doc)).join('');
      return `
      <div style="margin-bottom:28px;">
        <h2 style="border-left:4px solid #00ab6d;padding-left:10px;margin:20px 0 10px;">${escapeHtml(t.tag)}</h2>
        ${t.description ? `<p style="color:#666;margin-bottom:10px;">${escapeHtml(t.description)}</p>` : ''}
        ${ops}
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(doc.info.title)}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;color:#333;}
    .wrap{max-width:960px;margin:0 auto;padding:24px;}
    h1{text-align:center;color:#00ab6d;}
    .info{background:#f9f9f9;border:1px solid #e8e8e8;border-radius:4px;padding:14px;margin-bottom:20px;}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(doc.info.title)}</h1>
    <div class="info">
      <p><strong>Version:</strong> ${escapeHtml(doc.info.version)}</p>
      ${doc.info.description ? `<p><strong>Description:</strong> ${escapeHtml(doc.info.description)}</p>` : ''}
    </div>
    ${sections}
  </div>
</body>
</html>`;
}

function buildWordDoc(doc: SwaggerDoc, tags: MenuTag[]): string {
  const sections = tags
    .map((t) => {
      const ops = t.operations
        .map((op) => {
          const params = op.operation.parameters ?? [];
          const paramRows = params
            .map(
              (p) => `
        <tr>
          <td style="border:1px solid #000;padding:4px 6px;">${escapeHtml(p.name)}</td>
          <td style="border:1px solid #000;padding:4px 6px;">${escapeHtml(p.in)}</td>
          <td style="border:1px solid #000;padding:4px 6px;">${p.required ? 'Yes' : 'No'}</td>
          <td style="border:1px solid #000;padding:4px 6px;">${escapeHtml(p.schema?.type ?? p.type ?? '')}</td>
          <td style="border:1px solid #000;padding:4px 6px;">${escapeHtml(p.description)}</td>
        </tr>`,
            )
            .join('');
          const paramTable = params.length
            ? `
        <table style="width:100%;border-collapse:collapse;margin:6px 0;font-size:12px;">
          <thead><tr style="background:#e8e8e8;">
            <th style="border:1px solid #000;padding:4px 6px;">Name</th>
            <th style="border:1px solid #000;padding:4px 6px;">In</th>
            <th style="border:1px solid #000;padding:4px 6px;">Required</th>
            <th style="border:1px solid #000;padding:4px 6px;">Type</th>
            <th style="border:1px solid #000;padding:4px 6px;">Description</th>
          </tr></thead>
          <tbody>${paramRows}</tbody>
        </table>`
            : '';
          const bodyHtml = renderRequestBodyTable(op.operation, doc, 'border:1px solid #000;padding:4px 6px;');
          return `
        <div style="margin:10px 0;padding:8px;border:1px solid #ccc;">
          <p style="margin:0 0 4px;"><strong style="color:${methodColor(op.method)};">[${escapeHtml(
            op.method.toUpperCase(),
          )}]</strong> <code>${escapeHtml(op.path)}</code>${
            op.operation.deprecated ? ' <em style="color:red;">[Deprecated]</em>' : ''
          }</p>
          ${
            op.operation.summary
              ? `<p style="margin:2px 0;font-size:13px;">${escapeHtml(op.operation.summary)}</p>`
              : ''
          }
          ${paramTable}
          ${bodyHtml}
        </div>`;
        })
        .join('');
      return `
      <h2 style="border-left:4px solid #00ab6d;padding-left:8px;margin:20px 0 8px;">${escapeHtml(t.tag)}</h2>
      ${ops}`;
    })
    .join('');

  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <title>${escapeHtml(doc.info.title)}</title>
  <style>
    body{font-family:"宋体",serif;font-size:14px;margin:20px;}
    h1{text-align:center;}
    code{font-family:monospace;}
  </style>
</head>
<body>
  <h1>${escapeHtml(doc.info.title)}</h1>
  <p><strong>Version:</strong> ${escapeHtml(doc.info.version)}</p>
  ${doc.info.description ? `<p><strong>Description:</strong> ${escapeHtml(doc.info.description)}</p>` : ''}
  <hr/>
  ${sections}
</body>
</html>`;
}

export default function OfficeDoc() {
  const { t } = useTranslation();
  const { swaggerDoc, menuTags, loading, usingMock } = useGroup();

  function handleDownloadHtml() {
    if (!swaggerDoc) return;
    const html = buildHtmlDoc(swaggerDoc, menuTags);
    const title = swaggerDoc.info.title || 'api-docs';
    downloadBlob(html, `${title}.html`, 'text/html;charset=utf-8');
  }

  function handleDownloadWord() {
    if (!swaggerDoc) return;
    const html = buildWordDoc(swaggerDoc, menuTags);
    const title = swaggerDoc.info.title || 'api-docs';
    downloadBlob(html, `${title}.doc`, 'application/msword');
  }

  const noData = !loading && (!swaggerDoc || usingMock);

  return (
    <div id="knife4j-office-doc-page" style={{ padding: 24, maxWidth: 800 }}>
      <Title level={4} style={{ marginBottom: 8 }}>
        {t('officeDoc.title')}
      </Title>
      <Paragraph type="secondary" style={{ marginBottom: 20 }}>
        {t('officeDoc.desc')}
      </Paragraph>

      {noData && <Alert type="warning" message={t('officeDoc.alert.mockData')} style={{ marginBottom: 16 }} />}

      <Space size="middle">
        <Button
          type="primary"
          icon={<FileTextOutlined />}
          onClick={handleDownloadHtml}
          disabled={loading || !swaggerDoc || usingMock}
          loading={loading}
        >
          {t('officeDoc.btn.html')}
        </Button>
        <Button
          icon={<FileWordOutlined />}
          onClick={handleDownloadWord}
          disabled={loading || !swaggerDoc || usingMock}
          loading={loading}
        >
          {t('officeDoc.btn.word')}
        </Button>
      </Space>
    </div>
  );
}
