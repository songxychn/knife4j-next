import { renderExportDocumentMarkdown, renderExportOperationMarkdown } from 'knife4j-core';
import type { MenuTag, SwaggerDoc } from '../../types/swagger';
import type { OfflineDocumentSnapshot } from './offlineDocumentSnapshot';
import {
  buildDocumentSnapshot,
  incompleteExportSummary,
  incompleteExportTitle,
  renderedExportIssueLines,
  type OfficeDocLabels,
} from './offlineDocumentPresentation';

function escapeMarkdownInline(value: string): string {
  return value
    .replace(/\r\n?|\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/([`*[\]<>|])/g, '\\$1');
}

export function renderSnapshotMarkdown(
  snapshot: OfflineDocumentSnapshot,
  labels: OfficeDocLabels,
  singleOperation = false,
): string {
  const operation = snapshot.document.tags[0]?.operations[0];
  const document = singleOperation
    ? operation
      ? renderExportOperationMarkdown(operation, { labels: labels.markdown, headingLevel: 1 })
      : ''
    : renderExportDocumentMarkdown(snapshot.document, { labels: labels.markdown });
  if (snapshot.complete) return document;
  const notice = [
    `> **${incompleteExportTitle(labels)}**`,
    `> ${incompleteExportSummary(snapshot, labels)}`,
    ...renderedExportIssueLines(snapshot, labels).map((issue) => `> - ${escapeMarkdownInline(issue)}`),
  ].join('\n');
  return `${notice}\n\n${document}`;
}

export function buildMarkdownDoc(doc: SwaggerDoc, tags: MenuTag[], labels: OfficeDocLabels): string {
  return renderSnapshotMarkdown(buildDocumentSnapshot(doc, tags, labels), labels);
}
