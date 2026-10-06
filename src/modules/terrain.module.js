import * as Cesium from 'cesium'
import { defineModule } from '../core/platform/defineModule.js'
import { TERRAIN_SERVICE, LOCAL_DEM, TERRAIN_EXAGGERATION } from '../config/scene.js'
import { createLocalDemTerrainProvider } from '../core/cesium/localDemTerrain.js'
import { setTerrainSampler, setTerrainExaggeration, setDemGrid } from '../core/terrainState.js'

/**
 * 地形模块
 * 优先使用项目自带的本地 DEM（FABDEM）自建 TerrainProvider——
 * 在线全球地形在武汉城区是常数 24.8 m，看不出任何起伏；
 * 本地 DEM 拿不到时退回 ArcGIS 全球地形（无需密钥），再失败则用椭球面。
 * 图层开关随时可以切回椭球面做对比。
 */
export default defineModule({
  id: 'terrain',
  name: '三维地形',
  group: '地形',
  description: '本地 DEM / 在线地形加载与开关',
  layers: [{ id: 'layer-terrain', name: '地形起伏', group: '地形' }],
  init(ctx) {
    const viewer = ctx.viewer
    const ellipsoid = new Cesium.EllipsoidTerrainProvider()
    let terrainProvider = null
    let enabled = true
    let source = 'ellipsoid'
    /** 本地 DEM 的采高函数，只有本地地形生效时才交给剖面等模块 */
    let localSampler = null
    /** 高程分层设色影像层（叠在底图之上、注记之下） */
    let tintLayer = null
    let exaggeration = TERRAIN_EXAGGERATION.factor

    function apply() {
      viewer.terrainProvider = enabled && terrainProvider ? terrainProvider : ellipsoid
      ctx.scene.terrainSource = enabled && terrainProvider ? source : 'ellipsoid'
      setTerrainSampler(enabled && source === 'local-dem' ? localSampler : null)
      if (tintLayer) tintLayer.show = enabled && source === 'local-dem'
      applyExaggeration()
    }

    /**
     * 把分层设色图铺到地形上
     * 索引 1：底图永远在最底层（basemap 模块用索引 0 插入），注记在最上层，
     * 设色层夹在中间，换底图时也不会被盖掉。
     */
    function addTintLayer(tintDataUrl, coverage) {
      if (!tintDataUrl) return
      const provider = new Cesium.SingleTileImageryProvider({
        url: tintDataUrl,
        rectangle: Cesium.Rectangle.fromDegrees(
          coverage.west,
          coverage.south,
          coverage.east,
          coverage.north
        )
      })
      tintLayer = viewer.imageryLayers.addImageryProvider(provider, 1)
      tintLayer.show = enabled
    }

    /**
     * 垂直夸张：只缩放地形网格和依赖地形高度的实体（经 geoUtils.wusongToScene 换算）。
     * 地形关掉时必须回到 1，否则水面会和椭球面错开。
     */
    function applyExaggeration() {
      const factor = enabled && terrainProvider ? exaggeration : 1
      viewer.scene.globe.terrainExaggeration = factor
      setTerrainExaggeration(factor)
      ctx.scene.terrainExaggeration = factor
    }

    /** 备用：ArcGIS 全球地形（无需密钥，但研究区内基本是常数高程） */
    async function loadOnlineTerrain() {
      try {
        const provider = new Cesium.ArcGISTiledElevationTerrainProvider({
          url: TERRAIN_SERVICE.url,
          requestVertexNormals: TERRAIN_SERVICE.requestVertexNormals
        })
        await provider.readyPromise
        terrainProvider = provider
        source = 'arcgis-online'
        apply()
        ctx.toast('已退回在线全球地形（研究区内起伏很小）', 'warn')
      } catch (err) {
        console.warn('[terrain] 地形服务加载失败', err)
        source = 'ellipsoid'
        terrainProvider = null
        apply()
        ctx.toast('地形服务不可用，已使用椭球面（剖面结果为椭球高）', 'warn')
      }
    }

    async function load() {
      if (LOCAL_DEM.enabled) {
        try {
          const local = await createLocalDemTerrainProvider({
            metaUrl: LOCAL_DEM.metaUrl,
            binUrl: LOCAL_DEM.binUrl,
            tileSamples: LOCAL_DEM.tileSamples,
            maxLevel: LOCAL_DEM.maxLevel,
            verticalShiftM: LOCAL_DEM.verticalShiftM,
            credit: LOCAL_DEM.credit
          })
          terrainProvider = local.provider
          source = 'local-dem'
          // 本地 DEM 没有 availability，剖面等模块改为直接查格网采高
          localSampler = local.sampleHeight
          // 把整份格网交给平台：栅格淹没这类需要逐格计算的模块直接复用，不必再取一次数据
          setDemGrid({
            heights: local.heights,
            cols: local.meta.grid.cols,
            rows: local.meta.grid.rows,
            west: local.meta.grid.west,
            south: local.meta.grid.south,
            cellDeg: local.meta.grid.cellDeg,
            coverage: local.coverage
          })
          addTintLayer(local.tintDataUrl, local.coverage)
          apply()
          ctx.scene.terrainCoverage = local.coverage
          const { rows, cols, cellMetersLng } = local.meta.grid
          ctx.toast(
            `本地 DEM 地形已加载（${cols}×${rows} 格网，约 ${cellMetersLng} m 分辨率），可进行剖面分析`
          )
          return
        } catch (err) {
          console.warn('[terrain] 本地 DEM 加载失败，改用在线地形', err)
        }
      }
      await loadOnlineTerrain()
    }

    load()

    return {
      setEnabled(next) {
        enabled = next
        ctx.scene.terrainEnabled = next
        apply()
      },
      setLayerVisible(_layerId, visible) {
        enabled = visible
        ctx.scene.terrainEnabled = visible
        apply()
      },
      /** 设置垂直夸张倍数（1 / 2 / 3 / 5），仅影响显示 */
      setExaggeration(value) {
        exaggeration = Number(value) > 0 ? Number(value) : 1
        applyExaggeration()
        return exaggeration
      },
      /** 当前生效的地形来源：local-dem / arcgis-online / ellipsoid */
      getSource: () => source
    }
  }
})
