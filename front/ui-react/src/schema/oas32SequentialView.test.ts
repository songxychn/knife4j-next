import { describe, expect, test } from 'vitest';
import { decodeOas32SequentialBytes } from './oas32SequentialMedia';
import { sequentialItemInstance } from './oas32SequentialResponse';
import { formatSequentialHistoryBody, sequentialRecordPreview, toSequentialDisplayedItem } from './oas32SequentialView';

describe('oas32SequentialView', () => {
  test('keeps SSE data a string in the debug preview', () => {
    const record = decodeOas32SequentialBytes(
      [new TextEncoder().encode('event: ping\ndata: {"n":1}\n\n')],
      'text/event-stream',
    )[0]!;
    expect(sequentialItemInstance(record)).toMatchObject({ event: 'ping', data: '{"n":1}' });
    expect(sequentialRecordPreview(record)).toBe('event: ping\ndata: {"n":1}');
  });

  test('serializes sequential history from displayed items', () => {
    const record = decodeOas32SequentialBytes([new TextEncoder().encode('{"id":1}\n')], 'application/jsonl')[0]!;
    const item = toSequentialDisplayedItem(
      { record, instance: { id: 1 }, itemSchema: { status: 'valid' } },
      Date.UTC(2026, 0, 1, 0, 0, 0, 0),
    );
    expect(formatSequentialHistoryBody([item])).toContain('{"id":1}');
  });
});
