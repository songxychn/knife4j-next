import { describe, expect, test } from 'vitest';
import {
  classifyOas32SequentialMedia,
  createOas32SequentialDecoder,
  decodeOas32SequentialBytes,
  sequentialMediaBoundary,
} from './oas32SequentialMedia';

const bytes = (...chunks: string[]) => chunks.map((chunk) => new TextEncoder().encode(chunk));

describe('classifyOas32SequentialMedia', () => {
  test.each([
    ['text/event-stream', 'sse'],
    ['text/event-stream; charset=utf-8', 'sse'],
    ['application/jsonl', 'jsonl'],
    ['application/x-ndjson', 'jsonl'],
    ['application/vnd.example+jsonl', 'jsonl'],
    ['application/json-seq', 'json-seq'],
    ['application/vnd.example+json-seq', 'json-seq'],
    ['multipart/mixed; boundary=abc', 'multipart'],
    ['application/json', 'unknown'],
    ['text/plain', 'unknown'],
  ] as const)('%s → %s', (media, kind) => {
    expect(classifyOas32SequentialMedia(media)).toBe(kind);
  });

  test('reads a quoted multipart boundary', () => {
    expect(sequentialMediaBoundary('multipart/mixed; boundary="a;b"')).toBe('a;b');
  });
});

describe('SSE decoder', () => {
  test('joins multiline data and keeps it a string', () => {
    const records = decodeOas32SequentialBytes(
      bytes('event: ping\n', 'data: {"n":1}\n', 'data: more\n', 'id: 7\n', 'retry: 2000\n', '\n'),
      'text/event-stream',
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.value).toEqual({
      kind: 'sse',
      event: { event: 'ping', data: '{"n":1}\nmore', id: '7', retry: 2000 },
    });
    expect(typeof (records[0]?.value as { event: { data: string } }).event.data).toBe('string');
  });

  test('defaults unnamed events to message and ignores comments', () => {
    const records = decodeOas32SequentialBytes(bytes(': keep-alive\n\ndata: hi\n\n'), 'text/event-stream');
    expect(records.map((record) => record.value)).toEqual([{ kind: 'sse', event: { event: 'message', data: 'hi' } }]);
  });

  test('decodes UTF-8 split across chunks', () => {
    const encoded = new TextEncoder().encode('data: café\n\n');
    const records = decodeOas32SequentialBytes([encoded.subarray(0, 8), encoded.subarray(8)], 'text/event-stream');
    expect(records[0]?.value).toMatchObject({ kind: 'sse', event: { data: 'café' } });
  });

  test('does not promote a trailing partial event when the stream is aborted', () => {
    const decoder = createOas32SequentialDecoder('text/event-stream');
    expect(decoder.push(new TextEncoder().encode('data: partial'))).toEqual([]);
    expect(decoder.flush(true)).toEqual([]);
  });
});

describe('JSONL decoder', () => {
  test('parses NDJSON lines and recovers from a bad record', () => {
    const records = decodeOas32SequentialBytes(bytes('{"a":1}\n', 'not-json\n', '{"b":2}\n'), 'application/jsonl');
    expect(records.map((record) => record.value.kind)).toEqual(['json', 'raw', 'json']);
    expect(records[1]?.diagnostics.map((item) => item.code)).toContain('INVALID_JSON');
    expect(records[2]?.value).toMatchObject({ kind: 'json', json: { b: 2 } });
  });

  test('flags a trailing unterminated record without dropping its JSON', () => {
    const records = decodeOas32SequentialBytes(bytes('{"ok":true}'), 'application/x-ndjson');
    expect(records[0]?.value).toMatchObject({ kind: 'json', json: { ok: true } });
    expect(records[0]?.diagnostics.map((item) => item.code)).toContain('INCOMPLETE_RECORD');
  });
});

describe('JSON-seq decoder', () => {
  test('splits RS-delimited RFC 7464 records', () => {
    const records = decodeOas32SequentialBytes(
      [new Uint8Array([0x1e, ...new TextEncoder().encode('{"a":1}\n\x1e{"b":2}\n')])],
      'application/json-seq',
    );
    expect(records.map((record) => (record.value.kind === 'json' ? record.value.json : undefined))).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
  });

  test('keeps a split record buffered until the next RS', () => {
    const decoder = createOas32SequentialDecoder('application/json-seq');
    expect(decoder.push(new Uint8Array([0x1e, ...new TextEncoder().encode('{"a":')]))).toEqual([]);
    const records = decoder.push(new Uint8Array([...new TextEncoder().encode('1}\n\x1e{"b":2}\n')]));
    expect(records.map((record) => (record.value.kind === 'json' ? record.value.json : undefined))).toEqual([{ a: 1 }]);
    expect(decoder.flush().map((record) => (record.value.kind === 'json' ? record.value.json : undefined))).toEqual([
      { b: 2 },
    ]);
  });
});

describe('multipart decoder', () => {
  test('frames two mixed parts with a closing delimiter', () => {
    const body = [
      '--abc\r\nContent-Type: application/json\r\n\r\n{"n":1}\r\n',
      '--abc\r\nContent-Type: text/plain\r\n\r\nhello\r\n',
      '--abc--',
    ].join('');
    const records = decodeOas32SequentialBytes(bytes(body), 'multipart/mixed; boundary=abc');
    expect(records).toHaveLength(2);
    expect(records[0]?.value).toMatchObject({
      kind: 'multipart',
      part: { headers: { 'content-type': 'application/json' }, text: '{"n":1}' },
    });
    expect(records[1]?.value).toMatchObject({
      kind: 'multipart',
      part: { headers: { 'content-type': 'text/plain' }, text: 'hello' },
    });
  });

  test('diagnoses a missing boundary instead of inventing parts', () => {
    const records = decodeOas32SequentialBytes(bytes('not multipart'), 'multipart/mixed');
    expect(records[0]?.diagnostics.map((item) => item.code)).toContain('MULTIPART_BOUNDARY_REQUIRED');
  });
});

describe('unknown media', () => {
  test('retains the original bytes and reports no structured codec', () => {
    const records = decodeOas32SequentialBytes(bytes('{"n":1}'), 'application/json');
    expect(records).toHaveLength(1);
    expect(records[0]?.value.kind).toBe('raw');
    expect(records[0]?.diagnostics.map((item) => item.code)).toContain('CODEC_UNAVAILABLE');
  });
});
