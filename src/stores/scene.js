import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { BASE_MAPS } from '@/config/scene.js'

/**
 * 场景状态：底图、地形、图层树、状态栏读数、提示消息
 * 只保存标量数据，Cesium 实例由 viewerHolder 持有，避免被 Vue 响应式代理。
 */
export const useSceneStore = defineStore('scene', () => {
  const ready = ref(false)
  const loading = ref(true)
  const loadingText = ref('正在初始化三维场景')
  const loadingDetail = ref('')
  const loadingSeconds = ref(0)
  const baseMaps = BASE_MAPS
  const baseMapId = ref(BASE_MAPS[0].id)
  const hasTiandituKey = ref(false)
  const terrainEnabled = ref(true)
  const layers = ref([])
  const fps = ref(0)
  const cameraHeight = ref(0)
  const cursor = reactive({ lng: null, lat: null, height: null })
  const toasts = ref([])
  /** 当前激活的分析工具：null | measure-distance | measure-area | profile */
  const activeTool = ref(null)

  function setLayers(list) {
    layers.value = list
  }

  function updateLayerVisible(layerId, visible) {
    const layer = layers.value.find((item) => item.id === layerId)
    if (layer) layer.visible = visible
  }

  function setCursor({ lng, lat, height }) {
    cursor.lng = lng
    cursor.lat = lat
    cursor.height = height
  }

  function toast(message, type = 'info', duration = 2600) {
    const id = Date.now() + Math.random()
    toasts.value.push({ id, message, type })
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((item) => item.id !== id)
    }, duration)
  }

  return {
    ready,
    loading,
    loadingText,
    loadingDetail,
    loadingSeconds,
    baseMaps,
    baseMapId,
    hasTiandituKey,
    terrainEnabled,
    layers,
    fps,
    cameraHeight,
    cursor,
    toasts,
    activeTool,
    setLayers,
    updateLayerVisible,
    setCursor,
    toast
  }
})
