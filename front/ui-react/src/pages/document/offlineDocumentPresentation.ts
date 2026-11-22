import {
  buildExportDocument,
  type ApiMarkdownLabels,
  type ExportEncoding,
  type ExportNote,
  type ExportSchemaField,
} from 'knife4j-core';
import type { SupportedLang } from '../../types/settings';
import type { MenuTag, SwaggerDoc } from '../../types/swagger';
import {
  createOfflineDocumentSnapshot,
  incompleteOfflineDocumentIssues,
  type OfflineDocumentSnapshot,
} from './offlineDocumentSnapshot';

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
  security?: string;
  servers?: string;
  itemSchema?: string;
  sequentialKind?: string;
  encoding?: string;
  notes?: string;
  markdown: ApiMarkdownLabels;
}

const MAX_RENDERED_EXPORT_ISSUES = 20;

export function renderedExportIssueLines(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): string[] {
  const issues = incompleteOfflineDocumentIssues(snapshot);
  const visible = issues.slice(0, MAX_RENDERED_EXPORT_ISSUES).map((issue) => {
    const diagnostic = issue.keyword ? `${issue.code} (${issue.keyword})` : issue.code;
    return [issue.operation, issue.region, diagnostic].filter(Boolean).join(' · ');
  });
  const remaining = issues.length - visible.length;
  if (remaining > 0) visible.push(labels.incompleteMore?.(remaining) ?? `${remaining} more issue(s)`);
  return visible;
}

export function incompleteExportTitle(labels: OfficeDocLabels): string {
  return labels.incompleteTitle ?? 'Incomplete export';
}

export function incompleteExportSummary(snapshot: OfflineDocumentSnapshot, labels: OfficeDocLabels): string {
  const count = incompleteOfflineDocumentIssues(snapshot).length;
  return labels.incompleteSummary?.(count) ?? `${count} semantic issue(s) could not be represented completely.`;
}

export function methodColor(method: string): string {
  const map: Record<string, string> = {
    GET: '#61affe',
    POST: '#49cc90',
    PUT: '#fca130',
    DELETE: '#f93e3e',
    PATCH: '#50e3c2',
    HEAD: '#9012fe',
    OPTIONS: '#0d5aa7',
    QUERY: '#1890ff',
    COPY: '#722ed1',
  };
  return map[method] ?? map[method.toUpperCase()] ?? '#999999';
}

export function buildDocumentSnapshot(
  doc: SwaggerDoc,
  tags: MenuTag[],
  labels: OfficeDocLabels,
): OfflineDocumentSnapshot {
  return createOfflineDocumentSnapshot(buildExportDocument(doc, tags, { fallbackTitle: labels.fallbackTitle }));
}

export function formatNote(note: ExportNote): string {
  return note.detail ? `${note.code}: ${note.detail}` : note.code;
}

export function formatEncodings(encodings: readonly ExportEncoding[] | undefined): string[] {
  return (encodings ?? []).map((encoding) =>
    [
      encoding.kind,
      encoding.name ? `name=${encoding.name}` : undefined,
      encoding.contentType ? `contentType=${encoding.contentType}` : undefined,
      encoding.style ? `style=${encoding.style}` : undefined,
      encoding.explode === undefined ? undefined : `explode=${String(encoding.explode)}`,
      encoding.allowReserved === undefined ? undefined : `allowReserved=${encoding.allowReserved}`,
      ...(encoding.notes ?? []).map((note) => formatNote(note)),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

export function fieldPath(field: ExportSchemaField, labels: OfficeDocLabels): string {
  if (field.fieldPath || !field.truncated) return field.fieldPath;
  return field.truncationReason && field.truncationReason !== 'circular-reference'
    ? (labels.truncated ?? labels.circularReference)
    : labels.circularReference;
}

export function fieldType(field: ExportSchemaField, labels: OfficeDocLabels): string {
  if (!field.truncated) return field.typeDisplay;
  if (field.truncationReason === undefined || field.truncationReason === 'circular-reference') {
    return labels.circularReference;
  }
  const marker = labels.truncated ?? labels.circularReference;
  return `${field.typeDisplay || 'object'} (${marker})`;
}
