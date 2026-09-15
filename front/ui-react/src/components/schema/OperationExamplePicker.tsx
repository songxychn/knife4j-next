import { isJsonMediaType } from 'knife4j-core';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Select, Space, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  evaluateOperationExample,
  exampleDefaultTarget,
  type OperationExampleResult,
  type OperationExampleTarget,
} from '../../schema/operationExampleCatalog';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import SchemaExampleNotice from './SchemaExampleNotice';
import SchemaDiscriminatorPanel from './SchemaDiscriminatorPanel';
import CodeBlock from '../../pages/api/CodeBlock';
import type { ResourceGraphSnapshot } from '../../schema/externalResourceGraph';
import { describeSchemaDiscriminator, discriminatorLocationFromOpenApi } from '../../schema/schemaDiscriminatorView';
import {
  canApplyGeneratedExample,
  materializeDiscriminatorGeneratedExample,
  shouldCommitGeneratedExample,
} from '../../schema/oas32XmlExample';

export interface OperationExamplePickerProps {
  readonly targets: readonly OperationExampleTarget[];
  readonly session?: SchemaDocumentSession;
  readonly snapshot?: ResourceGraphSnapshot | null;
  readonly operationToken?: string;
  readonly onApply?: (result: OperationExampleResult, editRevision: number) => void;
  readonly editRevision?: () => number;
}

