/**
 * 模块契约
 * ------------------------------------------------------------------
 * 平台里每个功能都是一个模块，必须遵守同一份约定：
 *   init(ctx)   挂载：拿到平台上下文（viewer / 事件总线 / 状态 / 工具），返回对外的 API
 *   destroy()   卸载：移除实体、解绑监听、停掉计时器，保证场景可以反复启停
 *   layers      声明该模块向图层树注册的图层项
 * 有契约才能做到"功能可插拔、可开关、可销毁"，这是平台与页面的根本区别。
 */
export function defineModule(definition) {
  const {
    id,
    name,
    group = '空间数据',
    description = '',
    layers = [],
    init,
    destroy
  } = definition

  if (!id || typeof init !== 'function') {
    throw new Error('模块定义不合法：必须提供 id 与 init(ctx)')
  }

  return { id, name, group, description, layers, enabled: false, api: null, definition }
}
