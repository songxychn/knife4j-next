import type { BuiltRequest } from 'knife4j-core';
import type { DebugResponsePayload, SseEvent } from './ResponsePanel';

export interface DebugSessionState {
  response: DebugResponsePayload | null;
  error: string | null;
  builtRequest: BuiltRequest | null;
  sseEvents: SseEvent[] | null;
}

const debugSessionStates = new Map<string, DebugSessionState>();

function revokeResponseObjectUrl(response: DebugResponsePayload | null | undefined): void {
  const objectUrl = response?.objectUrl;
  if (!objectUrl) return;
  try {
    globalThis.URL?.revokeObjectURL?.(objectUrl);
  } catch {
    // Best effort only: failing to revoke must not break tab state cleanup.
  }
}

function revokeSessionObjectUrl(state: DebugSessionState | null | undefined): void {
  revokeResponseObjectUrl(state?.response);
}

export function readDebugSessionState(cacheKey: string): DebugSessionState | null {
  return debugSessionStates.get(cacheKey) ?? null;
}

export function writeDebugSessionState(cacheKey: string, state: DebugSessionState): void {
  const previousState = debugSessionStates.get(cacheKey);
  if (previousState?.response?.objectUrl !== state.response?.objectUrl) {
    revokeSessionObjectUrl(previousState);
  }
  debugSessionStates.set(cacheKey, state);
}

export function removeDebugSessionState(cacheKey: string): void {
  revokeSessionObjectUrl(debugSessionStates.get(cacheKey));
  debugSessionStates.delete(cacheKey);
}

export function clearDebugSessionStatesForTest(): void {
  debugSessionStates.forEach((state) => revokeSessionObjectUrl(state));
  debugSessionStates.clear();
}
