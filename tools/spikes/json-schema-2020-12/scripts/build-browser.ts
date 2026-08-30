import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const spikeRoot = resolve(import.meta.dir, '..')
const outdir = resolve(spikeRoot, 'dist')

await rm(outdir, { recursive: true, force: true })
await mkdir(outdir, { recursive: true })

const result = await Bun.build({
  entrypoints: [resolve(spikeRoot, 'src/browser-probe.ts')],
  outdir,
  target: 'browser',
  format: 'esm',
  minify: true,
  sourcemap: 'none',
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

const output = result.outputs.find((candidate) => candidate.path.endsWith('.js'))
if (!output) {
  throw new Error('Bun did not produce a browser JavaScript bundle.')
}

const bytes = new Uint8Array(await output.arrayBuffer())
const source = new TextDecoder().decode(bytes)
const forbiddenPatterns = [
  { name: 'eval', pattern: /\beval\s*\(/ },
  { name: 'new Function', pattern: /new\s+Function\b/ },
  { name: 'Node built-in import', pattern: /["']node:/ },
]
const findings = forbiddenPatterns
  .filter(({ pattern }) => pattern.test(source))
  .map(({ name }) => name)

if (findings.length > 0) {
  throw new Error(`Browser bundle contains forbidden constructs: ${findings.join(', ')}`)
}

const hasher = new Bun.CryptoHasher('sha256')
hasher.update(bytes)
const report = {
  bun: Bun.version,
  entry: 'src/browser-probe.ts',
  output: basename(output.path),
  rawBytes: bytes.byteLength,
  gzipBytes: Bun.gzipSync(bytes, { level: 9 }).byteLength,
  sha256: hasher.digest('hex'),
  dynamicCodeExecutionFindings: findings,
}

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'">
    <title>Knife4j JSON Schema 2020-12 CSP probe</title>
  </head>
  <body data-status="pending">
    <output>pending</output>
    <script type="module" src="./${basename(output.path)}"></script>
  </body>
</html>
`

await Promise.all([
  Bun.write(resolve(outdir, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`),
  writeFile(resolve(outdir, 'index.html'), html),
])

console.log(JSON.stringify(report, null, 2))
