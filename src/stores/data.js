import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { WATER_LEVEL } from '@/config/scene.js'
import { useTimeStore } from './time.js'

/**
 * 业务数据状态：空间要素、时序数据、专题字段、选中站点
 * 关键设计：水位只有一个真值来源 —— effectiveWaterLevel（吴淞高程），
 * 三维水面、淹没分析、状态栏读数都由它驱动，避免多处状态不一致。
 */
export const useDataStore = defineStore('data', () => {
  const timeStore = useTimeStore()

  const water = ref(null)
  const shoreline = ref(null)
  const floodBands = ref([])
  const stations = ref([])
  const bridges = ref([])
  const roads = ref([])
  const series = ref({})
  const seriesTimestamps = ref([])
  const meta = ref(null)

  const selectedStationId = ref(null)
  const selectedFeature = ref(null)
  const field = ref('waterLevel')
  const manualLevel = ref(null)

  const stationMap = computed(() => {
    const map = new Map()
    stations.value.forEach((feature) => map.set(feature.properties.id, feature))
    return map
  })

  const selectedStation = computed(() =>
    selectedStationId.value ? stationMap.value.get(selectedStationId.value) ?? null : null
  )

  /** 当前时刻的水位（吴淞高程）：跟随时间轴取参考站数据，否则取手动设定值 */
  const effectiveWaterLevel = computed(() => {
    if (!timeStore.followTime && manualLevel.value != null) return manualLevel.value
    const ref = series.value[WATER_LEVEL.referenceStation]
    const values = ref?.waterLevel
    if (!values || values.length === 0) return WATER_LEVEL.default
    return values[Math.min(values.length - 1, timeStore.index)] ?? WATER_LEVEL.default
  })

  const isOverWarn = computed(() => effectiveWaterLevel.value >= WATER_LEVEL.warn)

  function setData(payload) {
    water.value = payload.water ?? null
    shoreline.value = payload.shoreline ?? null
    floodBands.value = payload.floodBands?.features ?? []
    stations.value = payload.stations?.features ?? []
    bridges.value = payload.bridges?.features ?? []
    roads.value = payload.roads?.features ?? []
  }

  function setSeries(payload) {
    seriesTimestamps.value = payload?.timestamps ?? []
    series.value = payload?.series ?? {}
  }

  function stationSeries(stationId) {
    return series.value[stationId] ?? null
  }

  /** 取某站点在指定时间步的指标值 */
  function valueAt(stationId, key, index) {
    const values = series.value[stationId]?.[key]
    if (!values || values.length === 0) return null
    return values[Math.min(values.length - 1, Math.max(0, index))]
  }

  function selectStation(id) {
    selectedStationId.value = id
  }

  function selectFeature(feature) {
    selectedFeature.value = feature
  }

  function setManualLevel(level) {
    manualLevel.value = level
    timeStore.followTime = false
  }

  function clearManualLevel() {
    manualLevel.value = null
    timeStore.followTime = true
  }

  return {
    water,
    shoreline,
    floodBands,
    stations,
    bridges,
    roads,
    series,
    seriesTimestamps,
    meta,
    selectedStationId,
    selectedFeature,
    field,
    manualLevel,
    stationMap,
    selectedStation,
    effectiveWaterLevel,
    isOverWarn,
    setData,
    setSeries,
    stationSeries,
    valueAt,
    selectStation,
    selectFeature,
    setManualLevel,
    clearManualLevel
  }
})
