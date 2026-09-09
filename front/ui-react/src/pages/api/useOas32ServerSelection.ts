import { useMemo, useState } from 'react';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import { oas32RequestBaseUrl, resolveOas32OperationServers } from '../../schema/oas32OperationServers';
import { resolveOas32Server } from '../../schema/oas32ServerResolution';
import { currentOrigin, normalizeRequestBaseUrl } from './requestBaseUrl';

export function useOas32ServerSelection({
  document,
  operation,
  retrievalUri,
  session,
  enableHost,
  host,
  contextPath,
}: {
  document: SwaggerDoc | null;
  operation: MenuOperation | null | undefined;
  retrievalUri?: string;
  session: object | null;
  enableHost: boolean;
  host: string;
  contextPath?: string;
}) {
  const scope = useMemo(
    () => ({ document, operation, retrievalUri, session, enableHost, host, contextPath }),
    [document, operation, retrievalUri, session, enableHost, host, contextPath],
  );
  const declarations = useMemo(
    () => (document ? resolveOas32OperationServers(document, operation, retrievalUri) : null),
    [document, operation, retrievalUri],
  );
  const overrides = useMemo(
    () => [
      ...(enableHost && host.trim() ? [{ key: 'host', raw: host, url: host, source: 'host' }] : []),
      ...(contextPath?.trim() && contextPath.trim() !== '/'
        ? [
            {
              key: 'gateway',
              raw: contextPath,
              url: normalizeRequestBaseUrl(`/${contextPath.trim().replace(/^\/+|\/+$/g, '')}`, currentOrigin()),
              source: 'gateway',
            },
          ]
        : []),
      { key: 'custom', raw: '', url: '', source: 'custom' },
    ],
    [enableHost, host, contextPath],
  );
  const defaultKey = overrides.find((item) => item.key !== 'custom')?.key ?? declarations?.servers[0]?.key ?? '';
  const [state, setState] = useState<{ scope: object; key: string; values: Record<string, string>; custom: string }>(
    () => ({ scope, key: defaultKey, values: {}, custom: '' }),
  );
  // Derive synchronously: a new document/operation/generation cannot expose a stale URL for one frame.
  const active = state.scope === scope ? state : { scope, key: defaultKey, values: {}, custom: '' };
  const override = overrides.find((item) => item.key === active.key);
  const declared = declarations?.servers.find((item) => item.key === active.key);
  const resolved = declared
    ? resolveOas32Server(declared, active.values)
    : override
      ? resolveOas32Server({
          key: override.key,
          level: 'root',
          value: { url: override.key === 'custom' ? active.custom : override.url },
          ownerRetrievalUri: `${currentOrigin()}/`,
          pointer: '#/productOverride',
        })
      : undefined;
  return {
    declarations,
    overrides,
    key: active.key,
    custom: active.custom,
    override: override?.source,
    resolved,
    baseUrl: oas32RequestBaseUrl(resolved?.requestUrl),
    executable: resolved?.executable === true,
    select: (key: string) => setState({ ...active, key, values: {} }),
    setVariable: (name: string, value: string) => setState({ ...active, values: { ...active.values, [name]: value } }),
    setCustom: (custom: string) => setState({ ...active, custom }),
    restoreOverride: (custom: string) => setState({ scope, key: 'custom', values: {}, custom }),
    reset: () => setState({ scope, key: defaultKey, values: {}, custom: '' }),
  };
}
