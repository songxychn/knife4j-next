import React, { useEffect, useMemo, useState } from 'react';
import { Input, Menu, MenuProps, Tooltip } from 'antd';
import { ApiOutlined, DatabaseOutlined, FileMarkdownOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ApiItem, useGroup } from '../context/GroupContext';
import Markdown from '../components/Markdown';

const METHOD_COLORS: Record<string, string> = {
  GET: '#61affe',
  POST: '#49cc90',
  PUT: '#fca130',
  DELETE: '#f93e3e',
  PATCH: '#50e3c2',
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
      {method.toUpperCase()}
    </span>
  );
}

interface SidebarSearchMenuProps {
  selectedKey: string;
  onMenuClick: MenuProps['onClick'];
  collapsed?: boolean;
}

const SidebarSearchMenu: React.FC<SidebarSearchMenuProps> = ({ selectedKey, onMenuClick, collapsed = false }) => {
  const { activeGroup, menuTags, markdownDocs, schemas } = useGroup();
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState('');

  // Reset search text whenever the active group changes to prevent stale queries
  // from one group contaminating filter results in another group.
  useEffect(() => {
    setSearchText('');
  }, [activeGroup.value]);

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
        key: `/${activeGroup.value}/schema`,
        label: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DatabaseOutlined />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('schema.title')}
            </span>
            <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
              {Object.keys(schemas).length}
            </span>
          </span>
        ),
      });
    }
    const tagDescMap = new Map(menuTags.map((t) => [t.tag, t.description]));

    filteredByTag.forEach((apis, tag) => {
      const tagDesc = tagDescMap.get(tag);
      const labelContent = tagDesc ? (
        <Tooltip title={<Markdown source={tagDesc} />} placement="right" overlayStyle={{ maxWidth: 400 }}>
          <span>{tag}</span>
        </Tooltip>
      ) : (
        tag
      );

      items.push({
        key: `tag-${tag}`,
        icon: <ApiOutlined />,
        label: labelContent,
        children: apis.map((api) => ({
          key: api.key,
          title: `${api.method.toUpperCase()} ${api.summary}`,
          label: (
            <span style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
              {methodTag(api.method)}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {highlightText(api.summary, q)}
              </span>
            </span>
          ),
        })),
      });
    });

    if (markdownDocs.length > 0) {
      items.push({
        key: `markdown-group-${activeGroup.value}`,
        icon: <FileMarkdownOutlined />,
        label: t('markdownDoc.menu.group'),
        children: markdownDocs.map((doc) => ({
          key: doc.key,
          title: doc.title,
          label: (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {highlightText(doc.title, q)}
            </span>
          ),
        })),
      });
    }
    return items;
  }, [activeGroup.value, filteredByTag, markdownDocs, menuTags, schemas, searchText, t]);

  return (
    <>
      {!collapsed && (
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
        theme="dark"
        mode="inline"
        inlineCollapsed={collapsed}
        selectedKeys={[selectedKey]}
        onClick={onMenuClick}
        items={menuItems}
        style={{ flex: 1, overflowY: 'auto', borderRight: 0 }}
      />
    </>
  );
};

export default SidebarSearchMenu;
