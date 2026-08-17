import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Collapse, Form, Input, message, Popconfirm, Select, Space, Spin, Tag } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { CookieSessionConfig, GlobalParamHttpRequest } from '../../context/GlobalParamContext';
import { useGlobalParam } from '../../context/GlobalParamContext';
import { useGroup } from '../../context/GroupContext';
import { useSettings } from '../../context/SettingsContext';
import { currentOrigin, resolveRequestBaseUrl } from '../api/requestBaseUrl';
import { executeConfiguredRequest } from './globalParamRequest';

const DEFAULT_HTTP_REQUEST: GlobalParamHttpRequest = {
  method: 'POST',
  url: '',
  headers: '{\n  "Content-Type": "application/json"\n}',
  body: '',
};
const SECTION_CARD_STYLE = { background: '#fafafa' };

function optionalRequest(request: GlobalParamHttpRequest | undefined): GlobalParamHttpRequest | undefined {
  if (!request?.url.trim()) return undefined;
  return request;
}

function CookieSessionInner() {
  const { t } = useTranslation();
  const { activeGroup, activeSwaggerGroup, swaggerDoc, loading: groupLoading, routeGroupReady } = useGroup();
  const { settings } = useSettings();
  const { cookieSession, groupId, setCookieSession } = useGlobalParam();
  const [cookieForm] = Form.useForm<CookieSessionConfig>();
  const [sessionAction, setSessionAction] = useState<'login' | 'logout' | null>(null);
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

  useEffect(() => {
    cookieForm.setFieldsValue({
      credentials: cookieSession.credentials,
      login: cookieSession.login ?? DEFAULT_HTTP_REQUEST,
      logout: cookieSession.logout ?? DEFAULT_HTTP_REQUEST,
    });
  }, [cookieForm, cookieSession, groupId]);

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

  const resetCookieConfig = () => {
    setCookieSession({ credentials: 'same-origin' });
    message.success(t('cookieSession.msg.reset'));
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

  if (groupLoading || !routeGroupReady) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  return (
    <div id="knife4j-cookie-session-page" style={{ padding: 20, maxWidth: 1180, margin: '0 auto' }}>
      <Card
        title={
          <Space>
            <span>{t('cookieSession.pageTitle')}</span>
            <Tag>{t('globalParam.scope.group')}</Tag>
          </Space>
        }
        style={SECTION_CARD_STYLE}
      >
        <Alert
          type="info"
          showIcon
          message={t('globalParam.cookie.tip')}
          description={t('globalParam.scope.currentGroupOnly', { group: currentGroupName })}
          style={{ marginBottom: 16 }}
        />
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
            <Popconfirm title={t('cookieSession.confirm.reset')} onConfirm={resetCookieConfig}>
              <Button danger>{t('cookieSession.btn.reset')}</Button>
            </Popconfirm>
          </Space>
        </Form>
      </Card>
    </div>
  );
}

export default function CookieSession() {
  const { groupId } = useGlobalParam();
  return <CookieSessionInner key={groupId} />;
}
