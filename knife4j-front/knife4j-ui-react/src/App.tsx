import React, { useState } from 'react';
import { MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, ConfigProvider, Dropdown, Layout, MenuProps, Select, Tabs, theme } from 'antd';
import { Resizable } from 'react-resizable';
import { Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GroupProvider, useGroup, ApiItem } from './context/GroupContext';
import { AuthProvider } from './context/AuthContext';
import { GlobalParamProvider } from './context/GlobalParamContext';
import SidebarSearchMenu from './compoents/SidebarSearchMenu';
import SettingsDrawer from './compoents/SettingsDrawer';
import knife4jMark from './assets/logo/knife4j-next-mark.svg';

const { Header, Sider, Content, Footer } = Layout;
type TargetKey = React.MouseEvent | React.KeyboardEvent | string;

const HOME_KEY = '/group/home';

const routeKeyToMenuKey = (key: string) => (key.endsWith('/doc') ? key.slice(0, -4) : key);

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [siderWidth, setSiderWidth] = useState(320);
  const navigate = useNavigate();
  const { groups, activeGroup, setActiveGroupValue } = useGroup();
  const { t, i18n } = useTranslation();

  const {
    token: { colorBgContainer },
  } = theme.useToken();

  const [selectedKey, setSelectedKey] = useState(HOME_KEY);
  const [activeKey, setActiveKey] = useState(HOME_KEY);
  const [items, setItems] = useState([{ label: t('app.tab.home'), children: '', key: HOME_KEY }]);
  const [contextMenuKey, setContextMenuKey] = useState<string | null>(null);

  const handleResize = (_e: React.SyntheticEvent, data: { size: { width: number } }) => {
    setSiderWidth(data.size.width);
  };

  const menuClick: MenuProps['onClick'] = (info) => {
    const newActiveKey = `${info.key}/doc`;
    const tabExists = items.some((pane) => pane.key === newActiveKey);
    if (!tabExists) {
      // Find the matching API to use its summary as tab title
      const api: ApiItem | undefined = activeGroup.apis.find((a) => a.key === info.key);
      const title = api ? `${api.method.toUpperCase()} ${api.summary}` : info.key;
      setItems([...items, { label: title, children: '', key: newActiveKey }]);
    }
    setSelectedKey(info.key);
    setActiveKey(newActiveKey);
    navigate(newActiveKey);
  };

  const onChange = (key: string) => {
    setActiveKey(key);
    setSelectedKey(routeKeyToMenuKey(key));
    navigate(key);
  };

  const remove = (targetKey: TargetKey) => {
    const targetIndex = items.findIndex((pane) => pane.key === targetKey);
    const newPanes = items.filter((pane) => pane.key !== targetKey);
    if (newPanes.length && targetKey === activeKey) {
      const { key } = newPanes[targetIndex === newPanes.length ? targetIndex - 1 : targetIndex];
      setActiveKey(key);
    }
    setItems(newPanes);
  };

  const onEdit = (targetKey: TargetKey, action: 'add' | 'remove') => {
    if (action === 'remove') remove(targetKey);
  };

  const closeCurrent = () => {
    if (contextMenuKey && contextMenuKey !== HOME_KEY) {
      remove(contextMenuKey);
    }
  };

  const closeOther = () => {
    if (contextMenuKey) {
      const newPanes = items.filter(
        (pane) => pane.key === HOME_KEY || pane.key === contextMenuKey,
      );
      setItems(newPanes);
      if (!newPanes.some((p) => p.key === activeKey)) {
        const targetKey = contextMenuKey === HOME_KEY ? HOME_KEY : contextMenuKey;
        setActiveKey(targetKey);
        setSelectedKey(routeKeyToMenuKey(targetKey));
        navigate(targetKey);
      }
    }
  };

  const closeAll = () => {
    const homePane = items.find((pane) => pane.key === HOME_KEY);
    setItems(homePane ? [homePane] : []);
    setActiveKey(HOME_KEY);
    setSelectedKey(HOME_KEY);
    navigate(HOME_KEY);
  };

  const contextMenuItems: MenuProps['items'] = [
    { key: 'closeCurrent', label: t('tab.context.closeCurrent'), onClick: closeCurrent },
    { key: 'closeOther', label: t('tab.context.closeOther'), onClick: closeOther },
    { key: 'closeAll', label: t('tab.context.closeAll'), onClick: closeAll },
  ];

  const toggleLang = () => {
    const next = i18n.language === 'zh-CN' ? 'en-US' : 'zh-CN';
    i18n.changeLanguage(next);
  };

  const langLabel = i18n.language === 'zh-CN' ? t('header.lang.en') : t('header.lang.zh');

  const groupOptions = groups.map((g) => ({ value: g.value, label: g.label }));
  const tabItems = items.map((item) => ({
    ...item,
    children: item.key === activeKey ? <Outlet /> : item.children,
  }));

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
          {/* Brand */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 10,
              minHeight: 56,
              padding: collapsed ? '12px 0' : '12px 16px',
              color: '#fff',
              fontSize: collapsed ? 14 : 20,
              fontWeight: 700,
              letterSpacing: collapsed ? 0 : 0.2,
              whiteSpace: 'nowrap',
            }}
          >
            <img src={knife4jMark} alt="knife4j" style={{ width: 28, height: 28 }} />
            {!collapsed && <span>{t('app.brand')}</span>}
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
          <SidebarSearchMenu selectedKey={selectedKey} onMenuClick={menuClick} />
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
          {t('app.header.title')}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
            <Button
              type="text"
              onClick={toggleLang}
              style={{ fontSize: 14, height: 48, padding: '0 12px', fontWeight: 600 }}
            >
              {langLabel}
            </Button>
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
              style={{ fontSize: 16, width: 48, height: 48 }}
            />
          </span>
        </Header>

        <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        <Content
          style={{
            margin: '6px 4px',
            minHeight: 610,
            padding: 6,
            background: colorBgContainer,
          }}
        >
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Dropdown menu={{ items: contextMenuItems }} trigger={['contextMenu']}>
              <div>
                <Tabs
                  hideAdd
                  onChange={onChange}
                  activeKey={activeKey}
                  type="editable-card"
                  onEdit={onEdit}
                  items={tabItems}
                  style={{ flex: 1, margin: '2px 2px' }}
                  onTabClick={(key) => setContextMenuKey(key)}
                />
              </div>
            </Dropdown>
          </div>
        </Content>

        <Footer style={footerStyle}>{t('app.footer')}</Footer>
      </Layout>
    </Layout>
  );
};

const App: React.FC = () => (
  <ConfigProvider>
    <AuthProvider>
      <GlobalParamProvider>
        <GroupProvider>
          <AppInner />
        </GroupProvider>
      </GlobalParamProvider>
    </AuthProvider>
  </ConfigProvider>
);

export default App;
