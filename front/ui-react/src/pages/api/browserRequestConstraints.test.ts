import { describe, expect, it } from 'vitest';
import { browserRequestConstraint } from './browserRequestConstraints';

describe('browserRequestConstraint', () => {
  it('reports Fetch-forbidden TRACE even without a request body', () => {
    expect(browserRequestConstraint('TRACE', false)).toBe('unsupported-method');
  });

  it('reports GET and HEAD bodies while allowing ordinary requests', () => {
    expect(browserRequestConstraint('GET', true)).toBe('unsupported-body');
    expect(browserRequestConstraint('HEAD', true)).toBe('unsupported-body');
    expect(browserRequestConstraint('POST', true)).toBeNull();
  });
});
