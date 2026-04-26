import React, { useMemo, useState } from 'react';
import { Input, Menu, MenuProps, Tag } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { ApiItem, useGroup } from '../context/GroupContext';
import { useSettings } from '../context/SettingsContext';

const ALL_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const;

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
  const { settings } = useSettings();
  const [selectedMethods, setSelectedMethods] = useState<Set<string>>(new Set(ALL_METHODS));

  // Group apis by tag, filtered by search text and method
  const filteredByTag = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    let apis: ApiItem[] = q
      ? activeGroup.apis.filter(
          (api) =>
            api.summary.toLowerCase().includes(q) ||
            api.path.toLowerCase().includes(q) ||
            api.tag.toLowerCase().includes(q),
        )
      : activeGroup.apis;

    // Filter by selected methods
    apis = apis.filter((api) => selectedMethods.has(api.method.toUpperCase()));

    // Filter multipart/RequestMapping interfaces when enabled
    if (settings.enableFilterMultipartApis) {
      const allowedMethod = settings.enableFilterMultipartApiMethodType.toUpperCase();
      apis = apis.filter((api) => api.method.toUpperCase() === allowedMethod);
    }

    // Group by tag
    const tagMap = new Map<string, ApiItem[]>();
    for (const api of apis) {
      if (!tagMap.has(api.tag)) tagMap.set(api.tag, []);
      tagMap.get(api.tag)!.push(api);
    }
    return tagMap;
  }, [activeGroup, searchText, selectedMethods, settings.enableFilterMultipartApis, settings.enableFilterMultipartApiMethodType]);

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
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {highlightText(api.summary, q)}
              </span>
            </span>
          ),
        })),
      });
    });
    return items;
  }, [filteredByTag, searchText]);

  const toggleMethod = (method: string) => {
    setSelectedMethods((prev) => {
      const next = new Set(prev);
      if (next.has(method)) {
        next.delete(method);
      } else {
        next.add(method);
      }
      return next;
    });
  };

  const toggleAllMethods = () => {
    if (selectedMethods.size === ALL_METHODS.length) {
      setSelectedMethods(new Set());
    } else {
      setSelectedMethods(new Set(ALL_METHODS));
    }
  };

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
      <div style={{ padding: '4px 8px 8px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <Tag.CheckableTag
          checked={selectedMethods.size === ALL_METHODS.length}
          onChange={toggleAllMethods}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          {t('sidebar.filter.all')}
        </Tag.CheckableTag>
        {ALL_METHODS.map((method) => (
          <Tag.CheckableTag
            key={method}
            checked={selectedMethods.has(method)}
            onChange={() => toggleMethod(method)}
            style={{ cursor: 'pointer', userSelect: 'none' }}
          >
            {method}
          </Tag.CheckableTag>
        ))}
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

