import type { Dispatch, SetStateAction } from 'react';
import {
  consumeOas32SequentialResponse,
  shouldConsumeOas32SequentialResponse,
} from '../../schema/oas32SequentialResponse';
import { classifyOas32SequentialMedia } from '../../schema/oas32SequentialMedia';
import {
  formatSequentialHistoryBody,
  sequentialStreamFromConsumeResult,
  toSequentialDisplayedItem,
  type Oas32SequentialStreamView,
} from '../../schema/oas32SequentialView';
import type { MenuOperation, SwaggerDoc } from '../../types/swagger';
import type { DebugResponsePayload, SseEvent } from './ResponsePanel';
import { abortEntry, completeEntry, type DebugHistoryEntry } from './debugHistory';
import { sendDebugHttpRequest, type DebugHttpRequestOptions } from './debugHttpRequest';
import { interpretResponseBlob } from './debugResponseBody';
import { consumeDebugSse } from './debugSseResponse';
import { readResponseBlob, type ResponseBodyProgress } from './responseBodyProgress';
import { formatSseHistoryResponseBody } from './sseEventTime';

interface DebugResponseUpdates {
  setLoading: (value: boolean) => void;
  setResponseProgress: (value: ResponseBodyProgress | null) => void;
  setResponse: (value: DebugResponsePayload) => void;
  setError: (value: string) => void;
  setSseEvents: Dispatch<SetStateAction<SseEvent[] | null>>;
  setSseStreaming: (value: boolean) => void;
  setSequentialStream: Dispatch<SetStateAction<Oas32SequentialStreamView | null>>;
}

interface ExecuteDebugRequestOptions {
  request: Omit<DebugHttpRequestOptions, 'signal'>;
  swaggerDoc: SwaggerDoc;
  operation: MenuOperation;
  abortRef: { current: AbortController | null };
  isCurrentDebugRequest: () => boolean;
  getSchemaSession: () => Parameters<typeof consumeOas32SequentialResponse>[0]['session'];
  finalizeHistory: (update: (entry: DebugHistoryEntry) => DebugHistoryEntry) => void;
  diagnoseResponse: (response: DebugResponsePayload) => void;
  updates: DebugResponseUpdates;
}

