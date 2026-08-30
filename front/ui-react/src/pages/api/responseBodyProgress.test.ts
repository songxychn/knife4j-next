import { afterEach, describe, expect, it, vi } from 'vitest';
import { readResponseBlob, type ResponseBodyProgress } from './responseBodyProgress';

function responseFrom(chunks: string[], headers: Record<string, string> = {}) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
    { headers },
  );
}

describe('readResponseBlob', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports received bytes against a known content length', async () => {
    const progress: ResponseBodyProgress[] = [];
    const blob = await readResponseBlob(
      responseFrom(['hello', ' world'], {
        'Content-Length': '11',
        'Content-Type': 'text/plain',
      }),
      (value) => progress.push(value),
    );

    expect(await blob.text()).toBe('hello world');
    expect(blob.type).toBe('text/plain');
    expect(progress[0]).toEqual({ receivedBytes: 0, totalBytes: 11 });
    expect(progress.at(-1)).toEqual({ receivedBytes: 11, totalBytes: 11 });
  });

  it('falls back to received bytes when the transfer length is unknown', async () => {
    const progress: ResponseBodyProgress[] = [];
    const blob = await readResponseBlob(
      responseFrom(['hello world'], {
        'Content-Length': '11',
        'Content-Encoding': 'gzip',
        'Content-Type': 'application/json',
      }),
      (value) => progress.push(value),
    );

    expect(blob.type).toBe('application/json');
    expect(progress).toEqual([
      { receivedBytes: 0, totalBytes: null },
      { receivedBytes: 11, totalBytes: null },
    ]);
  });

  it('updates unknown-length progress before receiving one MiB', async () => {
    const progress: ResponseBodyProgress[] = [];
    await readResponseBlob(responseFrom(['a'.repeat(64 * 1024), 'b'.repeat(64 * 1024)]), (value) =>
      progress.push(value),
    );

    expect(progress).toEqual([
      { receivedBytes: 0, totalBytes: null },
      { receivedBytes: 64 * 1024, totalBytes: null },
      { receivedBytes: 128 * 1024, totalBytes: null },
    ]);
  });

  it('falls back to response.blob when TransformStream is unavailable', async () => {
    vi.stubGlobal('TransformStream', undefined);
    const progress: ResponseBodyProgress[] = [];

    const blob = await readResponseBlob(responseFrom(['hello world'], { 'Content-Type': 'text/plain' }), (value) =>
      progress.push(value),
    );

    expect(await blob.text()).toBe('hello world');
    expect(blob.type).toBe('text/plain');
    expect(progress).toEqual([
      { receivedBytes: 0, totalBytes: null },
      { receivedBytes: 11, totalBytes: null },
    ]);
  });

  it('does not trust a CORS content length when content encoding is hidden', async () => {
    const progress: ResponseBodyProgress[] = [];
    const response = responseFrom(['hello world'], {
      'Content-Length': '11',
      'Content-Type': 'text/plain; charset=UTF-8',
    });
    Object.defineProperty(response, 'type', { value: 'cors' });

    const blob = await readResponseBlob(response, (value) => progress.push(value));

    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(progress[0]).toEqual({ receivedBytes: 0, totalBytes: null });
  });
});
