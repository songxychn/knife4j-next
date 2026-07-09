import { describe, expect, it } from 'vitest';
import { findOperationRouteKey, routeKeyToMenuKey, upsertOperationRoutePane } from './operationTabs';

interface Pane {
  key: string;
  label: string;
  children: string;
}

const createPane = (key: string, label: string): Pane => ({ key, label, children: '' });

describe('operationTabs', () => {
  it('maps operation child routes back to their sidebar menu key', () => {
    expect(routeKeyToMenuKey('/default/Pet/list/doc')).toBe('/default/Pet/list');
    expect(routeKeyToMenuKey('/default/Pet/list/debug')).toBe('/default/Pet/list');
    expect(routeKeyToMenuKey('/default/Pet/list/openapi')).toBe('/default/Pet/list');
    expect(routeKeyToMenuKey('/default/Pet/list/script')).toBe('/default/Pet/list');
    expect(routeKeyToMenuKey('/default/%E7%94%A8%E6%88%B7%E6%8E%A5%E5%8F%A3/UserController_list/debug')).toBe(
      '/default/%E7%94%A8%E6%88%B7%E6%8E%A5%E5%8F%A3/UserController_list',
    );
  });

  it('finds an existing operation tab regardless of the selected child page', () => {
    const items = [
      createPane('/group/home', 'Home'),
      createPane('/default/Pet/list/debug', 'GET list'),
      createPane('/default/%E7%94%A8%E6%88%B7%E6%8E%A5%E5%8F%A3/UserController_list/debug', 'GET list'),
    ];

    expect(findOperationRouteKey(items, '/default/Pet/list')).toBe('/default/Pet/list/debug');
    expect(findOperationRouteKey(items, '/default/%E7%94%A8%E6%88%B7%E6%8E%A5%E5%8F%A3/UserController_list')).toBe(
      '/default/%E7%94%A8%E6%88%B7%E6%8E%A5%E5%8F%A3/UserController_list/debug',
    );
  });

  it('replaces the operation tab key when the selected child page changes', () => {
    const items = [
      createPane('/group/home', 'Home'),
      createPane('/default/Pet/list/doc', 'GET list'),
      createPane('/default/Store/list/doc', 'GET stores'),
    ];

    expect(upsertOperationRoutePane(items, '/default/Pet/list/debug', 'GET list', createPane)).toEqual([
      createPane('/group/home', 'Home'),
      createPane('/default/Pet/list/debug', 'GET list'),
      createPane('/default/Store/list/doc', 'GET stores'),
    ]);
  });
});
