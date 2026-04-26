import React, { useMemo, useState } from 'react';
import { Input, Menu, MenuProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ApiItem, useGroup } from '../context/GroupContext';

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
}

const SidebarSearchMenu: React.FC<SidebarSearchMenuProps> = ({ selectedKey, onMenuClick }) => {
  const { activeGroup } = useGroup();
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState('');

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

  const menuItems = useMemo(() => {
    const items: NonNullable<MenuProps['items']> = [];
    filteredByTag.forEach((apis, tag) => {
      items.push({
        key: `tag-${tag}`,
        label: tag,
        children: apis.map((api) => ({
          key: api.key,
          title: `${api.method.toUpperCase()} ${api.summary}`,
          label: (
            <span style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
              {methodTag(api.method)}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{api.summary}</span>
            </span>
          ),
        })),
      });
    });
    return items;
  }, [filteredByTag]);

  return (
    <>
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
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        onClick={onMenuClick}
        items={menuItems}
        style={{ flex: 1, overflowY: 'auto', borderRight: 0 }}
      />
    </>
  );
};

export default SidebarSearchMenu;
