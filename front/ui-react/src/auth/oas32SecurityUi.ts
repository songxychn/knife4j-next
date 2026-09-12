import type { AuthValues, Oas32SecuritySchemeObject } from 'knife4j-core';
import type { ResourceGraphSnapshot } from '../schema/externalResourceGraph';
import {
  planOas32Security,
  projectOas32Security,
  type Oas32SecurityPlan,
  type Oas32SecurityProjection,
} from './oas32Security';
import type { MenuOperation } from '../types/swagger';

export type Oas32OauthEndpointResolution =
  { readonly href: string } | { readonly issue: 'missing' | 'relative-without-base' | 'invalid' };

export interface Oas32AuthorizeSchemeCard {
  readonly name: string;
  readonly credentialKey: string;
  readonly scheme?: Readonly<Oas32SecuritySchemeObject>;
  readonly unavailable?: boolean;
}

const hasUserinfoOrFragment = (url: URL) => Boolean(url.username || url.password || url.hash);

/** Relative OAuth/metadata URLs need an explicit API base; never the UI origin or $self. */
export function resolveOas32OauthEndpoint(
  declared: string | undefined,
  apiBase: string | undefined,
): Oas32OauthEndpointResolution {
  if (typeof declared !== 'string' || !declared.trim()) return { issue: 'missing' };
  const value = declared.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    try {
      const url = new URL(value);
      if (hasUserinfoOrFragment(url)) return { issue: 'invalid' };
      return { href: url.href };
    } catch {
      return { issue: 'invalid' };
    }
  }
  if (!apiBase?.trim()) return { issue: 'relative-without-base' };
  try {
    const base = new URL(apiBase.trim());
    if (hasUserinfoOrFragment(base)) return { issue: 'invalid' };
    const url = new URL(value, base);
    if (hasUserinfoOrFragment(url)) return { issue: 'invalid' };
    return { href: url.href };
  } catch {
    return { issue: 'invalid' };
  }
}

export function authorizeSchemeCards(projection: Oas32SecurityProjection): readonly Oas32AuthorizeSchemeCard[] {
  const cards: Oas32AuthorizeSchemeCard[] = [];
  const seen = new Set<string>();
  const push = (card: Oas32AuthorizeSchemeCard) => {
    if (seen.has(card.credentialKey)) return;
    seen.add(card.credentialKey);
    cards.push(card);
  };
  for (const entry of projection.schemes) {
    if (entry.resolution.status === 'resolved') {
      push({ name: entry.name, credentialKey: entry.resolution.credentialKey, scheme: entry.resolution.scheme });
      continue;
    }
    push({
      name: entry.name,
      credentialKey: entry.resolution.credentialKey ?? entry.name,
      unavailable: true,
    });
  }
  for (const branch of projection.branches) {
    for (const member of branch.members) {
      if (member.resolution.status !== 'resolved' || member.resolution.bindingKind !== 'uri') continue;
      push({
        name: member.key,
        credentialKey: member.resolution.credentialKey,
        scheme: member.resolution.scheme,
      });
    }
  }
  return cards;
}

export function projectAndPlanOas32Security(
  snapshot: ResourceGraphSnapshot | null | undefined,
  operation: MenuOperation | null | undefined,
  credentials: AuthValues | undefined,
  explicitIndex?: number,
): { projection: Oas32SecurityProjection; plan: Oas32SecurityPlan } | null {
  if (!snapshot) return null;
  const projection = projectOas32Security(snapshot, operation?.identity);
  return { projection, plan: planOas32Security(projection, credentials, explicitIndex) };
}

export function debugAuthFromOas32Plan(plan: Oas32SecurityPlan | null | undefined): {
  auth: AuthValues | undefined;
  securityKeys: string[] | undefined;
} {
  if (!plan || plan.status !== 'ready') return { auth: { bySecurityKey: {} }, securityKeys: [] };
  return { auth: plan.auth, securityKeys: plan.securityKeys };
}
