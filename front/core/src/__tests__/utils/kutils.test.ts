import KUtils from '../../models/knife4j/utils/KUtils';

describe('KUtils.wrapLine', () => {
  test('returns empty string for empty input', () => {
    expect(KUtils.wrapLine('')).toBe('');
  });

  test('returns string unchanged when no newlines', () => {
    expect(KUtils.wrapLine('hello world')).toBe('hello world');
  });

  test('replaces \\n with literal \\\\n', () => {
    expect(KUtils.wrapLine('line1\nline2')).toBe('line1\\nline2');
  });

  test('replaces \\r\\n with literal \\\\n', () => {
    expect(KUtils.wrapLine('line1\r\nline2')).toBe('line1\\nline2');
  });

  test('replaces \\r with literal \\\\n', () => {
    expect(KUtils.wrapLine('line1\rline2')).toBe('line1\\nline2');
  });
});

describe('KUtils.basicType', () => {
  test('returns true for known basic types', () => {
    const types = ['string', 'integer', 'number', 'object', 'boolean', 'int32', 'int64', 'float', 'double'];
    for (const t of types) {
      expect(KUtils.basicType(t)).toBe(true);
    }
  });

  test('returns false for unknown type', () => {
    expect(KUtils.basicType('file')).toBe(false);
    expect(KUtils.basicType('binary')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(KUtils.basicType('')).toBe(false);
  });
});

describe('KUtils.basicTypeValue', () => {
  test('returns 0 for integer', () => {
    expect(KUtils.basicTypeValue('integer')).toBe(0);
  });

  test('returns true for boolean', () => {
    expect(KUtils.basicTypeValue('boolean')).toBe(true);
  });

  test('returns empty object for object', () => {
    expect(KUtils.basicTypeValue('object')).toEqual({});
  });

  test('returns 0 for number', () => {
    expect(KUtils.basicTypeValue('number')).toBe(0);
  });

  test('returns undefined for unknown type', () => {
    expect(KUtils.basicTypeValue('string')).toBeUndefined();
  });
});
