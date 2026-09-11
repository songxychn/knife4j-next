import { describe, expect, it } from 'vitest';
import { buildRequestPreviewSafely, formatRequestPreviewBody, resolveSendPreview } from './requestPreviewBuild';

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

  it('reuses the displayed preview instead of rebuilding on send', () => {
    const displayed = {
      ok: true as const,
      value: { curl: 'displayed' } as never,
    };
    const prepared = { curl: 'prepared' } as never;
    expect(resolveSendPreview(prepared, displayed, () => ({ curl: 'rebuilt' }) as never).value).toBe(prepared);
    expect(resolveSendPreview(undefined, displayed, () => ({ curl: 'rebuilt' }) as never)).toBe(displayed);
    expect(
      resolveSendPreview(undefined, null, () => {
        throw new Error('rebuild-failed');
      }),
    ).toEqual({ ok: false, error: 'rebuild-failed' });
  });
});
