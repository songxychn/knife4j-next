import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';

interface RequestEvidence {
  origin: 'page' | 'allowed' | 'no-cors' | 'csp-blocked';
  path: string;
  method: string;
  cookie: boolean;
  authorization: boolean;
  referer: boolean;
  originHeader: boolean;
  accept: boolean;
}

interface ServerEvidence {
  requests: RequestEvidence[];
  events: string[];
}

const spikeRoot = resolve(import.meta.dir, '..');
const build = await Bun.build({
  entrypoints: [resolve(spikeRoot, 'src/browser-probe.ts')],
  target: 'browser',
  format: 'esm',
  minify: false,
  sourcemap: 'none',
});
if (!build.success) {
  for (const log of build.logs) console.error(log);
  process.exit(1);
}
const browserBundle = build.outputs.find((output) => output.path.endsWith('.js'));
if (!browserBundle) throw new Error('Browser probe build did not produce JavaScript.');
const browserSource = await browserBundle.text();

const evidence: ServerEvidence = { requests: [], events: [] };
const servers: Bun.Server<unknown>[] = [];
let browser: Browser | undefined;
let pageOrigin = '';

const originFor = (server: Bun.Server<unknown>): string => `http://127.0.0.1:${server.port}`;
const corsHeaders = (): HeadersInit => ({
  'access-control-allow-origin': pageOrigin,
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  vary: 'Origin',
});
const record = (
  origin: RequestEvidence['origin'],
  request: Request,
): void => {
  const url = new URL(request.url);
  evidence.requests.push({
    origin,
    path: `${url.pathname}${url.search}`,
    method: request.method,
    cookie: request.headers.has('cookie'),
    authorization: request.headers.has('authorization'),
    referer: request.headers.has('referer'),
    originHeader: request.headers.has('origin'),
    accept: request.headers.has('accept'),
  });
};

const json = (value: unknown, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', ...headers },
  });

let allowedServer: Bun.Server<unknown>;
allowedServer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request): Response {
    record('allowed', request);
    const url = new URL(request.url);
    const observed = {
      cookie: request.headers.has('cookie'),
      authorization: request.headers.has('authorization'),
      referer: request.headers.has('referer'),
      origin: request.headers.get('origin'),
    };
    switch (url.pathname) {
      case '/cors-ok.json':
        return json(observed, corsHeaders());
      case '/redirect.json':
        return new Response(null, {
          status: 302,
          headers: {
            ...corsHeaders(),
            location: `${originFor(allowedServer)}/redirect-target.json`,
          },
        });
      case '/redirect-target.json':
        return json({ followed: true }, corsHeaders());
      case '/slow.json': {
        let timer: ReturnType<typeof setTimeout> | undefined;
        return new Response(
          new ReadableStream({
            start(controller) {
              timer = setTimeout(() => {
                controller.enqueue(new TextEncoder().encode('{"completed":true}'));
                controller.close();
              }, 1000);
            },
            cancel() {
              if (timer) clearTimeout(timer);
              evidence.events.push('allowed:/slow.json:cancelled');
            },
          }),
          { headers: corsHeaders() },
        );
      }
      case '/oversize.json':
        return new Response(JSON.stringify({ value: 'x'.repeat(1024) }), {
          headers: { ...corsHeaders(), 'content-length': '1036' },
        });
      case '/wrong-content-type':
        return new Response('{"valid":true}', {
          headers: { ...corsHeaders(), 'content-type': 'text/plain; charset=utf-8' },
        });
      case '/cycle-a.json':
        return json({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $id: `${originFor(allowedServer)}/cycle-a.json`,
          $ref: './cycle-b.json',
        }, corsHeaders());
      case '/cycle-b.json':
        return json({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $id: `${originFor(allowedServer)}/cycle-b.json`,
          $ref: './cycle-a.json',
        }, corsHeaders());
      case '/budget-a.json':
        return json({
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          $ref: './budget-b.json',
        }, corsHeaders());
      case '/budget-b.json':
        return json({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' }, corsHeaders());
      default:
        return new Response('not found', { status: 404, headers: corsHeaders() });
    }
  },
});
servers.push(allowedServer);

const noCorsServer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    record('no-cors', request);
    return json({ browserMustNotExposeThis: true });
  },
});
servers.push(noCorsServer);

const cspBlockedServer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    record('csp-blocked', request);
    return json({ browserMustNotRequestThis: true }, corsHeaders());
  },
});
servers.push(cspBlockedServer);

