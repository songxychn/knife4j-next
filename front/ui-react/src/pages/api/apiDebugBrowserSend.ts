import type { BuiltRequest, Oas32ParameterDiagnostic } from 'knife4j-core';
import { browserRequestConstraint, type BrowserRequestConstraint } from './browserRequestConstraints';
import { hasExplicitCookieHeader } from './cookieParameterSource';
import { oas32BrowserSendDiagnostics } from './oas32ParameterForm';

export type UnsentBrowserSendFailure =
  | { readonly kind: Exclude<BrowserRequestConstraint, null>; readonly method: string }
  | { readonly kind: 'oas32-browser'; readonly diagnostics: readonly Oas32ParameterDiagnostic[] };

/** Fetch-forbidden methods, bodies, and Cookie headers are decided before Schema override. */
export function inspectUnsentBrowserSendFailure(input: {
  readonly built: BuiltRequest;
  readonly hasBodyInput: boolean;
  readonly cookieSessionCapable: boolean;
  readonly isOas32: boolean;
}): UnsentBrowserSendFailure | null {
  const constraint = browserRequestConstraint(
    input.built.method,
    input.hasBodyInput,
    input.built.hasExplicitCookieParameters === true ||
      (input.cookieSessionCapable && hasExplicitCookieHeader(input.built.headers)),
  );
  if (constraint) return { kind: constraint, method: input.built.method };
  if (input.isOas32) {
    const diagnostics = oas32BrowserSendDiagnostics(input.built);
    if (diagnostics.length > 0) return { kind: 'oas32-browser', diagnostics };
  }
  return null;
}

export function unsentBrowserSendFailureTab(failure: UnsentBrowserSendFailure): string {
  if (failure.kind === 'unsupported-body') return 'body';
  if (failure.kind === 'unsupported-cookie') return 'cookie';
  if (failure.kind === 'oas32-browser') {
    const first = failure.diagnostics[0];
    if (first?.key?.startsWith('querystring:')) return 'querystring';
    if (first?.name && first.key?.startsWith('cookie:')) return 'cookie';
  }
  return 'preview';
}

/** Schema-negative “still send” cannot waive a Fetch hard failure. */
export function schemaOverrideMayDispatch(hardFailure: UnsentBrowserSendFailure | null): boolean {
  return hardFailure === null;
}

export function discardUnsentDebugResponse(response: { readonly objectUrl?: string } | null | undefined): void {
  const objectUrl = response?.objectUrl;
  if (!objectUrl) return;
  try {
    globalThis.URL?.revokeObjectURL?.(objectUrl);
  } catch {
    /* Best effort only: failing to revoke must not keep the previous 200 panel. */
  }
}
