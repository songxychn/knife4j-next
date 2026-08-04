import type { BuiltRequest } from 'knife4j-core';

export const KNIFE4J_ROUTE_PROXY_HEADER = 'knife4j-gateway-request';

export function buildRouteProxyHeaders(routeHeader?: string): Record<string, string> {
  const value = routeHeader?.trim();
  return value ? { [KNIFE4J_ROUTE_PROXY_HEADER]: value } : {};
}

function omitRouteProxyHeader<T>(values: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(values).filter(([name]) => name.toLowerCase() !== KNIFE4J_ROUTE_PROXY_HEADER),
  );
}

/**
 * 聚合路由头是 UI 与服务端代理之间的内部契约，必须覆盖用户输入的同名头。
 */
export function applyRouteProxyHeader(request: BuiltRequest, routeHeader?: string): BuiltRequest {
  const routeHeaders = buildRouteProxyHeaders(routeHeader);
  if (Object.keys(routeHeaders).length === 0) return request;

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
