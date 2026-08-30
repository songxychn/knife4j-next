export type BrowserRequestConstraint = 'unsupported-method' | 'unsupported-body' | 'unsupported-cookie' | null;

/** Reflect Fetch's forbidden methods/headers and its GET/HEAD request-body restriction. */
export function browserRequestConstraint(
  method: string,
  hasBody: boolean,
  hasExplicitCookieParameter = false,
): BrowserRequestConstraint {
  const normalizedMethod = method.trim().toUpperCase();
  if (['CONNECT', 'TRACE', 'TRACK'].includes(normalizedMethod)) return 'unsupported-method';
  if (hasBody && ['GET', 'HEAD'].includes(normalizedMethod)) return 'unsupported-body';
  if (hasExplicitCookieParameter) return 'unsupported-cookie';
  return null;
}