export default function OperationExamplePicker({
  targets,
  session,
  snapshot,
  operationToken,
  onApply,
  editRevision,
}: OperationExamplePickerProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string>();
  const target = targets.find((item) => item.id === selected) ?? exampleDefaultTarget(targets);
  const [state, setState] = useState<{
    target: OperationExampleTarget;
    session?: SchemaDocumentSession;
    result: OperationExampleResult;
  }>();
  const pendingApply = useRef<{ id: string; revision: number }>();
  const callbacks = useRef({ onApply, editRevision });
  callbacks.current = { onApply, editRevision };
  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    evaluateOperationExample(target, session, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setState({ target, session, result });
        const pending = pendingApply.current;
        if (pending?.id === target.id && pending.revision === callbacks.current.editRevision?.()) {
          callbacks.current.onApply?.(result, pending.revision);
          pendingApply.current = undefined;
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        void evaluateOperationExample(target).then((result) => {
          if (!controller.signal.aborted) setState({ target, session, result });
        });
      });
    return () => controller.abort();
  }, [target, session]);
  const result = state && state.target === target && state.session === session ? state.result : undefined;
  const representation = result?.representation;
  // Reuse the representation's safe decode/pairing checks; presentation must never reserialize author text.
  const collapseSerialized =
    target?.layer === 'media' &&
    isJsonMediaType(target.mediaType ?? target.context.mediaType ?? '') &&
    !target.itemSchemaLocation &&
    representation?.data !== undefined &&
    representation.text !== undefined &&
    !representation.external &&
    representation.serialization === 'valid' &&
    (representation.pairing === 'valid' || representation.pairing === 'absent') &&
    representation.diagnostics.length === 0;
  if (!target) return null;
  const discriminator = snapshot
    ? (() => {
        const location = discriminatorLocationFromOpenApi(snapshot, target.schemaLocation);
        return location ? describeSchemaDiscriminator(snapshot, location) : undefined;
      })()
    : undefined;
  const renderHelp = (kind: 'data' | 'serialized') => (
    <Tooltip title={t(`schema.example32.${kind}Help`)} trigger={['hover', 'focus']}>
      <Button
        type="text"
        size="small"
        aria-label={t('schema.example32.helpLabel', { name: t(`schema.example32.${kind}`) })}
        icon={<QuestionCircleOutlined style={{ opacity: 0.65 }} />}
        style={{ width: 20, height: 20, padding: 0, marginInlineStart: 4, verticalAlign: 'middle' }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      />
    </Tooltip>
  );
  return (
    <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }} data-example-group={target.group}>
      <Space wrap>
        <Typography.Text strong>{t('schema.example32.choose')}</Typography.Text>
        <Select
          aria-label={t('schema.example32.choose')}
          value={target.id}
          style={{ minWidth: 240, maxWidth: '100%' }}
          options={targets.map((item) => ({
            value: item.id,
            label: `${item.name === 'candidate' && !item.source ? t('schema.example32.candidate') : item.name} · ${t(`schema.example32.layer.${item.layer}`)}${item.mediaType ? ` · ${item.mediaType}` : ''}${item.summary ? ` · ${item.summary}` : ''}`,
          }))}
          onChange={(id) => {
            pendingApply.current = { id, revision: editRevision?.() ?? 0 };
            setSelected(id);
          }}
        />
        {onApply && (
          <Button size="small" disabled={!result} onClick={() => result && onApply(result, editRevision?.() ?? 0)}>
            {t('schema.example32.apply')}
          </Button>
        )}
      </Space>
      {target.description && (
        <Typography.Paragraph style={{ marginBottom: 0 }}>{target.description}</Typography.Paragraph>
      )}
      {!result && <Typography.Text type="secondary">{t('schema.example.loading.title')}</Typography.Text>}
      {result?.schemaResult && <SchemaExampleNotice result={result.schemaResult} />}
      {discriminator && (
        <SchemaDiscriminatorPanel
          metadata={discriminator}
          snapshot={snapshot}
          session={session}
          direction={target.direction}
          representation={representation}
          missingPropertyValidated={
            result?.schemaResult?.status === 'value' && result.schemaResult.validation === 'valid'
          }
          operationToken={operationToken ?? target.operationIdentity}
          onApplyGenerated={
            onApply && result && target.group.startsWith('body:')
              ? (value, branchLocation) => {
                  void (async () => {
                    const revision = callbacks.current.editRevision?.() ?? 0;
                    const representation = await materializeDiscriminatorGeneratedExample({
                      value,
                      snapshot: snapshot ?? target.snapshot,
                      session,
                      schemaLocation:
                        branchLocation ??
                        (target.schemaLocation
                          ? {
                              ownerRetrievalUri: target.schemaLocation.ownerRetrievalUri,
                              pointer: target.schemaLocation.pointer,
                            }
                          : undefined),
                      mediaType: target.mediaType ?? target.context.mediaType,
                    });
                    if (
                      !shouldCommitGeneratedExample(
                        revision,
                        callbacks.current.editRevision?.() ?? 0,
                        canApplyGeneratedExample(representation) ? representation : undefined,
                      )
                    ) {
                      return;
                    }
                    callbacks.current.onApply?.({ ...result, authored: false, representation }, revision);
                  })();
                }
              : undefined
          }
        />
      )}
      {result?.serializedSchemaResult && (
        <>
          <Typography.Text>
            {t('schema.example32.serializedDataValidation')}:{' '}
            {t(
              `schema.example32.status.${result.serializedSchemaResult.status === 'value' ? result.serializedSchemaResult.validation : 'unavailable'}`,
            )}
          </Typography.Text>
          <SchemaExampleNotice result={result.serializedSchemaResult} />
        </>
      )}
      {representation && (
        <Typography.Text type="secondary">
          {t('schema.example32.checks', {
            data:
              result?.schemaResult?.status === 'value'
                ? t(`schema.example32.status.${result.schemaResult.validation}`)
                : t('schema.example32.status.absent'),
            serialization: t(`schema.example32.status.${representation.serialization}`),
            pairing: t(`schema.example32.status.${representation.pairing}`),
          })}
        </Typography.Text>
      )}
      {representation?.diagnostics.length ? (
        <Alert
          type="warning"
          showIcon
          message={t('schema.example32.diagnostic')}
          description={representation.diagnostics
            .map((diagnostic) => t(`schema.example32.diagnostics.${diagnostic.code}`))
            .join(' ')}
        />
      ) : null}
      {representation?.external && (
        <>
          <Typography.Text strong>{t('schema.example32.external')}</Typography.Text>
          <Typography.Text code>{representation.external.resolvedUri ?? representation.external.value}</Typography.Text>
        </>
      )}
      {representation && Object.prototype.hasOwnProperty.call(representation, 'data') && (
        <>
          <Typography.Text strong>
            {t('schema.example32.data')}
            {renderHelp('data')}
          </Typography.Text>
          <CodeBlock code={JSON.stringify(representation.data, null, 2)} />
        </>
      )}
      {representation?.text !== undefined &&
        (collapseSerialized ? (
          <details key={target.id}>
            <summary style={{ cursor: 'pointer' }}>
              <Typography.Text strong>
                {t('schema.example32.showSerialized')}
                {renderHelp('serialized')}
              </Typography.Text>
            </summary>
            <CodeBlock code={representation.text} />
          </details>
        ) : (
          <>
            <Typography.Text strong>
              {t('schema.example32.serialized')}
              {renderHelp('serialized')}
            </Typography.Text>
            <CodeBlock code={representation.text} />
          </>
        ))}
      {representation?.serialized !== undefined && representation.text === undefined && (
        <>
          <Typography.Text strong>
            {t('schema.example32.serialized')}
            {renderHelp('serialized')}
          </Typography.Text>
          <CodeBlock code={representation.serialized} />
        </>
      )}
      <Typography.Text type="secondary" style={{ fontSize: 11, overflowWrap: 'anywhere' }}>
        {target.sourceLocation.ownerRetrievalUri}
        {target.sourceLocation.pointer}
      </Typography.Text>
    </Space>
  );
}