/** Dispatch the validated snapshot and route its payload to the current debug session. */
export async function executeDebugRequest({
  request,
  swaggerDoc,
  operation,
  abortRef,
  isCurrentDebugRequest,
  getSchemaSession,
  finalizeHistory,
  diagnoseResponse,
  updates,
}: ExecuteDebugRequestOptions): Promise<void> {
  const { built } = request;
  const { setLoading, setResponseProgress, setResponse, setError, setSseEvents, setSseStreaming, setSequentialStream } =
    updates;
  const start = Date.now();
  let abortController: AbortController | null = null;
  /** Accumulated SSE payloads for history (mirrors UI events, independent of React state). */
  const sseCollected: SseEvent[] = [];
  try {
    abortController = new AbortController();
    abortRef.current = abortController;

    const res = await sendDebugHttpRequest({ ...request, signal: abortController.signal });
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const contentType = responseHeaders['content-type'] ?? '';
    const durationMs = Date.now() - start;

    if (shouldConsumeOas32SequentialResponse(request.isOas32, contentType)) {
      if (!isCurrentDebugRequest()) {
        finalizeHistory((entry) =>
          completeEntry(entry, {
            status: 'completed',
            httpStatus: res.status,
            statusText: res.statusText,
            durationMs,
            responseBody: '[sequential] superseded by another request',
          }),
        );
        return;
      }
      setLoading(false);
      if (!res.body) {
        finalizeHistory((entry) =>
          completeEntry(entry, {
            status: 'error',
            httpStatus: res.status,
            statusText: res.statusText,
            durationMs,
            errorMessage: 'Sequential response has no body',
          }),
        );
        setError('Sequential response has no body');
        abortRef.current = null;
        setSseStreaming(false);
        return;
      }
      const sequentialKind = classifyOas32SequentialMedia(contentType);
      setSequentialStream({
        kind: sequentialKind,
        streaming: true,
        truncated: false,
        receivedBytes: 0,
        droppedItems: 0,
        completeSchema: { status: 'absent' },
        items: [],
      });
      setSseStreaming(true);
      setResponse({
        status: res.status,
        statusText: res.statusText,
        method: built.method,
        duration: durationMs,
        contentType,
        size: 0,
        headers: responseHeaders,
        rawText: '',
        kind: 'text',
      });
      const displayedItems: ReturnType<typeof toSequentialDisplayedItem>[] = [];
      const schemaSession = getSchemaSession();
      try {
        const sequentialResult = await consumeOas32SequentialResponse({
          response: res,
          contentType,
          document: swaggerDoc,
          operation,
          session: schemaSession,
          signal: abortController.signal,
          onItem: (item) => {
            if (!isCurrentDebugRequest()) return;
            const displayed = toSequentialDisplayedItem(item);
            displayedItems.push(displayed);
            setSequentialStream((previous) => ({
              kind: sequentialKind,
              streaming: true,
              truncated: false,
              receivedBytes: previous?.receivedBytes ?? 0,
              droppedItems: previous?.droppedItems ?? 0,
              completeSchema: { status: 'absent' },
              items: [...(previous?.items ?? []), displayed],
            }));
          },
        });
        const view = sequentialStreamFromConsumeResult(sequentialResult, {
          kind: sequentialKind,
          streaming: false,
          truncated: sequentialResult.truncated,
          receivedBytes: sequentialResult.receivedBytes,
          droppedItems: sequentialResult.droppedItems,
          completeSchema: sequentialResult.completeSchema,
          items: displayedItems,
        });
        const historyBody = formatSequentialHistoryBody(view.items);
        if (sequentialResult.termination === 'cancel') {
          finalizeHistory((entry) => ({
            ...abortEntry(entry, { durationMs: Date.now() - start }),
            isSse: sequentialKind === 'sse',
            httpStatus: res.status,
            statusText: res.statusText,
            responseBody: historyBody || undefined,
          }));
        } else {
          finalizeHistory((entry) =>
            completeEntry(entry, {
              status: sequentialResult.termination === 'eof' ? 'completed' : 'error',
              httpStatus: res.status,
              statusText: res.statusText,
              durationMs: Date.now() - start,
              isSse: sequentialKind === 'sse',
              errorMessage: sequentialResult.termination === 'eof' ? undefined : sequentialResult.termination,
              responseBody: historyBody || undefined,
            }),
          );
        }
        if (!isCurrentDebugRequest()) return;
        setSequentialStream(view);
        setResponse({
          status: res.status,
          statusText: res.statusText,
          method: built.method,
          duration: Date.now() - start,
          contentType,
          size: sequentialResult.receivedBytes,
          headers: responseHeaders,
          rawText: historyBody,
          kind: 'text',
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          finalizeHistory((entry) => ({
            ...abortEntry(entry, { durationMs: Date.now() - start }),
            isSse: sequentialKind === 'sse',
            httpStatus: res.status,
            statusText: res.statusText,
            responseBody: formatSequentialHistoryBody(displayedItems) || undefined,
          }));
          if (!isCurrentDebugRequest()) return;
        } else if (!isCurrentDebugRequest()) {
          finalizeHistory((entry) =>
            completeEntry(entry, {
              status: 'error',
              durationMs: Date.now() - start,
              errorMessage: err instanceof Error ? err.message : String(err),
              responseBody: formatSequentialHistoryBody(displayedItems) || undefined,
            }),
          );
          return;
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          finalizeHistory((entry) =>
            completeEntry(entry, {
              status: 'error',
              httpStatus: res.status,
              statusText: res.statusText,
              durationMs: Date.now() - start,
              errorMessage: msg,
              responseBody: formatSequentialHistoryBody(displayedItems) || undefined,
            }),
          );
          setError(msg);
        }
      } finally {
        if (abortRef.current === abortController) {
          abortRef.current = null;
        }
        setSseStreaming(false);
      }
      return;
    }

    // SSE path: text/event-stream → stream via ReadableStream reader
    if (contentType.toLowerCase().includes('text/event-stream')) {
      if (!isCurrentDebugRequest()) {
        // Still record that SSE started and was superseded.
        finalizeHistory((entry) =>
          completeEntry(entry, {
            status: 'completed',
            httpStatus: res.status,
            statusText: res.statusText,
            durationMs,
            isSse: true,
            responseBody: '[SSE] superseded by another request',
          }),
        );
        return;
      }
      setLoading(false);
      if (!res.body) {
        finalizeHistory((entry) =>
          completeEntry(entry, {
            status: 'error',
            httpStatus: res.status,
            statusText: res.statusText,
            durationMs,
            isSse: true,
            errorMessage: 'SSE response has no body',
          }),
        );
        setError('SSE response has no body');
        abortRef.current = null;
        setSseStreaming(false);
        return;
      }
      setSseEvents([]);
      setSseStreaming(true);
      const sseHistoryBody = () => formatSseHistoryResponseBody(sseCollected);
      try {
        const outcome = await consumeDebugSse(res.body, isCurrentDebugRequest, (data) => {
          const event: SseEvent = { data, timestamp: Date.now() };
          sseCollected.push(event);
          setSseEvents((prev) => [...(prev ?? []), event]);
        });
        if (outcome === 'superseded') {
          finalizeHistory((entry) => ({
            ...abortEntry(entry, { durationMs: Date.now() - start }),
            isSse: true,
            httpStatus: res.status,
            statusText: res.statusText,
            responseBody: sseHistoryBody() || undefined,
          }));
          return;
        }
        finalizeHistory((entry) =>
          completeEntry(entry, {
            status: 'completed',
            httpStatus: res.status,
            statusText: res.statusText,
            durationMs: Date.now() - start,
            isSse: true,
            // Full event payloads (truncated by debugHistory completeEntry if over 64KB).
            responseBody: sseHistoryBody() || undefined,
          }),
        );
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          finalizeHistory((entry) => ({
            ...abortEntry(entry, { durationMs: Date.now() - start }),
            isSse: true,
            httpStatus: res.status,
            statusText: res.statusText,
            // Keep partial stream so history is still useful after cancel.
            responseBody: sseHistoryBody() || undefined,
          }));
          if (!isCurrentDebugRequest()) {
            return;
          }
          // user aborted — not an error
        } else if (!isCurrentDebugRequest()) {
          finalizeHistory((entry) =>
            completeEntry(entry, {
              status: 'error',
              durationMs: Date.now() - start,
              isSse: true,
              errorMessage: err instanceof Error ? err.message : String(err),
              responseBody: sseHistoryBody() || undefined,
            }),
          );
          return;
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          finalizeHistory((entry) =>
            completeEntry(entry, {
              status: 'error',
              httpStatus: res.status,
              statusText: res.statusText,
              durationMs: Date.now() - start,
              isSse: true,
              errorMessage: msg,
              responseBody: sseHistoryBody() || undefined,
            }),
          );
          setError(msg);
        }
      } finally {
        if (abortRef.current === abortController) {
          abortRef.current = null;
        }
        setSseStreaming(false);
      }
      return;
    }

    // Non-SSE path: read once as blob so we can branch by content-type without draining the stream twice.
    const blob = await readResponseBlob(res, (progress) => {
      if (isCurrentDebugRequest()) setResponseProgress(progress);
    });
    const blobContentType = contentType || blob.type;
    const contentDisposition = responseHeaders['content-disposition'];
    const { kind, rawText, objectUrl, filename } = await interpretResponseBlob(
      blob,
      blobContentType,
      built.url,
      contentDisposition,
    );

    finalizeHistory((entry) =>
      completeEntry(entry, {
        status: 'completed',
        httpStatus: res.status,
        statusText: res.statusText,
        durationMs: Date.now() - start,
        responseBody: rawText,
      }),
    );

    if (!isCurrentDebugRequest()) {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      return;
    }

    const completedResponse: DebugResponsePayload = {
      status: res.status,
      statusText: res.statusText,
      method: built.method,
      duration: Date.now() - start,
      contentType: blobContentType,
      size: blob.size,
      headers: responseHeaders,
      rawText,
      objectUrl,
      filename,
      kind,
    };
    setResponse(completedResponse);

    diagnoseResponse(completedResponse);
  } catch (reason: unknown) {
    if (reason instanceof Error && reason.name === 'AbortError') {
      finalizeHistory((entry) => abortEntry(entry, { durationMs: Date.now() - start }));
      if (!isCurrentDebugRequest()) return;
    } else {
      const msg = reason instanceof Error ? reason.message : String(reason);
      finalizeHistory((entry) =>
        completeEntry(entry, {
          status: 'error',
          durationMs: Date.now() - start,
          errorMessage: msg,
        }),
      );
      if (!isCurrentDebugRequest()) return;
      setError(msg);
    }
  } finally {
    if (isCurrentDebugRequest()) {
      setLoading(false);
      setResponseProgress(null);
    }
    if (abortRef.current === abortController) {
      abortRef.current = null;
    }
  }
}
