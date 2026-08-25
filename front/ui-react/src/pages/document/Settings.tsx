import { Alert, Button, Checkbox, Divider, Input, message, Modal, Select, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../context/SettingsContext';
import {
  clearKnife4jStorage,
  removedKnife4jStorageEntryCount,
  type Knife4jStorageArea,
  type Knife4jStorageCleanupScope,
} from '../../storage/knife4jStorage';

const { Text } = Typography;

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'].map((m) => ({
  value: m,
  label: m,
}));

const REQUEST_CACHE_CATEGORY_KEYS = [
  'settings.localData.category.requestParameters',
  'settings.localData.category.requestHistory',
  'settings.localData.category.tabs',
  'settings.localData.category.versionBaseline',
] as const;

const ALL_LOCAL_DATA_CATEGORY_KEYS = [
  ...REQUEST_CACHE_CATEGORY_KEYS,
  'settings.localData.category.settings',
  'settings.localData.category.globalParams',
  'settings.localData.category.cookieSession',
  'settings.localData.category.oauth',
  'settings.localData.category.auth',
] as const;

const STORAGE_AREA_LABEL_KEYS: Record<Knife4jStorageArea, string> = {
  localStorage: 'settings.localData.area.localStorage',
  sessionStorage: 'settings.localData.area.sessionStorage',
  indexedDB: 'settings.localData.area.indexedDB',
};

