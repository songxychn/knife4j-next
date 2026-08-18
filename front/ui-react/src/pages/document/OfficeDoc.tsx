import { Button, Space, Typography, Alert } from 'antd';
import { FileTextOutlined, FileWordOutlined, FileMarkdownOutlined, CodeOutlined } from '@ant-design/icons';
import { generateApiMarkdown, type ApiMarkdownLabels } from 'knife4j-core';
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
  LevelFormat,
  LevelSuffix,
  ShadingType,
} from 'docx';
import { useGroup } from '../../context/GroupContext';
import { DEFAULT_LANGUAGE, normalizeSupportedLanguage } from '../../locales/language';
import type { SupportedLang } from '../../types/settings';
import type {
  SwaggerDoc,
  MenuTag,
  OperationObject,
  ParameterObject,
  ResponseObject,
  SchemaObject,
} from '../../types/swagger';
import { buildOfficeDocOutline, formatOfficeDocOutlineNumber } from './officeDocOutline';

const { Title, Paragraph } = Typography;

export interface OfficeDocLabels {
  language: SupportedLang;
  version: string;
  description: string;
  name: string;
  location: string;
  required: string;
  type: string;
  field: string;
  yes: string;
  no: string;
  requestBody: string;
  responses: string;
  response: string;
  statusCode: string;
  schema: string;
  deprecated: string;
  parameters: string;
  circularReference: string;
  fallbackTitle: string;
  markdown: ApiMarkdownLabels;
}

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

const CIRCULAR_REF_PLACEHOLDER = '... circular reference ...';
const MAX_FLATTEN_DEPTH = 30;

function localizedFieldValue(value: string, labels: OfficeDocLabels): string {
  return value === CIRCULAR_REF_PLACEHOLDER ? labels.circularReference : value;
}

function circularPlaceholder(prefix: string): FieldRow[] {
  return [
    {
      fieldPath: prefix || CIRCULAR_REF_PLACEHOLDER,
      typeDisplay: CIRCULAR_REF_PLACEHOLDER,
      required: false,
      description: '',
    },
  ];
}

/**
 * 把 schema 展开成字段行列表：
 *   object     -> 遍历 properties
 *   array      -> 进入 items；若 items 是 object 就展开字段（路径加 []）
 *   $ref       -> 先解 ref 再处理
 *   原子类型   -> 返回空数组，交给外部”Type:”行单独表达
 *
 * 循环引用保护：seenRefs 检测 $ref 环；depth > MAX_FLATTEN_DEPTH 时渲染占位节点。
 */
