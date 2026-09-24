/**
 * 三维视图持有器
 * Cesium 对象体量大、内部状态复杂，绝不放进 Vue 响应式系统（Proxy 包裹会导致
 * 性能下降与行为异常），因此用模块级普通变量持有，Vue 侧只保存标量状态。
 */
let viewer = null

export function setViewer(instance) {
  viewer = instance
}

export function getViewer() {
  return viewer
}

export function destroyViewer() {
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
  viewer = null
}
