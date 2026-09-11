import { Alert, Button, Select, Space, Typography } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ExampleRepresentation } from 'knife4j-core';
import { SchemaTypeLink } from './SchemaFieldTable';
import CodeBlock from '../../pages/api/CodeBlock';
import type { ResourceGraphSnapshot } from '../../schema/externalResourceGraph';
import {
  discriminatorGenerationSchemaLocation,
  generateDiscriminatorCandidate,
  type DiscriminatorGenerationResult,
} from '../../schema/schemaDiscriminatorGeneration';
import type {
  DiscriminatorCandidate,
  DiscriminatorTarget,
  SchemaDiscriminatorMetadata,
  SchemaDiscriminatorSelection,
} from '../../schema/schemaDiscriminator';
import type { SchemaDocumentSession } from '../../schema/schemaDocumentSession';
import type { SchemaExampleDirection } from '../../schema/schemaExampleGeneration';
import {
  discriminatorCandidateChoices,
  discriminatorMetadataVisible,
  isDynamicScopeGenerationUnavailable,
  schemaDiscriminatorAllowsModelRoute,
  schemaDiscriminatorTargetLabel,
  selectDiscriminatorExampleHint,
  selectedDiscriminatorCandidateId,
} from '../../schema/schemaDiscriminatorView';

export interface SchemaDiscriminatorPanelProps {
  readonly metadata?: SchemaDiscriminatorMetadata;
  readonly snapshot?: ResourceGraphSnapshot | null;
  readonly session?: SchemaDocumentSession;
  readonly direction?: SchemaExampleDirection;
  readonly representation?: ExampleRepresentation;
  readonly missingPropertyValidated?: boolean;
  readonly operationToken: string;
  readonly onApplyGenerated?: (value: unknown, schemaLocation?: { ownerRetrievalUri: string; pointer: string }) => void;
}

function targetPreviewNode(target: DiscriminatorTarget) {
  return {
    name: '',
    type: 'object' as const,
    required: false,
    ...(schemaDiscriminatorAllowsModelRoute(target.location) ? { refName: target.location.componentName } : {}),
  };
}

