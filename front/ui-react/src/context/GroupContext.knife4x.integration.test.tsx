import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SwaggerDoc } from '../types/swagger';
import { GroupProvider, useGroup } from './GroupContext';
import { SettingsProvider, useSettings } from './SettingsContext';

let root: Root;
let container: HTMLDivElement;
let group: ReturnType<typeof useGroup>;
let settings: ReturnType<typeof useSettings>;
let navigate: ReturnType<typeof useNavigate>;

function Probe() {
  group = useGroup();
  settings = useSettings();
  navigate = useNavigate();
  return null;
}

const spec: SwaggerDoc = {
  openapi: '3.0.3',
  info: { title: 'First spec', version: '1' },
  paths: {},
  'x-openapi': {
    'x-setting': { enableDebug: true, language: 'ja-JP' },
    'x-markdownFiles': [{ name: 'Spec docs', children: [{ title: 'Spec guide', content: '# Spec' }] }],
  },
};

async function mount(path = '/') {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <SettingsProvider>
          <GroupProvider>
            <Probe />
          </GroupProvider>
        </SettingsProvider>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, '__KNIFE4X_CONFIG__', {
    configurable: true,
    value: {
      basePath: '/internal',
      specs: [
        { name: 'first', url: 'one.json' },
        { name: 'second', url: 'two.json' },
      ],
      settings: { enableDebug: false, enableSearch: false, language: 'en-US' },
      documents: [{ title: 'Host guide', content: '# Host' }],
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(window, '__KNIFE4X_CONFIG__');
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Knife4x host defaults and named group integration', () => {
  it('keeps raw specs unchanged, merges Markdown and applies local > spec > host > shared defaults', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(spec) });
    vi.stubGlobal('fetch', fetch);
    await mount();
    expect(group.activeGroup.value).toBe('first');
    expect(settings.settings).toMatchObject({
      enableDebug: true,
      enableSearch: false,
      language: 'ja-JP',
      enableOpenApi: true,
    });
    expect(group.swaggerDoc).toEqual(spec);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Accept-Language': expect.stringMatching(/^en-US(?:,|$)/) }),
      }),
    );
    expect(group.markdownDocs.map(({ title }) => title)).toEqual(['Spec guide', 'Host guide']);
    await act(async () => settings.setSetting('enableDebug', false));
    expect(settings.settings.enableDebug).toBe(false);

    const second = { openapi: '3.0.3', info: { title: 'Second spec', version: '1' }, paths: {} };
    fetch.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(second) });
    await act(async () => group.setActiveGroupValue('second'));
    expect(group.swaggerDoc).toEqual(second);
    expect(settings.settings).toMatchObject({ enableDebug: false, language: 'en-US', enableSearch: false });
    expect(group.markdownDocs.map(({ title, key }) => ({ title, key }))).toEqual([
      { title: 'Host guide', key: '/second/markdown/0/0' },
    ]);
    expect(fetch.mock.calls.every(([url]) => String(url).includes('/internal/'))).toBe(true);
  });

  it('honors a direct group route and restores host defaults after a spec failure', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetch);
    await mount('/second/home');
    expect(group.activeGroup.value).toBe('second');
    expect(group.groupError).toBeTruthy();
    expect(group.swaggerDoc).toBeNull();
    expect(group.groups.map(({ value }) => value)).toEqual(['first', 'second']);
    expect(settings.settings).toMatchObject({ enableDebug: false, language: 'en-US' });
    expect(group.markdownDocs.map(({ title }) => title)).toEqual(['Host guide']);
    expect(fetch).toHaveBeenCalledOnce();

    fetch.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(spec) });
    await act(async () => navigate('/first/home'));
    expect(group.activeGroup.value).toBe('first');
    expect(group.swaggerDoc).toEqual(spec);
    expect(group.groupError).toBeNull();
    expect(group.groups.map(({ value }) => value)).toEqual(['first', 'second']);
  });

  it('keeps selectable groups when the first spec fails and recovers through the switcher action', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(spec),
      });
    vi.stubGlobal('fetch', fetch);
    await mount();
    expect(group.groupError).toBeTruthy();
    expect(group.groups.map(({ value }) => value)).toEqual(['first', 'second']);
    await act(async () => group.setActiveGroupValue(group.groups[1].value));
    expect(group.activeGroup.value).toBe('second');
    expect(group.groupError).toBeNull();
    expect(group.swaggerDoc).toEqual(spec);
  });
});
