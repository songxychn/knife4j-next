import { Tabs, Form, Input, Button, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';

export default function Authorize() {
  const { t } = useTranslation();
  const { auth, setAuth, clearAuth } = useAuth();
  const [bearerForm] = Form.useForm();
  const [basicForm] = Form.useForm();

  const initialBearer = auth?.type === 'bearer' ? { token: auth.token } : {};
  const initialBasic = auth?.type === 'basic' ? { username: auth.username, password: auth.password } : {};

  const onSaveBearer = (values: { token: string }) => {
    setAuth({ type: 'bearer', token: values.token });
    message.success(t('auth.msg.bearerSaved'));
  };

  const onSaveBasic = (values: { username: string; password: string }) => {
    setAuth({ type: 'basic', username: values.username, password: values.password });
    message.success(t('auth.msg.basicSaved'));
  };

  const onClear = () => {
    clearAuth();
    bearerForm.resetFields();
    basicForm.resetFields();
    message.success(t('auth.msg.cleared'));
  };

  const tabs = [
    {
      key: 'bearer',
      label: t('auth.tab.bearer'),
      children: (
        <Form form={bearerForm} initialValues={initialBearer} onFinish={onSaveBearer} layout="vertical">
          <Form.Item name="token" label={t('auth.label.token')} rules={[{ required: true, message: t('auth.validation.token') }]}>
            <Input.Password placeholder={t('auth.placeholder.token')} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">{t('auth.btn.save')}</Button>
          </Form.Item>
        </Form>
      ),
    },
    {
      key: 'basic',
      label: t('auth.tab.basic'),
      children: (
        <Form form={basicForm} initialValues={initialBasic} onFinish={onSaveBasic} layout="vertical">
          <Form.Item name="username" label={t('auth.label.username')} rules={[{ required: true, message: t('auth.validation.username') }]}>
            <Input placeholder={t('auth.placeholder.username')} />
          </Form.Item>
          <Form.Item name="password" label={t('auth.label.password')} rules={[{ required: true, message: t('auth.validation.password') }]}>
            <Input.Password placeholder={t('auth.placeholder.password')} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">{t('auth.btn.save')}</Button>
          </Form.Item>
        </Form>
      ),
    },
  ];

  return (
    <div id="knife4j-authorize" style={{ maxWidth: 480, padding: 24 }}>
      <h2>{t('auth.title')}</h2>
      <Tabs items={tabs} />
      {auth && (
        <Button danger onClick={onClear} style={{ marginTop: 8 }}>
          {t('auth.btn.clear')}
        </Button>
      )}
    </div>
  );
}
