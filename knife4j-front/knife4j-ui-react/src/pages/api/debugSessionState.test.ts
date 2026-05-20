import { afterEach, describe, expect, it } from 'vitest';
import {
  clearDebugSessionStatesForTest,
  readDebugSessionState,
  removeDebugSessionState,
  writeDebugSessionState,
  type DebugSessionState,
} from './debugSessionState';

function makeState(): DebugSessionState {
  return {
    response: {
      status: 200,
      statusText: 'OK',
      method: 'GET',
      duration: 12,
      contentType: 'application/json',
      size: 13,
      headers: { 'content-type': 'application/json' },
      rawText: '{"ok":true}',
      kind: 'json',
    },
    error: null,
    builtRequest: {
      url: 'http://localhost:8080/pets',
      method: 'GET',
      headers: {},
    },
    sseEvents: null,
  };
}

describe('debugSessionState', () => {
  afterEach(() => {
    clearDebugSessionStatesForTest();
  });

  it('keeps response state isolated by operation cache key', () => {
    const firstKey = 'default|Pet|list|GET|/pets';
    const secondKey = 'default|Pet|create|POST|/pets';
    const firstState = makeState();
    const secondState = {
      ...makeState(),
      response: { ...makeState().response!, status: 201, method: 'POST' },
    };

    writeDebugSessionState(firstKey, firstState);
    writeDebugSessionState(secondKey, secondState);

    expect(readDebugSessionState(firstKey)).toEqual(firstState);
    expect(readDebugSessionState(secondKey)).toEqual(secondState);
  });

  it('removes stale response state for one operation only', () => {
    const firstKey = 'default|Pet|list|GET|/pets';
    const secondKey = 'default|Pet|create|POST|/pets';

    writeDebugSessionState(firstKey, makeState());
    writeDebugSessionState(secondKey, makeState());
    removeDebugSessionState(firstKey);

    expect(readDebugSessionState(firstKey)).toBeNull();
    expect(readDebugSessionState(secondKey)).not.toBeNull();
  });
});
