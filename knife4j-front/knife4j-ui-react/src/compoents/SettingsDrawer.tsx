import React from 'react';
import { Drawer, Tabs } from 'antd';
import Authorize from '../pages/Authorize';
import GlobalParam from '../pages/document/GlobalParam';
import OfficeDoc from '../pages/document/OfficeDoc';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

const SettingsDrawer: React.FC<SettingsDrawerProps> = ({ open, onClose }) => {
  const tabItems = [
    { key: 'authorize', label: 'Authorize', children: <Authorize /> },
    { key: 'globalParam', label: '全局参数', children: <GlobalParam /> },
    { key: 'officeDoc', label: '离线文档', children: <OfficeDoc /> },
  ];

  return (
    <Drawer
      title="设置"
      placement="right"
      width={600}
      open={open}
      onClose={onClose}
    >
      <Tabs items={tabItems} />
    </Drawer>
  );
};

export default SettingsDrawer;
