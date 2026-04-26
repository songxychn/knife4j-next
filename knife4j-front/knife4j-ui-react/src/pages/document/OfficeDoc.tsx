import { Button, Space, Typography, Alert } from 'antd';
import { FileTextOutlined, FileWordOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  Document,
  Packer,
  Paragraph as DocxParagraph,
  TextRun,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  HeadingLevel,
  ShadingType,
} from 'docx';
import { useGroup } from '../../context/GroupContext';
import type {
  SwaggerDoc,
  MenuTag,
  OperationObject,
  ParameterObject,
  ResponseObject,
  SchemaObject,
} from '../../types/swagger';

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
      const type = prop.type ?? (prop.$ref ? (prop.$ref.split('/').pop() ?? '$ref') : 'object');
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

/** Render a schema's properties as table rows, resolving $ref recursively. */
function renderSchemaRows(
  schema: SchemaObject,
  doc: SwaggerDoc,
  borderStyle: string,
  requiredSet: Set<string>,
  prefix = '',
): string {
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) return '';
    return renderSchemaRows(
      resolved,
      doc,
      borderStyle,
      resolved.required ? new Set(resolved.required) : new Set<string>(),
      prefix,
    );
  }
  if (!schema.properties) return '';
  return Object.entries(schema.properties)
    .map(([name, prop]) => {
      const fieldPath = prefix ? `${prefix}.${name}` : name;
      const type = prop.type ?? (prop.$ref ? (prop.$ref.split('/').pop() ?? '$ref') : 'object');
      const nested = prop.properties || (prop.$ref ? resolveRef(prop.$ref, doc) : undefined)?.properties;
      let rows = `
    <tr>
      <td style="${borderStyle}">${escapeHtml(fieldPath)}</td>
      <td style="${borderStyle}">${escapeHtml(type)}${prop.items?.type ? `&lt;${escapeHtml(prop.items.type)}&gt;` : ''}</td>
      <td style="${borderStyle}">${requiredSet.has(name) ? 'Yes' : 'No'}</td>
      <td style="${borderStyle}">${escapeHtml(prop.description)}</td>
    </tr>`;
      if (nested || (prop.$ref && resolveRef(prop.$ref, doc)?.properties)) {
        const resolved = prop.$ref ? resolveRef(prop.$ref, doc) : prop;
        if (resolved?.properties) {
          const childRequired = resolved.required ? new Set(resolved.required) : new Set<string>();
          rows += renderSchemaRows(resolved, doc, borderStyle, childRequired, fieldPath);
        }
      }
      return rows;
    })
    .join('');
}

