import { describe, expect, it } from 'vitest';
import { groupNameFromPathname, selectInitialGroupName } from './groupRoute';
import type { SwaggerGroup } from '../types/swagger';

const groups: SwaggerGroup[] = [
  { name: 'default', url: '/v3/api-docs/default' },
  { name: 'orders service', url: '/v3/api-docs/orders' },
  { name: 'inventory', url: '/v3/api-docs/inventory' },
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
});
