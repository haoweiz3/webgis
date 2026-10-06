/** 平台上下文持有器：HUD 组件通过它订阅事件，避免层层传参 */
let context = null
const pending = []

export function setContext(instance) {
  context = instance
  while (pending.length) pending.shift()(context)
}

export function getContext() {
  return context
}

/**
 * 上下文就绪回调
 * ------------------------------------------------------------------
 * 上下文由 App.vue 在异步初始化里创建，而 HUD 组件的 onMounted 先于父组件执行，
 * 所以组件里直接 getContext() 拿到的会是 null（曾经导致量算/剖面结果不显示）。
 * 用这个函数订阅：上下文已存在就立即回调，否则排队等 setContext 时再回调。
 * 返回取消订阅函数，供 onBeforeUnmount 使用。
 */
export function onContextReady(callback) {
  if (context) {
    callback(context)
    return () => {}
  }
  pending.push(callback)
  return () => {
    const index = pending.indexOf(callback)
    if (index >= 0) pending.splice(index, 1)
  }
}
