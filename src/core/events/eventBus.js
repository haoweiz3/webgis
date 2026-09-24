/**
 * 极简发布—订阅事件总线
 * 三维场景、HUD 组件、分析工具之间不直接相互引用，只通过约定的事件名通信。
 */
export function createEventBus() {
  const handlers = new Map()

  function on(event, fn) {
    if (!handlers.has(event)) handlers.set(event, new Set())
    handlers.get(event).add(fn)
    return () => off(event, fn)
  }

  function off(event, fn) {
    const set = handlers.get(event)
    if (set) set.delete(fn)
  }

  function emit(event, payload) {
    const set = handlers.get(event)
    if (!set) return
    set.forEach((fn) => {
      try {
        fn(payload)
      } catch (err) {
        console.error('[eventBus] ' + event + ' 处理失败', err)
      }
    })
  }

  function clear() {
    handlers.clear()
  }

  return { on, off, emit, clear }
}

/** 平台事件名约定 */
export const EVENTS = {
  TIME_CHANGED: 'time:changed',
  WATER_LEVEL_CHANGED: 'water:levelChanged',
  LAYER_VISIBILITY: 'layer:visibility',
  STATION_SELECTED: 'data:stationSelected',
  FEATURE_SELECTED: 'data:featureSelected',
  ANALYSIS_RESULT: 'analysis:result',
  ANALYSIS_CLEARED: 'analysis:cleared',
  TOAST: 'ui:toast'
}
