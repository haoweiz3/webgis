import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

/**
 * 时间轴状态：驱动"时空数据"变化
 * 播放进度由 timeline 模块推进，其它模块只读取 index / currentTime。
 */
export const useTimeStore = defineStore('time', () => {
  const timestamps = ref([])
  const index = ref(0)
  const playing = ref(false)
  /** 播放速度：每秒推进多少个时间步 */
  const speed = ref(4)
  /** 场景水位是否跟随时间轴（关闭后使用手动设定的水位） */
  const followTime = ref(true)

  const count = computed(() => timestamps.value.length)
  const currentTime = computed(() => timestamps.value[index.value] ?? null)
  const progress = computed(() =>
    count.value <= 1 ? 0 : (index.value / (count.value - 1)) * 100
  )
  const currentLabel = computed(() => {
    const iso = currentTime.value
    if (!iso) return '--'
    const d = new Date(iso)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:00`
  })

  function setTimeline(list) {
    timestamps.value = list ?? []
    index.value = 0
  }

  function setIndex(next) {
    if (count.value === 0) return
    const clamped = Math.min(count.value - 1, Math.max(0, Math.round(next)))
    index.value = clamped
  }

  function step(delta) {
    let next = index.value + delta
    if (next > count.value - 1) next = 0
    if (next < 0) next = count.value - 1
    index.value = Math.round(next)
  }

  function play() {
    if (count.value > 1) playing.value = true
  }

  function pause() {
    playing.value = false
  }

  function toggle() {
    if (playing.value) pause()
    else play()
  }

  return {
    timestamps,
    index,
    playing,
    speed,
    followTime,
    count,
    currentTime,
    currentLabel,
    progress,
    setTimeline,
    setIndex,
    step,
    play,
    pause,
    toggle
  }
})
