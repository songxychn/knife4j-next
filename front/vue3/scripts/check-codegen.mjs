import assert from 'node:assert/strict'
import {
  formatApi,
  getComment,
  getJsFunctionDeclaration,
  getTsFunctionDeclaration,
  getTsInterfaceDeclaration,
  upperFirstCase
} from '../src/core/ScriptGenerator.js'

// Exercise the production ScriptView generation path. Bun checks JS/TS syntax;
// these assertions check existing types and request behavior, not formatting.
const properties = [
  { name: 'name', type: 'string', require: true },
  { name: 'enabled', type: 'boolean', require: false },
  { name: 'count', type: 'integer(int64)', require: true },
  { name: 'meta', type: 'object', require: false },
  { name: 'rows', type: 'array', require: false },
  { name: 'nested', type: 'object', require: false, children: [{ name: 'value', type: 'number', require: true }] },
  { name: 'items', type: 'array', require: false, children: [{ name: 'label', type: 'string', require: false }] }
]
const path = [
  { in: 'path', name: 'id', type: 'integer(int32)' },
  { in: 'path', name: 'key', type: 'string' }
]
const query = [
  { in: 'query', name: 'search', type: 'string' },
  { in: 'query', name: 'page', type: 'integer(int64)' }
]
const routes = [
  { name: 'none', url: '/pets', parameters: [], args: [], signature: '', requestUrl: '/pets' },
  { name: 'path', url: '/pets/{id}/owners/{key}', parameters: path, args: [17, 'owner'], signature: 'id:number,key:string', requestUrl: '/pets/17/owners/owner' },
  { name: 'query', url: '/pets', parameters: query, args: ['cat', 2], signature: 'search:string,page:number', requestUrl: '/pets?search=cat&page=2' },
  { name: 'both', url: '/pets/{id}/owners/{key}', parameters: [...path, ...query], args: [17, 'owner', 'cat', 2], signature: 'id:number,key:string,search:string,page:number', requestUrl: '/pets/17/owners/owner?search=cat&page=2' }
]
const compact = code => code.replace(/\s+/g, '')

function checkInterface(code, name, optional) {
  const text = compact(code)
  const suffix = optional ? '\\?' : ''
  assert.match(text, new RegExp(`^exportinterface${name}\\{`))
  assert.match(text, /name:string;/)
  assert.match(text, /count:number;/)
  assert.match(text, new RegExp(`enabled${suffix}:boolean;`))
  assert.match(text, new RegExp(`meta${suffix}:Record<string,unknown>;`))
  assert.match(text, new RegExp(`rows${suffix}:Record<string,unknown>\\[\\];`))
  assert.match(text, new RegExp(`nested${suffix}:\\{value:number;?\\};`))
  assert.match(text, new RegExp(`items${suffix}:\\{label${suffix}:string;?\\}\\[\\];`))
}

function checkRequest(code, args, expectedMethod, expectedArgs) {
  const calls = []
  const result = Promise.resolve('request result')
  const request = new Proxy({}, {
    get: (_, method) => (...values) => {
      calls.push({ method, values })
      return result
    }
  })
  const fn = Function('request', `${code.replace(/^export\s+/gm, '')}\nreturn save;`)(request)
  assert.equal(fn(...args), result, 'generated function must return the request result')
  assert.deepEqual(calls, [{ method: expectedMethod, values: expectedArgs }])
  if (expectedArgs.length === 2) assert.equal(calls[0].values[1], expectedArgs[1], 'pass body through unchanged')
}

let count = 0
for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']) {
  for (const route of routes) {
    for (const body of ['none', 'object', 'array']) {
      for (const response of ['object', 'array']) {
        const label = `${method}/${route.name}/${body}/${response}`
        try {
          const parameters = structuredClone(route.parameters)
          if (body !== 'none') parameters.push({ in: 'body', name: 'payload', type: body, children: structuredClone(properties) })
          const api = {
            operationId: `saveUsing${method}`, methodType: method, url: route.url,
            summary: '保存 / Save', parameters, responseCodes: [{ code: '200' }],
            responseJson: response === 'array' ? [] : {},
            responseParameters: structuredClone(properties), responseRefParameters: []
          }
          const config = formatApi(api)
          const name = upperFirstCase(config.name)
          assert.equal(name, 'Save')
          const comment = getComment(api)
          assert.match(comment, /保存 \/ Save/)
          const js = comment + getJsFunctionDeclaration(config)
          const params = body === 'none' ? '' : getTsInterfaceDeclaration(config.bodyParams[0], 'SaveParams', true)
          const res = getTsInterfaceDeclaration(config.resParam, 'SaveRes', false)
          const tsFunction = getTsFunctionDeclaration(config, name)
          if (body !== 'none') checkInterface(params, 'SaveParams', true)
          checkInterface(res, 'SaveRes', false)
          const signature = [route.signature, body === 'object' ? 'params:SaveParams' : body === 'array' ? 'params:any[]' : ''].filter(Boolean).join(',')
          assert.ok(compact(tsFunction).startsWith(`exportfunctionsave(${signature}):Promise<SaveRes${response === 'array' ? '[]' : ''}>{`), 'TS parameters and response generic must survive')
          const value = body === 'array' ? [{ name: '样例' }] : { name: '样例' }
          const args = body === 'none' ? route.args : [...route.args, value]
          const expectedArgs = body === 'none' ? [route.requestUrl] : [route.requestUrl, value]
          checkRequest(js, args, method.toLowerCase(), expectedArgs)
          const stripped = new Bun.Transpiler({ loader: 'ts' }).transformSync(params + res + comment + tsFunction)
          checkRequest(stripped, args, method.toLowerCase(), expectedArgs)
          count++
        } catch (error) {
          throw new Error(`Code generation regression: ${label}`, { cause: error })
        }
      }
    }
  }
}

// Existing boundaries: unexpanded object/array omit an interface; empty or
// primitive response descriptors emit an empty interface. Do not add new types.
for (const optional of [true, false]) {
  for (const type of ['object', 'array']) {
    assert.equal(getTsInterfaceDeclaration({ type }, 'Edge', optional).trim(), '')
    assert.match(compact(getTsInterfaceDeclaration({ type, children: [] }, 'Edge', optional)), /^exportinterfaceEdge\{\}$/)
  }
  assert.match(compact(getTsInterfaceDeclaration({ type: 'string' }, 'Edge', optional)), /^exportinterfaceEdge\{\}$/)
}
const reference = formatApi({
  operationId: 'saveUsingGET', methodType: 'GET', url: '/pets', responseCodes: [], responseJson: {},
  responseParameters: [{ name: 'child', type: 'object', schemaValue: 'Child' }],
  responseRefParameters: [{ name: 'Child', params: [{ name: 'value', type: 'string' }] }]
})
assert.match(compact(getTsInterfaceDeclaration(reference.resParam, 'SaveRes', false)), /child:\{value:string;?\};/)
assert.equal(count, 168)
console.log(`Code generation checks passed: ${count} JS/TS request combinations plus interface boundaries`)
