import * as Cesium from 'cesium'
import { watch } from 'vue'
import { defineModule } from '../core/platform/defineModule.js'
import { EVENTS } from '../core/events/eventBus.js'
import { WATER_LEVEL, FLOOD_PALETTE } from '../config/scene.js'
import {
  createFloodRasterizer,
  renderMaskToCanvas,
  MASK_CHANNEL,
  MASK_CONNECTED,
  MASK_ISOLATED
} from '../core/flood/floodRaster.js'

/**
 * 淹没分析模块（空间分析 · 淹没）
 * ------------------------------------------------------------------
 * 栅格法：在本地 DEM 格网上逐格判定"地形是否低于水面"，
 *   再从河道出发做连通性搜索，只有与长江/汉江连通的低地才算淹没。
 *   开"堤防口径"时堤线是不可穿越屏障（下界），关掉就是最宽松的上界。
 *
 * 为什么不用原来的示意单元法：那是沿真实岸线外扩 260 / 640 / 1150 / 1750 m
 *   造出来的四条环带（高程 24.0 / 25.5 / 27.0 / 28.5 m），
 *   形状天然是"沿岸线等距离拓宽"，跟地形没有关系。
 *   栅格法的边界完全由 DEM 决定，河道从窄到宽、支流与洼地各有各的形态。
 *   示意单元法只保留一个面积数字作为对照，不再出图。
 *
 * 水位来自全局唯一真值 effectiveWaterLevel，因此拖时间轴就是洪水演进。
 */
