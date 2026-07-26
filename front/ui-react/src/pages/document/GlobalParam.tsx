import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type {
  CookieSessionConfig,
  GlobalParamHttpRequest,
  GlobalParamItem,
  GlobalParamValueRequest,
} from '../../context/GlobalParamContext';
import { useGlobalParam } from '../../context/GlobalParamContext';
import { useGroup } from '../../context/GroupContext';
import { useSettings } from '../../context/SettingsContext';
import { COMMON_HEADER_NAMES } from '../../constants/httpHeaders';
import { currentOrigin, resolveRequestBaseUrl } from '../api/requestBaseUrl';
import Authorize from '../Authorize';
import RevealableValue from '../../components/RevealableValue';
import { executeConfiguredRequest, fetchGlobalParamValue } from './globalParamRequest';

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

function optionalRequest(request: GlobalParamHttpRequest | undefined): GlobalParamHttpRequest | undefined {
  if (!request?.url.trim()) return undefined;
  return request;
}

function GlobalParamInner() {
  const { t } = useTranslation();
  const { activeGroup, activeSwaggerGroup, swaggerDoc } = useGroup();
  const { settings } = useSettings();
  const { params, addParam, updateParam, removeParam, cookieSession, setCookieSession, clearGroup } = useGlobalParam();
  const [paramForm] = Form.useForm<ParamFormValues>();
  const [cookieForm] = Form.useForm<CookieSessionConfig>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [sessionAction, setSessionAction] = useState<'login' | 'logout' | null>(null);
  const valueSource = Form.useWatch('valueSource', paramForm) ?? 'manual';
  const masked = Form.useWatch('masked', paramForm) ?? false;

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

  const hasSecuritySchemes = useMemo(() => {
    const schemes = swaggerDoc?.components?.securitySchemes ?? swaggerDoc?.securityDefinitions;
    return Boolean(schemes && Object.keys(schemes).length > 0);
  }, [swaggerDoc]);

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
      ...param,
      request: param.request ?? DEFAULT_VALUE_REQUEST,
    });
    setModalOpen(true);
  };

  const saveParam = async () => {
    const values = await paramForm.validateFields();
    const duplicate = params.some(
      (param) =>
        param.id !== editingId &&
        param.in === values.in &&
        param.name.trim().toLowerCase() === values.name.trim().toLowerCase(),
    );
    if (duplicate) {
      message.error(t('globalParam.msg.duplicate'));
      return;
    }

    const existingValue = editingId ? params.find((param) => param.id === editingId)?.value : '';
    const next: Omit<GlobalParamItem, 'id'> = {
      ...values,
      name: values.name.trim(),
      value: values.value ?? existingValue ?? '',
      enabled: values.enabled !== false,
      request: values.valueSource === 'request' ? values.request : undefined,
    };
    if (editingId) updateParam(editingId, next);
    else addParam(next);
    setModalOpen(false);
    message.success(t('globalParam.msg.saved'));
  };

  const fetchValue = async (param: GlobalParamItem) => {
    if (!param.request) return;
    setFetchingId(param.id);
    try {
      const value = await fetchGlobalParamValue(param.request, baseUrl, cookieSession.credentials);
      updateParam(param.id, { value });
      message.success(t('globalParam.msg.updated'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('globalParam.msg.requestFailed'));
    } finally {
      setFetchingId(null);
    }
  };

  const readCookieConfig = async (): Promise<CookieSessionConfig> => {
    const values = await cookieForm.validateFields();
    const next = {
      credentials: values.credentials,
      login: optionalRequest(values.login),
      logout: optionalRequest(values.logout),
    };
    setCookieSession(next);
    return next;
  };

  const saveCookieConfig = async () => {
    await readCookieConfig();
    message.success(t('globalParam.cookie.saved'));
  };

  const executeSessionAction = async (action: 'login' | 'logout') => {
    const config = await readCookieConfig();
    const request = config[action];
    if (!request) {
      message.error(
        action === 'login' ? t('globalParam.cookie.loginUrlRequired') : t('globalParam.cookie.logoutUrlRequired'),
      );
      return;
    }

    setSessionAction(action);
    try {
      await executeConfiguredRequest(request, baseUrl, config.credentials);
      message.success(
        action === 'login' ? t('globalParam.cookie.loginSucceeded') : t('globalParam.cookie.logoutSucceeded'),
      );
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('globalParam.msg.requestFailed'));
    } finally {
      setSessionAction(null);
    }
  };

  const columns = [
    {
      title: t('globalParam.col.enabled'),
      key: 'enabled',
      width: 76,
      render: (_: unknown, record: GlobalParamItem) => (
        <Switch checked={record.enabled} onChange={(enabled) => updateParam(record.id, { enabled })} />
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
      render: (source: GlobalParamItem['valueSource']) => (
        <Tag color={source === 'request' ? 'blue' : undefined}>
          {t(source === 'request' ? 'globalParam.source.request' : 'globalParam.source.manual')}
        </Tag>
      ),
    },
    {
      title: t('globalParam.col.action'),
      key: 'action',
      width: 160,
      render: (_: unknown, record: GlobalParamItem) => (
        <Space size={4}>
          {record.valueSource === 'request' && (
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
          <Popconfirm title={t('globalParam.confirm.delete')} onConfirm={() => removeParam(record.id)}>
            <Button type="text" danger title={t('globalParam.btn.delete')} icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const requestFields = (prefix: 'login' | 'logout') => (
    <>
      <Space.Compact block>
        <Form.Item name={[prefix, 'method']} style={{ width: 110 }}>
          <Select
            options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => ({ value: method, label: method }))}
          />
        </Form.Item>
        <Form.Item name={[prefix, 'url']} style={{ flex: 1 }}>
          <Input placeholder={t('globalParam.request.urlPlaceholder')} />
        </Form.Item>
      </Space.Compact>
      <Form.Item name={[prefix, 'headers']} label={t('globalParam.request.headers')}>
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
      </Form.Item>
      <Form.Item name={[prefix, 'body']} label={t('globalParam.request.body')}>
        <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} />
      </Form.Item>
    </>
  );

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
              <Popconfirm title={t('globalParam.confirm.clear')} onConfirm={clearGroup}>
                <Button danger>{t('globalParam.btn.clear')}</Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {t('globalParam.scope', {
            group: activeGroup.label || activeGroup.value || t('globalParam.currentGroup'),
          })}
        </Text>
        <Alert type="info" showIcon message={t('globalParam.scopeTip')} style={{ marginBottom: 16 }} />

        <Table
          bordered
          dataSource={params}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="small"
          locale={{ emptyText: t('globalParam.empty') }}
        />
      </Card>

      <Card title={t('globalParam.cookie.title')} style={{ ...SECTION_CARD_STYLE, marginTop: 20 }}>
        <Alert type="info" showIcon message={t('globalParam.cookie.tip')} style={{ marginBottom: 16 }} />
        <Form<CookieSessionConfig>
          form={cookieForm}
          layout="vertical"
          initialValues={{
            credentials: cookieSession.credentials,
            login: cookieSession.login ?? DEFAULT_HTTP_REQUEST,
            logout: cookieSession.logout ?? DEFAULT_HTTP_REQUEST,
          }}
        >
          <Form.Item name="credentials" label={t('globalParam.cookie.credentials')}>
            <Select
              options={[
                { value: 'same-origin', label: t('globalParam.cookie.sameOrigin') },
                { value: 'include', label: t('globalParam.cookie.include') },
              ]}
            />
          </Form.Item>
          <Collapse
            items={[
              {
                key: 'login',
                label: t('globalParam.cookie.loginRequest'),
                children: requestFields('login'),
              },
              {
                key: 'logout',
                label: t('globalParam.cookie.logoutRequest'),
                children: requestFields('logout'),
              },
            ]}
          />
          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => void saveCookieConfig()}>{t('globalParam.cookie.save')}</Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={sessionAction === 'login'}
              onClick={() => void executeSessionAction('login')}
            >
              {t('globalParam.cookie.login')}
            </Button>
            <Button
              icon={<SendOutlined />}
              loading={sessionAction === 'logout'}
              onClick={() => void executeSessionAction('logout')}
            >
              {t('globalParam.cookie.logout')}
            </Button>
          </Space>
        </Form>
      </Card>

      {hasSecuritySchemes && (
        <Card title={t('globalParam.openapi.title')} style={{ ...SECTION_CARD_STYLE, marginTop: 20 }}>
          <Alert type="info" showIcon message={t('globalParam.openapi.tip')} style={{ marginBottom: 12 }} />
          <Authorize embedded />
        </Card>
      )}

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
          <Form.Item name="valueSource" label={t('globalParam.col.source')}>
            <Select
              options={[
                { value: 'manual', label: t('globalParam.source.manual') },
                { value: 'request', label: t('globalParam.source.request') },
              ]}
            />
          </Form.Item>
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
          {valueSource === 'request' && (
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
  return <GlobalParamInner key={groupId} />;
}
