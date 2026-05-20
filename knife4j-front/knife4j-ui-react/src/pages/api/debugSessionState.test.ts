import { afterEach, describe, expect, it, vi } from 'vitest';
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

function makeObjectUrlState(objectUrl: string): DebugSessionState {
  return {
    ...makeState(),
    response: {
      ...makeState().response!,
      kind: 'binary',
      rawText: '',
      objectUrl,
    },
  };
}

describe('debugSessionState', () => {
  afterEach(() => {
    clearDebugSessionStatesForTest();
    vi.restoreAllMocks();
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

  it('revokes object URLs when removing response state', () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const key = 'default|Pet|download|GET|/pets/export';

    writeDebugSessionState(key, makeObjectUrlState('blob:http://localhost/download'));
    removeDebugSessionState(key);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/download');
  });

  it('revokes the previous object URL when overwriting with a different response', () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const key = 'default|Pet|download|GET|/pets/export';

    writeDebugSessionState(key, makeObjectUrlState('blob:http://localhost/old'));
    writeDebugSessionState(key, makeObjectUrlState('blob:http://localhost/new'));

    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/old');
    expect(readDebugSessionState(key)?.response?.objectUrl).toBe('blob:http://localhost/new');
  });

  it('does not revoke an object URL when writing the same response URL again', () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const key = 'default|Pet|download|GET|/pets/export';

    writeDebugSessionState(key, makeObjectUrlState('blob:http://localhost/stable'));
    writeDebugSessionState(key, makeObjectUrlState('blob:http://localhost/stable'));

    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('revokes all cached object URLs when clearing session states', () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    writeDebugSessionState('first', makeObjectUrlState('blob:http://localhost/first'));
    writeDebugSessionState('second', makeObjectUrlState('blob:http://localhost/second'));
    clearDebugSessionStatesForTest();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/first');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/second');
    expect(readDebugSessionState('first')).toBeNull();
    expect(readDebugSessionState('second')).toBeNull();
  });
});
