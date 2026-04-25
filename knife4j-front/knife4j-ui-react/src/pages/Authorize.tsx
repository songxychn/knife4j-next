import { Tabs, Form, Input, Button, message } from 'antd';
import { useAuth } from '../context/AuthContext';

export default function Authorize() {
  const { auth, setAuth, clearAuth } = useAuth();
  const [bearerForm] = Form.useForm();
  const [basicForm] = Form.useForm();

  const initialBearer = auth?.type === 'bearer' ? { token: auth.token } : {};
  const initialBasic = auth?.type === 'basic' ? { username: auth.username, password: auth.password } : {};

  const onSaveBearer = (values: { token: string }) => {
    setAuth({ type: 'bearer', token: values.token });
    message.success('Bearer token saved');
  };

  const onSaveBasic = (values: { username: string; password: string }) => {
    setAuth({ type: 'basic', username: values.username, password: values.password });
    message.success('Basic auth saved');
  };

  const onClear = () => {
    clearAuth();
    bearerForm.resetFields();
    basicForm.resetFields();
    message.success('Auth cleared');
  };

  const tabs = [
    {
      key: 'bearer',
      label: 'Bearer Token',
      children: (
        <Form form={bearerForm} initialValues={initialBearer} onFinish={onSaveBearer} layout="vertical">
          <Form.Item name="token" label="Token" rules={[{ required: true, message: 'Please enter token' }]}>
            <Input.Password placeholder="Enter Bearer token" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">Save</Button>
          </Form.Item>
        </Form>
      ),
    },
    {
      key: 'basic',
      label: 'Basic Auth',
      children: (
        <Form form={basicForm} initialValues={initialBasic} onFinish={onSaveBasic} layout="vertical">
          <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Please enter username' }]}>
            <Input placeholder="Username" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Please enter password' }]}>
            <Input.Password placeholder="Password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit">Save</Button>
          </Form.Item>
        </Form>
      ),
    },
  ];

  return (
    <div id="knife4j-authorize" style={{ maxWidth: 480, padding: 24 }}>
      <h2>Authorization</h2>
      <Tabs items={tabs} />
      {auth && (
        <Button danger onClick={onClear} style={{ marginTop: 8 }}>
          Clear Auth
        </Button>
      )}
    </div>
  );
}
