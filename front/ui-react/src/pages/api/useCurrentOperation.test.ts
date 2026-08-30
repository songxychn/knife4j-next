import { describe, expect, it } from 'vitest';
import type { MenuTag } from '../../types/swagger';
import { findMenuOperation, visibleOperationModeKeys } from './operationRouting';

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

  it('finds a webhook by its collision-safe route id', () => {
    expect(findMenuOperation(menuTags, 'events', 'webhook%3ApetChanged')?.source).toBe('webhook');
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

    expect(findMenuOperation(paths, 'upload', '%2Fattachments')?.path).toBe('/attachments');
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

    expect(findMenuOperation(paths, 'diagnostics', 'trace%3A%2Fdiagnostics')?.method).toBe('trace');
    expect(findMenuOperation(paths, 'diagnostics', '%2Fdiagnostics')?.method).toBe('get');
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

    expect(findMenuOperation(operations, 'events', 'webhook%3Apost%3Achanged')?.source).toBe('webhook');
  });

  it('keeps webhook contracts read-only', () => {
    expect(visibleOperationModeKeys('webhook', true, true)).toEqual(['doc', 'openapi']);
    expect(visibleOperationModeKeys('path', true, true)).toEqual(['doc', 'debug', 'openapi', 'script']);
  });
});
