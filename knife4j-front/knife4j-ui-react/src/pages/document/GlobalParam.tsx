import { useState } from 'react';
import { Table, Form, Input, Select, Button, Space } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useGlobalParam, GlobalParamItem } from '../../context/GlobalParamContext';

export { useGlobalParam };

function GlobalParamInner() {
  const { t } = useTranslation();
  const { params, addParam, removeParam } = useGlobalParam();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const columns = [
    { title: t('globalParam.col.name'), dataIndex: 'name', key: 'name' },
    { title: t('globalParam.col.value'), dataIndex: 'value', key: 'value' },
    { title: t('globalParam.col.in'), dataIndex: 'in', key: 'in' },
    {
      title: t('globalParam.col.action'),
      key: 'action',
      render: (_: unknown, record: GlobalParamItem) => (
        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeParam(record.id)} />
      ),
    },
  ];

  const onFinish = (values: { name: string; value: string; in: 'header' | 'query' }) => {
    setLoading(true);
    addParam(values);
    form.resetFields();
    setLoading(false);
  };

  return (
    <div id="knife4j-global-param-page" style={{ padding: 16 }}>
      <Form
        form={form}
        layout="inline"
        onFinish={onFinish}
        initialValues={{ in: 'header' }}
        style={{ marginBottom: 16 }}
      >
        <Form.Item name="name" rules={[{ required: true, message: t('globalParam.validation.name') }]}>
          <Input placeholder={t('globalParam.placeholder.name')} />
        </Form.Item>
        <Form.Item name="value" rules={[{ required: true, message: t('globalParam.validation.value') }]}>
          <Input placeholder={t('globalParam.placeholder.value')} />
        </Form.Item>
        <Form.Item name="in">
          <Select style={{ width: 100 }}>
            <Select.Option value="header">header</Select.Option>
            <Select.Option value="query">query</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={loading}>
              {t('globalParam.btn.add')}
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Table dataSource={params} columns={columns} rowKey="id" pagination={false} size="small" />
    </div>
  );
}

export default function GlobalParam() {
  return <GlobalParamInner />;
}
