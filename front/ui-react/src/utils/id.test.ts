import { describe, expect, it } from 'vitest';

import { createClientId } from './id';

describe('client id generation', () => {
  it('uses crypto.randomUUID when it is available', () => {
    expect(createClientId({ randomUUID: () => 'fixed-id' })).toBe('fixed-id');
  });

  it('falls back to getRandomValues when randomUUID is missing', () => {
    const randomBytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

    const id = createClientId({
      getRandomValues: (bytes) => {
        bytes.set(randomBytes);
        return bytes;
      },
    });

    expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('uses a timestamp fallback when browser crypto is unavailable', () => {
    expect(createClientId(null)).toMatch(/^id-[a-z0-9]+-[a-z0-9]+$/);
  });
});
