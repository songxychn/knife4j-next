const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { required, isSupportedBun } = require('./check-bun.cjs');

const root = resolve(__dirname, '../..');

test('supports stable Bun 1.4 patches and rejects other runtimes and prereleases', () => {
  for (const version of ['1.4.4', '1.4.5', '1.4.99']) assert.equal(isSupportedBun(version), true, version);
  for (const version of [
    undefined,
    '',
    '1.4.0',
    '1.4.3',
    '1.3.99',
    '1.5.0',
    '2.0.0',
    '1.4.0-canary.1',
    '26.0.0',
    'invalid',
  ]) {
    assert.equal(isSupportedBun(version), false, String(version));
  }
});

test('frontend manifests and CI baseline select Bun 1.4', () => {
  for (const path of ['front/package.json', 'front/vue3/package.json', 'docs/package.json']) {
    const { engines } = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
    assert.equal(engines.bun, required, path);
    assert.equal(engines.node, undefined, path);
  }
  assert.ok(isSupportedBun(readFileSync(resolve(root, '.bun-version'), 'utf8').trim()));
});

test('unsupported Bun is rejected before compiler loading or dependency installation', () => {
  const area = mkdtempSync(join(tmpdir(), 'knife4j-bun-gate-'));
  try {
    const override = join(area, 'version.cjs');
    writeFileSync(override, "Object.defineProperty(process.versions, 'bun', { value: '1.3.99' });\n");
    const marker = join(area, 'install-called');
    writeFileSync(
      join(area, 'bun'),
      `#!/bin/sh\nif [ "$1" = install ]; then touch '${marker}'; exit 99; fi\nexec '${process.execPath}' --preload '${override}' "$@"\n`,
      { mode: 0o755 },
    );
    const env = { ...process.env, PATH: `${area}:${process.env.PATH}` };
    const entries = [
      ['bun', ['front/scripts/check-bun.cjs']],
      ['bun', ['front/scripts/tsc.cjs']],
      ['bash', ['tools/test-front-core.sh']],
      ['bash', ['tools/test-vue3.sh']],
      ['bash', ['tools/test-docs.sh']],
      ['bash', ['tools/sync-knife4x-ui.sh', '--check']],
    ];
    for (const [command, args] of entries) {
      const result = spawnSync(command, args, {
        cwd: root,
        env,
        encoding: 'utf8',
      });
      assert.equal(result.status, 1, `${args.join(' ')}: ${result.stderr}`);
      assert.ok(result.stderr.includes(required), result.stderr);
      assert.equal(existsSync(marker), false, args.join(' '));
    }
  } finally {
    rmSync(area, { recursive: true, force: true });
  }
});

test('Node-free runner hides standalone Node and preserves arguments and exit status', () => {
  const area = mkdtempSync(join(tmpdir(), 'knife4j-no-node-'));
  try {
    const marker = join(area, 'node-called');
    writeFileSync(join(area, 'node'), `#!/bin/sh\ntouch '${marker}'\nexit 99\n`, { mode: 0o755 });
    const result = spawnSync(
      resolve(root, 'tools/without-node.sh'),
      [
        'bash',
        '-c',
        'if command -v node || command -v nodejs; then exit 91; fi; [ "$1" = "argument with spaces" ] || exit 92; exit 23',
        '_',
        'argument with spaces',
      ],
      { env: { ...process.env, PATH: `${area}:${process.env.PATH}` }, encoding: 'utf8' },
    );
    assert.equal(result.status, 23, result.stderr);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(area, { recursive: true, force: true });
  }
});
