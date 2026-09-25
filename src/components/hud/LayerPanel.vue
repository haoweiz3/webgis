<template>
  <section class="panel">
    <div class="panel__header">
      <span class="panel__title">图层管理</span>
      <span class="panel__hint">{{ totalLayers }} 个图层</span>
    </div>
    <div class="panel__body">
      <div class="block">
        <div class="block__label">影像底图</div>
        <div class="btn-row">
          <button
            v-for="map in scene.baseMaps"
            :key="map.id"
            class="btn"
            :class="{ 'is-active': scene.baseMapId === map.id }"
            @click="switchBaseMap(map.id)"
          >
            {{ map.name }}
          </button>
        </div>
        <p v-if="!scene.hasTiandituKey" class="hint">
          配置 .env 中的 VITE_TIANDITU_KEY 可启用天地图影像与注记
        </p>
      </div>

      <div class="block">
        <label class="check">
          <input
            type="checkbox"
            :checked="scene.terrainEnabled"
            @change="toggleTerrain($event.target.checked)"
          />
          三维地形起伏
        </label>
      </div>

      <div class="block">
        <div class="block__label">空间与时空数据</div>
        <template v-for="group in groupedLayers" :key="group.name">
          <div class="group__name">{{ group.name }}</div>
          <label v-for="layer in group.items" :key="layer.id" class="check">
            <input
              type="checkbox"
              :checked="layer.visible"
              @change="toggleLayer(layer.id, $event.target.checked)"
            />
            {{ layer.name }}
          </label>
        </template>
      </div>

      <div class="block">
        <div class="block__label">视角书签</div>
        <div class="btn-row">
          <button v-for="bookmark in bookmarks" :key="bookmark.id" class="btn" @click="fly(bookmark)">
            {{ bookmark.name }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { useSceneStore } from '@/stores/scene.js'
import { getRegistry } from '@/core/platform/registryHolder.js'
import { getViewer } from '@/core/viewerHolder.js'
import { flyTo } from '@/core/cesium/camera.js'
import { BOOKMARKS, LAYER_GROUPS } from '@/config/scene.js'

const scene = useSceneStore()
const bookmarks = BOOKMARKS

const totalLayers = computed(() => scene.layers.length)

const groupedLayers = computed(() =>
  LAYER_GROUPS.map((name) => ({
    name,
    items: scene.layers.filter((layer) => layer.group === name)
  })).filter((group) => group.items.length > 0)
)

function switchBaseMap(id) {
  getRegistry()?.get('basemap')?.setBaseMap(id)
}

function toggleTerrain(enabled) {
  getRegistry()?.get('terrain')?.setEnabled(enabled)
}

function toggleLayer(layerId, visible) {
  getRegistry()?.setLayerVisible(layerId, visible)
  scene.updateLayerVisible(layerId, visible)
}

function fly(bookmark) {
  flyTo(getViewer(), bookmark)
}
</script>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  /* 图层多时占用剩余高度并内部滚动，给下面的分析面板留出位置 */
  flex: 1 1 auto;
  min-height: 0;
}

.panel__body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
}

.panel__hint {
  color: var(--c-muted);
  font-size: 12px;
}

.block__label {
  margin-bottom: 6px;
  color: var(--c-muted);
  font-size: 12px;
}

.group__name {
  margin: 6px 0 3px;
  color: rgba(143, 180, 204, 0.75);
  font-size: 12px;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  cursor: pointer;
}

.check input {
  accent-color: var(--c-accent);
}

.hint {
  margin: 6px 0 0;
  color: rgba(143, 180, 204, 0.7);
  font-size: 11px;
  line-height: 1.5;
}
</style>
