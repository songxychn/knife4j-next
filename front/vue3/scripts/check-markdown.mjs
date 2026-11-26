import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { marked, enableMarkdownCodeRenderer } from '../src/core/markdown.js'

const read = file => readFile(new URL('../src/' + file, import.meta.url), 'utf8')
const dom = new JSDOM('')
function documentFor(html) {
  const document = dom.window.document.implementation.createHTMLDocument('')
  document.body.innerHTML = html
  return document
}

const headings = '# 中文 API\n\n# 中文 API\n\n# 中文 API-1\n\n## **Bold** `code` &amp; &#65; [Link](https://example.com)\n\n## <em>HTML</em> : Test!\n\n# A\n\n# A-1\n\n# A\n\n[跳转](#中文-api)'
const headingIds = ['中文-api', '中文-api-1', '中文-api-1-1', 'bold-code--a-link', 'html--test', 'a', 'a-1', 'a-2']
const mermaidText = 'flowchart TD\n A["a &amp; b"]-->B'
const content = headings + '\n\n' + [
  '| Name | Value |\n| :--- | ---: |\n| 中文 | **bold** |',
  '- [x] done\n- [ ] open',
  '~~old~~ https://example.com',
  'soft\nline',
  '<aside data-test="raw">原始 HTML</aside>',
  '<test@example.com>',
  '```json\n{"message":"中文"}\n```',
  '```\nplain text\n```',
  '```mermaid\n' + mermaidText + '\n```'
].join('\n\n')

function checkHeadings(html) {
  const document = documentFor(html)
  assert.deepEqual([...document.querySelectorAll('h1[id], h2[id]')].map(node => node.id), headingIds)
  assert.equal(decodeURIComponent(document.querySelector('a[href^="#"]').getAttribute('href')), '#中文-api')
  assert.equal(document.querySelector('#bold-code--a-link strong').textContent, 'Bold')
}
function checkContent(html, componentLoaded) {
  checkHeadings(html)
  const document = documentFor(html)
  assert.deepEqual([...document.querySelectorAll('table tbody td')].map(cell => cell.textContent), ['中文', 'bold'])
  assert.deepEqual([...document.querySelectorAll('input[type="checkbox"]')].map(input => [input.checked, input.disabled]), [[true, true], [false, true]])
  assert.equal(document.querySelector('del').textContent, 'old')
  assert.equal([...document.querySelectorAll('p')].find(node => node.textContent === 'soft\nline').querySelector('br'), null)
  assert.equal(document.querySelector('aside[data-test="raw"]').textContent, '原始 HTML')
  assert.equal(document.querySelector('a[href="mailto:test@example.com"]').textContent, 'test@example.com')
  assert.equal(document.querySelector('code.language-json').textContent.trimEnd(), '{"message":"中文"}')
  if (componentLoaded) {
    assert.equal(document.querySelector('pre.mermaid').textContent, 'flowchart TD\n A["a & b"]-->B')
    assert.equal(document.querySelector('code[class="language-"]').textContent, 'plain text')
  } else {
    assert.equal(document.querySelector('pre.mermaid'), null)
    assert.equal(document.querySelector('code.language-mermaid').textContent.trimEnd(), mermaidText)
  }
}

// Load the actual utility methods used by these consumers, without unrelated
// browser/storage imports. Fail if their declarations change instead of stubbing
// Markdown parsing or copying the Word formatter into the test.
const utils = await read('core/utils.js')
const methods = ['getValue', 'checkUndefined', 'arrNotEmpty', 'strNotBlank', 'toString'].map(name => {
  const method = utils.match(new RegExp('^  ' + name + '(?:\\([^\\n]*\\)|: function \\([^\\n]*\\)) \\{[\\s\\S]*?^  \\},', 'm'))
  assert.ok(method, `update utility loader for ${name}`)
  return method[0]
})
const KUtils = Function(`return ({${methods.join('\n')}})` )()

