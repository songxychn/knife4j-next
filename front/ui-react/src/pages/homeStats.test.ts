import { describe, expect, it } from 'vitest';

import { parseMenuTags } from '../api/knife4jClient';
import type { SwaggerDoc } from '../types/swagger';
import { buildHomeStats } from './homeStats';

describe('homeStats', () => {
  it('does not count empty controller tags as separate API groups', () => {
    const doc: SwaggerDoc = {
      openapi: '3.0.1',
      info: { title: 'demo', version: '1.0.0' },
      tags: [
        { name: 'ProductController', description: '产品控制器' },
        { name: 'UserController', description: '用户控制器' },
        { name: 'SwaggerConfigController', description: 'OpenApi v3文档控制器' },
      ],
      paths: {
        '/products': {
          get: {
            tags: ['产品控制器'],
            summary: '产品列表',
            operationId: 'listProducts',
          },
        },
        '/users': {
          get: {
            tags: ['用户控制器'],
            summary: '用户列表',
            operationId: 'listUsers',
          },
        },
        '/openapi': {
          get: {
            tags: ['OpenApi v3文档控制器'],
            summary: 'OpenAPI 文档',
            operationId: 'getOpenApi',
          },
        },
      },
    };

    const menuTags = parseMenuTags(doc);

    expect(menuTags.map((tag) => ({ tag: tag.tag, count: tag.operations.length }))).toEqual([
      { tag: 'ProductController', count: 0 },
      { tag: 'UserController', count: 0 },
      { tag: 'SwaggerConfigController', count: 0 },
      { tag: '产品控制器', count: 1 },
      { tag: '用户控制器', count: 1 },
      { tag: 'OpenApi v3文档控制器', count: 1 },
    ]);

    expect(buildHomeStats(doc, menuTags).topTags.map((tag) => tag.tag)).toEqual([
      '产品控制器',
      '用户控制器',
      'OpenApi v3文档控制器',
    ]);
  });
});
