import { describe, expect, it } from 'vitest';
import { KNIFE4J_STORAGE_KEYS } from '../../storage/knife4jStorage';
import {
  DEBUG_PANEL_MAX_HEIGHT,
  DEBUG_PANEL_MIN_HEIGHT,
  clampDebugPanelHeight,
  readDebugPanelLayout,
  writeDebugPanelLayout,
} from './debugPanelLayout';

function createMemoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe('debugPanelLayout', () => {
  it('persists clamped request and response heights and removes the key when cleared', () => {
    const storage = createMemoryStorage();
    expect(readDebugPanelLayout(storage)).toEqual({});

    writeDebugPanelLayout({ requestBodyHeight: 540.4, responseBodyHeight: 920.6 }, storage);
    expect(readDebugPanelLayout(storage)).toEqual({ requestBodyHeight: 540, responseBodyHeight: 921 });

    writeDebugPanelLayout({ requestBodyHeight: 10, responseBodyHeight: 9999 }, storage);
    expect(readDebugPanelLayout(storage)).toEqual({
      requestBodyHeight: DEBUG_PANEL_MIN_HEIGHT,
      responseBodyHeight: DEBUG_PANEL_MAX_HEIGHT,
    });

    writeDebugPanelLayout({}, storage);
    expect(storage.getItem(KNIFE4J_STORAGE_KEYS.debugPanelLayout)).toBeNull();
    expect(readDebugPanelLayout(storage)).toEqual({});
  });

  it('ignores malformed, non-numeric, or unavailable storage payloads', () => {
    const storage = createMemoryStorage();
    storage.setItem(KNIFE4J_STORAGE_KEYS.debugPanelLayout, '{not-json');
    expect(readDebugPanelLayout(storage)).toEqual({});

    storage.setItem(
      KNIFE4J_STORAGE_KEYS.debugPanelLayout,
      JSON.stringify({ requestBodyHeight: 'tall', responseBodyHeight: 640 }),
    );
    expect(readDebugPanelLayout(storage)).toEqual({ responseBodyHeight: 640 });
    expect(readDebugPanelLayout(null)).toEqual({});
    expect(() => writeDebugPanelLayout({ responseBodyHeight: 500 }, null)).not.toThrow();
    expect(clampDebugPanelHeight(42)).toBe(DEBUG_PANEL_MIN_HEIGHT);
  });
});
