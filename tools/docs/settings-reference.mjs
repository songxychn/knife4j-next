import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const modules = [
  ['knife4j-openapi2-spring-boot-starter', 'OAS2'],
  ['knife4j-openapi3-spring-boot-starter', 'OAS3 Boot2'],
  ['knife4j-openapi3-jakarta-spring-boot-starter', 'OAS3 Jakarta / Boot4'],
];
export const begin = '<!-- generated: settings-reference -->';
export const end = '<!-- /generated: settings-reference -->';

export function javaFacts(root, compiled = false) {
  const sources = modules.map(([module]) => resolve(root, 'knife4j', module,
    'src/main/java/com/github/xiaoymin/knife4j/spring/configuration/Knife4jSetting.java'));
  const discovered = [...new Bun.Glob('knife4j/*/src/main/java/**/Knife4jSetting.java').scanSync({ cwd: root })].map((path) => resolve(root, path));
  if (discovered.length !== sources.length || discovered.some((path) => !sources.includes(path))) {
    throw new Error('Knife4jSetting source set changed; review the documented module scope');
  }
  const command = [resolve(root, 'tools/docs/SettingFacts.java'),
    ...(compiled ? ['--compiled', root] : []), ...sources];
  const result = spawnSync('java', command, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`Java settings inspection failed (JDK 17+ required):\n${result.error ?? result.stderr}`);
  }
  return result.stdout.trim().split('\n').map((line) => JSON.parse(line));
}

function code(value) {
  return `\`${String(value).replaceAll('|', '&#124;').replaceAll('`', '&#96;')}\``;
}

export async function generatedTable(root, facts = javaFacts(root)) {
  const descriptions = JSON.parse(await readFile(resolve(root, 'docs/reference/settings-descriptions.json'), 'utf8'));
  const { extractKnife4jSettings } = await import(pathToFileURL(resolve(root, 'front/ui-react/src/utils/knife4jSettings.ts')).href);
  const names = [...new Set(facts.flatMap((item) => item.fields.map((field) => field.name)))];
  for (const name of [...names, ...Object.keys(descriptions)]) {
    if (!names.includes(name) || typeof descriptions[name] !== 'string' || !descriptions[name].trim()) {
      throw new Error(`settings-descriptions.json: missing or obsolete description: ${name}`);
    }
  }
  const input = {};
  for (const item of facts) for (const field of item.fields) {
    input[field.name] = field.type === 'String' ? 'docs-contract' : field.default;
  }
  input.language = 'zh_cn';
  input.enableFilterMultipartApiMethodType = 'POST';
  const consumed = extractKnife4jSettings({ 'x-openapi': { 'x-setting': input } });
  for (const name of Object.keys(consumed)) {
    if (!names.includes(name)) throw new Error(`React extracts undocumented backend field: ${name}`);
  }
  const rows = [
    begin,
    '',
    '此表由当前 Java 字段声明与 React 默认值读取函数生成。默认值指未配置时的字段初始值；“读取”不代表完整功能或安全边界已通过验收。',
    '',
    '| 属性 | 声明类型 | 声明默认值 | 说明 | React 读取默认值 |',
    '| --- | --- | --- | --- | --- |',
  ];
  const scoped = (values) => new Set(values).size === 1 ? values[0]
    : values.map((value, index) => `${modules[index][1]}: ${value}`).join('<br>');
  for (const name of names) {
    const fields = facts.map((item) => item.fields.find((field) => field.name === name));
    const types = fields.map((field) => field ? code(field.type) : '—');
    const defaults = fields.map((field) => !field ? '—' : field.default === null ? '`null`' : code(JSON.stringify(field.default)));
    rows.push(`| ${code(`knife4j.setting.${name}`)} | ${scoped(types)} | ${scoped(defaults)} | ${descriptions[name]} | ${Object.hasOwn(consumed, name) ? '✅' : '—'} |`);
  }
  rows.push('', end);
  return rows.join('\n');
}

export async function checkReference(root, { write = false, compiled = false } = {}) {
  const output = await generatedTable(root, javaFacts(root, compiled));
  const path = resolve(root, 'docs/reference/configuration.md');
  const source = await readFile(path, 'utf8');
  if (source.split(begin).length !== 2 || source.split(end).length !== 2 || source.indexOf(begin) > source.indexOf(end)) {
    throw new Error('configuration.md must contain one settings-reference marker pair');
  }
  const start = source.indexOf(begin);
  const stop = source.indexOf(end) + end.length;
  if (source.slice(start, stop) !== output) {
    if (!write) throw new Error('Settings reference drift: run bun tools/docs/settings-reference.mjs --write and review the diff');
    await writeFile(path, source.slice(0, start) + output + source.slice(stop));
  }
  return relative(root, path);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--root' && args[index + 1] && !args[index + 1].startsWith('--')) { index++; continue; }
    if (['--write', '--compiled'].includes(args[index])) continue;
    throw new Error(`Unknown or incomplete argument: ${args[index]}`);
  }
  const rootIndex = args.indexOf('--root');
  const root = rootIndex >= 0 ? resolve(args[rootIndex + 1]) : resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  try {
    await checkReference(root, { write: args.includes('--write'), compiled: args.includes('--compiled') });
    console.log(`Settings reference matches Java declarations and React reader${args.includes('--compiled') ? ' and compiled defaults' : ''}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
