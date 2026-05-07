import {
  Alert,
  Checkbox,
  Divider,
  Input,
  message,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../context/SettingsContext";

const { Text } = Typography;

const METHOD_OPTIONS = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "HEAD",
].map((m) => ({
  value: m,
  label: m,
}));

export default function Settings() {
  const { t } = useTranslation();
  const { settings, setSetting } = useSettings();

  const handleEnableHost = (checked: boolean) => {
    if (checked && !settings.enableHostText.trim()) {
      void message.error(t("settings.hostEmptyError"));
      return;
    }
    setSetting("enableHost", checked);
  };

  return (
    <div
      id="knife4j-settings-page"
      style={{ maxWidth: 720, margin: "16px auto", padding: "0 16px" }}
    >
      <Alert
        message={t("settings.tip")}
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* 请求参数缓存 */}
      <div style={{ height: 50, lineHeight: "50px" }}>
        <Checkbox
          checked={settings.enableRequestCache}
          onChange={(e) => setSetting("enableRequestCache", e.target.checked)}
        >
          {t("settings.enableRequestCache")}
        </Checkbox>
      </div>
      <Divider style={{ margin: "4px 0" }} />

      {/* 动态参数 */}
      <div style={{ height: 50, lineHeight: "50px" }}>
        <Checkbox
          checked={settings.enableDynamicParameter}
          onChange={(e) =>
            setSetting("enableDynamicParameter", e.target.checked)
          }
        >
          {t("settings.enableDynamicParameter")}
        </Checkbox>
      </div>
      <Divider style={{ margin: "4px 0" }} />

      {/* 过滤 multipart 接口 */}
      <div style={{ minHeight: 50, lineHeight: "50px" }}>
        <Space align="center" wrap>
          <Checkbox
            checked={settings.enableFilterMultipartApis}
            onChange={(e) =>
              setSetting("enableFilterMultipartApis", e.target.checked)
            }
          >
            {t("settings.enableFilterMultipartApis")}
          </Checkbox>
          {settings.enableFilterMultipartApis && (
            <Select
              value={settings.enableFilterMultipartApiMethodType}
              options={METHOD_OPTIONS}
              style={{ width: 120 }}
              onChange={(val: string) =>
                setSetting("enableFilterMultipartApiMethodType", val)
              }
            />
          )}
        </Space>
      </div>
      <Divider style={{ margin: "4px 0" }} />

      {/* Host 覆盖 */}
      <div style={{ minHeight: 50, lineHeight: "50px" }}>
        <Space align="center" wrap>
          <Checkbox
            checked={settings.enableHost}
            onChange={(e) => handleEnableHost(e.target.checked)}
          >
            <Text>Host:</Text>
          </Checkbox>
          <Input
            value={settings.enableHostText}
            placeholder={t("settings.hostPlaceholder")}
            style={{ width: 300 }}
            onChange={(e) => {
              setSetting("enableHostText", e.target.value);
              // 如果已启用但内容被清空，自动关闭
              if (!e.target.value.trim() && settings.enableHost) {
                setSetting("enableHost", false);
              }
            }}
          />
        </Space>
        <div style={{ marginTop: 4, marginLeft: 24, lineHeight: 1.4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("settings.enableHost")}
          </Text>
        </div>
      </div>
      <Divider style={{ margin: "4px 0" }} />

      {/* tags-sorter 覆盖 */}
      <div style={{ minHeight: 50, lineHeight: "50px" }}>
        <Space align="center" wrap>
          <Text>{t("settings.tagsSorter")}</Text>
          <Select
            value={settings.tagsSorter}
            style={{ width: 200 }}
            onChange={(val) => setSetting("tagsSorter", val)}
            options={[
              { value: "auto", label: t("settings.sorter.auto") },
              { value: "alpha", label: t("settings.sorter.alpha") },
              { value: "preserve", label: t("settings.sorter.preserve") },
            ]}
          />
        </Space>
        <div style={{ marginTop: 4, marginLeft: 0, lineHeight: 1.4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("settings.tagsSorter.desc")}
          </Text>
        </div>
      </div>
      <Divider style={{ margin: "4px 0" }} />

      {/* operations-sorter 覆盖 */}
      <div style={{ minHeight: 50, lineHeight: "50px" }}>
        <Space align="center" wrap>
          <Text>{t("settings.operationsSorter")}</Text>
          <Select
            value={settings.operationsSorter}
            style={{ width: 200 }}
            onChange={(val) => setSetting("operationsSorter", val)}
            options={[
              { value: "auto", label: t("settings.sorter.auto") },
              { value: "alpha", label: t("settings.sorter.alpha") },
              { value: "method", label: t("settings.sorter.method") },
              { value: "preserve", label: t("settings.sorter.preserve") },
            ]}
          />
        </Space>
        <div style={{ marginTop: 4, marginLeft: 0, lineHeight: 1.4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("settings.operationsSorter.desc")}
          </Text>
        </div>
      </div>
      <Divider style={{ margin: "4px 0" }} />

      {/* Footer 开关 + 自定义内容 */}
      <div style={{ minHeight: 50, lineHeight: "50px" }}>
        <Space align="center" wrap>
          <Switch
            checked={settings.footerEnabled}
            onChange={(checked) => setSetting("footerEnabled", checked)}
          />
          <Text>{t("settings.footerEnabled")}</Text>
        </Space>
        {settings.footerEnabled && (
          <div style={{ marginTop: 8, marginBottom: 8 }}>
            <Input
              value={settings.footerCustomContent}
              placeholder={t("settings.footerCustomContent.placeholder")}
              style={{ width: 400 }}
              onChange={(e) =>
                setSetting("footerCustomContent", e.target.value)
              }
            />
            <div style={{ marginTop: 4, lineHeight: 1.4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("settings.footerCustomContent.desc")}
              </Text>
            </div>
          </div>
        )}
      </div>
      <Divider style={{ margin: "4px 0" }} />
    </div>
  );
}
