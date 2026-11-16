const stderrLimit = 8192;

// Only the startup handshake lives here; the caller owns and stops the process.
export function waitForChromeDevTools(child, { executable, timeoutMs = 15000 } = {}) {
  const started = Date.now();
  let stderr = Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      child.stderr.off('data', onData);
      child.off('error', onError);
      child.off('close', onClose);
      // Continue draining Chrome's pipe after the handshake without retaining it.
      child.stderr.resume();
    };
    const fail = (reason, message) => {
      const chromeStartup = {
        reason,
        executable,
        pid: child.pid ?? null,
        runtime: { bun: process.versions.bun ?? null, platform: process.platform, arch: process.arch },
        elapsedMs: Date.now() - started,
        timeoutMs,
        exitCode: child.exitCode ?? null,
        signal: child.signalCode ?? null,
        stderrTail: stderr.toString('utf8'),
      };
      cleanup();
      const error = new Error(message);
      error.chromeStartup = chromeStartup;
      reject(error);
    };
    const onData = (data) => {
      const chunk = Buffer.from(data);
      const output = stderr.toString('utf8') + chunk.toString('utf8');
      stderr = Buffer.concat([stderr, chunk.subarray(-stderrLimit)]).subarray(-stderrLimit);
      // Wait for a complete line: pipe chunks can split the WebSocket URL.
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)\r?\n/);
      if (match) {
        cleanup();
        resolve(match[1]);
      }
    };
    const onError = (error) => fail('spawn-error', `Chrome could not start: ${error.message}`);
    // close follows stdio drainage, unlike exit, so the final stderr is included.
    const onClose = (code, signal) => fail('closed', `Chrome exited before DevTools was ready (${code}, ${signal})`);
    const timeout = setTimeout(() => fail('timeout', 'Chrome did not expose DevTools'), timeoutMs);
    child.stderr.on('data', onData);
    child.once('error', onError);
    child.once('close', onClose);
  });
}
