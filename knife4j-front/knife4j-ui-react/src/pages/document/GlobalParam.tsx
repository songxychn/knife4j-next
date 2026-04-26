import { useState } from 'react';
import { Button, Form, Input, Select, Table } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { GlobalParamItem, useGlobalParam } from '../../context/GlobalParamContext';

// eslint-disable-next-line react-refresh/only-export-components
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
        style={{ marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}
      >
        <Form.Item
          name="name"
          rules={[{ required: true, message: t('globalParam.validation.name') }]}
          style={{ flex: '1 1 160px', minWidth: 120 }}
        >
          <Input placeholder={t('globalParam.placeholder.name')} />
        </Form.Item>
        <Form.Item
          name="value"
          rules={[{ required: true, message: t('globalParam.validation.value') }]}
          style={{ flex: '1 1 160px', minWidth: 120 }}
        >
          <Input placeholder={t('globalParam.placeholder.value')} />
        </Form.Item>
        <Form.Item name="in" style={{ flex: '0 0 110px' }}>
          <Select style={{ width: '100%' }}>
            <Select.Option value="header">header</Select.Option>
            <Select.Option value="query">query</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item style={{ flex: '0 0 auto' }}>
          <Button type="primary" htmlType="submit" loading={loading}>
            {t('globalParam.btn.add')}
          </Button>
        </Form.Item>
      </Form>

      <Table dataSource={params} columns={columns} rowKey="id" pagination={false} size="small" />
    </div>
  );
}

export default function GlobalParam() {
  return <GlobalParamInner />;
}
