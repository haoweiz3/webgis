<template>
  <section class="panel station-panel">
    <div class="panel__header">
      <span class="panel__title">时空数据</span>
      <span class="panel__hint">{{ data.stations.length }} 个站点</span>
    </div>

    <div class="panel__body">
      <div class="btn-row">
        <button
          v-for="item in THEMATIC_FIELDS"
          :key="item.id"
          class="btn"
          :class="{ 'is-active': data.field === item.id }"
          @click="data.field = item.id"
        >
          {{ item.name }}
        </button>
      </div>

      <template v-if="station">
        <div class="station-head">
          <div>
            <div class="station-head__name">{{ station.properties.name }}</div>
            <div class="station-head__meta">
              {{ station.properties.categoryName }} · {{ station.properties.district }}
            </div>
          </div>
          <div class="station-head__actions">
            <button class="btn" @click="backToList">← 返回列表</button>
            <button class="btn" @click="locate">定位</button>
          </div>
        </div>

        <div class="field">
          <span>{{ station.properties.variable || '指标' }}（当前时刻）</span>
          <b class="field__value">{{ currentValue }}</b>
        </div>
        <div v-if="station.properties.warnWusong" class="field">
          <span>警戒水位（吴淞）</span>
          <b class="field__value">{{ station.properties.warnWusong.toFixed(2) }} m</b>
        </div>

        <div ref="chartRef" class="chart"></div>
      </template>

      <template v-else>
        <p class="hint">在三维场景中点击站点，或从下列列表中选择：</p>
        <div v-for="group in groupedStations" :key="group.name" class="group">
          <div class="group__name">{{ group.name }}（{{ group.items.length }}）</div>
          <button
            v-for="item in group.items"
            :key="item.properties.id"
            class="station-item"
            @click="select(item)"
          >
            <span>{{ item.properties.name }}</span>
            <span class="station-item__value">{{ item.properties.district }}</span>
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as echarts from 'echarts'
import { useDataStore } from '@/stores/data.js'
import { useTimeStore } from '@/stores/time.js'
import { getViewer } from '@/core/viewerHolder.js'
import { flyTo } from '@/core/cesium/camera.js'
import { THEMATIC_FIELDS, STATION_STYLE, WATER_LEVEL } from '@/config/scene.js'
import { useNavStore } from '@/stores/nav.js'

const data = useDataStore()
const time = useTimeStore()
const nav = useNavStore()

const chartRef = ref(null)
let chart = null
let observer = null

const station = computed(() => data.selectedStation)

const groupedStations = computed(() => {
  const groups = {}
  data.stations.forEach((item) => {
    const key = item.properties.categoryName
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  })
  return Object.entries(groups).map(([name, items]) => ({ name, items }))
})

const currentValue = computed(() => {
  const item = station.value
  if (!item) return '--'
  const props = item.properties
  if (props.category === 'waterLevel') {
    const value = data.valueAt(props.id, 'waterLevel', time.index)
    return value == null ? '--' : value.toFixed(2) + ' m'
  }
  if (props.category === 'waterQuality') {
    const grade = data.valueAt(props.id, 'grade', time.index)
    const turbidity = data.valueAt(props.id, 'turbidity', time.index)
    return `${grade ?? '--'} 类 · 浊度 ${turbidity ?? '--'} NTU`
  }
  const rain = data.valueAt(props.id, 'rain', time.index)
  return rain == null ? '--' : rain.toFixed(1) + ' mm'
})

