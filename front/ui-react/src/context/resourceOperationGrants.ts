import type { ResourceGrant } from '../schema/externalResourceGraph';

export function resourceGrantsForOperation(
  documentScope: string,
  rememberedGrantKeys: ReadonlySet<string>,
  selectedGrantKeys: readonly string[] = [],
): ResourceGrant[] {
  const scopes = new Map<string, ResourceGrant['scope']>();
  rememberedGrantKeys.forEach((resourceKey) => scopes.set(resourceKey, 'document'));
  selectedGrantKeys.forEach((resourceKey) => {
    if (!scopes.has(resourceKey)) scopes.set(resourceKey, 'generation');
  });
  return [...scopes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resourceKey, scope]) => ({ documentScope, resourceKey, scope }));
}
