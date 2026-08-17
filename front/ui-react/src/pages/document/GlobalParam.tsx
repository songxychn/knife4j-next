import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type {
  GlobalParamHttpRequest,
  GlobalParamItem,
  GlobalParamScope,
  GlobalParamValueRequest,
} from '../../context/GlobalParamContext';
import { useGlobalParam } from '../../context/GlobalParamContext';
import { useGroup } from '../../context/GroupContext';
import { useSettings } from '../../context/SettingsContext';
import { COMMON_HEADER_NAMES } from '../../constants/httpHeaders';
import { currentOrigin, resolveRequestBaseUrl } from '../api/requestBaseUrl';
import RevealableValue from '../../components/RevealableValue';
import { fetchGlobalParamValue } from './globalParamRequest';

// eslint-disable-next-line react-refresh/only-export-components
export { useGlobalParam };

const { Text } = Typography;

const DEFAULT_HEADERS = '{\n  "Content-Type": "application/json"\n}';
const DEFAULT_HTTP_REQUEST: GlobalParamHttpRequest = {
  method: 'POST',
  url: '',
  headers: DEFAULT_HEADERS,
  body: '',
};
const DEFAULT_VALUE_REQUEST: GlobalParamValueRequest = {
  ...DEFAULT_HTTP_REQUEST,
  jsonPath: '$.data.token',
  prefix: '',
};
const SECTION_CARD_STYLE = { background: '#fafafa' };

type ParamFormValues = Omit<GlobalParamItem, 'id'>;

