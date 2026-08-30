import { describe, expect, test } from 'vitest';
import { normalizeGenericTitle, schemaNodeTypeLabel } from './schemaUtils';

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

describe('schemaNodeTypeLabel', () => {
  test('shows OAS 3.1 nullable type arrays', () => {
    expect(schemaNodeTypeLabel({ name: 'nickname', type: 'string', types: ['string', 'null'], required: false })).toBe(
      'string | null',
    );
  });

  test('shows prefixItems as a tuple instead of a homogeneous array', () => {
    expect(
      schemaNodeTypeLabel({
        name: 'tuple',
        type: 'array',
        required: false,
        children: [
          { name: '[0]', type: 'string', required: false },
          { name: '[1]', type: 'integer', required: false },
        ],
      }),
    ).toBe('[string, integer]');
  });

  test('labels OAS 3.1 boolean schemas explicitly', () => {
    expect(schemaNodeTypeLabel({ name: 'anything', type: 'unknown', required: false, booleanSchema: true })).toBe(
      'any',
    );
    expect(schemaNodeTypeLabel({ name: 'nothing', type: 'never', required: false, booleanSchema: false })).toBe(
      'never',
    );
  });
});
