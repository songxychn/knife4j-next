import type { BuiltRequest } from 'knife4j-core';

export const KNIFE4J_ROUTE_PROXY_HEADER = 'knife4j-gateway-request';

export interface AggregationProxyTarget {
  origin: string;
  contextPath?: string;
}

export function buildRouteProxyHeaders(routeHeader?: string): Record<string, string> {
  const value = routeHeader?.trim();
  return value ? { [KNIFE4J_ROUTE_PROXY_HEADER]: value } : {};
}

function omitRouteProxyHeader<T>(values: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(values).filter(([name]) => name.toLowerCase() !== KNIFE4J_ROUTE_PROXY_HEADER),
  );
}

function normalizeContextPath(contextPath: string | undefined, origin: URL): string {
  const trimmed = contextPath?.trim() ?? '';
  if (!trimmed || trimmed === '/') return '';

  const contextUrl = new URL(origin.origin);
  contextUrl.pathname = `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`;
  return contextUrl.pathname;
}

function targetsAggregationProxy(requestUrl: string, target: AggregationProxyTarget): boolean {
  try {
    const proxyOrigin = new URL(target.origin);
    const url = new URL(requestUrl, proxyOrigin);
    if (url.origin !== proxyOrigin.origin) return false;

    const contextPath = normalizeContextPath(target.contextPath, proxyOrigin);
    return !contextPath || url.pathname === contextPath || url.pathname.startsWith(`${contextPath}/`);
  } catch {
    return false;
  }
}

/**
 * 聚合路由头是 UI 与服务端代理之间的内部契约，仅向聚合代理发送，且必须覆盖用户输入的同名头。
 */
export function applyRouteProxyHeader(
  request: BuiltRequest,
  routeHeader: string | undefined,
  target: AggregationProxyTarget,
): BuiltRequest {
  const routeHeaders = buildRouteProxyHeaders(routeHeader);
  if (Object.keys(routeHeaders).length === 0 || !targetsAggregationProxy(request.url, target)) return request;

  const sourceMap = request.sourceMap
    ? {
        ...request.sourceMap,
        headers: omitRouteProxyHeader(request.sourceMap.headers),
      }
    : undefined;

  return {
    ...request,
    headers: {
      ...omitRouteProxyHeader(request.headers),
      ...routeHeaders,
    },
    ...(sourceMap ? { sourceMap } : {}),
  };
}
