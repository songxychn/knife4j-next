import { Spin } from 'antd';
import { useTranslation } from 'react-i18next';

export default function PageLoading() {
  const { t } = useTranslation();
  return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <Spin aria-label={t('app.loading')} />
    </div>
  );
}
