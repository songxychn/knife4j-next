import { describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  default: {},
  createContext: () => ({}),
  useCallback: vi.fn(),
  useContext: vi.fn(),
  useEffect: vi.fn(),
  useMemo: vi.fn(),
  useRef: vi.fn(),
  useState: vi.fn(),
}));

import { invalidateSettingsMemoryForReset, type SettingsMemoryState } from './SettingsContext';

describe('settings reset generation', () => {
  it('drops overrides loaded before a cross-tab reset', () => {
    const state: SettingsMemoryState = {
      resetGeneration: 'before-reset',
      resetActive: false,
      overrides: {
        language: 'ja-JP',
        enableHost: true,
        enableHostText: 'https://old.example.com',
      },
    };

    expect(
      invalidateSettingsMemoryForReset(state, {
        generation: 'after-reset',
        active: false,
      }),
    ).toEqual({
      resetGeneration: 'after-reset',
      resetActive: false,
      overrides: {},
    });
  });
});
