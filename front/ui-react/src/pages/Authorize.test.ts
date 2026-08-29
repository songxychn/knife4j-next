import { describe, expect, it, vi } from 'vitest';

vi.mock('antd', () => ({
  Alert: () => null,
  Button: () => null,
  Card: () => null,
  Collapse: () => null,
  Input: Object.assign(() => null, { Password: () => null }),
  message: { error: vi.fn(), success: vi.fn() },
  Space: () => null,
  Spin: () => null,
  Tag: () => null,
  Typography: { Text: () => null },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../context/GroupContext', () => ({
  useGroup: vi.fn(),
}));

import { createAuthAsyncCommitGuard, getAuthFormDraft, securitySchemeUiKind } from './Authorize';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('Authorize async commit guard', () => {
  it('drops a group A popup result after its component is unmounted', async () => {
    const popup = deferred<string>();
    const saves: string[] = [];
    const guard = createAuthAsyncCommitGuard();
    const deactivate = guard.activate();
    const token = guard.begin();
    const completion = popup.promise.then((accessToken) => {
      if (guard.isCurrent(token)) saves.push(accessToken);
    });

    deactivate();
    popup.resolve('late-group-a-token');
    await completion;

    expect(saves).toEqual([]);
  });

  it('allows only the latest operation in the active component generation', () => {
    const guard = createAuthAsyncCommitGuard();
    guard.activate();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });
});

describe('Authorize persisted-value projection', () => {
  it('projects every form secret to an empty draft after remove or clear', () => {
    expect(getAuthFormDraft(undefined)).toEqual({
      apiKey: '',
      bearerToken: '',
      basicUsername: '',
      basicPassword: '',
      oauth2AccessToken: '',
    });
  });

  it('projects only the matching form value', () => {
    expect(getAuthFormDraft({ type: 'apiKey', in: 'header', name: 'X-API-Key', value: 'secret' })).toEqual({
      apiKey: 'secret',
      bearerToken: '',
      basicUsername: '',
      basicPassword: '',
      oauth2AccessToken: '',
    });
    expect(getAuthFormDraft({ type: 'http', scheme: 'basic', username: 'alice', password: 'secret' })).toEqual({
      apiKey: '',
      bearerToken: '',
      basicUsername: 'alice',
      basicPassword: 'secret',
      oauth2AccessToken: '',
    });
  });
});

describe('Authorize OAS 3.1 security schemes', () => {
  it('recognizes mutualTLS as externally configured rather than a credential form', () => {
    expect(securitySchemeUiKind({ type: 'mutualTLS' })).toBe('mutualTLS');
  });
});
