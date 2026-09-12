import { matchRoutes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { MenuOperation, MenuTag } from '../../types/swagger';
import type { OpenApiOperation } from 'knife4j-core';
import { acknowledgeOpenedOperation } from './useCurrentOperation';
import { findMenuOperation, visibleOperationModeKeys } from './operationRouting';

function findThroughRouter(menuTags: MenuTag[], tag: string, operationId: string) {
  const params = matchRoutes(
    [{ path: '/:group/:tag/:operaterId/:mode' }],
    `/default/${encodeURIComponent(tag)}/${encodeURIComponent(operationId)}/doc`,
  )![0].params;
  return findMenuOperation(menuTags, params.tag, params.operaterId);
}

describe('OAS 3.1 operation routing', () => {
  const menuTags: MenuTag[] = [
    {
      tag: 'events',
      operations: [
        {
          key: 'events/webhook%3ApetChanged',
          path: 'petChanged',
          method: 'post',
          summary: 'Pet changed',
          operationId: 'petChanged',
          operation: { operationId: 'petChanged' },
          source: 'webhook',
          routeId: 'webhook:petChanged',
        },
      ],
    },
  ];

  it('preserves legacy encoded bookmarks through the actual Router', () => {
    const params = matchRoutes(
      [{ path: '/:group/:tag/:operaterId/:mode' }],
      '/default/events/webhook%3ApetChanged/doc',
    )![0].params;
    expect(findMenuOperation(menuTags, params.tag, params.operaterId)?.source).toBe('webhook');
  });

  it('finds a webhook by its collision-safe route id', () => {
    expect(findThroughRouter(menuTags, 'events', 'webhook:petChanged')?.source).toBe('webhook');
  });

  it('selects the requested operation when a tag contains multiple path fallbacks', () => {
    const paths: MenuTag[] = [
      {
        tag: 'upload',
        operations: [
          {
            key: 'upload/%2Favatar',
            path: '/avatar',
            method: 'put',
            summary: 'Upload avatar',
            operation: {},
            source: 'path',
            routeId: '/avatar',
          },
          {
            key: 'upload/%2Fattachments',
            path: '/attachments',
            method: 'post',
            summary: 'Upload attachments',
            operation: {},
            source: 'path',
            routeId: '/attachments',
          },
        ],
      },
    ];

    expect(findThroughRouter(paths, 'upload', '/attachments')?.path).toBe('/attachments');
  });

  it('selects method-qualified fallback routes and keeps legacy bare-path bookmarks', () => {
    const paths: MenuTag[] = [
      {
        tag: 'diagnostics',
        operations: [
          {
            key: 'diagnostics/get%3A%2Fdiagnostics',
            path: '/diagnostics',
            method: 'get',
            summary: 'Read diagnostics',
            operation: {},
            source: 'path',
            routeId: 'get:/diagnostics',
          },
          {
            key: 'diagnostics/trace%3A%2Fdiagnostics',
            path: '/diagnostics',
            method: 'trace',
            summary: 'Trace diagnostics',
            operation: {},
            source: 'path',
            routeId: 'trace:/diagnostics',
          },
        ],
      },
    ];

    expect(findThroughRouter(paths, 'diagnostics', 'trace:/diagnostics')?.method).toBe('trace');
    expect(findThroughRouter(paths, 'diagnostics', '/diagnostics')?.method).toBe('get');
  });

  it('selects a source-qualified webhook after a cross-source route collision', () => {
    const operations: MenuTag[] = [
      {
        tag: 'events',
        operations: [
          {
            key: 'events/path%3Aget%3A%2Fchanged',
            path: '/changed',
            method: 'get',
            summary: 'Read changes',
            operationId: 'webhook:changed',
            operation: { operationId: 'webhook:changed' },
            source: 'path',
            routeId: 'path:get:/changed',
          },
          {
            key: 'events/webhook%3Apost%3Achanged',
            path: 'changed',
            method: 'post',
            summary: 'Changed callback',
            operationId: 'changed',
            operation: { operationId: 'changed' },
            source: 'webhook',
            routeId: 'webhook:post:changed',
          },
        ],
      },
    ];

    expect(findThroughRouter(operations, 'events', 'webhook:post:changed')?.source).toBe('webhook');
  });

  it('keeps webhook contracts read-only', () => {
    expect(visibleOperationModeKeys('webhook', true, true)).toEqual(['doc', 'openapi']);
    expect(visibleOperationModeKeys('path', true, true)).toEqual(['doc', 'debug', 'openapi', 'script']);
  });
});

describe('opening an operation acknowledges API changes', () => {
  const identity = { identity: 'op' } as OpenApiOperation;

  function operation(partial: Partial<MenuOperation>): MenuOperation {
    return {
      key: 'events/op',
      path: '/read',
      method: 'GET',
      summary: 'Read',
      operation: {},
      source: 'path',
      ...partial,
    };
  }

  it('acknowledges OAS 3.0/3.1 path operations that have no identity', () => {
    const acknowledge = vi.fn();
    acknowledgeOpenedOperation(operation({ identity: undefined }), true, acknowledge);
    expect(acknowledge).toHaveBeenCalledWith('GET', '/read');
  });

  it('acknowledges OAS 3.2 path operations that always carry identity, preserving method case', () => {
    const acknowledge = vi.fn();
    acknowledgeOpenedOperation(operation({ method: 'QUERY', path: '/read', identity }), true, acknowledge);
    acknowledgeOpenedOperation(operation({ method: 'COPY', path: '/methods', identity }), true, acknowledge);
    acknowledgeOpenedOperation(operation({ method: 'Copy', path: '/methods', identity }), true, acknowledge);
    expect(acknowledge.mock.calls).toEqual([
      ['QUERY', '/read'],
      ['COPY', '/methods'],
      ['Copy', '/methods'],
    ]);
  });

  it('does not acknowledge webhooks, unreadiness, or missing operations', () => {
    const acknowledge = vi.fn();
    acknowledgeOpenedOperation(operation({ source: 'webhook', identity }), true, acknowledge);
    acknowledgeOpenedOperation(operation({ source: 'webhook' }), true, acknowledge);
    acknowledgeOpenedOperation(operation({ identity }), false, acknowledge);
    acknowledgeOpenedOperation(undefined, true, acknowledge);
    expect(acknowledge).not.toHaveBeenCalled();
  });
});
