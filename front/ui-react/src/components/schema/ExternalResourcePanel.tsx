import { Alert, Button, Checkbox, Divider, List, Modal, Space, Spin, Tag, Typography, message } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useExternalResources, type ExternalResourceStatus } from '../../context/SchemaEngineContext';
import { safeResourceDisplay } from '../../schema/externalResourceGraph';
import './ExternalResourcePanel.css';

const { Text } = Typography;

function externalResourceSummaryKey(status: ExternalResourceStatus): string {
  return `resource.summary.${status}`;
}

const ExternalResourcePanel: React.FC = () => {
  const { t } = useTranslation();
  const resources = useExternalResources();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const pending = useMemo(
    () => resources.candidates.filter((candidate) => candidate.state === 'pending'),
    [resources.candidates],
  );
  const failed = useMemo(
    () => resources.candidates.filter((candidate) => candidate.state === 'failed'),
    [resources.candidates],
  );
  const loaded = useMemo(
    () =>
      resources.snapshot
        ? [...resources.snapshot.nodes.values()].filter(
            (node) => node.retrievalUri !== resources.snapshot?.entryRetrievalUri,
          )
        : [],
    [resources.snapshot],
  );

  useEffect(() => {
    const available = new Set(pending.map((candidate) => candidate.retrievalUriHash));
    setSelected((current) => current.filter((key) => available.has(key)));
  }, [pending]);

  if (resources.status === 'inactive') return null;
  if (
    resources.status === 'ready' &&
    loaded.length === 0 &&
    resources.diagnostics.length === 0 &&
    resources.candidates.length === 0
  ) {
    return null;
  }

  const alertType =
    resources.status === 'failed'
      ? 'error'
      : resources.status === 'pending' || resources.status === 'partial'
        ? 'warning'
        : resources.status === 'ready'
          ? 'success'
          : 'info';
  const summaryKey = externalResourceSummaryKey(resources.status);
  const busy = resources.status === 'loading' || resources.status === 'discovering';

  const handleLoadOnce = async (): Promise<void> => {
    await resources.loadOnce(selected);
    setSelected([]);
  };

  const handleRemember = async (): Promise<void> => {
    const persisted = await resources.rememberAndLoad(selected);
    if (persisted) message.success(t('resource.remembered'));
    else message.warning(t('resource.notRemembered'));
    setSelected([]);
  };

  return (
    <>
      <Alert
        className="knife4j-resource-alert"
        type={alertType}
        showIcon
        message={t(`${summaryKey}.title`, {
          pending: pending.length,
          loaded: loaded.length,
          failed: failed.length + resources.diagnostics.length,
        })}
        description={t(`${summaryKey}.description`)}
        action={
          <Button size="small" onClick={() => setOpen(true)}>
            {t('resource.open')}
          </Button>
        }
      />
      <Modal
        title={t('resource.modal.title')}
        width={780}
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          <Space wrap>
            {busy && (
              <Button danger onClick={resources.cancel}>
                {t('resource.cancelLoad')}
              </Button>
            )}
            <Button onClick={() => setOpen(false)}>{t('resource.close')}</Button>
            <Button disabled={selected.length === 0 || busy} onClick={() => void handleLoadOnce()}>
              {t('resource.loadOnce')}
            </Button>
            <Button type="primary" disabled={selected.length === 0 || busy} onClick={() => void handleRemember()}>
              {t('resource.rememberAndLoad')}
            </Button>
          </Space>
        }
      >
        <Alert
          type="warning"
          showIcon
          message={t('resource.security.title')}
          description={t('resource.security.body')}
        />

        <div className="knife4j-resource-section-heading">
          <Space>
            <Text strong>{t('resource.pending.title')}</Text>
            <Tag color={pending.length > 0 ? 'gold' : 'default'}>{pending.length}</Tag>
          </Space>
          {pending.length > 0 && (
            <Checkbox
              checked={selected.length === pending.length}
              indeterminate={selected.length > 0 && selected.length < pending.length}
              onChange={(event) =>
                setSelected(event.target.checked ? pending.map((candidate) => candidate.retrievalUriHash) : [])
              }
            >
              {t('resource.selectAll')}
            </Checkbox>
          )}
        </div>
        {busy && <Spin size="small" className="knife4j-resource-spinner" />}
        {pending.length === 0 ? (
          <Text type="secondary">{t('resource.pending.empty')}</Text>
        ) : (
          <List
            dataSource={pending}
            renderItem={(candidate) => (
              <List.Item className="knife4j-resource-passport">
                <Checkbox
                  checked={selected.includes(candidate.retrievalUriHash)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...new Set([...current, candidate.retrievalUriHash])]
                        : current.filter((key) => key !== candidate.retrievalUriHash),
                    )
                  }
                >
                  <Space direction="vertical" size={3}>
                    <Space wrap>
                      <Tag color={candidate.sameOrigin ? 'blue' : 'purple'}>
                        {t(candidate.sameOrigin ? 'resource.sameOrigin' : 'resource.crossOrigin')}
                      </Tag>
                      <Text code>{candidate.displayUri}</Text>
                    </Space>
                    <Text type="secondary">
                      {t('resource.referenceSummary', {
                        count: candidate.references.length,
                        source: candidate.references[0]?.sourcePointer ?? '#',
                      })}
                    </Text>
                    {candidate.references[0] && (
                      <Text className="knife4j-resource-canonical" type="secondary">
                        {t('resource.referenceDetails', {
                          kind: candidate.references[0].kind,
                          reference: candidate.references[0].rawReferenceDisplay,
                          base: candidate.references[0].resolutionBaseDisplay,
                          fragment: candidate.references[0].fragment || '#',
                        })}
                      </Text>
                    )}
                  </Space>
                </Checkbox>
              </List.Item>
            )}
          />
        )}

        {loaded.length > 0 && (
          <>
            <Divider />
            <div className="knife4j-resource-section-heading">
              <Text strong>{t('resource.loaded.title')}</Text>
              <Tag color="green">{loaded.length}</Tag>
            </div>
            <List
              dataSource={loaded}
              renderItem={(node) => {
                const sources =
                  resources.snapshot?.edges.filter((edge) => edge.targetRetrievalUri === node.retrievalUri) ?? [];
                return (
                  <List.Item className="knife4j-resource-passport knife4j-resource-passport-loaded">
                    <Space direction="vertical" size={3}>
                      <Space wrap>
                        <Tag color="green">{t('resource.loaded.tag')}</Tag>
                        <Tag>{t(`resource.authorization.${node.authorizationScope}`)}</Tag>
                        <Text code>{node.displayUri}</Text>
                      </Space>
                      <Text type="secondary">
                        {t('resource.loaded.meta', {
                          mediaType: node.mediaType,
                          bytes: node.byteLength,
                          resources: node.resourceUris.length,
                        })}
                      </Text>
                      {sources[0] && (
                        <Text type="secondary">
                          {t('resource.referenceSummary', { count: sources.length, source: sources[0].sourcePointer })}
                        </Text>
                      )}
                      {node.resourceUris.slice(0, 3).map((uri) => (
                        <Text className="knife4j-resource-canonical" type="secondary" key={uri}>
                          {safeResourceDisplay(uri)}
                        </Text>
                      ))}
                    </Space>
                  </List.Item>
                );
              }}
            />
          </>
        )}

        {(failed.length > 0 || resources.diagnostics.length > 0 || resources.registrationError) && (
          <>
            <Divider />
            <div className="knife4j-resource-section-heading">
              <Text strong>{t('resource.diagnostics.title')}</Text>
              <Tag color="red">{resources.diagnostics.length + (resources.registrationError ? 1 : 0)}</Tag>
            </div>
            <List
              dataSource={[...resources.diagnostics]}
              renderItem={(diagnostic) => {
                const retryCandidate = failed.find(
                  (candidate) =>
                    candidate.retrievalUriHash === diagnostic.targetRetrievalUriHash && candidate.retryable,
                );
                return (
                  <List.Item
                    actions={
                      retryCandidate
                        ? [
                            <Button
                              key="retry"
                              size="small"
                              disabled={busy}
                              onClick={() => void resources.retry(retryCandidate.retrievalUriHash)}
                            >
                              {t('resource.retry')}
                            </Button>,
                          ]
                        : undefined
                    }
                  >
                    <Space direction="vertical" size={2}>
                      <Space wrap>
                        <Tag color="red">{diagnostic.code}</Tag>
                        <Tag>{diagnostic.phase}</Tag>
                        {diagnostic.resourceDisplay && <Text code>{diagnostic.resourceDisplay}</Text>}
                      </Space>
                      <Text type="secondary">{diagnostic.sourcePointer}</Text>
                    </Space>
                  </List.Item>
                );
              }}
            />
            {resources.registrationError && (
              <Alert
                type="error"
                showIcon
                message={resources.registrationError.code ?? 'RESOURCE_REGISTER_FAILED'}
                description={t('resource.registrationFailed')}
              />
            )}
          </>
        )}
      </Modal>
    </>
  );
};

export default ExternalResourcePanel;
