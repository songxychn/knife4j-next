import { useMemo } from 'react';
import { Alert, Button, Spin, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { OperationModeLayout, useCurrentOperation } from './useCurrentOperation';
import CodeBlock from './CodeBlock';
import { copyToClipboard } from '../../utils/clipboard';
import {
  buildOperationOpenApiDocument,
  buildOperationOpenApiFilename,
  downloadOperationOpenApiJson,
  serializeOperationOpenApiDocument,
} from './operationOpenApiDocument';

type OpenApiState = { status: 'empty' } | { status: 'error' } | { status: 'ready'; json: string };

export default function OpenApiView() {
  const { t } = useTranslation();
  const { loading, swaggerDoc, swaggerDocUri, operation } = useCurrentOperation();

  const openApiState = useMemo<OpenApiState>(() => {
    if (!swaggerDoc || !operation) return { status: 'empty' };
    try {
      const document = buildOperationOpenApiDocument(
        swaggerDoc,
        operation.path,
        operation.method,
        swaggerDocUri ?? undefined,
      );
      if (!document) return { status: 'empty' };
      return { status: 'ready', json: serializeOperationOpenApiDocument(document) };
    } catch {
      return { status: 'error' };
    }
  }, [swaggerDoc, swaggerDocUri, operation]);

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
    if (openApiState.status !== 'ready') return;
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <Button size="small" icon={<DownloadOutlined />} onClick={handleDownload}>
              {t('apiOpenApi.download')}
            </Button>
          </div>
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
