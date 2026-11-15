// Usage: bun front/ui-react/scripts/run-storage-coordination-acceptance.mjs <current-browser-bundle> <baseline-browser-bundle>
// Inputs are isolated browser bundles of knife4jStorage.ts; no user profile is opened.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
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

if (!process.argv[2] || !process.argv[3]) throw new Error('Provide current and baseline browser bundle paths');
const bundle = fs.readFileSync(process.argv[2]);
const oldBundle = fs.readFileSync(process.argv[3]);
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.mjs') ? 'text/javascript' : 'text/html');
  res.end(
    req.url === '/old-storage.mjs'
      ? oldBundle
      : req.url === '/storage.mjs'
        ? bundle
        : '<!doctype html><title>Storage coordination test</title>',
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const timer = setTimeout(() => {
  throw new Error('storage acceptance timed out');
}, 60000);
try {
  const results = await withChrome(async (cdp) => {
    const ev = async (sessionId, expression, awaitPromise = true) => {
      const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
      return r.result?.value;
    };
    const open = async (old = false) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: origin });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      for (let i = 0; i < 500; i++) {
        if ((await ev(sessionId, 'location.origin')) === origin) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await ev(
        sessionId,
        `(async()=>{window.s=await import('${old ? '/old-storage.mjs' : '/storage.mjs'}');const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(${!old} && k.startsWith(s.KNIFE4J_STORAGE_PREFIXES.resetClaim))throw Error('redundant reset claim');return set.call(this,k,v)};})()`,
      );
      return { targetId, sessionId };
    };
    const results = [];
    for (const mode of ['web-locks', 'fallback'])
      for (const [oldFirst, oldSecond] of [
        [true, false],
        [false, true],
        [false, false],
      ]) {
        console.error('scenario', mode, { oldFirst, oldSecond });
        const a = await open(oldFirst),
          b = await open(oldSecond);
        await ev(
          a.sessionId,
          "localStorage.setItem('host-owned','keep');localStorage.setItem(s.KNIFE4J_STORAGE_KEYS.settings,'settings');window.gate=new Promise(r=>window.release=r);true",
        );
        await ev(b.sessionId, 'window.before=s.getKnife4jStorageResetSnapshot(localStorage).generation');
        const lock = mode === 'web-locks' ? 'navigator.locks' : 'null';
        await ev(
          a.sessionId,
          `window.pending=s.clearRegisteredKnife4jStorage('all-local-data',{localStorage,sessionStorage,indexedDB:{keys:async()=>{window.entered=true;await gate;return []},delete:async()=>{}}},${lock});true`,
        );
        for (let i = 0; i < 500; i++) {
          if (await ev(a.sessionId, 'window.entered===true')) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        if (!(await ev(a.sessionId, 'window.entered===true')))
          console.error(
            'diagnostic',
            await ev(
              a.sessionId,
              'Promise.race([window.pending,new Promise(r=>setTimeout(()=>r({waiting:true,local:[...Object.entries(localStorage)]}),100))])',
            ),
          );
        assert.equal(await ev(a.sessionId, 'window.entered===true'), true, 'first reset entered');
        await ev(
          b.sessionId,
          `window.pending=s.clearRegisteredKnife4jStorage('all-local-data',{localStorage,sessionStorage,indexedDB:{keys:async()=>{window.entered=true;return []},delete:async()=>{}}},${lock});true`,
        );
        await new Promise((r) => setTimeout(r, 200));
        assert.equal(await ev(b.sessionId, 'window.entered===true'), false, 'second reset must wait');
        await ev(a.sessionId, 'window.release();true');
        const first = await ev(a.sessionId, 'window.pending');
        const second = await ev(b.sessionId, 'window.pending');
        assert.deepEqual(first.failures, []);
        assert.deepEqual(second.failures, []);
        assert.equal(await ev(b.sessionId, "localStorage.getItem('host-owned')"), 'keep');
        assert.equal(await ev(b.sessionId, 'localStorage.getItem(s.KNIFE4J_STORAGE_KEYS.settings)'), null);
        assert.equal(await ev(b.sessionId, 's.getKnife4jStorageResetSnapshot(localStorage).generation!==before'), true);
        assert.equal(await ev(b.sessionId, 'localStorage.getItem(s.KNIFE4J_STORAGE_KEYS.resetLease)'), null);
        results.push({
          mode,
          oldFirst,
          oldSecond,
          serialized: true,
          hostPreserved: true,
          generationAdvanced: true,
          failures: 0,
        });
        await cdp.send('Target.closeTarget', { targetId: a.targetId });
        await cdp.send('Target.closeTarget', { targetId: b.targetId });
      }

    // Cache cleanup invalidates reads from either version without allocating mutation metadata in the new version.
    for (const mode of ['web-locks', 'fallback'])
      for (const [oldFirst, oldSecond] of [
        [true, false],
        [false, true],
        [false, false],
      ]) {
        const a = await open(oldFirst),
          b = await open(oldSecond);
        const lock = mode === 'web-locks' ? 'navigator.locks' : 'null';
        await ev(
          a.sessionId,
          "localStorage.clear();window.key=s.KNIFE4J_STORAGE_PREFIXES.debugHistory+'mixed';localStorage.setItem(key,'old-history');localStorage.setItem('host-owned','keep');window.snapshot=s.getKnife4jStorageItemSnapshot(localStorage,key,localStorage)",
        );
        const cleaned = await ev(
          b.sessionId,
          `s.clearRegisteredKnife4jStorage('request-cache',{localStorage,sessionStorage,indexedDB:null},${lock})`,
        );
        assert.deepEqual(cleaned.failures, []);
        assert.equal(
          await ev(a.sessionId, `s.setKnife4jStorageItem(localStorage,key,'stale',localStorage,${lock},snapshot)`),
          false,
        );
        assert.equal(
          await ev(a.sessionId, `s.setKnife4jStorageItem(localStorage,key,'fresh',localStorage,${lock})`),
          true,
        );
        assert.equal(await ev(b.sessionId, "localStorage.getItem('host-owned')"), 'keep');
        results.push({ mode, oldReader: oldFirst, oldCleaner: oldSecond, cacheStaleReadRejected: true });
        await cdp.send('Target.closeTarget', { targetId: a.targetId });
        await cdp.send('Target.closeTarget', { targetId: b.targetId });
      }
    // Force the browser transaction to abort while its asynchronous callback is still pending.
    {
      const a = await open();
      await ev(
        a.sessionId,
        `localStorage.clear();window.gate=new Promise(r=>window.release=r);window.entered=false;const tx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const t=tx.apply(this,args);if(this.name==='knife4j-next-storage-coordination')window.tx=t;return t};window.pending=s.withKnife4jStorageWriteLock(async canWrite=>{window.entered=true;await gate;window.allowed=canWrite();if(allowed)localStorage.setItem('target','stale');return true},null,localStorage);true`,
      );
      for (let i = 0; i < 200 && !(await ev(a.sessionId, 'entered')); i++) await new Promise((r) => setTimeout(r, 10));
      assert.equal(await ev(a.sessionId, 'entered'), true);
      await ev(a.sessionId, 'window.tx.abort();true');
      assert.equal(await ev(a.sessionId, 'pending'), undefined);
      await ev(a.sessionId, 'release();true');
      assert.equal(await ev(a.sessionId, 'allowed'), false);
      assert.equal(await ev(a.sessionId, "localStorage.getItem('target')"), null);
      assert.equal(
        await ev(a.sessionId, "s.setKnife4jStorageItem(localStorage,'target','fresh',localStorage,null)"),
        true,
      );
      results.push({ transactionAbortRefusesResumedWrite: true, recovered: true });
      await cdp.send('Target.closeTarget', { targetId: a.targetId });
    }
    // Real page lifecycle freeze/resume, not merely an expired timestamp in a mock.
    for (const mode of ['web-locks', 'fallback']) {
      const a = await open(),
        b = await open();
      const lock = mode === 'web-locks' ? 'navigator.locks' : 'null';
      await ev(
        a.sessionId,
        `localStorage.clear();localStorage.setItem('target','initial');window.gate=new Promise(r=>window.release=r);window.entered=false;window.pending=s.withKnife4jStorageWriteLock(async canWrite=>{window.entered=true;await gate;window.allowed=canWrite();if(allowed)localStorage.setItem('target','first');},${lock},localStorage);true`,
      );
      for (let i = 0; i < 200 && !(await ev(a.sessionId, 'entered')); i++) await new Promise((r) => setTimeout(r, 10));
      assert.equal(await ev(a.sessionId, 'entered'), true);
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' }, a.sessionId);
      await ev(
        b.sessionId,
        `window.finished=false;window.pending=s.setKnife4jStorageItem(localStorage,'target','second',localStorage,${lock}).then(v=>{window.finished=true;return v});true`,
      );
      await new Promise((r) => setTimeout(r, 200));
      const early = await ev(b.sessionId, 'finished');
      await cdp.send('Page.setWebLifecycleState', { state: 'active' }, a.sessionId);
      await ev(a.sessionId, 'release();true');
      await ev(a.sessionId, 'pending');
      assert.equal(await ev(b.sessionId, 'pending'), true);
      assert.equal(await ev(b.sessionId, "localStorage.getItem('target')"), 'second');
      if (early) assert.equal(await ev(a.sessionId, 'allowed'), false);
      results.push({ mode, pageFrozenAndResumed: true, serializedOrFenceInvalidated: true });
      await cdp.send('Target.closeTarget', { targetId: a.targetId });
      await cdp.send('Target.closeTarget', { targetId: b.targetId });
    }
    return results;
  });
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  clearTimeout(timer);
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
