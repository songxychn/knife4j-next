export interface ResponseBodyProgress {
  receivedBytes: number;
  totalBytes: number | null;
}

const UNKNOWN_LENGTH_UPDATE_BYTES = 1024 * 1024;

/** Human-readable byte size, matching Vue2 DebugResponse.vue logic. */
export function formatByteSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const kb = size / 1024;
  const mb = kb / 1024;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  if (kb >= 1) return `${kb.toFixed(2)} KB`;
  return `${size} B`;
}

export async function readResponseBlob(
  response: Response,
  onProgress: (progress: ResponseBodyProgress) => void,
): Promise<Blob> {
  if (!response.body) return response.blob();

  const contentLength = Number(response.headers.get('content-length'));
  const contentEncoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  // CORS exposes Content-Length by default, but may hide Content-Encoding while Fetch returns decoded bytes.
  const hasTrustworthyEncoding =
    contentEncoding === 'identity' || (response.type !== 'cors' && contentEncoding === undefined);
  let totalBytes =
    hasTrustworthyEncoding && Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : null;
  let receivedBytes = 0;
  let reportedBytes = 0;
  let reportedPercent = -1;

  onProgress({ receivedBytes, totalBytes });

  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        if (totalBytes !== null && receivedBytes > totalBytes) {
          totalBytes = null;
        }
        const percent = totalBytes === null ? null : Math.min(99, Math.floor((receivedBytes / totalBytes) * 100));
        if (
          (percent !== null && percent !== reportedPercent) ||
          (percent === null && receivedBytes - reportedBytes >= UNKNOWN_LENGTH_UPDATE_BYTES)
        ) {
          reportedBytes = receivedBytes;
          reportedPercent = percent ?? reportedPercent;
          onProgress({ receivedBytes, totalBytes });
        }
        controller.enqueue(chunk);
      },
    }),
  );
  const contentType = response.headers.get('content-type');
  const blob = await new Response(
    stream,
    contentType ? { headers: { 'Content-Type': contentType } } : undefined,
  ).blob();

  if (receivedBytes !== reportedBytes) {
    onProgress({ receivedBytes, totalBytes });
  }
  return blob;
}
