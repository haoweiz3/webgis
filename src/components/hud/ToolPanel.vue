<template>
  <section class="panel">
    <div class="panel__header">
      <span class="panel__title">空间分析</span>
      <button class="btn" @click="clearAll">清除结果</button>
    </div>
    <div class="panel__body">
      <div class="block">
        <div class="btn-row">
          <button
            v-for="tool in tools"
            :key="tool.id"
            class="btn"
            :class="{ 'is-active': scene.activeTool === tool.tool }"
            @click="runTool(tool)"
          >
            {{ tool.name }}
          </button>
        </div>
        <p class="hint">{{ tip }}</p>
      </div>

      <div v-if="measure" class="block result">
        <div class="field"><span>测点数量</span><b class="field__value">{{ measure.vertices }}</b></div>
        <div class="field"><span>累计距离</span><b class="field__value">{{ measure.lengthText }}</b></div>
        <div class="field"><span>闭合面积</span><b class="field__value">{{ measure.areaText }}</b></div>
        <p v-if="measure.awaitingClose" class="hint">
          点数已够、尚未闭合：再点一次起点形成完整多边形，之后才计算面积。
        </p>
      </div>

      <div class="block">
        <label class="check">
          <input type="checkbox" :checked="floodActive" @change="toggleFlood($event.target.checked)" />
          淹没分析（DEM 栅格法）
        </label>

        <template v-if="floodActive">
          <div class="field">
            <span>水位（吴淞）</span>
            <b class="field__value">{{ waterLevel.toFixed(2) }} m</b>
          </div>
          <input
            type="range"
            :min="WATER_LEVEL.min"
            :max="WATER_LEVEL.max"
            step="0.1"
            :value="waterLevel"
            @input="onLevelChange"
          />
          <label class="check">
            <input type="checkbox" :checked="time.followTime" @change="onFollowChange" />
            跟随时间轴（取消后手动设定水位）
          </label>
          <label class="check">
            <input type="checkbox" :checked="useBarrier" @change="onBarrierChange($event.target.checked)" />
            计入堤防屏障（下界；取消得到上界）
          </label>
          <label class="check">
            <input type="checkbox" :checked="showIsolated" @change="onIsolatedChange($event.target.checked)" />
            显示"低于水位但未连通"的区域
          </label>

          <div v-if="flood" class="result">
            <div class="field">
              <span>淹没面积（连通）</span>
              <b class="field__value">{{ flood.areaKm2 }} km²</b>
            </div>
            <div class="field">
              <span>其中河道</span>
              <b class="field__value">{{ flood.channelKm2 }} km²</b>
            </div>
            <div class="field">
              <span>新增淹没陆地</span>
              <b class="field__value">{{ flood.newLandKm2 }} km²</b>
            </div>
            <div class="field">
              <span>平均 / 最大水深</span>
              <b class="field__value">{{ flood.meanDepth }} / {{ flood.maxDepth }} m</b>
            </div>
            <div class="field">
              <span>低于水位但未连通</span>
              <b class="field__value">{{ flood.isolatedKm2 }} km²</b>
            </div>
            <div class="field">
              <span>示意单元法对照</span>
              <b class="field__value">{{ flood.bandAreaKm2 }} km²</b>
            </div>
            <div class="field">
              <span>警戒状态</span>
              <span class="tag" :class="flood.overWarn ? 'tag--warn' : 'tag--ok'">
                {{ flood.overWarn ? '超警戒水位' : '低于警戒水位' }}
              </span>
            </div>
            <p class="hint">
              栅格法：{{ flood.barrierText }}。逐格比较地形与水面高程，再从河道做连通性搜索，
              边界由 DEM 决定。"示意单元法对照"是沿江外扩的固定环带，
              形状与地形无关，只留作口径对比。
            </p>
            <p class="hint">
              水位—面积是台阶状曲线：水一旦越过某处鞍部（缺口）高程，整片低洼地会一次性连通，
              面积出现跳变。26.6 → 26.7 m 就会把武昌南部一片约 200 km² 的低地接进来。
            </p>
            <div class="flood-legend">
              <span v-for="item in floodLegend" :key="item.label" class="flood-legend__item">
                <i class="flood-legend__swatch" :style="{ background: item.css }"></i>
                {{ item.label }}
              </span>
            </div>
            <p class="hint">
              黄色不是"淹到的地方"，而是<b>地形低于水位、但水进不去</b>的位置：
              大多是被堤防挡在堤内的低地，少数是城区建筑/树冠残留把水路堵住。
              它不计入上面的淹没面积，正是下界与上界之间的差距。
            </p>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useSceneStore } from '@/stores/scene.js'
import { useTimeStore } from '@/stores/time.js'
import { useDataStore } from '@/stores/data.js'
import { getRegistry } from '@/core/platform/registryHolder.js'
import { getContext, onContextReady } from '@/core/platform/contextHolder.js'
import { EVENTS } from '@/core/events/eventBus.js'
import { WATER_LEVEL, FLOOD_PALETTE } from '@/config/scene.js'

const scene = useSceneStore()
const time = useTimeStore()
const data = useDataStore()

const tools = [
  { id: 'distance', name: '距离量算', tool: 'measure-distance' },
  { id: 'area', name: '面积量算', tool: 'measure-area' },
  { id: 'profile', name: '剖面分析', tool: 'profile' }
]

