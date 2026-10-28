#!/usr/bin/env node
// #949: compare generator algorithms against the same current session/engine.
// Run after `cd front && bun install --frozen-lockfile` and core/engine builds.
// Usage from the repository root:
// node tools/assess-schema-example-search.mjs [baseline-ref] [head-ref] [report.json]
// The JSON report is the deliverable; this does not modify product sources.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [
  baselineRef = "a0cd07155b9c86f1d25a7f1636ccf0f0a89f5ba2",
  headRef = "HEAD",
  outputArg = "/tmp/schema-example-search-949.json",
] = process.argv.slice(2);
const output = resolve(outputArg);
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
const sourcePath = "front/ui-react/src/schema/schemaExampleGeneration.ts";
const refs = [baselineRef, headRef].map((ref) =>
  git("rev-parse", "--verify", ref + "^{commit}"),
);
// The session/engine are deliberately shared. Reject tracked changes to their
// owning sources so the host revision in the report identifies that runtime.
execFileSync(
  "git",
  [
    "diff",
    "--exit-code",
    "HEAD",
    "--",
    "front/ui-react/src/schema",
    "front/schema-engine",
    "front/core",
    "front/bun.lock",
  ],
  { cwd: root, stdio: "pipe" },
);
const sources = refs.map((ref) =>
  execFileSync("git", ["show", ref + ":" + sourcePath], {
    cwd: root,
    encoding: "utf8",
  }),
);
const directory = mkdtempSync(
  join(root, "front/ui-react/src/schema/assessment949-"),
);

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error("Instrumentation site changed: " + before);
  return source.replace(before, after);
}

function instrument(source) {
  // Counters observe existing calls/returns; they never alter values or budgets.
  source = replaceOnce(
    source,
    "ctx.budget.nodes += 1;",
    "ctx.budget.nodes += 1; metrics.visits += 1;",
  );
  source = replaceOnce(
    source,
    "ctx.budget.references += 1;",
    "ctx.budget.references += 1; metrics.references += 1;",
  );
  source = replaceOnce(
    source,
    "return structuredClone(value);",
    "metrics.cloneCalls += 1; metrics.clonedNodes += countNodes(value); return structuredClone(value);",
  );
  source = replaceOnce(
    source,
    "async function buildCandidates(schema: JsonValue, ctx: SearchContext): Promise<JsonValue[]> {",
    "async function buildCandidatesImpl(schema: JsonValue, ctx: SearchContext): Promise<JsonValue[]> {",
  );
  source += `
export const metrics = { visits: 0, references: 0, cloneCalls: 0, clonedNodes: 0, builds: 0, localReturnedCandidates: 0, rootBuilds: 0, rootReturnedCandidates: 0 };
export function resetMetrics() { for (const key of Object.keys(metrics)) metrics[key as keyof typeof metrics] = 0; }
function countNodes(value: JsonValue): number {
  let count = 0;
  const pending = [value];
  while (pending.length) {
    const item = pending.pop(); count += 1;
    if (item !== null && typeof item === 'object') pending.push(...Object.values(item));
  }
  return count;
}
async function buildCandidates(schema: JsonValue, ctx: SearchContext): Promise<JsonValue[]> {
  metrics.builds += 1;
  if (ctx.depth === 0) metrics.rootBuilds += 1;
  const result = await buildCandidatesImpl(schema, ctx);
  metrics.localReturnedCandidates += result.length;
  if (ctx.depth === 0) metrics.rootReturnedCandidates += result.length;
  return result;
}
`;
  return source;
}

