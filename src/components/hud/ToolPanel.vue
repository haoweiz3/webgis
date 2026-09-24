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
      </div>

      <div class="block">
        <label class="check">
          <input type="checkbox" :checked="floodActive" @change="toggleFlood($event.target.checked)" />
          淹没分析
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

          <div v-if="flood" class="result">
            <div class="field">
              <span>淹没单元</span>
              <b class="field__value">{{ flood.floodedCount }} / {{ flood.bandCount }}</b>
            </div>
            <div class="field">
              <span>淹没面积</span>
              <b class="field__value">{{ flood.areaKm2 }} km²</b>
            </div>
            <div class="field">
              <span>占单元总面积</span>
              <b class="field__value">{{ (flood.ratio * 100).toFixed(1) }}%</b>
            </div>
            <div class="field">
              <span>警戒状态</span>
              <span class="tag" :class="flood.overWarn ? 'tag--warn' : 'tag--ok'">
                {{ flood.overWarn ? '超警戒水位' : '低于警戒水位' }}
              </span>
            </div>
            <div v-if="flood.bands.length" class="bands">
              <div v-for="band in flood.bands" :key="band.id" class="bands__item">
                <span>{{ band.name }}（{{ band.bank }}）</span>
                <span>{{ band.elev.toFixed(1) }} m · {{ band.area.toFixed(1) }} km²</span>
              </div>
            </div>
            <p class="hint">
              判定规则：水位高程 ≥ 淹没单元高程即计入淹没，面积为各单元球面面积累加。
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
import { getContext } from '@/core/platform/contextHolder.js'
import { EVENTS } from '@/core/events/eventBus.js'
import { WATER_LEVEL } from '@/config/scene.js'

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
const waterLevel = computed(() => data.effectiveWaterLevel)

const tip = computed(() => {
  if (scene.activeTool === 'measure-distance') return '在场景中依次点击测点，结果实时累加'
  if (scene.activeTool === 'measure-area') return '依次点击边界点，至少三个点后自动闭合计算面积'
  if (scene.activeTool === 'profile') return '依次点击起点与终点，自动采样地形并绘制剖面'
  return '选择工具后在三维场景中点选操作'
})

let offResult = null
let offCleared = null

onMounted(() => {
  const ctx = getContext()
  floodActive.value = Boolean(scene.layers.find((layer) => layer.id === 'layer-flood')?.visible)
  offResult = ctx?.eventBus.on(EVENTS.ANALYSIS_RESULT, (result) => {
    if (result.type === 'measure') measure.value = result
    if (result.type === 'flood') flood.value = result
  })
  offCleared = ctx?.eventBus.on(EVENTS.ANALYSIS_CLEARED, () => {
    measure.value = null
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

function toggleFlood(enabled) {
  floodActive.value = enabled
  const api = getRegistry()?.get('analysis-flood')
  api?.setActive(enabled)
  getRegistry()?.setLayerVisible('layer-flood', enabled)
  if (!enabled) flood.value = null
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
  min-height: 0;
}

.panel__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
</style>
