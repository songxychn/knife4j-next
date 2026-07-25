import { describe, expect, it } from 'vitest';

import { readKnife4xBootstrap } from './knife4xConfig';

function host(config: unknown, origin = 'https://example.com') {
  return {
    location: { origin },
    __KNIFE4X_CONFIG__: config,
  };
}

describe('readKnife4xBootstrap', () => {
  it('keeps Java discovery when the global config is absent', () => {
    expect(readKnife4xBootstrap({ location: { origin: 'https://example.com' } })).toEqual({ mode: 'java' });
  });

  it('ignores a config inherited from the prototype', () => {
    const inherited = Object.create({
      __KNIFE4X_CONFIG__: { specUrl: '/openapi.json', basePath: '/docs' },
    }) as { location: { origin: string } };
    inherited.location = { origin: 'https://example.com' };

    expect(readKnife4xBootstrap(inherited)).toEqual({ mode: 'java' });
  });

  it('resolves root-relative spec URLs against the current origin', () => {
    expect(readKnife4xBootstrap(host({ specUrl: '/openapi.json', basePath: '/docs/' }))).toEqual({
      mode: 'embed',
      config: {
        specUrl: 'https://example.com/openapi.json',
        basePath: '/docs',
      },
    });
  });

  it('resolves path-relative spec URLs under the normalized basePath', () => {
    expect(readKnife4xBootstrap(host({ specUrl: 'openapi.json', basePath: 'nested/docs/' }))).toEqual({
      mode: 'embed',
      config: {
        specUrl: 'https://example.com/nested/docs/openapi.json',
        basePath: '/nested/docs',
      },
    });
  });

  it('keeps complete HTTP URLs and supports a root basePath', () => {
    expect(
      readKnife4xBootstrap(
        host({
          specUrl: 'https://api.example.net/openapi.json',
          basePath: '/',
        }),
      ),
    ).toEqual({
      mode: 'embed',
      config: {
        specUrl: 'https://api.example.net/openapi.json',
        basePath: '/',
      },
    });
  });

  it.each([
    ['undefined config', undefined],
    ['null config', null],
    ['missing fields', {}],
    ['empty specUrl', { specUrl: '', basePath: '/docs' }],
    ['empty basePath', { specUrl: '/openapi.json', basePath: '' }],
    ['absolute basePath', { specUrl: '/openapi.json', basePath: 'https://example.com/docs' }],
    ['protocol-relative specUrl', { specUrl: '//api.example.net/openapi.json', basePath: '/docs' }],
    ['non-HTTP specUrl', { specUrl: 'data:application/json,{}', basePath: '/docs' }],
  ])('fails closed for $0', (_name, config) => {
    const result = readKnife4xBootstrap(host(config));

    expect(result.mode).toBe('error');
    if (result.mode === 'error') {
      expect(result.error).toContain('Knife4x 启动配置错误');
    }
  });
});
