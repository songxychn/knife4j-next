/** RFC 8628 §3; RFC 6749 §2.3.1, §5 and Appendix A. No discovery or storage. */
export const OAUTH_DEVICE_LIMITS = Object.freeze({
  responseBytes: 64 * 1024,
  requestMs: 15_000,
  sessionMs: 15 * 60_000,
  tokenRequests: 180,
  minimumIntervalMs: 1_000,
});

export type OAuthDeviceStatus =
  | 'idle'
  | 'requesting'
  | 'waiting'
  | 'polling'
  | 'success'
  | 'denied'
  | 'expired'
  | 'cancelled'
  | 'failed'
  | 'local-limit';

export type OAuthDeviceError =
  | 'invalid_input'
  | 'invalid_endpoint'
  | 'invalid_response'
  | 'unsafe_verification_uri'
  | 'network_error'
  | 'http_error'
  | 'request_timeout'
  | 'response_limit'
  | 'session_limit'
  | 'request_limit'
  | 'device_expired'
  | 'identity_changed'
  | 'callback_failed'
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'access_denied'
  | 'expired_token'
  | 'oauth_error';

type PollReason = 'authorization_pending' | 'slow_down' | 'request_timeout';

export interface OAuthDeviceVerification {
  readonly uri: string;
  readonly userCode: string;
  readonly completeUri?: string;
  /** The optional shortcut was unsafe; the ordinary URI/code remain usable. */
  readonly completeUriBlocked?: boolean;
}

/** Safe to render/serialize. Terminal snapshots deliberately discard the codes. */
export interface OAuthDeviceSnapshot {
  readonly status: OAuthDeviceStatus;
  readonly generation: number;
  readonly tokenRequests: number;
  readonly intervalMs?: number;
  readonly nextPollAt?: number;
  readonly verification?: OAuthDeviceVerification;
  readonly waitingFor?: PollReason;
  readonly error?: OAuthDeviceError;
}

/** Sensitive in-memory handoff, never part of a snapshot or a completion promise. */
export interface OAuthDeviceAuthorizationResult {
  readonly identity: symbol;
  readonly generation: number;
  readonly accessToken: string;
  readonly tokenType: string;
  readonly tokenUse: 'bearer' | 'unsupported';
  readonly expiresIn?: number;
  readonly scope?: string;
}

export interface OAuthDeviceAuthorizationInput {
  /** A fresh opaque binding for the current group/document/scheme/reset epoch. */
  readonly identity: symbol;
  /** Side-effect-free fence; proactively call cancel() when this binding changes. */
  readonly isCurrent: (identity: symbol) => boolean;
  readonly deviceAuthorizationUrl: string;
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly scope?: string;
  readonly clientAuthentication?: Readonly<{ type: 'basic'; clientSecret: string }>;
  readonly signal?: AbortSignal;
  readonly onSuccess: (result: OAuthDeviceAuthorizationResult) => void;
}

type Timer = ReturnType<typeof globalThis.setTimeout>;

export interface OAuthDeviceDependencies {
  readonly fetchImpl?: typeof fetch;
  /** Must be monotonic milliseconds. Wall-clock changes must not extend a run. */
  readonly now?: () => number;
  readonly setTimeout?: (callback: () => void, ms: number) => Timer;
  readonly clearTimeout?: (timer: Timer) => void;
  /** Observer failures are isolated and never logged with protocol data. */
  readonly onSnapshot?: (snapshot: OAuthDeviceSnapshot) => void;
}

export interface OAuthDeviceAuthorizationController {
  getSnapshot(): OAuthDeviceSnapshot;
  /** Explicit restart: first cancels the old run. Resolves with safe terminal state. */
  start(input: OAuthDeviceAuthorizationInput): Promise<OAuthDeviceSnapshot>;
  /** Call on clear/remove/reset, group/document changes, and component unmount. */
  cancel(): void;
}

interface Configuration {
  deviceUrl: string;
  tokenUrl: string;
  clientId: string;
  scope?: string;
  authorization?: string;
}

interface RequestState {
  controller: AbortController;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  error?: 'request_timeout' | 'cancelled';
  clearTimeout?: () => void;
}

