<template>
  <header class="top-bar">
    <div class="top-bar__left">
      <span class="top-bar__title">长江武汉段三维时空数据可视化平台</span>
      <span class="top-bar__sub">Yangtze River · Wuhan Reach 3D Spatio-temporal GIS</span>
    </div>
    <div class="top-bar__meta">
      <span>当前时刻 <b class="value">{{ time.currentLabel }}</b></span>
      <span>坐标系 WGS84 / 高程基准 吴淞（分析）</span>
      <span class="tag" :class="data.isOverWarn ? 'tag--warn' : 'tag--ok'">
        {{ data.isOverWarn ? '水位超警戒' : '水位正常' }}
      </span>
    </div>
  </header>
</template>

<script setup>
import { useTimeStore } from '@/stores/time.js'
import { useDataStore } from '@/stores/data.js'

const time = useTimeStore()
const data = useDataStore()
</script>

<style scoped>
.value {
  color: var(--c-accent);
  font-variant-numeric: tabular-nums;
}

.top-bar__left {
  display: flex;
  align-items: baseline;
}
</style>
