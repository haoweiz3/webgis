<template>
  <div class="app-shell">
    <div ref="containerRef" class="scene"></div>

    <div class="hud-layer">
      <TopBar />

      <div class="left-column">
        <LayerPanel />
        <ToolPanel />
      </div>

      <div class="right-column">
        <InfoCard />
        <StationPanel />
      </div>

      <TimeLine />
      <ProfileChart />
      <StatusBar />
      <ToastLayer />
    </div>

    <div v-if="scene.loading" class="overlay">
      <div class="overlay__title">长江武汉段三维时空数据可视化平台</div>
      <div class="overlay__text">{{ scene.loadingText }}</div>
      <div class="overlay__detail">{{ scene.loadingDetail }}</div>
      <div class="overlay__bar"><span></span></div>
      <div class="overlay__timer">已等待 {{ scene.loadingSeconds }} 秒</div>
      <div v-if="appErrors.length" class="overlay__errors">
        <div v-for="item in appErrors" :key="item.at + item.source" class="overlay__error">
          [{{ item.at }}] {{ item.source }}：{{ item.message }}
        </div>
      </div>
    </div>

    <div v-if="fatal" class="overlay overlay--error">
      <div class="overlay__title">场景初始化失败</div>
      <div class="overlay__text">{{ fatal }}</div>
      <div class="overlay__text">请确认已执行 pnpm install 与 pnpm build:data</div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createViewer } from '@/core/cesium/viewerFactory.js'
import { isWebGLAvailable } from '@/core/cesium/viewerFactory.js'
import { destroyViewer, setViewer } from '@/core/viewerHolder.js'
import { createContext } from '@/core/platform/createContext.js'
import { createModuleRegistry } from '@/core/platform/moduleRegistry.js'
import { setRegistry } from '@/core/platform/registryHolder.js'
import { setContext } from '@/core/platform/contextHolder.js'
import { createDataService } from '@/services/dataService.js'
import { EVENTS } from '@/core/events/eventBus.js'
import { appErrors, recordError } from '@/core/diagnostics.js'
import { useSceneStore } from '@/stores/scene.js'
import { useTimeStore } from '@/stores/time.js'
import { useDataStore } from '@/stores/data.js'

import basemap from '@/modules/basemap.module.js'
import terrain from '@/modules/terrain.module.js'
import water from '@/modules/water.module.js'
import bridges from '@/modules/bridges.module.js'
import roads from '@/modules/roads.module.js'
import stations from '@/modules/stations.module.js'
import timeline from '@/modules/timeline.module.js'
import status from '@/modules/status.module.js'
import measure from '@/modules/analysis-measure.module.js'
import profile from '@/modules/analysis-profile.module.js'
import flood from '@/modules/analysis-flood.module.js'

import TopBar from '@/components/hud/TopBar.vue'
import LayerPanel from '@/components/hud/LayerPanel.vue'
import ToolPanel from '@/components/hud/ToolPanel.vue'
import StationPanel from '@/components/hud/StationPanel.vue'
import TimeLine from '@/components/hud/TimeLine.vue'
import ProfileChart from '@/components/hud/ProfileChart.vue'
import InfoCard from '@/components/hud/InfoCard.vue'
import StatusBar from '@/components/hud/StatusBar.vue'
import ToastLayer from '@/components/hud/ToastLayer.vue'

const MODULES = [
  basemap,
  terrain,
  water,
  bridges,
  roads,
  stations,
  timeline,
  status,
  measure,
  profile,
  flood
]

const containerRef = ref(null)
const fatal = ref('')
const scene = useSceneStore()
const time = useTimeStore()
const data = useDataStore()

let registry = null
let offToast = null