function labels() {
  return time.timestamps.map((iso) => {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}时`
  })
}

function buildOption() {
  const item = station.value
  if (!item) return null
  const props = item.properties
  const series = data.stationSeries(props.id)
  const axisLabels = labels()
  const currentLabel = axisLabels[time.index]
  const baseX = {
    type: 'category',
    data: axisLabels,
    axisLabel: {
      color: '#8fb4cc',
      fontSize: 10,
      interval: Math.max(1, Math.floor(axisLabels.length / 4))
    },
    axisLine: { lineStyle: { color: 'rgba(79,209,255,0.25)' } }
  }
  const baseY = (name) => ({
    type: 'value',
    name,
    nameTextStyle: { color: '#8fb4cc', fontSize: 10 },
    axisLabel: { color: '#8fb4cc', fontSize: 10 },
    splitLine: { lineStyle: { color: 'rgba(79,209,255,0.12)' } }
  })
  const cursorLine = {
    silent: true,
    symbol: 'none',
    lineStyle: { color: '#ffd166', type: 'dashed', width: 1 },
    label: { formatter: '当前', color: '#ffd166', fontSize: 10 },
    data: [{ xAxis: currentLabel }]
  }

  if (props.category === 'waterLevel') {
    return {
      grid: { left: 46, right: 14, top: 22, bottom: 26 },
      tooltip: { trigger: 'axis' },
      xAxis: baseX,
      yAxis: baseY('水位 / m'),
      series: [
        {
          name: '水位（吴淞）',
          type: 'line',
          smooth: true,
          symbol: 'none',
          data: series?.waterLevel ?? [],
          lineStyle: { color: '#4fd1ff', width: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(79,209,255,0.45)' },
              { offset: 1, color: 'rgba(79,209,255,0.02)' }
            ])
          },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              {
                yAxis: props.warnWusong ?? WATER_LEVEL.warn,
                lineStyle: { color: '#ff4d6d', type: 'dashed' },
                label: { formatter: '警戒水位', color: '#ff4d6d', fontSize: 10 }
              },
              ...cursorLine.data
            ]
          }
        }
      ]
    }
  }

  if (props.category === 'waterQuality') {
    return {
      grid: { left: 46, right: 14, top: 28, bottom: 26 },
      tooltip: { trigger: 'axis' },
      legend: {
        top: 0,
        textStyle: { color: '#8fb4cc', fontSize: 10 },
        itemWidth: 12,
        itemHeight: 8
      },
      xAxis: baseX,
      yAxis: [baseY('浊度 / NTU'), { ...baseY('溶解氧 / mg/L'), splitLine: { show: false } }],
      series: [
        {
          name: '浊度 NTU',
          type: 'line',
          smooth: true,
          symbol: 'none',
          yAxisIndex: 0,
          data: series?.turbidity ?? [],
          lineStyle: { color: '#31c8a0', width: 2 }
        },
        {
          name: '溶解氧 mg/L',
          type: 'line',
          smooth: true,
          symbol: 'none',
          yAxisIndex: 1,
          data: series?.dissolvedOxygen ?? [],
          lineStyle: { color: '#ffd166', width: 1.6, type: 'dotted' }
        }
      ]
    }
  }

  return {
    grid: { left: 46, right: 14, top: 22, bottom: 26 },
    tooltip: { trigger: 'axis' },
    xAxis: baseX,
    yAxis: baseY('雨量 / mm'),
    series: [
      {
        name: '小时雨量',
        type: 'bar',
        data: series?.rain ?? [],
        itemStyle: { color: 'rgba(79,209,255,0.7)' }
      },
      {
        name: '累计雨量',
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: series?.cumulative ?? [],
        lineStyle: { color: '#ffd166', width: 2 }
      }
    ]
  }
}

/**
 * 图表容器只在选中站点后才渲染（v-if），因此必须按需初始化，
 * 不能在组件挂载时就调用 echarts.init，否则拿到的是空 DOM。
 */
async function ensureChart() {
  await nextTick()
  const el = chartRef.value
  if (!el) return null
  if (!chart) {
    if (!el.clientWidth || !el.clientHeight) return null
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
  if (!station.value) {
    disposeChart()
    return
  }
  const instance = await ensureChart()
  if (!instance) return
  const option = buildOption()
  if (!option) {
    instance.clear()
    return
  }
  instance.setOption(option, true)
}

function select(item) {
  data.selectStation(item.properties.id)
}

/** 返回站点列表：清空选择并记入导航历史，之后可用"前进"回到该站点 */
function backToList() {
  nav.backToList()
}

function locate() {
  const coords = station.value?.geometry?.coordinates
  if (coords) flyTo(getViewer(), { lng: coords[0], lat: coords[1], height: 3200, pitch: -50 })
}

onBeforeUnmount(() => {
  disposeChart()
})

watch([station, () => data.field, () => time.index], render, { immediate: true })
</script>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  /* 占满右栏剩余高度，站点列表在内部滚动而不是被裁掉 */
  flex: 1 1 auto;
  min-height: 0;
}

.panel__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.panel__hint {
  color: var(--c-muted);
  font-size: 12px;
}

.station-head__actions {
  display: flex;
  flex-shrink: 0;
  gap: 6px;
}

.station-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 0 4px;
}

.station-head__name {
  color: var(--c-accent);
  font-size: 14px;
}

.station-head__meta {
  margin-top: 2px;
  color: rgba(143, 180, 204, 0.8);
  font-size: 11px;
}

.chart {
  width: 100%;
  height: 172px;
  margin-top: 6px;
}

/* 视口高度受限时压低图表，把空间让给站点列表与读数 */
@media (max-height: 780px) {
  .chart {
    height: 138px;
  }
}

.hint {
  margin: 6px 0;
  color: rgba(143, 180, 204, 0.75);
  font-size: 11px;
}

.group__name {
  margin: 6px 0 2px;
  color: rgba(143, 180, 204, 0.75);
  font-size: 12px;
}

.station-item {
  display: flex;
  justify-content: space-between;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--c-text);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.station-item:hover {
  background: rgba(79, 209, 255, 0.12);
}

.station-item__value {
  color: var(--c-muted);
}
</style>