export default function SchemaDiscriminatorPanel({
  metadata,
  snapshot,
  session,
  direction = 'request',
  representation,
  missingPropertyValidated,
  operationToken,
  onApplyGenerated,
}: SchemaDiscriminatorPanelProps) {
  const { t } = useTranslation();
  const [selectionToken, setSelectionToken] = useState('idle');
  const [branchByTarget, setBranchByTarget] = useState<Record<string, string>>({});
  const [generation, setGeneration] = useState<{
    token: string;
    targetId: string;
    result: DiscriminatorGenerationResult;
  }>();
  const pending = useRef(0);
  const hint: SchemaDiscriminatorSelection | undefined = useMemo(() => {
    if (!metadata || !discriminatorMetadataVisible(metadata)) return undefined;
    return selectDiscriminatorExampleHint(metadata, representation, { missingPropertyValidated });
  }, [metadata, missingPropertyValidated, representation]);

  useEffect(() => {
    pending.current += 1;
    setSelectionToken(`sel-${pending.current}`);
    setGeneration(undefined);
    setBranchByTarget({});
  }, [metadata, operationToken, representation, snapshot]);

  if (!metadata || !discriminatorMetadataVisible(metadata)) return null;

  const generate = async (target: DiscriminatorTarget) => {
    if (!snapshot || !session) return;
    const token = `sel-${pending.current}`;
    const choices = discriminatorCandidateChoices(metadata, target);
    const chosenId = selectedDiscriminatorCandidateId(branchByTarget[target.id], choices);
    const result = await generateDiscriminatorCandidate({
      metadata,
      snapshot,
      generation: snapshot.generation,
      requested: metadata.requested,
      session,
      direction,
      targetId: target.id,
      ...(chosenId === undefined ? {} : { candidateId: chosenId }),
      operationToken,
      selectionToken: token,
    });
    if (token !== `sel-${pending.current}`) return;
    setGeneration({ token, targetId: target.id, result });
  };

  const generated = generation && generation.token === selectionToken ? generation : undefined;
  const generatedValue = generated?.result.status === 'value' ? generated.result.value : undefined;
  const generatedUnavailable = generated?.result.status === 'none' ? generated.result : undefined;

  return (
    <Space
      direction="vertical"
      style={{ width: '100%', marginBottom: 12 }}
      data-discriminator-panel=""
      data-discriminator-status={metadata.status}
    >
      <Typography.Text strong>{t('schema.discriminator.title')}</Typography.Text>
      <Typography.Text type="secondary">{t('schema.discriminator.validationIndependent')}</Typography.Text>
      {metadata.propertyName !== undefined && (
        <div>
          <Typography.Text type="secondary">{t('schema.discriminator.propertyName')}: </Typography.Text>
          <Typography.Text code data-discriminator-property="">
            {metadata.propertyName}
          </Typography.Text>
        </div>
      )}
      <div>
        <Typography.Text type="secondary">{t('schema.discriminator.configuration')}: </Typography.Text>
        <Typography.Text code>{metadata.configuration}</Typography.Text>
      </div>
      <div>
        <Typography.Text type="secondary">{t('schema.discriminator.requirement')}: </Typography.Text>
        <Typography.Text>{t(`schema.discriminator.requirement.${metadata.requirement}`)}</Typography.Text>
      </div>
      {hint && (
        <Alert
          type="info"
          showIcon
          data-discriminator-hint={hint.status}
          data-discriminator-reason={hint.reason ?? ''}
          message={t('schema.discriminator.hint')}
          description={`${t(`schema.discriminator.hint.${hint.status}`)}${
            hint.reason ? ` · ${t(`schema.discriminator.reason.${hint.reason}`)}` : ''
          }`}
        />
      )}
      {metadata.diagnostics.map((diagnostic, index) => (
        <Alert
          key={`${diagnostic.code}:${index}`}
          type="warning"
          showIcon
          message={t('schema.discriminator.diagnostic', { code: diagnostic.code })}
        />
      ))}
      {metadata.targets.map((target) => {
        const choices = discriminatorCandidateChoices(metadata, target);
        const inPlace = !schemaDiscriminatorAllowsModelRoute(target.location);
        return (
          <div
            key={target.id}
            data-discriminator-target={target.source}
            data-discriminator-key={target.key ?? ''}
            data-discriminator-state={target.state}
            style={{ border: '1px solid var(--ant-color-border, #f0f0f0)', padding: 8 }}
          >
            <Space wrap>
              <Typography.Text>{t(`schema.discriminator.source.${target.source}`)}</Typography.Text>
              {target.key !== undefined && <Typography.Text code>{target.key}</Typography.Text>}
              <Typography.Text type="secondary">{t(`schema.discriminator.state.${target.state}`)}</Typography.Text>
              {inPlace ? (
                <Typography.Text data-discriminator-preview="external" style={{ overflowWrap: 'anywhere' }}>
                  {t('schema.discriminator.preview.external')}: {schemaDiscriminatorTargetLabel(target)}
                </Typography.Text>
              ) : (
                <span data-discriminator-preview="model">
                  <SchemaTypeLink node={targetPreviewNode(target)} />
                </span>
              )}
            </Space>
            {choices.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Typography.Text type="secondary">{t('schema.discriminator.candidates')}: </Typography.Text>
                {choices.length > 1 ? (
                  <Select
                    aria-label={t('schema.discriminator.candidates')}
                    size="small"
                    style={{ minWidth: 240 }}
                    value={branchByTarget[target.id]}
                    placeholder={t('schema.discriminator.generate.ambiguous')}
                    options={choices.map((candidate) => ({
                      value: candidate.id,
                      label: candidateLabel(candidate),
                    }))}
                    onChange={(id) => setBranchByTarget((current) => ({ ...current, [target.id]: id }))}
                  />
                ) : (
                  <Typography.Text code>{candidateLabel(choices[0]!)}</Typography.Text>
                )}
              </div>
            )}
            {session && snapshot && target.state === 'resolved' && (
              <Button
                size="small"
                style={{ marginTop: 8 }}
                data-discriminator-generate={target.source}
                disabled={selectedDiscriminatorCandidateId(branchByTarget[target.id], choices) === undefined}
                onClick={() => void generate(target)}
              >
                {t('schema.discriminator.generate')}
              </Button>
            )}
          </div>
        );
      })}
      {generated && generatedValue !== undefined && (
        <div data-discriminator-generated="">
          <Typography.Text strong>{t('schema.discriminator.generated')}</Typography.Text>
          <CodeBlock code={JSON.stringify(generatedValue, null, 2)} />
          {onApplyGenerated && (
            <Button
              size="small"
              onClick={() => onApplyGenerated(generatedValue, discriminatorGenerationSchemaLocation(generated.result))}
            >
              {t('schema.example32.apply')}
            </Button>
          )}
        </div>
      )}
      {generatedUnavailable && (
        <Alert
          type="warning"
          showIcon
          data-discriminator-generated-unavailable={generatedUnavailable.reason}
          message={
            generatedUnavailable.diagnostics.some((item) => isDynamicScopeGenerationUnavailable(item.code))
              ? t('schema.discriminator.generate.dynamicUnavailable')
              : generatedUnavailable.reason === 'ambiguous'
                ? t('schema.discriminator.generate.ambiguous')
                : t('schema.discriminator.generate.unavailable')
          }
        />
      )}
      {metadata.candidates.length > 0 && (
        <Typography.Text type="secondary">{t('schema.discriminator.compositionVisible')}</Typography.Text>
      )}
    </Space>
  );
}

function candidateLabel(candidate: DiscriminatorCandidate): string {
  const name = schemaDiscriminatorAllowsModelRoute(candidate.location)
    ? candidate.location.componentName
    : candidate.location.reference;
  return `${candidate.composition} · ${name}`;
}
