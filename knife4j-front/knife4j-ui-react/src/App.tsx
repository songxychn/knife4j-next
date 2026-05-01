import React, { useEffect, useRef, useState } from 'react';
import { MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, ConfigProvider, Dropdown, Layout, MenuProps, Select, Tabs, theme } from 'antd';
import { Resizable } from 'react-resizable';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GroupProvider, useGroup, ApiItem, MarkdownDocItem } from './context/GroupContext';
import { AuthProvider } from './context/AuthContext';
import { GlobalParamProvider } from './context/GlobalParamContext';
import { SettingsProvider } from './context/SettingsContext';
import SidebarSearchMenu from './compoents/SidebarSearchMenu';
import SettingsDrawer from './compoents/SettingsDrawer';
import knife4jMark from './assets/logo/knife4j-next-mark.svg';

const { Header, Sider, Content, Footer } = Layout;
type TargetKey = React.MouseEvent | React.KeyboardEvent | string;

const HOME_KEY = '/group/home';

/** sessionStorage keys for persisting opened tabs across page refresh. */
const STORAGE_KEY_ITEMS = 'knife4j-next:tab-items';
const STORAGE_KEY_ACTIVE = 'knife4j-next:tab-active';

/**
 * Strip the trailing `/doc` or `/debug` mode segment from a route key to
 * obtain the corresponding sidebar menu key.
 */
const routeKeyToMenuKey = (key: string) =>
  key.endsWith('/doc')
    ? key.slice(0, -4)
    : key.endsWith('/debug')
      ? key.slice(0, -6)
      : key.endsWith('/openapi')
        ? key.slice(0, -8)
        : key.endsWith('/script')
          ? key.slice(0, -7)
          : key.includes('/schema')
            ? key.replace(/\/schema\/.*$/, '/schema')
            : key;

const schemaRouteInfo = (key: string): { menuKey: string; labelSchema?: string } | null => {
  const match = key.match(/^\/([^/]+)\/schema(?:\/(.+))?$/);
  if (!match) return null;
  return {
    menuKey: `/${match[1]}/schema`,
    labelSchema: match[2] ? decodeURIComponent(match[2]) : undefined,
  };
};

interface PersistedTab {
  key: string;
  label: string;
}