const measure = ref(null)
const flood = ref(null)
const floodActive = ref(false)
const useBarrier = ref(true)
const showIsolated = ref(true)
/** 图例与三维里的掩膜取同一份配色配置，改色不会两边对不上 */
const floodLegend = [
  FLOOD_PALETTE.channel,
  FLOOD_PALETTE.connected,
  FLOOD_PALETTE.isolated
].map((item) => ({
  label: item.label,
  css: `rgba(${item.rgb.join(', ')}, ${item.alpha})`
}))
const waterLevel = computed(() => data.effectiveWaterLevel)

const tip = computed(() => {
  if (scene.activeTool === 'measure-distance') return '在场景中依次点击测点，结果实时累加'
  if (scene.activeTool === 'measure-area') return '依次点击边界点，再点回起点闭合；形成完整多边形后才计算面积'
  if (scene.activeTool === 'profile') return '依次点击起点与终点，自动采样地形并绘制剖面'
  return '选择工具后在三维场景中点选操作'
})

let offResult = null
let offCleared = null

let offContext = null

onMounted(() => {
  floodActive.value = Boolean(scene.layers.find((layer) => layer.id === 'layer-flood')?.visible)
  // 上下文在 App 异步初始化里才创建，这里必须等它就绪再订阅，否则收不到分析结果
  offContext = onContextReady((ctx) => {
    offResult = ctx.eventBus.on(EVENTS.ANALYSIS_RESULT, (result) => {
      if (result.type === 'measure') measure.value = result
      if (result.type === 'flood') flood.value = result
    })
    offCleared = ctx.eventBus.on(EVENTS.ANALYSIS_CLEARED, () => {
      measure.value = null
    })
  })
})

// 图层树里直接切换"淹没单元"时，同步本面板的开关状态
watch(
  () => scene.layers.find((layer) => layer.id === 'layer-flood')?.visible,
  (visible) => {
    if (typeof visible === 'boolean') floodActive.value = visible
  }
)

onBeforeUnmount(() => {
  offResult?.()
  offCleared?.()
  offContext?.()
})

function runTool(tool) {
  const registry = getRegistry()
  if (scene.activeTool === tool.tool) {
    registry?.get('analysis-measure')?.stop()
    registry?.get('analysis-profile')?.stop()
    measure.value = null
    return
  }
  registry?.get('analysis-measure')?.stop()
  registry?.get('analysis-profile')?.stop()
  measure.value = null
  if (tool.tool === 'profile') registry?.get('analysis-profile')?.start()
  else registry?.get('analysis-measure')?.start(tool.id)
}

async function toggleFlood(enabled) {
  floodActive.value = enabled
  getRegistry()?.setLayerVisible('layer-flood', enabled)
  scene.updateLayerVisible('layer-flood', enabled)
  const api = getRegistry()?.get('analysis-flood')
  if (enabled) {
    // 栅格淹没要先把 DEM 与掩膜读进来，await 之后再确认面板状态
    const ok = await api?.setActive(true)
    if (ok === false) {
      floodActive.value = false
      getRegistry()?.setLayerVisible('layer-flood', false)
      scene.updateLayerVisible('layer-flood', false)
    }
  } else {
    api?.setActive(false)
  }
  if (!enabled) flood.value = null
}

function onBarrierChange(checked) {
  useBarrier.value = checked
  getRegistry()?.get('analysis-flood')?.setUseBarrier(checked)
}

function onIsolatedChange(checked) {
  showIsolated.value = checked
  getRegistry()?.get('analysis-flood')?.setShowIsolated(checked)
}

function onLevelChange(event) {
  data.setManualLevel(Number(event.target.value))
}

function onFollowChange(event) {
  if (event.target.checked) data.clearManualLevel()
  else data.setManualLevel(Number(waterLevel.value.toFixed(2)))
}

function clearAll() {
  const registry = getRegistry()
  registry?.get('analysis-measure')?.clear()
  registry?.get('analysis-profile')?.clear()
  measure.value = null
}
</script>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  /* 按内容自适应，但最多占半栏高度：展开淹没分析时不会把图层面板挤没 */
  flex: 0 1 auto;
  max-height: 52%;
  min-height: 0;
}

.panel__body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
}

.hint {
  margin: 6px 0 0;
  color: rgba(143, 180, 204, 0.75);
  font-size: 11px;
  line-height: 1.6;
}

.result {
  padding: 6px 8px;
  border: 1px solid rgba(79, 209, 255, 0.18);
  border-radius: 3px;
  background: rgba(16, 34, 52, 0.6);
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  cursor: pointer;
}

.check input {
  accent-color: var(--c-accent);
}

.bands {
  max-height: 120px;
  margin-top: 6px;
  overflow-y: auto;
}

.bands__item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
  color: var(--c-muted);
  font-size: 11px;
}

/* 淹没范围图例：三类的颜色说明 */
.flood-legend {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 8px;
}

.flood-legend__item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(143, 180, 204, 0.82);
  font-size: 11px;
}

.flood-legend__swatch {
  flex: 0 0 auto;
  width: 14px;
  height: 10px;
  border-radius: 2px;
}
</style>
