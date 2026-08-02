import type { BuiltRequest, DebugFormValues } from 'knife4j-core';

export interface RequestPreviewBuild {
  formValues: DebugFormValues;
  built: BuiltRequest;
  curl: string;
}

export type RequestPreviewBuildResult = { ok: true; value: RequestPreviewBuild } | { ok: false; error: string };

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
