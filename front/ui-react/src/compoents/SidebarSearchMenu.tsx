import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Menu, MenuProps, Tooltip } from 'antd';
import {
  ApiOutlined,
  CheckOutlined,
  ControlOutlined,
  DatabaseOutlined,
  FileMarkdownOutlined,
  InfoCircleOutlined,
  LoginOutlined,
  SearchOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ApiItem, useGroup } from '../context/GroupContext';
import { useGlobalParam } from '../context/GlobalParamContext';
import { useSettings } from '../context/SettingsContext';
import { useApiChanges } from '../context/ApiChangeContext';
import {
  apiOperationIdentity,
  type ApiChangeStatus,
  type ApiChangeUnavailableReason,
} from '../apiChange/apiChangeTracker';
import Markdown from '../components/Markdown';
import { oas32TagMenu, oas32TagPresentationParents } from '../schema/oas32TagMenu';

const METHOD_COLORS: Record<string, string> = {
  GET: '#61affe',
  POST: '#49cc90',
  PUT: '#fca130',
  DELETE: '#f93e3e',
  PATCH: '#50e3c2',
};

const API_CHANGE_UNAVAILABLE_KEYS: Record<ApiChangeUnavailableReason, string> = {
  preparing: 'sidebar.apiChange.unavailable.preparing',
  'resource-pending': 'sidebar.apiChange.unavailable.resourcePending',
  'resource-budget': 'sidebar.apiChange.unavailable.resourceBudget',
  'dialect-unsupported': 'sidebar.apiChange.unavailable.dialectUnsupported',
  'document-invalid': 'sidebar.apiChange.unavailable.documentInvalid',
  'resource-failed': 'sidebar.apiChange.unavailable.resourceFailed',
  'snapshot-unavailable': 'sidebar.apiChange.unavailable.snapshot',
  'version-unsupported': 'sidebar.apiChange.unavailable.version',
};

