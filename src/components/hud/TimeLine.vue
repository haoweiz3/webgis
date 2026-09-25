<template>
  <div class="timeline panel">
    <div class="timeline__controls">
      <button class="btn" :class="{ 'is-active': time.playing }" @click="time.toggle()">
        {{ time.playing ? '暂停' : '播放' }}
      </button>
      <button class="btn" @click="reset">回到起点</button>
      <button class="btn" @click="jumpPeak">定位洪峰</button>
    </div>
    <div class="timeline__track">
      <input
        type="range"
        :min="0"
        :max="Math.max(0, time.count - 1)"
        step="1"
        :value="time.index"
        @input="onSeek"
      />
      <div class="timeline__ticks">
        <span v-for="tick in ticks" :key="tick.index">{{ tick.label }}</span>
      </div>
    </div>
    <div class="timeline__readout">
      <b>{{ time.currentLabel }}</b>
      <span>第 {{ time.index + 1 }} / {{ time.count }} 小时</span>
      <span>倍速
        <select :value="time.speed" @change="onSpeed">
          <option :value="1">1×</option>
          <option :value="4">4×</option>
          <option :value="8">8×</option>
          <option :value="16">16×</option>
        </select>
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useTimeStore } from '@/stores/time.js'
import { useDataStore } from '@/stores/data.js'
import { WATER_LEVEL } from '@/config/scene.js'

const time = useTimeStore()
const data = useDataStore()

const ticks = computed(() => {
  if (!time.count) return []
  const step = Math.max(1, Math.floor(time.count / 6))
  const list = []
  for (let i = 0; i < time.count; i += step) {
    const d = new Date(time.timestamps[i])
    list.push({ index: i, label: `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}时` })
  }
  return list
})

function onSeek(event) {
  time.setIndex(Number(event.target.value))
}

function onSpeed(event) {
  time.speed = Number(event.target.value)
}

function reset() {
  time.pause()
  time.setIndex(0)
}

/** 定位到参考站的洪峰时刻，演示时一键跳到最有看点的时刻 */
function jumpPeak() {
  const values = data.stationSeries(WATER_LEVEL.referenceStation)?.waterLevel ?? []
  if (!values.length) return
  const peak = values.indexOf(Math.max(...values))
  time.setIndex(peak)
  time.pause()
}
</script>

<style scoped>
.timeline {
  position: absolute;
  bottom: 42px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 16px;
  /* 两侧给左右面板各留 350px，面板可以一直延伸到时间轴所在高度而不重叠 */
  width: min(920px, calc(100% - 700px));
  padding: 8px 14px;
  transform: translateX(-50%);
}

.timeline__controls {
  display: flex;
  gap: 6px;
}

.timeline__track {
  flex: 1;
  min-width: 0;
}

.timeline__ticks {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  color: rgba(143, 180, 204, 0.75);
  font-size: 11px;
}

.timeline__readout {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 150px;
  color: var(--c-muted);
  font-size: 12px;
  text-align: right;
}

.timeline__readout b {
  color: var(--c-accent);
  font-size: 14px;
}

select {
  margin-left: 4px;
  padding: 1px 4px;
  border: 1px solid var(--c-border);
  border-radius: 3px;
  background: rgba(11, 24, 38, 0.9);
  color: var(--c-text);
  font-family: inherit;
}
</style>
