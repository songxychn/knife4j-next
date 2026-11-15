import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { JSDOM, VirtualConsole } from 'jsdom'
import { createWebJarResources, collectWebJarJsdomError } from './webjar-resources.mjs'

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
})
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })
function loaded(window) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Resource load did not settle')), 5000)
    window.addEventListener('load', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

test('WebJar jsdom resource restrictions and diagnostics', { timeout: 30000 }, async t => {
  const resourceRoot = await mkdtemp(path.join(tmpdir(), 'knife4j-webjar-resources-'))
  const externalHits = []
  const localHits = []
  const external = createServer((request, response) => { externalHits.push(request.url); response.end('body { color: red }') })
  let local
  try {
    const externalOrigin = await listen(external)
    local = createServer((request, response) => {
      localHits.push(request.url)
      if (request.url === '/redirect.css') {
        response.writeHead(302, { Location: externalOrigin + '/forbidden.css' }); response.end(); return
      }
      if (request.url === '/missing.css') { response.writeHead(404); response.end(); return }
      response.writeHead(200, { 'Content-Type': 'text/css' })
      response.end(request.url === '/import.css' ? `@import url("${externalOrigin}/forbidden.css");` : 'body { padding-left: 7px }')
    })
    const origin = await listen(local)
    const policy = createWebJarResources({ resourceRoot, origin })
    const { resourcePath, ...resourceOptions } = policy
    const file = path.join(resourceRoot, 'forbidden.css')
    await writeFile(file, 'body { padding-left: 99px }')

    async function probe(href, html = '') {
      const rawErrors = [], errors = []
      const virtualConsole = new VirtualConsole()
      virtualConsole.on('jsdomError', error => { rawErrors.push(error); collectWebJarJsdomError(errors, error) })
      const dom = new JSDOM(`<link rel="stylesheet" href="${href}">${html}`, { url: origin + '/doc.html', ...resourceOptions, virtualConsole })
      await loaded(dom.window)
      return { dom, rawErrors, errors }
    }

    await t.test('local root/demo resources and native computed styles remain usable', async () => {
      assert.equal(resourcePath(new URL(origin + '/demo/main.css')), path.join(resourceRoot, 'main.css'))
      for (const href of [origin + '/main.css', origin + '/demo/main.css']) {
        const { dom, errors } = await probe(href)
        try { assert.deepEqual(errors, []); assert.equal(dom.window.getComputedStyle(dom.window.document.body).paddingLeft, '7px') }
        finally { dom.window.close() }
      }
    })

    await t.test('dynamic stylesheet keeps native load event and computed styles', async () => {
      const { dom, errors } = await probe(origin + '/main.css')
      try {
        const link = dom.window.document.createElement('link')
        link.rel = 'stylesheet'; link.href = '/dynamic.css'
        const settled = new Promise((resolve, reject) => {
          link.addEventListener('load', resolve, { once: true })
          link.addEventListener('error', () => reject(new Error('Dynamic stylesheet failed')), { once: true })
        })
        dom.window.document.head.append(link)
        await settled
        assert.deepEqual(errors, []); assert.equal(dom.window.document.styleSheets.length, 2)
        assert.equal(dom.window.getComputedStyle(dom.window.document.body).paddingLeft, '7px')
      } finally { dom.window.close() }
    })

    const cases = [
      ['external HTTP', externalOrigin + '/forbidden.css', /External resource is forbidden/, []],
      ['external redirect', origin + '/redirect.css', /External resource is forbidden/, ['/redirect.css']],
      ['file URL', pathToFileURL(file).href, /External resource is forbidden/, []],
      ['data URL', 'data:text/css,body%7Bpadding-left:99px%7D', /External resource is forbidden/, []],
      ['encoded traversal', origin + '/%2e%2e%2fforbidden.css', /Resource escapes the WebJar/, []],
      ['demo encoded traversal', origin + '/demo/%2e%2e%2fforbidden.css', /Resource escapes the WebJar/, []],
    ]
    for (const [name, href, reason, expectedHits] of cases) {
      await t.test(name + ' is rejected before forbidden I/O with its cause retained', async () => {
        const before = localHits.length
        const { dom, rawErrors, errors } = await probe(href)
        try {
          assert.equal(dom.window.document.styleSheets.length, 0)
          assert.equal(rawErrors.length, 1)
          assert.equal(rawErrors[0].type, 'resource-loading')
          assert.match(rawErrors[0].cause.message, reason)
          assert.equal(errors.length, 1); assert.match(errors[0], /resource-loading/); assert.match(errors[0], reason)
          assert.deepEqual(localHits.slice(before), expectedHits)
          assert.deepEqual(externalHits, [])
        } finally { dom.window.close() }
      })
    }

    await t.test('CSS import cannot bypass the same policy', async () => {
      const { dom, rawErrors, errors } = await probe(origin + '/import.css')
      try {
        assert(rawErrors.some(error => error.type === 'resource-loading' && /External resource is forbidden/.test(error.cause?.message)))
        assert(errors.some(error => /External resource is forbidden/.test(error))); assert.deepEqual(externalHits, [])
      } finally { dom.window.close() }
    })

    await t.test('missing local resource is still a resource-loading failure', async () => {
      const { dom, rawErrors, errors } = await probe(origin + '/missing.css')
      try { assert.equal(rawErrors[0].type, 'resource-loading'); assert.match(errors[0], /Status code: 404/) }
      finally { dom.window.close() }
    })

    await t.test('only css-parsing is excluded; actual runtime and unsupported API errors remain', () => {
      const rawErrors = [], errors = []
      const virtualConsole = new VirtualConsole()
      virtualConsole.on('jsdomError', error => { rawErrors.push(error); collectWebJarJsdomError(errors, error) })
      const dom = new JSDOM('<script>throw new Error("runtime-probe")</script>', { runScripts: 'dangerously', virtualConsole })
      try {
        dom.window.alert('unsupported-probe')
        assert(rawErrors.some(error => error.type === 'unhandled-exception'))
        assert(rawErrors.some(error => error.type === 'not-implemented'))
        assert(errors.some(error => /unhandled-exception.*runtime-probe/.test(error)))
        assert(errors.some(error => /not-implemented/.test(error)))
        const before = errors.length
        collectWebJarJsdomError(errors, { type: 'css-parsing', message: 'known CSS parser gap' })
        assert.equal(errors.length, before)
        collectWebJarJsdomError(errors, { type: 'unknown-future-error', message: 'do not suppress' })
        assert.match(errors.at(-1), /unknown-future-error: do not suppress/)
      } finally { dom.window.close() }
    })

    await t.test('private dispatcher shape changes fail closed before parsing can fetch', () => {
      for (const mutate of [window => { delete window._settings }, window => { window._settings.dispatcher = {} }, window => { window._settings.dispatcher.dispatch = null }]) {
        const before = localHits.length
        assert.throws(() => new JSDOM(`<link rel="stylesheet" href="${origin}/must-not-load.css">`, {
          url: origin, resources: policy.resources,
          beforeParse(window) { mutate(window); policy.beforeParse(window) },
        }), /jsdom resource dispatcher contract changed/)
        assert.equal(localHits.length, before)
      }
    })

    await t.test('changed dispatch URL/error-handler shapes cannot reach underlying I/O', () => {
      let calls = 0
      const fake = { _settings: { dispatcher: { dispatch() { calls++; return true } } } }
      policy.beforeParse(fake)
      const diagnostics = []
      assert.equal(fake._settings.dispatcher.dispatch({}, { onResponseError(_, error) { diagnostics.push(error.message) } }), false)
      assert.match(diagnostics[0], /jsdom resource URL contract changed/)
      assert.throws(() => fake._settings.dispatcher.dispatch({ opaque: { url: origin + '/main.css' } }, {}), /jsdom resource error handler contract changed/)
      assert.equal(calls, 0)
    })

    assert.deepEqual(externalHits, [])
  } finally {
    await Promise.all([close(external), ...(local ? [close(local)] : [])])
    await rm(resourceRoot, { recursive: true, force: true })
  }
})
