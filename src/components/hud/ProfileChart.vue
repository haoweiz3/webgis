<template>
  <section v-if="profile" class="panel profile">
    <div class="panel__header">
      <span class="panel__title">剖面分析结果</span>
      <button class="btn" @click="close">关闭</button>
    </div>
    <div class="panel__body">
      <div class="profile__meta">
        <span>剖面长度 <b>{{ profile.lengthText }}</b></span>
        <span>采样点数 <b>{{ profile.elevations.length }}</b></span>
        <span>最高 <b>{{ maxHeight }}</b></span>
        <span>最低 <b>{{ minHeight }}</b></span>
      </div>
      <div ref="chartRef" class="profile__chart"></div>
      <p class="hint">
        {{ datumHint }}
      </p>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { getContext, onContextReady } from '@/core/platform/contextHolder.js'
import { EVENTS } from '@/core/events/eventBus.js'
import { useSceneStore } from '@/stores/scene.js'

const scene = useSceneStore()

const DATUM_HINT = {
  'local-dem': '高程取自本地 FABDEM 地形（EGM2008 口径，去建筑与树冠）。要与吴淞高程的水位数据直接比较，应先完成高程基准转换，再判定淹没关系。',
  'arcgis-online': '高程取自 ArcGIS 全球地形（近似 EGM96 口径），研究区内的起伏被粗格网抹平。要与吴淞高程的水位数据直接比较，应先完成高程基准转换，再判定淹没关系。',
  ellipsoid: '当前未启用三维地形，曲线是椭球高（近似海平面），不代表真实地面。'
}

const datumHint = computed(() => {
  const base = DATUM_HINT[scene.terrainSource] ?? DATUM_HINT.ellipsoid
  const factor = scene.terrainExaggeration
  return factor > 1 ? `${base}（三维场景按 ×${factor} 垂直夸张显示，曲线数值仍是真实高程。）` : base
})

const profile = ref(null)
const chartRef = ref(null)
let chart = null
let observer = null
let off = null

const maxHeight = computed(() => {
  const values = profile.value?.elevations ?? []
  return values.length ? Math.max(...values).toFixed(1) + ' m' : '--'
})

const minHeight = computed(() => {
  const values = profile.value?.elevations ?? []
  return values.length ? Math.min(...values).toFixed(1) + ' m' : '--'
})

/** 图表容器由 v-if 控制，随剖面结果出现后再初始化 */
async function ensureChart() {
  await nextTick()
  const el = chartRef.value
  if (!el || !el.clientWidth || !el.clientHeight) return null
  if (!chart) {
    chart = echarts.init(el)
    observer = new ResizeObserver(() => chart?.resize())
    observer.observe(el)
  }
  return chart
}

function disposeChart() {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
}

async function render() {
  if (!profile.value) {
    disposeChart()
    return
  }
  const instance = await ensureChart()
  if (!instance) return
  const distances = profile.value.distances.map((d) => Number((d / 1000).toFixed(3)))
  const elevations = profile.value.elevations
  instance.setOption(
    {
      grid: { left: 52, right: 16, top: 18, bottom: 34 },
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const item = params[0]
          return `距起点 ${item.axisValue} km<br/>高程 ${item.data} m`
        }
      },
      xAxis: {
        type: 'category',
        name: '距起点 / km',
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: '#8fb4cc', fontSize: 11 },
        data: distances,
        axisLabel: { color: '#8fb4cc', fontSize: 10, interval: Math.max(1, Math.floor(distances.length / 6)) },
        axisLine: { lineStyle: { color: 'rgba(79,209,255,0.25)' } }
      },
      yAxis: {
        type: 'value',
        name: '高程 / m',
        nameTextStyle: { color: '#8fb4cc', fontSize: 11 },
        axisLabel: { color: '#8fb4cc', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(79,209,255,0.12)' } }
      },
      series: [
        {
          name: '地面高程',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: elevations,
          lineStyle: { color: '#31c8a0', width: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(49,200,160,0.45)' },
              { offset: 1, color: 'rgba(49,200,160,0.03)' }
            ])
          }
        }
      ]
    },
    true
  )
}

function close() {
  profile.value = null
  getContext()?.eventBus.emit(EVENTS.ANALYSIS_CLEARED, { type: 'profile' })
}

let offContext = null
let offCleared = null

onMounted(() => {
  // 上下文在 App 异步初始化里才创建，这里必须等它就绪再订阅，否则收不到结果
  offContext = onContextReady((ctx) => {
    off = ctx.eventBus.on(EVENTS.ANALYSIS_RESULT, (result) => {
      if (result.type === 'profile') {
        profile.value = result
        requestAnimationFrame(render)
      }
    })
    // 「清除结果」会停掉剖面工具，此时面板也要跟着收起，否则会一直挡着场景
    offCleared = ctx.eventBus.on(EVENTS.ANALYSIS_CLEARED, (payload) => {
      if (!payload?.type || payload.type === 'profile') profile.value = null
    })
  })
})

onBeforeUnmount(() => {
  off?.()
  offCleared?.()
  offContext?.()
  disposeChart()
})

watch(profile, render, { immediate: true })
</script>

<style scoped>
.profile {
  position: absolute;
  right: 360px;
  bottom: 128px;
  width: 520px;
}

.profile__meta {
  display: flex;
  gap: 14px;
  color: var(--c-muted);
  font-size: 12px;
}

.profile__meta b {
  color: var(--c-text);
}

.profile__chart {
  width: 100%;
  height: 190px;
  margin-top: 8px;
}

.hint {
  margin: 6px 0 0;
  color: rgba(143, 180, 204, 0.7);
  font-size: 11px;
  line-height: 1.6;
}
</style>
