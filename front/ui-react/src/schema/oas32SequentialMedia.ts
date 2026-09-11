import { getOpenApiSpecificationFeatures } from 'knife4j-core';

export type Oas32SequentialKind = 'sse' | 'jsonl' | 'json-seq' | 'multipart';
export type Oas32SequentialRecordKind = Oas32SequentialKind | 'unknown';

export type Oas32SequentialDiagnosticCode =
  | 'VERSION_NOT_APPLICABLE'
  | 'CODEC_UNAVAILABLE'
  | 'INVALID_UTF8'
  | 'INVALID_JSON'
  | 'INCOMPLETE_RECORD'
  | 'EMPTY_RECORD'
  | 'MULTIPART_BOUNDARY_REQUIRED'
  | 'INVALID_MULTIPART'
  | 'BUDGET_EXCEEDED'
  | 'CANCELLED';

export interface Oas32SequentialDiagnostic {
  readonly code: Oas32SequentialDiagnosticCode;
  readonly severity: 'error' | 'info';
  readonly message: string;
  readonly index?: number;
}

export interface Oas32SseEventValue {
  readonly event: string;
  readonly data: string;
  readonly id?: string;
  readonly retry?: number;
}

export interface Oas32MultipartPartValue {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly text?: string;
}

export type Oas32SequentialValue =
  | { readonly kind: 'sse'; readonly event: Oas32SseEventValue }
  | { readonly kind: 'json'; readonly json: unknown; readonly raw: string }
  | { readonly kind: 'multipart'; readonly part: Oas32MultipartPartValue }
  | { readonly kind: 'raw'; readonly bytes: Uint8Array };

export interface Oas32SequentialRecord {
  readonly index: number;
  readonly complete: boolean;
  readonly value: Oas32SequentialValue;
  readonly diagnostics: readonly Oas32SequentialDiagnostic[];
}

export interface Oas32SequentialLimits {
  readonly maxBytes: number;
  readonly maxItems: number;
  readonly maxRecordCharacters: number;
}

export const OAS32_SEQUENTIAL_LIMITS: Readonly<Oas32SequentialLimits> = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxItems: 256,
  maxRecordCharacters: 32 * 1024,
});

export function isOas32SequentialVersion(version: unknown): boolean {
  return getOpenApiSpecificationFeatures(version)?.family === '3.2';
}

export function classifyOas32SequentialMedia(contentType: string | undefined): Oas32SequentialKind | 'unknown' {
  const essence = (contentType ?? '').split(';', 1)[0].trim().toLowerCase();
  if (essence === 'text/event-stream') return 'sse';
  if (
    essence === 'application/jsonl' ||
    essence === 'application/x-ndjson' ||
    essence === 'application/ndjson' ||
    essence === 'text/ndjson' ||
    essence.endsWith('+jsonl')
  ) {
    return 'jsonl';
  }
  if (essence === 'application/json-seq' || essence.endsWith('+json-seq')) return 'json-seq';
  if (essence.startsWith('multipart/')) return 'multipart';
  return 'unknown';
}

export function sequentialMediaBoundary(contentType: string | undefined): string | undefined {
  const match = /(?:^|;)\s*boundary\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(contentType ?? '');
  if (!match) return undefined;
  const quoted = match[1];
  if (quoted !== undefined) return quoted.replace(/\\(.)/g, '$1');
  return match[2]?.trim();
}

function diagnostic(code: Oas32SequentialDiagnosticCode, message: string, index?: number): Oas32SequentialDiagnostic {
  return { code, severity: 'error', message, ...(index === undefined ? {} : { index }) };
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
  const next = new Uint8Array(left.length + right.length);
  next.set(left);
  next.set(right, left.length);
  return next;
}

function findByte(haystack: Uint8Array, needle: number, start = 0): number {
  for (let index = start; index < haystack.length; index += 1) {
    if (haystack[index] === needle) return index;
  }
  return -1;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, start = 0): number {
  if (needle.length === 0) return start;
  outer: for (let index = start; index <= haystack.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function decodeUtf8(bytes: Uint8Array): { text: string; invalid: boolean } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), invalid: false };
  } catch {
    return { text: new TextDecoder('utf-8').decode(bytes), invalid: true };
  }
}

