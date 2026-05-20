import type { BuiltRequest } from 'knife4j-core';
import type { DebugResponsePayload, SseEvent } from './ResponsePanel';

export interface DebugSessionState {
  response: DebugResponsePayload | null;
  error: string | null;
  builtRequest: BuiltRequest | null;
  sseEvents: SseEvent[] | null;
}

const debugSessionStates = new Map<string, DebugSessionState>();

export function readDebugSessionState(cacheKey: string): DebugSessionState | null {
  return debugSessionStates.get(cacheKey) ?? null;
}

export function writeDebugSessionState(cacheKey: string, state: DebugSessionState): void {
  debugSessionStates.set(cacheKey, state);
}

export function removeDebugSessionState(cacheKey: string): void {
  debugSessionStates.delete(cacheKey);
}

export function clearDebugSessionStatesForTest(): void {
  debugSessionStates.clear();
}