interface Session {
  generation: number;
  identity: symbol;
  isCurrent?: OAuthDeviceAuthorizationInput['isCurrent'];
  onSuccess?: OAuthDeviceAuthorizationInput['onSuccess'];
  configuration?: Configuration;
  resolve: (snapshot: OAuthDeviceSnapshot) => void;
  deviceRequestedAt?: number;
  localDeadline: number;
  serverDeadline?: number;
  intervalMs: number;
  tokenRequests: number;
  deviceCode?: string;
  verification?: OAuthDeviceVerification;
  waitTimer?: Timer;
  deadlineTimer?: Timer;
  request?: RequestState;
  removeAbortListener?: () => void;
}

class ProtocolFailure extends Error {
  constructor(readonly code: OAuthDeviceError | 'cancelled') {
    super(code);
  }
}

function safeHttpsUrl(value: string, allowFragment = false): string | undefined {
  // Reject URL-parser recovery, including empty fragments and empty userinfo.
  if (!/^https:\/\//i.test(value) || hasControlCharacters(value, true) || value.includes('\\')) return;
  if ((!allowFragment && value.includes('#')) || /^[^/]+\/\/[^/?#]*@/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return url.href;
  } catch {
    // Only constant diagnostic codes may escape this module.
  }
}

function formValue(value: string): string {
  return new URLSearchParams({ value }).toString().slice('value='.length);
}

function configuration(input: OAuthDeviceAuthorizationInput): Configuration {
  if (
    typeof input.identity !== 'symbol' ||
    typeof input.isCurrent !== 'function' ||
    typeof input.onSuccess !== 'function' ||
    typeof input.clientId !== 'string' ||
    !input.clientId ||
    (input.scope !== undefined && typeof input.scope !== 'string') ||
    (input.clientAuthentication !== undefined &&
      (input.clientAuthentication.type !== 'basic' || typeof input.clientAuthentication.clientSecret !== 'string'))
  ) {
    throw new ProtocolFailure('invalid_input');
  }
  const deviceUrl = typeof input.deviceAuthorizationUrl === 'string' && safeHttpsUrl(input.deviceAuthorizationUrl);
  const tokenUrl = typeof input.tokenUrl === 'string' && safeHttpsUrl(input.tokenUrl);
  if (!deviceUrl || !tokenUrl) throw new ProtocolFailure('invalid_endpoint');
  return {
    deviceUrl,
    tokenUrl,
    clientId: input.clientId,
    scope: input.scope,
    // Encoding each component first also makes the bytes passed to btoa ASCII.
    authorization: input.clientAuthentication
      ? `Basic ${btoa(`${formValue(input.clientId)}:${formValue(input.clientAuthentication.clientSecret)}`)}`
      : undefined,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasControlCharacters(value: string, includeSpace = false): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= (includeSpace ? 32 : 31) || code === 127) return true;
  }
  return false;
}

function seconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function milliseconds(seconds: number): number {
  return Math.min(seconds * 1000, Number.MAX_SAFE_INTEGER);
}

function addTime(time: number, duration: number): number {
  return Math.min(time + duration, Number.MAX_SAFE_INTEGER);
}

function parseJson(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (!record(value)) throw new ProtocolFailure('invalid_response');
    // RFC 8628 §3.1 forbids repeated response parameters. JSON.parse alone
    // silently accepts them, so check top-level names (including escaped names).
    const names = new Set<string>();
    let depth = 0;
    let expectsName = true;
    for (const [token] of text.matchAll(/"(?:\\.|[^"\\])*"|[{}[\],]/g)) {
      if (token === '{' || token === '[') depth++;
      else if (token === '}' || token === ']') depth--;
      else if (token === ',' && depth === 1) expectsName = true;
      else if (depth === 1 && expectsName && token.startsWith('"')) {
        const name: string = JSON.parse(token);
        if (names.has(name)) throw new ProtocolFailure('invalid_response');
        names.add(name);
        expectsName = false;
      }
    }
    return value;
  } catch {
    throw new ProtocolFailure('invalid_response');
  }
}

