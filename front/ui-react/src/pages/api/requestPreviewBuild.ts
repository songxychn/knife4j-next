import { buildCurl, OAS32_MULTIPART_CURL_BODY_FILE, type BuiltRequest, type DebugFormValues } from 'knife4j-core';
import type { MaterializedMultipartBody } from './formBodyRequest';
import type { CookieParameterSource } from './cookieParameterSource';

export interface RequestPreviewBuild {
  formValues: DebugFormValues;
  built: BuiltRequest;
  curl: string;
  cookieParameterSource?: CookieParameterSource;
  credentials?: 'same-origin' | 'include';
  materializedMultipart?: MaterializedMultipartBody;
}

export type RequestPreviewBuildResult = { ok: true; value: RequestPreviewBuild } | { ok: false; error: string };

export function formatRequestPreviewBody(raw: string, contentType: string, preserveText = false): string {
  if (preserveText || !contentType.includes('json')) return raw;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

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

/** Bind send/cURL to the currently displayed preview instead of rematerializing. */
export function resolveSendPreview(
  prepared: RequestPreviewBuild | undefined,
  displayed: RequestPreviewBuildResult | null,
  rebuild: () => RequestPreviewBuild,
): RequestPreviewBuildResult {
  if (prepared) return { ok: true, value: prepared };
  if (displayed) return displayed;
  return buildRequestPreviewSafely(rebuild);
}

export function triggerMultipartBodyDownload(body: Blob, fileName: string = OAS32_MULTIPART_CURL_BODY_FILE): void {
  const url = URL.createObjectURL(body);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
