export function replaceGroupMenuData(menuData, groupId, replacement) {
  const groupMenuIndex = menuData.findIndex(menu => menu.groupId === groupId)
  const nextMenuData = menuData.filter(menu => menu.groupId !== groupId)
  nextMenuData.splice(
    groupMenuIndex < 0 ? nextMenuData.length : groupMenuIndex,
    0,
    ...replacement
  )
  return nextMenuData
}

export function beginDocumentRequest(swagger, instance, language) {
  swagger.documentRequestId += 1
  return {
    id: swagger.documentRequestId,
    instance,
    language,
  }
}

export function isCurrentDocumentRequest(swagger, request) {
  return swagger.documentRequestId === request.id
    && swagger.currentInstance === request.instance
    && swagger.settings.language === request.language
}

export function getDocumentLoadDecision(instance, language, forceReload = false) {
  const addMenu = !instance.load
  return {
    addMenu,
    shouldRequest: addMenu || forceReload || instance.loadedLanguage !== language,
  }
}

export function prepareInstanceForLanguageReload(instance) {
  const cacheInstance = instance.cacheInstance || {
    id: instance.groupId || '',
    name: instance.name || '',
    cacheApis: [],
    updateApis: {},
  }
  instance.freeMemory()
  instance.firstLoad = false
  instance.cacheInstance = cacheInstance
  return instance
}
