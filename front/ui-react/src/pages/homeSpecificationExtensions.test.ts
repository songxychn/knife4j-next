import { describe, expect, it } from 'vitest';
import { collectSpecificationExtensions } from './homeSpecificationExtensions';

describe('collectSpecificationExtensions', () => {
  it('collects direct scalar x-* fields in source order', () => {
    expect(
      collectSpecificationExtensions({
        name: 'Apache 2.0',
        'x-string': '  application/json  ',
        'x-number': 0,
        'x-boolean': false,
        'x-empty': '   ',
        'x-object': { nested: true },
        'x-array': ['nested'],
        'x-null': null,
        'prefix-x-late': 'ignored',
        'X-uppercase': 'ignored',
      }),
    ).toEqual([
      { key: 'x-string', value: 'application/json' },
      { key: 'x-number', value: '0' },
      { key: 'x-boolean', value: 'false' },
    ]);
  });

  it('ignores non-standard extensions wrapper fields', () => {
    expect(
      collectSpecificationExtensions({
        'x-direct': 'kept',
        extensions: {
          'x-wrapped': 'ignored',
        },
      }),
    ).toEqual([{ key: 'x-direct', value: 'kept' }]);
  });

  it('returns an empty list when the source is absent', () => {
    expect(collectSpecificationExtensions(undefined)).toEqual([]);
  });
});
