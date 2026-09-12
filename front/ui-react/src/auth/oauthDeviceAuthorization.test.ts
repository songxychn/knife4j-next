import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createOAuthDeviceAuthorizationController,
  OAUTH_DEVICE_LIMITS,
  type OAuthDeviceAuthorizationInput,
  type OAuthDeviceAuthorizationResult,
  type OAuthDeviceSnapshot,
} from './oauthDeviceAuthorization';

const deviceUrl = 'https://auth.example.test/device?tenant=test%2Btenant';
const tokenUrl = 'https://auth.example.test/token?tenant=test%2Btenant';
const deviceCode = 'synthetic-private-device-code';
const accessToken = 'synthetic-access-token';
const secret = 'synthetic-client-secret';
const refreshToken = 'synthetic-ignored-refresh-token';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json;charset=UTF-8' },
  });
}

function device(overrides: Record<string, unknown> = {}): Response {
  return json({
    device_code: deviceCode,
    user_code: 'SYNTH-1234',
    verification_uri: 'https://auth.example.test/verify',
    expires_in: 600,
    ...overrides,
  });
}

function token(overrides: Record<string, unknown> = {}): Response {
  return json({ access_token: accessToken, token_type: 'Bearer', ...overrides });
}

function streamResponse(
  chunks: Uint8Array[],
  options: { status?: number; neverClose?: boolean; headers?: HeadersInit } = {},
) {
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else if (!options.neverClose) controller.close();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  return {
    response: new Response(body, {
      status: options.status ?? 200,
      headers: options.headers ?? { 'content-type': 'application/json' },
    }),
    cancel,
    body,
  };
}

const encode = (text: string) => new TextEncoder().encode(text);

function setup(fetchImpl = vi.fn<typeof fetch>()) {
  const snapshots: OAuthDeviceSnapshot[] = [];
  const success = vi.fn<(result: OAuthDeviceAuthorizationResult) => void>();
  const controller = createOAuthDeviceAuthorizationController({
    fetchImpl,
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (timer) => clearTimeout(timer),
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  });
  const input: OAuthDeviceAuthorizationInput = {
    identity: Symbol('synthetic-document-and-scheme'),
    isCurrent: () => true,
    deviceAuthorizationUrl: deviceUrl,
    tokenUrl,
    clientId: 'synthetic-client',
    scope: 'read:example write:example',
    onSuccess: success,
  };
  return { controller, fetchImpl, snapshots, success, input };
}