export default function Settings() {
  const { t } = useTranslation();
  const { settings, setSetting } = useSettings();

  const handleEnableHost = (checked: boolean) => {
    if (checked && !settings.enableHostText.trim()) {
      void message.error(t('settings.hostEmptyError'));
      return;
    }
    setSetting('enableHost', checked);
  };

  const showCleanupFailure = (
    scope: Knife4jStorageCleanupScope,
    result: Awaited<ReturnType<typeof clearKnife4jStorage>>,
  ) => {
    const failedAreas = Array.from(new Set(result.failures.map((failure) => failure.area)));
    Modal.error({
      title: t('settings.localData.result.incompleteTitle'),
      content: (
        <Space direction="vertical" size={8}>
          <Text>
            {t('settings.localData.result.incomplete', {
              removed: removedKnife4jStorageEntryCount(result),
              failed: result.failures.length,
            })}
          </Text>
          <ul style={{ margin: 0, paddingInlineStart: 24 }}>
            {failedAreas.map((area) => (
              <li key={area}>{t(STORAGE_AREA_LABEL_KEYS[area])}</li>
            ))}
          </ul>
          <Text type="secondary">{t('settings.localData.result.reloadTip')}</Text>
        </Space>
      ),
      closable: true,
      okText: t('settings.localData.result.reload'),
      onOk: async () => {
        const retryResult = await clearKnife4jStorage(scope);
        if (retryResult.failures.length === 0) {
          window.location.reload();
          return;
        }
        showCleanupFailure(scope, retryResult);
      },
    });
  };

  const confirmLocalDataCleanup = (scope: Knife4jStorageCleanupScope) => {
    const categoryKeys = scope === 'request-cache' ? REQUEST_CACHE_CATEGORY_KEYS : ALL_LOCAL_DATA_CATEGORY_KEYS;
    Modal.confirm({
      title: t(
        scope === 'request-cache' ? 'settings.localData.confirm.requestTitle' : 'settings.localData.confirm.allTitle',
      ),
      content: (
        <Space direction="vertical" size={8}>
          <Text>{t('settings.localData.confirm.affected')}</Text>
          <ul style={{ margin: 0, paddingInlineStart: 24 }}>
            {categoryKeys.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
          <Alert type="warning" showIcon message={t('settings.localData.confirm.cookieWarning')} />
        </Space>
      ),
      okText: t('settings.localData.confirm.ok'),
      cancelText: t('settings.localData.confirm.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        const result = await clearKnife4jStorage(scope);
        if (result.failures.length === 0) {
          window.location.reload();
          return;
        }

        showCleanupFailure(scope, result);
      },
    });
  };

  return (
    <div id="knife4j-settings-page" style={{ maxWidth: 720, margin: '16px auto', padding: '0 16px' }}>
      <Alert message={t('settings.tip')} type="info" showIcon style={{ marginBottom: 16 }} />

      {/* 请求参数缓存 */}
      <div style={{ height: 50, lineHeight: '50px' }}>
        <Checkbox
          checked={settings.enableRequestCache}
          onChange={(e) => setSetting('enableRequestCache', e.target.checked)}
        >
          {t('settings.enableRequestCache')}
        </Checkbox>
      </div>
      <Divider style={{ margin: '4px 0' }} />

      {/* 发送历史 */}
      <div style={{ height: 50, lineHeight: '50px' }}>
        <Checkbox
          checked={settings.enableRequestHistory}
          onChange={(e) => setSetting('enableRequestHistory', e.target.checked)}
        >
          {t('settings.enableRequestHistory')}
        </Checkbox>
      </div>
      <Divider style={{ margin: '4px 0' }} />

      {/* 响应状态概要 */}
      <div style={{ height: 50, lineHeight: '50px' }}>
        <Checkbox
          checked={settings.enableResponseCode}
          onChange={(e) => setSetting('enableResponseCode', e.target.checked)}
        >
          {t('settings.enableResponseCode')}
        </Checkbox>
      </div>
      <Divider style={{ margin: '4px 0' }} />

      {/* 动态参数 */}
      <div style={{ height: 50, lineHeight: '50px' }}>
        <Checkbox
          checked={settings.enableDynamicParameter}
          onChange={(e) => setSetting('enableDynamicParameter', e.target.checked)}
        >
          {t('settings.enableDynamicParameter')}
        </Checkbox>
      </div>
      <Divider style={{ margin: '4px 0' }} />

      {/* 过滤 multipart 接口 */}
      <div style={{ minHeight: 50, lineHeight: '50px' }}>
        <Space align="center" wrap>
          <Checkbox
            checked={settings.enableFilterMultipartApis}
            onChange={(e) => setSetting('enableFilterMultipartApis', e.target.checked)}
          >
            {t('settings.enableFilterMultipartApis')}
          </Checkbox>
          {settings.enableFilterMultipartApis && (
            <Select
              value={settings.enableFilterMultipartApiMethodType}
              options={METHOD_OPTIONS}
              style={{ width: 120 }}
              onChange={(val: string) => setSetting('enableFilterMultipartApiMethodType', val)}
            />
          )}
        </Space>
      </div>
      <Divider style={{ margin: '4px 0' }} />

      {/* Host 覆盖 */}
      <div style={{ minHeight: 50, lineHeight: '50px' }}>
        <Space align="center" wrap>
          <Checkbox checked={settings.enableHost} onChange={(e) => handleEnableHost(e.target.checked)}>
            <Text>Host:</Text>
          </Checkbox>
          <Input
            value={settings.enableHostText}
            placeholder={t('settings.hostPlaceholder')}
            style={{ width: 300 }}
            onChange={(e) => {
              setSetting('enableHostText', e.target.value);
              // 如果已启用但内容被清空，自动关闭
              if (!e.target.value.trim() && settings.enableHost) {
                setSetting('enableHost', false);
              }
            }}
          />
        </Space>
        <div style={{ marginTop: 4, marginLeft: 24, lineHeight: 1.4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('settings.enableHost')}
          </Text>
        </div>
      </div>
      <Divider style={{ margin: '4px 0' }} />

      {/* tags-sorter 覆盖 */}
      <div style={{ minHeight: 50, lineHeight: '50px' }}>
        <Space align="center" wrap>
          <Text>{t('settings.tagsSorter')}</Text>
          <Select
            value={settings.tagsSorter}
            style={{ width: 200 }}
            onChange={(val) => setSetting('tagsSorter', val)}
            options={[
              { value: 'auto', label: t('settings.sorter.auto') },
              { value: 'alpha', label: t('settings.sorter.alpha') },
              { value: 'preserve', label: t('settings.sorter.preserve') },
            ]}
          />
        </Space>
        <div style={{ marginTop: 4, marginLeft: 0, lineHeight: 1.4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('settings.tagsSorter.desc')}
          </Text>
        </div>
      </div>
      <Divider style={{ margin: '4px 0' }} />

      {/* operations-sorter 覆盖 */}
      <div style={{ minHeight: 50, lineHeight: '50px' }}>
        <Space align="center" wrap>
          <Text>{t('settings.operationsSorter')}</Text>
          <Select
            value={settings.operationsSorter}
            style={{ width: 200 }}
            onChange={(val) => setSetting('operationsSorter', val)}
            options={[
              { value: 'auto', label: t('settings.sorter.auto') },
              { value: 'alpha', label: t('settings.sorter.alpha') },
              { value: 'method', label: t('settings.sorter.method') },
              { value: 'preserve', label: t('settings.sorter.preserve') },
            ]}
          />
        </Space>
        <div style={{ marginTop: 4, marginLeft: 0, lineHeight: 1.4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('settings.operationsSorter.desc')}
          </Text>
        </div>
      </div>
      <Divider style={{ margin: '4px 0' }} />

      <div style={{ padding: '16px 0' }}>
        <Space direction="vertical" size={10}>
          <Text strong>{t('settings.localData.title')}</Text>
          <Text type="secondary">{t('settings.localData.description')}</Text>
          <Space wrap>
            <Button onClick={() => confirmLocalDataCleanup('request-cache')}>
              {t('settings.localData.clearRequest')}
            </Button>
            <Button danger onClick={() => confirmLocalDataCleanup('all-local-data')}>
              {t('settings.localData.resetAll')}
            </Button>
          </Space>
        </Space>
      </div>
    </div>
  );
}
