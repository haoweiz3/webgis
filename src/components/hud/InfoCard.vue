<template>
  <section v-if="feature" class="panel info-card">
    <div class="panel__header">
      <span class="panel__title">要素属性</span>
      <button class="btn" @click="close">关闭</button>
    </div>
    <div class="panel__body">
      <div class="info-card__name">{{ feature.properties.name }}</div>
      <div class="field"><span>要素类型</span><b class="field__value">{{ feature.properties.categoryName }}</b></div>
      <div class="field"><span>要素编号</span><b class="field__value">{{ feature.properties.id }}</b></div>
      <div v-if="feature.properties.length_m" class="field">
        <span>跨江长度（按折线量算）</span>
        <b class="field__value">{{ (feature.properties.length_m / 1000).toFixed(3) }} km</b>
      </div>
      <p v-if="feature.properties.summary" class="info-card__summary">
        {{ feature.properties.summary }}…
      </p>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { useDataStore } from '@/stores/data.js'

const data = useDataStore()
const feature = computed(() => data.selectedFeature?.feature ?? null)

function close() {
  data.selectFeature(null)
}
</script>

<style scoped>
.info-card {
  flex-shrink: 0;
}

.info-card__name {
  margin-bottom: 6px;
  color: var(--c-accent);
  font-size: 14px;
}

.info-card__summary {
  margin: 8px 0 0;
  color: rgba(143, 180, 204, 0.85);
  font-size: 11px;
  line-height: 1.7;
}
</style>
