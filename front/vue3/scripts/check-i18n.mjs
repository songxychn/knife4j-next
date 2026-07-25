import {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  messages,
} from '../src/lang/index.js'
import {
  prepareInstanceForLanguageReload,
  replaceGroupMenuData,
} from '../src/core/languageReload.js'

const expectedLanguages = ['zh-CN', 'en-US', 'ja-JP']
const failures = []

if (DEFAULT_LANGUAGE !== 'zh-CN') {
  failures.push(`default language must be zh-CN, got ${DEFAULT_LANGUAGE}`)
}
if (JSON.stringify(SUPPORTED_LANGUAGES) !== JSON.stringify(expectedLanguages)) {
  failures.push(`registered languages must be ${expectedLanguages.join(', ')}`)
}

function describe(value, language, path = '$', result = new Map()) {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  if (type === 'string' && value.trim().length === 0) {
    failures.push(`${language} ${path} must not be empty`)
  }
  result.set(path, {
    type,
    placeholders: type === 'string'
      ? [...new Set(value.match(/\{(?:[A-Za-z_][\w-]*|\d+)\}/g) || [])].sort()
      : [],
  })

  if (type === 'array') {
    value.forEach((item, index) => describe(item, language, `${path}[${index}]`, result))
  } else if (type === 'object') {
    Object.entries(value).forEach(([key, item]) => describe(item, language, `${path}.${key}`, result))
  }
  return result
}

const baseline = describe(messages[DEFAULT_LANGUAGE], DEFAULT_LANGUAGE)

for (const language of SUPPORTED_LANGUAGES) {
  const candidate = describe(messages[language], language)
  for (const [path, expected] of baseline) {
    const actual = candidate.get(path)
    if (!actual) {
      failures.push(`${language} is missing ${path}`)
      continue
    }
    if (actual.type !== expected.type) {
      failures.push(`${language} ${path} has type ${actual.type}, expected ${expected.type}`)
    }
    if (JSON.stringify(actual.placeholders) !== JSON.stringify(expected.placeholders)) {
      failures.push(`${language} ${path} placeholders differ from ${DEFAULT_LANGUAGE}`)
    }
  }
  for (const path of candidate.keys()) {
    if (!baseline.has(path)) {
      failures.push(`${language} has extra key ${path}`)
    }
  }
}

const groupMenus = [
  { groupId: 'first', key: 'old-first' },
  { groupId: 'second', key: 'keep-second' },
]
const replacedGroupMenus = replaceGroupMenuData(
  groupMenus,
  'first',
  [{ groupId: 'first', key: 'new-first' }]
)
if (replacedGroupMenus.map(menu => menu.key).join(',') !== 'new-first,keep-second') {
  failures.push('language reload must replace the current group menu without duplicates')
}

const cachedPathId = 'get-/pets'
const versionCache = {
  id: 'first',
  name: 'first',
  cacheApis: [cachedPathId],
  updateApis: { [cachedPathId]: { versionId: 'v1' } },
}
const loadedInstance = {
  groupId: 'first',
  name: 'first',
  firstLoad: true,
  load: true,
  cacheInstance: versionCache,
  paths: [{ id: cachedPathId }],
  freeMemory() {
    this.paths = []
    this.firstLoad = true
    this.cacheInstance = null
  },
}
prepareInstanceForLanguageReload(loadedInstance)
if (
  loadedInstance.firstLoad
  || loadedInstance.cacheInstance !== versionCache
  || !loadedInstance.cacheInstance.cacheApis.includes(cachedPathId)
  || loadedInstance.paths.length !== 0
) {
  failures.push('language reload must clear parsed paths while preserving version cache state')
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`i18n check passed for ${SUPPORTED_LANGUAGES.join(', ')}`)
