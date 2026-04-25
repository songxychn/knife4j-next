import React, { useState } from 'react';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Layout, Button, Select, ConfigProvider, Tabs, theme } from 'antd';
import { Resizable } from 'react-resizable';
import { useNavigate } from 'react-router-dom';
import { GroupProvider, useGroup } from './context/GroupContext';
import { AuthProvider } from './context/AuthContext';
import SidebarSearchMenu from './compoents/SidebarSearchMenu';

const { Header, Sider, Content, Footer } = Layout;
type TargetKey = React.MouseEvent | React.KeyboardEvent | string;

const defaultPanes = [{ label: '主页', children: '', key: '/group/home' }];

const footerStyle: React.CSSProperties = {
  textAlign: 'center',
  fontSize: '14px',
  color: '#848587',
  backgroundColor: '#f0f2f5',
  minHeight: '40px',
};

// Inner component so it can use GroupProvider context
const AppInner: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [siderWidth, setSiderWidth] = useState(320);
  const navigate = useNavigate();
  const { groups, setActiveGroupValue } = useGroup();

  const {
    token: { colorBgContainer },
  } = theme.useToken();

  const [selectedKey, setSelectedKey] = useState('/group/home');
  const [activeKey, setActiveKey] = useState(defaultPanes[0].key);
  const [items, setItems] = useState(defaultPanes);

  const handleResize = (
    _e: React.SyntheticEvent,
    data: { size: { width: number } }
  ) => {
    setSiderWidth(data.size.width);
  };

  const menuClick = (menu: { key: string; item: { props: { title: string } } }) => {
    const newActiveKey = menu.key;
    const tabExists = items.some((pane) => pane.key === newActiveKey);
    if (!tabExists) {
      const title = menu.item.props.title;
      setItems([...items, { label: title, children: '', key: newActiveKey }]);
    }
    setSelectedKey(newActiveKey);
    setActiveKey(newActiveKey);
    navigate(menu.key);
  };

  const onChange = (key: string) => {
    setActiveKey(key);
    setSelectedKey(key);
    navigate(key);
  };

  const remove = (targetKey: TargetKey) => {
    const targetIndex = items.findIndex((pane) => pane.key === targetKey);
    const newPanes = items.filter((pane) => pane.key !== targetKey);
    if (newPanes.length && targetKey === activeKey) {
      const { key } =
        newPanes[targetIndex === newPanes.length ? targetIndex - 1 : targetIndex];
      setActiveKey(key);
    }
    setItems(newPanes);
  };

  const onEdit = (targetKey: TargetKey, action: 'add' | 'remove') => {
    if (action === 'remove') remove(targetKey);
  };

  const groupOptions = groups.map((g) => ({ value: g.value, label: g.label }));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Resizable
        width={siderWidth}
        height={Infinity}
        handle={<div className="react-resizable-handle" />}
        resizeHandles={['e']}
        onResize={handleResize}
        minConstraints={[260, Infinity]}
        maxConstraints={[520, Infinity]}
        draggableOpts={{ enableUserSelectHack: false }}
      >
        <Sider
          trigger={null}
          collapsible
          collapsed={collapsed}
          width={siderWidth}
          style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
          {/* Logo */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '8px 0',
            }}
          >
            <img src="/src/assets/logo/k.png" style={{ width: 32, height: 32 }} />
          </div>

          {/* Group switcher */}
          {!collapsed && (
            <div style={{ padding: '0 8px 8px' }}>
              <Select
                options={groupOptions}
                defaultValue={groupOptions[0].value}
                style={{ width: '100%' }}
                onChange={(val) => setActiveGroupValue(val)}
              />
            </div>
          )}

          {/* Search + Menu */}
          <SidebarSearchMenu
            selectedKey={selectedKey}
            onMenuClick={menuClick}
          />
        </Sider>
      </Resizable>

      <Layout>
        <Header
          style={{
            padding: 0,
            background: colorBgContainer,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: 16, width: 64, height: 64 }}
          />
          OpenAPI 接口文档聚合中心
          <span style={{ marginLeft: 'auto' }}>
            <Button
              type="text"
              icon={<SettingOutlined />}
              style={{ fontSize: 16, width: 48, height: 48 }}
            />
          </span>
        </Header>

        <Content
          style={{
            margin: '6px 4px',
            minHeight: 610,
            padding: 6,
            background: colorBgContainer,
          }}
        >
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Tabs
              hideAdd
              onChange={onChange}
              activeKey={activeKey}
              type="editable-card"
              onEdit={onEdit}
              items={items}
              style={{ flex: 1, margin: '2px 2px' }}
            />
          </div>
        </Content>

        <Footer style={footerStyle}>
          Apache License 2.0 | Copyright 2019-Knife4j v5.0
        </Footer>
      </Layout>
    </Layout>
  );
};

const App: React.FC = () => (
  <ConfigProvider>
    <AuthProvider>
      <GroupProvider>
        <AppInner />
      </GroupProvider>
    </AuthProvider>
  </ConfigProvider>
);

export default App;