async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('explicit OAuth Device Authorization', () => {
  test('starts only explicitly and sends isolated public-client UTF-8 forms to the two endpoints', async () => {
    const { controller, input, fetchImpl, success, snapshots } = setup();
    fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(token({ refresh_token: refreshToken }));
    expect(controller.getSnapshot().status).toBe('idle');
    await tick(10000);
    expect(fetchImpl).not.toHaveBeenCalled();

    const completion = controller.start(input);
    await tick();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'waiting',
      tokenRequests: 0,
      intervalMs: 5000,
      verification: { uri: 'https://auth.example.test/verify', userCode: 'SYNTH-1234' },
    });
    await tick(4999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(await completion).toMatchObject({ status: 'success', tokenRequests: 1 });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([deviceUrl, tokenUrl]);
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init).toMatchObject({
        method: 'POST',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
      });
      expect(new Headers(init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded;charset=UTF-8');
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      expect(new Headers(init?.headers).has('cookie')).toBe(false);
    }
    expect(fetchImpl.mock.calls[0][1]?.body).toBe('client_id=synthetic-client&scope=read%3Aexample+write%3Aexample');
    expect(fetchImpl.mock.calls[1][1]?.body).toBe(
      `client_id=synthetic-client&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code&device_code=${deviceCode}`,
    );
    expect(success).toHaveBeenCalledWith({
      identity: input.identity,
      generation: 1,
      accessToken,
      tokenType: 'Bearer',
      tokenUse: 'bearer',
    });
    expect(JSON.stringify(snapshots)).not.toContain(deviceCode);
    expect(JSON.stringify(snapshots)).not.toContain(accessToken);
    expect(JSON.stringify(snapshots)).not.toContain(refreshToken);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('form-encodes Basic username and password independently and never mixes body credentials', async () => {
    const { controller, input, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(token());
    const completion = controller.start({
      ...input,
      clientId: 'client: +%雪',
      clientAuthentication: { type: 'basic', clientSecret: 'secret: +%!' },
    });
    await tick(5000);
    expect((await completion).status).toBe('success');
    for (const [, init] of fetchImpl.mock.calls) {
      const header = new Headers(init?.headers).get('authorization')!;
      expect(atob(header.slice(6))).toBe('client%3A+%2B%25%E9%9B%AA:secret%3A+%2B%25%21');
      const form = new URLSearchParams(String(init?.body));
      expect(form.has('client_id')).toBe(false);
      expect(form.has('client_secret')).toBe(false);
    }
  });

  test('waits after every response and permanently accumulates slow_down intervals', async () => {
    const { controller, input, fetchImpl } = setup();
    const times: number[] = [];
    const replies = [
      device(),
      json({ error: 'authorization_pending' }, 400),
      json({ error: 'slow_down' }, 400),
      json({ error: 'slow_down' }, 400),
      token(),
    ];
    fetchImpl.mockImplementation(async () => {
      times.push(Date.now());
      return replies.shift()!;
    });
    const completion = controller.start(input);
    await tick(35000);
    expect((await completion).status).toBe('success');
    expect(times).toEqual([0, 5000, 10000, 20000, 35000]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('cancel aborts an outstanding token request and suppresses its late success', async () => {
    const { controller, input, fetchImpl, success } = setup();
    let resolveToken!: (response: Response) => void;
    fetchImpl.mockResolvedValueOnce(device()).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveToken = resolve;
        }),
    );
    const completion = controller.start(input);
    await tick(5000);
    expect(controller.getSnapshot().status).toBe('polling');
    controller.cancel();
    expect((await completion).status).toBe('cancelled');
    expect(fetchImpl.mock.calls[1][1]?.signal?.aborted).toBe(true);
    resolveToken(token());
    await tick(20000);
    expect(success).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe('cancelled');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('expires at the server deadline before a poll scheduled at that exact instant', async () => {
    const { controller, input, fetchImpl, success } = setup();
    fetchImpl.mockResolvedValueOnce(device({ expires_in: 5 }));
    const completion = controller.start(input);
    await tick(5000);
    expect(await completion).toMatchObject({ status: 'expired', error: 'device_expired', tokenRequests: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('protocol validation and safe presentation', () => {
  test.each([
    'http://auth.example.test/token',
    'http://localhost/token',
    '/token',
    '//auth.example.test/token',
    'https:auth.example.test/token',
    'https:/auth.example.test/token',
    'javascript:alert(1)',
    'https://auth.example.test/token#',
    'https://auth.example.test/token#fragment',
    'https://user:secret@auth.example.test/token',
    'https://@auth.example.test/token',
    'https://auth.example.test/\\evil',
    ' https://auth.example.test/token',
    'https://auth.example.test/token\n',
  ])('rejects unsafe endpoint %s without requesting either endpoint', async (endpoint) => {
    for (const field of ['deviceAuthorizationUrl', 'tokenUrl'] as const) {
      const { controller, input, fetchImpl } = setup();
      expect(await controller.start({ ...input, [field]: endpoint })).toMatchObject({
        status: 'failed',
        error: 'invalid_endpoint',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  test.each([
    { device_code: undefined },
    { device_code: '' },
    { device_code: 1 },
    { user_code: undefined },
    { user_code: '' },
    { user_code: 'unsafe\r\ncode' },
    { verification_uri: undefined },
    { verification_uri: 1 },
    { expires_in: undefined },
    { expires_in: '600' },
    { expires_in: -1 },
    { expires_in: 1.5 },
    { expires_in: Number.MAX_SAFE_INTEGER + 1 },
    { interval: '5' },
    { interval: -1 },
    { interval: 0.5 },
    { verification_uri_complete: 1 },
    { verification_uri_complete: '' },
  ])('requires a valid device response: %j', async (overrides) => {
    const { controller, input, fetchImpl, success } = setup();
    fetchImpl.mockResolvedValueOnce(device(overrides));
    expect(await controller.start(input)).toMatchObject({ status: 'failed', error: 'invalid_response' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([
    'javascript:alert(1)',
    'http://auth.example.test/verify',
    'https://user:pass@auth.example.test/verify',
    'https://auth.example.test/verify#fragment',
    'https://evil.example.test/#https://auth.example.test/verify',
  ])('never exposes an unsafe verification link: %s', async (uri) => {
    const { controller, input, fetchImpl, snapshots } = setup();
    fetchImpl.mockResolvedValueOnce(device({ verification_uri: uri }));
    expect(await controller.start(input)).toMatchObject({ status: 'failed', error: 'unsafe_verification_uri' });
    expect(JSON.stringify(snapshots)).not.toContain(uri);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('retains user_code with a complete URI but never requests either verification URI', async () => {
    const { controller, input, fetchImpl } = setup();
    const completeUri = 'https://auth.example.test/verify?user_code=SYNTH-1234#confirm';
    fetchImpl.mockResolvedValueOnce(device({ verification_uri_complete: completeUri })).mockResolvedValueOnce(token());
    const completion = controller.start(input);
    await tick();
    expect(controller.getSnapshot().verification).toEqual({
      uri: 'https://auth.example.test/verify',
      userCode: 'SYNTH-1234',
      completeUri,
    });
    await tick(5000);
    await completion;
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([deviceUrl, tokenUrl]);
  });

  test('drops only an unsafe optional shortcut, retaining the safe URI and user code', async () => {
    const { controller, input, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(device({ verification_uri_complete: 'javascript:alert(1)' }));
    const completion = controller.start(input);
    await tick();
    expect(controller.getSnapshot().verification).toEqual({
      uri: 'https://auth.example.test/verify',
      userCode: 'SYNTH-1234',
      completeUriBlocked: true,
    });
    controller.cancel();
    await completion;
  });

  test.each([
    { access_token: undefined },
    { access_token: '' },
    { access_token: 1 },
    { access_token: 'secret\nheader' },
    { access_token: '雪' },
    { access_token: 'invalid bearer space' },
    { token_type: undefined },
    { token_type: '' },
    { token_type: 1 },
    { token_type: 'Bad Type' },
    { token_type: 'Bearer\r\nAuthorization:' },
    { token_type: 'bad%ZZtype' },
    { expires_in: '1' },
    { expires_in: -1 },
    { scope: ['read'] },
  ])('rejects an invalid token result: %j', async (overrides) => {
    const { controller, input, fetchImpl, success } = setup();
    fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(token(overrides));
    const completion = controller.start(input);
    await tick(5000);
    expect(await completion).toMatchObject({ status: 'failed', error: 'invalid_response' });
    expect(success).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(['bEaReR', 'DPoP', 'urn:example:token-type', './custom-token-type'])(
    'preserves token type %s and only recognizes Bearer for execution',
    async (tokenType) => {
      const { controller, input, fetchImpl, success } = setup();
      fetchImpl
        .mockResolvedValueOnce(device())
        .mockResolvedValueOnce(token({ token_type: tokenType, expires_in: 60, scope: 'read:example' }));
      const completion = controller.start(input);
      await tick(5000);
      expect((await completion).status).toBe('success');
      expect(success).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenType,
          tokenUse: tokenType === 'bEaReR' ? 'bearer' : 'unsupported',
          expiresIn: 60,
          scope: 'read:example',
        }),
      );
      expect(controller.getSnapshot()).not.toHaveProperty('tokenType');
    },
  );

  test.each([
    ['access_denied', 'denied', 'access_denied'],
    ['expired_token', 'expired', 'expired_token'],
    ['invalid_client', 'failed', 'invalid_client'],
    ['invalid_request', 'failed', 'invalid_request'],
    ['invalid_grant', 'failed', 'invalid_grant'],
    ['unauthorized_client', 'failed', 'unauthorized_client'],
    ['unsupported_grant_type', 'failed', 'unsupported_grant_type'],
    ['invalid_scope', 'failed', 'invalid_scope'],
    ['custom-error-with-synthetic-secret', 'failed', 'oauth_error'],
  ])('stops permanently on OAuth error %s with a safe code', async (error, status, code) => {
    const { controller, input, fetchImpl, success, snapshots } = setup();
    fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(
      json(
        {
          error,
          error_description: `${secret} ${deviceCode}`,
          error_uri: `https://error.example.test/?token=${accessToken}`,
        },
        400,
      ),
    );
    const completion = controller.start({ ...input, clientAuthentication: { type: 'basic', clientSecret: secret } });
    await tick(5000);
    expect(await completion).toMatchObject({ status, error: code, tokenRequests: 1 });
    await tick(1_000_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(success).not.toHaveBeenCalled();
    for (const sensitive of [secret, deviceCode, accessToken, 'custom-error-with-synthetic-secret'])
      expect(JSON.stringify(snapshots)).not.toContain(sensitive);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('handles a device endpoint OAuth error and a Basic 401 without retrying', async () => {
    for (const status of [400, 401]) {
      const { controller, input, fetchImpl } = setup();
      fetchImpl.mockResolvedValueOnce(json({ error: 'invalid_client', error_description: secret }, status));
      expect(
        await controller.start({ ...input, clientAuthentication: { type: 'basic', clientSecret: secret } }),
      ).toMatchObject({ status: 'failed', error: 'invalid_client', tokenRequests: 0 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  test.each([
    ['{', 200, 'application/json'],
    ['[]', 200, 'application/json'],
    ['null', 200, 'application/json'],
    ['{}', 200, 'text/html'],
    ['{"error":"authorization_pending"}', 200, 'application/json'],
    ['{"error":false}', 400, 'application/json'],
    ['{"error":""}', 400, 'application/json'],
    [`{"error":"authorization_pending","access_token":"${accessToken}"}`, 400, 'application/json'],
    [
      `{"device_code":"old","device_\\u0063ode":"${deviceCode}","user_code":"1234","verification_uri":"https://auth.example.test/verify","expires_in":600}`,
      200,
      'application/json',
    ],
  ])('rejects malformed or ambiguous response %s', async (body, status, contentType) => {
    const { controller, input, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(new Response(body, { status, headers: { 'content-type': contentType } }));
    expect(await controller.start(input)).toMatchObject({ status: 'failed', error: 'invalid_response' });
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([201, 302, 429, 500])('does not treat HTTP %i as an OAuth polling instruction', async (status) => {
    const { controller, input, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(json({ error: 'authorization_pending' }, status));
    const completion = controller.start(input);
    await tick(5000);
    expect(await completion).toMatchObject({ status: 'failed', error: 'http_error' });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('bounded streaming and request budgets', () => {
  test('enforces the 64 KiB ceiling while streaming UTF-8 bytes, cancels and unlocks the body', async () => {
    const { controller, input, fetchImpl } = setup();
    const source = streamResponse([encode('{"extra":"'), encode('雪'.repeat(23000))], { neverClose: true });
    const textSpy = vi.spyOn(source.response, 'text');
    fetchImpl.mockResolvedValueOnce(source.response);
    expect(await controller.start(input)).toMatchObject({ status: 'local-limit', error: 'response_limit' });
    expect(textSpy).not.toHaveBeenCalled();
    expect(source.cancel).toHaveBeenCalledTimes(1);
    expect(source.body.locked).toBe(false);
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('accepts exactly 64 KiB and ignores sensitive extras without retaining them', async () => {
    const { controller, input, fetchImpl, snapshots } = setup();
    const raw = JSON.stringify({
      device_code: deviceCode,
      user_code: '1234',
      verification_uri: 'https://auth.example.test/verify',
      expires_in: 600,
      extra: '',
    });
    const payload = raw.replace(
      '"extra":""',
      `"extra":"${'x'.repeat(OAUTH_DEVICE_LIMITS.responseBytes - encode(raw).length)}"`,
    );
    const source = streamResponse([encode(payload)]);
    fetchImpl.mockResolvedValueOnce(source.response);
    const completion = controller.start(input);
    await tick();
    expect(controller.getSnapshot().status).toBe('waiting');
    expect(source.body.locked).toBe(false);
    expect(JSON.stringify(snapshots)).not.toContain('extra');
    controller.cancel();
    await completion;
  });

  test('applies the byte ceiling independently to token responses and preflights Content-Length', async () => {
    for (const useHeader of [false, true]) {
      const { controller, input, fetchImpl } = setup();
      const source = streamResponse(useHeader ? [] : [new Uint8Array(65537)], {
        neverClose: true,
        headers: { 'content-type': 'application/json', ...(useHeader ? { 'content-length': '65537' } : {}) },
      });
      fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(source.response);
      const completion = controller.start(input);
      await tick(5000);
      expect(await completion).toMatchObject({ status: 'local-limit', error: 'response_limit', tokenRequests: 1 });
      expect(source.cancel).toHaveBeenCalledTimes(1);
      expect(source.body.locked).toBe(false);
    }
  });

  test('decodes split UTF-8 correctly and rejects malformed UTF-8', async () => {
    for (const malformed of [false, true]) {
      const { controller, input, fetchImpl } = setup();
      const prefix = encode('{"device_code":"code","user_code":"');
      const suffix = encode('","verification_uri":"https://auth.example.test/verify","expires_in":600}');
      const code = encode('雪');
      const source = streamResponse([
        prefix,
        code.slice(0, 1),
        malformed ? new Uint8Array([255]) : code.slice(1),
        suffix,
      ]);
      fetchImpl.mockResolvedValueOnce(source.response);
      const completion = controller.start(input);
      await tick();
      if (malformed) expect(await completion).toMatchObject({ status: 'failed', error: 'invalid_response' });
      else {
        expect(controller.getSnapshot().verification?.userCode).toBe('雪');
        controller.cancel();
        await completion;
      }
      expect(source.body.locked).toBe(false);
    }
  });

  test('times out device authorization after 15 seconds without automatically starting another session', async () => {
    const { controller, input, fetchImpl } = setup();
    fetchImpl.mockImplementation(() => new Promise(() => undefined));
    const completion = controller.start(input);
    await tick(14999);
    expect(controller.getSnapshot().status).toBe('requesting');
    await tick(1);
    expect(await completion).toMatchObject({ status: 'failed', error: 'request_timeout', tokenRequests: 0 });
    await tick(1_000_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('doubles the polling interval on each timeout, then also respects slow_down', async () => {
    const { controller, input, fetchImpl } = setup();
    const times: number[] = [];
    fetchImpl.mockImplementation(async () => {
      times.push(Date.now());
      if (times.length === 1) return device();
      if (times.length === 2 || times.length === 3) return new Promise(() => undefined);
      if (times.length === 4) return json({ error: 'slow_down' }, 400);
      return token();
    });
    const completion = controller.start(input);
    await tick(20000);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'waiting',
      waitingFor: 'request_timeout',
      intervalMs: 10000,
    });
    expect(fetchImpl.mock.calls[1][1]?.signal?.aborted).toBe(true);
    await tick(25000);
    expect(controller.getSnapshot()).toMatchObject({ intervalMs: 20000, tokenRequests: 2 });
    expect(fetchImpl.mock.calls[2][1]?.signal?.aborted).toBe(true);
    await tick(45000);
    expect((await completion).status).toBe('success');
    expect(times).toEqual([0, 5000, 30000, 65000, 90000]);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('times out a stalled body, cancels its reader and backs off without overlapping a token request', async () => {
    const { controller, input, fetchImpl } = setup();
    const source = streamResponse([encode('{')], { neverClose: true });
    fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(source.response).mockResolvedValueOnce(token());
    const completion = controller.start(input);
    await tick(19999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(source.body.locked).toBe(true);
    await tick(1);
    expect(source.cancel).toHaveBeenCalledTimes(1);
    expect(source.body.locked).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'waiting',
      waitingFor: 'request_timeout',
      intervalMs: 10000,
    });
    await tick(9999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await tick(1);
    expect((await completion).status).toBe('success');
  });

  test('allows no overlapping token requests and counts interval from response completion', async () => {
    const { controller, input, fetchImpl } = setup();
    let respond!: (response: Response) => void;
    fetchImpl
      .mockResolvedValueOnce(device())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          }),
      )
      .mockResolvedValueOnce(token());
    const completion = controller.start(input);
    await tick(19000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    respond(json({ error: 'authorization_pending' }, 400));
    await tick(4999);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await tick(1);
    expect((await completion).status).toBe('success');
    expect(controller.getSnapshot().tokenRequests).toBe(2);
  });

  test.each([false, true])(
    'reports network rejection without guessing CORS or denial (synchronous: %s)',
    async (synchronous) => {
      const { controller, input, fetchImpl, snapshots } = setup();
      fetchImpl.mockImplementation(() => {
        const error = new TypeError(`sensitive fetch failure ${secret} ${deviceCode}`);
        if (synchronous) throw error;
        return Promise.reject(error);
      });
      expect(await controller.start(input)).toMatchObject({ status: 'failed', error: 'network_error' });
      await tick();
      expect(JSON.stringify(snapshots)).not.toContain(secret);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test.each([0, 1, 12])('respects interval %i with a documented one-second local floor', async (interval) => {
    const { controller, input, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(device({ interval })).mockResolvedValueOnce(token());
    const completion = controller.start(input);
    const wait = Math.max(1, interval) * 1000;
    await tick(wait - 1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await tick(1);
    expect((await completion).status).toBe('success');
  });

  test('stops after exactly 180 token attempts and permits success on attempt 180', async () => {
    for (const succeeds of [false, true]) {
      const { controller, input, fetchImpl } = setup();
      fetchImpl.mockResolvedValueOnce(device({ interval: 1 }));
      for (let i = 1; i <= 180; i++)
        fetchImpl.mockResolvedValueOnce(
          succeeds && i === 180 ? token() : json({ error: 'authorization_pending' }, 400),
        );
      const completion = controller.start(input);
      await tick(180_000);
      expect(await completion).toMatchObject({
        status: succeeds ? 'success' : 'local-limit',
        tokenRequests: 180,
        ...(succeeds ? {} : { error: 'request_limit' }),
      });
      expect(fetchImpl).toHaveBeenCalledTimes(181);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  test.each([901, Number.MAX_SAFE_INTEGER])(
    'uses the 15-minute local deadline for long server expiry/interval %i',
    async (duration) => {
      const { controller, input, fetchImpl } = setup();
      fetchImpl.mockResolvedValueOnce(device({ expires_in: duration, interval: duration }));
      const completion = controller.start(input);
      await tick(899_999);
      expect(controller.getSnapshot().status).toBe('waiting');
      await tick(1);
      expect(await completion).toMatchObject({ status: 'local-limit', error: 'session_limit', tokenRequests: 0 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test('conservatively anchors server expiry to device request dispatch and accepts zero lifetime as already expired', async () => {
    for (const expiresIn of [0, 8]) {
      const { controller, input, fetchImpl } = setup();
      let respond!: (response: Response) => void;
      fetchImpl.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          }),
      );
      const completion = controller.start(input);
      await tick(4000);
      respond(device({ expires_in: expiresIn }));
      await tick(4000);
      expect(await completion).toMatchObject({ status: 'expired', error: 'device_expired', tokenRequests: 0 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  });
});

describe('lifecycle, identity fencing and transient secrets', () => {
  test('cancel while waiting removes all future work and display codes', async () => {
    const { controller, input, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(device());
    const completion = controller.start(input);
    await tick(2000);
    controller.cancel();
    expect(await completion).toEqual({ status: 'cancelled', generation: 1, tokenRequests: 0 });
    await tick(1_000_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each([0, 2000, 5000])(
    'external abort at %i ms ends request/timer without exposing its reason',
    async (abortAt) => {
      const { controller, input, fetchImpl, success, snapshots } = setup();
      const abort = new AbortController();
      fetchImpl.mockResolvedValueOnce(device()).mockImplementationOnce(() => new Promise(() => undefined));
      const completion = controller.start({ ...input, signal: abort.signal });
      await tick(abortAt);
      abort.abort(new Error(secret));
      expect((await completion).status).toBe('cancelled');
      expect(fetchImpl.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
      expect(success).not.toHaveBeenCalled();
      expect(JSON.stringify(snapshots)).not.toContain(secret);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test('an already-aborted signal never sends a request', async () => {
    const { controller, input, fetchImpl } = setup();
    const abort = new AbortController();
    abort.abort();
    expect((await controller.start({ ...input, signal: abort.signal })).status).toBe('cancelled');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('removes external signal listeners on successful completion', async () => {
    const { controller, input, fetchImpl } = setup();
    const abort = new AbortController();
    const added = vi.spyOn(abort.signal, 'addEventListener');
    const removed = vi.spyOn(abort.signal, 'removeEventListener');
    fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(token());
    const completion = controller.start({ ...input, signal: abort.signal });
    await tick(5000);
    expect((await completion).status).toBe('success');
    expect(added).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith('abort', added.mock.calls[0][1]);
    abort.abort();
    expect(controller.getSnapshot().status).toBe('success');
  });

  test('cancel during body reading does not wait for an underlying source cancel promise', async () => {
    const { controller, input, fetchImpl } = setup();
    const cancelled = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encode('{'));
      },
      cancel: cancelled,
    });
    fetchImpl.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/json' } }));
    const completion = controller.start(input);
    await tick();
    expect(body.locked).toBe(true);
    controller.cancel();
    expect((await completion).status).toBe('cancelled');
    await tick();
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('restarts explicitly with fresh identity, cancels late old responses and never commits their token', async () => {
    const { controller, input, fetchImpl, success, snapshots } = setup();
    let oldResponse!: (response: Response) => void;
    fetchImpl
      .mockResolvedValueOnce(device())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldResponse = resolve;
          }),
      )
      .mockResolvedValueOnce(device({ device_code: 'new-private-code' }))
      .mockResolvedValueOnce(token({ access_token: 'new-access-token' }));
    const oldCompletion = controller.start(input);
    await tick(5000);
    const newIdentity = Symbol('new-document');
    const newCompletion = controller.start({ ...input, identity: newIdentity });
    expect(await oldCompletion).toMatchObject({ status: 'cancelled', generation: 1 });
    const late = streamResponse([encode(JSON.stringify({ access_token: accessToken, token_type: 'Bearer' }))]);
    oldResponse(late.response);
    await tick(5000);
    expect(await newCompletion).toMatchObject({ status: 'success', generation: 2, tokenRequests: 1 });
    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(
      expect.objectContaining({ identity: newIdentity, generation: 2, accessToken: 'new-access-token' }),
    );
    expect(late.cancel).toHaveBeenCalledTimes(1);
    expect(late.body.locked).toBe(false);
    expect(fetchImpl.mock.calls[1][1]?.signal?.aborted).toBe(true);
    expect(String(fetchImpl.mock.calls[3][1]?.body)).toContain('device_code=new-private-code');
    expect(JSON.stringify(snapshots)).not.toContain('new-private-code');
    expect(vi.getTimerCount()).toBe(0);
  });

  test('cancels an old device response on restart before any token request exists', async () => {
    const { controller, input, fetchImpl, success } = setup();
    let oldResponse!: (response: Response) => void;
    fetchImpl
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldResponse = resolve;
          }),
      )
      .mockResolvedValueOnce(device())
      .mockResolvedValueOnce(token());
    const oldCompletion = controller.start(input);
    const completion = controller.start({ ...input, identity: Symbol('new') });
    oldResponse(device({ verification_uri: 'https://old.example.test/verify' }));
    await tick(5000);
    expect((await oldCompletion).status).toBe('cancelled');
    expect((await completion).status).toBe('success');
    expect(success).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  test.each(['before-start', 'waiting', 'response'])(
    'checks the immutable binding when identity changes %s',
    async (when) => {
      const { controller, input, fetchImpl, success } = setup();
      let currentIdentity = when !== 'before-start';
      let reply!: (response: Response) => void;
      fetchImpl.mockResolvedValueOnce(device()).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            reply = resolve;
          }),
      );
      const completion = controller.start({
        ...input,
        isCurrent: (identity) => identity === input.identity && currentIdentity,
      });
      if (when === 'waiting') {
        await tick();
        currentIdentity = false;
        await tick(5000);
      } else if (when === 'response') {
        await tick(5000);
        currentIdentity = false;
        reply(token());
        await tick();
      }
      expect(await completion).toMatchObject({ status: 'cancelled', error: 'identity_changed' });
      expect(success).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  test('freezes request configuration at start and does not retain a mutable Basic secret input', async () => {
    const { controller, input, fetchImpl } = setup();
    const authentication = { type: 'basic' as const, clientSecret: secret };
    const mutable = { ...input, clientAuthentication: authentication };
    fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(token());
    const completion = controller.start(mutable);
    mutable.tokenUrl = 'https://changed.example.test/token';
    mutable.clientId = 'changed-client';
    authentication.clientSecret = 'changed-secret';
    await tick(5000);
    await completion;
    expect(fetchImpl.mock.calls[1][0]).toBe(tokenUrl);
    expect(atob(new Headers(fetchImpl.mock.calls[1][1]?.headers).get('authorization')!.slice(6))).toBe(
      `synthetic-client:${secret}`,
    );
  });

  test('server expiry cancels a token body at its exclusive deadline and rejects a late success', async () => {
    const { controller, input, fetchImpl, success } = setup();
    const source = streamResponse([encode('{')], { neverClose: true });
    fetchImpl.mockResolvedValueOnce(device({ expires_in: 7 })).mockResolvedValueOnce(source.response);
    const completion = controller.start(input);
    await tick(7000);
    expect(await completion).toMatchObject({ status: 'expired', error: 'device_expired', tokenRequests: 1 });
    expect(source.cancel).toHaveBeenCalledTimes(1);
    expect(source.body.locked).toBe(false);
    expect(success).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('checks request elapsed time when timer execution is delayed', async () => {
    let clock = 0;
    const response = streamResponse([encode('{}')]);
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      clock = 15000;
      return response.response;
    });
    const controller = createOAuthDeviceAuthorizationController({ fetchImpl, now: () => clock });
    expect(await controller.start(setup().input)).toMatchObject({ status: 'failed', error: 'request_timeout' });
    expect(response.cancel).toHaveBeenCalledTimes(1);
    expect(response.body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('bounds a continuously ready zero-byte stream even if it starves timeout tasks', async () => {
    let clock = 0;
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(stream) {
          clock += 5000;
          stream.enqueue(new Uint8Array());
        },
        cancel: cancelled,
      },
      { highWaterMark: 0 },
    );
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
    );
    const controller = createOAuthDeviceAuthorizationController({ fetchImpl, now: () => clock });
    expect(await controller.start(setup().input)).toMatchObject({ status: 'failed', error: 'request_timeout' });
    expect(clock).toBe(15000);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('callback failures never expose their exception or preserve secrets in completion', async () => {
    const { controller, input, fetchImpl, snapshots } = setup();
    fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(token());
    const completion = controller.start({
      ...input,
      onSuccess: () => {
        throw new Error(`${accessToken} ${secret}`);
      },
    });
    await tick(5000);
    const terminal = await completion;
    expect(terminal).toMatchObject({ status: 'failed', error: 'callback_failed' });
    for (const sensitive of [deviceCode, accessToken, secret])
      expect(JSON.stringify([terminal, ...snapshots])).not.toContain(sensitive);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('snapshot observers cannot mutate state and can cancel before any network work', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const controller = createOAuthDeviceAuthorizationController({
      fetchImpl,
      onSnapshot: (snapshot) => {
        if (snapshot.status === 'requesting') controller.cancel();
        (snapshot as { status: string }).status = 'success';
      },
    });
    expect((await controller.start(setup().input)).status).toBe('cancelled');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe('cancelled');
    expect(Object.isFrozen(controller.getSnapshot())).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('a success callback may start another run without the old success replacing its state', async () => {
    const { controller, input, fetchImpl, snapshots } = setup();
    fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(token()).mockResolvedValueOnce(device());
    let second!: Promise<OAuthDeviceSnapshot>;
    const completion = controller.start({
      ...input,
      onSuccess: () => {
        second = controller.start({ ...input, identity: Symbol('second') });
      },
    });
    await tick(5000);
    expect((await completion).status).toBe('success');
    expect(controller.getSnapshot()).toMatchObject({ status: 'waiting', generation: 2 });
    expect(snapshots.at(-1)).toMatchObject({ status: 'waiting', generation: 2 });
    controller.cancel();
    await second;
    expect(vi.getTimerCount()).toBe(0);
  });

  test('two controllers isolate scheme lifecycles and success callbacks', async () => {
    const first = setup();
    const second = setup();
    first.fetchImpl.mockResolvedValueOnce(device());
    second.fetchImpl.mockResolvedValueOnce(device()).mockResolvedValueOnce(token());
    const firstCompletion = first.controller.start(first.input);
    const secondCompletion = second.controller.start(second.input);
    await tick();
    first.controller.cancel();
    await tick(5000);
    expect((await firstCompletion).status).toBe('cancelled');
    expect((await secondCompletion).status).toBe('success');
    expect(first.success).not.toHaveBeenCalled();
    expect(second.success).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
