import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Tabs } from 'antd';
import { useGroup } from '../../context/GroupContext';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';

interface CurrentOperation {
  loading: boolean;
  swaggerDoc: SwaggerDoc | null;
  tag?: string;
  operation?: MenuOperation;
}

export function useCurrentOperation(): CurrentOperation {
  const { tag, operaterId } = useParams();
  const { loading, swaggerDoc, menuTags } = useGroup();

  const operation = useMemo(() => {
    if (!tag || !operaterId) return undefined;
    const routeTag = decodeURIComponent(tag);
    const routeOperationId = decodeURIComponent(operaterId);
    const menuTag = menuTags.find((item) => item.tag === routeTag);
    return menuTag?.operations.find((item) => {
      const fallbackId = item.operationId ?? item.path;
      return fallbackId === routeOperationId || item.key === `${routeTag}/${routeOperationId}`;
    });
  }, [menuTags, operaterId, tag]);

  return {
    loading,
    swaggerDoc,
    tag: tag ? decodeURIComponent(tag) : undefined,
    operation,
  };
}

interface OperationModeTabsProps {
  activeKey: 'doc' | 'debug';
}

export function OperationModeTabs({ activeKey }: OperationModeTabsProps) {
  const navigate = useNavigate();
  const { group, tag, operaterId } = useParams();

  return (
    <Tabs
      activeKey={activeKey}
      onChange={(key) => {
        if (!group || !tag || !operaterId) return;
        navigate(`/${encodeURIComponent(group)}/${encodeURIComponent(tag)}/${encodeURIComponent(operaterId)}/${key}`);
      }}
      items={[
        { key: 'doc', label: '文档' },
        { key: 'debug', label: '调试' },
      ]}
    />
  );
}
