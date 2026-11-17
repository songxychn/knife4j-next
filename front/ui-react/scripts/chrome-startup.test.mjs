import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { waitForChromeDevTools } from './chrome-startup.mjs';

function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stderr: new PassThrough(),
    pid: 1054,
    exitCode: null,
    signalCode: null,
  });
}

function expectClean(child) {
  expect(child.stderr.listenerCount('data')).toBe(0);
  expect(child.listenerCount('error')).toBe(0);
  expect(child.listenerCount('close')).toBe(0);
}

test('timeout retains bounded stderr and startup context', async () => {
  const child = fakeChild();
  const failure = waitForChromeDevTools(child, { executable: '/fake/chrome', timeoutMs: 20 }).catch((e) => e);
  child.stderr.write('discarded-prefix' + 'x'.repeat(10000));
  child.stderr.write('\nSTARTUP_DIAGNOSTIC_1054: stalled before DevTools\n');
  const error = await failure;
  expect(error.message).toBe('Chrome did not expose DevTools');
  expect(error.chromeStartup).toMatchObject({
    reason: 'timeout',
    executable: '/fake/chrome',
    pid: 1054,
    timeoutMs: 20,
    exitCode: null,
    signal: null,
    runtime: { bun: process.versions.bun, platform: process.platform, arch: process.arch },
  });
  expect(error.chromeStartup.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(error.chromeStartup.stderrTail).toContain('STARTUP_DIAGNOSTIC_1054');
  expect(error.chromeStartup.stderrTail).not.toContain('discarded-prefix');
  expect(Buffer.byteLength(error.chromeStartup.stderrTail)).toBeLessThanOrEqual(8192);
  expectClean(child);
});

test('empty stderr is explicit on timeout', async () => {
  const child = fakeChild();
  const error = await waitForChromeDevTools(child, { timeoutMs: 5 }).catch((e) => e);
  expect(error.chromeStartup.stderrTail).toBe('');
  expectClean(child);
});

test('waits for a complete DevTools URL split across pipe chunks', async () => {
  const child = fakeChild();
  let settled = false;
  const ready = waitForChromeDevTools(child).then((url) => {
    settled = true;
    return url;
  });
  child.stderr.write('startup noise\nDevTools listening on ws://127.0.0.1:9222/devtools/brow');
  await Promise.resolve();
  expect(settled).toBe(false);
  child.stderr.write('ser/complete-id\r\n');
  expect(await ready).toBe('ws://127.0.0.1:9222/devtools/browser/complete-id');
  expectClean(child);
  child.stderr.write('later Chrome output');
  child.emit('close', 0, null);
});

test('recognizes readiness before a large diagnostic tail in the same chunk', async () => {
  const child = fakeChild();
  const ready = waitForChromeDevTools(child);
  child.stderr.write('DevTools listening on ws://127.0.0.1:9222/devtools/browser/id\n' + 'x'.repeat(20000));
  expect(await ready).toBe('ws://127.0.0.1:9222/devtools/browser/id');
  expectClean(child);
});

test('early exit includes stderr arriving after exit and before close', async () => {
  const child = fakeChild();
  const failure = waitForChromeDevTools(child).catch((e) => e);
  child.exitCode = 23;
  child.emit('exit', 23, null);
  child.stderr.write('final Chrome diagnostic');
  child.emit('close', 23, null);
  const error = await failure;
  expect(error.chromeStartup).toMatchObject({
    reason: 'closed',
    exitCode: 23,
    signal: null,
    stderrTail: 'final Chrome diagnostic',
  });
  expectClean(child);
});

test('signal exit is distinguished from a numeric exit', async () => {
  const child = fakeChild();
  const failure = waitForChromeDevTools(child).catch((e) => e);
  child.signalCode = 'SIGTERM';
  child.emit('close', null, 'SIGTERM');
  expect((await failure).chromeStartup).toMatchObject({ reason: 'closed', exitCode: null, signal: 'SIGTERM' });
  expectClean(child);
});

test('spawn error includes executable and original error', async () => {
  const child = spawn('/nonexistent/knife4j-1054-chrome', [], { stdio: ['ignore', 'ignore', 'pipe'] });
  const closed = new Promise((resolve) => child.once('close', resolve));
  const error = await waitForChromeDevTools(child, { executable: '/nonexistent/knife4j-1054-chrome' }).catch((e) => e);
  expect(error.message).toContain('ENOENT');
  expect(error.chromeStartup).toMatchObject({
    reason: 'spawn-error',
    executable: '/nonexistent/knife4j-1054-chrome',
    pid: null,
  });
  await closed;
  expectClean(child);
});

test('actual subprocess preserves final stderr on nonzero exit', async () => {
  const child = spawn(process.execPath, ['-e', "process.stderr.write('real startup failure'); process.exitCode=17"], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const error = await waitForChromeDevTools(child, { executable: process.execPath }).catch((e) => e);
  expect(error.chromeStartup).toMatchObject({ reason: 'closed', exitCode: 17, stderrTail: 'real startup failure' });
  expectClean(child);
});
