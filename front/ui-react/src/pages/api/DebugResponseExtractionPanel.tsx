import { DeleteOutlined, PlayCircleOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Input, Select, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { COMMON_HEADER_NAMES } from '../../constants/httpHeaders';
import {
  RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH,
  RESPONSE_EXTRACTION_MAX_PREFIX_LENGTH,
  RESPONSE_EXTRACTION_MAX_RULES,
  RESPONSE_EXTRACTION_MAX_TARGET_NAME_LENGTH,
  createEmptyExtractionRule,
  type ResponseExtractionItemLog,
  type ResponseExtractionItemReasonCode,
  type ResponseExtractionRule,
  type ResponseExtractionRunLog,
} from './responseExtraction';

const { Text } = Typography;

interface DebugResponseExtractionPanelProps {
  group: string | undefined;
  rules: readonly ResponseExtractionRule[];
  persistenceFailed: boolean;
  hasResponse: boolean;
  extractionLog: ResponseExtractionRunLog | null;
  onRulesChange: (nextRules: ResponseExtractionRule[]) => void;
  onDryRun: () => void;
  onApplyNow: () => void;
}

function renderReasonText(
  t: ReturnType<typeof useTranslation>['t'],
  reasonCode: ResponseExtractionItemReasonCode | undefined,
  reasonDetail: string | undefined,
): string {
  if (!reasonCode) return '';
  const base = t(`apiDebug.extract.reason.${reasonCode}`);
  return reasonDetail && reasonCode === 'eval-error' ? `${base} (${reasonDetail})` : base;
}

export function DebugResponseExtractionPanel({
  group,
  rules,
  persistenceFailed,
  hasResponse,
  extractionLog,
  onRulesChange,
  onDryRun,
  onApplyNow,
}: DebugResponseExtractionPanelProps) {
  const { t } = useTranslation();
  const limitReached = rules.length >= RESPONSE_EXTRACTION_MAX_RULES;
  const hasEnabledRules = rules.some((rule) => rule.enabled);
  const canApplyDryRun =
    hasResponse &&
    extractionLog?.mode === 'dry-run' &&
    extractionLog.status === 'executed' &&
    extractionLog.items.some((item) => item.status === 'preview');

  const updateRule = (id: string, patch: Partial<ResponseExtractionRule>) => {
    onRulesChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const removeRule = (id: string) => {
    onRulesChange(rules.filter((rule) => rule.id !== id));
  };

  const addRule = () => {
    if (limitReached) return;
    onRulesChange([...rules, createEmptyExtractionRule()]);
  };

  const renderItemStatusTag = (item: ResponseExtractionItemLog) => {
    if (item.status === 'updated') {
      return <Tag color="success">{t('apiDebug.extract.status.updated')}</Tag>;
    }
    if (item.status === 'preview') {
      return <Tag color="processing">{t('apiDebug.extract.status.preview')}</Tag>;
    }
    return <Tag color="error">{t('apiDebug.extract.status.failed')}</Tag>;
  };

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size={12}>
      {persistenceFailed && <Alert type="warning" showIcon title={t('storage.persistenceFailed')} />}

      <Alert type="info" showIcon title={t('apiDebug.extract.tip')} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space wrap>
          <Button type="primary" size="small" icon={<PlusOutlined />} disabled={limitReached} onClick={addRule}>
            {t('apiDebug.extract.addRule')}
          </Button>
          <Tooltip title={!hasResponse ? t('apiDebug.extract.dryRunNoResponse') : undefined}>
            <Button
              size="small"
              icon={<PlayCircleOutlined />}
              disabled={!hasResponse || !hasEnabledRules}
              onClick={onDryRun}
            >
              {t('apiDebug.extract.dryRun')}
            </Button>
          </Tooltip>
          {canApplyDryRun && (
            <Button size="small" type="default" icon={<SaveOutlined />} onClick={onApplyNow}>
              {t('apiDebug.extract.applyNow')}
            </Button>
          )}
          {limitReached && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('apiDebug.extract.maxRulesReached', { max: RESPONSE_EXTRACTION_MAX_RULES })}
            </Text>
          )}
        </Space>
        <Link to={`/${encodeURIComponent(group ?? '')}/globalParam`}>{t('apiDebug.extract.viewGlobalParams')}</Link>
      </div>

      <datalist id="knife4j-response-extraction-header-names">
        {COMMON_HEADER_NAMES.map((name) => (
          <option value={name} key={name} />
        ))}
      </datalist>

      {rules.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('apiDebug.extract.empty')} />
      ) : (
        <Space orientation="vertical" style={{ width: '100%' }} size={8}>
          {rules.map((rule, index) => (
            <Card key={rule.id} size="small" styles={{ body: { padding: '10px 12px' } }}>
              <Space orientation="vertical" style={{ width: '100%' }} size={8}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Switch
                    size="small"
                    checked={rule.enabled}
                    aria-label={t('apiDebug.extract.ruleEnabled', { index: index + 1 })}
                    onChange={(enabled) => updateRule(rule.id, { enabled })}
                  />
                  <Select
                    size="small"
                    aria-label={t('apiDebug.extract.source')}
                    value={rule.source}
                    style={{ width: 136 }}
                    options={[
                      { value: 'json-body', label: t('apiDebug.extract.source.jsonBody') },
                      { value: 'header', label: t('apiDebug.extract.source.header') },
                    ]}
                    onChange={(source) => updateRule(rule.id, { source })}
                  />
                  <Input
                    size="small"
                    aria-label={t('apiDebug.extract.expression')}
                    value={rule.expression}
                    maxLength={RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH}
                    placeholder={
                      rule.source === 'header'
                        ? t('apiDebug.extract.expressionPlaceholder.header')
                        : t('apiDebug.extract.expressionPlaceholder.jsonBody')
                    }
                    style={{ flex: 1, minWidth: 180 }}
                    onChange={(event) => updateRule(rule.id, { expression: event.target.value })}
                  />
                  <Input
                    size="small"
                    aria-label={t('apiDebug.extract.prefix')}
                    value={rule.prefix}
                    maxLength={RESPONSE_EXTRACTION_MAX_PREFIX_LENGTH}
                    placeholder={t('apiDebug.extract.prefixPlaceholder')}
                    style={{ width: 140 }}
                    onChange={(event) => updateRule(rule.id, { prefix: event.target.value })}
                  />
                  <Button
                    size="small"
                    type="text"
                    danger
                    aria-label={t('apiDebug.extract.deleteRule')}
                    icon={<DeleteOutlined />}
                    onClick={() => removeRule(rule.id)}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 36 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('apiDebug.extract.writeTo')}
                  </Text>
                  <Select
                    size="small"
                    aria-label={t('apiDebug.extract.targetScope')}
                    value={rule.targetScope}
                    style={{ width: 120 }}
                    options={[
                      { value: 'group', label: t('globalParam.scope.group') },
                      { value: 'application', label: t('globalParam.scope.application') },
                    ]}
                    onChange={(targetScope) => updateRule(rule.id, { targetScope })}
                  />
                  <Select
                    size="small"
                    aria-label={t('apiDebug.extract.targetIn')}
                    value={rule.targetIn}
                    style={{ width: 96 }}
                    options={[
                      { value: 'header', label: 'header' },
                      { value: 'query', label: 'query' },
                    ]}
                    onChange={(targetIn) => updateRule(rule.id, { targetIn })}
                  />
                  <Input
                    size="small"
                    aria-label={t('apiDebug.extract.targetName')}
                    value={rule.targetName}
                    maxLength={RESPONSE_EXTRACTION_MAX_TARGET_NAME_LENGTH}
                    list={rule.targetIn === 'header' ? 'knife4j-response-extraction-header-names' : undefined}
                    placeholder={t('apiDebug.extract.targetNamePlaceholder')}
                    style={{ flex: 1, minWidth: 160 }}
                    onChange={(event) => updateRule(rule.id, { targetName: event.target.value })}
                  />
                  <Space size={4}>
                    <Switch
                      size="small"
                      checked={rule.masked}
                      aria-label={t('apiDebug.extract.masked')}
                      onChange={(masked) => updateRule(rule.id, { masked })}
                    />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('apiDebug.extract.masked')}
                    </Text>
                  </Space>
                </div>
              </Space>
            </Card>
          ))}
        </Space>
      )}

      {extractionLog && (
        <Card
          size="small"
          title={
            <Space size={8}>
              <span>{t('apiDebug.extract.logTitle')}</span>
              <Tag>
                {t(extractionLog.mode === 'dry-run' ? 'apiDebug.extract.mode.dryRun' : 'apiDebug.extract.mode.auto')}
              </Tag>
            </Space>
          }
          styles={{ body: { padding: '10px 12px' } }}
        >
          {extractionLog.status === 'skipped' ? (
            <Text type="secondary">
              {extractionLog.skipReason === 'non-2xx'
                ? t('apiDebug.extract.skip.non2xx', { status: extractionLog.httpStatus })
                : extractionLog.skipReason === 'unsupported-response-kind'
                  ? t('apiDebug.extract.skip.unsupportedKind')
                  : t('apiDebug.extract.skip.noEnabledRules')}
            </Text>
          ) : (
            <Space orientation="vertical" style={{ width: '100%' }} size={6}>
              {extractionLog.items.map((item) => (
                <div
                  key={item.ruleId}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: '6px 8px',
                    borderRadius: 4,
                    background: '#fafafa',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {renderItemStatusTag(item)}
                    <Tag>
                      {t(
                        item.targetScope === 'application'
                          ? 'globalParam.scope.application'
                          : 'globalParam.scope.group',
                      )}
                    </Tag>
                    <Tag>{item.targetIn}</Tag>
                    <Text strong>{item.targetName || t('apiDebug.extract.unnamedTarget')}</Text>
                    <Text type="secondary" code style={{ fontSize: 12 }}>
                      {item.source === 'header' ? `header:${item.expression}` : item.expression || '—'}
                    </Text>
                    {item.valuePreview !== undefined && (
                      <Text code style={{ fontSize: 12 }}>
                        {item.valuePreview}
                      </Text>
                    )}
                  </div>
                  {item.reasonCode && (
                    <Text type="danger" style={{ fontSize: 12 }}>
                      {renderReasonText(t, item.reasonCode, item.reasonDetail)}
                    </Text>
                  )}
                  {item.shadowedByGroup && (
                    <Text type="warning" style={{ fontSize: 12 }}>
                      {t('apiDebug.extract.shadowedByGroup')}
                    </Text>
                  )}
                </div>
              ))}
            </Space>
          )}
        </Card>
      )}
    </Space>
  );
}