/** Read persisted tabs from sessionStorage, filtering out anything invalid. */
function loadPersistedTabs(): { items: PersistedTab[]; activeKey: string } | null {
  try {
    const rawItems = sessionStorage.getItem(STORAGE_KEY_ITEMS);
    if (!rawItems) return null;
    const parsed = JSON.parse(rawItems);
    if (!Array.isArray(parsed)) return null;
    const items: PersistedTab[] = parsed.filter((x) => x && typeof x.key === 'string' && typeof x.label === 'string');
    if (items.length === 0) return null;
    const activeKey = sessionStorage.getItem(STORAGE_KEY_ACTIVE) ?? items[0].key;
    return { items, activeKey };
  } catch {
    return null;
  }
}

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
  const location = useLocation();
  const { groups, activeGroup, markdownDocs, setActiveGroupValue } = useGroup();
  const { t, i18n } = useTranslation();

  const {
    token: { colorBgContainer },
  } = theme.useToken();

  /**
   * Initialize tab state from sessionStorage so that a page refresh keeps
   * every previously opened tab (Home is always guaranteed to exist). If
   * no persisted state exists, fall back to a fresh Home-only layout.
   */
  const [selectedKey, setSelectedKey] = useState<string>(() => {
    const persisted = loadPersistedTabs();
    return persisted ? routeKeyToMenuKey(persisted.activeKey) : HOME_KEY;
  });
  const [activeKey, setActiveKey] = useState<string>(() => {
    const persisted = loadPersistedTabs();
    return persisted ? persisted.activeKey : HOME_KEY;
  });
  const [items, setItems] = useState<Array<{ label: string; children: string; key: string }>>(() => {
    const persisted = loadPersistedTabs();
    if (persisted) {
      const hasHome = persisted.items.some((p) => p.key === HOME_KEY);
      const withHome = hasHome ? persisted.items : [{ label: t('app.tab.home'), key: HOME_KEY }, ...persisted.items];
      return withHome.map((p) => ({ label: p.label, children: '', key: p.key }));
    }
    return [{ label: t('app.tab.home'), children: '', key: HOME_KEY }];
  });
  const [contextMenuKey, setContextMenuKey] = useState<string | null>(null);

  /**
   * Persist `items` and `activeKey` to sessionStorage on every change so the
   * next hard refresh can rebuild the Tabs bar. `children` is excluded — it
   * holds rendered JSX (and is always replaced by the <Outlet/> at render).
   */
  useEffect(() => {
    try {
      const payload: PersistedTab[] = items.map((p) => ({ key: p.key, label: p.label }));
      sessionStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(payload));
      sessionStorage.setItem(STORAGE_KEY_ACTIVE, activeKey);
    } catch {
      // storage might be disabled or quota exceeded — not fatal
    }
  }, [items, activeKey]);

  /**
   * If the URL points at an operation route but the corresponding tab was
   * not restored from sessionStorage (e.g. direct deep-link from another
   * place), inject it once `activeGroup.apis` is loaded.
   */
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    if (activeGroup.apis.length === 0) return;

    // `useLocation().pathname` is URL-encoded; ApiItem.key stores the decoded
    // form (e.g. Chinese tag names), so normalize before matching.
    let pathname: string;
    try {
      pathname = decodeURIComponent(location.pathname);
    } catch {
      pathname = location.pathname;
    }

    const isApiRoute = pathname.endsWith('/doc') || pathname.endsWith('/debug') || pathname.endsWith('/openapi') || pathname.endsWith('/script');
    if (!isApiRoute) {
      restoredRef.current = true;
      return;
    }

    const menuKey = routeKeyToMenuKey(pathname);
    const api = activeGroup.apis.find((a) => a.key === menuKey);
    if (!api) return; // apis loaded but this one didn't match; wait for other groups

    restoredRef.current = true;
    const title = `${api.method.toUpperCase()} ${api.summary}`;
    setItems((prev) =>
      prev.some((p) => p.key === pathname) ? prev : [...prev, { label: title, children: '', key: pathname }],
    );
    setActiveKey(pathname);
    setSelectedKey(menuKey);
  }, [activeGroup.apis, location.pathname]);

  /**
   * Programmatic navigation from a schema type link should become a real tab,
   * not silently replace the content of the previously active API tab.
   */
  useEffect(() => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(location.pathname);
    } catch {
      pathname = location.pathname;
    }

    const info = schemaRouteInfo(pathname);
    if (!info) return;

    const title = info.labelSchema ? `${t('schema.title')} / ${info.labelSchema}` : t('schema.title');
    setItems((prev) =>
      prev.some((pane) => pane.key === pathname) ? prev : [...prev, { label: title, children: '', key: pathname }],
    );
    setActiveKey(pathname);
    setSelectedKey(info.menuKey);
  }, [location.pathname, t]);

  // Keep a ref to markdownDocs so the pathname-change effect below can read
  // the latest value without adding markdownDocs to its dependency array.
  // Adding markdownDocs directly would cause the effect to re-fire on every
  // language switch (markdownDocs is recomputed from i18n context), which
  // would forcibly reset activeKey/selectedKey and interrupt the user's
  // current tab.
  const markdownDocsRef = useRef(markdownDocs);
  useEffect(() => {
    markdownDocsRef.current = markdownDocs;
  }, [markdownDocs]);

  useEffect(() => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(location.pathname);
    } catch {
      pathname = location.pathname;
    }

    const markdownDoc = markdownDocsRef.current.find((doc) => doc.key === pathname);
    if (!markdownDoc) return;

    setItems((prev) =>
      prev.some((pane) => pane.key === pathname)
        ? prev
        : [...prev, { label: markdownDoc.title, children: '', key: pathname }],
    );
    setActiveKey(pathname);
    setSelectedKey(pathname);
  }, [location.pathname]);

  const handleResize = (_e: React.SyntheticEvent, data: { size: { width: number } }) => {
    setSiderWidth(data.size.width);
  };

  const menuClick: MenuProps['onClick'] = (info) => {
    const rawKey = String(info.key);
    const schemaInfo = schemaRouteInfo(rawKey);
    const markdownDoc: MarkdownDocItem | undefined = markdownDocs.find((doc) => doc.key === rawKey);
    const newActiveKey = schemaInfo || markdownDoc ? rawKey : `${rawKey}/doc`;
    const tabExists = items.some((pane) => pane.key === newActiveKey);
    if (!tabExists) {
      const api: ApiItem | undefined = activeGroup.apis.find((a) => a.key === rawKey);
      const title = schemaInfo
        ? t('schema.title')
        : markdownDoc
        ? markdownDoc.title
        : api
        ? `${api.method.toUpperCase()} ${api.summary}`
        : rawKey;
      setItems([...items, { label: title, children: '', key: newActiveKey }]);
    }
    setSelectedKey(routeKeyToMenuKey(newActiveKey));
    setActiveKey(newActiveKey);
    navigate(newActiveKey);
  };

  const onChange = (key: string) => {
    setActiveKey(key);
    setSelectedKey(routeKeyToMenuKey(key));
    navigate(key);
  };

  const remove = (targetKey: TargetKey) => {
    // Home tab is not closable – it acts as the persistent entry point.
    if (targetKey === HOME_KEY) return;
    const targetIndex = items.findIndex((pane) => pane.key === targetKey);
    const newPanes = items.filter((pane) => pane.key !== targetKey);
    if (newPanes.length && targetKey === activeKey) {
      const { key } = newPanes[targetIndex === newPanes.length ? targetIndex - 1 : targetIndex];
      setActiveKey(key);
      setSelectedKey(routeKeyToMenuKey(key));
      navigate(key);
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
      const newPanes = items.filter((pane) => pane.key === HOME_KEY || pane.key === contextMenuKey);
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
    closable: item.key !== HOME_KEY,
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
          collapsedWidth={56}
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
          {!collapsed && groupOptions.length > 0 && (
            <div style={{ padding: '0 8px 8px' }}>
              <Select
                options={groupOptions}
                value={activeGroup.value}
                style={{ width: '100%' }}
                onChange={(val) => setActiveGroupValue(val)}
              />
            </div>
          )}

          {/* Search + Menu */}
          <SidebarSearchMenu selectedKey={selectedKey} onMenuClick={menuClick} collapsed={collapsed} />
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
    <SettingsProvider>
      <AuthProvider>
        <GlobalParamProvider>
          <GroupProvider>
            <AppInner />
          </GroupProvider>
        </GlobalParamProvider>
      </AuthProvider>
    </SettingsProvider>
  </ConfigProvider>
);

export default App;
