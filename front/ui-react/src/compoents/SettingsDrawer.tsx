import React from 'react';
import { Drawer, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../context/SettingsContext';
import OfficeDoc from '../pages/document/OfficeDoc';
import Settings from '../pages/document/Settings';

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
    <Drawer title={t('settings.title')} placement="right" width={600} open={open} onClose={onClose}>
      <Tabs items={tabItems} />
    </Drawer>
  );
};

export default SettingsDrawer;