export default defineModule({
  id: 'analysis-flood',
  name: '淹没分析',
  group: '分析图层',
  description: 'DEM 栅格判定 + 连通性分析的淹没范围与面积',
  layers: [{ id: 'layer-flood', name: '淹没范围', group: '分析图层', defaultVisible: false }],
  init(ctx) {
    const viewer = ctx.viewer
    const data = ctx.data

    /** 掩膜配色：河道 / 连通新增陆地 / 低于水位但未连通（图例取的是同一份配置） */
    const toRgba = (item) => [
      item.rgb[0],
      item.rgb[1],
      item.rgb[2],
      Math.round(item.alpha * 255)
    ]
    const palette = () => ({
      [MASK_CHANNEL]: toRgba(FLOOD_PALETTE.channel),
      [MASK_CONNECTED]: toRgba(FLOOD_PALETTE.connected),
      // 关掉"未连通"显示时把 alpha 置零，掩膜本身仍然参与统计
      [MASK_ISOLATED]: showIsolated ? toRgba(FLOOD_PALETTE.isolated) : [0, 0, 0, 0]
    })

    let active = false
    let ready = false
    let rasterizer = null
    let coverage = null
    let overlayLayer = null
    let overlayProvider = null
    let overlayReady = false
    let pendingImage = null
    /** 复用的掩膜画布：避免每次更新都分配 2.9 MB 的 ImageData */
    let maskCanvas = null
    let useBarrier = true
    let showIsolated = true
    let lastResult = null
    let loadPromise = null
    let maskMeta = { waterDatumOffsetM: 1.87 }

    /** 演示用的示意单元法面积对照（不出图，只给数字） */
    function bandAreaAt(level) {
      const bands = data.floodBands ?? []
      const flooded = bands.filter((f) => level >= f.properties.elev_wusong_m)
      return {
        area: flooded.reduce((sum, f) => sum + (f.properties.area_km2 || 0), 0),
        count: flooded.length,
        total: bands.length
      }
    }

    async function load() {
      const grid = ctx.demGrid
      if (!grid) throw new Error('本地 DEM 尚未加载，栅格淹没需要本地高程格网')
      // 与 dataService 一致，用 BASE_URL 拼接，子路径部署时同样可用
      const base = import.meta.env.BASE_URL || '/'
      const [maskRes, metaRes] = await Promise.all([
        fetch(`${base}data/flood-mask.bin`),
        fetch(`${base}data/flood-mask.json`)
      ])
      if (!maskRes.ok) throw new Error(`淹没掩膜不可用（HTTP ${maskRes.status}）`)
      if (metaRes.ok) maskMeta = await metaRes.json()
      const packed = new Uint8Array(await maskRes.arrayBuffer())
      const size = grid.cols * grid.rows
      if (packed.length !== size) {
        throw new Error(`淹没掩膜尺寸不符：期望 ${size}，实际 ${packed.length}`)
      }
      const seed = new Uint8Array(size)
      const barrier = new Uint8Array(size)
      for (let i = 0; i < size; i += 1) {
        if (packed[i] & 1) seed[i] = 1
        if (packed[i] & 2) barrier[i] = 1
      }
      coverage = {
        west: grid.west,
        south: grid.south,
        east: grid.west + grid.cols * grid.cellDeg,
        north: grid.south + grid.rows * grid.cellDeg
      }
      rasterizer = createFloodRasterizer({
        heights: grid.heights,
        cols: grid.cols,
        rows: grid.rows,
        west: grid.west,
        south: grid.south,
        cellDeg: grid.cellDeg,
        seed,
        barrier,
        datumOffset: Number(maskMeta.waterDatumOffsetM ?? 1.87)
      })
    }

    /**
     * 影像图层只建一次。
     * 早期版本每次水位变化都 remove + add 整个图层，结果是那一层在重建期间是空的，
     * 时间轴一播就闪。Cesium 在 GlobeSurfaceTileProvider._onLayerAdded 里给每个图层挂了
     * provider._reload()：它清掉该图层的影像缓存、让已加载的瓦片重新请求，但不拆图层，
     * 配合直接把画布当图上（省掉 PNG 编码与解码），换图几乎是即时的。
     */
    function ensureOverlay() {
      if (overlayProvider) return
      const blank = document.createElement('canvas')
      blank.width = 1
      blank.height = 1
      overlayProvider = new Cesium.SingleTileImageryProvider({
        url: blank.toDataURL(),
        rectangle: Cesium.Rectangle.fromDegrees(
          coverage.west,
          coverage.south,
          coverage.east,
          coverage.north
        )
      })
      overlayProvider.readyPromise.then(() => {
        overlayReady = true
        if (pendingImage) {
          pushImage(pendingImage)
          pendingImage = null
        }
      })
      // 插在注记之下：底图(0) → 地形设色(1) → 淹没范围 → 注记
      const index = Math.max(1, viewer.imageryLayers.length - 1)
      overlayLayer = viewer.imageryLayers.addImageryProvider(overlayProvider, index)
      overlayLayer.show = active
    }

    function pushImage(canvas) {
      overlayProvider._image = canvas
      if (typeof overlayProvider._reload === 'function') {
        overlayProvider._reload()
        return
      }
      // 兜底：万一 Cesium 版本没有 _reload，只能退回拆层重建
      if (overlayLayer) viewer.imageryLayers.remove(overlayLayer, true)
      const index = Math.max(1, viewer.imageryLayers.length - 1)
      overlayLayer = viewer.imageryLayers.addImageryProvider(overlayProvider, index)
      overlayLayer.show = active
    }

    function applyMask(mask) {
      maskCanvas = renderMaskToCanvas(
        mask,
        rasterizer.cols,
        rasterizer.rows,
        palette(),
        maskCanvas
      )
      if (!overlayProvider) ensureOverlay()
      if (!overlayReady) {
        pendingImage = maskCanvas
        return
      }
      pushImage(maskCanvas)
    }

    function compute(level) {
      const result = rasterizer.floodAt(level, { useBarrier })
      applyMask(result.mask)
      const bands = bandAreaAt(level)
      lastResult = {
        type: 'flood',
        model: 'raster',
        level,
        levelText: level.toFixed(2) + ' m',
        useBarrier,
        barrierText: useBarrier ? '计入堤防（下界）' : '不考虑堤防（上界）',
        /** 连通淹没（含河道） */
        areaKm2: result.connectedKm2,
        newLandKm2: result.newLandKm2,
        channelKm2: result.channelKm2,
        /** 地形上低于水位、但被堤防或城区伪高值挡住的部分 */
        isolatedKm2: result.isolatedKm2,
        belowKm2: result.belowKm2,
        meanDepth: Number(result.meanDepth.toFixed(2)),
        maxDepth: Number(result.maxDepth.toFixed(2)),
        lowestElevation: result.lowestElevation,
        /** 示意单元法对照 */
        bandAreaKm2: Number(bands.area.toFixed(2)),
        floodedBandCount: bands.count,
        bandCount: bands.total,
        waterDatumOffsetM: result.waterDatumOffsetM,
        overWarn: level >= WATER_LEVEL.warn
      }
      ctx.eventBus.emit(EVENTS.ANALYSIS_RESULT, lastResult)
      return lastResult
    }

    /**
     * 水位连续变化时节流（不是防抖）
     * ------------------------------------------------------------------
     * 曾经用防抖：每次水位变化都重新计时。时间轴开到 16 倍速时水位每 60 ms 变一次，
     * 定时器被反复取消，**永远等不到执行**——画面和面板会一直停在某个旧值上。
     * 现在改成节流：距上次计算不足 MIN_INTERVAL_MS 就排一个"尾随"任务（不取消已有的），
     * 保证既不超过更新频率上限，又一定会跟上最新的水位。
     */
    const MIN_INTERVAL_MS = 100
    let lastComputeAt = 0
    let trailingTimer = null
    let latestLevel = null

    function runCompute() {
      if (trailingTimer) {
        window.clearTimeout(trailingTimer)
        trailingTimer = null
      }
      if (!active || !ready || latestLevel == null) return
      lastComputeAt = performance.now()
      try {
        compute(latestLevel)
      } catch (err) {
        console.error('[flood] 栅格淹没计算失败', err)
        ctx.toast('淹没计算失败', 'error')
      }
    }

    function scheduleCompute(level) {
      if (!active || !ready) return
      latestLevel = level
      const wait = MIN_INTERVAL_MS - (performance.now() - lastComputeAt)
      if (wait <= 0) {
        runCompute()
        return
      }
      // 已有尾随任务就让它继续跑，不要重置——这正是防抖会饿死的地方
      if (trailingTimer) return
      trailingTimer = window.setTimeout(runCompute, wait)
    }

    /** 惰性加载只做一次：图层树开关与面板开关会同时触发 activate，必须共用同一个 Promise */
    async function ensureReady() {
      if (ready) return true
      if (!loadPromise) {
        loadPromise = load()
          .then(() => {
            ready = true
            ctx.toast(
              `栅格淹没已就绪（${rasterizer.cols}×${rasterizer.rows} 格网，堤防口径：${useBarrier ? '计入' : '不考虑'}）`
            )
          })
          .catch((err) => {
            loadPromise = null
            throw err
          })
      }
      try {
        await loadPromise
        return true
      } catch (err) {
        console.warn('[flood] 栅格淹没不可用', err)
        ctx.toast(err.message || '栅格淹没不可用', 'warn')
        return false
      }
    }

    async function activate() {
      const ok = await ensureReady()
      if (!ok) return false
      if (overlayLayer) overlayLayer.show = true
      compute(data.effectiveWaterLevel)
      return true
    }

    const stopWatch = watch(
      () => data.effectiveWaterLevel,
      (level) => scheduleCompute(level)
    )

    return {
      async setActive(next) {
        active = Boolean(next)
        if (active) {
          const ok = await activate()
          if (!ok) active = false
        } else if (overlayLayer) {
          overlayLayer.show = false
        }
        return active
      },
      isActive: () => active,
      /** 堤防口径：true = 计入堤防（下界），false = 不考虑堤防（上界） */
      setUseBarrier(next) {
        useBarrier = Boolean(next)
        if (active && ready) compute(data.effectiveWaterLevel)
      },
      getUseBarrier: () => useBarrier,
      /** 是否显示"低于水位但未连通"的格子（不显示也照样计入统计） */
      setShowIsolated(next) {
        showIsolated = Boolean(next)
        if (active && ready) compute(data.effectiveWaterLevel)
      },
      getShowIsolated: () => showIsolated,
      getLayer: () => overlayLayer,
      setLayerVisible(_layerId, visible) {
        active = Boolean(visible)
        if (visible) {
          activate()
        } else if (overlayLayer) {
          overlayLayer.show = false
        }
      },
      getResult: () => lastResult,
      stopWatch: () => stopWatch()
    }
  },
  destroy(ctx, api) {
    api?.stopWatch?.()
    const viewer = ctx.viewer
    if (!viewer) return
    // 只移除本模块创建的影像层（地形设色层与本层同级，不能按类型误删）
    const layer = api?.getLayer?.()
    if (layer) viewer.imageryLayers.remove(layer, true)
  }
})
