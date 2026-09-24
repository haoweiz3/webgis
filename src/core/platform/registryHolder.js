/** 注册中心持有器：HUD 组件通过它调用各模块 API，避免层层传参 */
let registry = null

export function setRegistry(instance) {
  registry = instance
}

export function getRegistry() {
  return registry
}