function methodTag(method: string) {
  const color = METHOD_COLORS[method.toUpperCase()] ?? '#999';
  return (
    <span
      style={{
        display: 'inline-block',
        flex: '0 0 auto',
        width: 54,
        padding: '0 4px',
        marginRight: 6,
        borderRadius: 3,
        fontSize: 11,
        fontWeight: 700,
        color: '#fff',
        backgroundColor: color,
        textAlign: 'center',
        lineHeight: '18px',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {method}
    </span>
  );
}

function changePill(status: ApiChangeStatus, label: string) {
  const color = status === 'added' ? '#52c41a' : '#fa8c16';
  return (
    <span
      style={{
        flex: '0 0 auto',
        marginLeft: 6,
        padding: '0 5px',
        border: `1px solid ${color}`,
        borderRadius: 8,
        color,
        fontSize: 9,
        fontWeight: 700,
        lineHeight: '16px',
      }}
    >
      {label}
    </span>
  );
}

interface SidebarSearchMenuProps {
  selectedKey: string;
  onMenuClick: MenuProps['onClick'];
  collapsed?: boolean;
}

const SidebarSearchMenu: React.FC<SidebarSearchMenuProps> = ({ selectedKey, onMenuClick, collapsed = false }) => {
  const { activeGroup, swaggerDoc, menuTags, markdownDocs, schemas } = useGroup();
  const { effectiveParams } = useGlobalParam();
  const { settings } = useSettings();
  const apiChanges = useApiChanges();
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState('');
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const navigation32 = useMemo(
    () => oas32TagMenu(swaggerDoc, menuTags, activeGroup.apis, searchText),
    [swaggerDoc, menuTags, activeGroup.apis, searchText],
  );
  const tagKey = (name: string) => `tag-${name}`;

  // Reset search text when switching groups to prevent stale queries from one
  // group contaminating filter results in another (issue #285 / upstream #833).
  useEffect(() => {
    setSearchText('');
    setOpenKeys([]);
  }, [activeGroup.value]);

  useEffect(() => {
    if (!settings.enableSearch) {
      setSearchText('');
    }
  }, [settings.enableSearch]);

  // Group apis by tag, filtered by search text
  const filteredByTag = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    const apis: ApiItem[] = q
      ? activeGroup.apis.filter(
          (api) =>
            api.summary.toLowerCase().includes(q) ||
            api.path.toLowerCase().includes(q) ||
            api.tag.toLowerCase().includes(q),
        )
      : activeGroup.apis;

    // Group by tag
    const tagMap = new Map<string, ApiItem[]>();
    for (const api of apis) {
      if (!tagMap.has(api.tag)) tagMap.set(api.tag, []);
      tagMap.get(api.tag)!.push(api);
    }
    return tagMap;
  }, [activeGroup, searchText]);

  // Highlight matching text
  const highlightText = (text: string, query: string) => {
    if (!query) return text;
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerText.indexOf(lowerQuery);
    if (index === -1) return text;

    return (
      <>
        {text.slice(0, index)}
        <span style={{ backgroundColor: '#ffc069', color: '#000' }}>{text.slice(index, index + query.length)}</span>
        {text.slice(index + query.length)}
      </>
    );
  };

  const menuItems = useMemo(() => {
    const q = searchText.trim();
    const items: NonNullable<MenuProps['items']> = [];
    if (activeGroup.value) {
      items.push({
        key: `/${activeGroup.value}/globalParam`,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ControlOutlined />
            <span>{t('globalParam.title')}</span>
            <span
              style={{
                marginLeft: 'auto',
                color: 'rgba(255,255,255,0.45)',
                fontSize: 12,
              }}
            >
              {effectiveParams.length}
            </span>
          </span>
        ),
      });
      items.push({
        key: `/${activeGroup.value}/cookieSession`,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <LoginOutlined />
            <span>{t('cookieSession.pageTitle')}</span>
          </span>
        ),
      });
      items.push({
        key: `/${activeGroup.value}/authorize`,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SafetyCertificateOutlined />
            <span>{t('auth.pageTitle')}</span>
          </span>
        ),
      });
    }
    if (activeGroup.value && settings.enableSwaggerModels) {
      items.push({
        key: `/${activeGroup.value}/schema`,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DatabaseOutlined />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {settings.swaggerModelName || t('schema.title')}
            </span>
            <span
              style={{
                marginLeft: 'auto',
                color: 'rgba(255,255,255,0.45)',
                fontSize: 12,
              }}
            >
              {Object.keys(schemas).length}
            </span>
          </span>
        ),
      });
    }
    const tagDescMap = new Map(menuTags.map((t) => [t.tag, t.description]));

    const nodesByName = new Map(navigation32?.nodes.map((node) => [node.name, node]));
    const tagItems = new Map<string, NonNullable<MenuProps['items']>[number]>();
    const visibleTags = navigation32
      ? new Map(navigation32.nodes.map((node) => [node.name, node.operations]))
      : filteredByTag;
    visibleTags.forEach((apis, tag) => {
      const node = nodesByName.get(tag);
      const tagDesc = node ? node.declaration?.description : tagDescMap.get(tag);
      const displayName = node ? (
        <span
          className="knife4j-tag-metadata"
          title={`${node.label} · name: ${JSON.stringify(tag)}${node.kind === undefined ? '' : ` · kind: ${node.kind}`}`}
        >
          <span>{highlightText(node.label || JSON.stringify(tag), q)}</span>
          <small>{`name: ${JSON.stringify(tag)}${node.kind === undefined ? '' : ` · kind: ${node.kind}`}${node.parentName === undefined ? '' : ` · parent: ${JSON.stringify(node.parentName)}`}`}</small>
        </span>
      ) : (
        tag
      );
      const tagName = tagDesc ? (
        <Tooltip
          title={<Markdown source={tagDesc} preserveLineBreaks />}
          placement="right"
          styles={{ root: { maxWidth: 400 } }}
        >
          <span>{displayName}</span>
        </Tooltip>
      ) : (
        displayName
      );
      let addedCount = 0;
      let changedCount = 0;
      apis.forEach((api) => {
        const status = apiChanges.statuses[apiOperationIdentity(api.method, api.path)];
        if (status === 'added') addedCount += 1;
        if (status === 'changed') changedCount += 1;
      });
      const labelContent = (
        <span style={{ display: 'flex', flex: '1 1 auto', alignItems: 'center', minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tagName}</span>
          {(addedCount > 0 || changedCount > 0) && (
            <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto', paddingLeft: 6 }}>
              {addedCount > 0 && changePill('added', t('sidebar.apiChange.tagAdded', { count: addedCount }))}
              {changedCount > 0 && changePill('changed', t('sidebar.apiChange.tagChanged', { count: changedCount }))}
            </span>
          )}
        </span>
      );

      const item = {
        key: tagKey(tag),
        className: 'knife4j-sidebar-api-tag',
        ...(node && !collapsed
          ? { style: { '--knife4j-tag-indent': `${Math.min(node.depth, 5) * 10 + 24}px` } as React.CSSProperties }
          : {}),
        icon: <ApiOutlined />,
        label: labelContent,
        children: apis.map((api) => {
          const status = apiChanges.statuses[apiOperationIdentity(api.method, api.path)];
          return {
            key: api.key,
            title: `${api.method} ${api.summary}`,
            label: (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  overflow: 'hidden',
                }}
              >
                {methodTag(api.method)}
                <span
                  style={{
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {highlightText(api.summary, q)}
                </span>
                {status &&
                  changePill(status, t(status === 'added' ? 'sidebar.apiChange.new' : 'sidebar.apiChange.changed'))}
              </span>
            ),
          };
        }),
      };
      tagItems.set(tag, item);
      if (!navigation32) items.push(item);
    });
    if (navigation32 && collapsed) {
      // Compact popups use a flat tag index, preserving every filtered tag,
      // its exact parent metadata and only its own direct APIs.
      items.push(...navigation32.nodes.map((node) => tagItems.get(node.name)!));
    } else if (navigation32) {
      // Iteratively wire the already derived graph; there is no recursive builder.
      const parents = oas32TagPresentationParents(navigation32);
      for (const node of navigation32.nodes) {
        const parentName = parents.get(node.name);
        const parent = parentName === undefined ? undefined : tagItems.get(parentName);
        if (parent && 'children' in parent) parent.children!.push(tagItems.get(node.name)!);
        else items.push(tagItems.get(node.name)!);
      }
    }

    if (markdownDocs.length > 0) {
      items.push({
        key: `markdown-group-${activeGroup.value}`,
        icon: <FileMarkdownOutlined />,
        label: t('markdownDoc.menu.group'),
        children: markdownDocs.map((doc) => ({
          key: doc.key,
          title: doc.title,
          label: (
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {highlightText(doc.title, q)}
            </span>
          ),
        })),
      });
    }
    return items;
  }, [
    activeGroup.value,
    filteredByTag,
    navigation32,
    collapsed,
    effectiveParams,
    markdownDocs,
    menuTags,
    schemas,
    searchText,
    settings.enableSwaggerModels,
    settings.swaggerModelName,
    apiChanges.statuses,
    t,
  ]);

  return (
    <>
      {!collapsed && apiChanges.enabled && apiChanges.unavailableReason && (
        <div
          className="knife4j-api-change-status"
          role="status"
          aria-live="polite"
          data-api-change-state={apiChanges.unavailableReason}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
            padding: '6px 8px 0',
            color: apiChanges.unavailableReason === 'preparing' ? 'rgba(255,255,255,0.7)' : '#ffd666',
            fontSize: 12,
            lineHeight: 1.4,
          }}
        >
          <InfoCircleOutlined style={{ marginTop: 2, flex: '0 0 auto' }} />
          <span>{t(API_CHANGE_UNAVAILABLE_KEYS[apiChanges.unavailableReason])}</span>
        </div>
      )}
      {!collapsed && apiChanges.enabled && apiChanges.summary.total > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '4px 8px 0',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 12,
          }}
        >
          <span>{t('sidebar.apiChange.unread', { count: apiChanges.summary.total })}</span>
          <Button
            type="text"
            size="small"
            icon={<CheckOutlined />}
            onClick={apiChanges.acknowledgeAll}
            style={{ color: '#fff', paddingInline: 4, fontSize: 12 }}
          >
            {t('sidebar.apiChange.markAllRead')}
          </Button>
        </div>
      )}
      {!collapsed && settings.enableSearch && (
        <div style={{ padding: '8px 8px 4px' }}>
          <Input
            className="knife4j-sidebar-search"
            placeholder={t('sidebar.search.placeholder')}
            prefix={<SearchOutlined style={{ color: 'rgba(255,255,255,0.45)' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
          />
        </div>
      )}
      <Menu
        className="knife4j-sidebar-menu"
        theme="dark"
        mode="inline"
        inlineCollapsed={collapsed}
        {...(navigation32 && !collapsed
          ? {
              inlineIndent: 10,
              openKeys: searchText.trim()
                ? navigation32.nodes
                    .filter((node) => node.children.length || node.operations.length)
                    .map((node) => tagKey(node.name))
                : openKeys,
              onOpenChange: setOpenKeys,
            }
          : {})}
        selectedKeys={[selectedKey]}
        onClick={onMenuClick}
        items={menuItems}
        style={{ flex: 1, overflowY: 'auto', borderRight: 0 }}
      />
    </>
  );
};

export default SidebarSearchMenu;
