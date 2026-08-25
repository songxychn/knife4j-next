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

import {
  invalidateSettingsMemoryForReset,
  reconcileSettingsMemoryForReset,
  type SettingsMemoryState,
} from './SettingsContext';

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

  it('reloads overrides that survived when an active reset ends in failure', () => {
    const activeState: SettingsMemoryState = {
      resetGeneration: 'failed-reset',
      resetActive: true,
      overrides: {},
    };
    const survivingOverrides = {
      language: 'ja-JP' as const,
      enableHost: true,
      enableHostText: 'https://survived.example.com',
    };

    expect(
      reconcileSettingsMemoryForReset(
        activeState,
        { generation: 'failed-reset', active: false },
        () => survivingOverrides,
      ),
    ).toEqual({
      resetGeneration: 'failed-reset',
      resetActive: false,
      overrides: survivingOverrides,
    });
  });
});
