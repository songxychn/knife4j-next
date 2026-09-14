import { Alert, Collapse, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import Oas32ServerDetails from '../components/Oas32ServerDetails';
import DescriptionText from '../components/DescriptionText';
import type { Oas32ResolvedServer } from '../schema/oas32ServerResolution';

/** Keep the homepage concise while retaining the resolution evidence on demand. */
export default function HomeServerSummary({ server }: { server: Oas32ResolvedServer }) {
  const { t } = useTranslation();
  return (
    <div className="knife4j-home-server">
      {server.name && <Typography.Text strong>{server.name}</Typography.Text>}
      <Typography.Text className="knife4j-home-server-url">
        {server.requestUrl ?? t('oas32.server.unavailable')}
      </Typography.Text>
      {server.description && <DescriptionText type="secondary">{server.description}</DescriptionText>}
      {server.diagnostics.map((diagnostic, index) => (
        <Alert
          key={`${diagnostic.code}:${diagnostic.pointer}:${index}`}
          type="warning"
          showIcon
          message={diagnostic.code}
          description={`${diagnostic.pointer}: ${diagnostic.reason}`}
        />
      ))}
      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'details',
            label: t('oas32.server.details'),
            children: <Oas32ServerDetails server={server} showDiagnostics={false} />,
          },
        ]}
      />
    </div>
  );
}
