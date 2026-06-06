import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, type AppSettings } from '../types/settings';
import { resolveFooterContent } from './footer';

function settings(overrides: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('footer content resolution', () => {
  it('hides footer when enableFooter is false', () => {
    expect(resolveFooterContent(settings({ enableFooter: false }), 'Default footer')).toBeNull();
  });

  it('uses default footer when custom footer is disabled', () => {
    expect(resolveFooterContent(settings({ enableFooter: true, enableFooterCustom: false }), 'Default footer')).toEqual(
      {
        kind: 'default',
        content: 'Default footer',
      },
    );
  });

  it('uses Markdown custom footer when custom content is enabled and non-empty', () => {
    expect(
      resolveFooterContent(
        settings({
          enableFooter: true,
          enableFooterCustom: true,
          footerCustomContent: 'Apache License 2.0 | [Knife4j](https://github.com/songxychn/knife4j-next)',
        }),
        'Default footer',
      ),
    ).toEqual({
      kind: 'custom',
      content: 'Apache License 2.0 | [Knife4j](https://github.com/songxychn/knife4j-next)',
    });
  });

  it('falls back to default footer when custom content is blank', () => {
    expect(
      resolveFooterContent(
        settings({
          enableFooter: true,
          enableFooterCustom: true,
          footerCustomContent: '   ',
        }),
        'Default footer',
      ),
    ).toEqual({
      kind: 'default',
      content: 'Default footer',
    });
  });
});
