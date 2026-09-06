import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Select, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  evaluateOperationExample,
  exampleDefaultTarget,
  type OperationExampleResult,
  type OperationExampleTarget,
} from '../../schema/operationExampleCatalog';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import SchemaExampleNotice from './SchemaExampleNotice';
import CodeBlock from '../../pages/api/CodeBlock';

export interface OperationExamplePickerProps {
  readonly targets: readonly OperationExampleTarget[];
  readonly session?: SchemaDocumentSession;
  readonly onApply?: (result: OperationExampleResult, editRevision: number) => void;
  readonly editRevision?: () => number;
}

export default function OperationExamplePicker({
  targets,
  session,
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
  if (!target) return null;
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
          <Typography.Text strong>{t('schema.example32.data')}</Typography.Text>
          <CodeBlock code={JSON.stringify(representation.data, null, 2)} />
        </>
      )}
      {representation?.text !== undefined && (
        <>
          <Typography.Text strong>{t('schema.example32.serialized')}</Typography.Text>
          <CodeBlock code={representation.text} />
        </>
      )}
      {representation?.serialized !== undefined && representation.text === undefined && (
        <CodeBlock code={representation.serialized} />
      )}
      <Typography.Text type="secondary" style={{ fontSize: 11, overflowWrap: 'anywhere' }}>
        {target.sourceLocation.ownerRetrievalUri}
        {target.sourceLocation.pointer}
      </Typography.Text>
    </Space>
  );
}
