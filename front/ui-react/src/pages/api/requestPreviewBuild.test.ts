import { describe, expect, it } from 'vitest';
import { buildRequestPreviewSafely } from './requestPreviewBuild';

describe('buildRequestPreviewSafely', () => {
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
