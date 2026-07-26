import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Space, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

export default function RevealableValue({
  value,
  masked = false,
  emptyText = '—',
}: {
  value: string;
  masked?: boolean;
  emptyText?: string;
}) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const hasValue = value !== '';

  return (
    <Space size={4}>
      <Text copyable={hasValue ? { text: value } : false}>
        {hasValue ? (masked && !revealed ? '••••••' : value) : emptyText}
      </Text>
      {masked && hasValue && (
        <Tooltip title={t(revealed ? 'common.value.hide' : 'common.value.show')}>
          <Button
            type="text"
            size="small"
            aria-label={t(revealed ? 'common.value.hide' : 'common.value.show')}
            icon={revealed ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={() => setRevealed((current) => !current)}
          />
        </Tooltip>
      )}
    </Space>
  );
}
