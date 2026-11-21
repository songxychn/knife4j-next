import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, Suspense } from 'react';
import { MenuFoldOutlined, MenuUnfoldOutlined, SettingOutlined } from '@ant-design/icons';
import { Alert, Button, ConfigProvider, Dropdown, Drawer, Layout, MenuProps, Select, theme } from 'antd';
import enUSLocale from 'antd/locale/en_US';
import jaJPLocale from 'antd/locale/ja_JP';
import zhCNLocale from 'antd/locale/zh_CN';
import { Resizable } from 'react-resizable';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { safeDecodeURIComponent as decodePathname } from 'knife4j-core';
import { GroupProvider, useGroup, ApiItem, MarkdownDocItem } from './context/GroupContext';
import { AuthProvider } from './context/AuthContext';
import { GlobalParamProvider } from './context/GlobalParamContext';
import { SettingsProvider, useSettings } from './context/SettingsContext';
import { ApiChangeProvider } from './context/ApiChangeContext';
import { SchemaEngineProvider } from './context/SchemaEngineContext';
import { DEFAULT_LANGUAGE, normalizeSupportedLanguage, synchronizeI18nLanguage } from './locales/language';
import type { SupportedLang } from './types/settings';
import SidebarSearchMenu from './components/SidebarSearchMenu';
import SettingsDrawer from './components/SettingsDrawer';
import ResizableSeparator from './components/ResizableSeparator';
import Tabs from './components/AccessibleTabs';
import PageLoading from './components/PageLoading';
import Markdown from './components/Markdown';
import ExternalResourcePanel from './components/schema/ExternalResourcePanel';
import knife4jMark from './assets/logo/knife4j-next-mark.svg';
import {
  closeTabsOnSide,
  findOperationRouteKey,
  hasClosableTabsOnSide,
  isOperationRouteKey,
  routeKeyToMenuKey,
  type TabCloseSide,
  upsertOperationRoutePane,
} from './utils/operationTabs';
import { resolveFooterContent } from './utils/footer';
import { buildDocumentToolRoute, matchDocumentToolRoute, type DocumentTool } from './utils/documentToolRoutes';
import {
  KNIFE4J_STORAGE_KEYS,
  setKnife4jSessionStorageItem,
  setKnife4jStorageItem,
  subscribeKnife4jStorageCleanup,
} from './storage/knife4jStorage';

const { Header, Sider, Content, Footer } = Layout;
type TargetKey = React.MouseEvent | React.KeyboardEvent | string;

