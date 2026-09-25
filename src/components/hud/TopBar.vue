<template>
  <header class="top-bar">
    <div class="top-bar__left">
      <span class="top-bar__title">长江武汉段三维时空数据可视化平台</span>
      <span class="top-bar__sub">Yangtze River · Wuhan Reach 3D Spatio-temporal GIS</span>
    </div>

    <div class="top-bar__nav">
      <button
        class="nav-btn"
        type="button"
        title="返回上一步（快捷键 [ ）"
        :disabled="!nav.canGoBack"
        @click="nav.goBack()"
      >
        ‹
      </button>
      <button
        class="nav-btn"
        type="button"
        title="前进一步（快捷键 ] ）"
        :disabled="!nav.canGoForward"
        @click="nav.goForward()"
      >
        ›
      </button>
      <span class="top-bar__nav-label" :title="nav.currentLabel">{{ nav.currentLabel }}</span>
    </div>

    <div class="top-bar__meta">
      <span>当前时刻 <b class="value">{{ time.currentLabel }}</b></span>
      <span>坐标系 WGS84（高德底图已纠偏）/ 高程基准 吴淞（分析）</span>
      <span class="tag" :class="data.isOverWarn ? 'tag--warn' : 'tag--ok'">
        {{ data.isOverWarn ? '水位超警戒' : '水位正常' }}
      </span>
    </div>
  </header>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { useTimeStore } from '@/stores/time.js'
import { useDataStore } from '@/stores/data.js'
import { useNavStore } from '@/stores/nav.js'

const time = useTimeStore()
const data = useDataStore()
const nav = useNavStore()

/**
 * 键盘快捷键：[ 返回、] 前进
 * 不用 Alt + ←/→：那是浏览器自己的后退键，网页拦不住，会真的把页面导航走
 */
function onKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const tag = event.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (event.key === '[') nav.goBack()
  else if (event.key === ']') nav.goForward()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.value {
  color: var(--c-accent);
  font-variant-numeric: tabular-nums;
}

.top-bar__left {
  display: flex;
  align-items: baseline;
  min-width: 0; /* 允许收缩：窄屏上标题省略而不是折成两行 */
  gap: 12px;
}

.top-bar__title,
.top-bar__sub {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-bar__nav {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
  padding-left: 16px;
  border-left: 1px solid rgba(79, 209, 255, 0.18);
}

.nav-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(79, 209, 255, 0.3);
  border-radius: 3px;
  background: rgba(20, 42, 62, 0.7);
  color: var(--c-text);
  font-family: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;
}

.nav-btn:hover:not(:disabled) {
  border-color: var(--c-accent);
  color: var(--c-accent);
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.top-bar__nav-label {
  max-width: 200px;
  overflow: hidden;
  color: var(--c-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