const testSource = String.raw`
import { test, expect, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as sessions from '../schemaDocumentSession';
import * as oldMeasured from './old-measured';
import * as newMeasured from './new-measured';
import * as oldPlain from './old-plain';
import * as newPlain from './new-plain';

const reference = '#/components/schemas/Value';
const legacy = { maxCandidates: 48, maxDepth: 8, maxNodes: 320, maxReferences: 64, maxEvaluations: 48, maxStringLength: 256, maxArrayLength: 16 };
const roomy = { ...legacy, maxNodes: 10000, maxReferences: 1024 };
const profiles = { legacy, roomy };
const variants = [
  ['old', oldPlain, oldMeasured],
  ['current', newPlain, newMeasured],
] as const;
function wide(n: number, required = n) {
  const names = Array.from({ length: n }, (_, i) => 'field' + i);
  return { type: 'object', properties: Object.fromEntries(names.map(name => [name, { type: 'string' }])), required: names.slice(0, required), additionalProperties: false };
}
const fixtures = [
  { name: 'wide10', schema: wide(10) },
  { name: 'wide100', schema: wide(100) },
  { name: 'mixed100', schema: wide(100, 70) },
  { name: 'wide1000', schema: wide(1000) },
  { name: 'shared-ref30', schema: { ...wide(30), properties: Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['field' + i, { $ref: '#/components/schemas/Text' }])) }, extra: { Text: { type: 'string' } } },
  { name: 'allOf20', schema: { type: 'object', allOf: [wide(20), { type: 'object', properties: { field0: { minLength: 1 } } }] } },
  { name: 'alternative', schema: { anyOf: [{ type: 'integer', not: {} }, { type: 'boolean' }] } },
  { name: 'optional-recursion', schema: { type: 'object', properties: { id: { type: 'string' }, next: { $ref: reference } }, required: ['id'], additionalProperties: false } },
  { name: 'unsatisfiable', schema: { type: 'string', minLength: 2, maxLength: 1 }, negative: true },
  { name: 'direction', schema: { type: 'object', properties: { id: { type: 'string', readOnly: true }, password: { type: 'string', writeOnly: true }, label: { type: 'string' } }, required: ['id', 'password', 'label'], additionalProperties: false } },
  { name: 'invalid-media-example', schema: { type: 'integer' }, explicit: [{ source: 'media-example', value: 'author' }] },
  { name: 'invalid-root-example', schema: { type: 'integer', examples: ['author'] } },
  { name: 'node-budget', schema: wide(10), limits: { maxNodes: 1 }, budgetFailure: true },
  { name: 'evaluation-budget', schema: { type: 'integer', not: { enum: [0, 1] } }, limits: { maxEvaluations: 1 }, budgetFailure: true },
  { name: 'cancelled', schema: wide(10), cancel: true },
];
const rows: unknown[] = [];
function normalized(result: any) {
  if (result.status === 'value') return { status: result.status, value: result.value, source: result.source, authored: result.authored, validation: result.validation, diagnostics: result.diagnostics };
  return { status: result.status, reason: result.reason, diagnostics: result.diagnostics };
}
async function run(module: any, fixture: any, version: string, direction: 'request' | 'response', limits: any) {
  const session = await sessions.createSchemaDocumentSession({ openapi: version, info: { title: 'Assessment 949', version: '1' }, paths: {}, components: { schemas: { Value: fixture.schema, ...fixture.extra } } } as any, 'https://assessment.knife4j.example/document.json');
  const controller = new AbortController();
  if (fixture.cancel) controller.abort();
  let evaluations = 0;
  const original = sessions.evaluateSchemaDocumentDirectionally;
  const spy = vi.spyOn(sessions, 'evaluateSchemaDocumentDirectionally').mockImplementation(async (...args) => {
    evaluations += 1;
    return original(...args);
  });
  module.resetMetrics?.();
  try {
    const result = await module.generateSchemaExample(session, reference, { direction, limits, signal: controller.signal, explicit: fixture.explicit });
    expect(fixture.cancel).not.toBe(true);
    const counters = { ...module.metrics, evaluations };
    spy.mockRestore();
    // Independent complete directional validation is outside the measured region.
    if (result.status === 'value' && !result.authored) {
      expect((await original(session, reference, result.value, direction)).valid).toBe(true);
      if (fixture.name.startsWith('wide') || fixture.name === 'mixed100' || fixture.name === 'shared-ref30')
        expect(Object.keys(result.value)).toHaveLength(Object.keys(fixture.schema.properties).length);
      if (fixture.name === 'direction') {
        expect(result.value).toEqual(direction === 'request' ? { password: '', label: '' } : { id: '', label: '' });
      }
    }
    if (fixture.negative) expect(result.status).toBe('none');
    if (fixture.budgetFailure) expect(result).toMatchObject({ status: 'none', reason: 'search-budget-exceeded' });
    if (fixture.name.startsWith('invalid-')) expect(result).toMatchObject({ status: 'value', value: 'author', authored: true, validation: 'invalid' });
    return { result: normalized(result), counters };
  } catch (error: any) {
    if (error.name !== 'AbortError' || !fixture.cancel) throw error;
    return { result: { status: 'aborted', name: error.name }, counters: { ...module.metrics, evaluations } };
  } finally {
    spy.mockRestore();
    session.dispose();
  }
}
test('same-budget algorithm assessment', async () => {
  for (const version of ['3.1.1', '3.2.0']) {
    for (const direction of ['request', 'response'] as const) {
      for (const [profile, limits] of Object.entries(profiles)) {
        for (const fixture of fixtures) {
          for (const [algorithm, plain, measured] of variants) {
            const effective = { ...limits, ...fixture.limits };
            const control = await run(plain, fixture, version, direction, effective);
            const observed = await run(measured, fixture, version, direction, effective);
            // Instrumentation must preserve the complete public result for each algorithm.
            expect(observed.result).toEqual(control.result);
            if (profile === 'roomy' && fixture.name === 'allOf20') {
              expect(observed.result).toMatchObject({ status: 'value', validation: 'valid' });
              expect(Object.keys((observed.result as any).value)).toHaveLength(20);
              expect((observed.result as any).value.field0.length).toBeGreaterThanOrEqual(1);
            }
            rows.push({ version, direction, profile, fixture: fixture.name, algorithm, limits: effective, ...observed });
          }
          // Differences across algorithms are reported, never silently called regressions.
        }
      }
    }
  }
  writeFileSync(process.env.ASSESSMENT_949_ROWS!, JSON.stringify({ rows, currentDefaults: newMeasured.DEFAULT_SCHEMA_EXAMPLE_LIMITS }, null, 2) + '\n');
}, 180000);
`;