const COMPACT_QUERY = '(max-width: 800px)';
const subscribeCompact = (notify: () => void) => {
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const compactSnapshot = () => window.matchMedia(COMPACT_QUERY).matches;

const HOME_KEY = '/group/home';
const DEFAULT_DOCUMENT_TITLE = 'Knife4j Next';
const isClosablePane = (pane: { key: string }) => pane.key !== HOME_KEY;

const antdLocaleMap: Record<SupportedLang, typeof enUSLocale> = {
  'zh-CN': zhCNLocale,
  'en-US': enUSLocale,
  'ja-JP': jaJPLocale,
};

const schemaRouteInfo = (key: string): { menuKey: string; labelSchema?: string } | null => {
  const match = key.match(/^\/([^/]+)\/schema(?:\/(.+))?$/);
  if (!match) return null;
  return {
    menuKey: `/${match[1]}/schema`,
    labelSchema: match[2] ? decodeURIComponent(match[2]) : undefined,
  };
};

const documentToolTitleKey = (tool: DocumentTool): string => {
  switch (tool) {
    case 'globalParam':
      return 'globalParam.title';
    case 'cookieSession':
      return 'cookieSession.pageTitle';
    case 'authorize':
      return 'auth.pageTitle';
  }
};

interface PersistedTab {
  key: string;
  label: string;
}

/** Read persisted tabs from sessionStorage, filtering out anything invalid. */
function loadPersistedTabs(): { items: PersistedTab[]; activeKey: string } | null {
  try {
    const rawItems = sessionStorage.getItem(KNIFE4J_STORAGE_KEYS.tabItems);
    if (!rawItems) return null;
    const parsed = JSON.parse(rawItems);
    if (!Array.isArray(parsed)) return null;
    const items: PersistedTab[] = parsed.filter((x) => x && typeof x.key === 'string' && typeof x.label === 'string');
    if (items.length === 0) return null;
    const activeKey = sessionStorage.getItem(KNIFE4J_STORAGE_KEYS.tabActive) ?? items[0].key;
    return { items, activeKey };
  } catch {
    return null;
  }
}

const footerStyle: React.CSSProperties = {
  textAlign: 'center',
  fontSize: '14px',
  color: '#595959',
  backgroundColor: '#f0f2f5',
  minHeight: '40px',
};

// Inner component so it can use GroupProvider context
const AppInner: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const compact = useSyncExternalStore(subscribeCompact, compactSnapshot, () => false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [siderWidth, setSiderWidth] = useState(320);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    groups,
    activeGroup,
    markdownDocs,
    setActiveGroupValue,
    swaggerDoc,
    groupError,
    documentDiagnostics: oas31Diagnostics,
    operationEnumerationLimit,
  } = useGroup();
  const { t, i18n } = useTranslation();
  const { settings, setSetting } = useSettings();
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  /**
   * Initialize tab state from sessionStorage once on mount so that a page refresh keeps
   * every previously opened tab (Home is always guaranteed to exist).
   */
  const initialTabsRef = useRef<ReturnType<typeof loadPersistedTabs> | undefined>(undefined);
  if (initialTabsRef.current === undefined) {
    initialTabsRef.current = loadPersistedTabs();
  }
  const initialTabs = initialTabsRef.current;

  const [selectedKey, setSelectedKey] = useState<string>(() =>
    initialTabs ? routeKeyToMenuKey(initialTabs.activeKey) : HOME_KEY,
  );
  const [activeKey, setActiveKey] = useState<string>(() => (initialTabs ? initialTabs.activeKey : HOME_KEY));
  const [items, setItems] = useState<Array<{ label: string; children: string; key: string }>>(() => {
    if (initialTabs) {
      const hasHome = initialTabs.items.some((p) => p.key === HOME_KEY);
      const withHome = hasHome
        ? initialTabs.items
        : [{ label: t('app.tab.home'), key: HOME_KEY }, ...initialTabs.items];
      return withHome.map((p) => ({ label: p.label, children: '', key: p.key }));
    }
    return [{ label: t('app.tab.home'), children: '', key: HOME_KEY }];
  });

  useEffect(
    () =>
      subscribeKnife4jStorageCleanup((scope) => {
        if (scope === 'all-local-data') {
          window.location.reload();
        }
      }),
    [],
  );
  useEffect(() => {
    document.title = swaggerDoc?.info?.title || DEFAULT_DOCUMENT_TITLE;
  }, [swaggerDoc?.info?.title]);

  /**
   * Persist `items` and `activeKey` to sessionStorage on every change so the
   * next hard refresh can rebuild the Tabs bar. `children` is excluded — it
   * holds rendered JSX (and is always replaced by the <Outlet/> at render).
   */
  useEffect(() => {
    try {
      const payload: PersistedTab[] = items.map((p) => ({ key: p.key, label: p.label }));
      setKnife4jSessionStorageItem(sessionStorage, KNIFE4J_STORAGE_KEYS.tabItems, JSON.stringify(payload));
      setKnife4jSessionStorageItem(sessionStorage, KNIFE4J_STORAGE_KEYS.tabActive, activeKey);
    } catch {
      // storage might be disabled or quota exceeded — not fatal
    }
  }, [items, activeKey]);

  /** A newly selected page starts at the top of its bounded workspace. */
  useLayoutEffect(() => {
    [document.scrollingElement, document.documentElement, document.body].forEach((container) => {
      if (!container) return;
      container.scrollTop = 0;
      container.scrollLeft = 0;
    });

    const workspace = workspaceRef.current;
    if (!workspace) return;

    workspace
      .querySelectorAll<HTMLElement>(
        '.knife4j-workspace-tabs > .ant-tabs-body-holder, .knife4j-operation-tabs > .ant-tabs-body-holder, .knife4j-api-debug-main',
      )
      .forEach((container) => {
        container.scrollTop = 0;
        container.scrollLeft = 0;
      });
  }, [location.pathname]);

  /** Keep open tabs aligned with operation, schema, document-tool, and markdown routes. */
  const markdownDocsRef = useRef(markdownDocs);
  markdownDocsRef.current = markdownDocs;

  useEffect(() => {
    const rawPathname = location.pathname;
    if (activeGroup.apis.length > 0 && isOperationRouteKey(rawPathname)) {
      const menuKey = routeKeyToMenuKey(rawPathname);
      const api = activeGroup.apis.find((a) => a.key === menuKey);
      if (api) {
        const title = `${api.method} ${api.summary}`;
        setItems((prev) =>
          upsertOperationRoutePane(prev, rawPathname, title, (key, label) => ({ label, children: '', key })),
        );
        setActiveKey(rawPathname);
        setSelectedKey(menuKey);
      }
      return;
    }

    const pathname = decodePathname(rawPathname);

    const schemaInfo = schemaRouteInfo(pathname);
    if (schemaInfo) {
      if (settings.enableSwaggerModels === false) return;
      const schemaTitle = settings.swaggerModelName || t('schema.title');
      const title = schemaInfo.labelSchema ? `${schemaTitle} / ${schemaInfo.labelSchema}` : schemaTitle;
      setItems((prev) =>
        prev.some((pane) => pane.key === pathname) ? prev : [...prev, { label: title, children: '', key: pathname }],
      );
      setActiveKey(pathname);
      setSelectedKey(schemaInfo.menuKey);
      return;
    }

    const documentToolRoute = matchDocumentToolRoute(pathname);
    if (documentToolRoute) {
      const title = `${t(documentToolTitleKey(documentToolRoute.tool))} - ${activeGroup.label || activeGroup.value}`;
      setItems((prev) => {
        const existingPane = prev.find((pane) => pane.key === pathname);
        if (!existingPane) return [...prev, { label: title, children: '', key: pathname }];
        if (existingPane.label === title) return prev;
        return prev.map((pane) => (pane.key === pathname ? { ...pane, label: title } : pane));
      });
      setActiveKey(pathname);
      setSelectedKey(pathname);
      return;
    }

    const markdownDoc = markdownDocsRef.current.find((doc) => doc.key === pathname);
    if (markdownDoc) {
      setItems((prev) =>
        prev.some((pane) => pane.key === pathname)
          ? prev
          : [...prev, { label: markdownDoc.title, children: '', key: pathname }],
      );
      setActiveKey(pathname);
      setSelectedKey(pathname);
    }
  }, [
    activeGroup.apis,
    activeGroup.label,
    activeGroup.value,
    location.pathname,
    settings.enableSwaggerModels,
    settings.swaggerModelName,
    t,
  ]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [compact]);

  const handleResize = (_e: React.SyntheticEvent, data: { size: { width: number } }) => {
    setSiderWidth(data.size.width);
  };

  const menuClick: MenuProps['onClick'] = (info) => {
    setMobileMenuOpen(false);
    const rawKey = String(info.key);
    const schemaInfo = schemaRouteInfo(rawKey);
    const documentToolRoute = matchDocumentToolRoute(rawKey);
    const markdownDoc: MarkdownDocItem | undefined = markdownDocs.find((doc) => doc.key === rawKey);
    const existingOperationKey =
      schemaInfo || documentToolRoute || markdownDoc ? null : findOperationRouteKey(items, rawKey);
    const newActiveKey =
      schemaInfo || documentToolRoute || markdownDoc ? rawKey : (existingOperationKey ?? `${rawKey}/doc`);
    const tabExists = items.some((pane) => pane.key === newActiveKey);
    if (!tabExists) {
      const api: ApiItem | undefined = activeGroup.apis.find((a) => a.key === rawKey);
      const title = schemaInfo
        ? settings.swaggerModelName || t('schema.title')
        : documentToolRoute
          ? `${t(documentToolTitleKey(documentToolRoute.tool))} - ${activeGroup.label || activeGroup.value}`
          : markdownDoc
            ? markdownDoc.title
            : api
              ? `${api.method} ${api.summary}`
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

  useEffect(() => {
    const replacementKey = activeKey.endsWith('/debug')
      ? settings.enableDebug
        ? null
        : `${activeKey.slice(0, -6)}/doc`
      : activeKey.endsWith('/openapi')
        ? settings.enableOpenApi
          ? null
          : `${activeKey.slice(0, -8)}/doc`
        : null;

    if (!replacementKey) return;

    setItems((prev) =>
      prev.some((pane) => pane.key === replacementKey)
        ? prev.filter((pane) => pane.key !== activeKey)
        : prev.map((pane) => (pane.key === activeKey ? { ...pane, key: replacementKey } : pane)),
    );
    setActiveKey(replacementKey);
    setSelectedKey(routeKeyToMenuKey(replacementKey));
    navigate(replacementKey, { replace: true });
  }, [activeKey, navigate, settings.enableDebug, settings.enableOpenApi]);

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

  const closeCurrent = (anchorKey: string) => {
    if (anchorKey !== HOME_KEY) {
      remove(anchorKey);
    }
  };

  const closeOther = (anchorKey: string) => {
    const newPanes = items.filter((pane) => pane.key === HOME_KEY || pane.key === anchorKey);
    setItems(newPanes);
    if (!newPanes.some((p) => p.key === activeKey)) {
      const targetKey = anchorKey === HOME_KEY ? HOME_KEY : anchorKey;
      setActiveKey(targetKey);
      setSelectedKey(routeKeyToMenuKey(targetKey));
      navigate(targetKey);
    }
  };

  const closeOnSide = (anchorKey: string, side: TabCloseSide) => {
    if (!items.some((pane) => pane.key === anchorKey)) return;

    const nextState = closeTabsOnSide({ items, activeKey }, anchorKey, side, isClosablePane);
    setItems(nextState.items);
    setActiveKey(nextState.activeKey);
    setSelectedKey(routeKeyToMenuKey(nextState.activeKey));
    navigate(nextState.activeKey);
  };

  const closeAll = () => {
    const homePane = items.find((pane) => pane.key === HOME_KEY);
    setItems(homePane ? [homePane] : []);
    setActiveKey(HOME_KEY);
    setSelectedKey(HOME_KEY);
    navigate(HOME_KEY);
  };

  const buildContextMenuItems = (anchorKey: string): MenuProps['items'] => [
    { key: 'closeCurrent', label: t('tab.context.closeCurrent'), onClick: () => closeCurrent(anchorKey) },
    {
      key: 'closeLeft',
      label: t('tab.context.closeLeft'),
      disabled: !hasClosableTabsOnSide(items, anchorKey, 'left', isClosablePane),
      onClick: () => closeOnSide(anchorKey, 'left'),
    },
    {
      key: 'closeRight',
      label: t('tab.context.closeRight'),
      disabled: !hasClosableTabsOnSide(items, anchorKey, 'right', isClosablePane),
      onClick: () => closeOnSide(anchorKey, 'right'),
    },
    { key: 'closeOther', label: t('tab.context.closeOther'), onClick: () => closeOther(anchorKey) },
    { key: 'closeAll', label: t('tab.context.closeAll'), onClick: closeAll },
  ];

  useEffect(() => {
    synchronizeI18nLanguage(i18n, settings.language, false);
  }, [i18n, settings.language]);

  const currentLang = normalizeSupportedLanguage(i18n.language) ?? DEFAULT_LANGUAGE;

  useEffect(() => {
    document.documentElement.lang = currentLang;
  }, [currentLang]);

  useEffect(() => {
    const homeLabel = t('app.tab.home');
    setItems((prev) =>
      prev.some((item) => item.key === HOME_KEY && item.label !== homeLabel)
        ? prev.map((item) => (item.key === HOME_KEY ? { ...item, label: homeLabel } : item))
        : prev,
    );
  }, [currentLang, t]);

  const langLabelMap: Record<SupportedLang, string> = {
    'zh-CN': t('header.lang.zh'),
    'en-US': t('header.lang.en'),
    'ja-JP': t('header.lang.ja'),
  };

  const langMenuItems: MenuProps['items'] = [
    { key: 'zh-CN', label: '中文' },
    { key: 'en-US', label: 'English' },
    { key: 'ja-JP', label: '日本語' },
  ];

  const onLangMenuClick: MenuProps['onClick'] = ({ key }) => {
    const next = normalizeSupportedLanguage(key);
    if (next) {
      setKnife4jStorageItem(localStorage, KNIFE4J_STORAGE_KEYS.language, next);
      setSetting('language', next);
    }
  };

  const langLabel = langLabelMap[currentLang];

  const groupOptions = groups.map((g) => ({ value: g.value, label: g.label }));
  const handleGroupChange = (value: string) => {
    setMobileMenuOpen(false);
    setActiveGroupValue(value);

    const documentToolRoute = matchDocumentToolRoute(location.pathname);
    if (documentToolRoute) {
      const key = buildDocumentToolRoute(value, documentToolRoute.tool);
      const groupLabel = groups.find((group) => group.value === value)?.label || value;
      const title = `${t(documentToolTitleKey(documentToolRoute.tool))} - ${groupLabel}`;
      setItems((prev) => {
        const existingPane = prev.find((pane) => pane.key === key);
        if (!existingPane) return [...prev, { label: title, children: '', key }];
        if (existingPane.label === title) return prev;
        return prev.map((pane) => (pane.key === key ? { ...pane, label: title } : pane));
      });
      setSelectedKey(key);
      setActiveKey(key);
      navigate(key);
      return;
    }

    setSelectedKey(HOME_KEY);
    setActiveKey(HOME_KEY);
    navigate(`/${value}/home`);
  };
  const tabItems = items.map((item) => ({
    ...item,
    label: (
      <Dropdown menu={{ items: buildContextMenuItems(item.key) }} trigger={['contextMenu']}>
        <span>{item.label}</span>
      </Dropdown>
    ),
    closable: item.key !== HOME_KEY,
    children:
      item.key === activeKey ? (
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      ) : (
        item.children
      ),
  }));
  const rawHeaderTitle = swaggerDoc?.info?.title?.trim();
  const headerTitle = rawHeaderTitle && rawHeaderTitle !== 'API Docs' ? rawHeaderTitle : t('app.header.title');
  const footerContent = resolveFooterContent(settings, t('app.footer'));

  const navigationContent = (
    <nav id="knife4j-navigation" className="knife4j-navigation" aria-label={t('app.navigation.title')}>
      {/* Brand */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 10,
          minHeight: 56,
          padding: !compact && collapsed ? '12px 0' : '12px 16px',
          color: '#fff',
          fontSize: !compact && collapsed ? 14 : 20,
          fontWeight: 700,
          letterSpacing: !compact && collapsed ? 0 : 0.2,
          whiteSpace: 'nowrap',
        }}
      >
        <img src={knife4jMark} alt="knife4j" style={{ width: 28, height: 28 }} />
        {(compact || !collapsed) && <span>{t('app.brand')}</span>}
      </div>

      {/* Group switcher */}
      {(compact || !collapsed) && settings.enableGroup && groupOptions.length > 0 && (
        <div style={{ padding: '0 8px 8px' }}>
          <Select
            aria-label={t('app.group')}
            options={groupOptions}
            value={activeGroup.value}
            style={{ width: '100%' }}
            onChange={handleGroupChange}
          />
        </div>
      )}

      {/* Search + Menu */}
      <SidebarSearchMenu selectedKey={selectedKey} onMenuClick={menuClick} collapsed={!compact && collapsed} />
    </nav>
  );

  return (
    <ConfigProvider
      locale={antdLocaleMap[currentLang]}
      theme={{ token: { colorTextSecondary: '#595959' }, components: { Tabs: { itemSelectedColor: '#0958d9' } } }}
    >
      <Layout className="knife4j-app-layout" inert={settingsOpen || (compact && mobileMenuOpen)}>
        {compact ? (
          <Drawer
            title={t('app.navigation.title')}
            placement="left"
            size={320}
            open={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
            styles={{ wrapper: { maxWidth: '100vw' }, body: { padding: 0, background: '#001529' } }}
          >
            {navigationContent}
          </Drawer>
        ) : (
          <Resizable
            width={siderWidth}
            height={Infinity}
            handle={
              <ResizableSeparator
                hidden={collapsed}
                tabIndex={collapsed ? -1 : 0}
                className="react-resizable-handle"
                value={siderWidth}
                min={260}
                max={520}
                onValueChange={setSiderWidth}
                label={t('app.navigation.resize')}
                controls="knife4j-navigation"
              />
            }
            resizeHandles={['e']}
            onResize={handleResize}
            minConstraints={[260, Infinity]}
            maxConstraints={[520, Infinity]}
            draggableOpts={{ enableUserSelectHack: false }}
          >
            <Sider
              className="knife4j-app-sider"
              trigger={null}
              collapsible
              collapsed={collapsed}
              collapsedWidth={56}
              width={siderWidth}
              style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            >
              {navigationContent}
            </Sider>
          </Resizable>
        )}

        <Layout className="knife4j-main-layout">
          <Header
            className="knife4j-main-header"
            style={{
              padding: 0,
              background: colorBgContainer,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Button
              type="text"
              aria-label={t(compact || collapsed ? 'app.navigation.open' : 'app.navigation.close')}
              aria-expanded={compact ? mobileMenuOpen : !collapsed}
              aria-controls={!compact || mobileMenuOpen ? 'knife4j-navigation' : undefined}
              icon={
                compact || collapsed ? (
                  <MenuUnfoldOutlined aria-hidden="true" />
                ) : (
                  <MenuFoldOutlined aria-hidden="true" />
                )
              }
              onClick={() => (compact ? setMobileMenuOpen(true) : setCollapsed(!collapsed))}
              style={{ fontSize: 16, width: 64, height: 64, flexShrink: 0 }}
            />
            <span className="knife4j-header-title">{headerTitle}</span>
            <span
              className="knife4j-header-actions"
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}
            >
              <Dropdown
                menu={{
                  items: langMenuItems,
                  selectedKeys: [currentLang],
                  onClick: onLangMenuClick,
                }}
                trigger={['click']}
              >
                <Button
                  aria-label={`${t('app.language')}: ${langLabel}`}
                  type="text"
                  style={{ fontSize: 14, height: 48, padding: '0 12px', fontWeight: 600 }}
                >
                  {langLabel}
                </Button>
              </Dropdown>
              <Button
                type="text"
                aria-label={t('settings.title')}
                icon={<SettingOutlined aria-hidden="true" />}
                onClick={() => setSettingsOpen(true)}
                style={{ fontSize: 16, width: 48, height: 48 }}
              />
            </span>
          </Header>

          <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />

          <Content
            className="knife4j-main-content"
            style={{
              margin: '6px 4px',
              padding: 6,
              background: colorBgContainer,
            }}
          >
            <div
              ref={workspaceRef}
              className="knife4j-main-content-inner"
              style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            >
              {groupError && (
                <Alert
                  type="error"
                  showIcon
                  title={t('app.groupError.title')}
                  description={
                    <span style={{ whiteSpace: 'pre-wrap' }}>{t(groupError.key, groupError.values ?? {})}</span>
                  }
                  style={{ margin: '2px 2px 8px' }}
                />
              )}
              {operationEnumerationLimit && (
                <Alert
                  type="warning"
                  showIcon
                  title={t('app.operationLimit.title')}
                  description={t('app.operationLimit.description', { ...operationEnumerationLimit.limits })}
                  style={{ margin: '2px 2px 8px' }}
                />
              )}
              {oas31Diagnostics.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  title={t(
                    swaggerDoc?.openapi?.startsWith('3.2.')
                      ? 'app.oas32Compatibility.title'
                      : 'app.oas31Compatibility.title',
                  )}
                  description={
                    <div>
                      <div>{t('app.oas31Compatibility.description', { count: oas31Diagnostics.length })}</div>
                      <ul style={{ margin: '4px 0 0', paddingInlineStart: 20 }}>
                        {oas31Diagnostics.slice(0, 5).map((diagnostic) => (
                          <li key={`${diagnostic.code}:${diagnostic.path}:${diagnostic.value ?? ''}`}>
                            <code>{diagnostic.code}</code> — <code>{diagnostic.path}</code>
                            {diagnostic.value ? `: ${diagnostic.value}` : ''}
                            {` — ${diagnostic.reason}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  }
                  style={{ margin: '2px 2px 8px' }}
                />
              )}
              <ExternalResourcePanel />
              <Tabs
                tabListLabel={t('app.tabs.label')}
                className={`knife4j-workspace-tabs${isOperationRouteKey(location.pathname) ? ' knife4j-workspace-operation' : ''}`}
                hideAdd
                onChange={onChange}
                activeKey={activeKey}
                type="editable-card"
                onEdit={onEdit}
                items={tabItems}
                style={{ flex: 1, margin: '2px 2px' }}
              />
            </div>
          </Content>

          {footerContent && (
            <Footer className="knife4j-main-footer" style={footerStyle}>
              {footerContent.kind === 'custom' ? (
                <div className="knife4j-footer-markdown">
                  <Markdown source={footerContent.content} />
                </div>
              ) : (
                footerContent.content
              )}
            </Footer>
          )}
        </Layout>
      </Layout>
    </ConfigProvider>
  );
};

const App: React.FC = () => (
  <ConfigProvider>
    <SettingsProvider>
      <GroupProvider>
        <SchemaEngineProvider>
          <ApiChangeProvider>
            <GroupScopedApp />
          </ApiChangeProvider>
        </SchemaEngineProvider>
      </GroupProvider>
    </SettingsProvider>
  </ConfigProvider>
);

const GroupScopedApp: React.FC = () => {
  const { activeGroup } = useGroup();
  const groupId = activeGroup.value || 'default';

  return (
    <AuthProvider initialGroupId={groupId}>
      <GlobalParamProvider groupId={groupId}>
        <AppInner />
      </GlobalParamProvider>
    </AuthProvider>
  );
};

export default App;
