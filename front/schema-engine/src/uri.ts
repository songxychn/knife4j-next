import * as uri from '@hyperjump/uri';

// This subpath stays independent from the lazily loaded Schema engine.
export const isUriReference = uri.isUriReference;
export const parseUri = uri.parseUri;

function protectPercentEncoding(value: string): string {
  // Validate before decoding, so an invalid reference cannot acquire a valid scheme.
  // The whitespace guard also rejects the trailing newline accepted by a JS `$` assertion.
  if (/\s/.test(value) || !uri.isUriReference(value)) throw new TypeError('Expected a URI reference.');
  return value.replace(/%([\da-f]{2})/gi, (_, hex: string) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    return /^[a-z\d._~-]$/i.test(character) ? character : `%25${hex.toUpperCase()}`;
  });
}

function restorePercentEncoding(value: string): string {
  return value.replace(/%25([\da-f]{2})/gi, (_, hex: string) => `%${hex.toUpperCase()}`);
}

// @hyperjump/uri 1.3.5 decodes reserved characters in path/query/fragment.
// RFC 3986 §2.2 forbids treating those encodings as equivalent identities.
// Protect exactly one encoding layer; grammar, parsing and resolution remain the library's.
export const normalizeUri = (value: string): string =>
  restorePercentEncoding(uri.normalizeUri(protectPercentEncoding(value)));
export const toAbsoluteUri = (value: string): string =>
  restorePercentEncoding(uri.toAbsoluteUri(protectPercentEncoding(value)));
export const resolveUri = (reference: string, base: string): string =>
  restorePercentEncoding(uri.resolveUri(protectPercentEncoding(reference), protectPercentEncoding(base)));
