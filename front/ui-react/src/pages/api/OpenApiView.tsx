import { useMemo } from 'react';
import { Alert, Button, Spin, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { OperationModeLayout, useCurrentOperation } from './useCurrentOperation';
import CodeBlock from './CodeBlock';
import { copyToClipboard } from '../../utils/clipboard';
import {
  buildOperationOpenApiFilename,
  buildOperationOpenApiPreviewDocument,
  downloadOperationOpenApiJson,
  serializeOperationOpenApiDocument,
  supportsOperationOpenApiDownload,
} from './operationOpenApiDocument';

type OpenApiState =
  { status: 'empty' } | { status: 'error' } | { status: 'ready'; downloadable: boolean; json: string };

export default function OpenApiView() {
  const { t } = useTranslation();
  const { loading, swaggerDoc, operation } = useCurrentOperation();

  const openApiState = useMemo<OpenApiState>(() => {
    if (!swaggerDoc || !operation) return { status: 'empty' };
    try {
      const document = buildOperationOpenApiPreviewDocument(
        swaggerDoc,
        operation.path,
        operation.method,
        operation.source,
      );
      if (!document) return { status: 'empty' };
      return {
        status: 'ready',
        downloadable: operation.source !== 'webhook' && supportsOperationOpenApiDownload(swaggerDoc),
        json: serializeOperationOpenApiDocument(document),
      };
    } catch {
      return { status: 'error' };
    }
  }, [swaggerDoc, operation]);

  if (loading) {
    return (
      <OperationModeLayout activeKey="openapi">
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      </OperationModeLayout>
    );
  }

  if (!swaggerDoc || !operation) {
    return (
      <OperationModeLayout activeKey="openapi">
        <Alert
          type="warning"
          showIcon
          message={t('apiOpenApi.notFound.title')}
          description={t('apiOpenApi.notFound.desc')}
        />
      </OperationModeLayout>
    );
  }

  const handleCopy = () => {
    if (openApiState.status !== 'ready') return;
    copyToClipboard(
      openApiState.json,
      () => message.success(t('apiOpenApi.copied')),
      () => message.error(t('apiDoc.copy.failed')),
    );
  };

  const handleDownload = () => {
    if (openApiState.status !== 'ready' || !openApiState.downloadable) return;
    const filename = buildOperationOpenApiFilename(operation.method, operation.path, operation.operation.operationId);

    try {
      if (!downloadOperationOpenApiJson(openApiState.json, filename)) {
        message.error(t('apiOpenApi.download.unsupported'));
        return;
      }
      message.success(t('apiOpenApi.download.started'));
    } catch {
      message.error(t('apiOpenApi.download.failed'));
    }
  };

  return (
    <OperationModeLayout activeKey="openapi">
      {openApiState.status === 'ready' ? (
        <div>
          {openApiState.downloadable ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <Button size="small" icon={<DownloadOutlined />} onClick={handleDownload}>
                {t('apiOpenApi.download')}
              </Button>
            </div>
          ) : (
            <Alert
              type="info"
              showIcon
              message={t('apiOpenApi.download.versionUnsupported')}
              style={{ marginBottom: 8 }}
            />
          )}
          <CodeBlock code={openApiState.json} language="json" maxHeight={600} onCopy={handleCopy} />
        </div>
      ) : openApiState.status === 'error' ? (
        <Alert type="error" showIcon message={t('apiOpenApi.serialize.failed')} />
      ) : (
        <Alert type="info" showIcon message={t('apiOpenApi.noData')} />
      )}
    </OperationModeLayout>
  );
}
