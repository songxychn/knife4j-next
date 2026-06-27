const LANGUAGE_TAG_PATTERN = /^[A-Za-z0-9*]+(?:-[A-Za-z0-9*]+)*$/;

function normalizeLanguageTag(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !LANGUAGE_TAG_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function getBrowserLanguages(): string[] {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return [...navigator.languages];
  }
  return navigator.language ? [navigator.language] : [];
}

function qualityValue(index: number): string {
  return Math.max(1 - index * 0.1, 0.1).toFixed(1);
}

export function buildAcceptLanguageHeader(
  preferredLanguage: string | undefined,
  browserLanguages: readonly string[] = getBrowserLanguages(),
): string | undefined {
  const preferred = preferredLanguage ? normalizeLanguageTag(preferredLanguage) : null;
  if (!preferred) return undefined;

  const seen = new Set<string>();
  const languages: string[] = [];
  const addLanguage = (language: string | null) => {
    if (!language) return;
    const key = language.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    languages.push(language);
  };

  addLanguage(preferred);
  browserLanguages.forEach((language) => addLanguage(normalizeLanguageTag(language)));

  return languages
    .map((language, index) => (index === 0 ? language : `${language};q=${qualityValue(index)}`))
    .join(',');
}

export function createLanguageAwareRequestInit(preferredLanguage?: string): RequestInit | undefined {
  const acceptLanguage = buildAcceptLanguageHeader(preferredLanguage);
  if (!acceptLanguage) return undefined;
  return {
    headers: {
      'Accept-Language': acceptLanguage,
    },
  };
}

export function fetchWithAcceptLanguage(input: RequestInfo | URL, preferredLanguage?: string): Promise<Response> {
  const init = createLanguageAwareRequestInit(preferredLanguage);
  return init ? fetch(input, init) : fetch(input);
}
