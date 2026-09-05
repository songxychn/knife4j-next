import { buildCurl, type BuiltRequest, type DebugFormValues } from 'knife4j-core';
import type { CookieParameterSource } from './cookieParameterSource';

export interface RequestPreviewBuild {
  formValues: DebugFormValues;
  built: BuiltRequest;
  curl: string;
  cookieParameterSource?: CookieParameterSource;
  credentials?: 'same-origin' | 'include';
}

export type RequestPreviewBuildResult = { ok: true; value: RequestPreviewBuild } | { ok: false; error: string };

export function buildPreviewCurl(built: BuiltRequest, source: CookieParameterSource, sessionNote: string): string {
  const curl = buildCurl(built);
  return source === 'browser-session' ? `# ${sessionNote}\n${curl}` : curl;
}

/** Keep unsupported OpenAPI serialization settings visible without crashing the debug page. */
export function buildRequestPreviewSafely(build: () => RequestPreviewBuild): RequestPreviewBuildResult {
  try {
    return { ok: true, value: build() };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