function flattenSchemaFields(
  schema: SchemaObject,
  doc: SwaggerDoc,
  prefix = '',
  requiredSet: Set<string> = new Set(),
  depth = 0,
  seenRefs: Set<string> = new Set(),
): FieldRow[] {
  if (depth > MAX_FLATTEN_DEPTH) return circularPlaceholder(prefix);

  if (schema.$ref) {
    if (seenRefs.has(schema.$ref)) return circularPlaceholder(prefix);
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

function renderParamTable(params: ParameterObject[], labels: OfficeDocLabels): string {
  if (!params.length) return '';
  const rows = params
    .map(
      (p) => `
    <tr>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.name)}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.in)}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${p.required ? labels.yes : labels.no}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(schemaDisplayType(p.schema) || p.type || '')}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.description)}</td>
    </tr>`,
    )
    .join('');
  return `
    <table style="width:100%;border-collapse:collapse;margin:8px 0;font-size:13px;">
      <thead><tr style="background:#f5f5f5;">
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">${labels.name}</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">${labels.location}</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">${labels.required}</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">${labels.type}</th>
        <th style="border:1px solid #ddd;padding:5px 8px;text-align:left;">${labels.description}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderFieldTable(rows: FieldRow[], borderStyle: string, labels: OfficeDocLabels): string {
  if (!rows.length) return '';
  const body = rows
    .map(
      (r) => `
    <tr>
      <td style="${borderStyle}">${escapeHtml(localizedFieldValue(r.fieldPath, labels))}</td>
      <td style="${borderStyle}">${escapeHtml(localizedFieldValue(r.typeDisplay, labels))}</td>
      <td style="${borderStyle}">${r.required ? labels.yes : labels.no}</td>
      <td style="${borderStyle}">${escapeHtml(r.description)}</td>
    </tr>`,
    )
    .join('');
  return `
    <table style="width:100%;border-collapse:collapse;margin:4px 0;font-size:13px;">
      <thead><tr style="background:#f5f5f5;">
        <th style="${borderStyle}text-align:left;">${labels.field}</th>
        <th style="${borderStyle}text-align:left;">${labels.type}</th>
        <th style="${borderStyle}text-align:left;">${labels.required}</th>
        <th style="${borderStyle}text-align:left;">${labels.description}</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderRequestBodySection(
  op: OperationObject,
  doc: SwaggerDoc,
  borderStyle: string,
  labels: OfficeDocLabels,
): string {
  const rb = op.requestBody;
  if (!rb) return '';
  const picked = pickContentSchema(rb.content);
  if (!picked) return '';
  const unwrapped = unwrapRef(picked.schema, doc);
  const rows = flattenSchemaFields(unwrapped, doc, '', new Set(unwrapped.required ?? []));
  const typeDisplay = schemaDisplayType(picked.schema);
  return `
    <p style="margin:6px 0 2px;font-size:13px;font-weight:600;">${labels.requestBody} (${escapeHtml(
      picked.mediaType,
    )}) &nbsp;<span style="font-weight:400;color:#555;">${labels.type}: <code>${escapeHtml(typeDisplay)}</code></span></p>
    ${rows.length ? renderFieldTable(rows, borderStyle, labels) : ''}`;
}

function renderResponseSection(
  op: OperationObject,
  doc: SwaggerDoc,
  borderStyle: string,
  labels: OfficeDocLabels,
): string {
  const responses = op.responses;
  if (!responses || !Object.keys(responses).length) return '';

  const parts: string[] = [`<p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${labels.responses}</p>`];
  parts.push(`
    <table style="width:100%;border-collapse:collapse;margin:4px 0 10px;font-size:13px;">
      <thead><tr style="background:#f5f5f5;">
        <th style="${borderStyle}text-align:left;width:90px;">${labels.statusCode}</th>
        <th style="${borderStyle}text-align:left;">${labels.description}</th>
        <th style="${borderStyle}text-align:left;width:220px;">${labels.schema}</th>
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
      <p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${labels.response} <code>${escapeHtml(
        code,
      )}</code> (${escapeHtml(
        picked.mediaType,
      )}) &nbsp;<span style="font-weight:400;color:#555;">${labels.type}: <code>${escapeHtml(
        schemaDisplayType(picked.schema),
      )}</code></span></p>
      ${renderFieldTable(rows, borderStyle, labels)}`);
  }

  return parts.join('');
}

function renderOperation(
  path: string,
  method: string,
  op: OperationObject,
  doc: SwaggerDoc,
  labels: OfficeDocLabels,
): string {
  const color = methodColor(method);
  const params = op.parameters ?? [];
  const bodyHtml = renderRequestBodySection(op, doc, 'border:1px solid #ddd;padding:5px 8px;', labels);
  const responseHtml = renderResponseSection(op, doc, 'border:1px solid #ddd;padding:5px 8px;', labels);
  return `
    <div style="margin:14px 0;border:1px solid #e8e8e8;border-radius:4px;overflow:hidden;">
      <div style="padding:8px 12px;background:#fafafa;display:flex;align-items:center;gap:10px;">
        <span style="background:${color};color:#fff;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:600;min-width:56px;text-align:center;">${escapeHtml(
          method.toUpperCase(),
        )}</span>
        <span style="font-family:monospace;font-size:14px;">${escapeHtml(path)}</span>
        ${op.deprecated ? `<span style="color:#f93e3e;font-size:12px;margin-left:8px;">[${labels.deprecated}]</span>` : ''}
      </div>
      ${op.summary ? `<div style="padding:5px 12px;font-size:14px;">${escapeHtml(op.summary)}</div>` : ''}
      ${
        op.description
          ? `<div style="padding:3px 12px;font-size:13px;color:#666;">${escapeHtml(op.description)}</div>`
          : ''
      }
      ${params.length ? `<div style="padding:5px 12px;">${renderParamTable(params, labels)}</div>` : ''}
      ${bodyHtml ? `<div style="padding:5px 12px;">${bodyHtml}</div>` : ''}
      ${responseHtml ? `<div style="padding:5px 12px;">${responseHtml}</div>` : ''}
    </div>`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildHtmlDoc(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): string {
  const sections = tags
    .map((t) => {
      const ops = t.operations.map((op) => renderOperation(op.path, op.method, op.operation, doc, labels)).join('');
      return `
      <div style="margin-bottom:28px;">
        <h2 style="border-left:4px solid #00ab6d;padding-left:10px;margin:20px 0 10px;">${escapeHtml(t.tag)}</h2>
        ${t.description ? `<p style="color:#666;margin-bottom:10px;">${escapeHtml(t.description)}</p>` : ''}
        ${ops}
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${labels.language}">
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
      <p><strong>${labels.version}:</strong> ${escapeHtml(doc.info.version)}</p>
      ${doc.info.description ? `<p><strong>${labels.description}:</strong> ${escapeHtml(doc.info.description)}</p>` : ''}
    </div>
    ${sections}
  </div>
</body>
</html>`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildWordDoc(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): string {
  const border = 'border:1px solid #000;padding:4px 6px;';
  const sections = buildOfficeDocOutline(tags)
    .map((outlineTag) => {
      const ops = outlineTag.operations
        .map((outlineOperation) => {
          const op = outlineOperation.operation;
          const params = op.operation.parameters ?? [];
          const paramRows = params
            .map(
              (p) => `
        <tr>
          <td style="${border}">${escapeHtml(p.name)}</td>
          <td style="${border}">${escapeHtml(p.in)}</td>
          <td style="${border}">${p.required ? labels.yes : labels.no}</td>
          <td style="${border}">${escapeHtml(schemaDisplayType(p.schema) || p.type || '')}</td>
          <td style="${border}">${escapeHtml(p.description)}</td>
        </tr>`,
            )
            .join('');
          const paramTable = params.length
            ? `
        <table style="width:100%;border-collapse:collapse;margin:6px 0;font-size:12px;">
          <thead><tr style="background:#e8e8e8;">
            <th style="${border}">${labels.name}</th>
            <th style="${border}">${labels.location}</th>
            <th style="${border}">${labels.required}</th>
            <th style="${border}">${labels.type}</th>
            <th style="${border}">${labels.description}</th>
          </tr></thead>
          <tbody>${paramRows}</tbody>
        </table>`
            : '';
          const bodyHtml = renderRequestBodySection(op.operation, doc, border, labels);
          const responseHtml = renderResponseSection(op.operation, doc, border, labels);
          return `
        <h2 style="margin:14px 0 6px;">${formatOfficeDocOutlineNumber(
          outlineOperation.numberPath,
        )} ${escapeHtml(outlineOperation.title)}</h2>
        <div style="margin:10px 0;padding:8px;border:1px solid #ccc;">
          <p style="margin:0 0 4px;"><strong style="color:${methodColor(op.method)};">[${escapeHtml(
            op.method.toUpperCase(),
          )}]</strong> <code>${escapeHtml(op.path)}</code>${
            op.operation.deprecated ? ` <em style="color:red;">[${labels.deprecated}]</em>` : ''
          }</p>
          ${paramTable}
          ${bodyHtml}
          ${responseHtml}
        </div>`;
        })
        .join('');
      return `
      <h1 style="border-left:4px solid #00ab6d;padding-left:8px;margin:20px 0 8px;">${formatOfficeDocOutlineNumber(
        outlineTag.numberPath,
      )} ${escapeHtml(outlineTag.tag.tag)}</h1>
      ${ops}`;
    })
    .join('');

  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">
<html lang="${labels.language}">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <title>${escapeHtml(doc.info.title)}</title>
  <style>
    body{font-family:Arial,"Yu Gothic","Microsoft YaHei",sans-serif;font-size:14px;margin:20px;}
    .document-title{text-align:center;font-size:28px;font-weight:bold;margin:0.67em 0;}
    code{font-family:monospace;}
  </style>
</head>
<body>
  <p class="document-title">${escapeHtml(doc.info.title)}</p>
  <p><strong>${labels.version}:</strong> ${escapeHtml(doc.info.version)}</p>
  ${doc.info.description ? `<p><strong>${labels.description}:</strong> ${escapeHtml(doc.info.description)}</p>` : ''}
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

function docxFieldTable(rows: FieldRow[], labels: OfficeDocLabels): DocxTable {
  const header = new DocxTableRow({
    children: [
      docxTextCell(labels.field, { bold: true, shading: 'f5f5f5' }),
      docxTextCell(labels.type, { bold: true, shading: 'f5f5f5' }),
      docxTextCell(labels.required, { bold: true, shading: 'f5f5f5' }),
      docxTextCell(labels.description, { bold: true, shading: 'f5f5f5' }),
    ],
  });
  const dataRows = rows.map(
    (r) =>
      new DocxTableRow({
        children: [
          docxTextCell(localizedFieldValue(r.fieldPath, labels)),
          docxTextCell(localizedFieldValue(r.typeDisplay, labels)),
          docxTextCell(r.required ? labels.yes : labels.no),
          docxTextCell(r.description),
        ],
      }),
  );
  return new DocxTable({ rows: [header, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

function docxParamRows(params: ParameterObject[], labels: OfficeDocLabels): DocxTableRow[] {
  return params.map(
    (p) =>
      new DocxTableRow({
        children: [
          docxTextCell(p.name),
          docxTextCell(p.in),
          docxTextCell(p.required ? labels.yes : labels.no),
          docxTextCell(schemaDisplayType(p.schema) || p.type || ''),
          docxTextCell(p.description ?? ''),
        ],
      }),
  );
}

function docxRequestBodySection(
  op: OperationObject,
  doc: SwaggerDoc,
  labels: OfficeDocLabels,
): (DocxParagraph | DocxTable)[] {
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
        new TextRun({ text: `${labels.requestBody} (${picked.mediaType})  `, bold: true, size: 22 }),
        new TextRun({ text: `${labels.type}: ${typeDisplay}`, size: 22 }),
      ],
      spacing: { before: 120, after: 40 },
    }),
  ];
  if (rows.length) children.push(docxFieldTable(rows, labels));
  return children;
}

function docxResponseSection(
  op: OperationObject,
  doc: SwaggerDoc,
  labels: OfficeDocLabels,
): (DocxParagraph | DocxTable)[] {
  const responses = op.responses;
  if (!responses || !Object.keys(responses).length) return [];

  const children: (DocxParagraph | DocxTable)[] = [
    new DocxParagraph({
      children: [new TextRun({ text: labels.responses, bold: true, size: 22 })],
      spacing: { before: 160, after: 40 },
    }),
  ];

  const summaryHeader = new DocxTableRow({
    children: [
      docxTextCell(labels.statusCode, { bold: true, shading: 'f5f5f5' }),
      docxTextCell(labels.description, { bold: true, shading: 'f5f5f5' }),
      docxTextCell(labels.schema, { bold: true, shading: 'f5f5f5' }),
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
          new TextRun({ text: `${labels.response} ${code} (${picked.mediaType})  `, bold: true, size: 22 }),
          new TextRun({ text: `${labels.type}: ${schemaDisplayType(picked.schema)}`, size: 22 }),
        ],
        spacing: { before: 120, after: 40 },
      }),
      docxFieldTable(rows, labels),
    );
  }

  return children;
}

// eslint-disable-next-line react-refresh/only-export-components
export async function buildDocx(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): Promise<Blob> {
  const children: (DocxParagraph | DocxTable)[] = [];
  const outline = buildOfficeDocOutline(tags);

  children.push(
    new DocxParagraph({
      text: doc.info.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  );
  children.push(
    new DocxParagraph({
      children: [new TextRun({ text: `${labels.version}: ${doc.info.version}`, size: 22 })],
    }),
  );
  if (doc.info.description) {
    children.push(
      new DocxParagraph({
        children: [new TextRun({ text: `${labels.description}: ${doc.info.description}`, size: 22 })],
      }),
    );
  }
  children.push(new DocxParagraph({ text: '' }));

  for (const outlineTag of outline) {
    children.push(
      new DocxParagraph({
        text: outlineTag.tag.tag,
        heading: HeadingLevel.HEADING_1,
        numbering: { reference: 'api-outline', level: 0 },
        spacing: { before: 300, after: 100 },
      }),
    );
    if (outlineTag.tag.description) {
      children.push(
        new DocxParagraph({
          children: [new TextRun({ text: outlineTag.tag.description, italics: true, color: '666666', size: 22 })],
          spacing: { after: 80 },
        }),
      );
    }

    for (const outlineOperation of outlineTag.operations) {
      const op = outlineOperation.operation;
      const method = op.method.toUpperCase();
      children.push(
        new DocxParagraph({
          text: outlineOperation.title,
          heading: HeadingLevel.HEADING_2,
          numbering: { reference: 'api-outline', level: 1 },
          spacing: { before: 200, after: 60 },
        }),
        new DocxParagraph({
          children: [
            new TextRun({ text: `[${method}] `, bold: true, color: methodColor(op.method).replace('#', ''), size: 24 }),
            new TextRun({ text: op.path, font: 'Courier New', size: 24 }),
            ...(op.operation.deprecated
              ? [new TextRun({ text: ` [${labels.deprecated}]`, color: 'f93e3e', size: 22 })]
              : []),
          ],
          spacing: { after: 60 },
        }),
      );

      const params = op.operation.parameters ?? [];
      if (params.length) {
        const paramHeader = new DocxTableRow({
          children: [
            docxTextCell(labels.name, { bold: true, shading: 'f5f5f5' }),
            docxTextCell(labels.location, { bold: true, shading: 'f5f5f5' }),
            docxTextCell(labels.required, { bold: true, shading: 'f5f5f5' }),
            docxTextCell(labels.type, { bold: true, shading: 'f5f5f5' }),
            docxTextCell(labels.description, { bold: true, shading: 'f5f5f5' }),
          ],
        });
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text: labels.parameters, bold: true, size: 22 })],
            spacing: { before: 80, after: 40 },
          }),
          new DocxTable({
            rows: [paramHeader, ...docxParamRows(params, labels)],
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
        );
      }

      children.push(...docxRequestBodySection(op.operation, doc, labels));
      children.push(...docxResponseSection(op.operation, doc, labels));
    }
  }

  const document = new Document({
    numbering: {
      config: [
        {
          reference: 'api-outline',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1',
              alignment: AlignmentType.START,
              suffix: LevelSuffix.SPACE,
              style: { style: HeadingLevel.HEADING_1 },
            },
            {
              level: 1,
              format: LevelFormat.DECIMAL,
              text: '%1.%2',
              alignment: AlignmentType.START,
              suffix: LevelSuffix.SPACE,
              style: { style: HeadingLevel.HEADING_2 },
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBlob(document);
}

/**
 * Build a full-document Markdown string by iterating all tags and operations.
 * Reuses generateApiMarkdown from knife4j-core (shared with TASK-042 copy action).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function buildMarkdownDoc(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): string {
  const sections: string[] = [];
  sections.push(`# ${doc.info.title || labels.fallbackTitle}`);
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
        labels: labels.markdown,
      });
      sections.push(md);
      sections.push('---');
      sections.push('');
    }
  }

  return sections.join('\n');
}

export default function OfficeDoc() {
  const { t, i18n } = useTranslation();
  const { swaggerDoc, menuTags, loading, usingMock } = useGroup();
  const labels: OfficeDocLabels = {
    language: normalizeSupportedLanguage(i18n.language) ?? DEFAULT_LANGUAGE,
    version: t('home.version'),
    description: t('home.description'),
    name: t('apiDoc.col.paramName'),
    location: t('apiDoc.col.location'),
    required: t('apiDoc.col.required'),
    type: t('apiDoc.col.type'),
    field: t('schema.col.fieldName'),
    yes: t('schema.required.yes'),
    no: t('schema.required.no'),
    requestBody: t('apiDoc.requestBody'),
    responses: t('apiDoc.responseStructure'),
    response: t('officeDoc.response'),
    statusCode: t('apiDoc.col.statusCode'),
    schema: t('apiDoc.col.schema'),
    deprecated: t('apiDoc.deprecated'),
    parameters: t('apiDoc.requestParams'),
    circularReference: t('officeDoc.circularReference'),
    fallbackTitle: t('officeDoc.fallbackTitle'),
    markdown: {
      deprecated: t('apiDoc.markdown.deprecated'),
      requestParameters: t('apiDoc.requestParams'),
      noRequestParameters: t('apiDoc.noParams'),
      requestBody: t('apiDoc.requestBody'),
      noRequestBody: t('apiDoc.noBody'),
      requestBodyNotExpandable: t('apiDoc.body.notExpandable'),
      responseStructure: t('apiDoc.responseStructure'),
      noResponse: t('apiDoc.noResponse'),
      name: t('apiDoc.col.paramName'),
      location: t('apiDoc.col.location'),
      type: t('apiDoc.col.type'),
      required: t('apiDoc.col.required'),
      description: t('apiDoc.col.description'),
      field: t('apiDoc.col.fieldName'),
      yes: t('schema.required.yes'),
      no: t('schema.required.no'),
      status: t('apiDoc.col.statusCode'),
      schema: t('apiDoc.col.schema'),
    },
  };

  function handleDownloadHtml() {
    if (!swaggerDoc) return;
    const html = buildHtmlDoc(swaggerDoc, menuTags, labels);
    const title = swaggerDoc.info.title || 'api-docs';
    downloadBlob(html, `${title}.html`, 'text/html;charset=utf-8');
  }

  function handleDownloadWord() {
    if (!swaggerDoc) return;
    const html = buildWordDoc(swaggerDoc, menuTags, labels);
    const title = swaggerDoc.info.title || 'api-docs';
    downloadBlob(html, `${title}.doc`, 'application/msword');
  }

  async function handleDownloadDocx() {
    if (!swaggerDoc) return;
    const blob = await buildDocx(swaggerDoc, menuTags, labels);
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
    const md = buildMarkdownDoc(swaggerDoc, menuTags, labels);
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
