import { Alert, Button, Card, Collapse, Input, message, Space, Spin, Tag, Typography } from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useGroup } from '../context/GroupContext';
import type { SecuritySchemeObject, OAuth2Flow } from '../types/swagger';
import type { SchemeValue } from 'knife4j-core';
import { KNIFE4J_STORAGE_PREFIXES, setKnife4jSessionStorageItem } from '../storage/knife4jStorage';

const { Text } = Typography;

/** 从 SwaggerDoc 提取安全方案（兼容 OAS3 + OAS2） */
function extractSecuritySchemes(swaggerDoc: Record<string, unknown> | null): Record<string, SecuritySchemeObject> {
  if (!swaggerDoc) return {};
  // OAS3: components.securitySchemes
  const oas3 = (swaggerDoc as { components?: { securitySchemes?: Record<string, SecuritySchemeObject> } }).components
    ?.securitySchemes;
  // OAS2: securityDefinitions
  const oas2 = (swaggerDoc as { securityDefinitions?: Record<string, SecuritySchemeObject> }).securityDefinitions;
  return { ...oas3, ...oas2 };
}

/** OAuth2 flow 判断 */
function getOauth2Flows(scheme: SecuritySchemeObject): Array<{ flowType: string; flow: OAuth2Flow }> {
  if (scheme.type !== 'oauth2' || !scheme.flows) return [];
  const result: Array<{ flowType: string; flow: OAuth2Flow }> = [];
  if (scheme.flows.password) result.push({ flowType: 'password', flow: scheme.flows.password });
  if (scheme.flows.clientCredentials)
    result.push({ flowType: 'clientCredentials', flow: scheme.flows.clientCredentials });
  if (scheme.flows.authorizationCode)
    result.push({ flowType: 'authorizationCode', flow: scheme.flows.authorizationCode });
  if (scheme.flows.implicit) result.push({ flowType: 'implicit', flow: scheme.flows.implicit });
  return result;
}

// ─── OAuth2 Token Fetcher ──────────────────────────────

