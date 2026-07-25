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
