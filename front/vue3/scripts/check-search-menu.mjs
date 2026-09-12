import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KNIFE4J_ROUTE_PROXY_HEADER } from '../src/core/routeProxyHeader.js'
import { filterMenuBySearchKey } from '../src/core/searchMenu.js'
import KUtils from '../src/core/utils.js'

const failures = []
const vue3SrcRoot = join(dirname(fileURLToPath(import.meta.url)), '../src')
const typoHeader = 'knfie4j-gateway-request'
const sourceFiles = [
  'core/Knife4jAsync.js',
  'core/routeProxyHeader.js',
  'core/searchMenu.js',
  'layouts/BasicLayout.vue',
  'views/api/Debug.vue',
]

if (KNIFE4J_ROUTE_PROXY_HEADER !== 'knife4j-gateway-request') {
  failures.push(`route proxy header must be knife4j-gateway-request, got ${KNIFE4J_ROUTE_PROXY_HEADER}`)
}

for (const relativePath of sourceFiles) {
  const source = await readFile(join(vue3SrcRoot, relativePath), 'utf8')
  if (source.includes(typoHeader)) {
    failures.push(`${relativePath} still contains ${typoHeader}`)
  }
}

const menus = [
  {
    groupName: 'default',
    groupId: 'default',
    key: 'tag-user',
    name: '用户管理',
    icon: 'user',
    path: '/tag-user',
    hasNew: false,
    authority: null,
    children: [
      { url: '/pets', name: 'listPets', description: 'list pets' },
      { url: '/orders', name: 'listOrders', description: 'list orders' },
    ],
  },
  {
    groupName: 'default',
    groupId: 'default',
    key: 'tag-order',
    name: '订单',
    icon: 'order',
    path: '/tag-order',
    hasNew: false,
    authority: null,
    children: [
      { url: '/checkout', name: 'checkout', description: 'pay now' },
    ],
  },
]

const tagMatch = filterMenuBySearchKey(menus, '用户', KUtils)
if (!tagMatch || tagMatch.length !== 1 || tagMatch[0].key !== 'tag-user' || tagMatch[0].children.length !== 2) {
  failures.push('Tag name match must include every child of that Tag')
}

const childMatch = filterMenuBySearchKey(menus, 'checkout', KUtils)
if (!childMatch || childMatch.length !== 1 || childMatch[0].key !== 'tag-order' || childMatch[0].children.length !== 1) {
  failures.push('child url/name/description match must keep only matching children')
}

const descriptionMatch = filterMenuBySearchKey(menus, 'list pets', KUtils)
if (!descriptionMatch || descriptionMatch.length !== 1 || descriptionMatch[0].children[0].url !== '/pets') {
  failures.push('child description match must still work when Tag name does not match')
}

const emptyMatch = filterMenuBySearchKey(menus, 'zzz-not-found', KUtils)
if (!emptyMatch || emptyMatch.length !== 0) {
  failures.push('unrelated search key must hide every Tag')
}

if (filterMenuBySearchKey(menus, '', KUtils) !== null) {
  failures.push('blank search key must leave menu filtering to searchClear')
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('vue3 search menu and gateway header check passed')
