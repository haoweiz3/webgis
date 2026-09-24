/** 平台上下文持有器：HUD 组件通过它订阅事件，避免层层传参 */
let context = null

export function setContext(instance) {
  context = instance
}

export function getContext() {
  return context
}
