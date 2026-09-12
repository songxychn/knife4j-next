import { Alert, Button, Input, Space, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SchemeValue } from 'knife4j-core';
import type { OAuth2Flow } from '../types/swagger';
import {
  createOAuthDeviceAuthorizationController,
  type OAuthDeviceAuthorizationController,
  type OAuthDeviceSnapshot,
} from './oauthDeviceAuthorization';
import { resolveOas32OauthEndpoint } from './oas32SecurityUi';

const { Text } = Typography;

export function OAuthDeviceFlowForm({
  securityKey,
  flow,
  existingValue,
  apiBase,
  onSave,
  onRemove,
}: {
  securityKey: string;
  flow: OAuth2Flow;
  existingValue: SchemeValue | undefined;
  apiBase?: string;
  onSave: (key: string, value: SchemeValue) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [scope, setScope] = useState('');
  const [accessToken, setAccessToken] = useState(existingValue?.type === 'oauth2' ? existingValue.accessToken : '');
  const [snapshot, setSnapshot] = useState<OAuthDeviceSnapshot>({ status: 'idle', generation: 0, tokenRequests: 0 });
  const controllerRef = useRef<OAuthDeviceAuthorizationController | null>(null);
  const identityRef = useRef<symbol>(Symbol('oauth-device'));
  if (!controllerRef.current) {
    controllerRef.current = createOAuthDeviceAuthorizationController({
      onSnapshot: (next) => setSnapshot(next),
    });
  }

  useEffect(() => {
    setAccessToken(existingValue?.type === 'oauth2' ? existingValue.accessToken : '');
  }, [existingValue]);

  useEffect(
    () => () => {
      controllerRef.current?.cancel();
    },
    [],
  );

  const deviceEndpoint = resolveOas32OauthEndpoint(flow.deviceAuthorizationUrl, apiBase);
  const tokenEndpoint = resolveOas32OauthEndpoint(flow.tokenUrl, apiBase);
  const endpointIssue =
    ('issue' in deviceEndpoint && deviceEndpoint.issue) ||
    ('issue' in tokenEndpoint && tokenEndpoint.issue) ||
    undefined;
  const busy = snapshot.status === 'requesting' || snapshot.status === 'waiting' || snapshot.status === 'polling';

  const handleStart = () => {
    if (!('href' in deviceEndpoint) || !('href' in tokenEndpoint) || !clientId) return;
    identityRef.current = Symbol('oauth-device');
    const identity = identityRef.current;
    void controllerRef.current?.start({
      identity,
      isCurrent: (value) => value === identityRef.current,
      deviceAuthorizationUrl: deviceEndpoint.href,
      tokenUrl: tokenEndpoint.href,
      clientId,
      ...(scope.trim() ? { scope: scope.trim() } : {}),
      ...(clientSecret ? { clientAuthentication: { type: 'basic', clientSecret } } : {}),
      onSuccess: (result) => {
        if (result.identity !== identityRef.current) return;
        setAccessToken(result.accessToken);
      },
    });
  };

  const handleSave = () => {
    if (!accessToken) return;
    onSave(securityKey, { type: 'oauth2', accessToken, tokenType: 'Bearer' });
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <Text type="secondary">{t('auth.schemes.oauth2.deviceAuthorization')}</Text>
      {'href' in deviceEndpoint ? (
        <Text copyable={{ text: deviceEndpoint.href }}>{deviceEndpoint.href}</Text>
      ) : (
        <Alert type="warning" showIcon message={t(`auth.schemes.oauth2.endpoint.${endpointIssue ?? 'invalid'}`)} />
      )}
      <Input
        value={clientId}
        onChange={(event) => setClientId(event.target.value)}
        placeholder={t('auth.schemes.oauth2.clientId.placeholder')}
      />
      <Input.Password
        value={clientSecret}
        onChange={(event) => setClientSecret(event.target.value)}
        placeholder={t('auth.schemes.oauth2.clientSecret.placeholder')}
      />
      <Input
        value={scope}
        onChange={(event) => setScope(event.target.value)}
        placeholder={t('auth.schemes.oauth2.scope.placeholder')}
      />
      {snapshot.verification && (
        <Alert
          type="info"
          showIcon
          message={t('auth.schemes.oauth2.userCode', { code: snapshot.verification.userCode })}
          description={
            <Space direction="vertical">
              <a href={snapshot.verification.uri} target="_blank" rel="noreferrer">
                {snapshot.verification.uri}
              </a>
              {snapshot.verification.completeUri && !snapshot.verification.completeUriBlocked && (
                <a href={snapshot.verification.completeUri} target="_blank" rel="noreferrer">
                  {snapshot.verification.completeUri}
                </a>
              )}
            </Space>
          }
        />
      )}
      {snapshot.status !== 'idle' && snapshot.status !== 'success' && (
        <Alert
          type={snapshot.error ? 'warning' : 'info'}
          message={t(`auth.schemes.oauth2.device.status.${snapshot.status}`)}
        />
      )}
      <Input.Password
        value={accessToken}
        onChange={(event) => setAccessToken(event.target.value)}
        placeholder={t('auth.schemes.oauth2.accessToken.placeholder')}
      />
      <Space>
        <Button size="small" loading={busy} onClick={handleStart} disabled={!clientId || Boolean(endpointIssue)}>
          {busy ? t('auth.schemes.oauth2.obtaining') : t('auth.schemes.oauth2.startDevice')}
        </Button>
        <Button size="small" onClick={() => controllerRef.current?.cancel()} disabled={!busy}>
          {t('auth.schemes.oauth2.cancelDevice')}
        </Button>
        <Button type="primary" size="small" onClick={handleSave} disabled={!accessToken}>
          {t('auth.btn.authorize')}
        </Button>
        {existingValue && (
          <Button
            size="small"
            danger
            onClick={() => {
              controllerRef.current?.cancel();
              onRemove(securityKey);
            }}
          >
            {t('auth.btn.unauthorize')}
          </Button>
        )}
      </Space>
    </Space>
  );
}