onMounted(async () => {
  const ticker = window.setInterval(() => {
    scene.loadingSeconds += 1
  }, 1000)
  try {
    scene.loadingText = '正在检查运行环境 …'
    scene.loadingDetail = 'WebGL / 浏览器能力检测'
    if (!isWebGLAvailable()) {
      throw new Error(
        '当前运行环境不支持 WebGL，无法创建三维场景。请在 Chrome / Edge 中打开 http://127.0.0.1:5173/ 访问'
      )
    }

    scene.loadingText = '正在加载空间与时空数据 …'
    const dataService = createDataService()
    const { spatial, series, meta, failures, critical } = await dataService.loadAll(
      ({ finished, total, file }) => {
        scene.loadingDetail = `数据文件 ${finished}/${total}：${file}`
      }
    )
    data.setData(spatial)
    data.setSeries(series)
    data.meta = meta
    time.setTimeline(series?.timestamps ?? [])
    if (critical.length) {
      recordError('数据加载', new Error(critical.map((item) => item.message).join('；')))
    }
    if (failures.length) {
      console.warn('[app] 以下数据文件加载失败：', failures)
    }

    scene.loadingText = '正在初始化三维场景 …'
    scene.loadingDetail = '创建 Cesium 视图与三维引擎'
    setViewer(createViewer(containerRef.value))

    scene.loadingText = '正在装配平台模块 …'
    scene.loadingDetail = `注册并挂载 ${MODULES.length} 个功能模块`
    const ctx = createContext()
    ctx.dataService = dataService
    setContext(ctx)

    registry = createModuleRegistry(ctx)
    setRegistry(registry)
    MODULES.forEach((module) => registry.register(module))
    // 只挂载"有默认可见图层"的模块与平台服务型模块，
    // 默认关闭的图层（主干道、淹没单元）等用户打开时再惰性挂载
    registry.list().forEach((module) => {
      const isService = module.layers.length === 0
      const hasVisibleLayer = module.layers.some((layer) => layer.defaultVisible !== false)
      if (isService || hasVisibleLayer) registry.mount(module.id)
    })
    scene.setLayers(registry.layers.map((layer) => ({ ...layer })))

    offToast = ctx.eventBus.on(EVENTS.TOAST, ({ message, type }) => scene.toast(message, type))

    scene.loading = false
    scene.ready = true
    scene.toast('场景就绪：拖时间轴看洪水演进，左侧切换图层，右侧查看站点数据')
    if (failures.length) {
      scene.toast(`有 ${failures.length} 个数据文件加载失败，部分图层可能为空`, 'warn')
    }
  } catch (err) {
    recordError('初始化', err)
    fatal.value = err?.message ?? String(err)
    scene.loading = false
  } finally {
    window.clearInterval(ticker)
  }
})

onBeforeUnmount(() => {
  offToast?.()
  registry?.destroyAll()
  destroyViewer()
})
</script>

<style scoped>
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: radial-gradient(circle at 50% 40%, rgba(12, 34, 54, 0.96), rgba(4, 9, 16, 0.99));
  z-index: 20;
}

.overlay__title {
  color: #ffffff;
  font-size: 22px;
  letter-spacing: 3px;
  text-shadow: 0 0 18px rgba(79, 209, 255, 0.6);
}

.overlay__text {
  color: var(--c-muted);
  font-size: 13px;
}

.overlay__detail {
  color: rgba(143, 180, 204, 0.75);
  font-size: 12px;
}

.overlay__timer {
  color: rgba(143, 180, 204, 0.6);
  font-size: 12px;
}

.overlay__errors {
  max-width: 760px;
  margin-top: 6px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 77, 109, 0.4);
  border-radius: 3px;
  background: rgba(30, 12, 18, 0.7);
}

.overlay__error {
  color: #ff9fb1;
  font-size: 12px;
  line-height: 1.8;
  word-break: break-all;
}

.overlay__bar {
  width: 260px;
  height: 3px;
  overflow: hidden;
  background: rgba(79, 209, 255, 0.15);
}

.overlay__bar span {
  display: block;
  width: 40%;
  height: 100%;
  background: var(--c-accent);
  animation: slide 1.2s infinite ease-in-out;
}

.overlay--error {
  background: rgba(6, 13, 22, 0.97);
}

@keyframes slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(260%);
  }
}
</style>
