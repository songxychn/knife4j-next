import { Button, Space, Typography, Alert } from 'antd';
import { FileTextOutlined, FileWordOutlined, FileMarkdownOutlined, CodeOutlined } from '@ant-design/icons';
import { generateApiMarkdown } from 'knife4j-core';
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

function resolveRef(ref: string, doc: SwaggerDoc): SchemaObject | undefined {
  const match = ref.match(/^#\/components\/schemas\/(.+)$/) ?? ref.match(/^#\/definitions\/(.+)$/);
  if (!match) return undefined;
  return (doc.components?.schemas ?? (doc.definitions as Record<string, SchemaObject> | undefined) ?? {})[match[1]];
}

/**
 * 根据 schema 推导出可读类型名。
 *   $ref  -> "UserVO"
 *   array -> "UserVO[]" / "string[]"
 *   原子  -> "string / int32" / "integer"
 *   其他  -> "object"
 */
function schemaDisplayType(schema?: SchemaObject): string {
  if (!schema) return '';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? '$ref';
  if (schema.type === 'array') {
    const inner = schemaDisplayType(schema.items);
    return `${inner || 'object'}[]`;
  }
  const parts = [schema.type, schema.format].filter(Boolean);
  return parts.length ? parts.join(' / ') : 'object';
}

/**
 * 从 content 里挑一个可展示的 schema：优先 application/json，否则第一个带 schema 的 entry；
 * 兜底 OAS2 的 response.schema / requestBody.schema。
 */
function pickContentSchema(
  content: Record<string, { schema?: SchemaObject }> | undefined,
  fallback?: SchemaObject,
): { mediaType: string; schema: SchemaObject } | undefined {
  if (content) {
    const json = content['application/json'];
    if (json?.schema) return { mediaType: 'application/json', schema: json.schema };
    for (const [mediaType, entry] of Object.entries(content)) {
      if (entry?.schema) return { mediaType, schema: entry.schema };
    }
  }
  if (fallback) return { mediaType: 'application/json', schema: fallback };
  return undefined;
}

/** 循环解 $ref，防止自引用死循环。 */
function unwrapRef(schema: SchemaObject, doc: SwaggerDoc, seen: Set<string> = new Set()): SchemaObject {
  let current = schema;
  while (current.$ref) {
    if (seen.has(current.$ref)) return current;
    seen.add(current.$ref);
    const resolved = resolveRef(current.$ref, doc);
    if (!resolved) return current;
    current = resolved;
  }
  return current;
}

interface FieldRow {
  fieldPath: string;
  typeDisplay: string;
  required: boolean;
  description: string;
}

/**
 * 把 schema 展开成字段行列表：
 *   object     -> 遍历 properties
 *   array      -> 进入 items；若 items 是 object 就展开字段（路径加 []）
 *   $ref       -> 先解 ref 再处理
 *   原子类型   -> 返回空数组，交给外部“Type:”行单独表达
 */
function flattenSchemaFields(
  schema: SchemaObject,
  doc: SwaggerDoc,
  prefix = '',
  requiredSet: Set<string> = new Set(),
  depth = 0,
  seenRefs: Set<string> = new Set(),
): FieldRow[] {
  if (depth > 6) return [];

  if (schema.$ref) {
    if (seenRefs.has(schema.$ref)) return [];
    const nextSeen = new Set(seenRefs);
    nextSeen.add(schema.$ref);
    const resolved = resolveRef(schema.$ref, doc);
    if (!resolved) return [];
    return flattenSchemaFields(
      resolved,
      doc,
      prefix,
      resolved.required ? new Set(resolved.required) : new Set<string>(),
      depth,
      nextSeen,
    );
  }

  if (schema.type === 'array' && schema.items) {
    return flattenSchemaFields(schema.items, doc, prefix, requiredSet, depth, seenRefs);
  }

  const rows: FieldRow[] = [];
  if (!schema.properties) return rows;

  for (const [name, prop] of Object.entries(schema.properties)) {
    const fieldPath = prefix ? `${prefix}.${name}` : name;
    rows.push({
      fieldPath,
      typeDisplay: schemaDisplayType(prop),
      required: requiredSet.has(name),
      description: prop.description ?? '',
    });

    const nextSeen = new Set(seenRefs);
    if (prop.$ref) nextSeen.add(prop.$ref);
    const resolvedProp = prop.$ref ? unwrapRef(prop, doc, new Set(seenRefs)) : prop;
    if (!resolvedProp) continue;

    if (resolvedProp.properties) {
      rows.push(
        ...flattenSchemaFields(resolvedProp, doc, fieldPath, new Set(resolvedProp.required ?? []), depth + 1, nextSeen),
      );
    } else if (resolvedProp.type === 'array' && resolvedProp.items) {
      const itemSchema = resolvedProp.items.$ref
        ? unwrapRef(resolvedProp.items, doc, new Set(nextSeen))
        : resolvedProp.items;
      if (itemSchema?.properties) {
        rows.push(
          ...flattenSchemaFields(
            itemSchema,
            doc,
            `${fieldPath}[]`,
            new Set(itemSchema.required ?? []),
            depth + 1,
            nextSeen,
          ),
        );
      }
    }
  }
  return rows;
}

// ─── HTML renderers ─────────────────────────────────────────────────────────

function renderParamTable(params: ParameterObject[]): string {
  if (!params.length) return '';
  const rows = params
    .map(
      (p) => `
    <tr>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.name)}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.in)}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${p.required ? 'Yes' : 'No'}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(schemaDisplayType(p.schema) || p.type || '')}</td>
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

function renderFieldTable(rows: FieldRow[], borderStyle: string): string {
  if (!rows.length) return '';
  const body = rows
    .map(
      (r) => `
    <tr>
      <td style="${borderStyle}">${escapeHtml(r.fieldPath)}</td>
      <td style="${borderStyle}">${escapeHtml(r.typeDisplay)}</td>
      <td style="${borderStyle}">${r.required ? 'Yes' : 'No'}</td>
      <td style="${borderStyle}">${escapeHtml(r.description)}</td>
    </tr>`,
    )
    .join('');
  return `
    <table style="width:100%;border-collapse:collapse;margin:4px 0;font-size:13px;">
      <thead><tr style="background:#f5f5f5;">
        <th style="${borderStyle}text-align:left;">Field</th>
        <th style="${borderStyle}text-align:left;">Type</th>
        <th style="${borderStyle}text-align:left;">Required</th>
        <th style="${borderStyle}text-align:left;">Description</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderRequestBodySection(op: OperationObject, doc: SwaggerDoc, borderStyle: string): string {
  const rb = op.requestBody;
  if (!rb) return '';
  const picked = pickContentSchema(rb.content);
  if (!picked) return '';
  const unwrapped = unwrapRef(picked.schema, doc);
  const rows = flattenSchemaFields(unwrapped, doc, '', new Set(unwrapped.required ?? []));
  const typeDisplay = schemaDisplayType(picked.schema);
  return `
    <p style="margin:6px 0 2px;font-size:13px;font-weight:600;">Request Body (${escapeHtml(picked.mediaType)}) &nbsp;<span style="font-weight:400;color:#555;">Type: <code>${escapeHtml(typeDisplay)}</code></span></p>
    ${rows.length ? renderFieldTable(rows, borderStyle) : ''}`;
}

function renderResponseSection(op: OperationObject, doc: SwaggerDoc, borderStyle: string): string {
  const responses = op.responses;
  if (!responses || !Object.keys(responses).length) return '';

  const parts: string[] = ['<p style="margin:8px 0 2px;font-size:13px;font-weight:600;">Responses</p>'];
  parts.push(`
    <table style="width:100%;border-collapse:collapse;margin:4px 0 10px;font-size:13px;">
      <thead><tr style="background:#f5f5f5;">
        <th style="${borderStyle}text-align:left;width:90px;">Code</th>
        <th style="${borderStyle}text-align:left;">Description</th>
        <th style="${borderStyle}text-align:left;width:220px;">Schema</th>
      </tr></thead>
      <tbody>
        ${Object.entries(responses)
          .map(([code, resp]) => {
            const r = resp as ResponseObject;
            const picked = pickContentSchema(r.content, r.schema);
            const typeDisplay = picked ? schemaDisplayType(picked.schema) : '—';
            return `<tr>
              <td style="${borderStyle}"><code>${escapeHtml(code)}</code></td>
              <td style="${borderStyle}">${escapeHtml(r.description ?? '')}</td>
              <td style="${borderStyle}"><code>${escapeHtml(typeDisplay)}</code></td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>`);

  for (const [code, resp] of Object.entries(responses)) {
    const r = resp as ResponseObject;
    const picked = pickContentSchema(r.content, r.schema);
    if (!picked) continue;
    const unwrapped = unwrapRef(picked.schema, doc);
    const rows = flattenSchemaFields(unwrapped, doc, '', new Set(unwrapped.required ?? []));
    if (!rows.length) continue;
    parts.push(`
      <p style="margin:8px 0 2px;font-size:13px;font-weight:600;">Response <code>${escapeHtml(code)}</code> (${escapeHtml(picked.mediaType)}) &nbsp;<span style="font-weight:400;color:#555;">Type: <code>${escapeHtml(schemaDisplayType(picked.schema))}</code></span></p>
      ${renderFieldTable(rows, borderStyle)}`);
  }

  return parts.join('');
}

function renderOperation(path: string, method: string, op: OperationObject, doc: SwaggerDoc): string {
  const color = methodColor(method);
  const params = op.parameters ?? [];
  const bodyHtml = renderRequestBodySection(op, doc, 'border:1px solid #ddd;padding:5px 8px;');
  const responseHtml = renderResponseSection(op, doc, 'border:1px solid #ddd;padding:5px 8px;');
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
      ${responseHtml ? `<div style="padding:5px 12px;">${responseHtml}</div>` : ''}
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
    code{background:#f5f5f5;padding:1px 4px;border-radius:3px;font-size:12px;}
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
  const border = 'border:1px solid #000;padding:4px 6px;';
  const sections = tags
    .map((t) => {
      const ops = t.operations
        .map((op) => {
          const params = op.operation.parameters ?? [];
          const paramRows = params
            .map(
              (p) => `
        <tr>
          <td style="${border}">${escapeHtml(p.name)}</td>
          <td style="${border}">${escapeHtml(p.in)}</td>
          <td style="${border}">${p.required ? 'Yes' : 'No'}</td>
          <td style="${border}">${escapeHtml(schemaDisplayType(p.schema) || p.type || '')}</td>
          <td style="${border}">${escapeHtml(p.description)}</td>
        </tr>`,
            )
            .join('');
          const paramTable = params.length
            ? `
        <table style="width:100%;border-collapse:collapse;margin:6px 0;font-size:12px;">
          <thead><tr style="background:#e8e8e8;">
            <th style="${border}">Name</th>
            <th style="${border}">In</th>
            <th style="${border}">Required</th>
            <th style="${border}">Type</th>
            <th style="${border}">Description</th>
          </tr></thead>
          <tbody>${paramRows}</tbody>
        </table>`
            : '';
          const bodyHtml = renderRequestBodySection(op.operation, doc, border);
          const responseHtml = renderResponseSection(op.operation, doc, border);
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

// ─── docx helpers ───────────────────────────────────────────────────────────

const THIN_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
  right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
};

function docxTextCell(text: string, opts?: { bold?: boolean; shading?: string }): DocxTableCell {
  return new DocxTableCell({
    borders: THIN_BORDER,
    shading: opts?.shading ? { type: ShadingType.SOLID, color: opts.shading } : undefined,
    children: [
      new DocxParagraph({
        children: [new TextRun({ text, bold: opts?.bold, size: 20 })],
        spacing: { before: 40, after: 40 },
      }),
    ],
  });
}

function docxFieldTable(rows: FieldRow[]): DocxTable {
  const header = new DocxTableRow({
    children: [
      docxTextCell('Field', { bold: true, shading: 'f5f5f5' }),
      docxTextCell('Type', { bold: true, shading: 'f5f5f5' }),
      docxTextCell('Required', { bold: true, shading: 'f5f5f5' }),
      docxTextCell('Description', { bold: true, shading: 'f5f5f5' }),
    ],
  });
  const dataRows = rows.map(
    (r) =>
      new DocxTableRow({
        children: [
          docxTextCell(r.fieldPath),
          docxTextCell(r.typeDisplay),
          docxTextCell(r.required ? 'Yes' : 'No'),
          docxTextCell(r.description),
        ],
      }),
  );
  return new DocxTable({ rows: [header, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

function docxParamRows(params: ParameterObject[]): DocxTableRow[] {
  return params.map(
    (p) =>
      new DocxTableRow({
        children: [
          docxTextCell(p.name),
          docxTextCell(p.in),
          docxTextCell(p.required ? 'Yes' : 'No'),
          docxTextCell(schemaDisplayType(p.schema) || p.type || ''),
          docxTextCell(p.description ?? ''),
        ],
      }),
  );
}

function docxRequestBodySection(op: OperationObject, doc: SwaggerDoc): (DocxParagraph | DocxTable)[] {
  const rb = op.requestBody;
  if (!rb) return [];
  const picked = pickContentSchema(rb.content);
  if (!picked) return [];
  const unwrapped = unwrapRef(picked.schema, doc);
  const rows = flattenSchemaFields(unwrapped, doc, '', new Set(unwrapped.required ?? []));
  const typeDisplay = schemaDisplayType(picked.schema);
  const children: (DocxParagraph | DocxTable)[] = [
    new DocxParagraph({
      children: [
        new TextRun({ text: `Request Body (${picked.mediaType})  `, bold: true, size: 22 }),
        new TextRun({ text: `Type: ${typeDisplay}`, size: 22 }),
      ],
      spacing: { before: 120, after: 40 },
    }),
  ];
  if (rows.length) children.push(docxFieldTable(rows));
  return children;
}

function docxResponseSection(op: OperationObject, doc: SwaggerDoc): (DocxParagraph | DocxTable)[] {
  const responses = op.responses;
  if (!responses || !Object.keys(responses).length) return [];

  const children: (DocxParagraph | DocxTable)[] = [
    new DocxParagraph({
      children: [new TextRun({ text: 'Responses', bold: true, size: 22 })],
      spacing: { before: 160, after: 40 },
    }),
  ];

  const summaryHeader = new DocxTableRow({
    children: [
      docxTextCell('Code', { bold: true, shading: 'f5f5f5' }),
      docxTextCell('Description', { bold: true, shading: 'f5f5f5' }),
      docxTextCell('Schema', { bold: true, shading: 'f5f5f5' }),
    ],
  });
  const summaryRows = Object.entries(responses).map(([code, resp]) => {
    const r = resp as ResponseObject;
    const picked = pickContentSchema(r.content, r.schema);
    const typeDisplay = picked ? schemaDisplayType(picked.schema) : '—';
    return new DocxTableRow({
      children: [docxTextCell(code), docxTextCell(r.description ?? ''), docxTextCell(typeDisplay)],
    });
  });
  children.push(
    new DocxTable({
      rows: [summaryHeader, ...summaryRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
  );

  for (const [code, resp] of Object.entries(responses)) {
    const r = resp as ResponseObject;
    const picked = pickContentSchema(r.content, r.schema);
    if (!picked) continue;
    const unwrapped = unwrapRef(picked.schema, doc);
    const rows = flattenSchemaFields(unwrapped, doc, '', new Set(unwrapped.required ?? []));
    if (!rows.length) continue;
    children.push(
      new DocxParagraph({
        children: [
          new TextRun({ text: `Response ${code} (${picked.mediaType})  `, bold: true, size: 22 }),
          new TextRun({ text: `Type: ${schemaDisplayType(picked.schema)}`, size: 22 }),
        ],
        spacing: { before: 120, after: 40 },
      }),
      docxFieldTable(rows),
    );
  }

  return children;
}

async function buildDocx(doc: SwaggerDoc, tags: MenuTag[]): Promise<Blob> {
  const children: (DocxParagraph | DocxTable)[] = [];

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
  children.push(new DocxParagraph({ text: '' }));

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
      children.push(
        new DocxParagraph({
          children: [
            new TextRun({ text: `[${method}] `, bold: true, color: methodColor(op.method).replace('#', ''), size: 24 }),
            new TextRun({ text: op.path, font: 'Courier New', size: 24 }),
            ...(op.operation.deprecated ? [new TextRun({ text: ' [Deprecated]', color: 'f93e3e', size: 22 })] : []),
          ],
          spacing: { before: 200, after: 60 },
        }),
      );
      if (op.operation.summary) {
        children.push(new DocxParagraph({ children: [new TextRun({ text: op.operation.summary, size: 22 })] }));
      }

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

      children.push(...docxRequestBodySection(op.operation, doc));
      children.push(...docxResponseSection(op.operation, doc));
    }
  }

  const document = new Document({ sections: [{ children }] });
  return Packer.toBlob(document);
}

/**
 * Build a full-document Markdown string by iterating all tags and operations.
 * Reuses generateApiMarkdown from knife4j-core (shared with TASK-042 copy action).
 */
function buildMarkdownDoc(doc: SwaggerDoc, tags: MenuTag[]): string {
  const sections: string[] = [];
  sections.push(`# ${doc.info.title || 'API Documentation'}`);
  if (doc.info.description) {
    sections.push('');
    sections.push(doc.info.description);
  }
  sections.push('');

  for (const tag of tags) {
    sections.push(`## ${tag.tag}`);
    if (tag.description) sections.push(tag.description);
    sections.push('');

    for (const op of tag.operations ?? []) {
      const md = generateApiMarkdown({
        method: op.method.toUpperCase(),
        path: op.path,
        operation: op.operation as Parameters<typeof generateApiMarkdown>[0]['operation'],
        docContext: doc,
      });
      sections.push(md);
      sections.push('---');
      sections.push('');
    }
  }

  return sections.join('\n');
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

  function handleDownloadMarkdown() {
    if (!swaggerDoc) return;
    const md = buildMarkdownDoc(swaggerDoc, menuTags);
    const title = swaggerDoc.info.title || 'api-docs';
    downloadBlob(md, `${title}.md`, 'text/markdown;charset=utf-8');
  }

  function handleDownloadOpenApiJson() {
    if (!swaggerDoc) return;
    const title = swaggerDoc.info.title || 'api-docs';
    downloadBlob(JSON.stringify(swaggerDoc, null, 2), `${title}.openapi.json`, 'application/json;charset=utf-8');
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
        <Button
          icon={<FileMarkdownOutlined />}
          onClick={handleDownloadMarkdown}
          disabled={loading || !swaggerDoc || usingMock}
          loading={loading}
        >
          {t('officeDoc.btn.markdown')}
        </Button>
        <Button
          icon={<CodeOutlined />}
          onClick={handleDownloadOpenApiJson}
          disabled={loading || !swaggerDoc || usingMock}
          loading={loading}
        >
          {t('officeDoc.btn.openapi')}
        </Button>
      </Space>
    </div>
  );
}
