import { describe, expect, it } from 'vitest';

import { formatSseEventTime } from './sseEventTime';

describe('formatSseEventTime', () => {
  it('formats timestamps in the browser local timezone', () => {
    const localTimestamp = new Date(2026, 6, 4, 23, 58, 19, 746).getTime();

    expect(formatSseEventTime(localTimestamp)).toBe('23:58:19.746');
  });

  it('pads single digit values', () => {
    const localTimestamp = new Date(2026, 0, 2, 3, 4, 5, 6).getTime();

    expect(formatSseEventTime(localTimestamp)).toBe('03:04:05.006');
  });
});
