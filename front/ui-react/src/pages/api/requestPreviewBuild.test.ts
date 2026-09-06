import { describe, expect, it } from 'vitest';
import { buildRequestPreviewSafely, formatRequestPreviewBody } from './requestPreviewBuild';

describe('buildRequestPreviewSafely', () => {
  it('preserves author whitespace, empty text and unsafe JSON numbers in explicit Example previews', () => {
    for (const text of ['{ "n": 0 }\n', '', '9007199254740993'])
      expect(formatRequestPreviewBody(text, 'application/json', true)).toBe(text);
    expect(formatRequestPreviewBody('{ "n": 0 }\n', 'application/json')).toBe('{\n  "n": 0\n}');
  });
  it('returns an error instead of throwing for unsupported parameter serialization', () => {
    const result = buildRequestPreviewSafely(() => {
      throw new Error('Unsupported OAS3 query array serialization');
    });

    expect(result).toEqual({
      ok: false,
      error: 'Unsupported OAS3 query array serialization',
    });
  });
});