/** Render responses section for an operation (used by both HTML and Word exports). */
function renderResponseSection(op: OperationObject, doc: SwaggerDoc, borderStyle: string): string {
  const responses = op.responses;
  if (!responses || !Object.keys(responses).length) return '';

  const entries = Object.entries(responses);
  const parts: string[] = [];

  for (const [statusCode, resp] of entries) {
    const response = resp as ResponseObject;
    const desc = response.description ?? '';
    // Try OAS3 first, then OAS2
    const schema = response.content?.['application/json']?.schema ?? response.schema;

    if (schema) {
      let resolved = schema;
      if (schema.$ref) {
        const refResolved = resolveRef(schema.$ref, doc);
        if (refResolved) resolved = refResolved;
      }
      const requiredSet = new Set(resolved.required ?? []);
      const rows = renderSchemaRows(resolved, doc, borderStyle, requiredSet);
      if (rows) {
        parts.push(`
      <p style="margin:6px 0 2px;font-size:13px;font-weight:600;">Response ${escapeHtml(statusCode)}${desc ? ' — ' + escapeHtml(desc) : ''} (application/json)</p>
      <table style="width:100%;border-collapse:collapse;margin:4px 0;font-size:13px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="${borderStyle}text-align:left;">Field</th>
          <th style="${borderStyle}text-align:left;">Type</th>
          <th style="${borderStyle}text-align:left;">Required</th>
          <th style="${borderStyle}text-align:left;">Description</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
        continue;
      }
    }
    // No schema or no properties — just show status + description
    parts.push(
      `<p style="margin:6px 0 2px;font-size:13px;font-weight:600;">Response ${escapeHtml(statusCode)}${desc ? ' — ' + escapeHtml(desc) : ''}</p>`,
    );
  }

  return parts.length ? parts.join('') : '';
}

function renderOperation(path: string, method: string, op: OperationObject, doc: SwaggerDoc): string {
  const color = methodColor(method);
  const params = op.parameters ?? [];
  const bodyHtml = renderRequestBodyTable(op, doc, 'border:1px solid #ddd;padding:5px 8px;');
  return `
    <div style="margin:14px 0;border:1px solid #e8e8e8;border-radius:4px;overflow:hidden;">
      <div style="padding:8px 12px;background:#fafafa;display:flex;align-items:center;gap:10px;">
        <span style="background:${color};color:#fff;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:600;min-width:56px;text-align:center;">${escapeHtml(method.toUpperCase())}</span>
        <span style="font-family:monospace;font-size:14px;">${escapeHtml(path)}</span>
        ${op.deprecated ? '<span style="color:#f93e3e;font-size:12px;margin-left:8px;">[Deprecated]</span>' : ''}
      </div>
      ${op.summary ? `<div style="padding:5px 12px;font-size:14px;">${escapeHtml(op.summary)}</div>` : ''}
      ${op.description ? `<div style="padding:3px 12px;font-size:13px;color:#666;">${escapeHtml(op.description)}</div>` : ''}
      ${params.length ? `<div style="padding:5px 12px;">${renderParamTable(params)}</div>` : ''}
      ${bodyHtml ? `<div style="padding:5px 12px;">${bodyHtml}</div>` : ''}
      ${(() => {
        const r = renderResponseSection(op, doc, 'border:1px solid #ddd;padding:5px 8px;');
        return r ? `<div style="padding:5px 12px;">${r}</div>` : '';
      })()}
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
          const responseHtml = renderResponseSection(op.operation, doc, 'border:1px solid #000;padding:4px 6px;');
          return `
        <div style="margin:10px 0;padding:8px;border:1px solid #ccc;">
          <p style="margin:0 0 4px;"><strong style="color:${methodColor(op.method)};">[${escapeHtml(op.method.toUpperCase())}]</strong> <code>${escapeHtml(op.path)}</code>${op.operation.deprecated ? ' <em style="color:red;">[Deprecated]</em>' : ''}</p>
          ${op.operation.summary ? `<p style="margin:2px 0;font-size:13px;">${escapeHtml(op.operation.summary)}</p>` : ''}
          ${paramTable}
          ${bodyHtml}
          ${responseHtml}
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

// ─── docx helpers ────────────────────────────────────────────────

const THIN_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
};

function docxTextCell(text: string, opts?: { bold?: boolean; shading?: string }): DocxTableCell {
  return new DocxTableCell({
    borders: THIN_BORDER,
    width: { size: 25, type: WidthType.PERCENTAGE },
    shading: opts?.shading ? { type: ShadingType.SOLID, color: opts.shading } : undefined,
    children: [
      new DocxParagraph({
        children: [new TextRun({ text, bold: opts?.bold, size: 20 })],
        spacing: { before: 40, after: 40 },
      }),
    ],
  });
}

/** Build schema rows for docx table, resolving $ref recursively. */
function docxSchemaRows(schema: SchemaObject, doc: SwaggerDoc, requiredSet: Set<string>, prefix = ''): DocxTableRow[] {
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) return [];
    return docxSchemaRows(resolved, doc, resolved.required ? new Set(resolved.required) : new Set<string>(), prefix);
  }
  if (!schema.properties) return [];
  const rows: DocxTableRow[] = [];
  for (const [name, prop] of Object.entries(schema.properties)) {
    const fieldPath = prefix ? `${prefix}.${name}` : name;
    const type = prop.type ?? (prop.$ref ? (prop.$ref.split('/').pop() ?? '$ref') : 'object');
    const itemType = prop.items?.type ? `<${prop.items.type}>` : '';
    rows.push(
      new DocxTableRow({
        children: [
          docxTextCell(fieldPath),
          docxTextCell(`${type}${itemType}`),
          docxTextCell(requiredSet.has(name) ? 'Yes' : 'No'),
          docxTextCell(prop.description ?? ''),
        ],
      }),
    );
    // Recurse into nested objects
    const nested = prop.properties || (prop.$ref ? resolveRef(prop.$ref, doc) : undefined)?.properties;
    if (nested) {
      const resolved = prop.$ref ? resolveRef(prop.$ref, doc) : prop;
      if (resolved?.properties) {
        const childRequired = resolved.required ? new Set(resolved.required) : new Set<string>();
        rows.push(...docxSchemaRows(resolved, doc, childRequired, fieldPath));
      }
    }
  }
  return rows;
}

function docxParamRows(params: ParameterObject[]): DocxTableRow[] {
  return params.map(
    (p) =>
      new DocxTableRow({
        children: [
          docxTextCell(p.name),
          docxTextCell(p.in),
          docxTextCell(p.required ? 'Yes' : 'No'),
          docxTextCell(p.schema?.type ?? p.type ?? ''),
          docxTextCell(p.description ?? ''),
        ],
      }),
  );
}

function docxRequestBodySection(op: OperationObject, doc: SwaggerDoc): (DocxParagraph | DocxTable)[] {
  const rb = op.requestBody;
  if (!rb) return [];
  const jsonContent = rb.content?.['application/json'];
  if (!jsonContent?.schema) return [];
  let schema = jsonContent.schema;
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) return [];
    schema = resolved;
  }
  if (!schema.properties) return [];
  const requiredSet = new Set(schema.required ?? []);
  const headerRow = new DocxTableRow({
    children: [
      docxTextCell('Field', { bold: true, shading: 'f5f5f5' }),
      docxTextCell('Type', { bold: true, shading: 'f5f5f5' }),
      docxTextCell('Required', { bold: true, shading: 'f5f5f5' }),
      docxTextCell('Description', { bold: true, shading: 'f5f5f5' }),
    ],
  });
  const dataRows = docxSchemaRows(schema, doc, requiredSet);
  return [
    new DocxParagraph({
      children: [new TextRun({ text: 'Request Body (application/json)', bold: true, size: 22 })],
      spacing: { before: 120, after: 40 },
    }),
    new DocxTable({ rows: [headerRow, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } }),
  ];
}

function docxResponseSection(op: OperationObject, doc: SwaggerDoc): (DocxParagraph | DocxTable)[] {
  const responses = op.responses;
  if (!responses || !Object.keys(responses).length) return [];
  const children: (DocxParagraph | DocxTable)[] = [];
  for (const [statusCode, resp] of Object.entries(responses)) {
    const response = resp as ResponseObject;
    const desc = response.description ?? '';
    const schema = response.content?.['application/json']?.schema ?? response.schema;
    const label = desc ? `Response ${statusCode} — ${desc}` : `Response ${statusCode}`;
    if (schema) {
      let resolved = schema;
      if (schema.$ref) {
        const refResolved = resolveRef(schema.$ref, doc);
        if (refResolved) resolved = refResolved;
      }
      const requiredSet = new Set(resolved.required ?? []);
      const rows = docxSchemaRows(resolved, doc, requiredSet);
      if (rows.length) {
        const headerRow = new DocxTableRow({
          children: [
            docxTextCell('Field', { bold: true, shading: 'f5f5f5' }),
            docxTextCell('Type', { bold: true, shading: 'f5f5f5' }),
            docxTextCell('Required', { bold: true, shading: 'f5f5f5' }),
            docxTextCell('Description', { bold: true, shading: 'f5f5f5' }),
          ],
        });
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text: `${label} (application/json)`, bold: true, size: 22 })],
            spacing: { before: 120, after: 40 },
          }),
          new DocxTable({ rows: [headerRow, ...rows], width: { size: 100, type: WidthType.PERCENTAGE } }),
        );
        continue;
      }
    }
    children.push(
      new DocxParagraph({
        children: [new TextRun({ text: label, bold: true, size: 22 })],
        spacing: { before: 120, after: 40 },
      }),
    );
  }
  return children;
}

async function buildDocx(doc: SwaggerDoc, tags: MenuTag[]): Promise<Blob> {
  const children: (DocxParagraph | DocxTable)[] = [];

  // Title & info
  children.push(
    new DocxParagraph({
      text: doc.info.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  );
  children.push(new DocxParagraph({ children: [new TextRun({ text: `Version: ${doc.info.version}`, size: 22 })] }));
  if (doc.info.description) {
    children.push(
      new DocxParagraph({ children: [new TextRun({ text: `Description: ${doc.info.description}`, size: 22 })] }),
    );
  }
  children.push(new DocxParagraph({ text: '' })); // spacer

  for (const t of tags) {
    children.push(
      new DocxParagraph({
        text: t.tag,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 100 },
      }),
    );
    if (t.description) {
      children.push(
        new DocxParagraph({
          children: [new TextRun({ text: t.description, italics: true, color: '666666', size: 22 })],
          spacing: { after: 80 },
        }),
      );
    }

    for (const op of t.operations) {
      const method = op.method.toUpperCase();
      const path = op.path;
      // Method + Path heading
      children.push(
        new DocxParagraph({
          children: [
            new TextRun({ text: `[${method}] `, bold: true, color: methodColor(op.method).replace('#', ''), size: 24 }),
            new TextRun({ text: path, font: 'Courier New', size: 24 }),
            ...(op.operation.deprecated ? [new TextRun({ text: ' [Deprecated]', color: 'f93e3e', size: 22 })] : []),
          ],
          spacing: { before: 200, after: 60 },
        }),
      );
      if (op.operation.summary) {
        children.push(new DocxParagraph({ children: [new TextRun({ text: op.operation.summary, size: 22 })] }));
      }

      // Parameters table
      const params = op.operation.parameters ?? [];
      if (params.length) {
        const paramHeader = new DocxTableRow({
          children: [
            docxTextCell('Name', { bold: true, shading: 'f5f5f5' }),
            docxTextCell('In', { bold: true, shading: 'f5f5f5' }),
            docxTextCell('Required', { bold: true, shading: 'f5f5f5' }),
            docxTextCell('Type', { bold: true, shading: 'f5f5f5' }),
            docxTextCell('Description', { bold: true, shading: 'f5f5f5' }),
          ],
        });
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text: 'Parameters', bold: true, size: 22 })],
            spacing: { before: 80, after: 40 },
          }),
          new DocxTable({
            rows: [paramHeader, ...docxParamRows(params)],
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
        );
      }

      // Request body
      children.push(...docxRequestBodySection(op.operation, doc));

      // Responses
      children.push(...docxResponseSection(op.operation, doc));
    }
  }

  const document = new Document({
    sections: [{ children }],
  });

  return Packer.toBlob(document);
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

  async function handleDownloadDocx() {
    if (!swaggerDoc) return;
    const blob = await buildDocx(swaggerDoc, menuTags);
    const title = swaggerDoc.info.title || 'api-docs';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFilename(`${title}.docx`);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
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

      <Space size="middle" wrap>
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
          onClick={handleDownloadDocx}
          disabled={loading || !swaggerDoc || usingMock}
          loading={loading}
        >
          {t('officeDoc.btn.docx')}
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
