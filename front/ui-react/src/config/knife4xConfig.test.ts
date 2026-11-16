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
      expect(result.error.key).toMatch(/^error\.knife4x\./);
    }
  });

  it('resolves named specs in order and retains only supported UI defaults and Markdown content', () => {
    const result = readKnife4xBootstrap(
      host({
        basePath: '/internal',
        specs: [
          { name: ' 用户中心 ', url: 'user.json' },
          { name: 'billing', url: '/billing/openapi.json' },
          { name: 'remote', url: 'https://api.example.net/openapi.json' },
        ],
        settings: { language: 'en-US', enableDebug: false, enableVersion: true, unknown: true },
        documents: [{ title: ' 接入指南 ', content: '# Welcome\n<script>unsafe()</script>' }],
      }),
    );
    expect(result).toEqual({
      mode: 'embed',
      config: {
        basePath: '/internal',
        specs: [
          { name: '用户中心', url: 'https://example.com/internal/user.json' },
          { name: 'billing', url: 'https://example.com/billing/openapi.json' },
          { name: 'remote', url: 'https://api.example.net/openapi.json' },
        ],
        settings: { language: 'en-US', enableDebug: false, enableVersion: true },
        documents: [{ title: '接入指南', content: '# Welcome\n<script>unsafe()</script>' }],
      },
    });
  });

  it.each([
    { specs: [] },
    { specs: {} },
    { specUrl: '/openapi.json', specs: [{ name: 'one', url: '/one.json' }] },
    { specs: [{ name: '', url: '/one.json' }] },
    { specs: [{ name: 'one/two', url: '/one.json' }] },
    { specs: [{ name: 'one#two', url: '/one.json' }] },
    { specs: [{ name: '%41', url: '/one.json' }] },
    { specs: [{ name: '..', url: '/one.json' }] },
    { specs: [{ name: 'group', url: '/one.json' }] },
    {
      specs: [
        { name: 'one', url: '/one.json' },
        { name: ' one ', url: '/two.json' },
      ],
    },
    { specs: [{ name: 'one', url: '//evil.example/spec.json' }] },
    { specs: [{ name: 'one', url: 'javascript:alert(1)' }] },
    { specs: [{ name: 'one', url: 'https://user:secret@example.com/spec.json' }] },
    { specs: [{ name: 'one', url: '\\\\evil.example/spec.json' }] },
    { specs: [null] },
    { specUrl: '/openapi.json', settings: [] },
    { specUrl: '/openapi.json', documents: [{ title: 'No content' }] },
    { specUrl: '/openapi.json', documents: [{ title: ' ', content: '' }] },
  ])('rejects malformed new bootstrap configuration: %j', (config) => {
    expect(readKnife4xBootstrap(host({ basePath: '/', ...config })).mode).toBe('error');
  });
});
