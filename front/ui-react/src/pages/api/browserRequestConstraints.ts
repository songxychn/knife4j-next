export type BrowserRequestConstraint = 'unsupported-method' | 'unsupported-body' | null;

/** Reflect Fetch's forbidden methods and its GET/HEAD request-body restriction. */
export function browserRequestConstraint(method: string, hasBody: boolean): BrowserRequestConstraint {
  const normalizedMethod = method.trim().toUpperCase();
  if (['CONNECT', 'TRACE', 'TRACK'].includes(normalizedMethod)) return 'unsupported-method';
  if (hasBody && ['GET', 'HEAD'].includes(normalizedMethod)) return 'unsupported-body';
  return null;
}
