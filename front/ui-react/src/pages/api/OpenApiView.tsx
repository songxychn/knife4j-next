import { useMemo } from 'react';
import { Alert, Button, Space, Spin, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { OperationModeLayout, useCurrentOperation } from './useCurrentOperation';
import CodeBlock from './CodeBlock';
import { copyToClipboard } from '../../utils/clipboard';
import { useExternalResources, useSchemaEngine } from '../../context/SchemaEngineContext';
import {
  buildOperationOpenApiFilename,
  downloadOperationOpenApiJson,
  serializeOperationOpenApiYaml,
} from './operationOpenApiDocument';
import { buildOpenApiViewState, type Oas31ExportAvailability, type OpenApiDownloadNotice } from './openApiViewState';

const NOTICE_MESSAGE_KEYS: Record<OpenApiDownloadNotice['kind'], string> = {
  'version-unsupported': 'apiOpenApi.download.versionUnsupported',
  'oas31-loading': 'apiOpenApi.download.oas31Preparing',
  'oas31-unavailable': 'apiOpenApi.download.oas31Unavailable',
  'oas31-blocked': 'apiOpenApi.download.oas31Blocked',
  'oas32-loading': 'apiOpenApi.download.oas32Preparing',
  'oas32-unavailable': 'apiOpenApi.download.oas32Unavailable',
  'oas32-blocked': 'apiOpenApi.download.oas32Blocked',
};

function isWarningNotice(kind: OpenApiDownloadNotice['kind']): boolean {
  return (
    kind === 'oas31-blocked' || kind === 'oas31-unavailable' || kind === 'oas32-blocked' || kind === 'oas32-unavailable'
  );
}

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

  const downloadPortable = (format: 'json' | 'yaml') => {
    if (openApiState.status !== 'ready' || !openApiState.downloadable) return;
    const filename = buildOperationOpenApiFilename(
      operation.method,
      operation.path,
      operation.operation.operationId,
      format,
    );

    try {
      const content =
        format === 'yaml' ? serializeOperationOpenApiYaml(JSON.parse(openApiState.json)) : openApiState.json;
      const mimeType = format === 'yaml' ? 'application/yaml;charset=utf-8' : 'application/json;charset=utf-8';
      if (!downloadOperationOpenApiJson(content, filename, mimeType)) {
        message.error(t('apiOpenApi.download.unsupported'));
        return;
      }
      message.success(t(format === 'yaml' ? 'apiOpenApi.downloadYaml.started' : 'apiOpenApi.download.started'));
    } catch {
      message.error(t(format === 'yaml' ? 'apiOpenApi.downloadYaml.failed' : 'apiOpenApi.download.failed'));
    }
  };

  return (
    <OperationModeLayout activeKey="openapi">
      {openApiState.status === 'ready' ? (
        <div>
          {openApiState.downloadable ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <Space size="small">
                <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadPortable('json')}>
                  {t('apiOpenApi.download')}
                </Button>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadPortable('yaml')}>
                  {t('apiOpenApi.downloadYaml')}
                </Button>
              </Space>
            </div>
          ) : openApiState.notice ? (
            <Alert
              type={isWarningNotice(openApiState.notice.kind) ? 'warning' : 'info'}
              showIcon
              message={t(NOTICE_MESSAGE_KEYS[openApiState.notice.kind])}
              description={
                openApiState.notice.kind === 'oas31-blocked' || openApiState.notice.kind === 'oas32-blocked' ? (
                  <div>
                    <div>
                      {t(
                        openApiState.notice.kind === 'oas32-blocked'
                          ? 'apiOpenApi.download.oas32Blocked.desc'
                          : 'apiOpenApi.download.oas31Blocked.desc',
                      )}
                    </div>
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