const pageServer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    record('page', request);
    const url = new URL(request.url);
    if (url.pathname === '/probe.js') {
      return new Response(browserSource, {
        headers: { 'cache-control': 'no-store', 'content-type': 'text/javascript; charset=utf-8' },
      });
    }
    if (url.pathname === '/credential-check.json') {
      return json(
        {
          cookie: request.headers.has('cookie'),
          authorization: request.headers.has('authorization'),
          referer: request.headers.has('referer'),
        },
        { 'set-cookie': 'knife4j_resource_response=must-not-store; SameSite=Lax; Path=/' },
      );
    }
    if (url.pathname !== '/probe') return new Response('not found', { status: 404 });

    const scriptUrl = new URL('/probe.js', pageOrigin);
    scriptUrl.searchParams.set('allowedOrigin', originFor(allowedServer));
    scriptUrl.searchParams.set('noCorsOrigin', originFor(noCorsServer));
    scriptUrl.searchParams.set('cspBlockedOrigin', originFor(cspBlockedServer));
    const csp = [
      "default-src 'none'",
      "script-src 'self'",
      `connect-src 'self' ${originFor(allowedServer)} ${originFor(noCorsServer)}`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; ');
    return new Response(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>OAS 3.1 resource loader probe</title></head><body data-status="pending"><output>pending</output><script type="module" src="${scriptUrl.href}"></script></body></html>`,
      {
        headers: {
          'cache-control': 'no-store',
          'content-security-policy': csp,
          'content-type': 'text/html; charset=utf-8',
          'set-cookie': 'knife4j_probe=present; SameSite=Lax; Path=/',
        },
      },
    );
  },
});
servers.push(pageServer);
pageOrigin = originFor(pageServer);

async function findChrome(): Promise<string> {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next well-known executable.
    }
  }
  throw new Error('Chrome/Chromium was not found. Set CHROME_BIN to a compatible executable.');
}

const countRequests = (origin: RequestEvidence['origin'], path: string): number =>
  evidence.requests.filter((request) => request.origin === origin && request.path === path).length;

const normalizeBrowserRequest = (url: string): string => {
  const parsed = new URL(url);
  const origins: Array<[string, string]> = [
    [pageOrigin, 'page'],
    [originFor(allowedServer), 'allowed'],
    [originFor(noCorsServer), 'no-cors'],
    [originFor(cspBlockedServer), 'csp-blocked'],
  ];
  const label = origins.find(([origin]) => origin === parsed.origin)?.[1] ?? 'other';
  return `${label}:${parsed.pathname}`;
};

try {
  const executablePath = await findChrome();
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-default-browser-check'],
  });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page: Page = await context.newPage();
  const browserRequests: string[] = [];
  const failedRequests: string[] = [];
  page.on('request', (request) => browserRequests.push(normalizeBrowserRequest(request.url())));
  page.on('requestfailed', (request) => failedRequests.push(normalizeBrowserRequest(request.url())));

  await page.goto(`${pageOrigin}/probe`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.status !== 'pending', undefined, { timeout: 15_000 });
  const status = await page.locator('body').getAttribute('data-status');
  const pageResult = JSON.parse((await page.locator('output').textContent()) ?? '{}') as {
    allPassed?: boolean;
    assertions?: unknown[];
    fatal?: string;
  };

  const serverAssertions = [
    {
      name: 'redirect target received zero requests',
      passed: countRequests('allowed', '/redirect-target.json') === 0,
    },
    {
      name: 'CSP-blocked origin received zero requests',
      passed: countRequests('csp-blocked', '/csp-blocked.json') === 0,
    },
    {
      name: 'CORS-blocked origin received one credential-free request',
      passed:
        countRequests('no-cors', '/cors-blocked.json') === 1 &&
        evidence.requests
          .filter((request) => request.origin === 'no-cors' && request.path === '/cors-blocked.json')
          .every((request) => !request.cookie && !request.authorization && !request.referer),
    },
    {
      name: 'cycle resources were fetched exactly once each',
      passed:
        countRequests('allowed', '/cycle-a.json') === 1 && countRequests('allowed', '/cycle-b.json') === 1,
    },
    {
      name: 'resource budget prevented the second request',
      passed:
        countRequests('allowed', '/budget-a.json') === 1 && countRequests('allowed', '/budget-b.json') === 0,
    },
    {
      name: 'the safelisted Accept header caused no CORS preflight',
      passed: evidence.requests.every((request) => request.method !== 'OPTIONS'),
    },
  ];

  const report = {
    runtime: { bun: Bun.version, browser: browser.version() },
    page: { status, ...pageResult },
    serverAssertions,
    network: {
      requestsReceived: evidence.requests,
      serverEvents: evidence.events,
      browserRequests: [...new Set(browserRequests)],
      failedBrowserRequests: [...new Set(failedRequests)],
    },
  };
  console.log(JSON.stringify(report, null, 2));

  if (
    status !== 'passed' ||
    pageResult.allPassed !== true ||
    serverAssertions.some((assertion) => !assertion.passed)
  ) {
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  await Promise.all(servers.map((server) => server.stop(true)));
}