function clipRecordText(text: string, limits: Oas32SequentialLimits): { text: string; clipped: boolean } {
  if (text.length <= limits.maxRecordCharacters) return { text, clipped: false };
  return { text: text.slice(0, limits.maxRecordCharacters), clipped: true };
}

class LineDecoder {
  private leftover = '';
  private readonly decoder = new TextDecoder('utf-8', { fatal: false });

  push(chunk: Uint8Array): string[] {
    const text = this.leftover + this.decoder.decode(chunk, { stream: true });
    return this.takeLines(text, false);
  }

  flush(): string[] {
    const text = this.leftover + this.decoder.decode();
    return this.takeLines(text, true);
  }

  private takeLines(text: string, flush: boolean): string[] {
    const lines: string[] = [];
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code !== 10 && code !== 13) continue;
      lines.push(text.slice(start, index));
      if (code === 13 && text.charCodeAt(index + 1) === 10) index += 1;
      start = index + 1;
    }
    this.leftover = text.slice(start);
    if (flush && this.leftover.length > 0) {
      lines.push(this.leftover);
      this.leftover = '';
    }
    return lines;
  }
}

export interface Oas32SequentialDecoder {
  readonly kind: Oas32SequentialRecordKind;
  push(chunk: Uint8Array): Oas32SequentialRecord[];
  /** Pass `abort: true` to drop a trailing partial record instead of promoting it to a complete item. */
  flush(abort?: boolean): Oas32SequentialRecord[];
}

class SseDecoder implements Oas32SequentialDecoder {
  readonly kind = 'sse' as const;
  private readonly lines = new LineDecoder();
  private event = '';
  private data: string[] = [];
  private id: string | undefined;
  private retry: number | undefined;
  private index = 0;
  private readonly limits: Oas32SequentialLimits;

  constructor(limits: Oas32SequentialLimits) {
    this.limits = limits;
  }

  push(chunk: Uint8Array): Oas32SequentialRecord[] {
    return this.consume(this.lines.push(chunk), false);
  }

  flush(abort = false): Oas32SequentialRecord[] {
    if (abort) {
      this.event = '';
      this.data = [];
      this.retry = undefined;
      this.lines.flush();
      return [];
    }
    return this.consume(this.lines.flush(), true);
  }

