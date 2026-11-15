const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const required = '1.4.x';

function isSupportedBun(version) {
  return typeof version === 'string' && /^1\.4\.\d+$/.test(version);
}

function checkBun() {
  const { engines } = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
  if (engines?.bun !== required) {
    throw new Error('Update check-bun.cjs together with front/package.json engines.bun');
  }
  if (!isSupportedBun(process.versions.bun)) {
    console.error(
      `Front-end tooling requires stable Bun ${required}; found ${process.versions.bun ?? 'a different runtime'}. See .bun-version for the supported version range.`,
    );
    return false;
  }
  return true;
}

module.exports = { required, isSupportedBun, checkBun };
if (require.main === module && !checkBun()) process.exit(1);
