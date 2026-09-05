export type CookieParameterSource = 'browser-session' | 'explicit';

/** Missing values belong to pre-session cache/history entries; callers preserve their explicit mode. */
export function readCookieParameterSource(value: unknown): CookieParameterSource | undefined {
  return value === 'browser-session' || value === 'explicit' ? value : undefined;
}

export function effectiveCookieParameterSource(
  isOas31: boolean,
  source: CookieParameterSource | undefined,
): CookieParameterSource {
  return isOas31 && source === 'browser-session' ? 'browser-session' : 'explicit';
}

export function hasExplicitCookieHeader(headers: Readonly<Record<string, string>>): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === 'cookie');
}
