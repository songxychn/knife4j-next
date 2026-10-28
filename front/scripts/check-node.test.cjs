const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { required, isSupportedNode } = require('./check-node.cjs');

const root = resolve(__dirname, '../..');

test('supports the unified stable Node range and rejects old, excluded and prerelease versions', () => {
  for (const version of ['24.15.0', '24.22.1', '26.0.0', '26.1.0', '27.0.0']) {
    assert.equal(isSupportedNode(version), true, version);
  }
  for (const version of [
    '20.19.0',
    '22.23.4',
    '23.0.0',
    '24.0.0',
    '24.14.99',
    '25.9.0',
    '24.15.0-rc.1',
    '26.0.0-rc.1',
    'invalid',
  ]) {
    assert.equal(isSupportedNode(version), false, version);
  }
});

test('all frontend manifests declare the same baseline and .nvmrc selects its LTS line', () => {
  for (const path of ['front/package.json', 'front/vue3/package.json', 'docs/package.json']) {
    assert.equal(JSON.parse(readFileSync(resolve(root, path), 'utf8')).engines.node, required, path);
  }
  assert.equal(readFileSync(resolve(root, '.nvmrc'), 'utf8').trim(), '24');
});

test('unsupported Node is rejected before compiler loading or dependency installation', () => {
  const area = mkdtempSync(join(tmpdir(), 'knife4j-node-gate-'));
  try {
    const override = join(area, 'version.cjs');
    writeFileSync(override, "Object.defineProperty(process.versions, 'node', { value: '25.0.0' });\n");
    const marker = join(area, 'bun-called');
    writeFileSync(join(area, 'bun'), `#!/bin/sh\ntouch '${marker}'\nexit 99\n`, { mode: 0o755 });
    writeFileSync(join(area, 'node'), `#!/bin/sh\nexec '${process.execPath}' --require '${override}' "$@"\n`, {
      mode: 0o755,
    });
    const env = { ...process.env, PATH: `${area}:${process.env.PATH}` };
    const entries = [
      ['node', ['front/scripts/check-node.cjs']],
      ['node', ['front/scripts/tsc.cjs']],
      ['node', ['front/vue3/scripts/check-node.mjs']],
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