async function loadWord(file) {
  let source = await read('components/officeDocument/' + file)
  assert.match(source, /^import KUtils from '@\/core\/utils'\s*$/m)
  assert.match(source, /^import \{ marked \} from '@\/core\/markdown\.js'\s*$/m)
  source = source.replace(/^import KUtils from '@\/core\/utils'\s*$/m, '')
    .replace(/^import \{ marked \} from '@\/core\/markdown\.js'\s*$/m, '')
  assert.doesNotMatch(source, /^import\s/m, 'unexpected Word import: update loader')
  assert.doesNotMatch(source, /marked\.(?:use|setOptions|options)\s*\(/, 'consumers must not replace shared renderers')
  const name = source.match(/export default function (\w+)\(/)?.[1]
  assert.ok(name)
  return Function('marked', 'KUtils', source.replace('export default function', 'function') + `\nreturn ${name};`)(marked, KUtils)
}
const core = await read('core/Knife4jAsync.js')
assert.match(core, /^import \{ marked \} from '\.\/markdown\.js';?$/m)
assert.doesNotMatch(core, /marked\.(?:use|setOptions|options)\s*\(/)
const basicInfo = core.match(/SwaggerBootstrapUi\.prototype\.basicInfoOAS2 = function \(menu\) \{[\s\S]*?\n\}/)?.[0]
assert.ok(basicInfo, 'update loader when the OAS2 description consumer changes')
const parseInfo = Function('marked', 'KUtils', 'const SwaggerBootstrapUi = function() {};\n' + basicInfo + ';return SwaggerBootstrapUi.prototype.basicInfoOAS2;')(marked, KUtils)

const words = [
  { file: 'wordTransform.js', project: '1.项目说明', appendix: '3.附录' },
  { file: 'wordTransformUS.js', project: '1.Project', appendix: '3.appendix' }
]
for (const word of words) word.render = await loadWord(word.file)
function wordFixture() {
  return {
    title: '中文 Project', description: '<p>简介</p>', contact: 'Tester', host: 'example.com', basePath: '/',
    termsOfService: '', version: '1', name: 'group', url: '/v2/api-docs', location: '/v2/api-docs',
    tags: [{ name: 'Pets', childrens: [{ summary: '查询', methodType: 'GET', showUrl: '/pets', description: '描述',
      consumes: 'application/json', produces: 'application/json', reqParameters: [],
      responseCodes: [{ code: '200', description: '成功', schema: 'Pet' }], multipData: { data: [], responseValue: '{}' } }] }],
    markdownFiles: [{ name: '指南', children: [{ title: '详情', content }, { title: '第二篇', content: '# 中文 API' }] }]
  }
}
// Preserve legacy heading IDs both before and after component activation.
function checkLegacyHeadingIds() {
  const cases = [
    ['`<a>`', 'a'],
    ['`a &amp; b`', 'a-amp-b'],
    ['`a&#65;b`', 'a65b'],
    ['<https://example.com/?a=b&c=d>', 'httpsexamplecomabcd'],
    ['https://example.com/?a=b&c=d', 'httpsexamplecomabcd'],
    ['**a `x &amp; y` [*L*](https://example.com)**', 'a-x-amp-y-l'],
    ['[**`<a>`**](https://example.com)', 'a'],
    ['![**A** `<x>` &amp; &#65;](image.png)', 'a-x--a'],
    ['[![`<a>` &amp;](image.png)](https://example.com)', 'a'],
    ['![<em>image</em> **label** &copy;](image.png)', 'emimageem-label'],
    ['a &b &amp; &#65; \\<x\\>', 'a-b--a-x'],
    ['a &unknown; b &missing c', 'a--b-missing-c'],
    ['a&#x1F600;b', 'a\uf600b'], // V5 used String.fromCharCode, not fromCodePoint.
    ['<code>a &b <c></code>', 'a--'],
    ['<pre>a &amp; b</pre>', 'a--b']
  ]
  for (const [source, id] of cases) {
    const html = marked.parse('# ' + source)
    assert.equal(documentFor(html).querySelector('h1').id, id, source)
    assert.equal(marked.parse('# ' + source), html, 'heading ID state resets: ' + source)
  }
  const duplicates = '# `<a>`\n\n# a\n\n# `<a>`\n\n# a-1\n\n# a'
  assert.deepEqual([...documentFor(marked.parse(duplicates)).querySelectorAll('h1')].map(node => node.id), ['a', 'a-1', 'a-2', 'a-1-1', 'a-3'])
  assert.equal(documentFor(marked.parse('# `<a>`')).querySelector('code').textContent, '<a>')
  assert.equal(documentFor(marked.parse('# `a &amp; b`')).querySelector('code').textContent, 'a &amp; b')
}

function checkConsumers(componentLoaded) {
  checkLegacyHeadingIds()
  const context = { currentInstance: {} }
  parseInfo.call(context, { swagger: '2.0', host: 'example.com', info: { title: 'Demo', description: content }, paths: {} })
  checkContent(context.currentInstance.description, componentLoaded)
  for (const word of words) {
    const document = documentFor(word.render(wordFixture()))
    const titles = [...document.querySelectorAll('h1')].map(node => node.textContent)
    assert.ok(titles.includes(word.project), word.file)
    assert.ok(titles.includes(word.appendix), word.file)
    assert.equal(document.querySelectorAll('h1[id="中文-api"]').length, 2, 'each appendix parse starts a new heading counter')
    const first = document.querySelector('h1[id="中文-api"]').parentElement
    checkContent(first.innerHTML, componentLoaded)
    assert.ok(document.body.textContent.includes('/pets'))
    assert.ok(document.body.textContent.includes('200'))
  }
}

try {
  checkConsumers(false)
  const code = '<example>literal & text</example>'
  const escaped = documentFor(marked.parse('```html\n' + code + '\n```'))
  assert.equal(escaped.querySelector('code').textContent.trimEnd(), code, 'default renderer still escapes code before component load')
  assert.equal(escaped.querySelector('example'), null)
  assert.equal(marked.parse(headings), marked.parse(headings), 'heading counts reset on every parse')

  // Execute the actual component script; only CSS and Mermaid runtime are
  // substituted. SVG layout itself remains a browser acceptance check.
  const componentSource = await read('components/Markdown/index.vue')
  let script = componentSource.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script)
  const imports = [
    /^import "@\/assets\/css\/markdown-preview\.css";\s*$/m,
    /^import \{ marked, enableMarkdownCodeRenderer \} from '@\/core\/markdown\.js';\s*$/m
  ]
  for (const pattern of imports) { assert.match(script, pattern); script = script.replace(pattern, '') }
  assert.doesNotMatch(script, /^import\s/m)
  assert.match(script, /import\('mermaid'\)/, 'Mermaid stays a dynamic import')
  const calls = []
  const mermaid = { initialize: options => calls.push(['initialize', options]), run: options => calls.push(['run', options]) }
  let importResult = () => Promise.reject(new Error('offline'))
  const importMermaid = () => { calls.push(['import']); return importResult() }
  const component = Function('marked', 'enableMarkdownCodeRenderer', 'importMermaid',
    script.replace("import('mermaid')", 'importMermaid()').replace('export default', 'return'))(marked, enableMarkdownCodeRenderer, importMermaid)
  assert.deepEqual(calls, [], 'Mermaid is not loaded with the component')
  checkContent(component.computed.markdownSource.call({ source: content }), true)
  checkConsumers(true)
  const after = marked.parse(content)
  enableMarkdownCodeRenderer()
  assert.equal(marked.parse(content), after, 'component activation is idempotent')
  for (const word of words) word.render = await loadWord(word.file)
  checkConsumers(true)
  assert.equal(marked.parse(content), after, 'later Word loading preserves headings and code renderer')
  const instance = html => ({ ...component.methods, $el: documentFor('<div class="knife4j-markdown">' + html + '</div>').body.firstChild })
  const plain = instance(component.computed.markdownSource.call({ source: '# 无图表\n\n```json\n{}\n```' }))
  component.mounted.call(plain)
  component.updated.call(plain)
  assert.deepEqual(calls, [], 'documents without diagrams never load Mermaid')
  const diagram = instance(component.computed.markdownSource.call({ source: content }))
  await assert.rejects(diagram.renderMermaid(), /offline/)
  importResult = () => Promise.resolve({ default: mermaid })
  component.mounted.call(diagram)
  component.updated.call(diagram)
  await diagram.renderMermaid()
  assert.deepEqual(calls, [
    ['import'], ['import'], ['initialize', { logLevel: 5, startOnLoad: false }],
    ...Array(3).fill(['run', { querySelector: '.knife4j-markdown .mermaid' }])
  ], 'failed loads retry; a successful load initializes once and runs on mount/update')
  console.log('Markdown checks passed: shared headings, component activation order, OAS2 descriptions, and Chinese/English Word consumers')
} finally {
  dom.window.close()
}
