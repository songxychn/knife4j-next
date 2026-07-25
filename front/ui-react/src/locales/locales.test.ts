import { describe, expect, it } from 'vitest';

import enUS from './en-US';
import jaJP from './ja-JP';
import zhCN from './zh-CN';

const resources = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ja-JP': jaJP,
} as const;

function interpolationVariables(value: string): string[] {
  return Array.from(value.matchAll(/{{\s*([^},\s]+).*?}}/g), (match) => match[1]).sort();
}

describe('locale resources', () => {
  const sourceKeys = Object.keys(zhCN).sort();

  it.each(Object.entries(resources))('%s has the complete, non-empty key set', (_language, resource) => {
    expect(Object.keys(resource).sort()).toEqual(sourceKeys);
    expect(Object.values(resource).every((value) => value.trim().length > 0)).toBe(true);
  });

  it.each(Object.entries(resources))('%s preserves interpolation variables', (_language, resource) => {
    sourceKeys.forEach((key) => {
      expect(interpolationVariables(resource[key as keyof typeof resource])).toEqual(
        interpolationVariables(zhCN[key as keyof typeof zhCN]),
      );
    });
  });
});