function readDevice(payload: Record<string, unknown>) {
  if (
    !nonemptyString(payload.device_code) ||
    !nonemptyString(payload.user_code) ||
    hasControlCharacters(payload.user_code) ||
    !nonemptyString(payload.verification_uri) ||
    !seconds(payload.expires_in) ||
    (payload.interval !== undefined && !seconds(payload.interval)) ||
    (payload.verification_uri_complete !== undefined && !nonemptyString(payload.verification_uri_complete))
  ) {
    throw new ProtocolFailure('invalid_response');
  }
  // Ordinary verification_uri is shown as a clickable page; fragments are not in
  // RFC 8628 examples and can visually spoof a different host after '#'.
  const uri = safeHttpsUrl(payload.verification_uri);
  if (!uri) throw new ProtocolFailure('unsafe_verification_uri');
  const completeUri =
    typeof payload.verification_uri_complete === 'string'
      ? safeHttpsUrl(payload.verification_uri_complete, true)
      : undefined;
  return {
    deviceCode: payload.device_code,
    expiresMs: milliseconds(payload.expires_in),
    intervalMs: Math.max(
      OAUTH_DEVICE_LIMITS.minimumIntervalMs,
      milliseconds((payload.interval as number | undefined) ?? 5),
    ),
    verification: Object.freeze({
      uri,
      userCode: payload.user_code,
      ...(completeUri ? { completeUri } : {}),
      ...(payload.verification_uri_complete !== undefined && !completeUri ? { completeUriBlocked: true } : {}),
    }),
  };
}

function validTokenType(value: unknown): value is string {
  if (!nonemptyString(value)) return false;
  if (/^[A-Za-z0-9._-]+$/.test(value)) return true;
  // Extension types can be URI references, never executable links.
  if (/[^A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]/.test(value) || /%(?![A-Fa-f0-9]{2})/.test(value)) return false;
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && /^[^/?#]*:/.test(value)) return false;
  try {
    new URL(value, 'https://token-type.invalid/');
    return true;
  } catch {
    return false;
  }
}

function readToken(payload: Record<string, unknown>) {
  if (
    !nonemptyString(payload.access_token) ||
    !/^[\x20-\x7e]+$/.test(payload.access_token) ||
    !validTokenType(payload.token_type) ||
    (payload.expires_in !== undefined && !seconds(payload.expires_in)) ||
    (payload.scope !== undefined &&
      (typeof payload.scope !== 'string' || !/^[\x20-\x21\x23-\x5b\x5d-\x7e]*$/.test(payload.scope)))
  ) {
    throw new ProtocolFailure('invalid_response');
  }
  const bearer = payload.token_type.toLowerCase() === 'bearer';
  // RFC 6750 §2.1: a Bearer result must be usable as a single bearer credential.
  if (bearer && !/^[A-Za-z0-9._~+/-]+=*$/.test(payload.access_token)) throw new ProtocolFailure('invalid_response');
  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    tokenUse: bearer ? ('bearer' as const) : ('unsupported' as const),
    ...(typeof payload.expires_in === 'number' ? { expiresIn: payload.expires_in } : {}),
    ...(typeof payload.scope === 'string' ? { scope: payload.scope } : {}),
  };
}