function GlobalParamInner() {
  const { t } = useTranslation();
  const { activeGroup, activeSwaggerGroup, swaggerDoc } = useGroup();
  const { settings } = useSettings();
  const { applicationParams, groupParams, addParam, updateParam, removeParam, clearParams, cookieSession } =
    useGlobalParam();
  const [paramForm] = Form.useForm<ParamFormValues>();
  const [scope, setScope] = useState<GlobalParamScope>('group');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const valueSource = Form.useWatch('valueSource', paramForm) ?? 'manual';
  const masked = Form.useWatch('masked', paramForm) ?? false;
  const params = scope === 'application' ? applicationParams : groupParams;
  const currentGroupName = activeGroup.label || activeGroup.value || t('globalParam.currentGroup');

  const baseUrl = useMemo(
    () =>
      resolveRequestBaseUrl({
        swaggerDoc,
        enableHost: settings.enableHost,
        enableHostText: settings.enableHostText,
        groupContextPath: activeSwaggerGroup?.contextPath,
        origin: currentOrigin(),
      }),
    [activeSwaggerGroup?.contextPath, settings.enableHost, settings.enableHostText, swaggerDoc],
  );

  const openAdd = () => {
    setEditingId(null);
    paramForm.setFieldsValue({
      name: '',
      value: '',
      in: 'header',
      enabled: true,
      masked: false,
      valueSource: 'manual',
      request: DEFAULT_VALUE_REQUEST,
    });
    setModalOpen(true);
  };

  const openEdit = (param: GlobalParamItem) => {
    setEditingId(param.id);
    paramForm.setFieldsValue({
      name: param.name,
      value: param.value,
      in: param.in,
      enabled: param.enabled,
      masked: param.masked,
      valueSource: scope === 'application' ? 'manual' : param.valueSource,
      request: param.request ?? DEFAULT_VALUE_REQUEST,
    });
    setModalOpen(true);
  };

  const changeScope = (nextScope: string) => {
    setScope(nextScope as GlobalParamScope);
    setModalOpen(false);
    setEditingId(null);
  };

  const saveParam = async () => {
    const values = await paramForm.validateFields();
    const normalizedName = values.name.trim();
    const duplicate = params.some((param) => {
      if (param.id === editingId || param.in !== values.in) return false;
      return values.in === 'header'
        ? param.name.trim().toLowerCase() === normalizedName.toLowerCase()
        : param.name.trim() === normalizedName;
    });
    if (duplicate) {
      message.error(t('globalParam.msg.duplicate'));
      return;
    }

    const existingValue = editingId ? params.find((param) => param.id === editingId)?.value : '';
    const next: Omit<GlobalParamItem, 'id'> = {
      ...values,
      name: normalizedName,
      value: values.value ?? existingValue ?? '',
      enabled: values.enabled !== false,
      valueSource: scope === 'application' ? 'manual' : values.valueSource,
      request: scope === 'group' && values.valueSource === 'request' ? values.request : undefined,
    };
    if (editingId) updateParam(scope, editingId, next);
    else addParam(scope, next);
    setModalOpen(false);
    message.success(t('globalParam.msg.saved'));
  };

  const fetchValue = async (param: GlobalParamItem) => {
    if (!param.request) return;
    setFetchingId(param.id);
    try {
      const value = await fetchGlobalParamValue(param.request, baseUrl, cookieSession.credentials);
      updateParam(scope, param.id, { value });
      message.success(t('globalParam.msg.updated'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('globalParam.msg.requestFailed'));
    } finally {
      setFetchingId(null);
    }
  };

  const columns = [
    {
      title: t('globalParam.col.enabled'),
      key: 'enabled',
      width: 76,
      render: (_: unknown, record: GlobalParamItem) => (
        <Switch checked={record.enabled} onChange={(enabled) => updateParam(scope, record.id, { enabled })} />
      ),
    },
    { title: t('globalParam.col.name'), dataIndex: 'name', key: 'name' },
    {
      title: t('globalParam.col.value'),
      dataIndex: 'value',
      key: 'value',
      ellipsis: true,
      render: (value: string, record: GlobalParamItem) => <RevealableValue value={value} masked={record.masked} />,
    },
    {
      title: t('globalParam.col.in'),
      dataIndex: 'in',
      key: 'in',
      width: 92,
      render: (value: GlobalParamItem['in']) => <Tag>{value}</Tag>,
    },
    {
      title: t('globalParam.col.source'),
      dataIndex: 'valueSource',
      key: 'valueSource',
      width: 112,
      render: (source: GlobalParamItem['valueSource']) => {
        const effectiveSource = scope === 'application' ? 'manual' : source;
        return (
          <Tag color={effectiveSource === 'request' ? 'blue' : undefined}>
            {t(effectiveSource === 'request' ? 'globalParam.source.request' : 'globalParam.source.manual')}
          </Tag>
        );
      },
    },
    {
      title: t('globalParam.col.action'),
      key: 'action',
      width: 160,
      render: (_: unknown, record: GlobalParamItem) => (
        <Space size={4}>
          {scope === 'group' && record.valueSource === 'request' && (
            <Button
              type="text"
              title={t('globalParam.btn.fetch')}
              icon={<ReloadOutlined />}
              loading={fetchingId === record.id}
              onClick={() => void fetchValue(record)}
            />
          )}
          <Button
            type="text"
            title={t('globalParam.btn.edit')}
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
          />
          <Popconfirm title={t('globalParam.confirm.delete')} onConfirm={() => removeParam(scope, record.id)}>
            <Button type="text" danger title={t('globalParam.btn.delete')} icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div id="knife4j-global-param-page" style={{ padding: 20, maxWidth: 1180, margin: '0 auto' }}>
      <Card
        style={SECTION_CARD_STYLE}
        title={t('globalParam.title')}
        extra={
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
              {t('globalParam.btn.add')}
            </Button>
            {params.length > 0 && (
              <Popconfirm
                title={t(
                  scope === 'application' ? 'globalParam.confirm.clearApplication' : 'globalParam.confirm.clearGroup',
                )}
                onConfirm={() => clearParams(scope)}
              >
                <Button danger>
                  {t(scope === 'application' ? 'globalParam.btn.clearApplication' : 'globalParam.btn.clearGroup')}
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        <Tabs
          activeKey={scope}
          onChange={changeScope}
          items={[
            { key: 'application', label: t('globalParam.scope.application') },
            { key: 'group', label: t('globalParam.scope.group') },
          ]}
        />
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {scope === 'application'
            ? t('globalParam.scope.applicationDescription')
            : t('globalParam.scope.groupDescription', { group: currentGroupName })}
        </Text>
        <Alert
          type={scope === 'application' ? 'warning' : 'info'}
          showIcon
          message={t(scope === 'application' ? 'globalParam.scope.applicationTip' : 'globalParam.scope.groupTip')}
          description={scope === 'application' ? t('globalParam.scope.applicationStorage') : undefined}
          style={{ marginBottom: 16 }}
        />

        <Table
          bordered
          dataSource={params}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="small"
          locale={{
            emptyText: t(scope === 'application' ? 'globalParam.empty.application' : 'globalParam.empty.group'),
          }}
        />
      </Card>

      <Modal
        title={editingId ? t('globalParam.modal.edit') : t('globalParam.modal.add')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => void saveParam()}
        destroyOnHidden
        width={720}
      >
        <Form<ParamFormValues> form={paramForm} layout="vertical">
          <Space.Compact block>
            <Form.Item
              name="name"
              label={t('globalParam.col.name')}
              rules={[{ required: true, whitespace: true, message: t('globalParam.validation.name') }]}
              style={{ flex: 1 }}
            >
              <Input list="knife4j-global-param-header-names" placeholder={t('globalParam.placeholder.name')} />
            </Form.Item>
            <Form.Item name="in" label={t('globalParam.col.in')} style={{ width: 120 }}>
              <Select
                options={[
                  { value: 'header', label: 'header' },
                  { value: 'query', label: 'query' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="enabled"
              label={t('globalParam.col.enabled')}
              valuePropName="checked"
              style={{ width: 90, marginLeft: 12 }}
            >
              <Switch />
            </Form.Item>
          </Space.Compact>
          <datalist id="knife4j-global-param-header-names">
            {COMMON_HEADER_NAMES.map((name) => (
              <option value={name} key={name} />
            ))}
          </datalist>
          {scope === 'group' && (
            <Form.Item name="valueSource" label={t('globalParam.col.source')}>
              <Select
                options={[
                  { value: 'manual', label: t('globalParam.source.manual') },
                  { value: 'request', label: t('globalParam.source.request') },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item name="masked" label={t('globalParam.masked')} valuePropName="checked">
            <Switch />
          </Form.Item>
          {valueSource === 'manual' && (
            <Form.Item name="value" label={t('globalParam.col.value')}>
              {masked ? (
                <Input.Password placeholder={t('globalParam.placeholder.value')} />
              ) : (
                <Input placeholder={t('globalParam.placeholder.value')} />
              )}
            </Form.Item>
          )}
          {scope === 'group' && valueSource === 'request' && (
            <Card size="small" title={t('globalParam.request.title')}>
              <Space.Compact block>
                <Form.Item name={['request', 'method']} style={{ width: 110 }}>
                  <Select
                    options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({
                      value: method,
                      label: method,
                    }))}
                  />
                </Form.Item>
                <Form.Item
                  name={['request', 'url']}
                  rules={[{ required: true, whitespace: true, message: t('globalParam.request.urlRequired') }]}
                  style={{ flex: 1 }}
                >
                  <Input placeholder={t('globalParam.request.urlPlaceholder')} />
                </Form.Item>
              </Space.Compact>
              <Form.Item name={['request', 'headers']} label={t('globalParam.request.headers')}>
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
              </Form.Item>
              <Form.Item name={['request', 'body']} label={t('globalParam.request.body')}>
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} />
              </Form.Item>
              <Space.Compact block>
                <Form.Item
                  name={['request', 'jsonPath']}
                  label="JSONPath"
                  rules={[{ required: true, whitespace: true, message: t('globalParam.request.jsonPathRequired') }]}
                  style={{ flex: 1 }}
                >
                  <Input placeholder="$.data.token" prefix={<KeyOutlined />} />
                </Form.Item>
                <Form.Item
                  name={['request', 'prefix']}
                  label={t('globalParam.request.prefix')}
                  extra={t('globalParam.request.prefixTip')}
                  style={{ width: 240 }}
                >
                  <Input placeholder="Bearer " />
                </Form.Item>
              </Space.Compact>
            </Card>
          )}
        </Form>
      </Modal>
    </div>
  );
}

export default function GlobalParam() {
  const { groupId } = useGlobalParam();
  const { loading, routeGroupReady } = useGroup();
  if (loading || !routeGroupReady) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }
  return <GlobalParamInner key={groupId} />;
}
