import { describe, expect, it } from 'vitest';
import { buildDocumentToolRoute, matchDocumentToolRoute } from './documentToolRoutes';

describe('documentToolRoutes', () => {
  it.each([
    ['/orders/globalParam', 'orders', 'globalParam'],
    ['/orders/cookieSession', 'orders', 'cookieSession'],
    ['/orders/authorize', 'orders', 'authorize'],
  ] as const)('matches the document tool route %s', (pathname, group, tool) => {
    expect(matchDocumentToolRoute(pathname)).toEqual({ group, tool });
  });

  it.each([
    '/orders/home',
    '/orders/schema',
    '/orders/pets/list',
    '/orders/pets/list/doc',
    '/orders/globalParam/doc',
    '/orders/cookieSession/extra',
  ])('does not match the non-tool route %s', (pathname) => {
    expect(matchDocumentToolRoute(pathname)).toBeNull();
  });

  it('builds the same tool route for another group', () => {
    const current = matchDocumentToolRoute('/orders/cookieSession');
    expect(current && buildDocumentToolRoute('users', current.tool)).toBe('/users/cookieSession');
  });
});
