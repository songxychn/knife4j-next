import { HTTP_METHOD_TOKEN } from 'knife4j-core';
export type BrowserRequestConstraint =
  'unsupported-method' | 'normalized-method' | 'unsupported-body' | 'unsupported-cookie' | null;

/** Reflect Fetch's forbidden methods/headers and its GET/HEAD request-body restriction. */
export function browserRequestConstraint(
  method: string,
  hasBody: boolean,
  hasExplicitCookieParameter = false,
): BrowserRequestConstraint {
  if (!HTTP_METHOD_TOKEN.test(method)) return 'unsupported-method';
  const normalizedMethod = method.toUpperCase();
  if (['CONNECT', 'TRACE', 'TRACK'].includes(normalizedMethod)) return 'unsupported-method';
  if (['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'].includes(normalizedMethod) && method !== normalizedMethod)
    return 'normalized-method';
  if (hasBody && ['GET', 'HEAD'].includes(normalizedMethod)) return 'unsupported-body';
  if (hasExplicitCookieParameter) return 'unsupported-cookie';
  return null;
}
