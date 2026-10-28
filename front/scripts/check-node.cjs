const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const required = '26.x';

function isSupportedNode(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major] = version.split('.').map(Number);
  return major === 26;
}

function checkNode() {
  const { engines } = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
  if (engines?.node !== required) {
    throw new Error('Update check-node.cjs together with front/package.json engines.node');
  }
  if (!isSupportedNode(process.versions.node)) {
    console.error(
      `Front-end tooling requires Node.js ${required}; found ${process.version}. Use .nvmrc or another supported release.`,
    );
    return false;
  }
  return true;
}

module.exports = { required, isSupportedNode, checkNode };
if (require.main === module && !checkNode()) process.exit(1);
