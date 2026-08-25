import { describe, expect, it } from 'vitest';
import {
  closeTabsOnSide,
  findOperationRouteKey,
  hasClosableTabsOnSide,
  routeKeyToMenuKey,
  upsertOperationRoutePane,
} from './operationTabs';

interface Pane {
  key: string;
  label: string;
  children: string;
}

const createPane = (key: string, label: string): Pane => ({ key, label, children: '' });
const HOME_KEY = '/group/home';
const isClosable = (pane: Pane) => pane.key !== HOME_KEY;

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

  it('closes every closable tab to the left while keeping Home and the anchor', () => {
    const home = createPane(HOME_KEY, 'Home');
    const first = createPane('/first/doc', 'First');
    const second = createPane('/second/doc', 'Second');
    const anchor = createPane('/anchor/doc', 'Anchor');

    expect(
      closeTabsOnSide({ items: [home, first, second, anchor], activeKey: second.key }, anchor.key, 'left', isClosable),
    ).toEqual({ items: [home, anchor], activeKey: anchor.key });
  });

  it('activates a non-active anchor after closing tabs to the right', () => {
    const home = createPane(HOME_KEY, 'Home');
    const first = createPane('/first/doc', 'First');
    const anchor = createPane('/anchor/doc', 'Anchor');
    const active = createPane('/active/doc', 'Active');

    expect(
      closeTabsOnSide({ items: [home, first, anchor, active], activeKey: active.key }, anchor.key, 'right', isClosable),
    ).toEqual({ items: [home, first, anchor], activeKey: anchor.key });
  });

  it('keeps Home as the active anchor when closing every tab to its right', () => {
    const home = createPane(HOME_KEY, 'Home');
    const first = createPane('/first/doc', 'First');
    const second = createPane('/second/doc', 'Second');

    expect(
      closeTabsOnSide({ items: [home, first, second], activeKey: second.key }, home.key, 'right', isClosable),
    ).toEqual({ items: [home], activeKey: home.key });
  });

  it('reports whether the requested side contains a closable tab', () => {
    const home = createPane(HOME_KEY, 'Home');
    const first = createPane('/first/doc', 'First');
    const middle = createPane('/middle/doc', 'Middle');
    const last = createPane('/last/doc', 'Last');
    const items = [home, first, middle, last];

    expect(hasClosableTabsOnSide(items, first.key, 'left', isClosable)).toBe(false);
    expect(hasClosableTabsOnSide(items, first.key, 'right', isClosable)).toBe(true);
    expect(hasClosableTabsOnSide(items, middle.key, 'left', isClosable)).toBe(true);
    expect(hasClosableTabsOnSide(items, middle.key, 'right', isClosable)).toBe(true);
    expect(hasClosableTabsOnSide(items, last.key, 'left', isClosable)).toBe(true);
    expect(hasClosableTabsOnSide(items, last.key, 'right', isClosable)).toBe(false);
  });

  it('leaves the current state unchanged when the anchor does not exist', () => {
    const state = {
      items: [createPane(HOME_KEY, 'Home'), createPane('/first/doc', 'First')],
      activeKey: '/first/doc',
    };

    expect(closeTabsOnSide(state, '/missing/doc', 'left', isClosable)).toBe(state);
  });
});
