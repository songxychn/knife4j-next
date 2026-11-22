import { Progress, Spin, Typography } from 'antd';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import ResponsePanel from './ResponsePanel';
import { formatByteSize, type ResponseBodyProgress } from './responseBodyProgress';

const { Text } = Typography;

function ResponseProgress({ responseProgress }: { responseProgress: ResponseBodyProgress | null }) {
  const { t } = useTranslation();
  const responsePercent =
    responseProgress?.totalBytes === null || responseProgress === null
      ? null
      : Math.min(99, Math.floor((responseProgress.receivedBytes / responseProgress.totalBytes) * 100));
  return responseProgress === null ? (
    <Spin description={t('apiDebug.sending')} style={{ display: 'block', margin: '24px auto' }} />
  ) : responsePercent === null ? (
    <div style={{ margin: '24px auto', textAlign: 'center' }}>
      <Spin />
      <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
        {t('apiDebug.receiving', { received: formatByteSize(responseProgress.receivedBytes) })}
      </Text>
    </div>
  ) : (
    <div style={{ maxWidth: 480, margin: '24px auto', textAlign: 'center' }}>
      <Progress percent={responsePercent} status="active" />
      <Text type="secondary">
        {t('apiDebug.receivingOf', {
          received: formatByteSize(responseProgress.receivedBytes),
          total: formatByteSize(responseProgress.totalBytes!),
        })}
      </Text>
    </div>
  );
}

interface DebugResponseSectionProps extends ComponentProps<typeof ResponsePanel> {
  loading: boolean;
  responseProgress: ResponseBodyProgress | null;
}

export function DebugResponseSection({ loading, responseProgress, ...panelProps }: DebugResponseSectionProps) {
  return (
    <>
      {loading && <ResponseProgress responseProgress={responseProgress} />}
      <ResponsePanel {...panelProps} />
    </>
  );
}
