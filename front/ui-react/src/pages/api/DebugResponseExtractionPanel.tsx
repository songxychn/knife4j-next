import { DeleteOutlined, EditOutlined, LockOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Modal, Radio, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { COMMON_HEADER_NAMES } from '../../constants/httpHeaders';
import { createClientId } from '../../utils/id';
import {
  RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH,
  RESPONSE_EXTRACTION_MAX_PREFIX_LENGTH,
  RESPONSE_EXTRACTION_MAX_RULES,
  RESPONSE_EXTRACTION_MAX_TARGET_NAME_LENGTH,
  evaluateResponseExtraction,
  type ResponseExtractionInput,
  type ResponseExtractionItemLog,
  type ResponseExtractionItemReasonCode,
  type ResponseExtractionRule,
  type ResponseExtractionRunLog,
} from './responseExtraction';

const { Text } = Typography;

type RuleFormValues = Omit<ResponseExtractionRule, 'id'>;

const DEFAULT_RULE_VALUES: RuleFormValues = {
  enabled: true,
  source: 'json-body',
  expression: '',
  prefix: '',
  targetScope: 'group',
  targetIn: 'header',
  targetName: '',
  masked: true,
};

const BEARER_TOKEN_TEMPLATE: RuleFormValues = {
  enabled: true,
  source: 'json-body',
  expression: '$.data.token',
  prefix: 'Bearer ',
  targetScope: 'group',
  targetIn: 'header',
  targetName: 'Authorization',
  masked: true,
};

interface DebugResponseExtractionPanelProps {
  group: string | undefined;
  rules: readonly ResponseExtractionRule[];
  persistenceFailed: boolean;
  currentResponseInput: ResponseExtractionInput | null;
  extractionLog: ResponseExtractionRunLog | null;
  onRulesChange: (nextRules: ResponseExtractionRule[]) => void;
  onApplyCurrentResponse: (rulesOverride?: readonly ResponseExtractionRule[]) => void;
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
  currentResponseInput,
  extractionLog,
  onRulesChange,
  onApplyCurrentResponse,
}: DebugResponseExtractionPanelProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<RuleFormValues>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const watchedSource = Form.useWatch('source', form) ?? 'json-body';
  const watchedExpression = Form.useWatch('expression', form) ?? '';
  const watchedPrefix = Form.useWatch('prefix', form) ?? '';
  const watchedTargetScope = Form.useWatch('targetScope', form) ?? 'group';
  const watchedTargetIn = Form.useWatch('targetIn', form) ?? 'header';
  const watchedTargetName = Form.useWatch('targetName', form) ?? '';
  const watchedMasked = Form.useWatch('masked', form) ?? true;

  const limitReached = rules.length >= RESPONSE_EXTRACTION_MAX_RULES;

  const logByRuleId = useMemo(() => {
    const map = new Map<string, ResponseExtractionItemLog>();
    if (extractionLog?.status === 'executed') {
      for (const item of extractionLog.items) {
        map.set(item.ruleId, item);
      }
    }
    return map;
  }, [extractionLog]);

  const livePreview = useMemo(() => {
    if (!modalOpen || !currentResponseInput) return null;
    if (!watchedExpression.trim()) return null;
    const draftRule: ResponseExtractionRule = {
      id: editingId ?? 'draft-preview',
      enabled: true,
      source: watchedSource,
      expression: watchedExpression,
      prefix: watchedPrefix,
      targetScope: watchedTargetScope,
      targetIn: watchedTargetIn,
      targetName: watchedTargetName.trim() || 'preview',
      masked: watchedMasked,
    };
    return evaluateResponseExtraction([draftRule], currentResponseInput, { mode: 'dry-run' }).log;
  }, [
    currentResponseInput,
    editingId,
    modalOpen,
    watchedExpression,
    watchedMasked,
    watchedPrefix,
    watchedSource,
    watchedTargetIn,
    watchedTargetName,
    watchedTargetScope,
  ]);

  const livePreviewItem = livePreview?.status === 'executed' ? livePreview.items[0] : undefined;
  const canApplyOnSave = livePreviewItem?.status === 'preview';

  const openModal = (initial: RuleFormValues, id: string | null) => {
    setEditingId(id);
    setModalOpen(true);
    form.setFieldsValue(initial);
  };

  const openAdd = () => {
    if (limitReached) return;
    openModal(DEFAULT_RULE_VALUES, null);
  };

  const openBearerTemplate = () => {
    if (limitReached) return;
    openModal(BEARER_TOKEN_TEMPLATE, null);
  };

  const openEdit = (rule: ResponseExtractionRule) => {
    openModal(
      {
        enabled: rule.enabled,
        source: rule.source,
        expression: rule.expression,
        prefix: rule.prefix,
        targetScope: rule.targetScope,
        targetIn: rule.targetIn,
        targetName: rule.targetName,
        masked: rule.masked,
      },
      rule.id,
    );
  };

  const handleSave = async (applyImmediately: boolean) => {
    const values = await form.validateFields();
    const normalized: ResponseExtractionRule = {
      id: editingId ?? createClientId(),
      enabled: values.enabled !== false,
      source: values.source,
      expression: values.expression.trim(),
      prefix: values.prefix ?? '',
      targetScope: values.targetScope,
      targetIn: values.targetIn,
      targetName: values.targetName.trim(),
      masked: values.masked !== false,
    };
    const nextRules = editingId
      ? rules.map((rule) => (rule.id === editingId ? normalized : rule))
      : [...rules, normalized];
    onRulesChange(nextRules);
    setModalOpen(false);
    setEditingId(null);
    if (applyImmediately) {
      onApplyCurrentResponse(nextRules);
    }
  };

  const toggleRule = (id: string, enabled: boolean) => {
    onRulesChange(rules.map((rule) => (rule.id === id ? { ...rule, enabled } : rule)));
  };

  const removeRule = (id: string) => {
    onRulesChange(rules.filter((rule) => rule.id !== id));
  };

  const renderStatusCell = (rule: ResponseExtractionRule) => {
    const item = logByRuleId.get(rule.id);
    if (!item) {
      return <Text type="secondary">—</Text>;
    }
    if (item.status === 'failed') {
      const reason = renderReasonText(t, item.reasonCode, item.reasonDetail);
      return (
        <Tooltip title={reason}>
          <Space size={4} wrap>
            <Tag color="error" style={{ marginInlineEnd: 0 }}>
              {t('apiDebug.extract.status.failed')}
            </Tag>
            <Text type="danger" style={{ fontSize: 12 }} ellipsis>
              {reason}
            </Text>
          </Space>
        </Tooltip>
      );
    }
    return (
      <Space size={4} wrap>
        <Tag color={item.status === 'updated' ? 'success' : 'processing'} style={{ marginInlineEnd: 0 }}>
          {t(item.status === 'updated' ? 'apiDebug.extract.status.updated' : 'apiDebug.extract.status.preview')}
        </Tag>
        {item.valuePreview !== undefined && (
          <Text code style={{ fontSize: 12 }}>
            {item.valuePreview}
          </Text>
        )}
        {item.shadowedByGroup && (
          <Tooltip title={t('apiDebug.extract.shadowedByGroup')}>
            <Tag color="warning" style={{ marginInlineEnd: 0 }}>
              {t('apiDebug.extract.shadowedShort')}
            </Tag>
          </Tooltip>
        )}
      </Space>
    );
  };

  const columns = [
    {
      title: t('globalParam.col.enabled'),
      key: 'enabled',
      width: 60,
      render: (_: unknown, rule: ResponseExtractionRule, index: number) => (
        <Switch
          size="small"
          checked={rule.enabled}
          aria-label={t('apiDebug.extract.ruleEnabled', { index: index + 1 })}
          onChange={(enabled) => toggleRule(rule.id, enabled)}
        />
      ),
    },
    {
      title: t('apiDebug.extract.col.source'),
      key: 'source',
      render: (_: unknown, rule: ResponseExtractionRule) => (
        <Space orientation="vertical" size={2}>
          <Space size={6} wrap>
            <Tag style={{ marginInlineEnd: 0 }}>
              {t(rule.source === 'header' ? 'apiDebug.extract.source.header' : 'apiDebug.extract.source.jsonBody')}
            </Tag>
            {rule.expression.trim() ? (
              <Text code style={{ fontSize: 12 }}>
                {rule.expression}
              </Text>
            ) : (
              <Text type="secondary">—</Text>
            )}
          </Space>
          {rule.prefix && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('apiDebug.extract.prefixBadge', { prefix: rule.prefix })}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: t('apiDebug.extract.col.target'),
      key: 'target',
      render: (_: unknown, rule: ResponseExtractionRule) => (
        <Space size={6} wrap>
          {rule.targetName.trim() ? <Text strong>{rule.targetName}</Text> : <Text type="secondary">—</Text>}
          <Tag style={{ marginInlineEnd: 0 }}>{rule.targetIn}</Tag>
          <Tag color={rule.targetScope === 'application' ? 'blue' : undefined} style={{ marginInlineEnd: 0 }}>
            {t(rule.targetScope === 'application' ? 'globalParam.scope.application' : 'globalParam.scope.group')}
          </Tag>
          {rule.masked && (
            <Tooltip title={t('apiDebug.extract.masked')}>
              <LockOutlined style={{ color: '#8c8c8c', fontSize: 12 }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: t('apiDebug.extract.col.status'),
      key: 'status',
      render: (_: unknown, rule: ResponseExtractionRule) => renderStatusCell(rule),
    },
    {
      title: t('globalParam.col.action'),
      key: 'action',
      width: 84,
      render: (_: unknown, rule: ResponseExtractionRule) => (
        <Space size={2}>
          <Button
            size="small"
            type="text"
            aria-label={t('globalParam.btn.edit')}
            title={t('globalParam.btn.edit')}
            icon={<EditOutlined />}
            onClick={() => openEdit(rule)}
          />
          <Button
            size="small"
            type="text"
            danger
            aria-label={t('apiDebug.extract.deleteRule')}
            title={t('apiDebug.extract.deleteRule')}
            icon={<DeleteOutlined />}
            onClick={() => removeRule(rule.id)}
          />
        </Space>
      ),
    },
  ];

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size={10}>
      {persistenceFailed && <Alert type="warning" showIcon title={t('storage.persistenceFailed')} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space wrap size={8}>
          <Button type="primary" size="small" icon={<PlusOutlined />} disabled={limitReached} onClick={openAdd}>
            {t('apiDebug.extract.addRule')}
          </Button>
          {rules.length === 0 && (
            <Button size="small" icon={<ThunderboltOutlined />} disabled={limitReached} onClick={openBearerTemplate}>
              {t('apiDebug.extract.quickBearer')}
            </Button>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {limitReached
              ? t('apiDebug.extract.maxRulesReached', { max: RESPONSE_EXTRACTION_MAX_RULES })
              : t('apiDebug.extract.shortHint')}
          </Text>
        </Space>
        <Link to={`/${encodeURIComponent(group ?? '')}/globalParam`}>{t('apiDebug.extract.viewGlobalParams')}</Link>
      </div>

      {extractionLog?.status === 'skipped' && extractionLog.skipReason !== 'no-enabled-rules' && (
        <Alert
          type="info"
          showIcon
          title={
            extractionLog.skipReason === 'non-2xx'
              ? t('apiDebug.extract.skip.non2xx', { status: extractionLog.httpStatus })
              : t('apiDebug.extract.skip.unsupportedKind')
          }
        />
      )}

      {rules.length > 0 && (
        <Table<ResponseExtractionRule>
          bordered
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={[...rules]}
          columns={columns}
        />
      )}

      <Modal
        title={editingId ? t('apiDebug.extract.modal.edit') : t('apiDebug.extract.modal.add')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
        width={560}
        footer={
          <Space>
            <Button onClick={() => setModalOpen(false)}>{t('settings.localData.confirm.cancel')}</Button>
            {canApplyOnSave ? (
              <>
                <Button onClick={() => void handleSave(false)}>{t('apiDebug.extract.saveOnly')}</Button>
                <Button type="primary" onClick={() => void handleSave(true)}>
                  {t('apiDebug.extract.saveAndApply')}
                </Button>
              </>
            ) : (
              <Button type="primary" onClick={() => void handleSave(false)}>
                {t('apiDebug.extract.saveOnly')}
              </Button>
            )}
          </Space>
        }
      >
        <Form<RuleFormValues> form={form} layout="vertical" initialValues={DEFAULT_RULE_VALUES}>
          <Form.Item name="source" label={t('apiDebug.extract.source')}>
            <Radio.Group
              optionType="button"
              options={[
                { value: 'json-body', label: t('apiDebug.extract.source.jsonBody') },
                { value: 'header', label: t('apiDebug.extract.source.header') },
              ]}
            />
          </Form.Item>

          <Form.Item
            name="expression"
            label={
              watchedSource === 'header'
                ? t('apiDebug.extract.expressionLabel.header')
                : t('apiDebug.extract.expressionLabel.jsonBody')
            }
            rules={[{ required: true, whitespace: true, message: t('apiDebug.extract.reason.empty-expression') }]}
          >
            <Input
              maxLength={RESPONSE_EXTRACTION_MAX_EXPRESSION_LENGTH}
              placeholder={
                watchedSource === 'header'
                  ? t('apiDebug.extract.expressionPlaceholder.header')
                  : t('apiDebug.extract.expressionPlaceholder.jsonBody')
              }
            />
          </Form.Item>

          <Form.Item name="prefix" label={t('apiDebug.extract.prefix')} extra={t('apiDebug.extract.prefixTip')}>
            <Input
              maxLength={RESPONSE_EXTRACTION_MAX_PREFIX_LENGTH}
              placeholder={t('apiDebug.extract.prefixPlaceholder')}
            />
          </Form.Item>

          <Space.Compact block>
            <Form.Item
              name="targetName"
              label={t('apiDebug.extract.targetName')}
              rules={[{ required: true, whitespace: true, message: t('apiDebug.extract.reason.invalid-target-name') }]}
              style={{ flex: 1 }}
            >
              <Input
                maxLength={RESPONSE_EXTRACTION_MAX_TARGET_NAME_LENGTH}
                list={watchedTargetIn === 'header' ? 'knife4j-response-extraction-header-names' : undefined}
                placeholder={t('apiDebug.extract.targetNamePlaceholder')}
              />
            </Form.Item>
            <Form.Item name="targetIn" label={t('apiDebug.extract.targetIn')} style={{ width: 120 }}>
              <Select
                options={[
                  { value: 'header', label: 'header' },
                  { value: 'query', label: 'query' },
                ]}
              />
            </Form.Item>
          </Space.Compact>

          <datalist id="knife4j-response-extraction-header-names">
            {COMMON_HEADER_NAMES.map((name) => (
              <option value={name} key={name} />
            ))}
          </datalist>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <Form.Item name="targetScope" label={t('apiDebug.extract.targetScope')} style={{ marginBottom: 8 }}>
              <Radio.Group
                options={[
                  { value: 'group', label: t('globalParam.scope.group') },
                  { value: 'application', label: t('globalParam.scope.application') },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="masked"
              label={t('apiDebug.extract.masked')}
              valuePropName="checked"
              style={{ marginBottom: 8 }}
            >
              <Switch />
            </Form.Item>
          </div>

          <Form.Item name="enabled" hidden valuePropName="checked">
            <Switch />
          </Form.Item>

          {livePreview && (
            <Alert
              style={{ marginTop: 8 }}
              showIcon
              type={
                livePreview.status === 'skipped'
                  ? 'info'
                  : livePreviewItem?.status === 'preview'
                    ? 'success'
                    : 'warning'
              }
              title={
                livePreview.status === 'skipped'
                  ? livePreview.skipReason === 'non-2xx'
                    ? t('apiDebug.extract.skip.non2xx', { status: livePreview.httpStatus })
                    : t('apiDebug.extract.skip.unsupportedKind')
                  : livePreviewItem?.status === 'preview'
                    ? livePreviewItem.masked
                      ? t('apiDebug.extract.livePreview.matchedMasked', {
                          preview: livePreviewItem.valuePreview,
                          length: livePreviewItem.valueLength ?? 0,
                        })
                      : t('apiDebug.extract.livePreview.matched', { preview: livePreviewItem.valuePreview })
                    : renderReasonText(t, livePreviewItem?.reasonCode, livePreviewItem?.reasonDetail)
              }
            />
          )}
        </Form>
      </Modal>
    </Space>
  );
}
