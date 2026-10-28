import { useCallback, useMemo } from 'react';
import { Modal, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  buildExportDocument,
  getOpenApiSpecificationFeatures,
  renderExportDocumentMarkdown,
  renderExportOperationMarkdown,
  type ApiMarkdownLabels,
} from 'knife4j-core';
import { useExternalResources, useSchemaEngine } from '../../context/SchemaEngineContext';
import { DEFAULT_LANGUAGE, normalizeSupportedLanguage } from '../../locales/language';
import { isOas31SchemaDocument } from '../../schema/schemaDocumentSession';
import type { SupportedLang } from '../../types/settings';
import type { SwaggerDoc, MenuTag } from '../../types/swagger';
import {
  createOfflineDocumentSnapshot,
  incompleteOfflineDocumentIssues,
  type OfflineDocumentIssue,
  type OfflineDocumentSnapshot,
} from './offlineDocumentSnapshot';
import { buildOas31ExportSnapshot, Oas31ExportBudgetError } from './oas31ExportSnapshot';
import {
  buildOas32DegradedExportSnapshot,
  buildOas32ExportSnapshot,
  collectOas32ExportResourceGraphIssues,
  Oas32ExportBudgetError,
  selectOas32ExportResourceSnapshot,
} from './oas32ExportSnapshot';

const { Paragraph } = Typography;
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

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

function escapeMarkdownInline(value: string): string {
  return value
    .replace(/\r\n?|\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/([`*[\]<>|])/g, '\\$1');
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

export function useDocumentExport(swaggerDoc: SwaggerDoc | null, menuTags: MenuTag[]) {
  const { t, i18n } = useTranslation();
  const schemaEngine = useSchemaEngine();
  const externalResources = useExternalResources();
  const readySession =
    schemaEngine.status === 'ready' && schemaEngine.document === swaggerDoc ? schemaEngine.session : null;
  const retrievalUri = schemaEngine.retrievalUri;
  const exportIdentity = useMemo(
    () => Object.freeze({ document: swaggerDoc, tags: menuTags, session: readySession, retrievalUri }),
    [menuTags, readySession, retrievalUri, swaggerDoc],
  );
  const isOas32Document = getOpenApiSpecificationFeatures(swaggerDoc?.openapi)?.family === '3.2';
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
    security: t('officeDoc.security'),
    servers: t('officeDoc.servers'),
    itemSchema: t('officeDoc.itemSchema'),
    sequentialKind: t('officeDoc.sequentialKind'),
    encoding: t('officeDoc.encoding'),
    notes: t('officeDoc.notes'),
    incompleteTitle: t(
      isOas32Document ? 'officeDoc.snapshot.incomplete.documentTitle32' : 'officeDoc.snapshot.incomplete.documentTitle',
    ),
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
      security: t('officeDoc.security'),
      servers: t('officeDoc.servers'),
      itemSchema: t('officeDoc.itemSchema'),
      sequentialKind: t('officeDoc.sequentialKind'),
      encoding: t('officeDoc.encoding'),
      notes: t('officeDoc.notes'),
      summary: t('home.description'),
    },
  };

  const snapshotForDownload = useCallback(
    async (signal: AbortSignal): Promise<OfflineDocumentSnapshot> => {
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

      const document = exportIdentity.document!;
      const family = getOpenApiSpecificationFeatures(document.openapi)?.family;
      const sessionIssue = (): OfflineDocumentIssue => ({
        code:
          schemaEngine.status === 'loading'
            ? 'SCHEMA_SESSION_LOADING'
            : schemaEngine.status === 'error'
              ? 'SCHEMA_SESSION_FAILED'
              : 'SCHEMA_SESSION_UNAVAILABLE',
        severity: 'warning',
      });
      if (family === '3.2') {
        if (schemaEngine.status !== 'ready' || !exportIdentity.session) {
          return buildOas32DegradedExportSnapshot(document, exportIdentity.tags, [sessionIssue()], {
            fallbackTitle: labels.fallbackTitle,
          });
        }
        try {
          const graphSnapshot = externalResources.snapshot ?? undefined;
          const graphRetrievalUri = schemaEngine.retrievalUri ?? undefined;
          const graphDocumentScope = externalResources.documentScope ?? undefined;
          const currentGraph = selectOas32ExportResourceSnapshot(graphSnapshot, graphRetrievalUri, graphDocumentScope);
          return await buildOas32ExportSnapshot(document, exportIdentity.tags, exportIdentity.session, {
            fallbackTitle: labels.fallbackTitle,
            signal,
            initialIssues: collectOas32ExportResourceGraphIssues({
              snapshot: graphSnapshot,
              retrievalUri: graphRetrievalUri,
              documentScope: graphDocumentScope,
              graphStatus: externalResources.status,
              registrationError: externalResources.registrationError,
            }),
            retrievalUri: exportIdentity.retrievalUri ?? graphRetrievalUri,
            documentScope: graphDocumentScope,
            resourceSnapshot: currentGraph,
          });
        } catch (error) {
          if (isAbortError(error)) throw error;
          if (error instanceof Oas32ExportBudgetError) {
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
          return buildOas32DegradedExportSnapshot(
            document,
            exportIdentity.tags,
            [{ code: 'SNAPSHOT_BUILD_FAILED', severity: 'warning' }],
            { fallbackTitle: labels.fallbackTitle },
          );
        }
      }
      if (!isOas31SchemaDocument(document))
        return createOfflineDocumentSnapshot(
          buildExportDocument(document, exportIdentity.tags, { fallbackTitle: labels.fallbackTitle }),
        );
      if (schemaEngine.status !== 'ready' || !exportIdentity.session) {
        return degradedSnapshot(sessionIssue());
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
    },
    [exportIdentity, externalResources, schemaEngine, labels.fallbackTitle],
  );

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
        title: t(isOas32Document ? 'officeDoc.snapshot.incomplete.title32' : 'officeDoc.snapshot.incomplete.title'),
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

  return { labels, exportIdentity, isOas32Document, snapshotForDownload, confirmIncompleteSnapshot };
}