async function fetchOAuth2Token(params: {
  tokenUrl: string;
  grantType: 'password' | 'client_credentials';
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}): Promise<{ access_token: string; token_type?: string }> {
  const body = new URLSearchParams();
  body.set('grant_type', params.grantType);
  if (params.grantType === 'password') {
    if (params.username) body.set('username', params.username);
    if (params.password) body.set('password', params.password);
  }
  if (params.scope) body.set('scope', params.scope);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (params.clientId && params.clientSecret) {
    const encoded = btoa(`${params.clientId}:${params.clientSecret}`);
    headers['Authorization'] = `Basic ${encoded}`;
  }

  const resp = await fetch(params.tokenUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Token request failed: ${resp.status} ${text}`);
  }
  return (await resp.json()) as { access_token: string; token_type?: string };
}

// ─── OAuth2 Popup (implicit / authorizationCode) ──────

interface OAuth2PopupConfig {
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
}

interface AuthAsyncCommitToken {
  lifecycle: number;
  operation: number;
}

interface AuthAsyncCommitGuard {
  activate: () => () => void;
  begin: () => AuthAsyncCommitToken;
  isCurrent: (token: AuthAsyncCommitToken) => boolean;
}

/**
 * 把异步鉴权结果绑定到发起它的组件生命周期和最近一次操作。
 * 分组切换会卸载旧组件，此后旧 Promise 即使完成也不能再提交凭据。
 */
// eslint-disable-next-line react-refresh/only-export-components
export function createAuthAsyncCommitGuard(): AuthAsyncCommitGuard {
  let active = false;
  let lifecycle = 0;
  let operation = 0;

  return {
    activate: () => {
      const currentLifecycle = ++lifecycle;
      active = true;
      return () => {
        if (lifecycle === currentLifecycle) {
          active = false;
          lifecycle += 1;
          operation += 1;
        }
      };
    },
    begin: () => ({ lifecycle, operation: ++operation }),
    isCurrent: (token) => active && token.lifecycle === lifecycle && token.operation === operation,
  };
}

interface AuthFormDraft {
  apiKey: string;
  bearerToken: string;
  basicUsername: string;
  basicPassword: string;
  oauth2AccessToken: string;
}

/** 将已持久化的鉴权值投影为各表单草稿；undefined 明确投影为空值。 */
// eslint-disable-next-line react-refresh/only-export-components
export function getAuthFormDraft(existingValue: SchemeValue | undefined): AuthFormDraft {
  return {
    apiKey: existingValue?.type === 'apiKey' ? existingValue.value : '',
    bearerToken: existingValue?.type === 'http' && existingValue.scheme === 'bearer' ? existingValue.token : '',
    basicUsername: existingValue?.type === 'http' && existingValue.scheme === 'basic' ? existingValue.username : '',
    basicPassword: existingValue?.type === 'http' && existingValue.scheme === 'basic' ? existingValue.password : '',
    oauth2AccessToken: existingValue?.type === 'oauth2' ? existingValue.accessToken : '',
  };
}

/**
 * Open an OAuth2 authorization popup and wait for the postMessage result.
 * Returns the access token string (e.g. "Bearer xxx") or throws on error/timeout.
 */
function openOAuth2Popup(
  authorizationUrl: string,
  state: string,
  config: OAuth2PopupConfig,
  timeoutMs = 120_000,
): Promise<{ accessToken: string; tokenType: string }> {
  return new Promise((resolve, reject) => {
    // Store exchange config for authorization_code flow
    try {
      setKnife4jSessionStorageItem(
        sessionStorage,
        KNIFE4J_STORAGE_PREFIXES.oauth2Pending + state,
        JSON.stringify(config),
      );
      setKnife4jSessionStorageItem(
        sessionStorage,
        KNIFE4J_STORAGE_PREFIXES.oauth2Pending + 'default',
        JSON.stringify(config),
      );
    } catch {
      // sessionStorage unavailable — code exchange will fail gracefully
    }

    const popup = window.open(authorizationUrl, 'knife4j_oauth2', 'width=600,height=700,scrollbars=yes,resizable=yes');

    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups for this page.'));
      return;
    }

    let settled = false;

    const cleanup = () => {
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedPoll);
      clearTimeout(timer);
    };

    const onMessage = (evt: MessageEvent) => {
      // Only accept messages from same origin
      if (evt.origin !== window.location.origin) return;
      if (evt.source !== popup) return;
      const data = evt.data as {
        type?: string;
        accessToken?: string;
        tokenType?: string;
        error?: string;
        errorDescription?: string;
      };
      if (!data || !data.type) return;
      if (data.type === 'knife4j:oauth2:token') {
        cleanup();
        resolve({ accessToken: data.accessToken ?? '', tokenType: data.tokenType ?? 'Bearer' });
      } else if (data.type === 'knife4j:oauth2:error') {
        cleanup();
        reject(new Error(data.error + (data.errorDescription ? ': ' + data.errorDescription : '')));
      }
    };

    // Poll for popup closed without postMessage (user closed manually)
    const closedPoll = setInterval(() => {
      if (!settled && popup.closed) {
        cleanup();
        // Clean up sessionStorage — popup was closed before redirect page ran
        try {
          sessionStorage.removeItem(KNIFE4J_STORAGE_PREFIXES.oauth2Pending + state);
        } catch {
          /* ignore */
        }
        try {
          sessionStorage.removeItem(KNIFE4J_STORAGE_PREFIXES.oauth2Pending + 'default');
        } catch {
          /* ignore */
        }
        reject(new Error('OAuth2 popup closed by user'));
      }
    }, 500);

    const timer = setTimeout(() => {
      if (!settled) {
        cleanup();
        // Clean up sessionStorage on timeout — popup never ran the redirect page
        try {
          sessionStorage.removeItem(KNIFE4J_STORAGE_PREFIXES.oauth2Pending + state);
        } catch {
          /* ignore */
        }
        try {
          sessionStorage.removeItem(KNIFE4J_STORAGE_PREFIXES.oauth2Pending + 'default');
        } catch {
          /* ignore */
        }
        popup.close();
        reject(new Error('OAuth2 popup timed out'));
      }
    }, timeoutMs);

    window.addEventListener('message', onMessage);
  });
}

/** Build the redirect URI pointing to our oauth2-redirect.html */
function buildRedirectUri(): string {
  const base = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '/');
  return base + 'oauth2-redirect.html';
}

/** Build the authorization URL with required query params */
function buildAuthorizationUrl(params: {
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  state: string;
  responseType: 'code' | 'token';
}): string {
  const url = new URL(params.authorizationUrl);
  url.searchParams.set('response_type', params.responseType);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  if (params.scope) url.searchParams.set('scope', params.scope);
  url.searchParams.set('state', params.state);
  return url.toString();
}

// ─── Sub Components ────────────────────────────────────

function ApiKeySchemeForm({
  securityKey,
  scheme,
  existingValue,
  onSave,
  onRemove,
}: {
  securityKey: string;
  scheme: SecuritySchemeObject;
  existingValue: SchemeValue | undefined;
  onSave: (key: string, value: SchemeValue) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const storedValue = getAuthFormDraft(existingValue).apiKey;
  const [value, setValue] = useState(storedValue);
  const isIn = scheme.in ?? 'header';
  const name = scheme.name ?? securityKey;

  useEffect(() => {
    setValue(storedValue);
  }, [storedValue]);

  const handleSave = () => {
    if (!value) return;
    onSave(securityKey, { type: 'apiKey', in: isIn as 'header' | 'query' | 'cookie', name, value });
    message.success(t('auth.msg.schemeSaved'));
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space>
          <Tag>
            {t('auth.schemes.apiKey.in')}: {isIn}
          </Tag>
          <Tag>
            {t('auth.schemes.apiKey.name')}: {name}
          </Tag>
        </Space>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('auth.schemes.apiKey.placeholder')}
          onPressEnter={handleSave}
        />
        <Space>
          <Button type="primary" size="small" onClick={handleSave} disabled={!value}>
            {t('auth.btn.authorize')}
          </Button>
          {existingValue && (
            <Button
              size="small"
              danger
              onClick={() => {
                onRemove(securityKey);
                message.success(t('auth.msg.schemeRemoved'));
              }}
            >
              {t('auth.btn.unauthorize')}
            </Button>
          )}
        </Space>
      </Space>
    </div>
  );
}

function HttpBearerSchemeForm({
  securityKey,
  existingValue,
  onSave,
  onRemove,
}: {
  securityKey: string;
  existingValue: SchemeValue | undefined;
  onSave: (key: string, value: SchemeValue) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const storedToken = getAuthFormDraft(existingValue).bearerToken;
  const [token, setToken] = useState(storedToken);

  useEffect(() => {
    setToken(storedToken);
  }, [storedToken]);

  const handleSave = () => {
    if (!token) return;
    onSave(securityKey, { type: 'http', scheme: 'bearer', token });
    message.success(t('auth.msg.schemeSaved'));
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <Input.Password
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder={t('auth.schemes.http.bearer.placeholder')}
        onPressEnter={handleSave}
        style={{ marginBottom: 8 }}
      />
      <Space>
        <Button type="primary" size="small" onClick={handleSave} disabled={!token}>
          {t('auth.btn.authorize')}
        </Button>
        {existingValue && (
          <Button
            size="small"
            danger
            onClick={() => {
              onRemove(securityKey);
              message.success(t('auth.msg.schemeRemoved'));
            }}
          >
            {t('auth.btn.unauthorize')}
          </Button>
        )}
      </Space>
    </div>
  );
}

function HttpBasicSchemeForm({
  securityKey,
  existingValue,
  onSave,
  onRemove,
}: {
  securityKey: string;
  existingValue: SchemeValue | undefined;
  onSave: (key: string, value: SchemeValue) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const storedDraft = getAuthFormDraft(existingValue);
  const [username, setUsername] = useState(storedDraft.basicUsername);
  const [password, setPassword] = useState(storedDraft.basicPassword);

  useEffect(() => {
    setUsername(storedDraft.basicUsername);
    setPassword(storedDraft.basicPassword);
  }, [storedDraft.basicPassword, storedDraft.basicUsername]);

  const handleSave = () => {
    if (!username && !password) return;
    onSave(securityKey, { type: 'http', scheme: 'basic', username, password });
    message.success(t('auth.msg.schemeSaved'));
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t('auth.schemes.http.basic.username.placeholder')}
        />
        <Input.Password
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('auth.schemes.http.basic.password.placeholder')}
          onPressEnter={handleSave}
        />
        <Space>
          <Button type="primary" size="small" onClick={handleSave} disabled={!username && !password}>
            {t('auth.btn.authorize')}
          </Button>
          {existingValue && (
            <Button
              size="small"
              danger
              onClick={() => {
                onRemove(securityKey);
                message.success(t('auth.msg.schemeRemoved'));
              }}
            >
              {t('auth.btn.unauthorize')}
            </Button>
          )}
        </Space>
      </Space>
    </div>
  );
}

function OAuth2SchemeForm({
  securityKey,
  scheme,
  existingValue,
  onSave,
  onRemove,
}: {
  securityKey: string;
  scheme: SecuritySchemeObject;
  existingValue: SchemeValue | undefined;
  onSave: (key: string, value: SchemeValue) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const flows = getOauth2Flows(scheme);

  if (flows.length === 0) {
    return <Alert type="info" message={t('auth.schemes.oauth2.unsupported')} />;
  }

  return (
    <div style={{ marginBottom: 12 }}>
      {flows.map(({ flowType, flow }) => (
        <OAuth2FlowForm
          key={flowType}
          securityKey={securityKey}
          flowType={flowType}
          flow={flow}
          existingValue={existingValue}
          onSave={onSave}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function OAuth2FlowForm({
  securityKey,
  flowType,
  flow,
  existingValue,
  onSave,
  onRemove,
}: {
  securityKey: string;
  flowType: string;
  flow: OAuth2Flow;
  existingValue: SchemeValue | undefined;
  onSave: (key: string, value: SchemeValue) => void;
  onRemove: (key: string) => void;
}) {
  const { t } = useTranslation();
  const isPassword = flowType === 'password';
  const isPopupFlow = flowType === 'implicit' || flowType === 'authorizationCode';

  const [tokenUrl, setTokenUrl] = useState(flow.tokenUrl ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [scope, setScope] = useState('');
  const storedAccessToken = getAuthFormDraft(existingValue).oauth2AccessToken;
  const [accessToken, setAccessToken] = useState(storedAccessToken);
  const [obtaining, setObtaining] = useState(false);
  const asyncCommitGuardRef = useRef<AuthAsyncCommitGuard | null>(null);
  if (!asyncCommitGuardRef.current) {
    asyncCommitGuardRef.current = createAuthAsyncCommitGuard();
  }
  const asyncCommitGuard = asyncCommitGuardRef.current;

  useEffect(() => asyncCommitGuard.activate(), [asyncCommitGuard]);

  // Sync accessToken when existingValue changes externally
  useEffect(() => {
    setAccessToken(storedAccessToken);
  }, [storedAccessToken]);

  const flowLabel =
    {
      password: t('auth.schemes.oauth2.password'),
      clientCredentials: t('auth.schemes.oauth2.clientCredentials'),
      implicit: t('auth.schemes.oauth2.implicit'),
      authorizationCode: t('auth.schemes.oauth2.authorizationCode'),
    }[flowType] ?? flowType;

  // ── Popup-based flow (implicit / authorizationCode) ──────────────────────
  const handleOpenPopup = async () => {
    const authUrl = flow.authorizationUrl;
    if (!authUrl) {
      message.error('authorizationUrl is not configured');
      return;
    }
    if (!clientId) {
      message.error(t('auth.schemes.oauth2.clientId.placeholder'));
      return;
    }

    const commitToken = asyncCommitGuard.begin();
    setObtaining(true);
    try {
      const state = Math.random().toString(36).slice(2);
      const redirectUri = buildRedirectUri();
      const responseType = flowType === 'implicit' ? 'token' : 'code';

      const fullAuthUrl = buildAuthorizationUrl({
        authorizationUrl: authUrl,
        clientId,
        redirectUri,
        scope: scope || undefined,
        state,
        responseType,
      });

      const config: OAuth2PopupConfig = {
        tokenUrl: flow.tokenUrl,
        clientId,
        clientSecret: clientSecret || undefined,
        redirectUri,
      };

      const result = await openOAuth2Popup(fullAuthUrl, state, config);
      if (!asyncCommitGuard.isCurrent(commitToken)) return;
      setAccessToken(result.accessToken);
      // Auto-save after successful popup auth
      onSave(securityKey, { type: 'oauth2', accessToken: result.accessToken, tokenType: result.tokenType });
      message.success(t('auth.msg.tokenObtained'));
    } catch (err) {
      if (!asyncCommitGuard.isCurrent(commitToken)) return;
      const msg = err instanceof Error ? err.message : String(err);
      message.error(msg || t('auth.msg.tokenFailed'));
    } finally {
      if (asyncCommitGuard.isCurrent(commitToken)) {
        setObtaining(false);
      }
    }
  };

  // ── Direct token fetch (password / clientCredentials) ────────────────────
  const handleObtainToken = async () => {
    if (!tokenUrl) return;
    const commitToken = asyncCommitGuard.begin();
    setObtaining(true);
    try {
      const result = await fetchOAuth2Token({
        tokenUrl,
        grantType: isPassword ? 'password' : 'client_credentials',
        username: isPassword ? username : undefined,
        password: isPassword ? password : undefined,
        clientId: clientId || undefined,
        clientSecret: clientSecret || undefined,
        scope: scope || undefined,
      });
      if (!asyncCommitGuard.isCurrent(commitToken)) return;
      setAccessToken(result.access_token);
      message.success(t('auth.msg.tokenObtained'));
    } catch {
      if (asyncCommitGuard.isCurrent(commitToken)) {
        message.error(t('auth.msg.tokenFailed'));
      }
    } finally {
      if (asyncCommitGuard.isCurrent(commitToken)) {
        setObtaining(false);
      }
    }
  };

  const handleSave = () => {
    if (!accessToken) return;
    onSave(securityKey, { type: 'oauth2', accessToken, tokenType: 'Bearer' });
    message.success(t('auth.msg.schemeSaved'));
  };

  return (
    <Card size="small" title={flowLabel} style={{ marginBottom: 8 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        {/* Token URL — only for non-popup flows (password / clientCredentials) */}
        {!isPopupFlow && (
          <Input
            value={tokenUrl}
            onChange={(e) => setTokenUrl(e.target.value)}
            placeholder={t('auth.schemes.oauth2.tokenUrl.placeholder')}
            addonBefore={t('auth.schemes.oauth2.tokenUrl')}
          />
        )}
        {/* Authorization URL info for popup flows */}
        {isPopupFlow && flow.authorizationUrl && (
          <Input value={flow.authorizationUrl} readOnly addonBefore="Authorization URL" style={{ color: '#888' }} />
        )}
        {isPassword && (
          <>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('auth.schemes.oauth2.username.placeholder')}
            />
            <Input.Password
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.schemes.oauth2.password2.placeholder')}
            />
          </>
        )}
        <Input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder={t('auth.schemes.oauth2.clientId.placeholder')}
        />
        {/* clientSecret only for non-implicit flows */}
        {flowType !== 'implicit' && (
          <Input.Password
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={t('auth.schemes.oauth2.clientSecret.placeholder')}
          />
        )}
        <Input
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          placeholder={t('auth.schemes.oauth2.scope.placeholder')}
        />
        <Input.Password
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder={t('auth.schemes.oauth2.accessToken.placeholder')}
        />
        <Space>
          {isPopupFlow ? (
            <Button
              size="small"
              loading={obtaining}
              onClick={handleOpenPopup}
              disabled={!flow.authorizationUrl || !clientId}
            >
              {obtaining ? t('auth.schemes.oauth2.obtaining') : t('auth.schemes.oauth2.obtainToken')}
            </Button>
          ) : (
            <Button size="small" loading={obtaining} onClick={handleObtainToken} disabled={!tokenUrl}>
              {obtaining ? t('auth.schemes.oauth2.obtaining') : t('auth.schemes.oauth2.obtainToken')}
            </Button>
          )}
          <Button type="primary" size="small" onClick={handleSave} disabled={!accessToken}>
            {t('auth.btn.authorize')}
          </Button>
          {existingValue && (
            <Button
              size="small"
              danger
              onClick={() => {
                onRemove(securityKey);
                message.success(t('auth.msg.schemeRemoved'));
              }}
            >
              {t('auth.btn.unauthorize')}
            </Button>
          )}
        </Space>
      </Space>
    </Card>
  );
}

// ─── Main Component ────────────────────────────────────

function AuthorizeForGroup({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const { schemes, ready, setScheme, removeScheme, clearGroup } = useAuth();
  const { swaggerDoc, activeGroup, loading: groupLoading, routeGroupReady } = useGroup();

  const securitySchemes = extractSecuritySchemes(swaggerDoc as unknown as Record<string, unknown> | null);
  const schemeEntries = Object.entries(securitySchemes);

  const handleSave = useCallback(
    (securityKey: string, value: SchemeValue) => {
      setScheme(securityKey, value);
    },
    [setScheme],
  );

  const handleRemove = useCallback(
    (securityKey: string) => {
      removeScheme(securityKey);
    },
    [removeScheme],
  );

  const handleClearAll = useCallback(() => {
    clearGroup();
    message.success(t('auth.msg.cleared'));
  }, [clearGroup, t]);

  if (!ready || groupLoading || !routeGroupReady) {
    return (
      <div
        id="knife4j-authorize"
        style={{ maxWidth: embedded ? undefined : 1180, padding: embedded ? 0 : 20, margin: '0 auto' }}
      >
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      </div>
    );
  }

  if (schemeEntries.length === 0) {
    if (embedded) return null;
    return (
      <div id="knife4j-authorize" style={{ maxWidth: 1180, padding: 20, margin: '0 auto' }}>
        <h2>{t('auth.pageTitle')}</h2>
        <Alert
          type="info"
          showIcon
          message={t('auth.scopeTip', { group: activeGroup.label || activeGroup.value })}
          style={{ marginBottom: 16 }}
        />
        <Alert type="info" message={t('auth.schemes.empty')} />
      </div>
    );
  }

  const collapseItems = schemeEntries.map(([securityKey, scheme]) => {
    const isAuthorized = !!schemes[securityKey];
    let schemeForm: React.ReactNode;

    if (scheme.type === 'apiKey') {
      schemeForm = (
        <ApiKeySchemeForm
          securityKey={securityKey}
          scheme={scheme}
          existingValue={schemes[securityKey]}
          onSave={handleSave}
          onRemove={handleRemove}
        />
      );
    } else if (scheme.type === 'http') {
      if (scheme.scheme === 'bearer') {
        schemeForm = (
          <HttpBearerSchemeForm
            securityKey={securityKey}
            existingValue={schemes[securityKey]}
            onSave={handleSave}
            onRemove={handleRemove}
          />
        );
      } else if (scheme.scheme === 'basic') {
        schemeForm = (
          <HttpBasicSchemeForm
            securityKey={securityKey}
            existingValue={schemes[securityKey]}
            onSave={handleSave}
            onRemove={handleRemove}
          />
        );
      } else {
        schemeForm = <Alert type="info" message={t('auth.schemes.oauth2.unsupported')} />;
      }
    } else if (scheme.type === 'oauth2') {
      schemeForm = (
        <OAuth2SchemeForm
          securityKey={securityKey}
          scheme={scheme}
          existingValue={schemes[securityKey]}
          onSave={handleSave}
          onRemove={handleRemove}
        />
      );
    } else {
      schemeForm = <Alert type="info" message={t('auth.schemes.oauth2.unsupported')} />;
    }

    const label = (
      <Space>
        <Text strong>{securityKey}</Text>
        <Tag>{scheme.type}</Tag>
        {scheme.type === 'http' && <Tag>{scheme.scheme}</Tag>}
        {isAuthorized && <Tag color="green">✓</Tag>}
        {scheme.description && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {scheme.description}
          </Text>
        )}
      </Space>
    );

    return {
      key: securityKey,
      label,
      children: schemeForm,
    };
  });

  return (
    <div
      id="knife4j-authorize"
      style={{
        maxWidth: embedded ? undefined : 1180,
        padding: embedded ? 0 : 20,
        margin: embedded ? undefined : '0 auto',
      }}
    >
      {!embedded && (
        <>
          <h2>{t('auth.pageTitle')}</h2>
          <Alert
            type="info"
            showIcon
            message={t('auth.scopeTip', { group: activeGroup.label || activeGroup.value })}
            style={{ marginBottom: 16 }}
          />
        </>
      )}
      <Collapse items={collapseItems} defaultActiveKey={schemeEntries.map(([key]) => key)} />
      {Object.keys(schemes).length > 0 && (
        <Button danger onClick={handleClearAll} style={{ marginTop: 16 }}>
          {t('auth.btn.clearAll')}
        </Button>
      )}
    </div>
  );
}

export default function Authorize(props: { embedded?: boolean }) {
  const { activeGroup } = useGroup();
  return <AuthorizeForGroup key={activeGroup.value || 'default'} {...props} />;
}
