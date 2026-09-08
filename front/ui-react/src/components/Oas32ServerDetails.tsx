import { Alert, Space, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Oas32ResolvedServer } from '../schema/oas32ServerResolution';

export default function Oas32ServerDetails({ server, override }: { server: Oas32ResolvedServer; override?: string }) {
  const { t } = useTranslation();
  const rows = [
    [
      'oas32.server.source',
      override ? t(`oas32.server.override.${override}`) : t(`oas32.server.level.${server.source.level}`),
    ],
    ['oas32.server.raw', server.rawUrl],
    ['oas32.server.substituted', server.substitutedUrl],
    ['oas32.server.resolved', server.resolvedUrl],
    ['oas32.server.request', server.requestUrl],
  ];
  return (
    <div className="knife4j-server-details">
      {server.name !== undefined && <Typography.Text strong>{server.name}</Typography.Text>}
      {rows.map(([label, value]) =>
        value === undefined ? null : (
          <div key={label}>
            <Typography.Text type="secondary">{t(label!)}: </Typography.Text>
            <Typography.Text code>{value}</Typography.Text>
          </div>
        ),
      )}
      <div>
        <Typography.Text type="secondary">{t('oas32.server.owner')}: </Typography.Text>
        <Typography.Text code>
          {server.source.ownerRetrievalUri}
          {server.source.pointer}
        </Typography.Text>
      </div>
      {server.description && <Typography.Paragraph>{server.description}</Typography.Paragraph>}
      {server.variables.length > 0 && (
        <Space direction="vertical">
          {server.variables.map((variable) => (
            <Typography.Text
              key={variable.name}
              code
            >{`${variable.name}: default=${JSON.stringify(variable.default)}${variable.enum ? ` enum=${JSON.stringify(variable.enum)}` : ''}`}</Typography.Text>
          ))}
        </Space>
      )}
      {server.diagnostics.map((diagnostic, index) => (
        <Alert
          key={`${diagnostic.code}:${diagnostic.pointer}:${index}`}
          type="warning"
          showIcon
          message={diagnostic.code}
          description={`${diagnostic.pointer}: ${diagnostic.reason}`}
        />
      ))}
    </div>
  );
}
