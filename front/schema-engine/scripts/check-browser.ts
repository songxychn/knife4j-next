const result = await Bun.build({
  entrypoints: [`${import.meta.dir}/../tests/browserEntry.ts`],
  target: 'browser',
  format: 'esm',
  minify: true,
  sourcemap: 'none',
  write: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const output = result.outputs.find((candidate) => candidate.path.endsWith('.js'));
if (!output) throw new Error('Browser build did not produce a JavaScript bundle.');

const bytes = new Uint8Array(await output.arrayBuffer());
const source = new TextDecoder().decode(bytes);
const findings = [
  { name: 'eval', pattern: /\beval\s*\(/ },
  { name: 'new Function', pattern: /new\s+Function\b/ },
  { name: 'Node built-in import', pattern: /["']node:/ },
]
  .filter(({ pattern }) => pattern.test(source))
  .map(({ name }) => name);

if (findings.length > 0) {
  throw new Error(`Browser bundle contains forbidden constructs: ${findings.join(', ')}`);
}

const gzipBytes = Bun.gzipSync(bytes, { level: 9 }).byteLength;
const maxGzipBytes = 40_000;
if (gzipBytes > maxGzipBytes) {
  throw new Error(`Browser bundle gzip size ${gzipBytes} exceeds the ${maxGzipBytes}-byte Phase 1 budget.`);
}

console.log(
  JSON.stringify({
    rawBytes: bytes.byteLength,
    gzipBytes,
    maxGzipBytes,
    dynamicCodeExecutionFindings: findings,
  }),
);
