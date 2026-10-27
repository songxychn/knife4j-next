#!/usr/bin/env node
/**
 * Loopback-only headless acceptance. Bun bundles the client harness, never the Worker.
 * The Worker and its imports are served byte-for-byte from the embedded Go UI.
 * CHROME_PATH/CHROME_BIN select a separate headless process with a temporary profile.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const staticRoot = path.join(repoRoot, 'knife4x/go/internal/ui/static');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'knife4j-worker-acceptance-'));
const prefixes = ['/', '/knife4x/', '/app/webjars/knife4j-ui-react/'];
const requests = [];
const chromePath = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((value) => value && fs.existsSync(value));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else this.handlers.forEach((handler) => handler(message));
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() {
    this.pending.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('CDP closed'));
    });
    this.pending.clear();
    this.ws.close();
  }
}
async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}
const regexObservation = `(() => {
  const marker = '__KNIFE4J_NATIVE_REGEX_STARTED__';
  let reported = false;
  for (const method of ['test', 'exec']) {
    const original = RegExp.prototype[method];
    RegExp.prototype[method] = function(value) {
      if (this.source === '^(a+)+$' && typeof value === 'string' && value.length === 37 && value.endsWith('!') && !reported) {
        reported = true;
        console.info(marker);
      }
      return Reflect.apply(original, this, [value]);
    };
  }
})()`;

function startServer(workerAsset) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const prefix = [...prefixes].sort((a, b) => b.length - a.length).find((item) => url.pathname.startsWith(item));
      const relative = prefix ? url.pathname.slice(prefix.length) : '';
      requests.push({ path: url.pathname, fault: url.searchParams.get('fault') });
      const workerBlocked = url.searchParams.get('fault') === 'csp';
      const headers = {
        'Content-Security-Policy': `default-src 'none'; script-src 'self'; worker-src ${workerBlocked ? "'none'" : "'self'"}; connect-src 'self'`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      };
      if (relative === 'acceptance.html') {
        res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<!doctype html><html><body>Schema Worker acceptance<script type="module" src="./acceptance-entry.js"></script></body></html>',
        );
        return;
      }
      if (relative === 'acceptance-entry.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(`import { createWorkerAcceptance } from './acceptance-harness.js';
          const worker = new URL(${JSON.stringify(workerAsset)}, location.href);
          const fault = new URL(location.href).searchParams.get('fault');
          if (fault === '404' || fault === 'mime') worker.searchParams.set('fault', fault);
          window.__mainRegexCalls = 0;
          for (const method of ['test', 'exec']) {
            const original = RegExp.prototype[method];
            RegExp.prototype[method] = function(value) {
              if (this.source === '^(a+)+$') { window.__mainRegexCalls++; throw new Error('native regex reached main thread'); }
              return Reflect.apply(original, this, [value]);
            };
          }
          window.__acceptance = createWorkerAcceptance(worker.href);`);
        return;
      }
      if (relative === 'acceptance-harness.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(fs.readFileSync(path.join(temporary, 'harness.js')));
        return;
      }
      const file = path.resolve(staticRoot, relative);
      if (
        !file.startsWith(`${staticRoot}${path.sep}`) ||
        !fs.existsSync(file) ||
        !fs.statSync(file).isFile() ||
        url.searchParams.get('fault') === '404'
      ) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type':
          url.searchParams.get('fault') === 'mime'
            ? 'text/html'
            : file.endsWith('.js')
              ? 'application/javascript'
              : 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      fs.createReadStream(file).pipe(res);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}
async function withChrome(run) {
  assert(chromePath, 'Chrome/Chromium not found; set CHROME_PATH (acceptance is required, never skipped)');
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      `--user-data-dir=${path.join(temporary, 'profile')}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const stopped = new Promise((resolve) => child.once('close', resolve));
  try {
    const browserUrl = await new Promise((resolve, reject) => {
      let stderr = '';
      const timeout = setTimeout(() => reject(new Error('Chrome did not expose DevTools')), 15000);
      child.stderr.on('data', (data) => {
        stderr += String(data);
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Chrome exited (${code}): ${stderr.slice(-2000)}`));
      });
    });
    const ws = new WebSocket(browserUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new Cdp(ws);
    try {
      return await run(cdp);
    } finally {
      cdp.close();
    }
  } finally {
    child.kill('SIGKILL');
    await stopped;
  }
}
async function openPage(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const state = { targetId, sessionId, markers: 0, workerUrls: [], networkUrls: [], errors: [] };
  cdp.handlers.push((message) => {
    if (message.sessionId === sessionId && message.method === 'Network.requestWillBeSent')
      state.networkUrls.push(message.params.request.url);
    if (message.method === 'Target.attachedToTarget' && message.sessionId === sessionId) {
      const child = message.params;
      if (child.targetInfo.type === 'worker') {
        state.workerUrls.push(child.targetInfo.url);
        (async () => {
          try {
            await cdp.send('Runtime.enable', {}, child.sessionId);
            await cdp.send('Network.enable', {}, child.sessionId);
            await evaluate(cdp, child.sessionId, regexObservation);
          } finally {
            await cdp.send('Runtime.runIfWaitingForDebugger', {}, child.sessionId);
          }
        })().catch((error) => state.errors.push(String(error)));
        cdp.handlers.push((event) => {
          if (event.sessionId === child.sessionId && event.method === 'Network.requestWillBeSent')
            state.networkUrls.push(event.params.request.url);
          if (
            event.sessionId === child.sessionId &&
            event.method === 'Runtime.consoleAPICalled' &&
            event.params.args.some((arg) => arg.value === '__KNIFE4J_NATIVE_REGEX_STARTED__')
          )
            state.markers++;
        });
      } else
        cdp
          .send('Runtime.runIfWaitingForDebugger', {}, child.sessionId)
          .catch((error) => state.errors.push(String(error)));
    }
  });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 100; i++) {
    if (await evaluate(cdp, sessionId, 'Boolean(window.__acceptance)')) return state;
    await delay(50);
  }
  throw new Error(`harness did not initialize: ${url}`);
}
async function pathological(cdp, page, mode) {
  const isTimeout = mode.startsWith('timeout');
  const before = page.markers;
  await evaluate(cdp, page.sessionId, `window.__acceptance.startPathological(${JSON.stringify(mode)})`);
  const started = Date.now();
  while (page.markers === before && Date.now() - started < 3000) await delay(10);
  assert(page.markers > before, `${mode}: native pathological regex did not begin in the actual Worker`);
  if (!isTimeout) await delay(100); // Observe a live main-thread heartbeat while native matching is blocked.
  if (!isTimeout) await evaluate(cdp, page.sessionId, `window.__acceptance.cancel(${JSON.stringify(mode)})`);
  const evidence = await evaluate(cdp, page.sessionId, 'window.__acceptance.result()');
  if (!isTimeout) assert(evidence.cancellationLatencyMs < 1000, `${mode}: cancellation was not prompt`);
  assert(
    (await evaluate(cdp, page.sessionId, 'window.__mainRegexCalls')) === 0,
    'synchronous main-thread fallback was used',
  );
  await delay(50);
  const later = await evaluate(cdp, page.sessionId, 'window.__acceptance.result()');
  assert(JSON.stringify(later) === JSON.stringify(evidence), 'stale result changed after cancellation');
  return {
    ...evidence,
    nativeWorkerRegexObserved: true,
    ...(await evaluate(cdp, page.sessionId, 'window.__acceptance.recover()')),
  };
}

let server;
try {
  assert(chromePath, 'Chrome/Chromium not found; set CHROME_PATH (acceptance is required, never skipped)');
  const assets = fs
    .readdirSync(path.join(staticRoot, 'assets'))
    .filter((name) => /^schemaDocumentWorker.*\.js$/.test(name));
  assert(
    assets.length === 1,
    `expected exactly one built schemaDocumentWorker asset in ${staticRoot}; sync the real UI first: ${JSON.stringify(assets)}`,
  );
  const workerAsset = `assets/${assets[0]}`;
  const built = spawnSync(
    process.env.BUN_PATH ?? 'bun',
    [
      'build',
      path.join(repoRoot, 'front/ui-react/src/schema/schemaDocumentWorker.acceptance.ts'),
      '--target=browser',
      '--format=esm',
      `--outfile=${path.join(temporary, 'harness.js')}`,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert(built.status === 0, `client harness build failed: ${built.stdout}\n${built.stderr}`);
  const serving = await startServer(workerAsset);
  server = serving.server;
  const evidence = await withChrome(async (cdp) => {
    const browser = await cdp.send('Browser.getVersion');
    const deployments = [];
    for (const prefix of prefixes) {
      const page = await openPage(cdp, `${serving.origin}${prefix}acceptance.html`);
      try {
        const ordinary = await evaluate(cdp, page.sessionId, 'window.__acceptance.ordinary()');
        const scopeAndGraph = await evaluate(cdp, page.sessionId, 'window.__acceptance.scopeAndGraph()');
        const interruption = [];
        for (const mode of ['abort', 'timeout', 'dispose', 'runtime-dispose'])
          interruption.push(await pathological(cdp, page, mode));
        let cancellationGate;
        if (prefix === '/') {
          for (const mode of ['timeout-schema-example', 'timeout-schema-examples'])
            interruption.push(await pathological(cdp, page, mode));
          const samples = [];
          for (let i = 0; i < 30; i++) samples.push(await pathological(cdp, page, 'abort'));
          const latencies = samples.map((sample) => sample.cancellationLatencyMs).sort((a, b) => a - b);
          const p95Ms = latencies[Math.ceil(latencies.length * 0.95) - 1];
          const maxMs = Math.max(...latencies);
          assert(
            samples.length === 30 && latencies.every(Number.isFinite),
            'cancellation gate requires 30 measured native-regex samples',
          );
          assert(p95Ms <= 50, `cancel callback to task settlement P95 ${p95Ms}ms exceeds 50ms`);
          cancellationGate = { sampleCount: samples.length, thresholdP95Ms: 50, p95Ms, maxMs, samples };
        }
        assert(
          page.networkUrls.every((url) => new URL(url).origin === serving.origin),
          `external fetch attempted: ${page.networkUrls.filter((url) => new URL(url).origin !== serving.origin)}`,
        );
        assert(page.errors.length === 0, `Worker observation failed: ${page.errors.join('; ')}`);
        assert(
          page.workerUrls.every((url) => url.startsWith(`${serving.origin}${prefix}assets/`)),
          'Worker escaped deployment prefix',
        );
        deployments.push({
          prefix,
          ordinary,
          scopeAndGraph,
          interruption,
          cancellationGate,
          workerUrls: page.workerUrls,
          networkRequests: page.networkUrls.length,
        });
      } finally {
        await evaluate(cdp, page.sessionId, 'window.__acceptance.dispose()');
        await cdp.send('Target.closeTarget', { targetId: page.targetId });
      }
    }
    const startupFailures = [];
    for (const fault of ['csp', '404', 'mime']) {
      const page = await openPage(cdp, `${serving.origin}/acceptance.html?fault=${fault}`);
      try {
        startupFailures.push({
          fault,
          diagnostic: await evaluate(cdp, page.sessionId, 'window.__acceptance.startupFailure()'),
        });
      } finally {
        await evaluate(cdp, page.sessionId, 'window.__acceptance.dispose()');
        await cdp.send('Target.closeTarget', { targetId: page.targetId });
      }
    }
    return { browser: browser.product, deployments, startupFailures };
  });
  const servedAssets = [
    ...new Set(
      requests
        .filter((request) => request.path.endsWith('.js') && !request.path.includes('acceptance-'))
        .map((request) => {
          const prefix = [...prefixes]
            .sort((a, b) => b.length - a.length)
            .find((item) => request.path.startsWith(item));
          return request.path.slice(prefix.length);
        }),
    ),
  ].map((relative) => ({ path: relative, sha256: sha256(fs.readFileSync(path.join(staticRoot, relative))) }));
  assert(
    servedAssets.some((asset) => asset.path !== workerAsset),
    'actual Worker dynamic chunks were not requested',
  );
  console.log(JSON.stringify({ ok: true, staticRoot, workerAsset, servedAssets, ...evidence }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.stack ?? String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  server?.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
