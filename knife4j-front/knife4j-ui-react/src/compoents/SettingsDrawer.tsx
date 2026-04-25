import React from 'react';
import { Drawer, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import Authorize from '../pages/Authorize';
import GlobalParam from '../pages/document/GlobalParam';
import OfficeDoc from '../pages/document/OfficeDoc';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ open, onClose }) => {
  const { t } = useTranslation();

  const tabItems = [
    { key: 'authorize', label: t('settings.tab.authorize'), children: <Authorize /> },
    { key: 'globalParam', label: t('settings.tab.globalParam'), children: <GlobalParam /> },
    { key: 'officeDoc', label: t('settings.tab.offlineDoc'), children: <OfficeDoc /> },
  ];

  return (
    <Drawer title={t('settings.title')} placement="right" width={600} open={open} onClose={onClose}>
      <Tabs items={tabItems} />
    </Drawer>
  );
};

export default SettingsDrawer;
