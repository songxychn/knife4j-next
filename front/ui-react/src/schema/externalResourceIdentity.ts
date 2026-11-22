import { decodeJsonPointerToken, hasOwn as owns } from 'knife4j-core';
import { isUriReference, normalizeUri, parseUri, resolveUri, toAbsoluteUri } from 'knife4j-schema-engine/uri';

type ResourceDocumentFamily = '3.1' | '3.2';
export const ANCHOR_NAME = /^[A-Za-z_][-A-Za-z0-9._]*$/;

export function uriWithoutFragment(uri: string, family: ResourceDocumentFamily = '3.1'): string {
  if (family === '3.2') return toAbsoluteUri(uri);
  const parsed = new URL(uri);
  parsed.hash = '';
  return parsed.href;
}

export function fragmentOf(uri: string, family: ResourceDocumentFamily = '3.1'): string {
  if (family === '3.2') {
    const fragment = parseUri(uri).fragment;
    return fragment ? `#${fragment}` : '';
  }
  return new URL(uri).hash;
}

/** Logical OAS 3.2 identities use RFC 3986; the existing 3.1 path is unchanged. */
export function resolveGraphUri(reference: string, baseUri: string, family: ResourceDocumentFamily): string {
  if (family === '3.1') return new URL(reference, baseUri).href;
  // The extra whitespace check also rejects trailing line breaks accepted by a JS regex `$` assertion.
  if (/\s/.test(reference) || !isUriReference(reference)) throw new TypeError('Expected a URI reference.');
  return resolveUri(reference, toAbsoluteUri(baseUri));
}

/** Keep logical identities and the existing HTTP retrieval normalization in separate namespaces. */
export function identityAliases(uri: string, family: ResourceDocumentFamily): readonly string[] {
  if (family === '3.1') return [uri];
  const logical = normalizeUri(uri);
  const parsed = parseUri(logical);
  if (!['http', 'https'].includes(parsed.scheme) || !parsed.host) return [logical];
  // Only RFC 3986 §6.2.3 HTTP default-port/empty-path equivalence is added.
  // WHATWG URL serialization would also change reserved query characters such as an apostrophe.
  const defaultPort = parsed.scheme === 'https' ? '443' : '80';
  const authority = parsed.port === defaultPort ? parsed.authority.slice(0, -defaultPort.length - 1) : parsed.authority;
  const alias = `${parsed.scheme}://${authority}${parsed.path || '/'}${parsed.query === undefined ? '' : `?${parsed.query}`}${parsed.fragment === undefined ? '' : `#${parsed.fragment}`}`;
  return [...new Set([logical, alias])];
}

export function referenceRetrievalUri(
  reference: string,
  baseUri: string,
  resolvedUri: string,
  family: ResourceDocumentFamily,
): string {
  if (family === '3.1') return uriWithoutFragment(resolvedUri);
  const parsed = parseUri(resolvedUri);
  if (['http', 'https'].includes(parsed.scheme) && parsed.host) {
    // Preserve the existing exact retrieval spelling, including encoded path/query bytes.
    // A same-scheme absolute URI such as http:g never enters the WHATWG URL resolver.
    return uriWithoutFragment(new URL(reference, baseUri).href);
  }
  return toAbsoluteUri(resolvedUri);
}

/** Remove credentials and query values from every user-visible resource identity. */
export function safeResourceDisplay(uri: string): string {
  try {
    const parsed = new URL(uri);
    parsed.username = '';
    parsed.password = '';
    const hadQuery = parsed.search.length > 0;
    parsed.search = '';
    const safeUri = parsed.href;
    if (!hadQuery) return safeUri;
    const fragmentIndex = safeUri.indexOf('#');
    return fragmentIndex < 0 ? `${safeUri}?…` : `${safeUri.slice(0, fragmentIndex)}?…${safeUri.slice(fragmentIndex)}`;
  } catch {
    return uri
      .replace(/\/\/[^/@\s]+@/g, '//…@')
      .replace(/\?[^#\s]*/g, '?…')
      .slice(0, 512);
  }
}

export function safeRawReferenceDisplay(reference: string): string {
  if (reference.startsWith('#')) return reference.slice(0, 512);
  return safeResourceDisplay(reference);
}

function decodedJsonPointer(fragment: string): string | undefined {
  if (!fragment || fragment === '#') return '';
  if (!fragment.startsWith('#')) return undefined;
  let pointer: string;
  try {
    pointer = decodeURIComponent(fragment.slice(1));
  } catch {
    return undefined;
  }
  if (!pointer.startsWith('/')) return undefined;
  if (
    pointer
      .slice(1)
      .split('/')
      .some((token) => /~(?:[^01]|$)/.test(token))
  )
    return undefined;
  return pointer;
}

export function resolveJsonPointer(root: unknown, fragment: string): unknown {
  const pointer = decodedJsonPointer(fragment);
  if (pointer === undefined) return undefined;
  if (!pointer) return root;
  let current = root;
  for (const encoded of pointer.slice(1).split('/')) {
    const token = decodeJsonPointerToken(encoded);
    if (current === null || typeof current !== 'object' || !owns(current, token)) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

export function pointerWithinResource(resourcePointer: string, fragment: string): string {
  const pointer = decodedJsonPointer(fragment);
  if (!pointer) return resourcePointer;
  return resourcePointer === '#' ? `#${pointer}` : `${resourcePointer}${pointer}`;
}

export function normalizedAnchorUri(uri: string): string {
  const fragmentIndex = uri.indexOf('#');
  if (fragmentIndex < 0) return uri;
  try {
    const anchor = decodeURIComponent(uri.slice(fragmentIndex + 1));
    // Only normalize valid anchor names. JSON Pointer decoding and exact
    // network retrieval identities follow their own rules.
    return ANCHOR_NAME.test(anchor) ? `${uri.slice(0, fragmentIndex + 1)}${anchor}` : uri;
  } catch {
    return uri;
  }
}
