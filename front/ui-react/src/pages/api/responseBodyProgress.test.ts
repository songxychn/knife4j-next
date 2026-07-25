import { describe, expect, it } from 'vitest';
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
    await readResponseBlob(
      responseFrom(['hello world'], {
        'Content-Length': '11',
        'Content-Encoding': 'gzip',
      }),
      (value) => progress.push(value),
    );

    expect(progress).toEqual([
      { receivedBytes: 0, totalBytes: null },
      { receivedBytes: 11, totalBytes: null },
    ]);
  });

  it('does not trust a CORS content length when content encoding is hidden', async () => {
    const progress: ResponseBodyProgress[] = [];
    const response = responseFrom(['hello world'], { 'Content-Length': '11' });
    Object.defineProperty(response, 'type', { value: 'cors' });

    await readResponseBlob(response, (value) => progress.push(value));

    expect(progress[0]).toEqual({ receivedBytes: 0, totalBytes: null });
  });
});