function oauthError(value: string): OAuthDeviceError {
  switch (value) {
    case 'invalid_request':
    case 'invalid_client':
    case 'invalid_grant':
    case 'unauthorized_client':
    case 'unsupported_grant_type':
    case 'invalid_scope':
    case 'access_denied':
    case 'expired_token':
      return value;
    default:
      return 'oauth_error';
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array> | undefined) {
  if (!reader) return;
  void reader.cancel().catch(() => undefined);
  // Cancellation closes pending reads synchronously, even if the underlying
  // source's cancellation promise never settles. Do not retain its lock.
  reader.releaseLock();
}

function abortRequest(request: RequestState | undefined, error: RequestState['error'] = 'cancelled') {
  if (!request) return;
  request.clearTimeout?.();
  request.clearTimeout = undefined;
  if (request.controller.signal.aborted) return;
  request.error = error;
  request.controller.abort();
  cancelReader(request.reader);
  request.reader = undefined;
}

/**
 * The session budget starts at explicit start(); expiry is conservatively based
 * on device-request dispatch, since server issuance precedes response receipt.
 * All deadlines are exclusive: a response at the deadline cannot succeed.
 * Poll delay starts after the preceding response/timeout, preventing overlap.
 * Each dispatched token POST (including timeout) consumes one of 180 attempts.
 */
export function createOAuthDeviceAuthorizationController(
  dependencies: OAuthDeviceDependencies = {},
): OAuthDeviceAuthorizationController {
  const fetchImpl = dependencies.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = dependencies.now ?? (() => performance.now());
  const setTimer = dependencies.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
  const clearTimer = dependencies.clearTimeout ?? ((timer) => globalThis.clearTimeout(timer));
  let generation = 0;
  let current: Session | undefined;
  let snapshot: OAuthDeviceSnapshot = Object.freeze({ status: 'idle', generation, tokenRequests: 0 });

  function notify(value: OAuthDeviceSnapshot) {
    try {
      dependencies.onSnapshot?.(value);
    } catch {
      /* Observers cannot disrupt protocol work. */
    }
  }

  function identityCurrent(session: Session): boolean {
    try {
      return session.isCurrent?.(session.identity) === true;
    } catch {
      return false;
    }
  }

  function finish(
    session: Session,
    status: OAuthDeviceStatus,
    error?: OAuthDeviceError,
    result?: ReturnType<typeof readToken>,
  ) {
    if (current !== session) return;
    const callback = session.onSuccess;
    current = undefined;
    if (session.waitTimer !== undefined) clearTimer(session.waitTimer);
    if (session.deadlineTimer !== undefined) clearTimer(session.deadlineTimer);
    session.waitTimer = undefined;
    session.deadlineTimer = undefined;
    session.removeAbortListener?.();
    session.removeAbortListener = undefined;
    abortRequest(session.request);
    session.request = undefined;
    session.deviceCode = undefined;
    session.configuration = undefined;
    session.verification = undefined;
    session.onSuccess = undefined;
    let terminal: OAuthDeviceSnapshot = Object.freeze({
      status,
      generation: session.generation,
      tokenRequests: session.tokenRequests,
      ...(error ? { error } : {}),
    });
    snapshot = terminal;
    if (result) {
      if (!identityCurrent(session) || generation !== session.generation) {
        terminal = Object.freeze({
          status: 'cancelled',
          generation: session.generation,
          tokenRequests: session.tokenRequests,
          error: 'identity_changed',
        });
      } else {
        try {
          callback?.(Object.freeze({ identity: session.identity, generation: session.generation, ...result }));
        } catch {
          terminal = Object.freeze({
            status: 'failed',
            generation: session.generation,
            tokenRequests: session.tokenRequests,
            error: 'callback_failed',
          });
        }
      }
    }
    session.isCurrent = undefined;
    if (generation === session.generation) {
      snapshot = terminal;
      notify(terminal);
    }
    session.resolve(terminal);
  }

  function deadline(session: Session) {
    return Math.min(session.localDeadline, session.serverDeadline ?? Infinity);
  }

  function checkpoint(session: Session): boolean {
    if (current !== session) return false;
    if (!identityCurrent(session)) {
      finish(session, 'cancelled', 'identity_changed');
      return false;
    }
    if (current !== session) return false;
    if (now() >= deadline(session)) {
      const serverExpired = session.serverDeadline !== undefined && session.serverDeadline <= session.localDeadline;
      finish(session, serverExpired ? 'expired' : 'local-limit', serverExpired ? 'device_expired' : 'session_limit');
      return false;
    }
    return true;
  }

  function armDeadline(session: Session) {
    if (session.deadlineTimer !== undefined) clearTimer(session.deadlineTimer);
    session.deadlineTimer = setTimer(
      () => {
        session.deadlineTimer = undefined;
        if (checkpoint(session)) armDeadline(session);
      },
      Math.max(0, deadline(session) - now()),
    );
  }

  function publish(session: Session, status: OAuthDeviceStatus, waitingFor?: PollReason, nextPollAt?: number) {
    if (!checkpoint(session)) return;
    snapshot = Object.freeze({
      status,
      generation: session.generation,
      tokenRequests: session.tokenRequests,
      ...(session.verification ? { verification: session.verification, intervalMs: session.intervalMs } : {}),
      ...(waitingFor ? { waitingFor } : {}),
      ...(nextPollAt !== undefined ? { nextPollAt } : {}),
    });
    notify(snapshot);
  }

  async function post(session: Session, endpoint: string, body: URLSearchParams, polling = false) {
    if (!checkpoint(session)) throw new ProtocolFailure('cancelled');
    const request: RequestState = { controller: new AbortController() };
    session.request = request;
    let rejectAbort!: (failure: ProtocolFailure) => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    void aborted.catch(() => undefined);
    const onAbort = () => rejectAbort(new ProtocolFailure(request.error ?? 'cancelled'));
    request.controller.signal.addEventListener('abort', onAbort, { once: true });
    const requestDeadline = addTime(now(), OAUTH_DEVICE_LIMITS.requestMs);
    const timeout = setTimer(() => abortRequest(request, 'request_timeout'), OAUTH_DEVICE_LIMITS.requestMs);
    request.clearTimeout = () => clearTimer(timeout);
    const requestCheckpoint = () => {
      if (!checkpoint(session)) throw new ProtocolFailure('cancelled');
      // Enforce elapsed time even if a suspended tab or continuously ready
      // stream delays the timer task. Session/server expiry takes precedence.
      if (now() >= requestDeadline) {
        abortRequest(request, 'request_timeout');
        throw new ProtocolFailure('request_timeout');
      }
    };
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
      };
      if (session.configuration?.authorization) headers.Authorization = session.configuration.authorization;
      if (polling) session.tokenRequests++;
      else session.deviceRequestedAt = now();
      const fetching = fetchImpl(endpoint, {
        method: 'POST',
        body: body.toString(),
        headers,
        signal: request.controller.signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
      }).then((response) => {
        // Even a transport/mock that ignores abort cannot deliver or retain a late body.
        if (request.controller.signal.aborted) {
          if (response.body) void response.body.cancel().catch(() => undefined);
          throw new ProtocolFailure(request.error ?? 'cancelled');
        }
        return response;
      });
      if (polling) publish(session, 'polling');
      const response = await Promise.race([fetching, aborted]);
      if (response.body) request.reader = response.body.getReader();
      requestCheckpoint();
      if (response.status !== 200 && response.status !== 400 && response.status !== 401)
        throw new ProtocolFailure('http_error');
      if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json')
        throw new ProtocolFailure('invalid_response');
      const contentLength = response.headers.get('content-length');
      if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > OAUTH_DEVICE_LIMITS.responseBytes)
        throw new ProtocolFailure('response_limit');
      if (!request.reader) throw new ProtocolFailure('invalid_response');
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0;
      let text = '';
      for (;;) {
        const chunk = await Promise.race([request.reader.read(), aborted]);
        requestCheckpoint();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > OAUTH_DEVICE_LIMITS.responseBytes) throw new ProtocolFailure('response_limit');
        try {
          text += decoder.decode(chunk.value, { stream: true });
        } catch {
          throw new ProtocolFailure('invalid_response');
        }
      }
      try {
        text += decoder.decode();
      } catch {
        throw new ProtocolFailure('invalid_response');
      }
      return { status: response.status, payload: parseJson(text) };
    } catch (error) {
      throw error instanceof ProtocolFailure ? error : new ProtocolFailure('network_error');
    } finally {
      abortRequest(request);
      request.controller.signal.removeEventListener('abort', onAbort);
      if (session.request === request) session.request = undefined;
    }
  }

  function failure(session: Session, error: unknown) {
    if (!checkpoint(session)) return;
    const code = error instanceof ProtocolFailure ? error.code : 'invalid_response';
    if (code !== 'cancelled') finish(session, code === 'response_limit' ? 'local-limit' : 'failed', code);
  }

  function handleError(session: Session, response: Awaited<ReturnType<typeof post>>, polling: boolean): boolean {
    const { status, payload } = response;
    if (status === 200) {
      if ('error' in payload) throw new ProtocolFailure('invalid_response');
      return false;
    }
    if (!nonemptyString(payload.error) || 'access_token' in payload || 'device_code' in payload)
      throw new ProtocolFailure('invalid_response');
    if (polling && status === 400 && (payload.error === 'authorization_pending' || payload.error === 'slow_down')) {
      if (payload.error === 'slow_down') session.intervalMs = addTime(session.intervalMs, 5000);
      queuePoll(session, payload.error);
    } else {
      const error = oauthError(payload.error);
      finish(session, error === 'access_denied' ? 'denied' : error === 'expired_token' ? 'expired' : 'failed', error);
    }
    return true;
  }

  function clientForm(session: Session): URLSearchParams {
    const form = new URLSearchParams();
    if (!session.configuration?.authorization) form.set('client_id', session.configuration!.clientId);
    return form;
  }

  function queuePoll(session: Session, reason?: PollReason) {
    if (!checkpoint(session)) return;
    if (session.tokenRequests >= OAUTH_DEVICE_LIMITS.tokenRequests) {
      finish(session, 'local-limit', 'request_limit');
      return;
    }
    const nextPollAt = addTime(now(), session.intervalMs);
    publish(session, 'waiting', reason, nextPollAt);
    if (!checkpoint(session)) return;
    // The existing deadline timer owns equality and waits longer than the budget.
    if (nextPollAt < deadline(session)) {
      session.waitTimer = setTimer(
        () => {
          session.waitTimer = undefined;
          void poll(session);
        },
        Math.max(0, nextPollAt - now()),
      );
    }
  }

  async function poll(session: Session) {
    if (!checkpoint(session)) return;
    const form = clientForm(session);
    form.set('grant_type', 'urn:ietf:params:oauth:grant-type:device_code');
    form.set('device_code', session.deviceCode!);
    try {
      const response = await post(session, session.configuration!.tokenUrl, form, true);
      if (!checkpoint(session) || handleError(session, response, true)) return;
      const result = readToken(response.payload);
      if (checkpoint(session)) finish(session, 'success', undefined, result);
    } catch (error) {
      if (!checkpoint(session)) return;
      if (error instanceof ProtocolFailure && error.code === 'request_timeout') {
        session.intervalMs = addTime(session.intervalMs, session.intervalMs);
        queuePoll(session, 'request_timeout');
      } else failure(session, error);
    }
  }

  async function authorize(session: Session) {
    try {
      const form = clientForm(session);
      if (session.configuration?.scope) form.set('scope', session.configuration.scope);
      const response = await post(session, session.configuration!.deviceUrl, form);
      if (!checkpoint(session) || handleError(session, response, false)) return;
      const device = readDevice(response.payload);
      session.deviceCode = device.deviceCode;
      session.verification = device.verification;
      session.intervalMs = device.intervalMs;
      session.serverDeadline = addTime(session.deviceRequestedAt!, device.expiresMs);
      if (!checkpoint(session)) return;
      armDeadline(session);
      queuePoll(session);
    } catch (error) {
      failure(session, error);
    }
  }

  function cancel() {
    if (current) finish(current, 'cancelled');
  }

  function start(input: OAuthDeviceAuthorizationInput): Promise<OAuthDeviceSnapshot> {
    generation++;
    // A restart supersedes the old snapshot before notifying observers.
    cancel();
    const startedAt = now();
    let resolve!: Session['resolve'];
    const completion = new Promise<OAuthDeviceSnapshot>((done) => {
      resolve = done;
    });
    const session: Session = {
      generation,
      identity: input.identity,
      isCurrent: input.isCurrent,
      onSuccess: input.onSuccess,
      resolve,
      localDeadline: addTime(startedAt, OAUTH_DEVICE_LIMITS.sessionMs),
      intervalMs: 5000,
      tokenRequests: 0,
    };
    current = session;
    try {
      session.configuration = configuration(input);
      if (input.signal?.aborted) {
        finish(session, 'cancelled');
        return completion;
      }
      if (input.signal) {
        const signal = input.signal;
        const onAbort = () => finish(session, 'cancelled');
        signal.addEventListener('abort', onAbort, { once: true });
        session.removeAbortListener = () => signal.removeEventListener('abort', onAbort);
      }
      if (!checkpoint(session)) return completion;
      armDeadline(session);
      publish(session, 'requesting');
      if (checkpoint(session)) void authorize(session);
    } catch (error) {
      const code = error instanceof ProtocolFailure && error.code !== 'cancelled' ? error.code : 'invalid_input';
      finish(session, 'failed', code);
    }
    return completion;
  }

  return { getSnapshot: () => snapshot, start, cancel };
}