  private consume(lines: readonly string[], flush: boolean): Oas32SequentialRecord[] {
    const records: Oas32SequentialRecord[] = [];
    for (const line of lines) {
      if (line === '') {
        const record = this.dispatch();
        if (record) records.push(record);
        continue;
      }
      if (line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      let value = separator < 0 ? '' : line.slice(separator + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') this.event = value;
      else if (field === 'data') this.data.push(value);
      else if (field === 'id') this.id = value;
      else if (field === 'retry') {
        if (/^\d+$/.test(value)) this.retry = Number(value);
      }
    }
    if (flush) {
      const record = this.dispatch();
      if (record) records.push(record);
    }
    return records;
  }

  private dispatch(): Oas32SequentialRecord | undefined {
    if (this.data.length === 0) {
      this.event = '';
      return undefined;
    }
    const rawData = this.data.join('\n');
    const clipped = clipRecordText(rawData, this.limits);
    const event: Oas32SseEventValue = {
      event: this.event === '' ? 'message' : this.event,
      data: clipped.text,
      ...(this.id === undefined ? {} : { id: this.id }),
      ...(this.retry === undefined ? {} : { retry: this.retry }),
    };
    this.event = '';
    this.data = [];
    this.retry = undefined;
    const record: Oas32SequentialRecord = {
      index: this.index,
      complete: true,
      value: { kind: 'sse', event },
      diagnostics: clipped.clipped
        ? [diagnostic('BUDGET_EXCEEDED', 'An SSE data field exceeded the per-record character budget.', this.index)]
        : [],
    };
    this.index += 1;
    return record;
  }
}

class JsonlDecoder implements Oas32SequentialDecoder {
  readonly kind = 'jsonl' as const;
  private readonly lines = new LineDecoder();
  private index = 0;
  private readonly limits: Oas32SequentialLimits;

  constructor(limits: Oas32SequentialLimits) {
    this.limits = limits;
  }

  push(chunk: Uint8Array): Oas32SequentialRecord[] {
    return this.lines.push(chunk).flatMap((line) => this.recordFromLine(line, true));
  }

  flush(abort = false): Oas32SequentialRecord[] {
    if (abort) {
      this.lines.flush();
      return [];
    }
    return this.lines.flush().flatMap((line) => this.recordFromLine(line, false));
  }

  private recordFromLine(line: string, completeLine: boolean): Oas32SequentialRecord[] {
    if (line === '') return [];
    const clipped = clipRecordText(line, this.limits);
    const index = this.index;
    this.index += 1;
    try {
      return [
        {
          index,
          complete: completeLine,
          value: { kind: 'json', json: JSON.parse(clipped.text) as unknown, raw: clipped.text },
          diagnostics: [
            ...(completeLine
              ? []
              : [diagnostic('INCOMPLETE_RECORD', 'The last JSONL record was not newline-terminated.', index)]),
            ...(clipped.clipped
              ? [diagnostic('BUDGET_EXCEEDED', 'A JSONL record exceeded the per-record character budget.', index)]
              : []),
          ],
        },
      ];
    } catch {
      return [
        {
          index,
          complete: false,
          value: { kind: 'raw', bytes: new TextEncoder().encode(clipped.text) },
          diagnostics: [diagnostic('INVALID_JSON', 'A JSONL record is not valid JSON.', index)],
        },
      ];
    }
  }
}

class JsonSeqDecoder implements Oas32SequentialDecoder {
  readonly kind = 'json-seq' as const;
  private buffer = new Uint8Array(0);
  private index = 0;
  private readonly limits: Oas32SequentialLimits;

  constructor(limits: Oas32SequentialLimits) {
    this.limits = limits;
  }

  push(chunk: Uint8Array): Oas32SequentialRecord[] {
    this.buffer = concatBytes(this.buffer, chunk);
    return this.take(false);
  }

  flush(abort = false): Oas32SequentialRecord[] {
    if (abort) {
      this.buffer = new Uint8Array(0);
      return [];
    }
    return this.take(true);
  }

  private take(flush: boolean): Oas32SequentialRecord[] {
    const records: Oas32SequentialRecord[] = [];
    while (this.buffer.length > 0) {
      const start = findByte(this.buffer, 0x1e);
      if (start < 0) {
        if (flush && this.buffer.length > 0) {
          records.push(
            this.rawRecord(this.buffer, false, [
              diagnostic('INCOMPLETE_RECORD', 'JSON-seq input is missing RS delimiters.'),
            ]),
          );
          this.buffer = new Uint8Array(0);
        }
        break;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);
      const next = findByte(this.buffer, 0x1e, 1);
      if (next < 0 && !flush) break;
      const end = next < 0 ? this.buffer.length : next;
      const payload = this.buffer.subarray(1, end);
      this.buffer = next < 0 ? new Uint8Array(0) : this.buffer.subarray(next);
      records.push(this.jsonRecord(payload, next >= 0 || flush));
    }
    return records;
  }

  private jsonRecord(payload: Uint8Array, complete: boolean): Oas32SequentialRecord {
    let bytes = payload;
    if (bytes.length > 0 && bytes[bytes.length - 1] === 0x0a) bytes = bytes.subarray(0, bytes.length - 1);
    if (bytes.length > 0 && bytes[bytes.length - 1] === 0x0d) bytes = bytes.subarray(0, bytes.length - 1);
    const decoded = decodeUtf8(bytes);
    const clipped = clipRecordText(decoded.text, this.limits);
    const index = this.index;
    this.index += 1;
    if (clipped.text.trim() === '') {
      return {
        index,
        complete,
        value: { kind: 'raw', bytes },
        diagnostics: [diagnostic('EMPTY_RECORD', 'A JSON-seq record is empty.', index)],
      };
    }
    try {
      return {
        index,
        complete,
        value: { kind: 'json', json: JSON.parse(clipped.text) as unknown, raw: clipped.text },
        diagnostics: [
          ...(decoded.invalid ? [diagnostic('INVALID_UTF8', 'A JSON-seq record is not valid UTF-8.', index)] : []),
          ...(clipped.clipped
            ? [diagnostic('BUDGET_EXCEEDED', 'A JSON-seq record exceeded the per-record character budget.', index)]
            : []),
        ],
      };
    } catch {
      return {
        index,
        complete: false,
        value: { kind: 'raw', bytes },
        diagnostics: [diagnostic('INVALID_JSON', 'A JSON-seq record is not valid JSON.', index)],
      };
    }
  }

  private rawRecord(
    bytes: Uint8Array,
    complete: boolean,
    diagnostics: readonly Oas32SequentialDiagnostic[],
  ): Oas32SequentialRecord {
    const index = this.index;
    this.index += 1;
    return { index, complete, value: { kind: 'raw', bytes }, diagnostics };
  }
}

class MultipartDecoder implements Oas32SequentialDecoder {
  readonly kind = 'multipart' as const;
  private buffer = new Uint8Array(0);
  private index = 0;
  private readonly dashBoundary: Uint8Array | undefined;
  private readonly delimiter: Uint8Array | undefined;
  private readonly closeDelimiter: Uint8Array | undefined;
  private closed = false;
  private readonly limits: Oas32SequentialLimits;

  constructor(contentType: string | undefined, limits: Oas32SequentialLimits) {
    this.limits = limits;
    const boundary = sequentialMediaBoundary(contentType);
    if (boundary) {
      this.dashBoundary = new TextEncoder().encode(`--${boundary}`);
      this.delimiter = new TextEncoder().encode(`\r\n--${boundary}`);
      this.closeDelimiter = new TextEncoder().encode(`\r\n--${boundary}--`);
    }
  }

  push(chunk: Uint8Array): Oas32SequentialRecord[] {
    this.buffer = concatBytes(this.buffer, chunk);
    return this.take(false);
  }

  flush(abort = false): Oas32SequentialRecord[] {
    if (abort) {
      this.buffer = new Uint8Array(0);
      return [];
    }
    return this.take(true);
  }

  private take(flush: boolean): Oas32SequentialRecord[] {
    if (!this.dashBoundary || !this.delimiter || !this.closeDelimiter) {
      if (!flush) return [];
      const bytes = this.buffer;
      this.buffer = new Uint8Array(0);
      const index = this.index;
      this.index += 1;
      return [
        {
          index,
          complete: false,
          value: { kind: 'raw', bytes },
          diagnostics: [
            diagnostic('MULTIPART_BOUNDARY_REQUIRED', 'multipart Content-Type is missing a boundary.', index),
          ],
        },
      ];
    }
    const records: Oas32SequentialRecord[] = [];
    const first = indexOfBytes(this.buffer, this.dashBoundary);
    if (first < 0) {
      if (flush && this.buffer.length > 0) {
        records.push(this.invalid(this.buffer, 'The multipart preamble has no boundary.'));
        this.buffer = new Uint8Array(0);
      }
      return records;
    }
    if (first > 0) this.buffer = this.buffer.subarray(first);
    while (!this.closed) {
      const closeAt = indexOfBytes(this.buffer, this.closeDelimiter);
      const nextAt = indexOfBytes(this.buffer, this.delimiter, 1);
      const dashClose = indexOfBytes(this.buffer, concatBytes(this.dashBoundary, new TextEncoder().encode('--')));
      if (this.buffer.length >= this.dashBoundary.length + 2 && dashClose === 0) {
        this.closed = true;
        this.buffer = new Uint8Array(0);
        break;
      }
      if (nextAt < 0 && closeAt < 0 && !flush) break;
      const end = nextAt >= 0 ? nextAt : closeAt >= 0 ? closeAt : this.buffer.length;
      const headerStart = this.dashBoundary.length;
      if (
        this.buffer.length > headerStart + 1 &&
        this.buffer[headerStart] === 13 &&
        this.buffer[headerStart + 1] === 10
      ) {
        records.push(this.part(this.buffer.subarray(headerStart + 2, end), nextAt >= 0 || closeAt >= 0));
      } else if (flush) {
        records.push(this.part(this.buffer.subarray(headerStart, end), false));
      } else break;
      if (nextAt >= 0) {
        this.buffer = this.buffer.subarray(nextAt + 2);
        continue;
      }
      this.closed = closeAt >= 0 || flush;
      this.buffer = new Uint8Array(0);
      break;
    }
    return records;
  }

  private part(body: Uint8Array, complete: boolean): Oas32SequentialRecord {
    const split = indexOfBytes(body, new Uint8Array([13, 10, 13, 10]));
    const headerBytes = split < 0 ? new Uint8Array(0) : body.subarray(0, split);
    const payload = split < 0 ? body : body.subarray(split + 4);
    const headers: Record<string, string> = {};
    const decodedHeaders = decodeUtf8(headerBytes);
    if (!decodedHeaders.invalid) {
      for (const line of decodedHeaders.text.split(/\r\n/)) {
        const separator = line.indexOf(':');
        if (separator < 0) continue;
        headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
      }
    }
    const text = decodeUtf8(payload);
    const clipped = clipRecordText(text.text, this.limits);
    const index = this.index;
    this.index += 1;
    return {
      index,
      complete: complete && split >= 0,
      value: {
        kind: 'multipart',
        part: {
          headers,
          body: payload,
          ...(text.invalid ? {} : { text: clipped.text }),
        },
      },
      diagnostics: [
        ...(split < 0
          ? [diagnostic('INVALID_MULTIPART', 'A multipart part is missing the header delimiter.', index)]
          : []),
        ...(clipped.clipped
          ? [diagnostic('BUDGET_EXCEEDED', 'A multipart part exceeded the per-record character budget.', index)]
          : []),
        ...(complete ? [] : [diagnostic('INCOMPLETE_RECORD', 'The last multipart part was truncated.', index)]),
      ],
    };
  }

  private invalid(bytes: Uint8Array, message: string): Oas32SequentialRecord {
    const index = this.index;
    this.index += 1;
    return {
      index,
      complete: false,
      value: { kind: 'raw', bytes },
      diagnostics: [diagnostic('INVALID_MULTIPART', message, index)],
    };
  }
}

class UnknownDecoder implements Oas32SequentialDecoder {
  readonly kind = 'unknown' as const;
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): Oas32SequentialRecord[] {
    this.buffer = concatBytes(this.buffer, chunk);
    return [];
  }

  flush(abort = false): Oas32SequentialRecord[] {
    const bytes = this.buffer;
    this.buffer = new Uint8Array(0);
    if (abort && bytes.length === 0) return [];
    return [
      {
        index: 0,
        complete: !abort,
        value: { kind: 'raw', bytes },
        diagnostics: [diagnostic('CODEC_UNAVAILABLE', 'This media type has no structured sequential codec.')],
      },
    ];
  }
}

export function createOas32SequentialDecoder(
  contentType: string | undefined,
  limits: Partial<Oas32SequentialLimits> = {},
): Oas32SequentialDecoder {
  const bound: Oas32SequentialLimits = {
    maxBytes: Math.min(limits.maxBytes ?? OAS32_SEQUENTIAL_LIMITS.maxBytes, OAS32_SEQUENTIAL_LIMITS.maxBytes),
    maxItems: Math.min(limits.maxItems ?? OAS32_SEQUENTIAL_LIMITS.maxItems, OAS32_SEQUENTIAL_LIMITS.maxItems),
    maxRecordCharacters: Math.min(
      limits.maxRecordCharacters ?? OAS32_SEQUENTIAL_LIMITS.maxRecordCharacters,
      OAS32_SEQUENTIAL_LIMITS.maxRecordCharacters,
    ),
  };
  const kind = classifyOas32SequentialMedia(contentType);
  if (kind === 'sse') return new SseDecoder(bound);
  if (kind === 'jsonl') return new JsonlDecoder(bound);
  if (kind === 'json-seq') return new JsonSeqDecoder(bound);
  if (kind === 'multipart') return new MultipartDecoder(contentType, bound);
  return new UnknownDecoder();
}

export function decodeOas32SequentialBytes(
  chunks: readonly Uint8Array[],
  contentType: string | undefined,
  limits?: Partial<Oas32SequentialLimits>,
): Oas32SequentialRecord[] {
  const decoder = createOas32SequentialDecoder(contentType, limits);
  const records: Oas32SequentialRecord[] = [];
  for (const chunk of chunks) records.push(...decoder.push(chunk));
  records.push(...decoder.flush());
  return records;
}
