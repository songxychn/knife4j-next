import { readFileSync } from 'node:fs'
import nodeBaseline from '../../scripts/check-node.cjs'

const { required, checkNode } = nodeBaseline
const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (engines?.node !== required) {
  throw new Error('Update check-node.mjs together with package.json engines.node')
}

if (!checkNode()) process.exit(1)
console.log(`Vue3 Node.js check passed: ${process.version}`)
