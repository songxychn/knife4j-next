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

// RFC 3986 §5.2.4, restricted to the path component. In step C an output
// without a slash still loses its last segment; @hyperjump/uri 1.3.5 keeps it.
function removeDotSegments(path: string): string {
  let input = path;
  let output = '';
  while (input) {
    if (input.startsWith('../') || input.startsWith('./')) {
      input = input.slice(input.indexOf('/') + 1);
    } else if (input.startsWith('/./') || input === '/.') {
      input = `/${input.slice(3)}`;
    } else if (input.startsWith('/../') || input === '/..') {
      input = `/${input.slice(4)}`;
      output = output.slice(0, Math.max(0, output.lastIndexOf('/')));
    } else if (input === '.' || input === '..') {
      input = '';
    } else {
      const slash = input.indexOf('/', input.startsWith('/') ? 1 : 0);
      const end = slash < 0 ? input.length : slash;
      output += input.slice(0, end);
      input = input.slice(end);
    }
  }
  return output;
}

function correctRootlessPath(result: string, path: string): string {
  if (!path || path.startsWith('/')) return result;
  const parsed = uri.parseUri(result);
  return `${parsed.scheme}:${removeDotSegments(path)}${parsed.query === undefined ? '' : `?${parsed.query}`}${parsed.fragment === undefined ? '' : `#${parsed.fragment}`}`;
}

// Only the path that the existing resolver merges is needed for its rootless
// correction. The library still parses and resolves all other URI components.
function resolutionPath(reference: string, base: string): string {
  const ref = uri.parseUriReference(reference);
  if (ref.scheme !== undefined || ref.authority !== undefined || ref.path.startsWith('/')) return ref.path;
  const context = uri.parseAbsoluteUri(base);
  if (!ref.path) return context.path;
  if (context.authority !== undefined && !context.path) return `/${ref.path}`;
  return `${context.path.slice(0, context.path.lastIndexOf('/') + 1)}${ref.path}`;
}

// Protect exactly one percent-encoding layer: reserved characters must not
// become equivalent to their literal forms (RFC 3986 §2.2).
export function normalizeUri(value: string): string {
  const protectedValue = protectPercentEncoding(value);
  return restorePercentEncoding(
    correctRootlessPath(uri.normalizeUri(protectedValue), uri.parseUri(protectedValue).path),
  );
}

export function toAbsoluteUri(value: string): string {
  const protectedValue = protectPercentEncoding(value);
  return restorePercentEncoding(
    correctRootlessPath(uri.toAbsoluteUri(protectedValue), uri.parseUri(protectedValue).path),
  );
}

export function resolveUri(reference: string, base: string): string {
  const protectedReference = protectPercentEncoding(reference);
  const protectedBase = protectPercentEncoding(base);
  return restorePercentEncoding(
    correctRootlessPath(
      uri.resolveUri(protectedReference, protectedBase),
      resolutionPath(protectedReference, protectedBase),
    ),
  );
}
