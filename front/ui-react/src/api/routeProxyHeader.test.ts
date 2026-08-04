import { describe, expect, it } from 'vitest';
import type { BuiltRequest } from 'knife4j-core';

import { applyRouteProxyHeader, KNIFE4J_ROUTE_PROXY_HEADER } from './routeProxyHeader';

function requestFor(url: string, withUserRouteHeader = false): BuiltRequest {
  return {
    url,
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(withUserRouteHeader ? { 'Knife4j-Gateway-Request': 'user-supplied-route' } : {}),
    },
    query: {},
    contentType: '',
    sourceMap: {
      headers: withUserRouteHeader ? { 'Knife4j-Gateway-Request': 'interface' } : {},
      query: {},
    },
  };
}

const aggregationTarget = {
  origin: 'https://docs.example.test',
  contextPath: '/iam',
};

describe('routeProxyHeader', () => {
  it('injects the selected aggregation route with precedence over user headers', () => {
    const request = requestFor('https://docs.example.test/iam/users', true);
    const result = applyRouteProxyHeader(request, 'nacos-user-service', aggregationTarget);

    expect(result.headers).toEqual({
      Accept: 'application/json',
      [KNIFE4J_ROUTE_PROXY_HEADER]: 'nacos-user-service',
    });
    expect(result.sourceMap?.headers).toEqual({});
    expect(request.headers['Knife4j-Gateway-Request']).toBe('user-supplied-route');
  });

  it('does not inject the internal route header into a cross-origin downstream request', () => {
    const request = requestFor('https://api.example.test/iam/users');

    expect(applyRouteProxyHeader(request, 'nacos-user-service', aggregationTarget)).toBe(request);
  });

  it('does not inject the internal route header outside the aggregation context path', () => {
    const request = requestFor('https://docs.example.test/direct/users');
    const adjacentRequest = requestFor('https://docs.example.test/iam-other/users');

    expect(applyRouteProxyHeader(request, 'nacos-user-service', aggregationTarget)).toBe(request);
    expect(applyRouteProxyHeader(adjacentRequest, 'nacos-user-service', aggregationTarget)).toBe(adjacentRequest);
  });

  it('injects the route header for same-origin requests when the aggregation context is root', () => {
    const request = requestFor('https://docs.example.test/users');

    expect(
      applyRouteProxyHeader(request, 'nacos-user-service', {
        origin: 'https://docs.example.test',
        contextPath: '/',
      }).headers,
    ).toMatchObject({
      [KNIFE4J_ROUTE_PROXY_HEADER]: 'nacos-user-service',
    });
  });

  it('matches encoded request paths against a Unicode aggregation context path', () => {
    const request = requestFor('https://docs.example.test/用户/users');

    expect(
      applyRouteProxyHeader(request, 'nacos-user-service', {
        origin: 'https://docs.example.test',
        contextPath: '/用户',
      }).headers,
    ).toMatchObject({
      [KNIFE4J_ROUTE_PROXY_HEADER]: 'nacos-user-service',
    });
  });

  it('leaves ordinary requests unchanged when no route is selected', () => {
    const request = requestFor('https://docs.example.test/iam/users');

    expect(applyRouteProxyHeader(request, undefined, aggregationTarget)).toBe(request);
  });
});
