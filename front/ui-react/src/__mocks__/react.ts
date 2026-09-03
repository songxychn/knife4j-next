const createContext = (defaultValue: unknown) => ({
  Provider: ({ children }: { children?: unknown }) => children ?? null,
  Consumer: () => null,
  _defaultValue: defaultValue,
});

module.exports = {
  default: {},
  createContext,
  createElement: () => null,
  useCallback: (callback: unknown) => callback,
  useContext: (context: { _defaultValue?: unknown }) => context?._defaultValue,
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [typeof value === 'function' ? value() : value, () => {}],
};
