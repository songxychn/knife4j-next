import { useState } from 'react';
import { AutoComplete, Button, Form, Input, Select, Table } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { GlobalParamItem, useGlobalParam } from '../../context/GlobalParamContext';
import { COMMON_HEADER_NAMES } from '../../constants/httpHeaders';

// eslint-disable-next-line react-refresh/only-export-components
export { useGlobalParam };

function GlobalParamInner() {
  const { t } = useTranslation();
  const { params, addParam, removeParam } = useGlobalParam();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const paramIn: string = Form.useWatch('in', form) ?? 'header';

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
    setNameInput('');
    setLoading(false);
  };

  const headerOptions = COMMON_HEADER_NAMES.filter((h) =>
    nameInput ? h.toLowerCase().includes(nameInput.toLowerCase()) : true,
  ).map((h) => ({ value: h }));

  return (
    <div id="knife4j-global-param-page" style={{ padding: 16 }}>
      <Form form={form} onFinish={onFinish} initialValues={{ in: 'header' }} style={{ marginBottom: 16 }}>
        {/*
         * 使用 flex 布局（而非 Form layout="inline"），让三个输入控件在一行内
         * 按剩余空间自适应收缩，按钮始终贴在最右侧，避免在 Drawer (600px) 等狭窄容器里被挤到下一行。
         */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <Form.Item
            name="name"
            rules={[{ required: true, message: t('globalParam.validation.name') }]}
            style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
          >
            {paramIn === 'header' ? (
              <AutoComplete
                options={headerOptions}
                onSearch={setNameInput}
                placeholder={t('globalParam.placeholder.name')}
                allowClear
              />
            ) : (
              <Input placeholder={t('globalParam.placeholder.name')} />
            )}
          </Form.Item>
          <Form.Item
            name="value"
            rules={[{ required: true, message: t('globalParam.validation.value') }]}
            style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
          >
            <Input placeholder={t('globalParam.placeholder.value')} />
          </Form.Item>
          <Form.Item name="in" style={{ flex: '0 0 96px', marginBottom: 0 }}>
            <Select style={{ width: '100%' }}>
              <Select.Option value="header">header</Select.Option>
              <Select.Option value="query">query</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item style={{ flex: '0 0 auto', marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={loading}>
              {t('globalParam.btn.add')}
            </Button>
          </Form.Item>
        </div>
      </Form>

      <Table dataSource={params} columns={columns} rowKey="id" pagination={false} size="small" />
    </div>
  );
}

export default function GlobalParam() {
  return <GlobalParamInner />;
}
