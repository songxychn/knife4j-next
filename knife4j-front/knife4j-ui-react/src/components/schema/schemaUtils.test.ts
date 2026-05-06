import { describe, expect, test } from 'vitest';
import { normalizeGenericTitle } from './schemaUtils';

describe('normalizeGenericTitle', () => {
  test('converts guillemets to angle brackets', () => {
    expect(normalizeGenericTitle('Result«UserVO»')).toBe('Result<UserVO>');
  });

  test('handles nested generics', () => {
    expect(normalizeGenericTitle('Page«List«UserVO»»')).toBe('Page<List<UserVO>>');
  });

  test('returns unchanged string when no guillemets', () => {
    expect(normalizeGenericTitle('UserVO')).toBe('UserVO');
  });

  test('returns undefined for undefined input', () => {
    expect(normalizeGenericTitle(undefined)).toBeUndefined();
  });
});
