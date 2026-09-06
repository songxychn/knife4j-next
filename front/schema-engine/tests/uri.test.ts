import { describe, expect, test } from 'vitest';
import { normalizeUri, resolveUri, toAbsoluteUri } from '../src/uri';

// RFC 3986 §5.2.4 removes the last output segment even when no slash precedes it.
describe('rootless URI dot segments', () => {
  test.each([
    ['example:a/../b', 'example:/b'],
    ['example:a/..', 'example:/'],
    ['example:a/../../b', 'example:/b'],
    ['example:a/b/../c', 'example:a/c'],
    ['example:a/b/../../c', 'example:/c'],
    ['example:a/.', 'example:a/'],
    ['example:../b', 'example:b'],
    ['example:./b', 'example:b'],
    ['example:a/%2e%2E/b', 'example:/b'],
    ['example:a/../b%2Fc%3Ad?x=%26#%2F', 'example:/b%2Fc%3Ad?x=%26#%2F'],
    ['example:a/../b%253A?x=%2525#%23', 'example:/b%253A?x=%2525#%23'],
  ])('normalizes %s as %s', (input, expected) => {
    expect(normalizeUri(input)).toBe(expected);
    expect(toAbsoluteUri(input)).toBe(expected.split('#')[0]);
    expect(resolveUri(input, 'https://example.test/a/b')).toBe(expected);
    expect(normalizeUri(expected)).toBe(expected);
  });

  test.each([
    ['a/../b', 'example:a', 'example:/b'],
    ['../b', 'example:a/c', 'example:/b'],
    ['b/../d', 'example:a/c', 'example:a/d'],
    ['../b', 'example:a', 'example:b'],
    ['b', 'example:a', 'example:b'],
    ['c', 'example:a/b', 'example:a/c'],
    ['?y=2', 'example:a?x=1', 'example:a?y=2'],
    ['#section', 'example:a?x=1', 'example:a?x=1#section'],
    ['../b%2Fc?x=%26#%2F', 'example:a/c', 'example:/b%2Fc?x=%26#%2F'],
  ])('resolves %s against rootless base %s', (reference, base, expected) => {
    expect(resolveUri(reference, base)).toBe(expected);
  });
});

// Published normal and abnormal examples in RFC 3986 §5.4 are independent controls.
describe('RFC 3986 section 5.4 resolution examples', () => {
  test.each([
    ['g:h', 'g:h'],
    ['g', 'http://a/b/c/g'],
    ['./g', 'http://a/b/c/g'],
    ['g/', 'http://a/b/c/g/'],
    ['/g', 'http://a/g'],
    ['//g', 'http://g'],
    ['?y', 'http://a/b/c/d;p?y'],
    ['g?y', 'http://a/b/c/g?y'],
    ['#s', 'http://a/b/c/d;p?q#s'],
    ['g#s', 'http://a/b/c/g#s'],
    ['g?y#s', 'http://a/b/c/g?y#s'],
    [';x', 'http://a/b/c/;x'],
    ['g;x', 'http://a/b/c/g;x'],
    ['g;x?y#s', 'http://a/b/c/g;x?y#s'],
    ['', 'http://a/b/c/d;p?q'],
    ['.', 'http://a/b/c/'],
    ['./', 'http://a/b/c/'],
    ['..', 'http://a/b/'],
    ['../', 'http://a/b/'],
    ['../g', 'http://a/b/g'],
    ['../..', 'http://a/'],
    ['../../', 'http://a/'],
    ['../../g', 'http://a/g'],
    ['../../../g', 'http://a/g'],
    ['../../../../g', 'http://a/g'],
    ['/./g', 'http://a/g'],
    ['/../g', 'http://a/g'],
    ['g.', 'http://a/b/c/g.'],
    ['.g', 'http://a/b/c/.g'],
    ['g..', 'http://a/b/c/g..'],
    ['..g', 'http://a/b/c/..g'],
    ['./../g', 'http://a/b/g'],
    ['./g/.', 'http://a/b/c/g/'],
    ['g/./h', 'http://a/b/c/g/h'],
    ['g/../h', 'http://a/b/c/h'],
    ['g;x=1/./y', 'http://a/b/c/g;x=1/y'],
    ['g;x=1/../y', 'http://a/b/c/y'],
    ['g?y/./x', 'http://a/b/c/g?y/./x'],
    ['g?y/../x', 'http://a/b/c/g?y/../x'],
    ['g#s/./x', 'http://a/b/c/g#s/./x'],
    ['g#s/../x', 'http://a/b/c/g#s/../x'],
    ['http:g', 'http:g'],
  ])('resolves %s as %s', (reference, expected) => {
    expect(resolveUri(reference, 'http://a/b/c/d;p?q')).toBe(expected);
  });
});
