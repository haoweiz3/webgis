import { EVENTS } from '../events/eventBus.js'

/**
 * 模块注册中心：负责模块注册、挂载、启停、销毁，
 * 并把各模块声明的图层汇总成图层树数据。
 */
export function createModuleRegistry(ctx) {
  const modules = new Map()
  const layers = []

  function register(module) {
    if (modules.has(module.id)) {
      console.warn('[registry] 模块重复注册：' + module.id)
      return module
    }
    modules.set(module.id, module)
    module.layers.forEach((layer) => {
      layers.push({
        ...layer,
        moduleId: module.id,
        visible: layer.defaultVisible !== false
      })
    })
    return module
  }

  function mount(id) {
    const module = modules.get(id)
    if (!module) return null
    if (module.enabled) return module.api
    module.api = module.definition.init(ctx) || {}
    module.enabled = true
    return module.api
  }

  function unmount(id) {
    const module = modules.get(id)
    if (!module || !module.enabled) return
    try {
      module.definition.destroy?.(ctx, module.api)
    } catch (err) {
      console.error('[registry] 模块卸载失败：' + id, err)
    }
    module.api = null
    module.enabled = false
  }

  function mountAll() {
    modules.forEach((module) => mount(module.id))
  }

  function destroyAll() {
    Array.from(modules.keys()).forEach((id) => unmount(id))
  }

  function get(id) {
    const module = modules.get(id)
    return module && module.enabled ? module.api : null
  }

  function setLayerVisible(layerId, visible) {
    const layer = layers.find((item) => item.id === layerId)
    if (!layer) return
    layer.visible = visible
    const module = modules.get(layer.moduleId)
    // 惰性挂载：图层第一次被打开时才挂载对应模块，避免启动时创建大量隐藏实体
    if (visible && module && !module.enabled) mount(layer.moduleId)
    const api = get(layer.moduleId)
    if (api && api.setLayerVisible) {
      api.setLayerVisible(layerId, visible)
    } else if (visible) {
      mount(layer.moduleId)
    } else {
      unmount(layer.moduleId)
    }
    ctx.eventBus.emit(EVENTS.LAYER_VISIBILITY, { layerId, visible })
  }

  return {
    register,
    mount,
    unmount,
    mountAll,
    destroyAll,
    get,
    setLayerVisible,
    layers,
    list: () => Array.from(modules.values())
  }
}
