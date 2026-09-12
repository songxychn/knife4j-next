function copyMenuWithChildren(menu, children) {
  return {
    groupName: menu.groupName,
    groupId: menu.groupId,
    key: menu.key,
    name: menu.name,
    icon: menu.icon,
    path: menu.path,
    hasNew: menu.hasNew,
    authority: menu.authority,
    children,
  }
}

/**
 * 当前分组侧边栏搜索，对齐 upstream Vue2：
 * Tag 名称命中时展开该 Tag 下全部子接口；否则按 url / name / description 过滤子项。
 */
export function filterMenuBySearchKey(menus, key, utils) {
  if (!utils.strNotBlank(key)) {
    return null
  }

  const tmpMenu = []
  const regx = '.*?' + key + '.*'
  menus.forEach(function (menu) {
    const tmpChildrens = []
    const tagNameFlag = utils.searchMatch(regx, menu.name)
    if (tagNameFlag) {
      if (utils.arrNotEmpty(menu.children)) {
        menu.children.forEach((children) => {
          tmpChildrens.push(children)
        })
      }
    } else if (utils.arrNotEmpty(menu.children)) {
      menu.children.forEach(function (children) {
        const urlflag = utils.searchMatch(regx, children.url)
        const sumflag = utils.searchMatch(regx, children.name)
        const desflag = utils.searchMatch(regx, children.description)
        if (urlflag || sumflag || desflag) {
          tmpChildrens.push(children)
        }
      })
    }
    if (tmpChildrens.length > 0) {
      const tmpObj = copyMenuWithChildren(menu, tmpChildrens)
      if (tmpMenu.filter((t) => t.key === tmpObj.key).length == 0) {
        tmpMenu.push(tmpObj)
      }
    }
  })
  return tmpMenu
}