try {
  for (const [index, name] of ["old", "new"].entries()) {
    const source = sources[index].replaceAll("from './", "from '../");
    writeFileSync(join(directory, name + "-plain.ts"), source);
    writeFileSync(join(directory, name + "-measured.ts"), instrument(source));
  }
  writeFileSync(join(directory, "assessment.test.ts"), testSource);
  const rowsFile = join(directory, "rows.json");
  const relativeTest =
    "src/schema/" + directory.split("/").pop() + "/assessment.test.ts";
  const execution = spawnSync("bun", ["run", "test", "run", relativeTest], {
    cwd: join(root, "front/ui-react"),
    stdio: "inherit",
    env: { ...process.env, ASSESSMENT_949_ROWS: rowsFile },
  });
  if (execution.error) throw execution.error;
  if (execution.status !== 0)
    throw new Error("Assessment assertions failed: " + execution.status);
  const { rows, currentDefaults } = JSON.parse(readFileSync(rowsFile, "utf8"));
  const report = {
    baseline: refs[0],
    head: refs[1],
    hostHead: git("rev-parse", "HEAD"),
    runtime: {
      node: process.version,
      bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(),
    },
    sourceSha256: sources.map((source) =>
      createHash("sha256").update(source).digest("hex"),
    ),
    currentDefaults,
    methodology:
      "Both algorithm snapshots use the working tree session/engine. Common budgets are explicit; current-only construction/output/choice/time limits remain active. No wall-clock speedup claim. clone counters count structuredClone calls/subtree nodes only, not object spread or all allocations. Local returned candidates sum buildCandidates returns, not simultaneous/live allocations. Each measured result is checked against its uninstrumented control; every generated value is independently directionally validated.",
    rows,
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    "Assessment report: " +
      output +
      " (" +
      rows.length +
      " measured runs, same number of controls)",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
