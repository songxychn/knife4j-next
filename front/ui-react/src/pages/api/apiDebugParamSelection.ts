export interface ApiDebugParamSelectionState {
  checked: boolean;
  indeterminate: boolean;
}

export function resolveApiDebugParamSelection(
  paramKeys: readonly string[],
  paramEnabled: Readonly<Record<string, boolean>>,
): ApiDebugParamSelectionState {
  const enabledCount = paramKeys.reduce((count, key) => count + (paramEnabled[key] !== false ? 1 : 0), 0);

  return {
    checked: paramKeys.length > 0 && enabledCount === paramKeys.length,
    indeterminate: enabledCount > 0 && enabledCount < paramKeys.length,
  };
}

export function setApiDebugParamsEnabled(
  current: Readonly<Record<string, boolean>>,
  paramKeys: readonly string[],
  enabled: boolean,
): Record<string, boolean> {
  const next = { ...current };
  for (const key of paramKeys) {
    next[key] = enabled;
  }
  return next;
}
