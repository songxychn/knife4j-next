import { test, expect, setDefaultTimeout } from 'bun:test';

// Each mutation launches javac; keep this bounded on CI's shared runners.
setDefaultTimeout(30_000);
import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkReference, modules, javaFacts } from './settings-reference.mjs';

const repository = resolve(import.meta.dir, '../..');
async function fixture(run) {
  const root = await mkdtemp(resolve(tmpdir(), 'knife4j-doc-settings-'));
  try {
    const paths = [
      'tools/docs/SettingFacts.java', 'docs/reference/configuration.md',
      'docs/reference/settings-descriptions.json',
      'front/ui-react/src/utils/knife4jSettings.ts', 'front/ui-react/src/locales/language.ts',
      ...modules.map(([module]) => `knife4j/${module}/src/main/java/com/github/xiaoymin/knife4j/spring/configuration/Knife4jSetting.java`),
    ];
    for (const path of paths) {
      await mkdir(dirname(resolve(root, path)), { recursive: true });
      await cp(resolve(repository, path), resolve(root, path));
    }
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('current reference passes, including the actual backend reader', () => fixture(async (root) => {
  await checkReference(root);
}));

test('changing a Java default fails until the scoped table is regenerated', () => fixture(async (root) => {
  const path = resolve(root, `knife4j/${modules[0][0]}/src/main/java/com/github/xiaoymin/knife4j/spring/configuration/Knife4jSetting.java`);
  await writeFile(path, (await readFile(path, 'utf8')).replace('enableSearch = true', 'enableSearch = false'));
  await expect(checkReference(root)).rejects.toThrow('Settings reference drift');
  await checkReference(root, { write: true });
  expect(await readFile(resolve(root, 'docs/reference/configuration.md'), 'utf8')).toContain('OAS2: `false`');
  await checkReference(root);
}));

test('a React output with no backend field fails without copying its field list', () => fixture(async (root) => {
  const path = resolve(root, 'front/ui-react/src/utils/knife4jSettings.ts');
  await writeFile(path, (await readFile(path, 'utf8')).replace('next.enableSearch = enableSearch', 'next.enableSearch_REMOVED = enableSearch'));
  await expect(checkReference(root)).rejects.toThrow('React extracts undocumented backend field');
}));

test('new fields require an authored description and obsolete descriptions fail', () => fixture(async (root) => {
  const path = resolve(root, 'docs/reference/settings-descriptions.json');
  const descriptions = JSON.parse(await readFile(path, 'utf8'));
  descriptions.noSuchSetting = 'stale';
  await writeFile(path, JSON.stringify(descriptions));
  await expect(checkReference(root)).rejects.toThrow('obsolete description');
}));

test('unsupported default expressions fail explicitly instead of guessing', () => fixture(async (root) => {
  const path = resolve(root, `knife4j/${modules[0][0]}/src/main/java/com/github/xiaoymin/knife4j/spring/configuration/Knife4jSetting.java`);
  await writeFile(path, (await readFile(path, 'utf8')).replace('enableSearch = true', 'enableSearch = Boolean.getBoolean("test")'));
  expect(() => javaFacts(root)).toThrow('unsupported default expression');
}));

test('removing a React read invalidates the generated reading column', () => fixture(async (root) => {
  const path = resolve(root, 'front/ui-react/src/utils/knife4jSettings.ts');
  await writeFile(path, (await readFile(path, 'utf8')).replace('next.enableSearch = enableSearch;', '; /* no longer read */'));
  await expect(checkReference(root)).rejects.toThrow('Settings reference drift');
}));

test('new Java fields need a description and type changes invalidate the table', () => fixture(async (root) => {
  const path = resolve(root, `knife4j/${modules[0][0]}/src/main/java/com/github/xiaoymin/knife4j/spring/configuration/Knife4jSetting.java`);
  const original = await readFile(path, 'utf8');
  await writeFile(path, original.replace('private boolean enableSearch', 'private boolean newSetting;\n    private boolean enableSearch'));
  await expect(checkReference(root)).rejects.toThrow('missing or obsolete description: newSetting');
  await writeFile(path, original.replace('private boolean enableSearch', 'private Boolean enableSearch'));
  await expect(checkReference(root)).rejects.toThrow('Settings reference drift');
}));

test('compiled verification detects a constructor overriding the declared default', () => fixture(async (root) => {
  const module = resolve(root, 'knife4j', modules[0][0]);
  const path = resolve(module, 'src/main/java/com/github/xiaoymin/knife4j/spring/configuration/Knife4jSetting.java');
  await writeFile(path, `package com.github.xiaoymin.knife4j.spring.configuration;
public class Knife4jSetting {
  private boolean enableSearch = true;
  public Knife4jSetting() { enableSearch = false; }
}`);
  const compiled = spawnSync('javac', ['-d', resolve(module, 'target/classes'), path], { encoding: 'utf8' });
  expect(compiled.status, compiled.stderr).toBe(0);
  expect(() => javaFacts(root, true)).toThrow('compiled default differs for enableSearch');
}));
