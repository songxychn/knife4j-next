import { useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiOutlined, BugOutlined, CodeOutlined, FileTextOutlined } from '@ant-design/icons';
import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { useGroup } from '../../context/GroupContext';
import { useSettings } from '../../context/SettingsContext';
import { useApiChanges } from '../../context/ApiChangeContext';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import { findMenuOperation, visibleOperationModeKeys, type OperationModeKey } from './operationRouting';

interface CurrentOperation {
  loading: boolean;
  swaggerDoc: SwaggerDoc | null;
  tag?: string;
  operation?: MenuOperation;
}

/** Path operations are change-tracked for 3.0/3.1/3.2. OAS 3.2 menus always carry identity. */
// eslint-disable-next-line react-refresh/only-export-components
export function acknowledgeOpenedOperation(
  operation: MenuOperation | undefined,
  apiChangesReady: boolean,
  acknowledgeOperation: (method: string, path: string) => void,
): void {
  if (!apiChangesReady || !operation || operation.source !== 'path') return;
  acknowledgeOperation(operation.method, operation.path);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCurrentOperation(): CurrentOperation {
  const { tag, operaterId } = useParams();
  const { loading, swaggerDoc, menuTags } = useGroup();
  const { ready: apiChangesReady, scopeKey: apiChangeScopeKey, acknowledgeOperation } = useApiChanges();

  const operation = useMemo(() => {
    return findMenuOperation(menuTags, tag, operaterId);
  }, [menuTags, operaterId, tag]);

  useEffect(() => {
    acknowledgeOpenedOperation(operation, apiChangesReady, acknowledgeOperation);
  }, [acknowledgeOperation, apiChangeScopeKey, apiChangesReady, operation]);

  return {
    loading,
    swaggerDoc,
    tag: menuTags.find((item) => (item.routeId ?? item.tag) === tag)?.tag,
    operation,
  };
}

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
  const { settings } = useSettings();
  const { menuTags } = useGroup();
  const operation = useMemo(() => findMenuOperation(menuTags, tag, operaterId), [menuTags, operaterId, tag]);

  const visibleModeKeys = useMemo(
    () => visibleOperationModeKeys(operation?.source, settings.enableDebug, settings.enableOpenApi),
    [operation?.source, settings.enableDebug, settings.enableOpenApi],
  );
  const visibleModes = OPERATION_MODES.filter((item) => visibleModeKeys.includes(item.key));

  const activeModeVisible = visibleModes.some((item) => item.key === activeKey);

  useEffect(() => {
    if (activeModeVisible || !group || !tag || !operaterId || visibleModes.length === 0) return;
    navigate(
      `/${encodeURIComponent(group)}/${encodeURIComponent(tag)}/${encodeURIComponent(operaterId)}/${visibleModes[0].key}`,
      { replace: true },
    );
  }, [activeKey, activeModeVisible, group, navigate, operaterId, tag, visibleModes]);

  if (!activeModeVisible) {
    return null;
  }

  return (
    <Tabs
      className="knife4j-operation-tabs"
      activeKey={activeKey}
      tabPosition="left"
      onChange={(key) => {
        if (!group || !tag || !operaterId) return;
        navigate(`/${encodeURIComponent(group)}/${encodeURIComponent(tag)}/${encodeURIComponent(operaterId)}/${key}`);
      }}
      items={visibleModes.map((item) => ({
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
