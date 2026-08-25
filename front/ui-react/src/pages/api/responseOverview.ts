export interface ResponseOverviewVisibility {
  showStatusCode: boolean;
  showDetails: boolean;
}

/**
 * A disabled overview hides every summary detail. Multiple responses retain
 * only their status-code labels so the complete structures remain distinct.
 */
export function resolveResponseOverviewVisibility(
  enableResponseCode: boolean,
  responseCount: number,
): ResponseOverviewVisibility {
  return {
    showStatusCode: enableResponseCode || responseCount > 1,
    showDetails: enableResponseCode,
  };
}
