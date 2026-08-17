import { describe, expect, it } from 'vitest';
import {
  groupNameFromPathname,
  isRouteGroupReady,
  resolveActiveRouteGroup,
  selectInitialGroupName,
} from './groupRoute';
import type { SwaggerGroup } from '../types/swagger';

const groups: SwaggerGroup[] = [
  { name: 'default', url: '/v3/api-docs/default' },
  { name: 'orders service', url: '/v3/api-docs/orders' },
  { name: 'inventory', url: '/v3/api-docs/inventory' },
];

const groupsWithHomePlaceholderCollision: SwaggerGroup[] = [
  { name: 'default', url: '/v3/api-docs/default' },
  { name: 'group', url: '/v3/api-docs/group' },
];

describe('groupRoute', () => {
  it('reads the first route segment as the group name', () => {
    expect(groupNameFromPathname('/inventory/pet/getPet/doc')).toBe('inventory');
  });

  it('decodes encoded group names from the route', () => {
    expect(groupNameFromPathname('/orders%20service/pet/getPet/doc')).toBe('orders service');
  });

  it('selects the route group when it exists in swagger-config', () => {
    expect(selectInitialGroupName(groups, '/inventory/pet/getPet/doc')).toBe('inventory');
  });

  it('falls back to the first group when the route group is not a swagger group', () => {
    expect(selectInitialGroupName(groups, '/group/home')).toBe('default');
  });

  it('does not treat the fixed home route as a real group route', () => {
    expect(groupNameFromPathname('/group/home')).toBeNull();
    expect(selectInitialGroupName(groupsWithHomePlaceholderCollision, '/group/home')).toBe('default');
    expect(selectInitialGroupName(groupsWithHomePlaceholderCollision, '/group/Pet/getPet/doc')).toBe('group');
  });

  it('keeps group-bound pages pending until the route group becomes active', () => {
    expect(isRouteGroupReady('orders service', 'inventory')).toBe(false);
    expect(isRouteGroupReady('orders service', 'orders service')).toBe(true);
    expect(isRouteGroupReady(null, 'orders service')).toBe(true);
  });

  it('keeps the active group identity when its spec is unavailable', () => {
    expect(
      resolveActiveRouteGroup(
        [],
        groups.map((group) => group.name),
        'inventory',
      ),
    ).toEqual({
      value: 'inventory',
      label: 'inventory',
      apis: [],
    });
  });

  it('prefers the loaded group and only falls back to empty for an unknown identity', () => {
    const loaded = [{ value: 'default', label: 'Default API', apis: [{ key: 'operation' }] }];
    expect(resolveActiveRouteGroup(loaded, ['default'], 'default')).toBe(loaded[0]);
    expect(resolveActiveRouteGroup([], ['default'], 'missing')).toEqual({ value: '', label: '', apis: [] });
  });
});
