#!/usr/bin/env node
/**
 * Local headless host acceptance for OAS 3.2.
 * Serves the already-embedded Knife4x UI plus labeled fixtures on loopback,
 * then drives system Chrome/Chromium over CDP. Does not call third-party hosts.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const staticRoot = path.join(repoRoot, 'knife4x/go/internal/ui/static');
const fixture32 = path.join(
  repoRoot,
  'front/ui-react/src/test-fixtures/oas32-normative/host-acceptance-3.2.0.json',
);
const fixture31 = path.join(repoRoot, 'docs/public/examples/openapi-3.1-minimal.json');
const screenshotDir = path.join(os.tmpdir(), 'knife4j-oas32-host-acceptance');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function mimeFor(filePath) {
  if (filePath.endsWith('.js')) return 'application/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.json')) return 'application/json';
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function injectConfig(indexHtml, specUrl) {
  const mark = '<script type="module"';
  const at = indexHtml.indexOf(mark);
  if (at < 0) throw new Error('embedded index.html has no module script');
  const config = JSON.stringify({ specUrl, basePath: '/' });
  return `${indexHtml.slice(0, at)}<script>window.__KNIFE4X_CONFIG__=${config};</script>\n    ${indexHtml.slice(at)}`;
}

function startServer() {
  const indexHtml = fs.readFileSync(path.join(staticRoot, 'index.html'), 'utf8');
  const pages = {
    '/doc.html': injectConfig(indexHtml, '/openapi-3.2.json'),
    '/doc-31.html': injectConfig(indexHtml, '/openapi-3.1.json'),
    '/doc-oas2.html': injectConfig(indexHtml, '/swagger-2.json'),
    '/doc-java.html': indexHtml,
  };
  const files = {
    '/openapi-3.2.json': fs.readFileSync(fixture32),
    '/openapi-3.1.json': fs.readFileSync(fixture31),
    '/swagger-2.json': Buffer.from(
      JSON.stringify({ swagger: '2.0', info: { title: 'OAS2 rejection', version: '1' }, paths: {} }),
    ),
    '/v3/api-docs': fs.readFileSync(fixture32),
    '/v3/api-docs/swagger-config': Buffer.from(
      JSON.stringify({
        configUrl: '/v3/api-docs/swagger-config',
        oauth2RedirectUrl: '',
        url: '/v3/api-docs',
        urls: [{ name: 'OAS 3.2 规范夹具', url: '/v3/api-docs' }],
      }),
    ),
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (pages[url.pathname]) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(pages[url.pathname]);
        return;
      }
      if (files[url.pathname]) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(files[url.pathname]);
        return;
      }
      const relative = url.pathname.replace(/^\//, '');
      const filePath = path.normalize(path.join(staticRoot, relative));
      if (!filePath.startsWith(staticRoot) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeFor(filePath) });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to bind loopback server'));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

class Cdp {
  constructor(webSocket) {
    this.ws = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    this.sessionHandlers = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      const sessionId = message.sessionId;
      const method = message.method;
      if (sessionId && method && this.sessionHandlers.has(sessionId)) {
        this.sessionHandlers.get(sessionId).forEach((handler) => handler(method, message.params ?? {}));
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  onSession(sessionId, handler) {
    const handlers = this.sessionHandlers.get(sessionId) ?? [];
    handlers.push(handler);
    this.sessionHandlers.set(sessionId, handlers);
  }
}

function waitForDevtoolsUrl(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Chrome did not expose DevTools')), 15000);
    let buffer = '';
    const onData = (chunk) => {
      buffer += String(chunk);
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        child.stderr.off('data', onData);
        resolve(match[1]);
      }
    };
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before DevTools was ready (${code})`));
    });
  });
}

async function withChrome(run) {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error('Chrome/Chromium not found; set CHROME_PATH');
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'knife4j-oas32-chrome-'));
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    const browserUrl = await waitForDevtoolsUrl(child);
    const ws = new WebSocket(browserUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('failed to connect to Chrome DevTools')), { once: true });
    });
    const cdp = new Cdp(ws);
    try {
      return await run(cdp);
    } finally {
      ws.close();
    }
  } finally {
    child.kill('SIGKILL');
  }
}

async function openPage(cdp, url, ready) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const requests = [];
  cdp.onSession(sessionId, (method, params) => {
    if (method === 'Network.requestWillBeSent') {
      requests.push(params.request?.url ?? '');
    }
  });
  await cdp.send('Network.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  const started = Date.now();
  let text = '';
  while (Date.now() - started < 25000) {
    const evaluated = await cdp.send(
      'Runtime.evaluate',
      { expression: 'document.body ? document.body.innerText : ""', returnByValue: true },
      sessionId,
    );
    text = String(evaluated.result?.value ?? '');
    if (ready(text)) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  await cdp.send('Target.closeTarget', { targetId });
  return { text, requests, screenshot: screenshot.data };
}

function assertLoopback(requests, origin) {
  const originHost = new URL(origin).host;
  const leaked = requests.filter((value) => {
    if (!value) return false;
    try {
      const parsed = new URL(value);
      if (['data:', 'blob:', 'about:', 'chrome:', 'devtools:'].includes(parsed.protocol)) return false;
      return parsed.host !== originHost && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost';
    } catch {
      return false;
    }
  });
  if (leaked.length > 0) {
    throw new Error(`non-loopback requests: ${leaked.slice(0, 8).join(', ')}`);
  }
  if (requests.some((value) => String(value).includes('unapproved.knife4j.example'))) {
    throw new Error('denied external schema was fetched without a grant');
  }
}

function writeScreenshot(name, data) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const filePath = path.join(screenshotDir, name);
  fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
  return filePath;
}

function mustInclude(text, fragments, label) {
  const missing = fragments.filter((fragment) => !text.includes(fragment));
  if (missing.length > 0) {
    throw new Error(`${label} missing ${JSON.stringify(missing)}\n--- page text ---\n${text.slice(0, 4000)}`);
  }
}

const { server, origin } = await startServer();
try {
  const evidence = await withChrome(async (cdp) => {
    const page32 = await openPage(
      cdp,
      `${origin}/doc.html`,
      (text) => text.includes('QUERY') && text.includes('COPY') && text.includes('OpenAPI 3.2.0'),
    );
    const page31 = await openPage(cdp, `${origin}/doc-31.html`, (text) => text.includes('Knife4j OAS 3.1'));
    const pageOas2 = await openPage(
      cdp,
      `${origin}/doc-oas2.html`,
      (text) => text.includes('OpenAPI 3.x') || text.includes('OpenAPI 3.x 文档'),
    );
    const pageJava = await openPage(
      cdp,
      `${origin}/doc-java.html`,
      (text) => text.includes('QUERY') && text.includes('COPY') && text.includes('OpenAPI 3.2.0'),
    );
    assertLoopback(
      [...page32.requests, ...page31.requests, ...pageOas2.requests, ...pageJava.requests],
      origin,
    );
    mustInclude(
      page32.text,
      ['QUERY', 'COPY', 'TRACE', 'OpenAPI 3.2.0', 'not a springdoc-generated document'],
      'OpenAPI 3.2 host page',
    );
    mustInclude(
      pageJava.text,
      ['QUERY', 'COPY', 'OpenAPI 3.2.0', 'not a springdoc-generated document'],
      'OpenAPI 3.2 Java discovery page',
    );
    mustInclude(page31.text, ['Knife4j OAS 3.1'], 'OpenAPI 3.1 host page');
    if (page31.text.includes('QUERY') || page31.text.includes('COPY')) {
      throw new Error('OpenAPI 3.1 page unexpectedly shows QUERY or COPY');
    }
    if (
      !pageOas2.text.includes('Knife4x only supports OpenAPI 3.x documents.') &&
      !pageOas2.text.includes('Knife4x 仅支持 OpenAPI 3.x 文档。')
    ) {
      throw new Error(`OAS2 page did not reject Swagger 2:\n${pageOas2.text.slice(0, 2000)}`);
    }
    return {
      origin,
      screenshots: {
        oas32: writeScreenshot('oas32.png', page32.screenshot),
        oas31: writeScreenshot('oas31.png', page31.screenshot),
        oas2: writeScreenshot('oas2.png', pageOas2.screenshot),
        oas32Java: writeScreenshot('oas32-java.png', pageJava.screenshot),
      },
      requestCounts: {
        oas32: page32.requests.length,
        oas31: page31.requests.length,
        oas2: pageOas2.requests.length,
        oas32Java: pageJava.requests.length,
      },
    };
  });
  console.log(JSON.stringify({ ok: true, ...evidence }, null, 2));
} finally {
  server.close();
}
