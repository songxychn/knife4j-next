import { useMemo } from 'react';
import { Alert, Button, Spin, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { OperationModeLayout, useCurrentOperation } from './useCurrentOperation';
import CodeBlock from './CodeBlock';
import { copyToClipboard } from '../../utils/clipboard';
import { useExternalResources, useSchemaEngine } from '../../context/SchemaEngineContext';
import { buildOperationOpenApiFilename, downloadOperationOpenApiJson } from './operationOpenApiDocument';
import { buildOpenApiViewState, type Oas31ExportAvailability } from './openApiViewState';

export default function OpenApiView() {
  const { t } = useTranslation();
  const { loading, swaggerDoc, operation } = useCurrentOperation();
  const schemaEngine = useSchemaEngine();
  const externalResources = useExternalResources();

  const oas31Availability = useMemo<Oas31ExportAvailability>(() => {
    const snapshot = externalResources.snapshot;
    if (
      schemaEngine.status === 'loading' ||
      externalResources.status === 'discovering' ||
      externalResources.status === 'loading'
    ) {
      return { status: 'loading' };
    }
    if (
      schemaEngine.status === 'ready' &&
      snapshot &&
      schemaEngine.retrievalUri === snapshot.entryRetrievalUri &&
      externalResources.documentScope === snapshot.documentScope
    ) {
      return { status: 'ready', retrievalUri: schemaEngine.retrievalUri, snapshot };
    }
    return { status: 'unavailable' };
  }, [externalResources.documentScope, externalResources.snapshot, externalResources.status, schemaEngine]);

  const openApiState = useMemo(
    () => buildOpenApiViewState(swaggerDoc, operation, oas31Availability),
    [oas31Availability, operation, swaggerDoc],
  );

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
          ) : openApiState.notice ? (
            <Alert
              type={
                openApiState.notice.kind === 'oas31-blocked' || openApiState.notice.kind === 'oas31-unavailable'
                  ? 'warning'
                  : 'info'
              }
              showIcon
              message={t(
                openApiState.notice.kind === 'version-unsupported'
                  ? 'apiOpenApi.download.versionUnsupported'
                  : openApiState.notice.kind === 'oas31-loading'
                    ? 'apiOpenApi.download.oas31Preparing'
                    : openApiState.notice.kind === 'oas31-blocked'
                      ? 'apiOpenApi.download.oas31Blocked'
                      : 'apiOpenApi.download.oas31Unavailable',
              )}
              description={
                openApiState.notice.kind === 'oas31-blocked' ? (
                  <div>
                    <div>{t('apiOpenApi.download.oas31Blocked.desc')}</div>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                      {openApiState.notice.blockers.map((blocker, index) => (
                        <li key={`${blocker.code}-${blocker.sourcePointer}-${blocker.resourceDisplay ?? ''}-${index}`}>
                          <code>{blocker.sourcePointer}</code>
                          {blocker.resourceDisplay ? ` → ${blocker.resourceDisplay}` : ''} ({blocker.code})
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : undefined
              }
              style={{ marginBottom: 8 }}
            />
          ) : null}
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
