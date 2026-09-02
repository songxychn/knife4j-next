import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Space, Typography, Alert, Modal, message } from 'antd';
import { FileTextOutlined, FileWordOutlined, FileMarkdownOutlined, CodeOutlined } from '@ant-design/icons';
import {
  buildExportDocument,
  renderExportDocumentMarkdown,
  type ApiMarkdownLabels,
  type ExportOperation,
  type ExportParameter,
  type ExportRequestBody,
  type ExportResponse,
  type ExportSchemaField,
} from 'knife4j-core';
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
import { useExternalResources, useSchemaEngine } from '../../context/SchemaEngineContext';
import { DEFAULT_LANGUAGE, normalizeSupportedLanguage } from '../../locales/language';
import { isOas31SchemaDocument } from '../../schema/schemaDocumentSession';
import type { SupportedLang } from '../../types/settings';
import type { SwaggerDoc, MenuTag } from '../../types/swagger';
import {
  createOfflineDocumentSnapshot,
  incompleteOfflineDocumentIssues,
  runOfflineDocumentExportTask,
  type OfflineDocumentIssue,
  type OfflineDocumentSnapshot,
} from './offlineDocumentSnapshot';
import { buildOas31ExportSnapshot, Oas31ExportBudgetError } from './oas31ExportSnapshot';

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
  requestExample: string;
  mediaType: string;
  responses: string;
  response: string;
  responseExample: string;
  statusCode: string;
  schema: string;
  deprecated: string;
  parameters: string;
  circularReference: string;
  truncated?: string;
  fallbackTitle: string;
  incompleteTitle?: string;
  incompleteSummary?: (count: number) => string;
  incompleteMore?: (count: number) => string;
  markdown: ApiMarkdownLabels;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'document';
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  downloadPreparedBlob(blob, filename);
}

function downloadPreparedBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function escapeHtml(s: string | undefined | null): string {
  if (s === undefined || s === null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeMarkdownInline(value: string): string {
  return value
    .replace(/\r\n?|\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/([`*[\]<>|])/g, '\\$1');
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

function buildDocumentSnapshot(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): OfflineDocumentSnapshot {
  return createOfflineDocumentSnapshot(buildExportDocument(doc, tags, { fallbackTitle: labels.fallbackTitle }));
}

const MAX_RENDERED_EXPORT_ISSUES = 20;

function renderedExportIssueLines(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): string[] {
  const issues = incompleteOfflineDocumentIssues(snapshot);
  const visible = issues.slice(0, MAX_RENDERED_EXPORT_ISSUES).map((issue) => {
    const diagnostic = issue.keyword ? `${issue.code} (${issue.keyword})` : issue.code;
    return [issue.operation, issue.region, diagnostic].filter(Boolean).join(' · ');
  });
  const remaining = issues.length - visible.length;
  if (remaining > 0) visible.push(labels.incompleteMore?.(remaining) ?? `${remaining} more issue(s)`);
  return visible;
}

function incompleteExportTitle(labels: OfficeDocLabels): string {
  return labels.incompleteTitle ?? 'Incomplete OAS 3.1 export';
}

function incompleteExportSummary(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): string {
  const count = incompleteOfflineDocumentIssues(snapshot).length;
  return labels.incompleteSummary?.(count) ?? `${count} semantic issue(s) could not be represented completely.`;
}

function renderIncompleteHtml(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): string {
  if (snapshot.complete) return '';
  const issues = renderedExportIssueLines(snapshot, labels)
    .map((issue) => `<li>${escapeHtml(issue)}</li>`)
    .join('');
  return `<div class="export-incomplete" role="alert">
    <strong>${escapeHtml(incompleteExportTitle(labels))}</strong>
    <p>${escapeHtml(incompleteExportSummary(snapshot, labels))}</p>
    <ul>${issues}</ul>
  </div>`;
}

function formatOutlineNumber(numberPath: readonly number[]): string {
  return numberPath.join('.');
}

function fieldPath(field: ExportSchemaField, labels: OfficeDocLabels): string {
  if (field.fieldPath || !field.truncated) return field.fieldPath;
  return field.truncationReason && field.truncationReason !== 'circular-reference'
    ? (labels.truncated ?? labels.circularReference)
    : labels.circularReference;
}

function fieldType(field: ExportSchemaField, labels: OfficeDocLabels): string {
  if (!field.truncated) return field.typeDisplay;
  if (field.truncationReason === undefined || field.truncationReason === 'circular-reference') {
    return labels.circularReference;
  }
  const marker = labels.truncated ?? labels.circularReference;
  return `${field.typeDisplay || 'object'} (${marker})`;
}

// ─── HTML renderers ─────────────────────────────────────────────────────────

function renderParamTable(params: readonly ExportParameter[], labels: OfficeDocLabels): string {
  if (!params.length) return '';
  const rows = params
    .map(
      (p) => `
    <tr>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.name)}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.location)}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${p.required ? labels.yes : labels.no}</td>
      <td style="border:1px solid #ddd;padding:5px 8px;">${escapeHtml(p.typeDisplay)}</td>
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

function renderFieldTable(rows: readonly ExportSchemaField[], borderStyle: string, labels: OfficeDocLabels): string {
  if (!rows.length) return '';
  const body = rows
    .map(
      (r) => `
    <tr>
      <td style="${borderStyle}">${escapeHtml(fieldPath(r, labels))}</td>
      <td style="${borderStyle}">${escapeHtml(fieldType(r, labels))}</td>
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

function renderHtmlExample(label: string, mediaType: string, value: string, statusCode?: string): string {
  return `
    <p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${label}${
      statusCode !== undefined ? ` <code>${escapeHtml(statusCode)}</code>` : ''
    } (${escapeHtml(mediaType)})</p>
    <pre style="margin:4px 0;padding:8px;background:#f5f5f5;white-space:pre-wrap;overflow-wrap:anywhere;font-family:monospace;font-size:12px;">${escapeHtml(
      value,
    )}</pre>`;
}

function renderRequestBodySection(
  requestBody: ExportRequestBody | undefined,
  borderStyle: string,
  labels: OfficeDocLabels,
): string {
  const schema = requestBody?.schema;
  const example = requestBody?.example;
  if (!schema && example?.value === undefined) return '';
  const mediaType = schema?.mediaType ?? example?.mediaType ?? '';
  return `
    <p style="margin:6px 0 2px;font-size:13px;font-weight:600;">${labels.requestBody} (${escapeHtml(
      mediaType,
    )}) &nbsp;<span style="font-weight:400;color:#555;">${
      schema ? `${labels.type}: <code>${escapeHtml(schema.typeDisplay)}</code> &nbsp;` : ''
    }${labels.required}: ${requestBody?.required ? labels.yes : labels.no}</span></p>
    ${
      requestBody?.description
        ? `<p style="margin:2px 0 4px;font-size:13px;color:#666;">${escapeHtml(requestBody.description)}</p>`
        : ''
    }
    ${schema?.fields.length ? renderFieldTable(schema.fields, borderStyle, labels) : ''}
    ${example?.value !== undefined ? renderHtmlExample(labels.requestExample, example.mediaType, example.value) : ''}`;
}

function renderResponseSection(
  responses: readonly ExportResponse[],
  borderStyle: string,
  labels: OfficeDocLabels,
): string {
  if (!responses.length) return '';

  const parts: string[] = [`<p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${labels.responses}</p>`];
  parts.push(`
    <table style="width:100%;border-collapse:collapse;margin:4px 0 10px;font-size:13px;">
      <thead><tr style="background:#f5f5f5;">
        <th style="${borderStyle}text-align:left;width:90px;">${labels.statusCode}</th>
        <th style="${borderStyle}text-align:left;">${labels.description}</th>
        <th style="${borderStyle}text-align:left;width:220px;">${labels.schema}</th>
      </tr></thead>
      <tbody>
        ${responses
          .map(
            (response) => `<tr>
              <td style="${borderStyle}"><code>${escapeHtml(response.statusCode)}</code></td>
              <td style="${borderStyle}">${escapeHtml(response.description)}</td>
              <td style="${borderStyle}"><code>${escapeHtml(response.schema?.typeDisplay ?? '—')}</code></td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>`);

  for (const response of responses) {
    const schema = response.schema;
    if (schema?.fields.length) {
      parts.push(`
        <p style="margin:8px 0 2px;font-size:13px;font-weight:600;">${labels.response} <code>${escapeHtml(
          response.statusCode,
        )}</code> (${escapeHtml(schema.mediaType)}) &nbsp;<span style="font-weight:400;color:#555;">${
          labels.type
        }: <code>${escapeHtml(schema.typeDisplay)}</code></span></p>
        ${renderFieldTable(schema.fields, borderStyle, labels)}`);
    }
    if (response.example?.value !== undefined) {
      parts.push(
        renderHtmlExample(
          labels.responseExample,
          response.example.mediaType,
          response.example.value,
          response.statusCode,
        ),
      );
    }
  }

  return parts.join('');
}

function renderOperation(operation: ExportOperation, labels: OfficeDocLabels): string {
  const color = methodColor(operation.method);
  const bodyHtml = renderRequestBodySection(operation.requestBody, 'border:1px solid #ddd;padding:5px 8px;', labels);
  const responseHtml = renderResponseSection(operation.responses, 'border:1px solid #ddd;padding:5px 8px;', labels);
  return `
    <div style="margin:14px 0;border:1px solid #e8e8e8;border-radius:4px;overflow:hidden;">
      <div style="padding:8px 12px;background:#fafafa;display:flex;align-items:center;gap:10px;">
        <span style="background:${color};color:#fff;padding:2px 8px;border-radius:3px;font-size:12px;font-weight:600;min-width:56px;text-align:center;">${escapeHtml(
          operation.method,
        )}</span>
        <span style="font-family:monospace;font-size:14px;">${escapeHtml(operation.path)}</span>
        ${operation.deprecated ? `<span style="color:#f93e3e;font-size:12px;margin-left:8px;">[${labels.deprecated}]</span>` : ''}
      </div>
      ${operation.summary ? `<div style="padding:5px 12px;font-size:14px;">${escapeHtml(operation.summary)}</div>` : ''}
      ${
        operation.description
          ? `<div style="padding:3px 12px;font-size:13px;color:#666;">${escapeHtml(operation.description)}</div>`
          : ''
      }
      ${
        operation.parameters.length
          ? `<div style="padding:5px 12px;">${renderParamTable(operation.parameters, labels)}</div>`
          : ''
      }
      ${bodyHtml ? `<div style="padding:5px 12px;">${bodyHtml}</div>` : ''}
      ${responseHtml ? `<div style="padding:5px 12px;">${responseHtml}</div>` : ''}
    </div>`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function renderHtmlDoc(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): string {
  const model = snapshot.document;
  const sections = model.tags
    .map((tag) => {
      const ops = tag.operations.map((operation) => renderOperation(operation, labels)).join('');
      return `
      <div style="margin-bottom:28px;">
        <h2 style="border-left:4px solid #00ab6d;padding-left:10px;margin:20px 0 10px;">${escapeHtml(tag.name)}</h2>
        ${tag.description ? `<p style="color:#666;margin-bottom:10px;">${escapeHtml(tag.description)}</p>` : ''}
        ${ops}
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="${labels.language}">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(model.title)}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;color:#333;}
    .wrap{max-width:960px;margin:0 auto;padding:24px;}
    h1{text-align:center;color:#00ab6d;}
    .info{background:#f9f9f9;border:1px solid #e8e8e8;border-radius:4px;padding:14px;margin-bottom:20px;}
    .export-incomplete{background:#fff7e6;border:1px solid #ffd591;border-radius:4px;padding:12px 14px;margin-bottom:20px;color:#873800;}
    .export-incomplete p{margin:6px 0;}
    .export-incomplete ul{margin:6px 0 0;padding-left:20px;}
    code{background:#f5f5f5;padding:1px 4px;border-radius:3px;font-size:12px;}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(model.title)}</h1>
    <div class="info">
      <p><strong>${labels.version}:</strong> ${escapeHtml(model.version)}</p>
      ${model.description ? `<p><strong>${labels.description}:</strong> ${escapeHtml(model.description)}</p>` : ''}
    </div>
    ${renderIncompleteHtml(snapshot, labels)}
    ${sections}
  </div>
</body>
</html>`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildHtmlDoc(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): string {
  return renderHtmlDoc(buildDocumentSnapshot(doc, tags, labels), labels);
}

// eslint-disable-next-line react-refresh/only-export-components
export function renderWordDoc(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): string {
  const border = 'border:1px solid #000;padding:4px 6px;';
  const model = snapshot.document;
  const sections = model.tags
    .map((tag) => {
      const ops = tag.operations
        .map((operation) => {
          const paramRows = operation.parameters
            .map(
              (p) => `
        <tr>
          <td style="${border}">${escapeHtml(p.name)}</td>
          <td style="${border}">${escapeHtml(p.location)}</td>
          <td style="${border}">${p.required ? labels.yes : labels.no}</td>
          <td style="${border}">${escapeHtml(p.typeDisplay)}</td>
          <td style="${border}">${escapeHtml(p.description)}</td>
        </tr>`,
            )
            .join('');
          const paramTable = operation.parameters.length
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
          const bodyHtml = renderRequestBodySection(operation.requestBody, border, labels);
          const responseHtml = renderResponseSection(operation.responses, border, labels);
          return `
        <h2 style="margin:14px 0 6px;">${formatOutlineNumber(operation.numberPath)} ${escapeHtml(operation.title)}</h2>
        <div style="margin:10px 0;padding:8px;border:1px solid #ccc;">
          <p style="margin:0 0 4px;"><strong style="color:${methodColor(operation.method)};">[${escapeHtml(
            operation.method,
          )}]</strong> <code>${escapeHtml(operation.path)}</code>${
            operation.deprecated ? ` <em style="color:red;">[${labels.deprecated}]</em>` : ''
          }</p>
          ${
            operation.description
              ? `<p style="margin:2px 0;font-size:13px;color:#666;">${escapeHtml(operation.description)}</p>`
              : ''
          }
          ${paramTable}
          ${bodyHtml}
          ${responseHtml}
        </div>`;
        })
        .join('');
      return `
      <h1 style="border-left:4px solid #00ab6d;padding-left:8px;margin:20px 0 8px;">${formatOutlineNumber(
        tag.numberPath,
      )} ${escapeHtml(tag.name)}</h1>
      ${tag.description ? `<p style="color:#666;margin-bottom:8px;">${escapeHtml(tag.description)}</p>` : ''}
      ${ops}`;
    })
    .join('');

  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN">
<html lang="${labels.language}">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
  <title>${escapeHtml(model.title)}</title>
  <style>
    body{font-family:Arial,"Yu Gothic","Microsoft YaHei",sans-serif;font-size:14px;margin:20px;}
    .document-title{text-align:center;font-size:28px;font-weight:bold;margin:0.67em 0;}
    .export-incomplete{background:#fff7e6;border:1px solid #ffd591;padding:10px 12px;margin:12px 0;color:#873800;}
    code{font-family:monospace;}
  </style>
</head>
<body>
  <p class="document-title">${escapeHtml(model.title)}</p>
  <p><strong>${labels.version}:</strong> ${escapeHtml(model.version)}</p>
  ${model.description ? `<p><strong>${labels.description}:</strong> ${escapeHtml(model.description)}</p>` : ''}
  ${renderIncompleteHtml(snapshot, labels)}
  <hr/>
  ${sections}
</body>
</html>`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildWordDoc(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): string {
  return renderWordDoc(buildDocumentSnapshot(doc, tags, labels), labels);
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

function docxFieldTable(rows: readonly ExportSchemaField[], labels: OfficeDocLabels): DocxTable {
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
          docxTextCell(fieldPath(r, labels)),
          docxTextCell(fieldType(r, labels)),
          docxTextCell(r.required ? labels.yes : labels.no),
          docxTextCell(r.description),
        ],
      }),
  );
  return new DocxTable({ rows: [header, ...dataRows], width: { size: 100, type: WidthType.PERCENTAGE } });
}

function docxParamRows(params: readonly ExportParameter[], labels: OfficeDocLabels): DocxTableRow[] {
  return params.map(
    (p) =>
      new DocxTableRow({
        children: [
          docxTextCell(p.name),
          docxTextCell(p.location),
          docxTextCell(p.required ? labels.yes : labels.no),
          docxTextCell(p.typeDisplay),
          docxTextCell(p.description),
        ],
      }),
  );
}

function docxExampleSection(label: string, mediaType: string, value: string, statusCode?: string): DocxParagraph[] {
  const lines = value.split(/\r\n|\n|\r/);
  return [
    new DocxParagraph({
      children: [
        new TextRun({
          text: `${label}${statusCode !== undefined ? ` ${statusCode}` : ''} (${mediaType})`,
          bold: true,
          size: 22,
        }),
      ],
      spacing: { before: 120, after: 40 },
    }),
    new DocxParagraph({
      children: lines.map(
        (line, index) =>
          new TextRun({
            text: line,
            break: index === 0 ? undefined : 1,
            font: 'Courier New',
            size: 20,
          }),
      ),
      spacing: { after: 80 },
    }),
  ];
}

function docxRequestBodySection(
  requestBody: ExportRequestBody | undefined,
  labels: OfficeDocLabels,
): (DocxParagraph | DocxTable)[] {
  const schema = requestBody?.schema;
  const example = requestBody?.example;
  if (!schema && example?.value === undefined) return [];
  const mediaType = schema?.mediaType ?? example?.mediaType ?? '';
  const children: (DocxParagraph | DocxTable)[] = [
    new DocxParagraph({
      children: [
        new TextRun({ text: `${labels.requestBody} (${mediaType})  `, bold: true, size: 22 }),
        new TextRun({
          text: `${schema ? `${labels.type}: ${schema.typeDisplay}  ` : ''}${labels.required}: ${
            requestBody?.required ? labels.yes : labels.no
          }`,
          size: 22,
        }),
      ],
      spacing: { before: 120, after: 40 },
    }),
  ];
  if (requestBody?.description) {
    children.push(
      new DocxParagraph({
        children: [new TextRun({ text: requestBody.description, color: '666666', size: 22 })],
        spacing: { after: 40 },
      }),
    );
  }
  if (schema?.fields.length) children.push(docxFieldTable(schema.fields, labels));
  if (example?.value !== undefined) {
    children.push(...docxExampleSection(labels.requestExample, example.mediaType, example.value));
  }
  return children;
}

function docxResponseSection(
  responses: readonly ExportResponse[],
  labels: OfficeDocLabels,
): (DocxParagraph | DocxTable)[] {
  if (!responses.length) return [];

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
  const summaryRows = responses.map(
    (response) =>
      new DocxTableRow({
        children: [
          docxTextCell(response.statusCode),
          docxTextCell(response.description),
          docxTextCell(response.schema?.typeDisplay ?? '—'),
        ],
      }),
  );
  children.push(
    new DocxTable({
      rows: [summaryHeader, ...summaryRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
  );

  for (const response of responses) {
    const schema = response.schema;
    if (schema?.fields.length) {
      children.push(
        new DocxParagraph({
          children: [
            new TextRun({
              text: `${labels.response} ${response.statusCode} (${schema.mediaType})  `,
              bold: true,
              size: 22,
            }),
            new TextRun({ text: `${labels.type}: ${schema.typeDisplay}`, size: 22 }),
          ],
          spacing: { before: 120, after: 40 },
        }),
        docxFieldTable(schema.fields, labels),
      );
    }
    if (response.example?.value !== undefined) {
      children.push(
        ...docxExampleSection(
          labels.responseExample,
          response.example.mediaType,
          response.example.value,
          response.statusCode,
        ),
      );
    }
  }

  return children;
}

// eslint-disable-next-line react-refresh/only-export-components
export async function renderDocx(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): Promise<Blob> {
  const children: (DocxParagraph | DocxTable)[] = [];
  const model = snapshot.document;

  children.push(
    new DocxParagraph({
      text: model.title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  );
  children.push(
    new DocxParagraph({
      children: [new TextRun({ text: `${labels.version}: ${model.version}`, size: 22 })],
    }),
  );
  if (model.description) {
    children.push(
      new DocxParagraph({
        children: [new TextRun({ text: `${labels.description}: ${model.description}`, size: 22 })],
      }),
    );
  }
  if (!snapshot.complete) {
    children.push(
      new DocxParagraph({
        children: [new TextRun({ text: incompleteExportTitle(labels), bold: true, color: 'ad4e00', size: 22 })],
        spacing: { before: 120, after: 40 },
      }),
      new DocxParagraph({
        children: [new TextRun({ text: incompleteExportSummary(snapshot, labels), color: '873800', size: 20 })],
        spacing: { after: 40 },
      }),
      ...renderedExportIssueLines(snapshot, labels).map(
        (issue) =>
          new DocxParagraph({
            children: [new TextRun({ text: `• ${issue}`, color: '873800', size: 20 })],
            spacing: { after: 20 },
          }),
      ),
    );
  }
  children.push(new DocxParagraph({ text: '' }));

  for (const tag of model.tags) {
    children.push(
      new DocxParagraph({
        text: tag.name,
        heading: HeadingLevel.HEADING_1,
        numbering: { reference: 'api-outline', level: 0 },
        spacing: { before: 300, after: 100 },
      }),
    );
    if (tag.description) {
      children.push(
        new DocxParagraph({
          children: [new TextRun({ text: tag.description, italics: true, color: '666666', size: 22 })],
          spacing: { after: 80 },
        }),
      );
    }

    for (const operation of tag.operations) {
      children.push(
        new DocxParagraph({
          text: operation.title,
          heading: HeadingLevel.HEADING_2,
          numbering: { reference: 'api-outline', level: 1 },
          spacing: { before: 200, after: 60 },
        }),
        new DocxParagraph({
          children: [
            new TextRun({
              text: `[${operation.method}] `,
              bold: true,
              color: methodColor(operation.method).replace('#', ''),
              size: 24,
            }),
            new TextRun({ text: operation.path, font: 'Courier New', size: 24 }),
            ...(operation.deprecated
              ? [new TextRun({ text: ` [${labels.deprecated}]`, color: 'f93e3e', size: 22 })]
              : []),
          ],
          spacing: { after: 60 },
        }),
      );

      if (operation.description) {
        children.push(
          new DocxParagraph({
            children: [new TextRun({ text: operation.description, color: '666666', size: 22 })],
            spacing: { after: 60 },
          }),
        );
      }

      if (operation.parameters.length) {
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
            rows: [paramHeader, ...docxParamRows(operation.parameters, labels)],
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
        );
      }

      children.push(...docxRequestBodySection(operation.requestBody, labels));
      children.push(...docxResponseSection(operation.responses, labels));
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

// eslint-disable-next-line react-refresh/only-export-components
export async function buildDocx(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): Promise<Blob> {
  return renderDocx(buildDocumentSnapshot(doc, tags, labels), labels);
}

// eslint-disable-next-line react-refresh/only-export-components
export function renderMarkdownDoc(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): string {
  const document = renderExportDocumentMarkdown(snapshot.document, { labels: labels.markdown });
  if (snapshot.complete) return document;
  const notice = [
    `> **${incompleteExportTitle(labels)}**`,
    `> ${incompleteExportSummary(snapshot, labels)}`,
    ...renderedExportIssueLines(snapshot, labels).map((issue) => `> - ${escapeMarkdownInline(issue)}`),
  ].join('\n');
  return `${notice}\n\n${document}`;
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildMarkdownDoc(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): string {
  return renderMarkdownDoc(buildDocumentSnapshot(doc, tags, labels), labels);
}

type OfflineDocumentFormat = 'html' | 'docx' | 'doc' | 'markdown';

export default function OfficeDoc() {
  const { t, i18n } = useTranslation();
  const { swaggerDoc, menuTags, loading, usingMock } = useGroup();
  const schemaEngine = useSchemaEngine();
  const externalResources = useExternalResources();
  const [exporting, setExporting] = useState<OfflineDocumentFormat | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const readySession =
    schemaEngine.status === 'ready' && schemaEngine.document === swaggerDoc ? schemaEngine.session : null;
  const retrievalUri = schemaEngine.retrievalUri;
  const exportIdentity = useMemo(
    () => Object.freeze({ document: swaggerDoc, tags: menuTags, session: readySession, retrievalUri }),
    [menuTags, readySession, retrievalUri, swaggerDoc],
  );
  const activeIdentityRef = useRef(exportIdentity);

  useEffect(() => {
    activeIdentityRef.current = exportIdentity;
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    setExporting(null);
  }, [exportIdentity]);

  useEffect(
    () => () => {
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
    },
    [],
  );

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
    requestExample: t('apiDoc.tab.requestExample'),
    mediaType: t('apiDebug.body.contentType'),
    responses: t('apiDoc.responseStructure'),
    response: t('officeDoc.response'),
    responseExample: t('apiDoc.tab.responseExample'),
    statusCode: t('apiDoc.col.statusCode'),
    schema: t('apiDoc.col.schema'),
    deprecated: t('apiDoc.deprecated'),
    parameters: t('apiDoc.requestParams'),
    circularReference: t('officeDoc.circularReference'),
    truncated: t('officeDoc.truncated'),
    fallbackTitle: t('officeDoc.fallbackTitle'),
    incompleteTitle: t('officeDoc.snapshot.incomplete.documentTitle'),
    incompleteSummary: (count) => t('officeDoc.snapshot.incomplete.documentSummary', { count }),
    incompleteMore: (count) => t('officeDoc.snapshot.incomplete.more', { count }),
    markdown: {
      version: t('home.version'),
      truncated: t('officeDoc.truncated'),
      circularReference: t('officeDoc.circularReference'),
      deprecated: t('apiDoc.markdown.deprecated'),
      requestParameters: t('apiDoc.requestParams'),
      noRequestParameters: t('apiDoc.noParams'),
      requestBody: t('apiDoc.requestBody'),
      requestExample: t('apiDoc.tab.requestExample'),
      noRequestBody: t('apiDoc.noBody'),
      requestBodyNotExpandable: t('apiDoc.body.notExpandable'),
      mediaType: t('apiDebug.body.contentType'),
      responseStructure: t('apiDoc.responseStructure'),
      responseExample: t('apiDoc.tab.responseExample'),
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

  function degradedSnapshot(issue: OfflineDocumentIssue): OfflineDocumentSnapshot {
    return createOfflineDocumentSnapshot(
      buildExportDocument(exportIdentity.document!, exportIdentity.tags, { fallbackTitle: labels.fallbackTitle }),
      [issue],
    );
  }

  function resourceSnapshotIssues(): OfflineDocumentIssue[] {
    if (schemaEngine.status !== 'ready') return [];
    const snapshot = externalResources.snapshot;
    const currentGraph =
      snapshot?.entryRetrievalUri === schemaEngine.retrievalUri &&
      externalResources.documentScope === snapshot.documentScope;
    const issues: OfflineDocumentIssue[] = [];
    if (!currentGraph || !snapshot.complete || externalResources.status !== 'ready') {
      issues.push({ code: 'RESOURCE_GRAPH_INCOMPLETE', severity: 'warning' });
    }
    if (externalResources.registrationError) {
      issues.push({
        code: 'RESOURCE_REGISTRATION_FAILED',
        severity: 'warning',
        ...(externalResources.registrationError.code === undefined
          ? {}
          : { keyword: externalResources.registrationError.code }),
      });
    }
    return issues;
  }

  async function snapshotForDownload(signal: AbortSignal): Promise<OfflineDocumentSnapshot> {
    const document = exportIdentity.document!;
    if (!isOas31SchemaDocument(document)) return buildDocumentSnapshot(document, exportIdentity.tags, labels);
    if (schemaEngine.status !== 'ready' || !exportIdentity.session) {
      return degradedSnapshot({
        code:
          schemaEngine.status === 'loading'
            ? 'SCHEMA_SESSION_LOADING'
            : schemaEngine.status === 'error'
              ? 'SCHEMA_SESSION_FAILED'
              : 'SCHEMA_SESSION_UNAVAILABLE',
        severity: 'warning',
      });
    }
    try {
      return await buildOas31ExportSnapshot(document, exportIdentity.tags, exportIdentity.session, {
        fallbackTitle: labels.fallbackTitle,
        signal,
        initialIssues: resourceSnapshotIssues(),
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (error instanceof Oas31ExportBudgetError) {
        return createOfflineDocumentSnapshot(
          {
            title: document.info.title || labels.fallbackTitle,
            version: document.info.version ?? '',
            description: document.info.description ?? '',
            tags: [],
          },
          [{ code: error.code, severity: 'warning', keyword: error.dimension }],
        );
      }
      return degradedSnapshot({
        code: 'SNAPSHOT_BUILD_FAILED',
        severity: 'warning',
      });
    }
  }

  function confirmIncompleteSnapshot(snapshot: OfflineDocumentSnapshot, signal: AbortSignal): Promise<boolean> {
    if (snapshot.complete) return Promise.resolve(true);
    const issueLines = renderedExportIssueLines(snapshot, labels).slice(0, 6);
    return new Promise((resolve) => {
      let settled = false;
      let destroy: () => void = () => undefined;
      const settle = (accepted: boolean) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', handleAbort);
        resolve(accepted);
      };
      const handleAbort = () => {
        destroy();
        settle(false);
      };
      const modal = Modal.confirm({
        title: t('officeDoc.snapshot.incomplete.title'),
        content: (
          <div>
            <Paragraph>
              {t('officeDoc.snapshot.incomplete.description', {
                count: incompleteOfflineDocumentIssues(snapshot).length,
              })}
            </Paragraph>
            <ul style={{ paddingInlineStart: 20, marginBottom: 0 }}>
              {issueLines.map((issue, index) => (
                <li key={`${index}:${issue}`}>{issue}</li>
              ))}
            </ul>
          </div>
        ),
        okText: t('officeDoc.snapshot.incomplete.confirm'),
        cancelText: t('officeDoc.snapshot.incomplete.cancel'),
        okButtonProps: { danger: true },
        onOk: () => settle(true),
        onCancel: () => settle(false),
      });
      destroy = modal.destroy;
      signal.addEventListener('abort', handleAbort, { once: true });
      if (signal.aborted) handleAbort();
    });
  }

  async function materializeSnapshot(
    format: OfflineDocumentFormat,
    snapshot: OfflineDocumentSnapshot,
  ): Promise<() => void> {
    const title = snapshot.document.title || 'api-docs';
    if (format === 'html') {
      const content = renderHtmlDoc(snapshot, labels);
      return () => downloadBlob(content, `${title}.html`, 'text/html;charset=utf-8');
    }
    if (format === 'doc') {
      const content = renderWordDoc(snapshot, labels);
      return () => downloadBlob(content, `${title}.doc`, 'application/msword');
    }
    if (format === 'markdown') {
      const content = renderMarkdownDoc(snapshot, labels);
      return () => downloadBlob(content, `${title}.md`, 'text/markdown;charset=utf-8');
    }
    const blob = await renderDocx(snapshot, labels);
    return () => downloadPreparedBlob(blob, `${title}.docx`);
  }

  async function handleDownload(format: OfflineDocumentFormat): Promise<void> {
    if (!exportIdentity.document || usingMock || exporting) return;
    const controller = new AbortController();
    activeControllerRef.current?.abort();
    activeControllerRef.current = controller;
    const capturedIdentity = exportIdentity;
    setExporting(format);
    try {
      await runOfflineDocumentExportTask({
        signal: controller.signal,
        isCurrent: () => activeIdentityRef.current === capturedIdentity,
        buildSnapshot: () => snapshotForDownload(controller.signal),
        confirmIncomplete: (snapshot) => confirmIncompleteSnapshot(snapshot, controller.signal),
        materialize: (snapshot) => materializeSnapshot(format, snapshot),
      });
    } catch (error) {
      if (!isAbortError(error) && activeIdentityRef.current === capturedIdentity) {
        void message.error(t('officeDoc.snapshot.failed'));
      }
    } finally {
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
      if (activeIdentityRef.current === capturedIdentity) setExporting(null);
    }
  }

  function handleDownloadOpenApiJson() {
    if (!swaggerDoc) return;
    const title = swaggerDoc.info.title || 'api-docs';
    downloadBlob(JSON.stringify(swaggerDoc, null, 2), `${title}.openapi.json`, 'application/json;charset=utf-8');
  }

  const noData = !loading && (!swaggerDoc || usingMock);
  const downloadDisabled = loading || !swaggerDoc || usingMock || exporting !== null;

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
          onClick={() => void handleDownload('html')}
          disabled={downloadDisabled}
          loading={loading || exporting === 'html'}
        >
          {t('officeDoc.btn.html')}
        </Button>
        <Button
          icon={<FileWordOutlined />}
          onClick={() => void handleDownload('docx')}
          disabled={downloadDisabled}
          loading={loading || exporting === 'docx'}
        >
          {t('officeDoc.btn.docx')}
        </Button>
        <Button
          icon={<FileWordOutlined />}
          onClick={() => void handleDownload('doc')}
          disabled={downloadDisabled}
          loading={loading || exporting === 'doc'}
        >
          {t('officeDoc.btn.word')}
        </Button>
        <Button
          icon={<FileMarkdownOutlined />}
          onClick={() => void handleDownload('markdown')}
          disabled={downloadDisabled}
          loading={loading || exporting === 'markdown'}
        >
          {t('officeDoc.btn.markdown')}
        </Button>
        <Button
          icon={<CodeOutlined />}
          onClick={handleDownloadOpenApiJson}
          disabled={downloadDisabled}
          loading={loading}
        >
          {t('officeDoc.btn.openapi')}
        </Button>
      </Space>
    </div>
  );
}
