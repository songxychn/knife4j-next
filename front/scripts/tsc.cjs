// Production compilation uses TS7; ESLint and ts-jest keep the TS6 API alias.
if (!require('./check-node.cjs').checkNode()) process.exit(1);
const { readFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

// Resolve the exported manifest, since TS7 does not export typescript/bin/tsc.
const manifestPath = require.resolve('@typescript/native/package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const compilerPath = resolve(dirname(manifestPath), manifest.bin.tsc);
const result = spawnSync(process.execPath, [compilerPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
else process.exit(result.status ?? 1);
