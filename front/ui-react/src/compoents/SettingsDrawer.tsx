import React, { lazy, Suspense } from 'react';
import PageLoading from '../components/PageLoading';
import { Drawer, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext';
const OfficeDoc = lazy(() => import('../pages/document/OfficeDoc'));
const Settings = lazy(() => import('../pages/document/Settings'));

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const tabItems = [
    ...(settings.enableDocumentManage
      ? [{ key: 'officeDoc', label: t('settings.tab.offlineDoc'), children: <OfficeDoc /> }]
      : []),
    { key: 'settings', label: t('settings.tab.settings'), children: <Settings /> },
  ];

  return (
    <Drawer
      title={t('settings.title')}
      placement="right"
      size={600}
      open={open}
      onClose={onClose}
      styles={{ wrapper: { maxWidth: '100vw' } }}
    >
      <Suspense fallback={<PageLoading />}>
        <Tabs items={tabItems} />
      </Suspense>
    </Drawer>
  );
};

export default SettingsDrawer;
