const createContext = (defaultValue: unknown) => ({
  Provider: ({ children }: { children?: unknown }) => children ?? null,
  Consumer: () => null,
  _defaultValue: defaultValue,
});

let nextId = 0;

module.exports = {
  default: {},
  createContext,
  createElement: () => null,
  forwardRef: (render: (props: Record<string, unknown>, ref: unknown) => unknown) => (props: Record<string, unknown>) =>
    render(props, props.ref ?? null),
  useCallback: (callback: unknown) => callback,
  useContext: (context: { _defaultValue?: unknown }) => context?._defaultValue,
  useEffect: () => {},
  useId: () => `mock-${nextId++}`,
  useMemo: (factory: () => unknown) => factory(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [typeof value === 'function' ? value() : value, () => {}],
};
