import { useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiOutlined, BugOutlined, CodeOutlined, FileTextOutlined } from '@ant-design/icons';
import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { useGroup } from '../../context/GroupContext';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';

interface CurrentOperation {
  loading: boolean;
  swaggerDoc: SwaggerDoc | null;
  tag?: string;
  operation?: MenuOperation;
}

// eslint-disable-next-line react-refresh/only-export-components
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
      return (
        fallbackId === routeOperationId ||
        item.key === `${encodeURIComponent(routeTag)}/${encodeURIComponent(routeOperationId)}`
      );
    });
  }, [menuTags, operaterId, tag]);

  return {
    loading,
    swaggerDoc,
    tag: tag ? decodeURIComponent(tag) : undefined,
    operation,
  };
}

export type OperationModeKey = 'doc' | 'debug' | 'openapi' | 'script';

interface OperationModeLayoutProps {
  activeKey: OperationModeKey;
  children: ReactNode;
}

const OPERATION_MODES: Array<{ key: OperationModeKey; labelKey: string; icon: ReactNode }> = [
  { key: 'doc', labelKey: 'operation.tab.doc', icon: <FileTextOutlined /> },
  { key: 'debug', labelKey: 'operation.tab.debug', icon: <BugOutlined /> },
  { key: 'openapi', labelKey: 'operation.tab.openapi', icon: <ApiOutlined /> },
  { key: 'script', labelKey: 'operation.tab.script', icon: <CodeOutlined /> },
];

export function OperationModeLayout({ activeKey, children }: OperationModeLayoutProps) {
  const navigate = useNavigate();
  const { group, tag, operaterId } = useParams();
  const { t } = useTranslation();

  return (
    <Tabs
      className="knife4j-operation-tabs"
      activeKey={activeKey}
      tabPosition="left"
      onChange={(key) => {
        if (!group || !tag || !operaterId) return;
        navigate(`/${encodeURIComponent(group)}/${encodeURIComponent(tag)}/${encodeURIComponent(operaterId)}/${key}`);
      }}
      items={OPERATION_MODES.map((item) => ({
        key: item.key,
        label: (
          <span className="knife4j-operation-tab-label">
            {item.icon}
            <span>{t(item.labelKey)}</span>
          </span>
        ),
        children: item.key === activeKey ? <div className="knife4j-operation-content">{children}</div> : null,
      }))}
    />
  );
}
