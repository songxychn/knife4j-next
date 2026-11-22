import { useEffect, useRef, useState } from 'react';
import { Button, Space, Typography, Alert, message } from 'antd';
import { FileTextOutlined, FileWordOutlined, FileMarkdownOutlined, CodeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useGroup } from '../../context/GroupContext';
import { runOfflineDocumentExportTask, type OfflineDocumentSnapshot } from './offlineDocumentSnapshot';
import { useDocumentExport } from './useDocumentExport';
import { renderHtmlDoc, renderWordDoc } from './renderDocumentHtml';
import { renderDocx } from './renderDocumentDocx';
import { renderSnapshotMarkdown } from './renderDocumentMarkdown';
import { downloadBlob, downloadPreparedBlob } from './downloadDocumentBlob';
import { downloadOpenApi } from './downloadOpenApi';

const { Title, Paragraph } = Typography;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

type OfflineDocumentFormat = 'html' | 'docx' | 'doc' | 'markdown';

export default function OfficeDoc() {
  const { t } = useTranslation();
  const { swaggerDoc, menuTags, loading, usingMock } = useGroup();
  const { labels, exportIdentity, snapshotForDownload, confirmIncompleteSnapshot } = useDocumentExport(
    swaggerDoc,
    menuTags,
  );
  const [exporting, setExporting] = useState<OfflineDocumentFormat | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
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
      const content = renderSnapshotMarkdown(snapshot, labels);
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

      {noData && <Alert type="warning" title={t('officeDoc.alert.mockData')} style={{ marginBottom: 16 }} />}

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
          onClick={() => swaggerDoc && downloadOpenApi(swaggerDoc, 'json')}
          disabled={downloadDisabled}
          loading={loading}
        >
          {t('officeDoc.btn.openapi')}
        </Button>
        <Button
          icon={<CodeOutlined />}
          onClick={() => swaggerDoc && downloadOpenApi(swaggerDoc, 'yaml')}
          disabled={downloadDisabled}
          loading={loading}
        >
          {t('officeDoc.btn.openapiYaml')}
        </Button>
      </Space>
    </div>
  );
}
