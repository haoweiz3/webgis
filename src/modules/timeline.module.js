import { defineModule } from '../core/platform/defineModule.js'
import { EVENTS } from '../core/events/eventBus.js'
import { watch } from 'vue'

/**
 * 时间轴模块
 * 平台里"时间"是一个全局维度：由本模块统一推进播放位置，
 * 其它模块（水域、站点、图表）只读取状态，不各自维护定时器。
 */
export default defineModule({
  id: 'timeline',
  name: '时间轴播放',
  group: '时空数据',
  description: '时间推进与播放控制',
  layers: [],
  init(ctx) {
    const time = ctx.time
    let rafId = null
    let lastTick = 0

    function loop(timestamp) {
      rafId = window.requestAnimationFrame(loop)
      if (!time.playing) return
      const interval = 1000 / Math.max(1, time.speed)
      if (timestamp - lastTick < interval) return
      lastTick = timestamp
      time.step(1)
    }
    rafId = window.requestAnimationFrame(loop)

    const stopWatch = watch(
      () => time.index,
      (index) => {
        ctx.eventBus.emit(EVENTS.TIME_CHANGED, {
          index,
          time: time.currentTime
        })
      }
    )

    return {
      destroyPlayback() {
        if (rafId) window.cancelAnimationFrame(rafId)
        rafId = null
        stopWatch()
      }
    }
  },
  destroy(ctx, api) {
    api?.destroyPlayback?.()
  }
})
