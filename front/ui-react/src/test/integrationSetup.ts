// React's act() uses this flag to detect tests that can flush effects and updates.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
