import type { AppSettings } from '../types/settings';

export type ResolvedFooterContent =
  | {
      kind: 'default';
      content: string;
    }
  | {
      kind: 'custom';
      content: string;
    };

export function resolveFooterContent(settings: AppSettings, defaultContent: string): ResolvedFooterContent | null {
  if (!settings.enableFooter) return null;

  if (settings.enableFooterCustom && settings.footerCustomContent.trim()) {
    return {
      kind: 'custom',
      content: settings.footerCustomContent,
    };
  }

  return {
    kind: 'default',
    content: defaultContent,
  };
}
