import { describe, expect, it } from 'vitest';

import { formatSseEventTime, formatSseHistoryResponseBody } from './sseEventTime';

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

describe('formatSseHistoryResponseBody', () => {
  it('returns empty string for no events', () => {
    expect(formatSseHistoryResponseBody([])).toBe('');
  });

  it('serializes full event payloads with index and time', () => {
    const t1 = new Date(2026, 6, 4, 23, 58, 19, 746).getTime();
    const t2 = new Date(2026, 6, 4, 23, 58, 20, 10).getTime();

    expect(
      formatSseHistoryResponseBody([
        { data: '{"id":1}', timestamp: t1 },
        { data: 'hello\nworld', timestamp: t2 },
      ]),
    ).toBe(`#1 23:58:19.746\n{"id":1}\n\n#2 23:58:20.010\nhello\nworld`);
  });
});
