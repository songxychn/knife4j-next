import { describe, expect, it } from 'vitest';

import { resolveResponseOverviewVisibility } from './responseOverview';

describe('response overview visibility', () => {
  it('shows the complete overview when enabled', () => {
    expect(resolveResponseOverviewVisibility(true, 1)).toEqual({
      showStatusCode: true,
      showDetails: true,
    });
    expect(resolveResponseOverviewVisibility(true, 2)).toEqual({
      showStatusCode: true,
      showDetails: true,
    });
  });

  it('hides the complete overview for a single response when disabled', () => {
    expect(resolveResponseOverviewVisibility(false, 1)).toEqual({
      showStatusCode: false,
      showDetails: false,
    });
  });

  it('keeps only status-code labels to distinguish multiple responses when disabled', () => {
    expect(resolveResponseOverviewVisibility(false, 2)).toEqual({
      showStatusCode: true,
      showDetails: false,
    });
  });
});
