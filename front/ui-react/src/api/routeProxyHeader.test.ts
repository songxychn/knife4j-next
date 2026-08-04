import { describe, expect, it } from 'vitest';
import type { BuiltRequest } from 'knife4j-core';

import { applyRouteProxyHeader, KNIFE4J_ROUTE_PROXY_HEADER } from './routeProxyHeader';

const request: BuiltRequest = {
  url: 'http://localhost:8080/users',
  method: 'GET',
  headers: {
    Accept: 'application/json',
    'Knife4j-Gateway-Request': 'user-supplied-route',
  },
  query: {},
  contentType: '',
  sourceMap: {
    headers: {
      'Knife4j-Gateway-Request': 'interface',
    },
    query: {},
  },
};

describe('routeProxyHeader', () => {
  it('injects the selected aggregation route with precedence over user headers', () => {
    const result = applyRouteProxyHeader(request, 'nacos-user-service');

    expect(result.headers).toEqual({
      Accept: 'application/json',
      [KNIFE4J_ROUTE_PROXY_HEADER]: 'nacos-user-service',
    });
    expect(result.sourceMap?.headers).toEqual({});
    expect(request.headers['Knife4j-Gateway-Request']).toBe('user-supplied-route');
  });

  it('leaves ordinary requests unchanged when no route is selected', () => {
    expect(applyRouteProxyHeader(request)).toBe(request);
  });
});
