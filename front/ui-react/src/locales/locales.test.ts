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

  it('uses unified global parameter naming across zh-CN, en-US, and ja-JP', () => {
    expect(zhCN['globalParam.title']).toBe('全局参数');
    expect(zhCN['settings.tab.globalParam']).toBe('全局参数');
    expect(zhCN['apiDebug.globalParams.title']).toBe('已继承的全局参数');
    expect(zhCN['apiDebug.customHeaders.title']).toBe('本接口自定义请求头');
    expect(zhCN['apiDebug.customQuery.title']).toBe('本接口自定义 Query 参数');
    expect(zhCN['apiDebug.customCookie.title']).toBe('本接口自定义 Cookie');

    expect(enUS['globalParam.title']).toBe('Global Parameters');
    expect(enUS['settings.tab.globalParam']).toBe('Global Parameters');
    expect(enUS['apiDebug.globalParams.title']).toBe('Inherited Global Parameters');

    expect(jaJP['globalParam.title']).toBe('グローバルパラメータ');
    expect(jaJP['settings.tab.globalParam']).toBe('グローバルパラメータ');
    expect(jaJP['apiDebug.globalParams.title']).toBe('継承されたグローバルパラメータ');
  });
});
