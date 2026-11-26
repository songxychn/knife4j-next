import assert from 'node:assert/strict'
import { createApp, computed, effectScope, nextTick, watch } from 'vue'
import { setupStore } from '../src/store/index.js'
import { useGlobalsStore } from '../src/store/modules/global.js'
import { useHeadersStore } from '../src/store/modules/header.js'
import { useknife4jModels } from '../src/store/knife4jModels.js'

// Exercise the installed Vue/Pinia pair and production stores without a DOM.
// Component rendering, persistence and request execution are browser checks.
function createStores() {
  const app = createApp({ render: () => null })
  setupStore(app)
  return app.runWithContext(() => ({
    app,
    globals: useGlobalsStore(),
    headers: useHeadersStore(),
    models: useknife4jModels(),
  }))
}

const first = createStores()
const second = createStores()
const scope = effectScope()

try {
  // Installing another application must not change injection in the first one.
  for (const stores of [first, second]) {
    stores.app.runWithContext(() => {
      assert.equal(useGlobalsStore(), stores.globals)
      assert.equal(useHeadersStore(), stores.headers)
      assert.equal(useknife4jModels(), stores.models)
    })
  }
  assert.notEqual(first.globals, second.globals)
  assert.notEqual(first.headers, second.headers)
  assert.notEqual(first.models, second.models)

  const languageChanges = []
  const serviceChanges = []
  const settingsChanges = []
  const loadingChanges = []
  const view = scope.run(() => {
    const language = computed(() => first.globals.language)
    const service = computed(() => ({
      selected: first.globals.defaultServiceOption,
      title: first.globals.swaggerCurrentInstance?.title ?? null,
      menu: first.globals.currentMenuData.map((item) => item.key),
    }))
    const settings = computed(() => first.globals.settings.enableHost ?? false)
    const loading = computed(() => [first.globals.loading.show, first.globals.loading.text])
    watch(language, (value) => languageChanges.push(value))
    watch(service, (value) => serviceChanges.push(value))
    watch(settings, (value) => settingsChanges.push(value))
    watch(loading, (value) => loadingChanges.push(value))
    return { language, service, settings }
  })

  assert.equal(view.language.value, 'zh-CN')
  first.globals.setLang('en-US')
  await nextTick()
  assert.equal(second.globals.language, 'zh-CN')
  first.globals.setLang('zh-CN')
  await nextTick()
  assert.deepEqual(languageChanges, ['en-US', 'zh-CN'])

  // A service switch changes the selected instance and visible menu together.
  first.globals.setServiceOptions([{ label: 'Pets', value: 'pets' }, { label: 'Orders', value: 'orders' }])
  for (const [id, title] of [['pets', 'Pets'], ['orders', 'Orders']]) {
    first.globals.setDefaultService(id)
    first.globals.setSwaggerInstance({ id, title })
    first.globals.setMenuData([{ key: id }])
    await nextTick()
  }
  assert.deepEqual(serviceChanges, [
    { selected: 'pets', title: 'Pets', menu: ['pets'] },
    { selected: 'orders', title: 'Orders', menu: ['orders'] },
  ])
  assert.equal('menuData' in first.globals.$state, false, 'menus are not accumulated across services')
  first.globals.setDefaultService('pets')
  first.globals.setSwaggerInstance({ id: 'pets', title: 'Pets' })
  first.globals.setCurrentMenuData([{ key: 'pets' }])
  await nextTick()
  assert.deepEqual(view.service.value, { selected: 'pets', title: 'Pets', menu: ['pets'] })
  assert.equal(serviceChanges.length, 3)

  // Both replacement and nested mutation must invalidate Vue consumers.
  first.globals.setSettings({ enableHost: true })
  await nextTick()
  first.globals.settings.enableHost = false
  await nextTick()
  assert.deepEqual(settingsChanges, [true, false])
  first.globals.showLoading({ text: 'Loading Pets' })
  await nextTick()
  first.globals.destroyLoading()
  await nextTick()
  assert.deepEqual(loadingChanges, [[true, 'Loading Pets'], [false, null]])

  const currentUser = computed(() => first.headers.userCurrent.name)
  assert.equal(currentUser.value, undefined)
  first.headers.getCurrentUser()
  assert.equal(currentUser.value, '八一菜刀')

  // Model cache dictionaries are populated after consumers first read them.
  const modelNames = computed(() => Object.keys(first.models.instance.pets ?? {}))
  assert.deepEqual(modelNames.value, [])
  first.models.setValue('pets', {
    Pet: { params: [{ id: 'owner', schema: true, schemaValue: 'Owner', parentTypes: [] }] },
    Owner: { params: [{ id: 'name', name: 'name', type: 'string', schema: false }] },
  })
  assert.deepEqual(modelNames.value, ['Pet', 'Owner'])
  const owner = first.models.getByModelName('pets', 'Pet').params[0].children[0]
  assert.equal(owner.name, 'name')
  assert.equal(owner.pid, 'owner')
  assert.notEqual(owner, first.models.getByModelName('pets', 'Owner').params[0])
  first.models.setValue('orders', { Order: { params: [] } })
  assert.equal(first.models.exists('orders', 'Order'), true)
  assert.equal(first.models.exists('orders', 'Pet'), false)
  first.models.setValue('pets', { Replacement: { params: [] } })
  assert.deepEqual(modelNames.value, ['Pet', 'Owner'])

  // Mutable defaults and model dictionaries must stay local to their app.
  assert.equal(second.globals.language, 'zh-CN')
  assert.equal(second.globals.currentMenuData.length, 0)
  assert.equal(second.globals.serviceOptions.length, 0)
  assert.equal(second.globals.swaggerCurrentInstance, null)
  assert.deepEqual(Object.keys(second.globals.settings), [])
  assert.equal(second.globals.loading.show, false)
  assert.equal(second.globals.loading.text, null)
  assert.deepEqual(Object.keys(second.headers.userCurrent), [])
  assert.deepEqual(Object.keys(second.models.instance), [])

  console.log('vue3 store integration check passed: app injection/isolation, reactive language/service/settings/loading, headers and model caches')
} finally {
  scope.stop()
  for (const { globals, headers, models } of [first, second]) {
    globals.$dispose()
    headers.$dispose()
    models.$dispose()
  }
}
