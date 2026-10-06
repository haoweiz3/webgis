<template>
  <footer class="status-bar">
    <span>光标经纬度 <b class="value">{{ lngLat }}</b></span>
    <span>地面高程 <b class="value">{{ groundHeight }}</b></span>
    <span>相机高度 <b class="value">{{ cameraHeight }}</b></span>
    <span>帧率 <b class="value">{{ scene.fps }} fps</b></span>
    <span>当前水位（吴淞） <b class="value">{{ waterLevel }}</b></span>
    <span>{{ activeToolText }}</span>
  </footer>
</template>

<script setup>
import { computed } from 'vue'
import { useSceneStore } from '@/stores/scene.js'
import { useDataStore } from '@/stores/data.js'

const scene = useSceneStore()
const data = useDataStore()

const TOOL_TEXT = {
  'measure-distance': '进行中：距离量算（点击场景添加测点）',
  'measure-area': '进行中：面积量算（依次点击边界点，点回起点闭合）',
  profile: '进行中：剖面分析（依次点击起点与终点）'
}

const lngLat = computed(() => {
  const { lng, lat } = scene.cursor
  if (lng == null || lat == null) return '--'
  return lng.toFixed(5) + '°, ' + lat.toFixed(5) + '°'
})

const groundHeight = computed(() =>
  scene.cursor.height == null ? '--' : scene.cursor.height.toFixed(1) + ' m'
)

const cameraHeight = computed(() => scene.cameraHeight.toLocaleString('zh-CN') + ' m')
const waterLevel = computed(() => data.effectiveWaterLevel.toFixed(2) + ' m')
const activeToolText = computed(() => TOOL_TEXT[scene.activeTool] ?? '就绪')
</script>
