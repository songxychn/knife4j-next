import { useState } from 'react';
import { Table, Form, Input, Select, Button, Space } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { GlobalParamProvider, useGlobalParam, GlobalParamItem } from '../../context/GlobalParamContext';

export { useGlobalParam };

const columns = (onDelete: (id: string) => void) => [
  { title: 'Name', dataIndex: 'name', key: 'name' },
  { title: 'Value', dataIndex: 'value', key: 'value' },
  { title: 'In', dataIndex: 'in', key: 'in' },
  {
    title: 'Action',
    key: 'action',
    render: (_: unknown, record: GlobalParamItem) => (
      <Button
        type="text"
        danger
        icon={<DeleteOutlined />}
        onClick={() => onDelete(record.id)}
      />
    ),
  },
];

function GlobalParamInner() {
  const { params, addParam, removeParam } = useGlobalParam();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

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
        <Form.Item name="name" rules={[{ required: true, message: 'Name required' }]}>
          <Input placeholder="Parameter name" />
        </Form.Item>
        <Form.Item name="value" rules={[{ required: true, message: 'Value required' }]}>
          <Input placeholder="Parameter value" />
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
              Add
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Table
        dataSource={params}
        columns={columns(removeParam)}
        rowKey="id"
        pagination={false}
        size="small"
      />
    </div>
  );
}

export default function GlobalParam() {
  return (
    <GlobalParamProvider>
      <GlobalParamInner />
    </GlobalParamProvider>
  );
}
